import Foundation

enum CaptureProfile: String, Codable, CaseIterable, Identifiable {
    case compatible, balanced, smooth

    var id: String { rawValue }
    var title: String {
        switch self {
        case .compatible: return "兼容"
        case .balanced: return "均衡"
        case .smooth: return "流畅"
        }
    }
    var maxFPS: Int32 { self == .smooth ? 30 : 15 }
    var maxLongEdge: Int { self == .compatible ? 960 : 1280 }
    var maxShortEdge: Int { self == .compatible ? 540 : 720 }
    var summary: String { "最高 \(maxLongEdge) × \(maxShortEdge) · \(maxFPS) fps" }
    var maxBitrateBps: Int {
        switch self {
        case .compatible: return 1_000_000
        case .balanced: return 1_800_000
        case .smooth: return 3_000_000
        }
    }

    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer().decode(String.self)
        self = Self(rawValue: value) ?? .balanced
    }

    /// Preserve source aspect ratio in either orientation; never upscale or crop.
    /// Even dimensions are required by common video encoders.
    func outputSize(width: Double, height: Double) -> (width: Int32, height: Int32)? {
        guard width.isFinite, height.isFinite, width >= 2, height >= 2 else { return nil }
        let scale = min(1, min(Double(maxLongEdge) / max(width, height),
                               Double(maxShortEdge) / min(width, height)))
        return (Int32(max(2, floor(width * scale / 2) * 2)),
                Int32(max(2, floor(height * scale / 2) * 2)))
    }
}

enum ReceiverLayout: String, Codable, CaseIterable, Identifiable {
    case split, mirror, lyrics
    var id: String { rawValue }
    var title: String {
        switch self {
        case .split: return "画面与歌词"
        case .mirror: return "仅画面"
        case .lyrics: return "仅歌词"
        }
    }
    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer().decode(String.self)
        self = Self(rawValue: value) ?? .split
    }
}

struct ICEConfiguration: Codable {
    let urls: [String]
    let username: String?
    let credential: String?
}

struct ServerConfiguration: Decodable {
    let iceServers: [ICEConfiguration]
}

struct RoomResponse: Decodable {
    let roomId: String
    let publisherToken: String
    let viewerToken: String
    let metadataToken: String?
    let expiresAt: Double
}

struct SessionConfiguration: Codable {
    let baseURL: URL
    let roomId: String
    let publisherToken: String
    let viewerToken: String
    let metadataToken: String?
    let expiresAt: Double
    let iceServers: [ICEConfiguration]
    var captureProfile: CaptureProfile
    var receiverLayout: ReceiverLayout

    enum CodingKeys: String, CodingKey {
        case baseURL, roomId, publisherToken, viewerToken, metadataToken, expiresAt, iceServers, captureProfile, receiverLayout
    }

    init(baseURL: URL, roomId: String, publisherToken: String, viewerToken: String,
         expiresAt: Double, iceServers: [ICEConfiguration],
         captureProfile: CaptureProfile = .balanced, receiverLayout: ReceiverLayout = .split,
         metadataToken: String? = nil) {
        self.baseURL = baseURL
        self.roomId = roomId
        self.publisherToken = publisherToken
        self.viewerToken = viewerToken
        self.metadataToken = metadataToken
        self.expiresAt = expiresAt
        self.iceServers = iceServers
        self.captureProfile = captureProfile
        self.receiverLayout = receiverLayout
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        baseURL = try values.decode(URL.self, forKey: .baseURL)
        roomId = try values.decode(String.self, forKey: .roomId)
        publisherToken = try values.decode(String.self, forKey: .publisherToken)
        viewerToken = try values.decode(String.self, forKey: .viewerToken)
        metadataToken = try values.decodeIfPresent(String.self, forKey: .metadataToken)
        expiresAt = try values.decode(Double.self, forKey: .expiresAt)
        iceServers = try values.decode([ICEConfiguration].self, forKey: .iceServers)
        captureProfile = try values.decodeIfPresent(CaptureProfile.self, forKey: .captureProfile) ?? .balanced
        receiverLayout = try values.decodeIfPresent(ReceiverLayout.self, forKey: .receiverLayout) ?? .split
    }
    var isExpired: Bool { Date().timeIntervalSince1970 * 1000 >= expiresAt }

