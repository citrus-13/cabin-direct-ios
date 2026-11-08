import Foundation
import CoreFoundation
import Security
#if canImport(Darwin)
import Darwin
#endif

/// Resolve only this app's known installer metadata. Metadata is not authorization:
/// the OS must still grant container access and validate both signed products.
enum DirectInstallationIdentifiers {
    static func hasResolver(_ info: [String: Any]) -> Bool {
        guard let value = info["TCInstallerIdentifierResolutionVersion"] as? NSNumber,
              CFGetTypeID(value) != CFBooleanGetTypeID() else { return false }
        return value == NSNumber(value: 1)
    }
    static func valid(_ value: String) -> Bool {
        let parts = value.split(separator: ".", omittingEmptySubsequences: false)
        return value.utf8.count <= 255 && parts.count >= 2 && parts.allSatisfy { part in
            !part.isEmpty && part.utf8.allSatisfy { (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0) || $0 == 45 }
        }
    }

    static func appGroup(info: [String: Any]) -> String? {
        guard let requested = info["TCAppGroupIdentifier"] as? String,
              valid(requested), requested.hasPrefix("group.") else { return nil }
        guard let raw = info["ALTAppGroups"] else { return requested }
        // AltStore/SideStore inject an array of final groups, not an old→new map.
        guard hasResolver(info),
              let groups = raw as? [String], !groups.isEmpty, groups.count <= 32,
              groups.allSatisfy({ valid($0) && $0.hasPrefix("group.") }) else { return nil }
        let candidates = groups.filter { group in
            if group == requested { return true }
            guard group.hasPrefix(requested + ".") else { return false }
            let suffix = group.dropFirst(requested.count + 1)
            return suffix.utf8.count == 10 && suffix.utf8.allSatisfy { (48...57).contains($0) || (65...90).contains($0) }
        }
        return candidates.count == 1 ? candidates[0] : nil
    }

    static func broadcastExtension(host: [String: Any], embedded: [String: Any]) -> String? {
        guard let hostID = host["CFBundleIdentifier"] as? String, valid(hostID),
              let actual = embedded["CFBundleIdentifier"] as? String, valid(actual), actual.hasPrefix(hostID + "."),
              let requested = host["TCBroadcastExtensionIdentifier"] as? String, valid(requested),
              let point = embedded["NSExtension"] as? [String: Any],
              point["NSExtensionPointIdentifier"] as? String == "com.apple.broadcast-services-upload",
              point["RPBroadcastProcessMode"] as? String == "RPBroadcastProcessModeSampleBuffer",
              point["NSExtensionPrincipalClass"] as? String == "DirectBroadcastExtension.DirectSampleHandler" else { return nil }
        if requested == actual { return actual }
        guard hasResolver(host), hasResolver(embedded),
              let originalHost = host["ALTBundleIdentifier"] as? String, valid(originalHost),
              requested == originalHost + ".broadcast",
              embedded["ALTBundleIdentifier"] as? String == requested else { return nil }
        return actual
    }

    static func bundledBroadcastExtension(in bundle: Bundle = .main) -> String? {
        guard let plugins = bundle.builtInPlugInsURL,
              let embedded = Bundle(url: plugins.appendingPathComponent("DirectBroadcastExtension.appex", isDirectory: true)),
              let hostInfo = bundle.infoDictionary, let extensionInfo = embedded.infoDictionary else { return nil }
        return broadcastExtension(host: hostInfo, embedded: extensionInfo)
    }
}

enum DirectLyricMode: String, Codable, CaseIterable, Identifiable {
    case mirror, visibleText
    var id: String { rawValue }
    var title: String {
        switch self {
        case .mirror: return "共享屏幕"
        case .visibleText: return "共享屏幕与可见文字（设备端识别）"
        }
    }

    init(from decoder: Decoder) throws {
        // Older experimental vehicle modes must never silently re-enable vehicle access.
        let value = try decoder.singleValueContainer().decode(String.self)
        self = Self(rawValue: value) ?? .mirror
    }
}

