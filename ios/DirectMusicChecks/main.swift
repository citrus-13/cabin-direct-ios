import Foundation

// Offline, synthetic-data acceptance only. Never instantiate a network client,
// Shazam session, ReplayKit recorder, microphone or vehicle connection here.
var failures = 0
var cases = 0
func check(_ condition: @autoclosure () -> Bool, _ label: String) {
    if !condition() { failures += 1; print("FAIL: \(label)") }
}
func run(_ name: String, _ body: () throws -> Void) {
    cases += 1
    let before = failures
    do { try body() } catch { failures += 1; print("FAIL: \(name) threw unexpected error") }
    print("\(before == failures ? "PASS" : "FAIL") \(name)")
}
func imported(_ value: String) -> DirectTrackImport? {
    URL(string: value).flatMap(DirectTrackImport.parse)
}
func trackURL(title: String = "Synthetic Song", artist: String = "Test Artist", position: String? = nil) -> String {
    var parts = URLComponents(string: "cabin-direct://track")!
    parts.queryItems = [.init(name: "title", value: title), .init(name: "artist", value: artist)]
    if let position { parts.queryItems?.append(.init(name: "position", value: position)) }
    return parts.url!.absoluteString
}
func rejectsSettings(_ change: (inout DirectSettings) -> Void, _ label: String) {
    var value = DirectSettings(); change(&value)
    do { _ = try value.validated(); check(false, label) } catch {}
}
func clock(source: String = "shazam", position: Double = 10, matchedAt: Double = 1_000) -> DirectMusicClock? {
    DirectMusicClock(title: "Synthetic Song", artist: "Test Artist", source: source, position: position, matchedAt: matchedAt)
}

