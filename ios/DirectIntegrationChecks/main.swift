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

run("Installer group metadata resolves one exact or team-suffixed group, never guesses") {
    let requested = "group.org.fixture.cabin.direct", renamed = "group.org.fixture.cabin.direct.ABCDE12345"
    var info: [String: Any] = ["TCAppGroupIdentifier": requested, "TCInstallerIdentifierResolutionVersion": 1]
    check(DirectInstallationIdentifiers.appGroup(info: info) == requested, "Unmodified Xcode group")
    for candidate in [requested, renamed] {
        info["ALTAppGroups"] = ["group.org.unrelated", candidate]
        check(DirectInstallationIdentifiers.appGroup(info: info) == candidate, "Unique known mapping")
    }
    let invalid: [Any] = [[], [requested, renamed], [renamed, renamed], ["group.org.unrelated"],
        [requested: renamed], renamed, [1], [requested, 1], [requested + ".abcde12345"],
        [requested + ".ABCDE12345.extra"], [requested + ".ABCDE1234"], [requested + ".ABCDE12345\n"],
        Array(repeating: renamed, count: 33)]
    for value in invalid {
        info["ALTAppGroups"] = value
        check(DirectInstallationIdentifiers.appGroup(info: info) == nil, "Ambiguous/malformed group rejected")
    }
    for value in ["", "group..test", "group.$(VALUE)", "group.org/test", "group.org.test\n", String(repeating: "a", count: 256)] {
        check(DirectInstallationIdentifiers.appGroup(info: ["TCAppGroupIdentifier": value]) == nil, "Invalid request rejected")
    }
    for value: Any in [1, true, "1", 2] {
        let xml = try PropertyListSerialization.data(fromPropertyList: ["TCInstallerIdentifierResolutionVersion": value], format: .xml, options: 0)
        let decoded = try PropertyListSerialization.propertyList(from: xml, options: [], format: nil) as! [String: Any]
        check(DirectInstallationIdentifiers.hasResolver(decoded) == (type(of: value) == Int.self && value as? Int == 1), "Real plist marker type")
    }
    check(!DirectInstallationIdentifiers.hasResolver([:]), "Missing marker")
}

run("Embedded broadcast discovery keeps identity and ReplayKit checks after re-signing") {
    let original = "org.fixture.cabin.direct", actual = "org.fixture.cabin.direct.ABCDE12345"
    var host: [String: Any] = ["CFBundleIdentifier": original, "TCInstallerIdentifierResolutionVersion": 1, "TCBroadcastExtensionIdentifier": original + ".broadcast"]
    var embedded: [String: Any] = ["CFBundleIdentifier": original + ".broadcast", "TCInstallerIdentifierResolutionVersion": 1, "NSExtension": [
        "NSExtensionPointIdentifier": "com.apple.broadcast-services-upload",
        "RPBroadcastProcessMode": "RPBroadcastProcessModeSampleBuffer",
        "NSExtensionPrincipalClass": "DirectBroadcastExtension.DirectSampleHandler"]]
    check(DirectInstallationIdentifiers.broadcastExtension(host: host, embedded: embedded) == original + ".broadcast", "Original extension")
    host["CFBundleIdentifier"] = actual; host["ALTBundleIdentifier"] = original
    embedded["CFBundleIdentifier"] = actual + ".broadcast"; embedded["ALTBundleIdentifier"] = original + ".broadcast"
    check(DirectInstallationIdentifiers.broadcastExtension(host: host, embedded: embedded) == actual + ".broadcast", "Installed ID, not stale preference")
    let good = embedded
    for badID in ["org.other.broadcast", actual + "evil.broadcast", actual + ".broadcast\n", "$(VALUE)"] {
        embedded["CFBundleIdentifier"] = badID
        check(DirectInstallationIdentifiers.broadcastExtension(host: host, embedded: embedded) == nil, "Foreign or malformed extension rejected")
    }
    embedded = good; embedded.removeValue(forKey: "ALTBundleIdentifier")
    check(DirectInstallationIdentifiers.broadcastExtension(host: host, embedded: embedded) == nil, "Missing original identity rejected")
    embedded = good; embedded["NSExtension"] = ["NSExtensionPointIdentifier": "unrelated"]
    check(DirectInstallationIdentifiers.broadcastExtension(host: host, embedded: embedded) == nil, "Wrong extension type rejected")
    embedded = good; host["ALTBundleIdentifier"] = "org.other.host"
    check(DirectInstallationIdentifiers.broadcastExtension(host: host, embedded: embedded) == nil, "Foreign original host rejected")
}

