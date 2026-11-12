import SwiftUI
import UIKit
import DirectCore
import TeslaBLE

/// Foreground, user-started vehicle media reads. No audio or screen capture.
/// App-local vehicle key never enters the broadcast extension or web receiver.
@MainActor
final class DirectLyricsMode: ObservableObject {
    @Published var vin: String
    @Published private(set) var session: DirectBroadcastSession?
    @Published private(set) var status: DirectRuntimeStatus?
    @Published private(set) var music: LocalMusicState?
    @Published private(set) var preparing = false
    @Published private(set) var running = false
    @Published private(set) var stopping = false
    @Published private(set) var pairing = false
    @Published private(set) var message = "通过蓝牙读取 Tesla 正在播放的歌曲，不用麦克风。"
    var busy: Bool { preparing || running || stopping || pairing }
    private var normalizedVIN: String { vin.trimmingCharacters(in: .whitespacesAndNewlines).uppercased() }
    var validVIN: Bool { TeslaVehicleIdentity.isValidVIN(normalizedVIN) }

    private var generation = UUID()
    private var reader: NativeTeslaMediaClient?
    private var server: LocalHTTPServer?
    private var timer: Timer?
    private var clock = TeslaPlaybackClock()
    private var lyricClient: DirectLyricsClient?
    private var timeline: DirectLyricTimeline?
    private var lookupIdentity = ""
    private var lookupState = "waiting"
    private var lookupRevision = UUID()
    private var lookupPending = false
    private var nextLyricsLookupAt: Double = 0
    private var addresses: [DirectInterfaceAddress] = []
    private var actualPort: UInt16 = 0
    private var previousIdleTimer: Bool?

    init() { vin = UserDefaults.standard.string(forKey: "Cabin.TeslaVIN") ?? "" }

    private func rememberVIN() -> String {
        let value = normalizedVIN
        vin = value
        UserDefaults.standard.set(value, forKey: "Cabin.TeslaVIN")
        return value
    }

    private func makeReader(vin: String, ticket: UUID, enrollment: Bool) -> NativeTeslaMediaClient {
        // nil selects this app's default Keychain group, not shared storage.
        let store = TeslaKeyStore(accessGroup: nil, tag: "vehicle-monitor.\(vin)")
        return NativeTeslaMediaClient(vin: vin, keyStore: store, timeUnit: .milliseconds,
            allowEnrollment: enrollment,
            onStatus: { [weak self] value in
                Task { @MainActor [weak self] in
                    guard let self, self.generation == ticket, !self.stopping else { return }
                    self.handleReaderStatus(value)
                }
            }, onMedia: { [weak self] track in
                Task { @MainActor [weak self] in
                    guard let self, self.generation == ticket, self.running, !self.stopping else { return }
                    self.accept(track, ticket: ticket)
                }
            })
    }

    /// Sole enrollment entry. UI obtains a fresh, separate confirmation first.
    func pairTesla(consent: Bool) {
        guard consent, !busy, validVIN, UIApplication.shared.applicationState == .active,
              DirectSessionStore.status()?.isCurrent != true else { return }
        let value = rememberVIN()
        generation = UUID(); let ticket = generation
        pairing = true; message = "正在连接 Tesla，请准备车钥匙卡。"
        let client = makeReader(vin: value, ticket: ticket, enrollment: true)
        reader = client
        client.enrollMonitorKeyExplicitly()
    }

    func start(settings: DirectSettings, consent: Bool) {
        guard consent, !busy else { return }
        guard validVIN else { message = "请先填写车辆的 17 位 VIN 并完成 Tesla 配对。"; return }
        guard UIApplication.shared.applicationState == .active,
              DirectSessionStore.status()?.isCurrent != true else {
            message = "请回到 Cabin，并停止投屏后再开始歌词。"; return
        }
        addresses = DirectNetworkAddresses.current()
        guard !addresses.isEmpty else {
            message = "请先让车机连接手机热点，或连接同一 Wi-Fi。"; return
        }
        let value = rememberVIN()
        generation = UUID(); let ticket = generation
        preparing = true; message = "正在准备车机歌词…"
        do {
            var clean = settings
            clean.musicMode = .off; clean.networkLyricsAllowed = false
            clean.lyricMode = .mirror; clean = try clean.validated()
            let fresh = try DirectBroadcastSession.fresh(settings: clean)
            let service = LocalHTTPServer(configuration: .init(token: fresh.token,
                pairingCode: fresh.pairingCode, expiresAt: fresh.expiresAt,
                allowedIPv6Hosts: addresses.map(\.address).filter { DirectNetworkAddresses.localIPv6($0) }),
                assets: try receiverAssets())
            session = fresh; server = service; actualPort = 0
            clock.reset(); timeline = nil; lookupIdentity = ""; lookupState = "waiting"
            lyricClient = DirectLyricsClient()
            reader = makeReader(vin: value, ticket: ticket, enrollment: false)
            previousIdleTimer = UIApplication.shared.isIdleTimerDisabled
            UIApplication.shared.isIdleTimerDisabled = true
            preparing = false; running = true
            message = "正在连接 Tesla；请保持 Cabin 在前台。"
            service.start(port: clean.port, onReady: { [weak self] port in
                Task { @MainActor [weak self] in
                    guard let self, self.generation == ticket, self.running, !self.stopping else { return }
                    self.actualPort = port; self.reader?.startReading(); self.tick()
                }
            }, onFailure: { [weak self] _ in
                Task { @MainActor [weak self] in
                    guard let self, self.generation == ticket, !self.stopping else { return }
                    self.stop(reason: "车机连接未启动，请检查本地网络权限或端口是否被占用。")
                }
            })
            let heartbeat = Timer(timeInterval: 0.5, repeats: true) { [weak self] _ in
                Task { @MainActor [weak self] in self?.tick() }
            }
            timer = heartbeat; RunLoop.main.add(heartbeat, forMode: .common)
            publish()
        } catch { stop(reason: "歌词未能启动，请检查连接后重试。") }
    }