run("Track import accepts Unicode metadata, trims edges and defaults position to zero") {
    let value = imported(trackURL(title: "  测试曲目 + &  ", artist: "  Artiste é  "))
    check(value?.title == "测试曲目 + &", "Decoded Unicode and punctuation")
    check(value?.artist == "Artiste é", "Trimmed artist")
    check(value?.position == 0, "Default position")
    check(imported("cabin-direct://track/?title=Fixture&artist=Artist") != nil, "Single slash allowed")
}
run("Track import permits finite boundary positions only") {
    for value in ["0", "0.25", "86400"] {
        check(imported(trackURL(position: value))?.position == Double(value), "Valid position \(value)")
    }
    for value in ["", "-1", "86400.01", "NaN", "inf", "-inf", "1e309", "text"] {
        check(imported(trackURL(position: value)) == nil, "Invalid numeric position rejected")
    }
}
run("Track import rejects foreign origins, credentials, ports, fragments and nested paths") {
    let suffix = "?title=Fixture&artist=Artist"
    for prefix in ["https://track", "cabin-direct://other", "cabin-direct://user@track", "cabin-direct://user:pass@track",
                   "cabin-direct://track:8787", "cabin-direct://track/nested", "cabin-direct://track//"] {
        check(imported(prefix + suffix) == nil, "Unexpected URL structure rejected")
    }
    check(imported("cabin-direct://track" + suffix + "#fragment") == nil, "Fragment rejected")
}
run("Track import rejects missing, duplicate, unknown and case-changed parameters") {
    for query in ["title=Fixture", "artist=Artist", "title=Fixture&artist=Artist&title=Other",
                  "title=Fixture&artist=Artist&position=0&position=1", "title=Fixture&artist=Artist&network=true",
                  "title=Fixture&artist=Artist&capture=true", "Title=Fixture&artist=Artist", "title&artist=Artist"] {
        check(imported("cabin-direct://track?" + query) == nil, "Malformed query rejected")
    }
}
run("Track import enforces text and complete URL bounds") {
    for value in ["", "   ", String(repeating: "a", count: 201), "bad\nline", "bad\u{0000}line", "bad\tline"] {
        check(imported(trackURL(title: value)) == nil, "Invalid title rejected")
        check(imported(trackURL(artist: value)) == nil, "Invalid artist rejected")
    }
    check(imported(trackURL(title: String(repeating: "a", count: 200))) != nil, "200-character title allowed")
    let oversized = trackURL(title: String(repeating: "🎵", count: 200), artist: String(repeating: "🎵", count: 200))
    check(oversized.utf8.count > 4096 && imported(oversized) == nil, "URL byte cap enforced independently")
}
run("Fresh settings have both optional services off") {
    let value = try DirectSettings().validated()
    check(value.musicMode == .off, "Recognition/manual mode disabled")
    check(!value.networkLyricsAllowed, "Network lyrics consent false")
    check(value.lyricMode == .mirror, "Visible-text OCR disabled")
}
run("Old and unknown settings migrate without enabling optional access") {
    for json in ["{}", "{\"lyricMode\":\"vehicle\"}", "{\"musicMode\":\"future-mode\",\"lyricMode\":\"tesla\"}"] {
        let value = try JSONDecoder().decode(DirectSettings.self, from: Data(json.utf8))
        check(value.musicMode == .off && !value.networkLyricsAllowed, "Migration leaves music/network off")
        check(value.lyricMode == .mirror, "Legacy vehicle mode does not migrate to access")
    }
}
run("Explicit opt-ins survive a settings round trip but malformed consent fails closed") {
    var value = DirectSettings(); value.musicMode = .manual; value.networkLyricsAllowed = true
    value.musicTitle = "Synthetic Song"; value.musicArtist = "Test Artist"; value.musicPosition = 2.5
    let decoded = try JSONDecoder().decode(DirectSettings.self, from: JSONEncoder().encode(value))
    let validated = try decoded.validated()
    check(validated == value, "Explicit valid user choices preserved")
    for json in ["{\"networkLyricsAllowed\":\"true\"}", "{\"networkLyricsAllowed\":1}", "{\"musicMode\":true}"] {
        do { _ = try JSONDecoder().decode(DirectSettings.self, from: Data(json.utf8)); check(false, "Malformed consent rejected") } catch {}
    }
}
run("Manual settings require both valid metadata fields") {
    for text in ["", "   ", "bad\nline", String(repeating: "x", count: 201)] {
        rejectsSettings({ $0.musicMode = .manual; $0.musicTitle = text; $0.musicArtist = "Artist" }, "Invalid manual title")
        rejectsSettings({ $0.musicMode = .manual; $0.musicTitle = "Song"; $0.musicArtist = text }, "Invalid manual artist")
    }
}
run("Settings reject nonfinite, negative or beyond-day music positions in every mode") {
    for mode in DirectMusicMode.allCases {
        for position in [Double.nan, .infinity, -.infinity, -0.01, 86_400.01] {
            rejectsSettings({ $0.musicMode = mode; $0.musicTitle = "Song"; $0.musicArtist = "Artist"; $0.musicPosition = position }, "Invalid settings position")
        }
    }
}
run("Music clock admits only valid bounded metadata and known sources") {
    for source in ["", "spotify", "Shazam"] { check(clock(source: source) == nil, "Unknown source rejected") }
    for position in [Double.nan, .infinity, -1, 86_401] { check(clock(position: position) == nil, "Invalid clock position") }
    for timestamp in [Double.nan, .infinity, -1, 0] { check(clock(matchedAt: timestamp) == nil, "Invalid observation time") }
    check(DirectMusicClock(title: "", artist: "Artist", source: "manual", position: 0, matchedAt: 1) == nil, "Empty metadata rejected")
    check(clock(position: 86_400) != nil, "Position upper boundary allowed")
}
run("Shazam clock does not progress through silence or missing audio") {
    let value = clock()!
    check(value.estimate(at: 1_001, lastAudioAt: nil) == nil, "No audio activity means no estimate")
    check(value.estimate(at: 1_004, lastAudioAt: 1_000) == nil, "Silence older than three seconds hidden")
    check(value.estimate(at: 1_003, lastAudioAt: 1_000) == 13, "Three-second audio boundary")
    check(value.estimate(at: 1_003.001, lastAudioAt: 1_000) == nil, "Beyond audio boundary hidden")
}
run("Shazam clock rejects future, nonfinite and pre-observation audio timestamps") {
    let value = clock()!
    for timestamp in [Double.nan, .infinity, 1_002, 996.999] {
        check(value.estimate(at: 1_001, lastAudioAt: timestamp) == nil, "Invalid/future/old audio hidden")
    }
    check(value.estimate(at: 1_000, lastAudioAt: 997) == 10, "Exactly three seconds before observation allowed")
    for now in [Double.nan, .infinity, 999] { check(value.estimate(at: now, lastAudioAt: 999) == nil, "Invalid/future observation hidden") }
}
run("Shazam metadata expires even if fresh audio continues") {
    let value = clock()!
    check(value.estimate(at: 1_030, lastAudioAt: 1_030) == 40, "Thirty-second recognition boundary")
    check(value.estimate(at: 1_030.001, lastAudioAt: 1_030.001) == nil, "Stale match hidden")
}
run("Manual estimates require no app audio but expire at ten minutes") {
    let value = clock(source: "manual")!
    check(value.estimate(at: 1_000, lastAudioAt: nil) == 10, "Manual start")
    check(value.estimate(at: 1_600, lastAudioAt: nil) == 610, "Ten-minute boundary")
    check(value.estimate(at: 1_600.001, lastAudioAt: 1_600.001) == nil, "Manual stale despite audio")
    check(value.estimate(at: 999, lastAudioAt: nil) == nil, "Manual future observation hidden")
}
run("Estimated positions never advance beyond one day") {
    for source in ["shazam", "manual"] {
        let value = clock(source: source, position: 86_399)!
        check(value.estimate(at: 1_001, lastAudioAt: 1_001) == 86_400, "Final valid second")
        check(value.estimate(at: 1_001.001, lastAudioAt: 1_001.001) == nil, "Beyond-day estimate hidden")
    }
}
run("Retry-After missing, malformed, negative and small values never bypass sixty-second cooldown") {
    let now = Date(timeIntervalSince1970: 1_000)
    for header: String? in [nil, "", "garbage", "NaN", "inf", "-1", "0", "1", "59", "1e309"] {
        let delay = DirectLyricsRetry.delay(header: header, now: now)
        check(delay.isFinite && delay >= 60, "Conservative fallback/minimum")
    }
    check(DirectLyricsRetry.delay(header: "120", now: now) == 120, "Numeric cooldown preserved")
}
run("Retry-After HTTP dates use explicit deterministic now and preserve a sixty-second floor") {
    let now = Date(timeIntervalSince1970: 1_000)
    check(DirectLyricsRetry.delay(header: "Thu, 01 Jan 1970 00:20:00 GMT", now: now) == 200, "Future HTTP date")
    check(DirectLyricsRetry.delay(header: "Thu, 01 Jan 1970 00:16:50 GMT", now: now) >= 60, "Near-future date minimum")
    check(DirectLyricsRetry.delay(header: "Thu, 01 Jan 1970 00:00:00 GMT", now: now) >= 60, "Past date minimum")
}

print("Offline music native acceptance: \(cases) cases, \(failures) failures")
if failures != 0 { exit(1) }
