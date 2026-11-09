import SwiftUI
import UIKit
import AVFAudio
import DirectCore

/// User-started acoustic recognition. No screen capture, shared-store writes,
/// audio files, music-account access, private APIs, or paid-service fallback.
@MainActor
final class DirectLyricsMode: ObservableObject {
    @Published private(set) var session: DirectBroadcastSession?
    @Published private(set) var status: DirectRuntimeStatus?
    @Published private(set) var music: LocalMusicState?
    @Published private(set) var preparing = false
    @Published private(set) var running = false
    @Published private(set) var stopping = false
    @Published private(set) var message = "听车内播放的音乐，自动识曲和找歌词。不共享屏幕。"
    var busy: Bool { preparing || running || stopping }

    private var generation = UUID()
    private var server: LocalHTTPServer?
    private var engine: AVAudioEngine?
    private var tapInstalled = false
    private var audioSessionActive = false
    private var tracker: DirectMusicRuntime?
    private var timer: Timer?
    private var notifications: [NSObjectProtocol] = []
    private var addresses: [DirectInterfaceAddress] = []
    private var actualPort: UInt16 = 0
    private var inputUID: String?

    /// Called only after the visible per-session sharing/recognition notice.
    /// Constructing the model or selecting a tab never requests permission.
    func start(settings: DirectSettings, consent: Bool) {
        guard consent, !busy else { return }
        guard DirectSessionStore.status()?.isCurrent != true else {
            message = "请先停止投屏，再开始歌词。"; return
        }
        guard !DirectNetworkAddresses.current().isEmpty else {
            message = "请先让车机连接手机热点，或连接同一 Wi-Fi。"; return
        }
        generation = UUID(); let ticket = generation
        preparing = true; message = "正在准备歌词…"
        let audio = AVAudioSession.sharedInstance()
        switch audio.recordPermission {
        case .granted: begin(settings: settings, ticket: ticket)
        case .denied:
            preparing = false; message = "需要麦克风权限才能自动听歌。可在系统设置中允许 Cabin 使用麦克风。"
        case .undetermined:
            audio.requestRecordPermission { [weak self] granted in
                Task { @MainActor [weak self] in
                    guard let self, self.preparing, self.generation == ticket else { return }
                    guard granted else {
                        self.preparing = false; self.message = "未允许麦克风，歌词识别没有启动。"; return
                    }
                    self.begin(settings: settings, ticket: ticket)
                }
            }
        @unknown default:
            preparing = false; message = "麦克风暂不可用，未启动歌词识别。"
        }
    }

    private func begin(settings: DirectSettings, ticket: UUID) {
        guard preparing, ticket == generation else { return }
        guard UIApplication.shared.applicationState == .active,
              DirectSessionStore.status()?.isCurrent != true else {
            stop(reason: "请回到 Cabin，并停止投屏后再开始歌词。"); return
        }
        do {
            var clean = settings
            clean.musicMode = .appAudio; clean.networkLyricsAllowed = true
            clean.lyricMode = .mirror; clean = try clean.validated()
            addresses = DirectNetworkAddresses.current()
            guard !addresses.isEmpty else { throw DemoError.message("No local network") }
            let value = try DirectBroadcastSession.fresh(settings: clean)
            let service = LocalHTTPServer(configuration: .init(token: value.token,
                pairingCode: value.pairingCode, expiresAt: value.expiresAt,
                allowedIPv6Hosts: addresses.map(\.address).filter { DirectNetworkAddresses.localIPv6($0) }),
                assets: try receiverAssets())
            session = value; server = service; actualPort = 0
            let musicRuntime = DirectMusicRuntime(settings: clean, input: .microphone) { [weak self] state in
                Task { @MainActor [weak self] in
                    guard let self, self.generation == ticket, self.running, !self.stopping else { return }
                    self.music = state
                    if state.status == "unavailable" {
                        self.stop(reason: "自动识曲暂不可用，可能与网络、服务或签名支持有关。已停止麦克风，不会付费升级。"); return
                    }
                    self.publish()
                }
            }
            tracker = musicRuntime
            // Mix without ducking or HFP voice routing. Do not redirect music to
            // the speaker or select the vehicle's microphone. Route changes stop safely.
            let audio = AVAudioSession.sharedInstance()
            try audio.setCategory(.playAndRecord, mode: .default, options: [.mixWithOthers, .allowBluetoothA2DP])
            try audio.setActive(true); audioSessionActive = true
            guard let builtIn = audio.availableInputs?.first(where: { $0.portType == .builtInMic }) else {
                throw DemoError.message("Built-in microphone unavailable")
            }
            try audio.setPreferredInput(builtIn)
            inputUID = builtIn.uid
            let inputEngine = AVAudioEngine()
            engine = inputEngine
            let input = inputEngine.inputNode
            let format = input.outputFormat(forBus: 0)
            guard format.sampleRate.isFinite, format.sampleRate >= 8_000, format.sampleRate <= 96_000,
                  (1...2).contains(format.channelCount) else { throw DemoError.message("Unsupported input") }
            input.installTap(onBus: 0, bufferSize: 2048, format: format) { [weak musicRuntime] buffer, _ in
                musicRuntime?.appendMicrophone(buffer)
            }
            tapInstalled = true
            installObservers(ticket: ticket)
            musicRuntime.start()
            inputEngine.prepare(); try inputEngine.start()
            guard actualInputIsBuiltIn else { throw DemoError.message("Unexpected input route") }
            preparing = false; running = true
            message = "正在听歌；保持车内音乐可听见。不共享屏幕。"
            service.start(port: clean.port, onReady: { [weak self] port in
                Task { @MainActor [weak self] in
                    guard let self, self.generation == ticket, self.running, !self.stopping else { return }
                    self.actualPort = port; self.tick()
                }
            }, onFailure: { [weak self] _ in
                Task { @MainActor [weak self] in
                    guard let self, self.generation == ticket, !self.stopping else { return }
                    self.stop(reason: "歌词连接未启动，请检查本地网络权限或其他连接是否已停止。")
                }
            })
            let heartbeat = Timer(timeInterval: 1, repeats: true) { [weak self] _ in
                Task { @MainActor [weak self] in self?.tick() }
            }
            timer = heartbeat; RunLoop.main.add(heartbeat, forMode: .common)
            publish()
        } catch {
            stop(reason: "歌词未能启动，已停止麦克风。请检查麦克风和本地网络权限。")
        }
    }

