import ReplayKit
import ImageIO
import DirectCore
import DirectCapture
import TeslaBLE

final class DirectSampleHandler: RPBroadcastSampleHandler {
    private let lock = NSLock()
    private var runtime: DirectBroadcastRuntime?

    override func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {
        do {
            let session = try DirectBroadcastSession.fresh(settings: DirectSessionStore.settings())
            let value = try DirectBroadcastRuntime(session: session) { [weak self] error in
                DispatchQueue.main.async { self?.finishBroadcastWithError(error) }
            }
            try DirectSessionStore.saveSession(session)
            lock.lock(); runtime = value; lock.unlock()
            value.start()
        } catch { finishBroadcastWithError(error) }
    }

    override func processSampleBuffer(_ sampleBuffer: CMSampleBuffer, with sampleBufferType: RPSampleBufferType) {
        guard sampleBufferType == .video else { return } // No microphone or app-audio capture.
        lock.lock(); let value = runtime; lock.unlock()
        let attachment = CMGetAttachment(sampleBuffer, key: RPVideoSampleOrientationKey as CFString, attachmentModeOut: nil) as? NSNumber
        let orientation = CGImagePropertyOrientation(rawValue: attachment?.uint32Value ?? 1) ?? .up
        value?.append(sampleBuffer, orientation: orientation)
    }
    override func broadcastPaused() { lock.lock(); let value = runtime; lock.unlock(); value?.setPaused(true) }
    override func broadcastResumed() { lock.lock(); let value = runtime; lock.unlock(); value?.setPaused(false) }
    override func broadcastFinished() {
        lock.lock(); let value = runtime; runtime = nil; lock.unlock()
        value?.stop()
    }
}

private final class DirectBroadcastRuntime {
    private let session: DirectBroadcastSession
    private let queue = DispatchQueue(label: "CabinDirect.Broadcast")
    private let queueKey = DispatchSpecificKey<UInt8>()
    private let server: LocalHTTPServer
    private let onFailure: (Error) -> Void
    private var capture: CapturePipeline?
    private var ble: NativeTeslaMediaClient?
    private var lyrics: DirectLyricsClient?
    private var timer: DispatchSourceTimer?
    private var state = LocalPublicState()
    private var running = false
    private var paused = false
    private var listenerReady = false
    private var actualPort: UInt16 = 0
    private var identity = ""
    private var media: TeslaMediaTrack?
    private var timeline: DirectLyricTimeline?
    private var observations = DirectObservationGate(acceptedAfter: Date().timeIntervalSince1970)
    private var mediaGeneration = UUID()

    init(session: DirectBroadcastSession, onFailure: @escaping (Error) -> Void) throws {
        self.session = session; self.onFailure = onFailure
        queue.setSpecific(key: queueKey, value: 1)
        var assets: [String: LocalHTTPAsset] = [:]
        for (file, route, type) in [("index.html", "/", "text/html; charset=utf-8"),
                                    ("direct.js", "/direct.js", "text/javascript; charset=utf-8"),
                                    ("direct.css", "/direct.css", "text/css; charset=utf-8")] {
            guard let url = Bundle.main.url(forResource: file, withExtension: nil, subdirectory: "StandaloneWeb") else {
                throw DemoError.message("投屏网页资源缺失；不会启动空的服务。")
            }
            let data = try Data(contentsOf: url)
            guard !data.isEmpty, data.count <= 524_288 else { throw DemoError.message("投屏网页资源无效。") }
            assets[route] = LocalHTTPAsset(data: data, contentType: type)
        }
        server = LocalHTTPServer(configuration: .init(token: session.token, pairingCode: session.pairingCode,
                                                     expiresAt: session.expiresAt), assets: assets)
    }

