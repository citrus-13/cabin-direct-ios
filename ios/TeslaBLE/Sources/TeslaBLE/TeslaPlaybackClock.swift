import Foundation

/// Display state derived only from authenticated media observations supplied by the caller.
public struct TeslaPlaybackSnapshot: Sendable, Equatable {
    public let title: String
    public let artist: String
    public let duration: Double?
    public let position: Double?
    public let playing: Bool?
    public let observedAt: Double
    public let stale: Bool
    /// Metadata identity, not a recording/version identifier or a protocol authenticity proof.
    public let identity: String
    public let canScroll: Bool
}

/// A bounded display clock; it never authenticates a message or substitutes for the BLE session.
/// `now` and `observedAt` must share the same seconds-based clock.
public struct TeslaPlaybackClock: Sendable {
    private var current: TeslaMediaTrack?
    private var lastAcceptedObservation: Double = 0

    public init() {}

    /// The caller must supply only media obtained from the authenticated Tesla session.
    /// Rejecting an old/duplicate packet does not refresh the current observation. Malformed
    /// incoming data invalidates display state, retaining the high-water mark until reset.
    @discardableResult
    public mutating func accept(_ track: TeslaMediaTrack, at now: Double) -> Bool {
        let title = (track.title ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let artist = (track.artist ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard now.isFinite, now > 0,
              track.observedAt.isFinite, track.observedAt > 0, track.observedAt <= now,
              title.count <= 200, artist.count <= 200,
              track.duration.map({ $0.isFinite && $0 >= 0 && $0 <= 86_400 }) ?? true,
              track.position.map({ $0.isFinite && $0 >= 0 && $0 <= 86_400 }) ?? true else {
            current = nil
            return false
        }
        if let duration = track.duration, let position = track.position, position > duration + 2 {
            current = nil
            return false
        }
        guard now - track.observedAt <= 3, track.observedAt > lastAcceptedObservation else {
            return false
        }
        // Never merge: even a same-title recording or a response without timing replaces all fields.
        current = TeslaMediaTrack(title: title, artist: artist, duration: track.duration,
                                  position: track.position, playing: track.playing,
                                  observedAt: track.observedAt)
        lastAcceptedObservation = track.observedAt
        return true
    }

    public mutating func reset() {
        current = nil
        lastAcceptedObservation = 0
    }

    public func snapshot(at now: Double) -> TeslaPlaybackSnapshot {
        guard let track = current, now.isFinite, now >= track.observedAt,
              now - track.observedAt <= 6 else {
            return TeslaPlaybackSnapshot(title: "", artist: "", duration: nil, position: nil,
                                         playing: nil, observedAt: lastAcceptedObservation,
                                         stale: true, identity: "", canScroll: false)
        }
        let title = track.title ?? ""
        let artist = track.artist ?? ""
        var position = track.position
        if let observedPosition = position, track.playing == true {
            position = min(observedPosition + (now - track.observedAt), 86_400)
        }
        if let duration = track.duration, let displayedPosition = position {
            position = min(displayedPosition, duration)
        }
        // Length prefixes avoid delimiter collisions in title/artist. This is not version proof.
        let durationIdentity = track.duration.map { String($0) } ?? "unknown"
        let identity = "\(title.utf8.count):\(title)\(artist.utf8.count):\(artist):\(durationIdentity)"
        return TeslaPlaybackSnapshot(title: title, artist: artist, duration: track.duration,
                                     position: position, playing: track.playing,
                                     observedAt: track.observedAt, stale: false, identity: identity,
                                     canScroll: !title.isEmpty && position != nil && track.playing != nil)
    }
}
