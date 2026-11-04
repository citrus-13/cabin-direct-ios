import Foundation

// Framework-free native acceptance. All fixtures are original synthetic data;
// tokens exist only in process memory and are never printed or persisted.
var failures = 0
var cases = 0
func check(_ condition: @autoclosure () -> Bool, _ label: String) {
    if !condition() { failures += 1; print("FAIL: \(label)") }
}
func rejects(_ label: String, _ operation: () throws -> Void) {
    do { try operation(); check(false, label) } catch {}
}
func run(_ name: String, _ body: () throws -> Void) {
    cases += 1
    let before = failures
    do { try body() } catch { failures += 1; print("FAIL: \(name) threw unexpected error") }
    print("\(before == failures ? "PASS" : "FAIL") \(name)")
}

run("Privacy defaults and settings roundtrip") {
    let settings = try DirectSettings().validated()
    check(settings.lyricMode == .mirror, "OCR is opt-in")
    check(!settings.onlineLyrics, "External lyrics lookup is opt-in")
    let decoded = try JSONDecoder().decode(DirectSettings.self, from: JSONEncoder().encode(settings))
    check(decoded == settings, "Settings Codable roundtrip")
}

run("ROI and port boundaries") {
    let invalid: [(inout DirectSettings) -> Void] = [
        { $0.regionX = -.infinity }, { $0.regionY = .nan }, { $0.regionWidth = .infinity },
        { $0.regionHeight = -.infinity }, { $0.regionX = -0.01 }, { $0.regionY = -0.01 },
        { $0.regionWidth = 0 }, { $0.regionHeight = 0.049 },
        { $0.regionX = 0.9 }, { $0.regionY = 0.9 }, { $0.port = 1023 }
    ]
    for (index, modify) in invalid.enumerated() {
        var settings = DirectSettings(); modify(&settings)
        rejects("Invalid ROI/port case \(index)") { _ = try settings.validated() }
    }
    var edge = DirectSettings()
    edge.regionX = 0; edge.regionY = 0; edge.regionWidth = 1; edge.regionHeight = 1; edge.port = 1024
    _ = try edge.validated()
    edge.port = .max; _ = try edge.validated()
}

run("Synthetic VIN and explicit media units") {
    var settings = DirectSettings()
    settings.lyricMode = .teslaMedia; settings.vin = " abc12345678901234 "
    rejects("Unconfirmed media units rejected") { _ = try settings.validated() }
    for unit in ["seconds", "milliseconds"] {
        settings.mediaTimeUnit = unit
        let clean = try settings.validated()
        check(clean.vin == "ABC12345678901234", "VIN normalized")
    }
    for invalid in ["", "ABC123", "ABC123456789012345", "IBC12345678901234", "OBC12345678901234", "QBC12345678901234", "ABC1234567890123é"] {
        settings.vin = invalid
        rejects("Malformed synthetic VIN rejected") { _ = try settings.validated() }
    }
    settings.vin = "ABC12345678901234"; settings.mediaTimeUnit = "minutes"
    rejects("Unknown time unit rejected") { _ = try settings.validated() }
}

run("CSPRNG session shape, rotation, TTL and Codable without secret output") {
    let now = 1_800_000_000.0
    var tokens = Set<String>(), codes = Set<String>(), ids = Set<String>()
    for _ in 0..<32 {
        let session = try DirectBroadcastSession.fresh(settings: DirectSettings(), now: now)
        check(session.token.count == 43, "Token is 43 characters")
        check(session.token.utf8.allSatisfy { (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) || $0 == 45 || $0 == 95 }, "Token is base64url")
        check(session.pairingCode.count == 6 && session.pairingCode.utf8.allSatisfy { (48...57).contains($0) }, "Code has six digits")
        check(session.createdAt == now && session.expiresAt - now == 28_800, "Eight-hour session TTL")
        let restored = try JSONDecoder().decode(DirectBroadcastSession.self, from: JSONEncoder().encode(session))
        check(restored.id == session.id && restored.token == session.token && restored.pairingCode == session.pairingCode &&
              restored.settings == session.settings && restored.expiresAt == session.expiresAt, "Session Codable roundtrip")
        tokens.insert(session.token); codes.insert(session.pairingCode); ids.insert(session.id)
    }
    check(tokens.count == 32 && ids.count == 32, "Session identities and strong tokens rotate")
    // Six-digit codes may legitimately collide; demanding global uniqueness would be flaky.
    check(codes.count > 1, "Pairing code rotation is not constant")
}

