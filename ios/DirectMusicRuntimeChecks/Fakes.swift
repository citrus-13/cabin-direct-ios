import Foundation
import CoreMedia
import AVFAudio

// Test doubles only: no ReplayKit, Shazam framework, URLSession, audio or network.
struct DirectRecognizedTrack {
    let title: String
    let artist: String
    let position: Double
    let observedAt: Double
    let recognitionID: String
}

final class DirectMusicRecognizer {
    private static let registry = NSLock()
    private static var instance: DirectMusicRecognizer?
    private static var creations = 0
    static var constructionCount: Int {
        registry.lock(); defer { registry.unlock() }; return creations
    }
    static var latest: DirectMusicRecognizer {
        registry.lock(); defer { registry.unlock() }; return instance!
    }
    private let lock = NSLock()
    private var stopped = false
    private var pcmAppends = 0
    let continuousNoMatch: Bool
    var isStopped: Bool { lock.lock(); defer { lock.unlock() }; return stopped }
    var pcmAppendCount: Int { lock.lock(); defer { lock.unlock() }; return pcmAppends }
    private let match: (DirectRecognizedTrack) -> Void
    private let status: (String) -> Void
    private let activity: ((Double) -> Void)?
    init(onMatch: @escaping (DirectRecognizedTrack) -> Void, onStatus: @escaping (String) -> Void,
         onAudioActivity: ((Double) -> Void)? = nil, continuousNoMatch: Bool = false) {
        match = onMatch; status = onStatus; activity = onAudioActivity
        self.continuousNoMatch = continuousNoMatch
        Self.registry.lock(); Self.instance = self; Self.creations += 1; Self.registry.unlock()
    }
    func append(_ sample: CMSampleBuffer) {}
    func appendPCM(_ buffer: AVAudioPCMBuffer) { lock.lock(); pcmAppends += 1; lock.unlock() }
    func tick() {}
    func setPaused(_ value: Bool) {}
    func stop() { lock.lock(); stopped = true; lock.unlock() }
    // Deliberately deliver even after stop/pause: exercise coordinator rejection.
    func emitStatus(_ value: String) { status(value) }
    func emitActivity(_ timestamp: Double = Date().timeIntervalSince1970) { activity?(timestamp) }
    func emitMatch(id: String, title: String = "Same fixture title", observedAt: Double = Date().timeIntervalSince1970) {
        match(.init(title: title, artist: "Fixture artist", position: 8, observedAt: observedAt, recognitionID: id))
    }
}

struct DirectLyricTimeline {
    let marker: String
    func visible(at position: Double) -> [String] { [marker] }
}

final class DirectLyricsClient {
    private static let registry = NSLock()
    private static var instance: DirectLyricsClient?
    static var latest: DirectLyricsClient {
        registry.lock(); defer { registry.unlock() }; return instance!
    }
    private let lock = NSLock()
    private var callbacks: [(Result<DirectLyricTimeline, Error>) -> Void] = []
    private var stopped = false
    var isStopped: Bool { lock.lock(); defer { lock.unlock() }; return stopped }
    var requestCount: Int { lock.lock(); defer { lock.unlock() }; return callbacks.count }
    init() { Self.registry.lock(); Self.instance = self; Self.registry.unlock() }
    func lookup(title: String, artist: String, duration: Double?,
                completion: @escaping (Result<DirectLyricTimeline, Error>) -> Void) {
        lock.lock(); callbacks.append(completion); lock.unlock()
    }
    func cancel() {} // Keep delayed callbacks available to simulate a cancellation race.
    func stop() { lock.lock(); stopped = true; lock.unlock() }
    func complete(_ index: Int, marker: String) {
        lock.lock(); let callback = callbacks[index]; lock.unlock()
        callback(.success(.init(marker: marker)))
    }
}
