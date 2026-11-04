import Foundation
import Darwin
import DirectCore

// Command Line Tools do not ship XCTest. Keep tests executable on that toolchain.
private var assertionFailures = 0
private func XCTFail(_ message: String, file: StaticString = #filePath, line: UInt = #line) { assertionFailures += 1; print("FAIL \(file):\(line): \(message)") }
private func XCTAssertTrue(_ expression: @autoclosure () throws -> Bool, _ message: String = "", file: StaticString = #filePath, line: UInt = #line) { do { if try !expression() { XCTFail(message.isEmpty ? "Expected true" : message, file: file, line: line) } } catch { XCTFail("\(error)", file: file, line: line) } }
private func XCTAssertFalse(_ expression: @autoclosure () throws -> Bool, _ message: String = "", file: StaticString = #filePath, line: UInt = #line) { do { if try expression() { XCTFail(message.isEmpty ? "Expected false" : message, file: file, line: line) } } catch { XCTFail("\(error)", file: file, line: line) } }
private func XCTAssertEqual<T: Equatable>(_ actual: T, _ expected: T, file: StaticString = #filePath, line: UInt = #line) { if actual != expected { XCTFail("\(actual) != \(expected)", file: file, line: line) } }
private func XCTAssertGreaterThan<T: Comparable>(_ actual: T, _ lower: T, file: StaticString = #filePath, line: UInt = #line) { if actual <= lower { XCTFail("\(actual) <= \(lower)", file: file, line: line) } }
private func XCTAssertThrowsError<T>(_ expression: @autoclosure () throws -> T, file: StaticString = #filePath, line: UInt = #line) { do { _ = try expression(); XCTFail("Expected error", file: file, line: line) } catch {} }

private final class TestClock {
    private let lock = NSLock()
    private var offset: Double = 0
    func now() -> Double { lock.lock(); defer { lock.unlock() }; return Date().timeIntervalSince1970 + offset }
    func advance(_ seconds: Double) { lock.lock(); offset += seconds; lock.unlock() }
}
private final class Socket {
    let fd: Int32
    init(port: UInt16, receiveBuffer: Int32? = nil) throws {
        fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { throw NSError(domain: "socket", code: 1) }
        var timeout = timeval(tv_sec: 2, tv_usec: 0)
        setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
        setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
        var noSignal: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &noSignal, socklen_t(MemoryLayout<Int32>.size))
        if var size = receiveBuffer { setsockopt(fd, SOL_SOCKET, SO_RCVBUF, &size, socklen_t(MemoryLayout<Int32>.size)) }
        var address = sockaddr_in(); address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size); address.sin_family = sa_family_t(AF_INET); address.sin_port = port.bigEndian; inet_pton(AF_INET, "127.0.0.1", &address.sin_addr)
        let result = withUnsafePointer(to: &address) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) } }
        guard result == 0 else { Darwin.close(fd); throw NSError(domain: "connect", code: Int(errno)) }
    }
    deinit { Darwin.close(fd) }
    func write(_ string: String) { write(Data(string.utf8)) }
    func write(_ data: Data) {
        data.withUnsafeBytes { raw in
            var offset = 0
            while offset < data.count {
                let sent = send(fd, raw.baseAddress!.advanced(by: offset), data.count - offset, 0)
                guard sent > 0 else { return }; offset += sent
            }
        }
    }
    func read(until needle: String? = nil, limit: Int = 2_000_000) -> Data {
        var result = Data(), buffer = [UInt8](repeating: 0, count: 8192)
        while result.count < limit {
            let count = recv(fd, &buffer, buffer.count, 0)
            guard count > 0 else { break }; result.append(contentsOf: buffer.prefix(count))
            if let needle, result.range(of: Data(needle.utf8)) != nil { break }
        }
        return result
    }
}

final class LocalHTTPServerTests {
    let token = String(repeating: "a", count: 43)
    var server: LocalHTTPServer!
    var port: UInt16 = 0
    private var clock: TestClock!
    func setUpWithError() throws {
        clock = TestClock(); let ready = DispatchSemaphore(value: 0)
        server = LocalHTTPServer(configuration: .init(token: token, pairingCode: "123456", expiresAt: clock.now() + 600), assets: ["/": .init(data: Data("viewer".utf8), contentType: "text/html"), "/secret": .init(data: Data("secret".utf8), contentType: "text/plain")], now: clock.now, bindToLoopback: true)
        server.start(port: 0, onReady: { self.port = $0; ready.signal() }, onFailure: { XCTFail("\($0)"); ready.signal() })
        XCTAssertEqual(ready.wait(timeout: .now() + 3), .success); XCTAssertGreaterThan(port, 0)
    }
    func tearDown() { server.stop(); server = nil }
    func request(_ path: String, method: String = "GET", headers: String = "", body: String = "") throws -> String {
        let socket = try Socket(port: port)
        socket.write("\(method) \(path) HTTP/1.1\r\nHost: 127.0.0.1:\(port)\r\n\(headers)Content-Length: \(body.utf8.count)\r\n\r\n\(body)")
        return String(decoding: socket.read(), as: UTF8.self)
    }
    var auth: String { "Authorization: Bearer \(token)\r\n" }
    func publish(sequence: UInt64 = 1, size: Int = 20) {
        let time = clock.now()
        server.updateState(.init(captureState: "live", sequence: sequence, frameUpdatedAt: time, width: 960, height: 540, lyricState: "ready", lyricLines: ["original text"], lyricUpdatedAt: time))
        var bytes = Data([0xff, 0xd8]); bytes.append(Data(repeating: 65, count: size)); bytes.append(contentsOf: [0xff, 0xd9])
        server.updateFrame(.init(data: bytes, sequence: sequence, updatedAt: time, width: 960, height: 540))
    }
    func testHealthAssetsAndAuthentication() throws {
        let health = try request("/health")
        XCTAssertTrue(health.contains("200 OK")); XCTAssertTrue(health.contains("{\"ok\":true}")); XCTAssertFalse(health.contains(token)); XCTAssertFalse(health.contains("123456"))
        XCTAssertTrue(try request("/").contains("viewer")); XCTAssertTrue(try request("/secret").contains("404"))
        for path in ["/api/state", "/frame.jpg", "/stream.mjpeg"] { XCTAssertTrue(try request(path).contains("401")) }
        XCTAssertTrue(try request("/api/state", headers: auth).contains("200 OK"))
        XCTAssertTrue(try request("/api/state", headers: "Authorization: Bearer \(token.dropLast())b\r\n").contains("401"))
    }
    func testPairCookieIsHttpOnlyAndTokenNeverInJSON() throws {
        let response = try request("/api/pair", method: "POST", headers: "Content-Type: application/json\r\nOrigin: http://127.0.0.1:\(port)\r\n", body: "{\"code\":\"123456\"}")
        XCTAssertTrue(response.contains("200 OK")); XCTAssertTrue(response.contains("HttpOnly; SameSite=Strict; Path=/; Max-Age="))
        let body = response.components(separatedBy: "\r\n\r\n").last!
        XCTAssertEqual(body, "{\"paired\":true}"); XCTAssertFalse(body.contains(token))
        XCTAssertTrue(try request("/api/state", headers: "Cookie: cabin_viewer=\(token)\r\n").contains("200 OK"))
        XCTAssertTrue(try request("/api/state", headers: "Cookie: cabin_viewer=\(token); cabin_viewer=\(token)\r\n").contains("401"))
    }
    func testGlobalPairAttemptLimitAndWindow() throws {
        for _ in 0..<5 { XCTAssertTrue(try request("/api/pair", method: "POST", headers: "Content-Type: application/json\r\n", body: "{\"code\":\"999999\"}").contains("401")) }
        XCTAssertTrue(try request("/api/pair", method: "POST", headers: "Content-Type: application/json\r\n", body: "{\"code\":\"123456\"}").contains("429"))
        clock.advance(121)
        XCTAssertTrue(try request("/api/pair", method: "POST", headers: "Content-Type: application/json\r\n", body: "{\"code\":\"123456\"}").contains("410"))
        XCTAssertTrue(try request("/api/state", headers: auth).contains("200"))
    }
    func testOriginHostAndRequestSmugglingRejected() throws {
        let invalidHeaders = ["Host: example.com\r\n", "Host: 8.8.8.8\r\n", "Host: localhost\r\nOrigin: https://localhost\r\n", "Host: localhost\r\nOrigin: http://evil.example\r\n", "Host: localhost\r\nTransfer-Encoding: chunked\r\n", "Host: localhost\r\nContent-Length: 0\r\nContent-Length: 0\r\n", "Host: localhost\r\nContent-Length: -1\r\n", "Host: localhost\r\nContent-Length: 1025\r\n", "Host: localhost\r\n folded: x\r\n"]
        for headers in invalidHeaders {
            let socket = try Socket(port: port); socket.write("GET /health HTTP/1.1\r\n\(headers)\r\n")
            XCTAssertFalse(String(decoding: socket.read(), as: UTF8.self).contains("200 OK"), headers)
        }
        for path in ["/%2e%2e/secret", "/../secret", "/health?token=secret", "//example.com", "/health#x"] { XCTAssertFalse(try request(path).contains("200 OK")) }
        for host in ["localhost", "127.0.0.1", "10.1.2.3:80", "172.20.10.1", "192.168.1.1", "[::1]:8080", "[fd00::1]"] {
            let socket = try Socket(port: port); socket.write("GET /health HTTP/1.1\r\nHost: \(host)\r\n\r\n")
            XCTAssertTrue(String(decoding: socket.read(), as: UTF8.self).contains("200 OK"), host)
        }
    }
    func testFramesPauseStaleAndNilClear() throws {
        publish(); XCTAssertTrue(try request("/frame.jpg", headers: auth).contains("image/jpeg"))
        XCTAssertTrue(try request("/api/state", headers: auth).contains("original text"))
        clock.advance(5)
        XCTAssertTrue(try request("/frame.jpg", headers: auth).contains("204"))
        let stale = try request("/api/state", headers: auth); XCTAssertTrue(stale.contains("stale")); XCTAssertFalse(stale.contains("original text"))
        publish(); server.updateState(.init(captureState: "paused"))
        XCTAssertTrue(try request("/frame.jpg", headers: auth).contains("204"))
        publish(); server.updateFrame(nil)
        XCTAssertTrue(try request("/frame.jpg", headers: auth).contains("204"))
    }
    func testMultipartStreamingAndViewerCap() throws {
        publish()
        var sockets: [Socket] = []
        for _ in 0..<2 {
            let socket = try Socket(port: port); sockets.append(socket)
            socket.write("GET /stream.mjpeg HTTP/1.1\r\nHost: localhost\r\n\(auth)\r\n")
            let data = String(decoding: socket.read(until: "X-Sequence: 1"), as: UTF8.self)
            XCTAssertTrue(data.contains("multipart/x-mixed-replace; boundary=cabinframe")); XCTAssertTrue(data.contains("--cabinframe\r\nContent-Type: image/jpeg"))
        }
        XCTAssertTrue(try request("/stream.mjpeg", headers: auth).contains("429"))
        publish(sequence: 99)
        XCTAssertTrue(String(decoding: sockets[0].read(until: "X-Sequence: 99"), as: UTF8.self).contains("X-Sequence: 99"))
        withExtendedLifetime(sockets) {}
    }
    func testSlowClientsAndHeaderLimit() throws {
        let socket = try Socket(port: port); socket.write("GET /health HTTP/1.1\r\nHost:")
        Thread.sleep(forTimeInterval: 0.1); clock.advance(4); Thread.sleep(forTimeInterval: 0.2)
        XCTAssertTrue(socket.read().isEmpty)
        let huge = try Socket(port: port); huge.write("GET /health HTTP/1.1\r\nHost: localhost\r\nX-Big: " + String(repeating: "a", count: 9000))
        XCTAssertTrue(String(decoding: huge.read(), as: UTF8.self).contains("431"))
    }
    func testExpiryClosesActiveStreamAndListener() throws {
        publish(); let stream = try Socket(port: port)
        stream.write("GET /stream.mjpeg HTTP/1.1\r\nHost: localhost\r\n\(auth)\r\n")
        XCTAssertFalse(stream.read(until: "X-Sequence: 1").isEmpty)
        clock.advance(601); Thread.sleep(forTimeInterval: 0.2)
        XCTAssertTrue(stream.read().isEmpty)
        XCTAssertThrowsError(try Socket(port: port))
    }
    func testBackpressureDoesNotBlockStateAndSkipsIntermediateFrames() throws {
        publish(sequence: 1, size: 900_000)
        let stream = try Socket(port: port, receiveBuffer: 1024)
        stream.write("GET /stream.mjpeg HTTP/1.1\r\nHost: localhost\r\n\(auth)\r\n")
        Thread.sleep(forTimeInterval: 0.15)
        for sequence in 2...100 { publish(sequence: UInt64(sequence), size: 900_000) }
        let response = try request("/api/state", headers: auth)
        XCTAssertTrue(response.contains("\"sequence\":100")); XCTAssertTrue(response.contains("200 OK"))
        // Advance beyond send deadline: a non-reading stream cannot retain a socket forever.
        clock.advance(4); Thread.sleep(forTimeInterval: 0.2)
        XCTAssertTrue(try request("/health").contains("200 OK"))
        withExtendedLifetime(stream) {}
    }
    func testConnectionCapAndNoPipelining() throws {
        var sockets: [Socket] = []
        for _ in 0..<8 { let socket = try Socket(port: port); socket.write("GET "); sockets.append(socket) }
        Thread.sleep(forTimeInterval: 0.15)
        let ninth = try Socket(port: port); ninth.write("GET /health HTTP/1.1\r\nHost: localhost\r\n\r\n")
        XCTAssertTrue(ninth.read().isEmpty)
        sockets.removeAll(); Thread.sleep(forTimeInterval: 0.2)
        let pipeline = try Socket(port: port); pipeline.write("GET /health HTTP/1.1\r\nHost: localhost\r\n\r\nGET /health HTTP/1.1\r\nHost: localhost\r\n\r\n")
        XCTAssertTrue(String(decoding: pipeline.read(), as: UTF8.self).contains("400"))
    }
    func testFixedPortBindingAndSourceBounds() throws {
        let fixedPort = port
        server.stop(); Thread.sleep(forTimeInterval: 0.15)
        let ready = DispatchSemaphore(value: 0)
        server = LocalHTTPServer(configuration: .init(token: token, pairingCode: "123456", expiresAt: clock.now() + 600), assets: [:], now: clock.now, bindToLoopback: true)
        server.start(port: fixedPort, onReady: { port in XCTAssertEqual(port, fixedPort); ready.signal() }, onFailure: { error in XCTFail("Fixed-port binding: \(error)"); ready.signal() })
        XCTAssertEqual(ready.wait(timeout: .now() + 3), .success)
        XCTAssertTrue(try request("/health").contains("200 OK"))
        server.updateState(.init(captureState: "live", lyricState: "synced", lyricLines: ["vehicle text"], lyricUpdatedAt: clock.now(), source: "tesla-ble"))
        XCTAssertTrue(try request("/api/state", headers: auth).contains("tesla-ble"))
        server.updateState(.init(source: "untrusted-source"))
        XCTAssertTrue(try request("/api/state", headers: auth).contains("visible-screen"))
    }
}

@main private struct TestRunner {
    static func main() {
        let names = ["health-assets-auth", "pair-cookie", "pair-limits", "host-origin-smuggling", "frame-staleness-pause", "multipart-viewer-cap", "slow-headers", "session-expiry", "backpressure", "connection-cap-pipelining", "fixed-port-source-bounds"]
        var passed = 0
        for index in names.indices {
            let suite = LocalHTTPServerTests(), before = assertionFailures
            do {
                try suite.setUpWithError()
                let tests: [() throws -> Void] = [suite.testHealthAssetsAndAuthentication, suite.testPairCookieIsHttpOnlyAndTokenNeverInJSON, suite.testGlobalPairAttemptLimitAndWindow, suite.testOriginHostAndRequestSmugglingRejected, suite.testFramesPauseStaleAndNilClear, suite.testMultipartStreamingAndViewerCap, suite.testSlowClientsAndHeaderLimit, suite.testExpiryClosesActiveStreamAndListener, suite.testBackpressureDoesNotBlockStateAndSkipsIntermediateFrames, suite.testConnectionCapAndNoPipelining, suite.testFixedPortBindingAndSourceBounds]
                try tests[index]()
            } catch { XCTFail("\(names[index]): \(error)") }
            suite.tearDown()
            if before == assertionFailures { passed += 1; print("PASS \(names[index])") }
        }
        print("Native macOS TCP tests: \(passed)/\(names.count) passed; \(assertionFailures) assertion failures. Not an iOS build or device test.")
        exit(assertionFailures == 0 ? 0 : 1)
    }
}