    var receiverURL: URL? { receiverURL(layout: receiverLayout) }
    var lyricsURL: URL? { receiverURL(layout: .lyrics) }

    func canReuse(for server: URL, now: Date = Date()) -> Bool {
        baseURL == server && now.timeIntervalSince1970 * 1000 < expiresAt
    }

    func receiverURL(layout: ReceiverLayout) -> URL? {
        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)
        components?.path = "/"
        components?.queryItems = [URLQueryItem(name: "mode", value: "receiver"),
                                  URLQueryItem(name: "view", value: layout.rawValue)]
        var fragment = URLComponents()
        fragment.queryItems = [URLQueryItem(name: "room", value: roomId),
                               URLQueryItem(name: "token", value: viewerToken)]
        components?.percentEncodedFragment = fragment.percentEncodedQuery
        return components?.url
    }

    var signalingURL: URL? {
        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)
        components?.scheme = baseURL.scheme == "https" ? "wss" : "ws"
        components?.path = "/signal"
        components?.queryItems = [URLQueryItem(name: "room", value: roomId),
                                 URLQueryItem(name: "role", value: "publisher"),
                                 URLQueryItem(name: "token", value: publisherToken)]
        return components?.url
    }

    static func validateServer(_ input: String) throws -> URL {
        guard var parts = URLComponents(string: input.trimmingCharacters(in: .whitespacesAndNewlines)),
              let host = parts.host?.lowercased(), parts.user == nil, parts.password == nil,
              parts.query == nil, parts.fragment == nil,
              parts.path.isEmpty || parts.path == "/",
              parts.scheme == "https" || parts.scheme == "http" else {
            throw DemoError.message("请输入完整服务地址，例如 https://demo.example.com，不含路径或账号。")
        }
        if parts.scheme == "http" {
            let components = host.split(separator: ".", omittingEmptySubsequences: false)
            let numericComponents = components.count == 4 && components.allSatisfy {
                !$0.isEmpty && $0.utf8.allSatisfy { (48...57).contains($0) }
            }
            let octets = components.compactMap { Int($0) }
            let privateIPv4 = numericComponents && octets.count == 4 && octets.allSatisfy { (0...255).contains($0) } &&
                (octets[0] == 10 || (octets[0] == 192 && octets[1] == 168) ||
                 (octets[0] == 172 && (16...31).contains(octets[1])))
            guard privateIPv4 || host.hasSuffix(".local") else {
                throw DemoError.message("HTTP 只允许局域网 IP 或 .local 主机名。公网服务必须使用 HTTPS；localhost 指向手机自身。")
            }
        }
        parts.path = ""
        guard let url = parts.url else { throw DemoError.message("服务地址无效。") }
        return url
    }
}

enum DemoError: LocalizedError {
    case message(String)
    var errorDescription: String? {
        if case let .message(message) = self { return message }
        return nil
    }
}

struct BroadcastStatus: Codable {
    let message: String
    let active: Bool
    let updatedAt: Double
    var isActive: Bool { active && Date().timeIntervalSince1970 - updatedAt < 8 }
}

#if os(iOS)
enum SharedSession {
    private static func file(_ name: String) throws -> URL {
        guard let group = Bundle.main.object(forInfoDictionaryKey: "TCAppGroupIdentifier") as? String,
              let root = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) else {
            throw DemoError.message("App Group 未配置。请检查两个 target 的签名、App Group 和团队设置。")
        }
        return root.appendingPathComponent(name)
    }

    static func save(_ session: SessionConfiguration) throws {
        let url = try file("session.json")
        try JSONEncoder().encode(session).write(to: url, options: .atomic)
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
                                             ofItemAtPath: url.path)
    }

    static func load() throws -> SessionConfiguration {
        try JSONDecoder().decode(SessionConfiguration.self, from: Data(contentsOf: file("session.json")))
    }

    static func status() -> BroadcastStatus? {
        guard let url = try? file("status.json"), let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(BroadcastStatus.self, from: data)
    }

    static func setStatus(_ message: String, active: Bool) {
        let status = BroadcastStatus(message: message, active: active, updatedAt: Date().timeIntervalSince1970)
        guard let url = try? file("status.json"), let data = try? JSONEncoder().encode(status) else { return }
        try? data.write(to: url, options: .atomic)
    }
}
#endif
