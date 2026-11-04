import Foundation
import Security
#if canImport(Darwin)
import Darwin
#endif

enum DirectLyricMode: String, Codable, CaseIterable, Identifiable {
    case mirror, visibleText, teslaMedia
    var id: String { rawValue }
    var title: String {
        switch self {
        case .mirror: return "仅投屏（保留音乐 App 歌词）"
        case .visibleText: return "可见歌词文字识别（设备端）"
        case .teslaMedia: return "Tesla 蓝牙歌曲信息（待实车验证）"
        }
    }
}

struct DirectSettings: Codable, Equatable {
    var lyricMode: DirectLyricMode = .mirror
    // Coordinates refer to the displayed, oriented image; origin is top-left.
    var regionX: Double = 0.05
    var regionY: Double = 0.20
    var regionWidth: Double = 0.90
    var regionHeight: Double = 0.65
    var vin: String = ""
    var mediaTimeUnit: String = "unconfirmed"
    var onlineLyrics: Bool = false
    var port: UInt16 = 8787

    func validated() throws -> DirectSettings {
        guard port >= 1024,
              [regionX, regionY, regionWidth, regionHeight].allSatisfy({ $0.isFinite }),
              regionX >= 0, regionY >= 0, regionWidth >= 0.05, regionHeight >= 0.05,
              regionX + regionWidth <= 1.000001, regionY + regionHeight <= 1.000001 else {
            throw DemoError.message("端口或文字识别区域无效。")
        }
        var result = self
        result.vin = vin.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        if lyricMode == .teslaMedia {
            guard Self.validVIN(result.vin) else { throw DemoError.message("车辆模式需要 17 位 VIN（不含 I、O、Q）。") }
            guard ["milliseconds", "seconds"].contains(mediaTimeUnit) else {
                throw DemoError.message("先通过实车读数确认媒体时间单位；不能猜测毫秒或秒。")
            }
        }
        return result
    }

    static func validVIN(_ value: String) -> Bool {
        value.utf8.count == 17 && value.utf8.allSatisfy {
            (48...57).contains($0) || ((65...90).contains($0) && ![73, 79, 81].contains($0))
        }
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

struct DirectInterfaceAddress: Equatable {
    let interface: String
    let address: String
}

enum DirectNetworkAddresses {
    static func privateIPv4(_ value: String) -> Bool {
        let parts = value.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 4, parts.allSatisfy({ !$0.isEmpty && $0.utf8.allSatisfy { (48...57).contains($0) } }) else { return false }
        let numbers = parts.compactMap { Int($0) }
        guard numbers.count == 4, numbers.allSatisfy({ (0...255).contains($0) }) else { return false }
        return numbers[0] == 10 || (numbers[0] == 192 && numbers[1] == 168) ||
            (numbers[0] == 172 && (16...31).contains(numbers[1]))
    }

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
            guard let address = item.pointee.ifa_addr, address.pointee.sa_family == UInt8(AF_INET),
                  item.pointee.ifa_flags & UInt32(IFF_UP) != 0,
                  !name.hasPrefix("utun"), !name.hasPrefix("pdp_ip"), !name.hasPrefix("lo") else { continue }
            var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            guard getnameinfo(address, socklen_t(address.pointee.sa_len), &host, socklen_t(host.count),
                              nil, 0, NI_NUMERICHOST) == 0 else { continue }
            let value = String(cString: host)
            if privateIPv4(value), !result.contains(where: { $0.address == value }) {
                result.append(.init(interface: name, address: value))
            }
        }
        return result.sorted { $0.interface < $1.interface }
        #else
        return []
        #endif
    }
}

#if os(iOS)
enum DirectSessionStore {
    private static func file(_ name: String) throws -> URL {
        guard let group = Bundle.main.object(forInfoDictionaryKey: "TCAppGroupIdentifier") as? String,
              let root = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) else {
            throw DemoError.message("独立版 App Group 不可用。需要为应用与扩展配置相同签名能力。")
        }
        return root.appendingPathComponent(name)
    }

    private static func save<T: Encodable>(_ value: T, name: String) throws {
        let url = try file(name)
        try JSONEncoder().encode(value).write(to: url, options: .atomic)
        try FileManager.default.setAttributes([
            .protectionKey: FileProtectionType.completeUntilFirstUserAuthentication,
            .posixPermissions: 0o600
        ], ofItemAtPath: url.path)
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
    static func saveSession(_ value: DirectBroadcastSession) throws { try save(value, name: "direct-session.json") }
    static func session() -> DirectBroadcastSession? { try? load(DirectBroadcastSession.self, name: "direct-session.json") }
    static func status() -> DirectRuntimeStatus? { try? load(DirectRuntimeStatus.self, name: "direct-status.json") }
    static func setStatus(_ value: DirectRuntimeStatus) { try? save(value, name: "direct-status.json") }
    static func invalidateSession(matching id: String) {
        // Only this product's ephemeral credential file; never clear Keychain or user settings.
        guard session()?.id == id else { return }
        if let url = try? file("direct-session.json") { try? FileManager.default.removeItem(at: url) }
    }
}
#endif
