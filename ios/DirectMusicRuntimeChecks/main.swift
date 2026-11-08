import Foundation
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

func fixture(network: Bool = true) -> (DirectMusicRuntime, RecordedStates, DirectMusicRecognizer, DirectLyricsClient) {
    var settings = DirectSettings()
    settings.musicMode = .appAudio; settings.networkLyricsAllowed = network
    let states = RecordedStates()
    let runtime = DirectMusicRuntime(settings: settings, onState: states.append)
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

print("Coordinator checks passed with fake recognition/provider; no real audio, network or signed-device acceptance.")
