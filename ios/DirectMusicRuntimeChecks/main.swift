import Foundation
import AVFAudio
import DirectCore

func check(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() { fatalError(message) }
}

final class RecordedStates {
    private let condition = NSCondition()
    private var values: [LocalMusicState] = []
    var snapshot: [LocalMusicState] { condition.lock(); defer { condition.unlock() }; return values }
    func append(_ state: LocalMusicState) {
        condition.lock(); values.append(state); condition.broadcast(); condition.unlock()
    }
    func waitCount(_ minimum: Int) {
        condition.lock(); defer { condition.unlock() }
        let deadline = Date().addingTimeInterval(3)
        while values.count < minimum {
            if !condition.wait(until: deadline) { fatalError("Timed out waiting for coordinator publication") }
        }
    }
    @discardableResult func wait(_ message: String, matching predicate: (LocalMusicState) -> Bool) -> LocalMusicState {
        condition.lock(); defer { condition.unlock() }
        let deadline = Date().addingTimeInterval(3)
        while true {
            if let value = values.last, predicate(value) { return value }
            if !condition.wait(until: deadline) { fatalError("Timed out: " + message) }
        }
    }
}

func fixture(network: Bool = true, input: DirectMusicRuntime.Input = .broadcast) -> (DirectMusicRuntime, RecordedStates, DirectMusicRecognizer, DirectLyricsClient) {
    var settings = DirectSettings()
    settings.musicMode = .appAudio; settings.networkLyricsAllowed = network
    let states = RecordedStates()
    let runtime = DirectMusicRuntime(settings: settings, input: input, onState: states.append)
    runtime.start()
    states.wait("start", matching: { $0.status == "waiting" })
    return (runtime, states, DirectMusicRecognizer.latest, DirectLyricsClient.latest)
}

// A genuine silence signal hides existing metadata and lyrics, without requiring a
// microphone or sending even synthetic sound to Apple's catalog.
do {
    let (runtime, states, recognizer, client) = fixture()
    recognizer.emitActivity(); recognizer.emitMatch(id: "silence-A")
    states.wait("lookup", matching: { $0.status == "loading" })
    client.complete(0, marker: "synthetic lyric A")
    states.wait("lyrics", matching: { $0.lines == ["synthetic lyric A"] })
    recognizer.emitStatus("no-audio")
    states.wait("silent gap clears", matching: { $0.status == "waiting" && $0.title.isEmpty && $0.lines.isEmpty })
    runtime.stop()
    check(client.requestCount == 1, "silent gap must not send another lyrics lookup")
    print("PASS silent-gap clears track and lyrics")
}

// Delayed network and recognition callbacks from before pause cannot revive the
// old track after resume, even when their wall-clock timestamps were once fresh.
do {
    let (runtime, states, recognizer, client) = fixture()
    let old = Date().timeIntervalSince1970
    recognizer.emitActivity(old); recognizer.emitMatch(id: "before-pause", observedAt: old)
    states.wait("before pause loading", matching: { $0.status == "loading" })
    runtime.setPaused(true)
    states.wait("paused", matching: { $0.status == "paused" })
    runtime.setPaused(false)
    states.wait("resumed", matching: { $0.status == "waiting" && $0.title.isEmpty })
    let resumedCount = states.snapshot.count
    recognizer.emitActivity(old); recognizer.emitMatch(id: "before-pause", observedAt: old)
    client.complete(0, marker: "OLD MUST NOT APPEAR")
    runtime.tick()
    states.waitCount(resumedCount + 1)
    check(states.snapshot.dropFirst(resumedCount).allSatisfy { $0.title.isEmpty && $0.lines.isEmpty }, "old result revived after resume")
    recognizer.emitActivity(); recognizer.emitMatch(id: "after-pause", title: "New fixture title")
    states.wait("new loading", matching: { $0.status == "loading" && $0.title == "New fixture title" })
    check(client.requestCount == 2, "resume requires a fresh request for fresh track")
    client.complete(1, marker: "NEW")
    states.wait("new result", matching: { $0.lines == ["NEW"] })
    runtime.stop()
    print("PASS pause/resume rejects old recognition and provider results")
}