    func start() {
        queue.async {
            guard !self.running else { return }
            self.running = true
            let settings = self.session.settings
            self.state = LocalPublicState(lyricState: settings.lyricMode == .mirror ? "disabled" : "waiting",
                                           source: settings.lyricMode == .teslaMedia ? "tesla-ble" : "visible-screen",
                                           message: "正在启动手机内置服务；等待首帧。")
            self.capture = CapturePipeline(maxLongEdge: 960, maxShortEdge: 540, maxFPS: 8,
                ocrEnabled: settings.lyricMode == .visibleText,
                region: .init(x: settings.regionX, y: settings.regionY, width: settings.regionWidth, height: settings.regionHeight),
                onFrame: { [weak self] frame in self?.receive(frame) },
                onText: { [weak self] text in self?.receive(text) })
            self.server.start(port: settings.port, onReady: { [weak self] port in
                self?.queue.async {
                    guard let self, self.running else { return }
                    self.listenerReady = true; self.actualPort = port
                    self.state.message = "手机内置服务已监听。请在车机输入实际局域网地址，并在 120 秒内配对。"
                    self.publish()
                }
            }, onFailure: { [weak self] error in self?.fail(error) })
            let timer = DispatchSource.makeTimerSource(queue: self.queue)
            timer.schedule(deadline: .now(), repeating: 1)
            timer.setEventHandler { [weak self] in self?.tick() }
            self.timer = timer; timer.resume()
            if settings.lyricMode == .teslaMedia { self.startMedia() }
        }
    }

    func append(_ sample: CMSampleBuffer, orientation: CGImagePropertyOrientation) {
        // Do not queue sample buffers here: CapturePipeline owns single-frame admission.
        let value: CapturePipeline? = queue.sync { running && !paused ? capture : nil }
        value?.append(sample, orientation: orientation)
    }

    private func receive(_ frame: CapturedJPEG) {
        queue.async {
            guard self.running, !self.paused, self.observations.accepts(frame.updatedAt) else { return }
            self.state.captureState = "live"
            self.state.sequence = frame.sequence; self.state.frameUpdatedAt = frame.updatedAt
            self.state.width = frame.width; self.state.height = frame.height
            self.server.updateFrame(.init(data: frame.data, sequence: frame.sequence, updatedAt: frame.updatedAt,
                                          width: frame.width, height: frame.height))
            self.server.updateState(self.state)
        }
    }

    private func receive(_ text: VisibleTextSnapshot) {
        queue.async {
            guard self.running, !self.paused, self.session.settings.lyricMode == .visibleText,
                  ["visible", "empty", "stale"].contains(text.status),
                  text.status == "stale" || self.observations.accepts(text.updatedAt) else { return }
            self.state.lyricState = text.status; self.state.lyricLines = text.lines
            self.state.lyricUpdatedAt = text.updatedAt
            self.server.updateState(self.state)
        }
    }

    func setPaused(_ value: Bool) {
        queue.async {
            guard self.running else { return }
            self.paused = value
            self.observations.advance(to: Date().timeIntervalSince1970)
            self.capture?.setPaused(value)
            if value {
                self.mediaGeneration = UUID()
                self.ble?.stop(); self.ble = nil
                self.lyrics?.stop(); self.lyrics = nil
                self.media = nil; self.timeline = nil; self.identity = ""
            } else if self.session.settings.lyricMode == .teslaMedia { self.startMedia() }
            self.state.captureState = value ? "paused" : "waiting"
            self.state.lyricState = value ? "paused" : (self.session.settings.lyricMode == .mirror ? "disabled" : "waiting")
            self.state.lyricLines = []; self.state.lyricUpdatedAt = 0
            self.state.frameUpdatedAt = 0
            self.server.updateFrame(nil)
            self.state.message = value ? "系统广播已暂停，接收端已清空旧画面。" : "等待恢复后的新画面。"
            self.publish()
        }
    }

    private func startMedia() {
        let generation = UUID()
        mediaGeneration = generation
        let settings = session.settings
        let keyStore = TeslaKeyStore(accessGroup: Bundle.main.object(forInfoDictionaryKey: "TCKeychainAccessGroup") as? String,
                                    tag: "media-monitor." + settings.vin)
        do {
            guard try keyStore.hasKey() else { state.message = "没有本机媒体钥匙；不会自动配对或生成钥匙。"; return }
        } catch { state.message = "钥匙串读取失败，停止媒体读取。"; return }
        let client = NativeTeslaMediaClient(vin: settings.vin, keyStore: keyStore,
            timeUnit: settings.mediaTimeUnit == "milliseconds" ? .milliseconds : .seconds,
            onStatus: { [weak self] message in self?.queue.async {
                guard let self, self.running, !self.paused, self.mediaGeneration == generation else { return }
                self.state.message = message; self.publish()
            } }, onMedia: { [weak self] track in self?.queue.async {
                guard let self, self.mediaGeneration == generation else { return }; self.receiveMedia(track)
            } })
        ble = client
        if settings.onlineLyrics { lyrics = DirectLyricsClient() }
        client.startReading()
    }