    private func handleReaderStatus(_ value: String) {
        switch value {
        case "connecting_for_explicit_monitor_enrollment", "sending_monitor_enrollment_request":
            message = "正在请求只读配对，请按车机提示使用钥匙卡确认。"
        case "enrollment_request_sent_confirm_with_nfc_and_vehicle_ui_not_yet_verified":
            generation = UUID(); reader?.stop(); reader = nil; pairing = false
            message = "配对请求已发送，请在车上确认。完成后点开始歌词验证连接。"
        case "connecting_read_only": message = "正在通过蓝牙连接 Tesla…"
        case "authenticating_infotainment", "authenticated_session_media_not_yet_verified":
            message = "正在等待车辆播放信息…"
        case "authenticated_media_received", "stopped": break
        default:
            let reason: String
            switch value {
            case "missing_or_unenrolled_key_explicit_enrollment_required": reason = "请先配对 Tesla，并在车上确认只读授权。"
            case "invalid_vin": reason = "VIN 格式不正确，请检查车辆设置中的 17 位 VIN。"
            case "keychain_unavailable_check_access_group_and_unlock": reason = "车辆配对密钥暂不可用，请解锁手机后重试。"
            case "bluetooth_unavailable_or_denied": reason = "蓝牙未开启或未允许 Cabin 使用蓝牙，请在系统设置中检查。"
            case "media_unavailable_no_assumed_values", "invalid_media_time": reason = "车辆暂未提供可用的歌曲或进度。不会改用麦克风，请播放歌曲后重试。"
            case "timeout_stopped_no_automatic_retry": reason = "连接 Tesla 超时，请靠近车辆并确认车机已唤醒后重试。"
            default: reason = "未能读取 Tesla 播放信息，请确认车辆支持此功能、只读配对已获准，再重试。"
            }
            stop(reason: reason)
        }
    }

    private func accept(_ track: TeslaMediaTrack, ticket: UUID) {
        let now = Date().timeIntervalSince1970
        guard clock.accept(track, at: now) else { publish(); return }
        let snapshot = clock.snapshot(at: now)
        if snapshot.identity != lookupIdentity {
            invalidateLookup()
            lookupIdentity = snapshot.identity; lookupState = "matched"
            if !snapshot.title.isEmpty, !snapshot.artist.isEmpty {
                lookupPending = true; lookupState = "loading"
            }
        }
        requestLyricsIfReady(ticket: ticket)
        message = snapshot.title.isEmpty ? "车辆暂未提供歌名。" :
            (snapshot.playing == false ? "播放已暂停，歌词保持在当前进度。" :
                snapshot.canScroll ? "正在跟随 Tesla 播放进度。" : "已读取曲目，等待车辆提供有效播放进度。")
        publish()
    }

    private func invalidateLookup() {
        lyricClient?.cancel(); timeline = nil; lookupIdentity = ""
        lookupRevision = UUID(); lookupPending = false; lookupState = "waiting"
    }

