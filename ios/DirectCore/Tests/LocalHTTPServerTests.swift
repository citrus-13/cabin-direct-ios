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
    private var readAdvance: Double = 0
    func now() -> Double { lock.lock(); defer { lock.unlock() }; let value = Date().timeIntervalSince1970 + offset; offset += readAdvance; return value }
    func advance(_ seconds: Double) { lock.lock(); offset += seconds; lock.unlock() }
    func advanceOnEachRead(_ seconds: Double) { lock.lock(); readAdvance = seconds; lock.unlock() }
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
    let mediaID = "C601671F-573E-4CB7-9089-E154A593FCDF"
    let nextMediaID = "C601671F-573E-4CB7-9089-E154A593FCDD"
    let mediaMime = "video/mp4; codecs=\"avc1.42E01E, mp4a.40.2\""
    func initializeMedia(_ id: String? = nil) {
        server.updateState(.init(captureState: "live"))
        server.updateMediaInitialization(.init(generation: id ?? mediaID, data: Data(repeating: 1, count: 32), mime: mediaMime, hasAudio: true))
    }
    func mediaFragment(_ sequence: UInt64, start: Double, independent: Bool = true, id: String? = nil, size: Int = 64) {
        server.updateMediaFragment(.init(generation: id ?? mediaID, sequence: sequence, data: Data(repeating: 2, count: size), start: start, duration: 0.25, independent: independent, updatedAt: clock.now()))
    }
    func mediaIndex() throws -> [String: Any] {
        let result = try request("/media/index", headers: auth)
        return try JSONSerialization.jsonObject(with: Data(result.components(separatedBy: "\r\n\r\n").last!.utf8)) as! [String: Any]
    }
    func testMediaAuthenticatedFreshIndexAndPaths() throws {
        initializeMedia()
        XCTAssertTrue(try request("/media/index", headers: auth).contains("204 No Content"))
        mediaFragment(0, start: 0, independent: false)
        XCTAssertTrue(try request("/media/index", headers: auth).contains("204 No Content"))
        mediaFragment(1, start: 0.25)
        initializeMedia() // Repeated IDR initialization must not erase the bounded ring.
        XCTAssertEqual((try mediaIndex()["fragments"] as? [[String: Any]])?.count, 1)
        for path in ["/media/index", "/media/\(mediaID)/init.mp4", "/media/\(mediaID)/1.m4s"] {
            XCTAssertTrue(try request(path).contains("401 Unauthorized"))
            XCTAssertTrue(try request(path, headers: auth).contains("200 OK"))
            XCTAssertTrue(try request(path, headers: auth + "Origin: https://evil.example\r\n").contains("403 Forbidden"))
        }
        let index = try mediaIndex()
        XCTAssertEqual(index["generation"] as? String, mediaID)
        XCTAssertEqual(index["mime"] as? String, mediaMime); XCTAssertEqual(index["hasAudio"] as? Bool, true)
        let state = try request("/api/state", headers: auth)
        XCTAssertTrue(state.contains("\"captureState\":\"live\""))
        XCTAssertTrue(state.contains("\"media\":")); XCTAssertFalse(state.contains(token))
        XCTAssertTrue(state.contains("media-src 'self' blob:"))
        for path in ["/media/\(mediaID)/01.m4s", "/media/\(mediaID)/-1.m4s", "/media/../init.mp4", "/media/\(mediaID)/wat.mp4"] {
            XCTAssertTrue(try request(path, headers: auth).contains("404 Not Found"))
        }
        XCTAssertTrue(try request("/media/index?token=bad", headers: auth).contains("400 Bad Request"))
        clock.advance(5)
        XCTAssertTrue(try request("/media/index", headers: auth).contains("204 No Content"))
        XCTAssertTrue(try request("/media/\(mediaID)/1.m4s", headers: auth).contains("204 No Content"))
    }
    func testMediaBoundedWindowGenerationAndDiscontinuity() throws {
        initializeMedia()
        for sequence in UInt64(0)..<20 { mediaFragment(sequence, start: Double(sequence) / 4, independent: sequence % 4 == 0) }
        let fragments = try mediaIndex()["fragments"] as! [[String: Any]]
        XCTAssertTrue(fragments.count <= 12); XCTAssertEqual(fragments.first?["independent"] as? Bool, true)
        XCTAssertTrue(try request("/media/\(mediaID)/0.m4s", headers: auth).contains("409 Conflict"))
        XCTAssertTrue(try request("/media/\(mediaID)/19.m4s", headers: auth).contains("200 OK"))
        // Missing a fragment cannot be disguised as a playable dependent continuation.
        mediaFragment(21, start: 5.25, independent: false)
        XCTAssertTrue(try request("/media/index", headers: auth).contains("204 No Content"))
        mediaFragment(22, start: 5.5)
        initializeMedia(nextMediaID)
        mediaFragment(0, start: 0, id: nextMediaID)
        mediaFragment(23, start: 5.75) // old-generation completion ignored
        XCTAssertEqual(try mediaIndex()["generation"] as? String, nextMediaID)
        XCTAssertTrue(try request("/media/\(mediaID)/init.mp4", headers: auth).contains("409 Conflict"))
        for sequence in UInt64(1)..<8 { mediaFragment(sequence, start: Double(sequence) / 4, id: nextMediaID, size: 1_048_576) }
        XCTAssertTrue((try mediaIndex()["fragments"] as! [[String: Any]]).count <= 4)
        mediaFragment(8, start: 2, id: nextMediaID, size: 1_048_577)
        XCTAssertTrue(try request("/media/index", headers: auth).contains("204 No Content"))
    }
    func testMediaPauseLyricsAndInitializationValidation() throws {
        for (generation, mime, hasAudio, size) in [("bad", mediaMime, true, 32), (mediaID, "video/mp4\r\nInjected: yes", true, 32),
                                                 (mediaID, mediaMime, false, 32), (mediaID, mediaMime, true, 65_537)] {
            server.updateMediaInitialization(.init(generation: generation, data: Data(repeating: 1, count: size), mime: mime, hasAudio: hasAudio))
        }
        server.updateState(.init(captureState: "live")); mediaFragment(0, start: 0)
        XCTAssertTrue(try request("/media/index", headers: auth).contains("204 No Content"))
        initializeMedia(); mediaFragment(0, start: 0)
        server.updateState(.init(captureState: "paused"))
        XCTAssertTrue(try request("/media/index", headers: auth).contains("204 No Content"))
        initializeMedia(); mediaFragment(1, start: 0.25) // retired epoch must not restart
        XCTAssertTrue(try request("/media/index", headers: auth).contains("204 No Content"))
        initializeMedia(nextMediaID); mediaFragment(0, start: 0, id: nextMediaID)
        XCTAssertTrue(try request("/media/index", headers: auth).contains("200 OK"))
        server.updateState(.init(captureState: "waiting", source: "microphone-lyrics"))
        mediaFragment(1, start: 0.25, id: nextMediaID)
        for path in ["/media/index", "/media/\(nextMediaID)/init.mp4", "/media/\(nextMediaID)/0.m4s"] {
            XCTAssertTrue(try request(path, headers: auth).contains("204 No Content"))
        }
        XCTAssertFalse(try request("/api/state", headers: auth).contains("\"media\":"))
    }
    func testMediaChangedInitializationRetiresEpoch() throws {
        initializeMedia(); mediaFragment(0, start: 0)
        server.updateMediaInitialization(.init(generation: mediaID, data: Data(repeating: 3, count: 32), mime: mediaMime, hasAudio: true))
        XCTAssertTrue(try request("/media/index", headers: auth).contains("204 No Content"))
        initializeMedia(); mediaFragment(0, start: 0)
        XCTAssertTrue(try request("/media/index", headers: auth).contains("204 No Content"))
        initializeMedia(nextMediaID); mediaFragment(0, start: 0, id: nextMediaID)
        XCTAssertTrue(try request("/media/index", headers: auth).contains("200 OK"))
    }
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
    func musicState() throws -> LocalMusicState? {
        let response = try request("/api/state", headers: auth)
        XCTAssertTrue(response.contains("200 OK"))
        return try JSONDecoder().decode(LocalPublicState.self, from: Data(response.components(separatedBy: "\r\n\r\n").last!.utf8)).music
    }
    func testMusicAuthenticatedIndependentOfVideoAndOCR() throws {
        let time = clock.now()
        server.updateState(.init(captureState: "live", lyricState: "ready", lyricLines: ["screen only"], lyricUpdatedAt: time,
                                 music: .init(status: "lyrics", title: "Song", artist: "Artist", lines: ["music only"], updatedAt: time, matchedAt: time, position: 32)))
        XCTAssertTrue(try request("/api/state").contains("401"))
        let publicResponse = try request("/api/state", headers: auth)
        XCTAssertTrue(publicResponse.contains("\"captureState\":\"stale\""))
        XCTAssertFalse(publicResponse.contains("screen only")); XCTAssertFalse(publicResponse.contains(token))
        XCTAssertEqual(try musicState()?.lines, ["music only"])
        XCTAssertEqual(try musicState()?.title, "Song")
        XCTAssertTrue(try request("/frame.jpg", headers: auth).contains("204"))
        // Old senders remain decodable and do not acquire a music payload.
        server.updateState(.init())
        XCTAssertEqual(try musicState()?.title, nil)
        let legacy = Data("{\"captureState\":\"waiting\",\"sequence\":0,\"frameUpdatedAt\":0,\"width\":0,\"height\":0,\"lyricState\":\"disabled\",\"lyricLines\":[],\"lyricUpdatedAt\":0,\"source\":\"visible-screen\",\"message\":\"\"}".utf8)
        XCTAssertEqual(try JSONDecoder().decode(LocalPublicState.self, from: legacy).music?.status, nil)
    }
    func testMicrophoneLyricsSourceRejectsFramesAndNormalizesUnknownSources() throws {
        let time = clock.now()
        publish()
        XCTAssertTrue(try request("/frame.jpg", headers: auth).contains("200 OK"))
        // Even an erroneous live/frame payload cannot leak screen content in lyrics mode.
        server.updateState(.init(captureState: "live", sequence: 9, frameUpdatedAt: time, width: 960, height: 540,
                                 lyricState: "ready", lyricLines: ["screen secret"], lyricUpdatedAt: time,
                                 source: "microphone-lyrics", music: .init(status: "lyrics", title: "Song", lines: ["lyric"], updatedAt: time, matchedAt: time)))
        server.updateFrame(.init(data: Data([0xff, 0xd8, 0xff, 0xd9]), sequence: 10, updatedAt: time, width: 960, height: 540))
        let response = try request("/api/state", headers: auth)
        let state = try JSONDecoder().decode(LocalPublicState.self, from: Data(response.components(separatedBy: "\r\n\r\n").last!.utf8))
        XCTAssertEqual(state.source, "microphone-lyrics"); XCTAssertEqual(state.width, 0); XCTAssertEqual(state.height, 0)
        XCTAssertEqual(state.sequence, 0); XCTAssertEqual(state.frameUpdatedAt, 0)
        XCTAssertEqual(state.lyricLines, []); XCTAssertEqual(state.lyricState, "disabled"); XCTAssertEqual(state.lyricUpdatedAt, 0)
        XCTAssertEqual(state.music?.lines, ["lyric"])
        for path in ["/frame.jpg", "/stream.mjpeg"] {
            XCTAssertTrue(try request(path).contains("401"))
            XCTAssertTrue(try request(path, headers: auth).contains("204 No Content"))
        }
        for source in ["lyrics", "microphone-lyrics-extra", "MICROPHONE-LYRICS", ""] {
            server.updateState(.init(source: source))
            XCTAssertTrue(try request("/api/state", headers: auth).contains("\"source\":\"visible-screen\""))
        }
        server.updateState(.init(captureState: "waiting", source: "microphone-lyrics", music: .init(status: "lyrics", lines: ["fresh"], updatedAt: time, matchedAt: time)))
        XCTAssertEqual(try musicState()?.lines, ["fresh"])
        clock.advance(5)
        XCTAssertEqual(try musicState()?.status, "stale"); XCTAssertEqual(try musicState()?.lines, [])
    }
    func testMusicBoundsSourcesStatusesAndNonfiniteValues() throws {
        let time = clock.now()
        server.updateState(.init(music: .init(status: "lyrics", title: String(repeating: "名", count: 300), artist: String(repeating: "a", count: 300), lines: Array(repeating: String(repeating: "x", count: 300), count: 40), updatedAt: time, matchedAt: time, position: .infinity, message: String(repeating: "m", count: 600))))
        let bounded = try musicState()!
        XCTAssertEqual(bounded.title.count, 200); XCTAssertEqual(bounded.artist.count, 200)
        XCTAssertEqual(bounded.lines.count, 24); XCTAssertEqual(bounded.lines.first?.count, 200)
        XCTAssertEqual(bounded.message.count, 512); XCTAssertEqual(bounded.position, nil)
        for position in [Double.nan, -Double.infinity, -1, 86_401] {
            server.updateState(.init(music: .init(status: "lyrics", title: "safe", lines: ["lyric"], updatedAt: time, matchedAt: time, position: position)))
            XCTAssertEqual(try musicState()?.position, nil)
        }
        for invalid in [LocalMusicState(status: "unknown", title: "secret", lines: ["secret"], updatedAt: time, matchedAt: time),
                        LocalMusicState(status: "lyrics", title: "secret", lines: ["secret"], updatedAt: time, matchedAt: time, source: "unknown")] {
            server.updateState(.init(music: invalid))
            let safe = try musicState()!
            XCTAssertEqual(safe.status, "unavailable"); XCTAssertEqual(safe.source, "shazam")
            XCTAssertEqual(safe.title, ""); XCTAssertEqual(safe.lines, [])
        }
        for dates in [(Double.nan, time), (Double.infinity, time), (time, Double.nan), (time, Double.infinity), (time + 1, time), (time, time + 1), (-1, time), (time, -1)] {
            server.updateState(.init(music: .init(status: "lyrics", title: "old", lines: ["old"], updatedAt: dates.0, matchedAt: dates.1)))
            let safe = try musicState()!
            XCTAssertEqual(safe.status, "stale"); XCTAssertEqual(safe.title, ""); XCTAssertEqual(safe.artist, ""); XCTAssertEqual(safe.lines, [])
            XCTAssertTrue(safe.updatedAt.isFinite); XCTAssertTrue(safe.matchedAt.isFinite)
        }
    }
    func testMusicFreshnessAndPauseClearMetadata() throws {
        let time = clock.now()
        for (source, matchAge, expected) in [("shazam", 29.0, "lyrics"), ("shazam", 31.0, "stale"), ("manual", 599.0, "lyrics"), ("manual", 601.0, "stale")] {
            server.updateState(.init(captureState: "waiting", music: .init(status: "lyrics", title: "track", artist: "artist", lines: ["lyrics"], updatedAt: time, matchedAt: time - matchAge, source: source)))
            let music = try musicState()!
            XCTAssertEqual(music.status, expected)
            XCTAssertEqual(music.lines.isEmpty, expected == "stale")
        }
        for capture in ["paused", "ended", "stopped", "error"] {
            server.updateState(.init(captureState: capture, music: .init(status: "lyrics", title: "track", artist: "artist", lines: ["lyrics"], updatedAt: time, matchedAt: time, position: 10)))
            let music = try musicState()!
            XCTAssertEqual(music.title, ""); XCTAssertEqual(music.artist, ""); XCTAssertEqual(music.lines, []); XCTAssertEqual(music.position, nil)
        }
        server.updateState(.init(music: .init(status: "lyrics", title: "track", artist: "artist", lines: ["lyrics"], updatedAt: time, matchedAt: time)))
        clock.advance(5)
        let stale = try musicState()!
        XCTAssertEqual(stale.status, "stale"); XCTAssertEqual(stale.title, ""); XCTAssertEqual(stale.artist, ""); XCTAssertEqual(stale.lines, [])
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
        for source in ["visible-screen", "demo"] {
            server.updateState(.init(source: source))
            XCTAssertTrue(try request("/api/state", headers: auth).contains("\"source\":\"\(source)\""))
        }
        for source in ["untrusted-source", "tesla-ble"] {
            server.updateState(.init(source: source))
            XCTAssertTrue(try request("/api/state", headers: auth).contains("\"source\":\"visible-screen\""))
        }
    }
    func testUnpairOnlyClearsRequestingBrowserCookie() throws {
        publish()
        let origin = "Origin: http://127.0.0.1:\(port)\r\n"
        for headers in [origin + "Cookie: cabin_viewer=\(token)\r\n", origin, origin] {
            let response = try request("/api/unpair", method: "POST", headers: headers)
            XCTAssertTrue(response.contains("204 No Content"))
            XCTAssertTrue(response.contains("Set-Cookie: cabin_viewer=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0\r\n"))
            XCTAssertEqual(response.components(separatedBy: "\r\n\r\n").last!, "")
            XCTAssertFalse(response.contains(token))
        }
        // No source revocation: other already-authorized clients remain usable.
        XCTAssertTrue(try request("/frame.jpg", headers: auth).contains("200 OK"))
        XCTAssertTrue(try request("/api/state", headers: "Cookie: cabin_viewer=\(token)\r\n").contains("200 OK"))
        XCTAssertTrue(try request("/api/state").contains("401"))
        for originValue in ["", "Origin: null\r\n", "Origin: http://evil.example\r\n", "Origin: https://127.0.0.1:\(port)\r\n", "Origin: http://127.0.0.1:1\r\n"] {
            let response = try request("/api/unpair", method: "POST", headers: originValue)
            XCTAssertTrue(response.contains("403")); XCTAssertFalse(response.contains("Set-Cookie"))
        }
        XCTAssertTrue(try request("/api/unpair").contains("404"))
        XCTAssertTrue(try request("/api/unpair", method: "POST", headers: origin, body: "unexpected").contains("400"))
    }
    func testIPv6AllowlistIsExactNormalizedAndBounded() throws {
        func health(_ host: String) throws -> String {
            let socket = try Socket(port: port)
            socket.write("GET /health HTTP/1.1\r\nHost: \(host)\r\n\r\n")
            return String(decoding: socket.read(), as: UTF8.self)
        }
        XCTAssertTrue(try health("[2001:db8::5]").contains("403"))
        server.stop(); Thread.sleep(forTimeInterval: 0.1)
        let ready = DispatchSemaphore(value: 0)
        server = LocalHTTPServer(configuration: .init(token: token, pairingCode: "123456", expiresAt: clock.now() + 600, allowedIPv6Hosts: ["2001:db8::5"]), assets: [:], now: clock.now, bindToLoopback: true)
        server.start(port: 0, onReady: { self.port = $0; ready.signal() }, onFailure: { XCTFail("\($0)"); ready.signal() })
        XCTAssertEqual(ready.wait(timeout: .now() + 3), .success)
        for host in ["[2001:db8::5]", "[2001:0DB8:0:0:0:0:0:5]:8080"] { XCTAssertTrue(try health(host).contains("200 OK")) }
        for host in ["[2001:db8::6]", "[2001:db8::5]:0", "2001:db8::5", "public.example", "[::ffff:127.0.0.1]", "[ff02::1]", "[::]"] { XCTAssertTrue(try health(host).contains("403")) }
        let socket = try Socket(port: port)
        socket.write("POST /api/unpair HTTP/1.1\r\nHost: [2001:db8::5]:8080\r\nOrigin: http://[2001:0db8:0:0:0:0:0:5]:8080\r\nContent-Length: 0\r\n\r\n")
        XCTAssertTrue(String(decoding: socket.read(), as: UTF8.self).contains("403"), "Origin remains exact, even if host literals normalize equally")
        for hosts in [["::"], ["ff02::1"], ["::ffff:127.0.0.1"], ["example.com"], ["[2001:db8::5]"], ["2001:db8::5\0extra"], Array(repeating: "2001:db8::5", count: 17)] {
            let rejected = DispatchSemaphore(value: 0)
            let invalid = LocalHTTPServer(configuration: .init(token: token, pairingCode: "123456", expiresAt: clock.now() + 600, allowedIPv6Hosts: hosts), assets: [:], bindToLoopback: true)
            invalid.start(port: 0, onReady: { _ in XCTFail("Invalid allowlist started"); rejected.signal() }, onFailure: { _ in rejected.signal() })
            XCTAssertEqual(rejected.wait(timeout: .now() + 3), .success)
            invalid.stop()
        }
    }
    func testStopAcknowledgesCleanupAndRapidSamePortRestart() throws {
        let fixedPort = port
        for _ in 0..<3 {
            let incomplete = try Socket(port: fixedPort)
            incomplete.write("GET /health HTTP/1.1\r\nHost:")
            let stopped = DispatchSemaphore(value: 0)
            server.stop { stopped.signal() }
            server = nil // Completion must survive the containing runtime releasing ownership.
            XCTAssertEqual(stopped.wait(timeout: .now() + 3), .success)
            // The acknowledgement must follow listener cancellation, not merely enqueue it.
            XCTAssertThrowsError(try Socket(port: fixedPort))
            XCTAssertTrue(incomplete.read().isEmpty)
            let ready = DispatchSemaphore(value: 0)
            server = LocalHTTPServer(configuration: .init(token: token, pairingCode: "123456", expiresAt: clock.now() + 600), assets: [:], now: clock.now, bindToLoopback: true)
            server.start(port: fixedPort, onReady: { value in XCTAssertEqual(value, fixedPort); ready.signal() },
                         onFailure: { error in XCTFail("Rapid restart: \(error)"); ready.signal() })
            XCTAssertEqual(ready.wait(timeout: .now() + 3), .success)
            XCTAssertTrue(try request("/health").contains("200 OK"))
        }
    }
    func testStartupDeadlineFailsOnceAndCleansListener() throws {
        let stopped = DispatchSemaphore(value: 0), failed = DispatchSemaphore(value: 0)
        server.stop { stopped.signal() }
        XCTAssertEqual(stopped.wait(timeout: .now() + 3), .success)
        let fixedPort = port, expires = clock.now() + 600
        // Existing injectable clock makes the startup deadline elapse before the
        // actual listener's first ready/timer event. No production-only test switch.
        clock.advanceOnEachRead(11)
        var failures = 0, readiness = 0, failureMessage = ""
        server = LocalHTTPServer(configuration: .init(token: token, pairingCode: "123456", expiresAt: expires), assets: [:], now: clock.now, bindToLoopback: true)
        server.start(port: fixedPort, onReady: { _ in readiness += 1; failed.signal() }, onFailure: { error in
            failures += 1; failureMessage = error.localizedDescription; failed.signal()
        })
        XCTAssertEqual(failed.wait(timeout: .now() + 3), .success)
        XCTAssertEqual(readiness, 0); XCTAssertEqual(failures, 1)
        XCTAssertTrue(failureMessage.contains("10 seconds")); XCTAssertTrue(failureMessage.contains("permission"))
        XCTAssertThrowsError(try Socket(port: fixedPort))
        Thread.sleep(forTimeInterval: 0.25)
        XCTAssertEqual(failures, 1); XCTAssertEqual(readiness, 0)
        let finalStop = DispatchSemaphore(value: 0)
        server.stop { finalStop.signal() }
        XCTAssertEqual(finalStop.wait(timeout: .now() + 3), .success)
        clock.advanceOnEachRead(0)
    }
}