run("Private IPv4 strict syntax and ranges") {
    for address in ["10.0.0.1", "192.168.1.2", "172.16.0.1", "172.31.255.254"] {
        check(DirectNetworkAddresses.privateIPv4(address), "Private address accepted")
    }
    for address in ["172.15.1.1", "172.32.0.1", "127.0.0.1", "8.8.8.8", "169.254.1.1", "192.168.0.256", "192.168.-1.2", "10.0.0", "10.0.0.1.2", "10..0.1", "10.0.0.1 ", "+10.0.0.1", "0x0a.0.0.1", "10.0.0.1:8787", "localhost", "::1"] {
        check(!DirectNetworkAddresses.privateIPv4(address), "Non-private/malformed address rejected")
    }
}

run("Queued old observations rejected across pause/resume") {
    var gate = DirectObservationGate(acceptedAfter: 100)
    check(gate.accepts(100) && gate.accepts(101), "Initial observations accepted")
    gate.advance(to: 200) // Pause boundary.
    check(!gate.accepts(199.999), "Pre-pause frame rejected")
    gate.advance(to: 300) // Resume boundary; pre-pause callbacks may still be queued.
    check(!gate.accepts(199) && !gate.accepts(250), "Queued pre-resume image/text rejected")
    check(gate.accepts(300) && gate.accepts(301), "Post-resume observations accepted")
    gate.advance(to: 250)
    check(gate.acceptedAfter == 300 && !gate.accepts(299), "Boundary cannot move backwards")
    check(!gate.accepts(.nan) && !gate.accepts(.infinity) && !gate.accepts(-.infinity), "Nonfinite observations rejected")
}

run("Original LRC timestamps, positive/negative offset and visible window") {
    let timeline = DirectLyricTimeline(lrc: "[offset:500]\n[00:01.25]First synthetic line\n[00:02.500][00:03.5]Second synthetic line\n[01:00:005]Final synthetic line\n[00:99.00]Invalid seconds\n[ar:Original test author]")
    check(timeline.lines.map(\.time) == [0.75, 2, 3, 59.505], "Fractional timestamps and positive offset")
    check(timeline.visible(at: 0).isEmpty, "No premature lyric")
    check(timeline.visible(at: 2).count == 4, "Bounded context window")
    check(timeline.visible(at: -1).isEmpty && timeline.visible(at: .nan).isEmpty && timeline.visible(at: .infinity).isEmpty, "Invalid playback positions rejected")
    let negative = DirectLyricTimeline(lrc: "[offset:-250]\n[00:00.100]Delayed synthetic line")
    check(abs((negative.lines.first?.time ?? -1) - 0.35) < 0.000001, "Negative offset delays text")
    let clipped = DirectLyricTimeline(lrc: "[offset:500]\n[00:00.100]Clamped synthetic line")
    check(clipped.lines.first?.time == 0, "Offset cannot create negative time")
}

run("LRC byte, line, text and expanded timestamp bounds") {
    check(DirectLyricTimeline(lrc: String(repeating: "x", count: 512_001)).lines.isEmpty, "Oversized LRC rejected")
    let text = DirectLyricTimeline(lrc: "[00:00.0]" + String(repeating: "星", count: 200))
    check(text.lines.first?.text.count == 120, "Unicode lyric text bounded")
    let sourceLines = (0..<4_100).map { "[00:01.0]Original line \($0)" }.joined(separator: "\n")
    check(DirectLyricTimeline(lrc: sourceLines).lines.count == 4_000, "Input lines bounded")
    let expanded = (0..<4_000).map { "[00:01][00:02][00:03]Original line \($0)" }.joined(separator: "\n")
    check(DirectLyricTimeline(lrc: expanded).lines.count <= 8_000, "Expanded timestamps bounded across all lines")
}

run("Legacy shared configuration remains native-compilable") {
    let base = try SessionConfiguration.validateServer("http://192.168.1.2:8787")
    rejects("Public plaintext server rejected") { _ = try SessionConfiguration.validateServer("http://example.com") }
    let original = SessionConfiguration(baseURL: base, roomId: "synthetic-room", publisherToken: "fixture-publisher",
        viewerToken: "fixture-viewer", expiresAt: 9_000_000_000_000, iceServers: [])
    let decoded = try JSONDecoder().decode(SessionConfiguration.self, from: JSONEncoder().encode(original))
    check(decoded.baseURL == base && decoded.roomId == original.roomId && decoded.captureProfile == .balanced, "Legacy Codable roundtrip")
    check(CaptureProfile.compatible.outputSize(width: 1920, height: 1080)?.width == 960, "Legacy profile remains bounded")
}

print("Shared native macOS acceptance: \(cases) cases, \(failures) failures. No network requests or vehicle interaction; not an iOS build.")
if failures > 0 { exit(1) }