    /// Debounce rapid skips to the latest track. One request per stable identity;
    /// this is a deferred first lookup, not a retry loop after provider failure.
    private func requestLyricsIfReady(ticket: UUID) {
        guard lookupPending, running, !stopping, ProcessInfo.processInfo.systemUptime >= nextLyricsLookupAt else { return }
        let snapshot = clock.snapshot(at: Date().timeIntervalSince1970)
        guard !snapshot.stale, snapshot.identity == lookupIdentity,
              !snapshot.title.isEmpty, !snapshot.artist.isEmpty else { return }
        lookupPending = false; nextLyricsLookupAt = ProcessInfo.processInfo.systemUptime + 10
        let identity = lookupIdentity, revision = lookupRevision
        lyricClient?.lookup(title: snapshot.title, artist: snapshot.artist, duration: snapshot.duration) { [weak self] result in
            Task { @MainActor [weak self] in
                guard let self, self.generation == ticket, self.running, !self.stopping,
                      self.lookupRevision == revision, self.lookupIdentity == identity else { return }
                let current = self.clock.snapshot(at: Date().timeIntervalSince1970)
                guard !current.stale else {
                    // Invalidate immediately: a same-track BLE update can arrive
                    // before the next timer tick and otherwise leave loading stuck.
                    self.invalidateLookup(); self.publish(); return
                }
                guard current.identity == identity else { return }
                switch result {
                case .success(let lyrics): self.timeline = lyrics; self.lookupState = "lyrics"
                case .failure: self.timeline = nil; self.lookupState = "no-lyrics"
                }
                self.publish()
            }
        }
    }

    func onBackground() {
        if busy { stop(reason: "Cabin 已离开前台，歌词已停止。回到 App 后可重新开始。") }
    }

    func stop(reason: String = "歌词已停止，车辆蓝牙连接已关闭。") {
        guard !stopping, busy || server != nil || reader != nil else { return }
        generation = UUID(); let ticket = generation
        preparing = false; pairing = false; stopping = true
        timer?.invalidate(); timer = nil
        reader?.stop(); reader = nil
        lyricClient?.stop(); lyricClient = nil
        clock.reset(); invalidateLookup(); music = nil
        if let previousIdleTimer { UIApplication.shared.isIdleTimerDisabled = previousIdleTimer }
        previousIdleTimer = nil
        message = "正在停止歌词…"; status = nil
        server?.updateState(.init(captureState: "stopped", source: "tesla-ble-lyrics"))
        if let server {
            server.stop { [weak self] in
                Task { @MainActor [weak self] in self?.finishStop(ticket: ticket, reason: reason) }
            }
        } else { finishStop(ticket: ticket, reason: reason) }
    }

    private func finishStop(ticket: UUID, reason: String) {
        guard generation == ticket, stopping else { return }
        server = nil; session = nil; status = nil; addresses = []; actualPort = 0
        running = false; stopping = false; message = reason
    }

    private func tick() {
        guard running, !stopping, let session else { return }
        guard UIApplication.shared.applicationState != .background else { onBackground(); return }
        guard DirectSessionStore.status()?.isCurrent != true else { stop(reason: "已切换到系统投屏，歌词模式已停止。"); return }
        guard DirectNetworkAddresses.matches(initial: addresses, current: DirectNetworkAddresses.current()) else {
            stop(reason: "网络已变化，请重新开始歌词并使用新地址连接。"); return
        }
        guard Date().timeIntervalSince1970 < session.expiresAt else { stop(reason: "本次歌词会话已结束，请按需重新开始。"); return }
        requestLyricsIfReady(ticket: generation)
        publish()
    }

    private func publish() {
        guard running, !stopping, let session else { return }
        let now = Date().timeIntervalSince1970, snapshot = clock.snapshot(at: now)
        if snapshot.stale, !lookupIdentity.isEmpty {
            invalidateLookup()
            message = "等待新的车辆播放信息，旧歌词已隐藏。"
        }
        var value = LocalMusicState(status: "waiting", updatedAt: now, source: "tesla-ble")
        if !snapshot.stale, !snapshot.title.isEmpty {
            value.title = snapshot.title; value.artist = snapshot.artist
            value.matchedAt = snapshot.observedAt; value.position = snapshot.position
            value.status = snapshot.canScroll ? lookupState : "matched"
            if snapshot.canScroll, let position = snapshot.position, let timeline {
                let presentation = timeline.teslaPresentation(at: position)
                value.lines = presentation.lines; value.activeLineIndex = presentation.activeLineIndex
            }
            value.message = snapshot.playing == false ? "车辆暂停；进度不前移。" :
                snapshot.canScroll ? "进度来自车辆；采样间短暂估算，歌词版本仍可能不匹配。" : "车辆播放状态或进度缺失，不推测歌词滚动。"
        } else { value.message = "等待新鲜的车辆播放信息，旧歌词已隐藏。" }
        music = value
        server?.updateState(.init(captureState: "waiting", source: "tesla-ble-lyrics",
                                 message: "车辆蓝牙歌词；不使用麦克风或屏幕广播。", music: value))
        status = .init(sessionID: session.id, state: actualPort > 0 ? "waiting" : "starting",
            message: message, addresses: actualPort > 0 ? addresses.map(\.address) : [],
            port: actualPort, frames: 0, updatedAt: now)
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