    func stop(reason: String = "歌词已停止，麦克风已关闭。") {
        guard !stopping, busy || server != nil || engine != nil else { return }
        generation = UUID(); let ticket = generation
        preparing = false; stopping = true
        timer?.invalidate(); timer = nil
        for observer in notifications { NotificationCenter.default.removeObserver(observer) }
        notifications.removeAll()
        engine?.stop()
        if tapInstalled { engine?.inputNode.removeTap(onBus: 0); tapInstalled = false }
        engine = nil
        tracker?.stop(); tracker = nil; music = nil
        if audioSessionActive {
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            audioSessionActive = false
        }
        message = "正在停止歌词…"; status = nil
        server?.updateState(.init(captureState: "stopped", source: "microphone-lyrics"))
        if let server {
            server.stop { [weak self] in
                Task { @MainActor [weak self] in self?.finishStop(ticket: ticket, reason: reason) }
            }
        } else { finishStop(ticket: ticket, reason: reason) }
    }

    private func finishStop(ticket: UUID, reason: String) {
        guard generation == ticket, stopping else { return }
        server = nil; session = nil; status = nil; addresses = []; actualPort = 0
        running = false; stopping = false; inputUID = nil; message = reason
    }

    private func tick() {
        guard running, !stopping, let session else { return }
        guard engine?.isRunning == true else { stop(reason: "听歌已中断，麦克风已关闭。请重新开始歌词。"); return }
        guard actualInputIsBuiltIn else { stop(reason: "麦克风连接已变化，已停止听歌。请重新开始歌词。"); return }
        guard DirectSessionStore.status()?.isCurrent != true else { stop(reason: "已切换到系统投屏，歌词模式已停止。"); return }
        guard DirectNetworkAddresses.matches(initial: addresses, current: DirectNetworkAddresses.current()) else {
            stop(reason: "网络已变化，请重新开始歌词并使用新地址连接。"); return
        }
        guard Date().timeIntervalSince1970 < session.expiresAt else { stop(reason: "本次歌词会话已结束，请按需重新开始。"); return }
        tracker?.tick(); publish()
    }

    private func publish() {
        guard running, !stopping, let session else { return }
        server?.updateState(.init(captureState: "waiting", source: "microphone-lyrics",
                                 message: "听车内音乐，自动识曲与歌词；不共享屏幕。", music: music))
        status = .init(sessionID: session.id, state: actualPort > 0 ? "waiting" : "starting",
            message: message, addresses: actualPort > 0 ? addresses.map(\.address) : [],
            port: actualPort, frames: 0, updatedAt: Date().timeIntervalSince1970)
    }

    private var actualInputIsBuiltIn: Bool {
        let inputs = AVAudioSession.sharedInstance().currentRoute.inputs
        return inputs.count == 1 && inputs.first?.portType == .builtInMic && inputs.first?.uid == inputUID
    }

    private func installObservers(ticket: UUID) {
        for name in [AVAudioSession.interruptionNotification, AVAudioSession.routeChangeNotification,
                     AVAudioSession.mediaServicesWereResetNotification, .AVAudioEngineConfigurationChange] {
            let observer = NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] notification in
                let reason = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt
                Task { @MainActor [weak self] in
                    guard let self, self.generation == ticket, self.running, !self.stopping else { return }
                    // Our own setup can finish delivering category/configuration
                    // notifications after start. Ignore only a still-valid route.
                    if name == AVAudioSession.routeChangeNotification,
                       reason == AVAudioSession.RouteChangeReason.categoryChange.rawValue,
                       self.actualInputIsBuiltIn,
                       AVAudioSession.sharedInstance().category == .playAndRecord { return }
                    if name == .AVAudioEngineConfigurationChange,
                       self.engine?.isRunning == true, self.actualInputIsBuiltIn { return }
                    self.stop(reason: "音频连接已变化，已停止听歌。连接稳定后可重新开始歌词。")
                }
            }
            notifications.append(observer)
        }
    }

    private func receiverAssets() throws -> [String: LocalHTTPAsset] {
        var assets: [String: LocalHTTPAsset] = [:]
        for (file, route, type) in [("index.html", "/", "text/html; charset=utf-8"),
                                  ("direct.js", "/direct.js", "text/javascript; charset=utf-8"),
                                  ("direct.css", "/direct.css", "text/css; charset=utf-8")] {
            guard let url = Bundle.main.url(forResource: file, withExtension: nil, subdirectory: "StandaloneWeb") else {
                throw DemoError.message("Receiver missing")
            }
            let data = try Data(contentsOf: url)
            guard !data.isEmpty, data.count <= 524_288 else { throw DemoError.message("Invalid receiver") }
            assets[route] = .init(data: data, contentType: type)
        }
        return assets
    }
}