// Different catalog identities must never share a title/artist-only cache entry.
do {
    let (runtime, states, recognizer, client) = fixture()
    recognizer.emitActivity(); recognizer.emitMatch(id: "recording-A")
    states.wait("A loading", matching: { $0.status == "loading" })
    client.complete(0, marker: "VERSION A")
    states.wait("A lyrics", matching: { $0.lines == ["VERSION A"] })
    recognizer.emitStatus("recognizing")
    states.wait("new recognition", matching: { $0.status == "recognizing" && $0.lines.isEmpty })
    recognizer.emitActivity(); recognizer.emitMatch(id: "recording-B")
    states.wait("B loading", matching: { $0.status == "loading" && $0.lines.isEmpty })
    check(client.requestCount == 2, "same-name different recording reused old lyrics")
    client.complete(0, marker: "LATE VERSION A")
    client.complete(1, marker: "VERSION B")
    states.wait("B lyrics", matching: { $0.lines == ["VERSION B"] })
    runtime.stop()
    check(!states.snapshot.contains { $0.lines == ["LATE VERSION A"] }, "late old recording lyrics were exposed")
    print("PASS different recording IDs do not reuse same-title lyrics")
}

do {
    let (runtime, states, recognizer, client) = fixture()
    recognizer.emitActivity(); recognizer.emitMatch(id: "")
    states.wait("missing ID first loading", matching: { $0.status == "loading" })
    client.complete(0, marker: "UNVERIFIED A")
    states.wait("missing ID first result", matching: { $0.lines == ["UNVERIFIED A"] })
    recognizer.emitActivity(); recognizer.emitMatch(id: "")
    states.wait("missing ID fresh loading", matching: { $0.status == "loading" && $0.lines.isEmpty })
    check(client.requestCount == 2, "missing catalog ID must not fall back to reusable title/artist identity")
    runtime.stop()
    print("PASS missing recording ID cannot reuse earlier timeline")
}

do {
    let (runtime, states, recognizer, client) = fixture()
    recognizer.emitActivity(); recognizer.emitMatch(id: "stop-fixture")
    states.wait("stop loading", matching: { $0.status == "loading" })
    runtime.stop()
    check(recognizer.isStopped && client.isStopped, "stop returned before stopping dependencies")
    let count = states.snapshot.count, requests = client.requestCount
    recognizer.emitActivity(); recognizer.emitMatch(id: "after-stop"); recognizer.emitStatus("recognizing")
    client.complete(0, marker: "AFTER STOP")
    runtime.tick()
    // A second idempotent synchronous stop is also a deterministic queue drain.
    runtime.stop()
    check(states.snapshot.count == count, "state callback occurred after stop returned")
    check(client.requestCount == requests, "lookup occurred after stop returned")
    print("PASS synchronous stop rejects late callbacks and lookups")
}

do {
    let (runtime, states, recognizer, client) = fixture(network: false)
    recognizer.emitActivity(); recognizer.emitMatch(id: "no-network")
    states.wait("metadata only", matching: { $0.status == "matched" && !$0.title.isEmpty })
    runtime.stop()
    check(client.requestCount == 0, "metadata consent off still sent lyrics request")
    print("PASS lyrics consent off sends no provider requests")
}

do {
    let (runtime, states, recognizer, _) = fixture()
    recognizer.emitStatus("unavailable")
    states.wait("service unavailable", matching: { $0.status == "unavailable" && $0.title.isEmpty && $0.lines.isEmpty })
    runtime.setPaused(true)
    states.wait("unavailable paused", matching: { $0.status == "paused" })
    runtime.setPaused(false)
    states.wait("unavailable remains terminal after resume", matching: { $0.status == "unavailable" && $0.message.contains("不会重试") })
    runtime.stop()
    print("PASS unavailable remains an explicit public state")
}

do {
    var settings = DirectSettings()
    settings.musicMode = .appAudio
    let started = DispatchSemaphore(value: 0), finished = DispatchSemaphore(value: 0)
    var runtime: DirectMusicRuntime!
    runtime = DirectMusicRuntime(settings: settings) { state in
        if state.status == "waiting" { started.signal() }
        if state.status == "matched" { runtime.stop(); finished.signal() }
    }
    runtime.start()
    check(started.wait(timeout: .now() + 3) == .success, "reentrant-stop fixture start")
    let recognizer = DirectMusicRecognizer.latest
    recognizer.emitActivity(); recognizer.emitMatch(id: "reentrant-stop")
    check(finished.wait(timeout: .now() + 3) == .success, "stop from onState deadlocked coordinator queue")
    check(recognizer.isStopped, "reentrant stop did not stop recognizer")
    runtime = nil
    print("PASS reentrant onState stop does not deadlock")
}

