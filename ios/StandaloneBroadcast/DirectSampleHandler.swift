import ReplayKit
import ImageIO
import DirectCore
import DirectCapture

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
        lock.lock(); let value = runtime; lock.unlock()
        if sampleBufferType == .audioApp { value?.appendAudio(sampleBuffer); return }
        guard sampleBufferType == .video else { return } // Never process .audioMic.
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
    private let networkAddresses: [DirectInterfaceAddress]
    private var capture: CapturePipeline?
    private var music: DirectMusicRuntime?
    private var timer: DispatchSourceTimer?
    private var state = LocalPublicState()
    private var running = false
    private var paused = false
    private var listenerReady = false
    private var actualPort: UInt16 = 0
    private var observations = DirectObservationGate(acceptedAfter: Date().timeIntervalSince1970)

    init(session: DirectBroadcastSession, onFailure: @escaping (Error) -> Void) throws {
        self.session = session; self.onFailure = onFailure
        networkAddresses = DirectNetworkAddresses.current()
        guard !networkAddresses.isEmpty else { throw DemoError.message("没有可用的局域网地址。先连接自己的 Wi-Fi 或热点，再启动广播。") }
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
            expiresAt: session.expiresAt,
            allowedIPv6Hosts: networkAddresses.map(\.address).filter(DirectNetworkAddresses.localIPv6)), assets: assets)
    }

    func start() {
        queue.async {
            guard !self.running else { return }
            self.running = true
            let settings = self.session.settings
            self.state = LocalPublicState(lyricState: settings.lyricMode == .mirror ? "disabled" : "waiting",
                                           source: "visible-screen",
                                           message: "正在启动手机内置服务；等待首帧。")
            if settings.musicMode != .off {
                self.music = DirectMusicRuntime(settings: settings) { [weak self] snapshot in
                    self?.queue.async { [weak self] in
                        guard let self, self.running, !self.paused,
                              self.observations.accepts(snapshot.updatedAt) else { return }
                        self.state.music = snapshot; self.server.updateState(self.state)
                    }
                }
                self.music?.start()
            }
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
        }
    }

    func append(_ sample: CMSampleBuffer, orientation: CGImagePropertyOrientation) {
        // Do not queue sample buffers here: CapturePipeline owns single-frame admission.
        let value: CapturePipeline? = queue.sync { running && !paused ? capture : nil }
        value?.append(sample, orientation: orientation)
    }

    func appendAudio(_ sample: CMSampleBuffer) {
        let value = queue.sync { running && !paused ? music : nil }
        value?.append(sample)
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
            self.music?.setPaused(value)
            self.state.music = nil
            self.state.captureState = value ? "paused" : "waiting"
            self.state.lyricState = value ? "paused" : (self.session.settings.lyricMode == .mirror ? "disabled" : "waiting")
            self.state.lyricLines = []; self.state.lyricUpdatedAt = 0
            self.state.frameUpdatedAt = 0
            self.server.updateFrame(nil)
            self.state.message = value ? "系统广播已暂停，接收端已清空旧画面。" : "等待恢复后的新画面。"
            self.publish()
        }
    }

    private func tick() {
        guard running else { return }
        let now = Date().timeIntervalSince1970
        guard now < session.expiresAt else { fail(DemoError.message("广播会话已达到 8 小时上限，请重新开始。")); return }
        guard DirectNetworkAddresses.matches(initial: networkAddresses, current: DirectNetworkAddresses.current()) else {
            fail(DemoError.message("局域网地址已改变，共享已结束。请确认受信任网络后重新启动广播。")); return
        }
        if DirectSessionStore.stopRequested(for: session) {
            stopOnQueue(message: "你已在 App 中结束共享，接收服务与临时凭据已失效。")
            onFailure(DemoError.message("共享已由你结束。"))
            return
        }
        music?.tick()
        publish()
    }

    private func publish() {
        server.updateState(state)
        let frameAge = Date().timeIntervalSince1970 - state.frameUpdatedAt
        let freshFrame = state.frameUpdatedAt > 0 && frameAge >= 0 && frameAge <= LocalHTTPServer.staleAfter
        let statusState = paused ? "paused" : (state.captureState == "live" ? (freshFrame ? "broadcasting" : "stale") : "waiting")
        let message = statusState == "stale" ? "服务仍在运行，但画面超过 4 秒没有更新；接收端已隐藏旧内容。" : state.message
        DirectSessionStore.setStatus(.init(sessionID: session.id, state: listenerReady ? statusState : "starting",
            message: message, addresses: listenerReady ? networkAddresses.map(\.address) : [],
            port: actualPort, frames: state.sequence, updatedAt: Date().timeIntervalSince1970))
    }

    private func fail(_ error: Error) {
        queue.async {
            guard self.running else { return }
            self.stopOnQueue(message: "共享已结束：\(String(error.localizedDescription.prefix(300)))")
            self.onFailure(error)
        }
    }

    func stop() {
        let cleanup = { self.stopOnQueue(message: "系统广播已结束，服务和临时配对凭据已失效。") }
        if DispatchQueue.getSpecific(key: queueKey) != nil { cleanup() } else { queue.sync(execute: cleanup) }
    }
    private func stopOnQueue(message: String) {
        guard running else { return }
        running = false; listenerReady = false
        timer?.cancel(); timer = nil
        capture?.stop(); capture = nil
        music?.stop(); music = nil; state.music = nil
        let sessionID = session.id, frames = state.sequence
        server.updateFrame(nil)
        server.stop {
            // A terminal shared status is an acknowledgement, not merely an enqueued request.
            DirectSessionStore.finishSession(matching: sessionID, message: message, frames: frames)
        }
    }
}
