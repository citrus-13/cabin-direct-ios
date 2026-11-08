import Foundation

/// A recognition offset is an estimate, never a third-party player's transport state.
struct DirectMusicClock {
    let title: String
    let artist: String
    let source: String
    let position: Double
    let matchedAt: Double

    init?(title: String, artist: String, source: String, position: Double, matchedAt: Double) {
        guard DirectTrackImport.validText(title), DirectTrackImport.validText(artist),
              ["shazam", "manual"].contains(source), position.isFinite, position >= 0, position <= 86_400,
              matchedAt.isFinite, matchedAt > 0 else { return nil }
        self.title = title; self.artist = artist; self.source = source
        self.position = position; self.matchedAt = matchedAt
    }

    func estimate(at now: Double, lastAudioAt: Double?) -> Double? {
        guard now.isFinite, now >= matchedAt,
              now - matchedAt <= (source == "shazam" ? 30 : 600) else { return nil }
        if source == "shazam" {
            guard let lastAudioAt, lastAudioAt.isFinite, lastAudioAt >= matchedAt - 3,
                  lastAudioAt <= now, now - lastAudioAt <= 3 else { return nil }
        }
        let value = position + now - matchedAt
        return value <= 86_400 ? value : nil
    }

    var key: String { title.lowercased() + "\u{1f}" + artist.lowercased() }
}