// A PCM fixture is memory-only: no engine, device, microphone permission or
// recognition service is opened. The fake counts ingress without interpreting it.
func pcmFixture() -> AVAudioPCMBuffer {
    let format = AVAudioFormat(standardFormatWithSampleRate: 48000, channels: 1)!
    let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 1024)!
    buffer.frameLength = 1024
    for index in 0..<1024 { buffer.floatChannelData![0][index] = 0.1 }
    return buffer
}

do {
    for mode in [DirectMusicMode.off, .manual] {
        var settings = DirectSettings()
        settings.musicMode = mode
        settings.musicTitle = "MANUAL MUST NOT APPEAR"; settings.musicArtist = "Fixture"
        let states = RecordedStates(), before = DirectMusicRecognizer.constructionCount
        let runtime = DirectMusicRuntime(settings: settings, input: .microphone, onState: states.append)
        runtime.start(); runtime.appendMicrophone(pcmFixture())
        // A synchronous stop drains start without requiring a nonexistent singleton.
        runtime.stop()
        check(DirectMusicRecognizer.constructionCount == before, "off/manual microphone mode created recognizer")
        check(states.snapshot.isEmpty, "off/manual microphone mode published substituted metadata")
    }
    print("PASS microphone rejects off/manual without constructing recognizer")
}

do {
    let (runtime, states, recognizer, client) = fixture(network: false, input: .microphone)
    check(recognizer.continuousNoMatch, "microphone mode did not enable continuous no-match policy")
    check(states.snapshot.last!.message.contains("麦克风"), "microphone initial caption missing acoustic provenance")
    runtime.appendMicrophone(pcmFixture())
    check(recognizer.pcmAppendCount == 1, "microphone PCM did not enter adapter")
    let observed = Date().timeIntervalSince1970
    recognizer.emitActivity(observed); recognizer.emitMatch(id: "mic-consent-off", observedAt: observed)
    let match = states.wait("mic genuine fake callback", matching: { $0.status == "matched" && !$0.title.isEmpty })
    check(match.source == "shazam" && match.matchedAt == observed, "microphone fabricated source or replaced match timestamp")
    check(match.message.contains("麦克风环境声音"), "microphone match caption claims wrong audio source")
    check(match.position != nil && match.lines.isEmpty, "microphone fabricated lyrics or lost valid clock")
    runtime.stop()
    check(client.requestCount == 0, "microphone network consent off sent lyrics request")
    print("PASS microphone fresh fake match preserves provenance/freshness with consent off")
}

do {
    let (runtime, states, recognizer, client) = fixture(input: .microphone)
    recognizer.emitActivity(); recognizer.emitMatch(id: "mic-lyrics")
    states.wait("mic lyrics loading", matching: { $0.status == "loading" && $0.lines.isEmpty })
    check(client.requestCount == 1, "consented microphone match did not request lyrics")
    client.complete(0, marker: "MIC SYNTHETIC LYRICS")
    let lyrics = states.wait("mic fake lyrics", matching: { $0.lines == ["MIC SYNTHETIC LYRICS"] })
    check(lyrics.message.contains("不是精确同步"), "microphone lyrics omitted estimated timing caveat")
    runtime.stop()
    print("PASS microphone consent allows fake provider lyrics without fabrication")
}

do {
    let (runtime, states, recognizer, client) = fixture(input: .microphone)
    let old = Date().timeIntervalSince1970
    recognizer.emitActivity(old); recognizer.emitMatch(id: "mic-old", observedAt: old)
    states.wait("mic old loading", matching: { $0.status == "loading" })
    runtime.setPaused(true)
    states.wait("mic paused", matching: { $0.status == "paused" && $0.title.isEmpty && $0.lines.isEmpty })
    let pcmBefore = recognizer.pcmAppendCount
    runtime.appendMicrophone(pcmFixture())
    check(recognizer.pcmAppendCount == pcmBefore, "paused microphone ingress still admitted PCM")
    runtime.setPaused(false)
    states.wait("mic resume", matching: { $0.status == "waiting" && $0.title.isEmpty })
    let resumedCount = states.snapshot.count
    recognizer.emitActivity(old); recognizer.emitMatch(id: "mic-old", observedAt: old)
    client.complete(0, marker: "MIC OLD MUST NOT APPEAR")
    runtime.tick(); states.waitCount(resumedCount + 1)
    check(states.snapshot.dropFirst(resumedCount).allSatisfy { $0.title.isEmpty && $0.lines.isEmpty }, "mic old generation revived after resume")
    runtime.appendMicrophone(pcmFixture())
    check(recognizer.pcmAppendCount == pcmBefore + 1, "resumed microphone failed to restore PCM ingress")
    recognizer.emitActivity(); recognizer.emitMatch(id: "mic-new", title: "New acoustic fixture")
    states.wait("mic new loading", matching: { $0.status == "loading" && $0.title == "New acoustic fixture" })
    check(client.requestCount == 2, "mic resume did not request a fresh track")
    client.complete(1, marker: "MIC NEW")
    states.wait("mic new lyrics", matching: { $0.lines == ["MIC NEW"] })
    runtime.stop()
    print("PASS microphone pause/resume invalidates old generation and gates PCM")
}

