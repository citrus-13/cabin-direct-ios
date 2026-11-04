import Foundation
import Network
import Darwin

public struct LocalServerConfiguration {
    public let token: String
    public let pairingCode: String
    public let expiresAt: Double
    public let pairingWindow: Double
    public init(token: String, pairingCode: String, expiresAt: Double, pairingWindow: Double = 120) {
        self.token = token; self.pairingCode = pairingCode; self.expiresAt = expiresAt
        self.pairingWindow = min(120, max(0, pairingWindow))
    }
}
public struct LocalHTTPAsset {
    public let data: Data
    public let contentType: String
    public init(data: Data, contentType: String) { self.data = data; self.contentType = contentType }
}
public struct LocalJPEGFrame {
    public let data: Data
    public let sequence: UInt64
    public let updatedAt: Double
    public let width: Int
    public let height: Int
    public init(data: Data, sequence: UInt64, updatedAt: Double, width: Int, height: Int) {
        self.data = data; self.sequence = sequence; self.updatedAt = updatedAt; self.width = width; self.height = height
    }
}
public struct LocalPublicState: Codable {
    public var captureState: String
    public var sequence: UInt64
    public var frameUpdatedAt: Double
    public var width: Int
    public var height: Int
    public var lyricState: String
    public var lyricLines: [String]
    public var lyricUpdatedAt: Double
    public var source: String
    public var message: String
    public init(captureState: String = "waiting", sequence: UInt64 = 0, frameUpdatedAt: Double = 0, width: Int = 0, height: Int = 0, lyricState: String = "disabled", lyricLines: [String] = [], lyricUpdatedAt: Double = 0, source: String = "visible-screen", message: String = "") {
        self.captureState = captureState; self.sequence = sequence; self.frameUpdatedAt = frameUpdatedAt
        self.width = width; self.height = height; self.lyricState = lyricState; self.lyricLines = lyricLines
        self.lyricUpdatedAt = lyricUpdatedAt; self.source = source; self.message = message
    }
}

/// Single-request HTTP/1.1 service. Memory is bounded independently of network speed:
/// one latest JPEG, <=8 clients, <=2 streams and one outstanding send per client.
public final class LocalHTTPServer {
    private final class Client {
        let id = UUID()
        let connection: NWConnection
        var input = Data()
        let opened: Double
        var streaming = false
        var sending = false
        var sendStarted: Double = 0
        var lastSequence: UInt64?
        init(_ connection: NWConnection, opened: Double) { self.connection = connection; self.opened = opened }
    }
    private let configuration: LocalServerConfiguration
    private let assets: [String: LocalHTTPAsset]
    private let now: () -> Double
    private let bindToLoopback: Bool
    private let queue = DispatchQueue(label: "CabinDirect.LocalHTTPServer")
    private var listener: NWListener?
    private var timer: DispatchSourceTimer?
    private var clients: [UUID: Client] = [:]
    private var frame: LocalJPEGFrame?
    private let pendingFrameLock = NSLock()
    private var pendingFrame: LocalJPEGFrame?
    private var frameDrainScheduled = false
    private var state = LocalPublicState()
    private var startedAt: Double = 0
    private var wrongAttempts = 0
    private var running = false
    private static let maxFrame = 1_048_576
    private static let maxHeader = 8_192
    public static let staleAfter: Double = 4