@main private struct TestRunner {
    static func main() {
        let names = ["health-assets-auth", "pair-cookie", "pair-limits", "host-origin-smuggling", "frame-staleness-pause", "multipart-viewer-cap", "slow-headers", "session-expiry", "backpressure", "connection-cap-pipelining", "fixed-port-source-bounds", "browser-unpair", "ipv6-allowlist", "stop-ack-rapid-restart", "startup-timeout", "music-auth-video-independent", "music-sanitize-nonfinite", "music-freshness-pause", "microphone-lyrics-source-frames"] + ["media-authenticated-paths", "media-ring-generation", "media-lifecycle-validation", "media-initialization-immutability"]
        var passed = 0
        for index in names.indices {
            let suite = LocalHTTPServerTests(), before = assertionFailures
            do {
                try suite.setUpWithError()
                let tests: [() throws -> Void] = [suite.testHealthAssetsAndAuthentication, suite.testPairCookieIsHttpOnlyAndTokenNeverInJSON, suite.testGlobalPairAttemptLimitAndWindow, suite.testOriginHostAndRequestSmugglingRejected, suite.testFramesPauseStaleAndNilClear, suite.testMultipartStreamingAndViewerCap, suite.testSlowClientsAndHeaderLimit, suite.testExpiryClosesActiveStreamAndListener, suite.testBackpressureDoesNotBlockStateAndSkipsIntermediateFrames, suite.testConnectionCapAndNoPipelining, suite.testFixedPortBindingAndSourceBounds, suite.testUnpairOnlyClearsRequestingBrowserCookie, suite.testIPv6AllowlistIsExactNormalizedAndBounded, suite.testStopAcknowledgesCleanupAndRapidSamePortRestart, suite.testStartupDeadlineFailsOnceAndCleansListener]
                let musicTests: [() throws -> Void] = [suite.testMusicAuthenticatedIndependentOfVideoAndOCR, suite.testMusicBoundsSourcesStatusesAndNonfiniteValues, suite.testMusicFreshnessAndPauseClearMetadata, suite.testMicrophoneLyricsSourceRejectsFramesAndNormalizesUnknownSources] + [suite.testMediaAuthenticatedFreshIndexAndPaths, suite.testMediaBoundedWindowGenerationAndDiscontinuity, suite.testMediaPauseLyricsAndInitializationValidation, suite.testMediaChangedInitializationRetiresEpoch]
                try (tests + musicTests)[index]()
            } catch { XCTFail("\(names[index]): \(error)") }
            suite.tearDown()
            if before == assertionFailures { passed += 1; print("PASS \(names[index])") }
        }
        print("Native macOS TCP tests: \(passed)/\(names.count) passed; \(assertionFailures) assertion failures. Not an iOS build or device test.")
        exit(assertionFailures == 0 ? 0 : 1)
    }
}