enum DirectMusicMode: String, Codable, CaseIterable, Identifiable {
    case off, appAudio, manual
    var id: String { rawValue }
    var title: String {
        switch self {
        case .off: return "关闭识曲与网络歌词"
        case .appAudio: return "尝试自动识曲（ShazamKit，实验性）"
        case .manual: return "使用手动 / 快捷指令提供的曲目"
        }
    }
    init(from decoder: Decoder) throws {
        self = Self(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .off
    }
}

/// An external URL may fill a draft, never grant network/capture consent or start a session.
struct DirectTrackImport {
    let title: String
    let artist: String
    let position: Double
    static func parse(_ url: URL) -> Self? {
        guard url.absoluteString.utf8.count <= 4096,
              let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.scheme == "cabin-direct", parts.host == "track", parts.port == nil,
              parts.user == nil, parts.password == nil, parts.fragment == nil,
              parts.path.isEmpty || parts.path == "/" else { return nil }
        let items = parts.queryItems ?? []
        guard items.count >= 2, items.count <= 3,
              Set(items.map(\.name)).count == items.count,
              items.allSatisfy({ ["title", "artist", "position"].contains($0.name) }) else { return nil }
        let values = Dictionary(uniqueKeysWithValues: items.map { ($0.name, $0.value ?? "") })
        let title = (values["title"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let artist = (values["artist"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard validText(title), validText(artist),
              let position = Double(values["position"] ?? "0"), position.isFinite,
              position >= 0, position <= 86_400 else { return nil }
        return .init(title: title, artist: artist, position: position)
    }
    static func validText(_ text: String) -> Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && text.count <= 200 &&
            !text.unicodeScalars.contains { CharacterSet.controlCharacters.contains($0) }
    }
}

struct DirectSettings: Codable, Equatable {
    var lyricMode: DirectLyricMode = .mirror
    var musicMode: DirectMusicMode = .off
    var networkLyricsAllowed = false
    var musicTitle = ""
    var musicArtist = ""
    var musicPosition: Double = 0
    // Coordinates refer to the displayed, oriented image; origin is top-left.
    var regionX: Double = 0.05
    var regionY: Double = 0.20
    var regionWidth: Double = 0.90
    var regionHeight: Double = 0.65
    var port: UInt16 = 8787

    init() {}

    private enum CodingKeys: String, CodingKey {
        case lyricMode, musicMode, networkLyricsAllowed, musicTitle, musicArtist, musicPosition
        case regionX, regionY, regionWidth, regionHeight, port
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        lyricMode = try values.decodeIfPresent(DirectLyricMode.self, forKey: .lyricMode) ?? .mirror
        musicMode = try values.decodeIfPresent(DirectMusicMode.self, forKey: .musicMode) ?? .off
        networkLyricsAllowed = try values.decodeIfPresent(Bool.self, forKey: .networkLyricsAllowed) ?? false
        musicTitle = try values.decodeIfPresent(String.self, forKey: .musicTitle) ?? ""
        musicArtist = try values.decodeIfPresent(String.self, forKey: .musicArtist) ?? ""
        musicPosition = try values.decodeIfPresent(Double.self, forKey: .musicPosition) ?? 0
        regionX = try values.decodeIfPresent(Double.self, forKey: .regionX) ?? 0.05
        regionY = try values.decodeIfPresent(Double.self, forKey: .regionY) ?? 0.20
        regionWidth = try values.decodeIfPresent(Double.self, forKey: .regionWidth) ?? 0.90
        regionHeight = try values.decodeIfPresent(Double.self, forKey: .regionHeight) ?? 0.65
        port = try values.decodeIfPresent(UInt16.self, forKey: .port) ?? 8787
    }

    func validated() throws -> DirectSettings {
        guard musicTitle.count <= 200, musicArtist.count <= 200,
              musicPosition.isFinite, musicPosition >= 0, musicPosition <= 86_400,
              musicMode != .manual || (DirectTrackImport.validText(musicTitle) && DirectTrackImport.validText(musicArtist)) else {
            throw DemoError.message("手动曲目需要有效的歌名、歌手和估算起始秒数。")
        }
        guard port >= 1024,
              [regionX, regionY, regionWidth, regionHeight].allSatisfy({ $0.isFinite }),
              regionX >= 0, regionY >= 0, regionWidth >= 0.05, regionHeight >= 0.05,
              regionX + regionWidth <= 1.000001, regionY + regionHeight <= 1.000001 else {
            throw DemoError.message("端口或文字识别区域无效。")
        }
        return self
    }
}

/// A local, session-bound user stop request. It is never accepted from the network.
struct DirectStopRequest: Codable {
    let sessionID: String
    let requestedAt: Double

    func matches(_ session: DirectBroadcastSession, now: Double = Date().timeIntervalSince1970) -> Bool {
        requestedAt.isFinite && now.isFinite && session.createdAt.isFinite && session.expiresAt.isFinite &&
            sessionID == session.id && now < session.expiresAt && requestedAt >= session.createdAt &&
            requestedAt <= now + 2 && now - requestedAt <= 30
    }
}

struct DirectBroadcastSession: Codable {
    let id: String
    let token: String
    let pairingCode: String
    let createdAt: Double
    let expiresAt: Double
    let settings: DirectSettings

    static func fresh(settings: DirectSettings, now: Double = Date().timeIntervalSince1970) throws -> Self {
        let settings = try settings.validated()
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
            throw DemoError.message("系统安全随机数不可用。")
        }
        let token = Data(bytes).base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        // SystemRandomNumberGenerator uses the platform CSPRNG, with unbiased bounded sampling.
        let code = String(format: "%06d", Int.random(in: 0...999_999))
        return Self(id: UUID().uuidString, token: token, pairingCode: code,
                    createdAt: now, expiresAt: now + 8 * 3600, settings: settings)
    }
}

struct DirectRuntimeStatus: Codable {
    let sessionID: String
    let state: String
    let message: String
    let addresses: [String]
    let port: UInt16
    let frames: UInt64
    let updatedAt: Double
    var isCurrent: Bool {
        let age = Date().timeIntervalSince1970 - updatedAt
        return age >= -2 && age < 8 && ["starting", "waiting", "broadcasting", "paused", "stale"].contains(state)
    }
}

/// Rejects results captured before the latest pause/resume boundary, even if their callbacks were already queued.
struct DirectObservationGate {
    private(set) var acceptedAfter: Double
    mutating func advance(to now: Double) { acceptedAfter = max(acceptedAfter, now) }
    func accepts(_ timestamp: Double) -> Bool { timestamp.isFinite && timestamp >= acceptedAfter }
}

struct DirectInterfaceAddress: Hashable {
    let interface: String
    let address: String
}

enum DirectNetworkAddresses {
    static func matches(initial: [DirectInterfaceAddress], current: [DirectInterfaceAddress]) -> Bool {
        !initial.isEmpty && Set(initial) == Set(current)
    }
    static func privateIPv4(_ value: String) -> Bool {
        let parts = value.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 4, parts.allSatisfy({ !$0.isEmpty && $0.utf8.allSatisfy { (48...57).contains($0) } }) else { return false }
        let numbers = parts.compactMap { Int($0) }
        guard numbers.count == 4, numbers.allSatisfy({ (0...255).contains($0) }) else { return false }
        return numbers[0] == 10 || (numbers[0] == 192 && numbers[1] == 168) ||
            (numbers[0] == 172 && (16...31).contains(numbers[1]))
    }

    /// Unscoped local-interface unicast addresses usable as a browser URL. Link-local
    /// IPv6 requires a receiving-device scope, so it is deliberately not advertised.
    static func localIPv6(_ value: String) -> Bool {
        #if canImport(Darwin)
        guard !value.contains("%"), value.utf8.count <= 45 else { return false }
        var address = in6_addr()
        guard inet_pton(AF_INET6, value, &address) == 1 else { return false }
        let bytes = withUnsafeBytes(of: address) { Array($0) }
        return bytes[0] & 0xfe == 0xfc || bytes[0] & 0xe0 == 0x20
        #else
        return false
        #endif
    }

    static func url(address: String, port: UInt16) -> String? {
        guard port >= 1024 else { return nil }
        if privateIPv4(address) { return "http://\(address):\(port)" }
        if localIPv6(address) { return "http://[\(address)]:\(port)" }
        return nil
    }

    static func urls(addresses: [String], port: UInt16) -> [String] {
        Array(Set(addresses.compactMap { url(address: $0, port: port) })).sorted()
    }

    static func urls(port: UInt16) -> [String] { urls(addresses: current().map(\.address), port: port) }

    static func current() -> [DirectInterfaceAddress] {
        #if canImport(Darwin)
        var root: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&root) == 0, let first = root else { return [] }
        defer { freeifaddrs(root) }
        var result: [DirectInterfaceAddress] = []
        var pointer: UnsafeMutablePointer<ifaddrs>? = first
        while let item = pointer {
            defer { pointer = item.pointee.ifa_next }
            let name = String(cString: item.pointee.ifa_name)
            guard let address = item.pointee.ifa_addr,
                  [UInt8(AF_INET), UInt8(AF_INET6)].contains(address.pointee.sa_family),
                  item.pointee.ifa_flags & UInt32(IFF_UP) != 0,
                  item.pointee.ifa_flags & UInt32(IFF_LOOPBACK) == 0,
                  !name.hasPrefix("utun"), !name.hasPrefix("pdp_ip"), !name.hasPrefix("lo") else { continue }
            var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            guard getnameinfo(address, socklen_t(address.pointee.sa_len), &host, socklen_t(host.count),
                              nil, 0, NI_NUMERICHOST) == 0 else { continue }
            let value = String(cString: host)
            if (privateIPv4(value) || localIPv6(value)), !result.contains(where: { $0.address == value }), result.count < 16 {
                result.append(.init(interface: name, address: value))
            }
        }
        return result.sorted { $0.interface < $1.interface }
        #else
        return []
        #endif
    }
}

#if os(iOS) || DIRECT_SESSION_STORE_TEST
enum DirectSessionStore {
    #if DIRECT_SESSION_STORE_TEST
    static var testContainer: URL?
    static var beforeFinishForTesting: (() -> Void)?
    #endif
    private static func file(_ name: String) throws -> URL {
        #if DIRECT_SESSION_STORE_TEST
        guard let root = testContainer else { throw DemoError.message("Missing test-only container") }
        #else
        guard let group = DirectInstallationIdentifiers.appGroup(info: Bundle.main.infoDictionary ?? [:]),
              let root = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) else {
            throw DemoError.message("独立版 App Group 不可用。需要为应用与扩展配置相同签名能力。")
        }
        #endif
        return root.appendingPathComponent(name)
    }