run("Packaged bundle discovery opens only the fixed embedded broadcast extension") {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("cabin-bundle-fixtures-" + UUID().uuidString, isDirectory: true)
    for mode in ["valid", "missing", "foreign"] {
        let hostID = "org.fixture." + mode
        let app = root.appendingPathComponent(mode + ".app", isDirectory: true)
        try FileManager.default.createDirectory(at: app, withIntermediateDirectories: true)
        let host: [String: Any] = ["CFBundleIdentifier": hostID, "CFBundlePackageType": "APPL", "CFBundleExecutable": "CabinDirect",
                                  "TCBroadcastExtensionIdentifier": hostID + ".broadcast"]
        let data = try PropertyListSerialization.data(fromPropertyList: host, format: .xml, options: 0)
        try data.write(to: app.appendingPathComponent("Info.plist"))
        if mode != "missing" {
            let ext = app.appendingPathComponent("PlugIns/DirectBroadcastExtension.appex", isDirectory: true)
            try FileManager.default.createDirectory(at: ext, withIntermediateDirectories: true)
            let info: [String: Any] = ["CFBundleIdentifier": mode == "foreign" ? "org.unrelated.broadcast" : hostID + ".broadcast",
                "CFBundlePackageType": "XPC!", "CFBundleExecutable": "DirectBroadcastExtension", "NSExtension": [
                    "NSExtensionPointIdentifier": "com.apple.broadcast-services-upload",
                    "RPBroadcastProcessMode": "RPBroadcastProcessModeSampleBuffer",
                    "NSExtensionPrincipalClass": "DirectBroadcastExtension.DirectSampleHandler"]]
            try PropertyListSerialization.data(fromPropertyList: info, format: .xml, options: 0).write(to: ext.appendingPathComponent("Info.plist"))
        }
        guard let bundle = Bundle(url: app) else { check(false, "Fixture bundle opens"); continue }
        let result = DirectInstallationIdentifiers.bundledBroadcastExtension(in: bundle)
        check(result == (mode == "valid" ? hostID + ".broadcast" : nil), "Packaged discovery result")
    }
}