    public init(configuration: LocalServerConfiguration, assets: [String: LocalHTTPAsset], now: @escaping () -> Double = { Date().timeIntervalSince1970 }, bindToLoopback: Bool = false) {
        self.configuration = configuration; self.now = now; self.bindToLoopback = bindToLoopback
        self.assets = assets.filter { ["/", "/direct.js", "/direct.css"].contains($0.key) && $0.value.data.count <= 524_288 && !$0.value.contentType.contains("\r") && !$0.value.contentType.contains("\n") }
    }
    public func start(port: UInt16, onReady: @escaping (UInt16) -> Void, onFailure: @escaping (Error) -> Void) {
        queue.async {
            guard !self.running else { onFailure(self.error("Already started")); return }
            let token = Array(self.configuration.token.utf8)
            guard token.count == 43, token.allSatisfy({ (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) || $0 == 45 || $0 == 95 }), self.configuration.pairingCode.utf8.count == 6, self.configuration.pairingCode.utf8.allSatisfy({ (48...57).contains($0) }), self.configuration.expiresAt.isFinite, self.now() < self.configuration.expiresAt else { onFailure(self.error("Invalid or expired configuration")); return }
            do {
                let parameters = NWParameters.tcp
                parameters.allowLocalEndpointReuse = true
                if self.bindToLoopback { parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: port)!) }
                let listener = try self.bindToLoopback ? NWListener(using: parameters) : NWListener(using: parameters, on: NWEndpoint.Port(rawValue: port)!)
                self.listener = listener; self.startedAt = self.now(); self.wrongAttempts = 0; self.running = true
                listener.newConnectionHandler = { [weak self] in self?.accept($0) }
                listener.stateUpdateHandler = { [weak self, weak listener] status in
                    guard let self else { return }
                    switch status {
                    case .ready: if let port = listener?.port { onReady(port.rawValue) }
                    case .failed(let error): self.stopOnQueue(); onFailure(error)
                    default: break
                    }
                }
                let timer = DispatchSource.makeTimerSource(queue: self.queue)
                timer.schedule(deadline: .now() + 0.1, repeating: 0.1)
                timer.setEventHandler { [weak self] in self?.tick() }
                self.timer = timer; timer.resume(); listener.start(queue: self.queue)
            } catch { self.stopOnQueue(); onFailure(error) }
        }
    }
    public func stop() { queue.async { self.stopOnQueue() } }
    public func updateFrame(_ frame: LocalJPEGFrame?) {
        // Coalesce even before dispatch: a fast producer cannot enqueue an unbounded
        // number of retained JPEGs while the networking queue is occupied.
        let validated: LocalJPEGFrame?
        if let frame, frame.data.count <= Self.maxFrame, frame.data.count >= 4, frame.data.starts(with: [0xff, 0xd8]), frame.data.suffix(2) == Data([0xff, 0xd9]), frame.updatedAt.isFinite, frame.width > 0, frame.height > 0 { validated = frame }
        else { validated = nil }
        pendingFrameLock.lock(); pendingFrame = validated
        let schedule = !frameDrainScheduled; frameDrainScheduled = true; pendingFrameLock.unlock()
        if schedule {
            queue.async {
                self.pendingFrameLock.lock()
                let latest = self.pendingFrame; self.pendingFrame = nil; self.frameDrainScheduled = false
                self.pendingFrameLock.unlock()
                self.frame = latest
            }
        }
    }
    public func updateState(_ state: LocalPublicState) {
        queue.async {
            var safe = state
            safe.captureState = String(safe.captureState.prefix(32)); safe.lyricState = String(safe.lyricState.prefix(32))
            safe.lyricLines = Array(safe.lyricLines.prefix(24)).map { String($0.prefix(200)) }
            safe.source = ["visible-screen", "tesla-ble"].contains(safe.source) ? safe.source : "visible-screen"
            safe.message = String(safe.message.prefix(512))
            if !safe.frameUpdatedAt.isFinite { safe.frameUpdatedAt = 0 }
            if !safe.lyricUpdatedAt.isFinite { safe.lyricUpdatedAt = 0 }
            self.state = safe
            if ["paused", "ended", "stopped", "waiting", "error"].contains(safe.captureState) { self.frame = nil }
        }
    }
    private func error(_ message: String) -> NSError { NSError(domain: "CabinDirect.HTTP", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
    private func stopOnQueue() {
        running = false; listener?.cancel(); listener = nil; timer?.cancel(); timer = nil
        for client in Array(clients.values) { close(client) }; frame = nil
    }
    private func close(_ client: Client) { clients.removeValue(forKey: client.id); client.connection.cancel() }
    private func accept(_ connection: NWConnection) {
        guard running, now() < configuration.expiresAt, clients.count < 8 else { connection.cancel(); return }
        let client = Client(connection, opened: now()); clients[client.id] = client
        connection.stateUpdateHandler = { [weak self, weak client] status in
            guard let self, let client else { return }
            if case .failed = status { self.close(client) }
            if case .cancelled = status { self.clients.removeValue(forKey: client.id) }
        }
        connection.start(queue: queue); receive(client)
    }
    private func receive(_ client: Client) {
        client.connection.receive(minimumIncompleteLength: 1, maximumLength: 4096) { [weak self, weak client] data, _, complete, error in
            guard let self, let client, self.clients[client.id] != nil else { return }
            if let data { client.input.append(data) }
            if client.input.count > Self.maxHeader + 1024 { self.respond(client, 413); return }
            if self.parse(client) { return }
            if complete || error != nil { self.close(client) } else { self.receive(client) }
        }
    }
    /// Returns true once a request has been consumed or rejected.
    private func parse(_ client: Client) -> Bool {
        guard let range = client.input.range(of: Data("\r\n\r\n".utf8)) else {
            if client.input.count > Self.maxHeader { respond(client, 431); return true }; return false
        }
        guard range.upperBound <= Self.maxHeader, let header = String(data: client.input[..<range.lowerBound], encoding: .ascii) else { respond(client, 400); return true }
        let lines = header.components(separatedBy: "\r\n")
        let first = (lines.first ?? "").split(separator: " ", omittingEmptySubsequences: false)
        guard first.count == 3, first[2] == "HTTP/1.1", ["GET", "POST"].contains(first[0]), first[1].hasPrefix("/"), !first[1].contains("%"), !first[1].contains("\\"), !first[1].contains("?"), !first[1].contains("#") else { respond(client, 400); return true }
        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            guard let colon = line.firstIndex(of: ":") else { respond(client, 400); return true }
            let key = String(line[..<colon]).lowercased()
            let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
            guard !key.isEmpty, key.utf8.allSatisfy({ (97...122).contains($0) || (48...57).contains($0) || $0 == 45 }), headers[key] == nil, value.utf8.allSatisfy({ $0 >= 32 && $0 < 127 }) else { respond(client, 400); return true }
            headers[key] = value
        }
        guard headers["transfer-encoding"] == nil, let host = headers["host"], validHost(host), headers["origin"] == nil || headers["origin"] == "http://" + host else { respond(client, 403); return true }
        var length = 0
        if let raw = headers["content-length"] {
            guard !raw.isEmpty, raw.utf8.allSatisfy({ (48...57).contains($0) }), let number = Int(raw), number <= 1024 else { respond(client, 413); return true }
            length = number
        }
        guard first[0] != "GET" || length == 0 else { respond(client, 400); return true }
        let total = range.upperBound + length
        guard client.input.count >= total else { return false }
        guard client.input.count == total else { respond(client, 400); return true }
        let body = client.input.subdata(in: range.upperBound..<total); client.input.removeAll(keepingCapacity: false)
        route(client, method: String(first[0]), path: String(first[1]), headers: headers, body: body)
        return true
    }
    private func validHost(_ host: String) -> Bool {
        var literal = host
        if host.hasPrefix("[") {
            guard let end = host.firstIndex(of: "]") else { return false }
            literal = String(host[host.index(after: host.startIndex)..<end])
            let tail = String(host[host.index(after: end)...]); guard tail.isEmpty || validPort(tail) else { return false }
            var addr = in6_addr(); guard inet_pton(AF_INET6, literal, &addr) == 1 else { return false }
            let bytes = withUnsafeBytes(of: addr) { Array($0) }
            return bytes == Array(repeating: 0, count: 15) + [1] || bytes[0] & 0xfe == 0xfc || (bytes[0] == 0xfe && bytes[1] & 0xc0 == 0x80)
        }
        let parts = host.split(separator: ":", omittingEmptySubsequences: false)
        guard parts.count <= 2 else { return false }
        if parts.count == 2 { guard validPort(":" + parts[1]) else { return false }; literal = String(parts[0]) }
        if literal == "localhost" { return true }
        var addr = in_addr(); guard inet_pton(AF_INET, literal, &addr) == 1 else { return false }
        let bytes = withUnsafeBytes(of: addr) { Array($0) }
        return bytes[0] == 127 || bytes[0] == 10 || (bytes[0] == 172 && (16...31).contains(bytes[1])) || (bytes[0] == 192 && bytes[1] == 168) || (bytes[0] == 169 && bytes[1] == 254)
    }
    private func validPort(_ value: String) -> Bool {
        let digits = value.dropFirst(); return value.hasPrefix(":" ) && !digits.isEmpty && digits.utf8.allSatisfy({ (48...57).contains($0) }) && UInt16(digits).map { $0 > 0 } == true
    }
    private func equal(_ left: String, _ right: String) -> Bool {
        let a = Array(left.utf8), b = Array(right.utf8)
        var mismatch = UInt64(a.count ^ b.count)
        for index in 0..<max(a.count, b.count) { mismatch |= UInt64((index < a.count ? a[index] : 0) ^ (index < b.count ? b[index] : 0)) }
        return mismatch == 0
    }
    private func authorized(_ headers: [String: String]) -> Bool {
        if let authorization = headers["authorization"], authorization.hasPrefix("Bearer "), equal(String(authorization.dropFirst(7)), configuration.token) { return true }
        let cookies = (headers["cookie"] ?? "").split(separator: ";").map { $0.trimmingCharacters(in: .whitespaces) }.filter { $0.hasPrefix("cabin_viewer=") }
        return cookies.count == 1 && equal(String(cookies[0].dropFirst(13)), configuration.token)
    }
    private func currentFrame() -> LocalJPEGFrame? {
        guard ["live", "broadcasting", "running", "capturing"].contains(state.captureState), let frame, now() - frame.updatedAt <= Self.staleAfter, now() >= frame.updatedAt - 1 else { return nil }; return frame
    }
    private func publicState() -> LocalPublicState {
        var result = state
        if let frame = currentFrame() { result.sequence = frame.sequence; result.frameUpdatedAt = frame.updatedAt; result.width = frame.width; result.height = frame.height }
        else {
            if !["paused", "ended", "stopped", "waiting", "error"].contains(result.captureState) { result.captureState = "stale" }
            result.lyricLines = []; result.width = 0; result.height = 0
        }
        if now() - result.lyricUpdatedAt > Self.staleAfter || result.lyricUpdatedAt > now() + 1 { result.lyricLines = []; if result.lyricState != "disabled" { result.lyricState = "stale" } }
        return result
    }
    private func route(_ client: Client, method: String, path: String, headers: [String: String], body: Data) {
        guard now() < configuration.expiresAt else { respond(client, 410); return }
        if method == "GET", path == "/health" { respond(client, 200, data: Data("{\"ok\":true}".utf8), type: "application/json"); return }
        if method == "GET", let asset = assets[path] { respond(client, 200, data: asset.data, type: asset.contentType); return }
        if method == "POST", path == "/api/pair" {
            guard now() - startedAt <= configuration.pairingWindow else { respond(client, 410); return }
            guard wrongAttempts < 5 else { respond(client, 429); return }
            guard headers["content-type"]?.split(separator: ";").first == "application/json", let json = try? JSONSerialization.jsonObject(with: body) as? [String: Any], json.count == 1, let code = json["code"] as? String, equal(code, configuration.pairingCode) else { wrongAttempts += 1; respond(client, 401); return }
            let ttl = Int(min(Double(Int32.max), max(0, configuration.expiresAt - now())))
            respond(client, 200, data: Data("{\"paired\":true}".utf8), type: "application/json", extra: "Set-Cookie: cabin_viewer=\(configuration.token); HttpOnly; SameSite=Strict; Path=/; Max-Age=\(ttl)\r\n"); return
        }
        guard method == "GET", ["/api/state", "/frame.jpg", "/stream.mjpeg"].contains(path) else { respond(client, 404); return }
        guard authorized(headers) else { respond(client, 401); return }
        switch path {
        case "/api/state": respond(client, 200, data: (try? JSONEncoder().encode(publicState())) ?? Data("{}".utf8), type: "application/json")
        case "/frame.jpg":
            guard let frame = currentFrame() else { respond(client, 204); return }
            respond(client, 200, data: frame.data, type: "image/jpeg")
        default:
            guard clients.values.filter({ $0.streaming }).count < 2 else { respond(client, 429); return }
            client.streaming = true
            send(client, data: Data(("HTTP/1.1 200 OK\r\nContent-Type: multipart/x-mixed-replace; boundary=cabinframe\r\n" + securityHeaders + "Connection: close\r\n\r\n").utf8), closeAfter: false)
            // Detect departed viewers even while paused, when no outgoing JPEG reveals EOF.
            client.connection.receive(minimumIncompleteLength: 1, maximumLength: 1) { [weak self, weak client] _, _, _, _ in
                guard let self, let client else { return }; self.close(client)
            }
        }
    }
    private var securityHeaders: String {
        "Cache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'\r\nPermissions-Policy: camera=(), microphone=(), geolocation=()\r\n"
    }
    private func respond(_ client: Client, _ status: Int, data: Data = Data(), type: String = "text/plain", extra: String = "") {
        let reasons = [200:"OK", 204:"No Content", 400:"Bad Request", 401:"Unauthorized", 403:"Forbidden", 404:"Not Found", 410:"Gone", 413:"Payload Too Large", 429:"Too Many Requests", 431:"Request Header Fields Too Large"]
        var response = Data("HTTP/1.1 \(status) \(reasons[status] ?? "Error")\r\nContent-Length: \(data.count)\r\nContent-Type: \(type)\r\n\(securityHeaders)\(extra)Connection: close\r\n\r\n".utf8)
        response.append(data); send(client, data: response, closeAfter: true)
    }
    private func send(_ client: Client, data: Data, closeAfter: Bool) {
        guard !client.sending, clients[client.id] != nil else { return }
        client.sending = true; client.sendStarted = now()
        client.connection.send(content: data, completion: .contentProcessed { [weak self, weak client] error in
            guard let self, let client else { return }
            client.sending = false
            if error != nil || closeAfter { self.close(client) }
        })
    }
    private func tick() {
        guard now() < configuration.expiresAt else { stopOnQueue(); return }
        for client in Array(clients.values) {
            if (client.sending && now() - client.sendStarted > 3) || (!client.streaming && now() - client.opened > 3) { close(client); continue }
            guard client.streaming, !client.sending, let frame = currentFrame(), client.lastSequence != frame.sequence else { continue }
            client.lastSequence = frame.sequence
            var part = Data("--cabinframe\r\nContent-Type: image/jpeg\r\nContent-Length: \(frame.data.count)\r\nX-Sequence: \(frame.sequence)\r\n\r\n".utf8)
            part.append(frame.data); part.append(Data("\r\n".utf8)); send(client, data: part, closeAfter: false)
        }
    }
}