    private func receiveMedia(_ track: TeslaMediaTrack) {
        guard running, !paused else { return }
        media = track
        let next = (track.title ?? "") + "\u{1f}" + (track.artist ?? "") + "\u{1f}" + String((track.duration ?? -1).rounded())
        guard next != identity else { return }
        identity = next; timeline = nil
        lyrics?.cancel()
        state.lyricLines = []; state.lyricUpdatedAt = 0
        state.message = [track.title, track.artist].compactMap { $0 }.joined(separator: " · ")
        guard let lyrics else { state.lyricState = "disabled"; publish(); return }
        state.lyricState = "looking-up"; publish()
        let generation = mediaGeneration
        lyrics.lookup(title: track.title ?? "", artist: track.artist ?? "", duration: track.duration) { [weak self] result in
            self?.queue.async {
                guard let self, self.running, !self.paused, self.mediaGeneration == generation, self.identity == next else { return }
                switch result {
                case .success(let value): self.timeline = value; self.state.lyricState = "synced"
                case .failure(let error): self.state.lyricState = "unavailable"; self.state.message = error.localizedDescription
                }
                self.publish()
            }
        }
    }

    private func tick() {
        guard running else { return }
        let now = Date().timeIntervalSince1970
        guard now < session.expiresAt else { fail(DemoError.message("广播会话已达到 8 小时上限，请重新开始。")); return }
        if !paused, session.settings.lyricMode == .teslaMedia, let media, let position = media.position,
           let playing = media.playing, position.isFinite, position >= 0,
           now >= media.observedAt, now - media.observedAt < 6, let timeline {
            let current = position + (playing ? now - media.observedAt : 0)
            state.lyricLines = timeline.visible(at: min(media.duration ?? current, current))
            state.lyricUpdatedAt = now
            state.lyricState = "synced"
        } else if session.settings.lyricMode == .teslaMedia {
            state.lyricLines = []; state.lyricUpdatedAt = 0
        }
        publish()
    }

    private func publish() {
        server.updateState(state)
        let frameAge = Date().timeIntervalSince1970 - state.frameUpdatedAt
        let freshFrame = state.frameUpdatedAt > 0 && frameAge >= 0 && frameAge <= LocalHTTPServer.staleAfter
        let statusState = paused ? "paused" : (state.captureState == "live" ? (freshFrame ? "broadcasting" : "stale") : "waiting")
        let message = statusState == "stale" ? "服务仍在运行，但画面超过 4 秒没有更新；接收端已隐藏旧内容。" : state.message
        DirectSessionStore.setStatus(.init(sessionID: session.id, state: listenerReady ? statusState : "starting",
            message: message, addresses: listenerReady ? DirectNetworkAddresses.current().map(\.address) : [],
            port: actualPort, frames: state.sequence, updatedAt: Date().timeIntervalSince1970))
    }

    private func fail(_ error: Error) {
        queue.async {
            guard self.running else { return }
            self.stopOnQueue(message: "广播发生错误，接收服务已停止。")
            self.onFailure(error)
        }
    }

    func stop() {
        let cleanup = { self.stopOnQueue(message: "系统广播已结束，服务和临时配对凭据已失效。") }
        if DispatchQueue.getSpecific(key: queueKey) != nil { cleanup() } else { queue.sync(execute: cleanup) }
    }
    private func stopOnQueue(message: String) {
        running = false; listenerReady = false
        timer?.cancel(); timer = nil
        capture?.stop(); capture = nil
        ble?.stop(); ble = nil
        lyrics?.stop(); lyrics = nil
        timeline = nil; media = nil
        server.updateFrame(nil); server.stop()
        DirectSessionStore.invalidateSession(matching: session.id)
        DirectSessionStore.setStatus(.init(sessionID: session.id, state: "stopped", message: message,
            addresses: [], port: 0, frames: state.sequence, updatedAt: Date().timeIntervalSince1970))
    }
}