run("Privacy defaults and settings roundtrip") {
    let settings = try DirectSettings().validated()
    check(settings.lyricMode == .mirror, "OCR is opt-in")
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

run("V1 settings discard legacy vehicle access and unknown modes") {
    for value in ["teslaMedia", "future-mode"] {
        let legacy = Data("{\"lyricMode\":\"\(value)\",\"vin\":\"SYNTHETIC-OLD-DATA\",\"onlineLyrics\":true}".utf8)
        let settings = try JSONDecoder().decode(DirectSettings.self, from: legacy).validated()
        check(settings.lyricMode == .mirror, "Removed modes fall back to screen sharing")
        let encoded = try JSONSerialization.jsonObject(with: JSONEncoder().encode(settings)) as! [String: Any]
        check(encoded["vin"] == nil && encoded["onlineLyrics"] == nil && encoded["mediaTimeUnit"] == nil, "Old vehicle/network fields are not retained")
    }
    let minimal = try JSONDecoder().decode(DirectSettings.self, from: Data("{}".utf8)).validated()
    check(minimal == DirectSettings(), "Missing optional configuration has safe defaults")
    check(DirectLyricMode.allCases.count == 2, "Only two V1 display modes are exposed")
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

run("IPv6 literal discovery and browser URL formatting") {
    for value in ["fd12:3456::1", "fc00::1", "2001:db8::1234", "2a01:abcd:1234::2"] {
        check(DirectNetworkAddresses.localIPv6(value), "Unscoped local-interface IPv6 unicast shape accepted")
        check(DirectNetworkAddresses.url(address: value, port: 8787) == "http://[\(value)]:8787", "IPv6 URLs use brackets")
    }
    for value in ["::", "::1", "ff02::1", "fe80::1", "fe80::1%en0", "::ffff:192.168.1.1", "2001:db8::1:bad::2", "example.test", "[fd00::1]", "fd00::1/path"] {
        check(!DirectNetworkAddresses.localIPv6(value), "Unsupported/scoped/malformed URL address omitted")
        check(DirectNetworkAddresses.url(address: value, port: 8787) == nil, "No guessed or unsafe URL")
    }
    check(DirectNetworkAddresses.url(address: "192.168.1.2", port: 8787) == "http://192.168.1.2:8787", "IPv4 format remains compatible")
    check(DirectNetworkAddresses.url(address: "8.8.8.8", port: 8787) == nil, "Public IPv4 not advertised")
    check(DirectNetworkAddresses.url(address: "192.168.1.2", port: 0) == nil, "No URL before listener port is assigned")
    let urls = DirectNetworkAddresses.urls(addresses: ["fd00::1", "192.168.1.2", "fd00::1", "bad"], port: 8787)
    check(urls.count == 2, "Discovery URLs are bounded to valid, unique literals")
}

run("Automatic local networks use only observed hotspot Wi-Fi and shared-hotspot addresses") {
    let hotspot = DirectInterfaceAddress(interface: "bridge101", address: "172.20.10.1")
    let wifi = DirectInterfaceAddress(interface: "en1", address: "192.168.5.24")
    let sharedHotspot = DirectInterfaceAddress(interface: "en0", address: "192.168.43.12")
    let ipv6 = DirectInterfaceAddress(interface: "en1", address: "fd12:3456::10")
    for input in [[hotspot], [wifi], [sharedHotspot], [ipv6], [wifi, hotspot, ipv6]] {
        let result = DirectNetworkAddresses.prioritized(input)
        check(Set(result) == Set(input), "Only observed candidates survive, no guessed gateway")
        check(result == DirectNetworkAddresses.prioritized(Array(input.reversed())), "Enumeration order does not affect choice")
        check(!DirectNetworkAddresses.urls(addresses: result.map(\.address), port: 8787).isEmpty, "Each supported fixture yields actual literal URLs")
    }
    let preferred = DirectNetworkAddresses.prioritized([wifi, ipv6, hotspot])
    check(preferred.first == hotspot, "Observed hotspot bridge IPv4 is a first candidate, not proof of reachability")
    let urls = DirectNetworkAddresses.urls(addresses: preferred.map(\.address) + [hotspot.address], port: 8787)
    check(urls == ["http://172.20.10.1:8787", "http://192.168.5.24:8787", "http://[fd12:3456::10]:8787"], "Stable unique IPv4 first with IPv6 fallback")
    check(DirectNetworkAddresses.prioritized([]).isEmpty, "No fabricated hotspot address when no interface exists")
    check(DirectNetworkAddresses.urls(addresses: [hotspot.address], port: 0).isEmpty, "No advertised URL before listener readiness")
}

run("Automatic discovery excludes tunnels and peer links while keeping complete bounded snapshots") {
    for name in ["utun2", "tun0", "tap1", "ipsec0", "ppp0", "pdp_ip0", "lo0", "awdl0", "llw0", "gif0", "stf0", ""] {
        check(!DirectNetworkAddresses.usableInterface(name), "Non-local receiver interface excluded")
        check(DirectNetworkAddresses.prioritized([.init(interface: name, address: "10.1.2.3")]).isEmpty, "Private address alone does not make a tunnel usable")
    }
    let pairs = [DirectInterfaceAddress(interface: "en0", address: "192.168.5.1"), .init(interface: "bridge103", address: "192.168.5.1")]
    let snapshot = DirectNetworkAddresses.prioritized(pairs + pairs)
    check(snapshot.count == 2, "Interface identity retained even with equal literals")
    check(DirectNetworkAddresses.urls(addresses: snapshot.map(\.address), port: 8787).count == 1, "Displayed URL is deduplicated independently")
    check(!DirectNetworkAddresses.matches(initial: snapshot, current: [pairs[0]]), "Interface disappearance cannot be hidden by URL deduplication")
    check(DirectNetworkAddresses.prioritized([.init(interface: "en0", address: "8.8.8.8")]).isEmpty, "No public IPv4 advertisement")
    let excessive = (1...17).map { DirectInterfaceAddress(interface: "en0", address: "192.168.5.\($0)") }
    check(DirectNetworkAddresses.prioritized(excessive).isEmpty, "Too many candidates fail closed rather than truncate transition snapshot")
}

run("Network transitions require a new user session instead of stale IPv6 advertisements") {
    let first = DirectInterfaceAddress(interface: "en0", address: "2001:db8::1")
    let second = DirectInterfaceAddress(interface: "en0", address: "2001:db8::2")
    let ipv4 = DirectInterfaceAddress(interface: "en0", address: "192.168.1.20")
    check(DirectNetworkAddresses.matches(initial: [first, ipv4], current: [ipv4, first]), "Enumeration order does not change the network")
    check(!DirectNetworkAddresses.matches(initial: [first], current: [second]), "Rotated IPv6 cannot be advertised against an old allowlist")
    check(!DirectNetworkAddresses.matches(initial: [ipv4], current: [first, ipv4]), "New interface address requires restart")
    check(!DirectNetworkAddresses.matches(initial: [first], current: []), "Lost network requires restart")
    check(!DirectNetworkAddresses.matches(initial: [], current: []), "No network is not a valid session")
}

run("Stop requests are current-session scoped and expire without affecting future sessions") {
    let now = 1_800_000_000.0
    let session = try DirectBroadcastSession.fresh(settings: DirectSettings(), now: now)
    let valid = DirectStopRequest(sessionID: session.id, requestedAt: now + 1)
    check(valid.matches(session, now: now + 2), "Current request accepted")
    check(!valid.matches(session, now: now + 32), "Stale request rejected")
    check(!valid.matches(session, now: session.expiresAt), "Expired session rejected")
    check(!DirectStopRequest(sessionID: "different-session", requestedAt: now + 1).matches(session, now: now + 2), "Different session rejected")
    check(!DirectStopRequest(sessionID: session.id, requestedAt: now - 1).matches(session, now: now + 2), "Request older than session rejected")
    check(!DirectStopRequest(sessionID: session.id, requestedAt: now + 20).matches(session, now: now + 2), "Future request rejected")
    check(!DirectStopRequest(sessionID: session.id, requestedAt: .nan).matches(session, now: now + 2), "Nonfinite request rejected")
    let next = try DirectBroadcastSession.fresh(settings: DirectSettings(), now: now + 3)
    check(!valid.matches(next, now: now + 4), "Old request cannot stop next session")
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