    /// All session/status mutations share an OS lock across app and extension processes.
    /// JSON writes are atomic; compare/delete and terminal status updates occur under
    /// the same lock, so late cleanup cannot delete or overwrite a newer session.
    private static func withSessionLock<T>(_ body: () throws -> T) throws -> T {
        let location = try file("direct-session.lock")
        let descriptor = Darwin.open(location.path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
        guard descriptor >= 0 else { throw DemoError.message("无法打开共享会话锁。") }
        defer { Darwin.close(descriptor) }
        guard flock(descriptor, LOCK_EX) == 0 else { throw DemoError.message("无法锁定共享会话。") }
        defer { flock(descriptor, LOCK_UN) }
        return try body()
    }

    private static func save<T: Encodable>(_ value: T, name: String) throws {
        let url = try file(name)
        try JSONEncoder().encode(value).write(to: url, options: .atomic)
        var attributes: [FileAttributeKey: Any] = [.posixPermissions: 0o600]
        #if os(iOS)
        attributes[.protectionKey] = FileProtectionType.completeUntilFirstUserAuthentication
        #endif
        try FileManager.default.setAttributes(attributes, ofItemAtPath: url.path)
    }

    private static func load<T: Decodable>(_ type: T.Type, name: String) throws -> T {
        let data = try Data(contentsOf: file(name), options: .mappedIfSafe)
        guard data.count < 16_384 else { throw DemoError.message("共享配置超过上限。") }
        return try JSONDecoder().decode(type, from: data)
    }

    static func saveSettings(_ settings: DirectSettings) throws {
        try save(settings.validated(), name: "direct-settings.json")
    }
    static func settings() throws -> DirectSettings {
        try load(DirectSettings.self, name: "direct-settings.json").validated()
    }
    static func saveSession(_ value: DirectBroadcastSession) throws {
        try withSessionLock {
            try save(value, name: "direct-session.json")
            try save(DirectRuntimeStatus(sessionID: value.id, state: "starting", message: "正在启动用户请求的系统广播。",
                addresses: [], port: 0, frames: 0, updatedAt: Date().timeIntervalSince1970), name: "direct-status.json")
        }
    }
    static func session() -> DirectBroadcastSession? {
        try? withSessionLock { try load(DirectBroadcastSession.self, name: "direct-session.json") }
    }
    static func status() -> DirectRuntimeStatus? {
        try? withSessionLock { try load(DirectRuntimeStatus.self, name: "direct-status.json") }
    }
    static func setStatus(_ value: DirectRuntimeStatus) {
        try? withSessionLock {
            guard (try? load(DirectBroadcastSession.self, name: "direct-session.json"))?.id == value.sessionID else { return }
            try save(value, name: "direct-status.json")
        }
    }
    static func requestStop(sessionID: String) throws {
        try withSessionLock {
            guard let session = try? load(DirectBroadcastSession.self, name: "direct-session.json"), session.id == sessionID,
                  let current = try? load(DirectRuntimeStatus.self, name: "direct-status.json"),
                  current.sessionID == sessionID, current.isCurrent else {
                throw DemoError.message("没有匹配的在线广播。请检查系统录屏状态，不会结束旧会话或其他会话。")
            }
            try save(DirectStopRequest(sessionID: sessionID, requestedAt: Date().timeIntervalSince1970),
                     name: "direct-stop-request.json")
        }
    }
    static func stopRequested(for session: DirectBroadcastSession) -> Bool {
        (try? load(DirectStopRequest.self, name: "direct-stop-request.json").matches(session)) == true
    }
    static func finishSession(matching id: String, message: String, frames: UInt64) {
        try? withSessionLock {
            guard (try? load(DirectBroadcastSession.self, name: "direct-session.json"))?.id == id else { return }
            #if DIRECT_SESSION_STORE_TEST
            beforeFinishForTesting?()
            #endif
            try save(DirectRuntimeStatus(sessionID: id, state: "stopped", message: message, addresses: [],
                port: 0, frames: frames, updatedAt: Date().timeIntervalSince1970), name: "direct-status.json")
            // Only this product's ephemeral credentials; settings and prior evidence are untouched.
            try FileManager.default.removeItem(at: file("direct-session.json"))
        }
    }
}
#endif