do {
    let (runtime, states, recognizer, _) = fixture(network: false, input: .microphone)
    recognizer.emitActivity(); recognizer.emitMatch(id: "mic-before-no-match")
    states.wait("mic initial match", matching: { $0.status == "matched" })
    recognizer.emitStatus("no-match")
    states.wait("mic no-match clears", matching: { $0.status == "waiting" && $0.title.isEmpty && $0.lines.isEmpty && $0.message.contains("15–60") })
    recognizer.emitStatus("recognizing")
    states.wait("mic retry recognizing", matching: { $0.status == "recognizing" && $0.message.contains("麦克风") })
    recognizer.emitActivity(); recognizer.emitMatch(id: "mic-after-no-match", title: "Fresh acoustic fixture")
    states.wait("mic fresh retry result", matching: { $0.status == "matched" && $0.title == "Fresh acoustic fixture" })
    runtime.stop()
    print("PASS microphone no-match clears old track and allows a fresh fake match")
}

do {
    let (runtime, states, recognizer, client) = fixture(input: .microphone)
    recognizer.emitActivity(); recognizer.emitMatch(id: "mic-stop")
    states.wait("mic pending provider", matching: { $0.status == "loading" })
    runtime.stop()
    let count = states.snapshot.count, pcmBefore = recognizer.pcmAppendCount
    runtime.appendMicrophone(pcmFixture())
    recognizer.emitActivity(); recognizer.emitMatch(id: "mic-after-stop"); recognizer.emitStatus("recognizing")
    client.complete(0, marker: "MIC AFTER STOP")
    runtime.tick(); runtime.stop()
    check(states.snapshot.count == count && client.requestCount == 1, "stopped mic accepted late callback or lookup")
    check(recognizer.pcmAppendCount == pcmBefore, "stopped mic ingress admitted PCM")
    check(recognizer.isStopped && client.isStopped, "mic stop failed to stop dependencies")
    print("PASS microphone stop invalidates callbacks and clears PCM ingress")
}

do {
    let (runtime, states, recognizer, client) = fixture(input: .microphone)
    recognizer.emitActivity(); recognizer.emitMatch(id: "mic-before-unavailable")
    states.wait("mic pending before unavailable", matching: { $0.status == "loading" })
    recognizer.emitStatus("unavailable")
    let unavailable = states.wait("mic unavailable", matching: { $0.status == "unavailable" && $0.title.isEmpty && $0.lines.isEmpty })
    check(unavailable.message.contains("不会付费升级") && !unavailable.message.contains("手动"), "mic unavailable suggests paid/manual success")
    runtime.setPaused(true); states.wait("mic unavailable paused", matching: { $0.status == "paused" })
    runtime.setPaused(false); states.wait("mic unavailable resumed", matching: { $0.status == "unavailable" })
    let count = states.snapshot.count, pcmBefore = recognizer.pcmAppendCount
    runtime.appendMicrophone(pcmFixture())
    recognizer.emitActivity(); recognizer.emitMatch(id: "mic-late-after-unavailable"); recognizer.emitStatus("recognizing")
    client.complete(0, marker: "MIC UNAVAILABLE MUST NOT APPEAR")
    runtime.tick(); states.waitCount(count + 1); runtime.stop()
    check(states.snapshot.dropFirst(count).allSatisfy { $0.status == "unavailable" && $0.title.isEmpty && $0.lines.isEmpty }, "unavailable mic was resurrected by late callbacks")
    check(client.requestCount == 1 && recognizer.pcmAppendCount == pcmBefore, "unavailable mic retried provider/PCM ingress")
    print("PASS microphone unavailable is terminal across late callbacks and resume")
}

print("Coordinator checks passed with fake recognition/provider; no real audio, network or signed-device acceptance.")
