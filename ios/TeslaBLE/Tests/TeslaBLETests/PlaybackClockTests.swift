import Foundation
@testable import TeslaBLE

final class PlaybackClockTests {
    private func track(_ title: String? = "Title", artist: String? = "Artist",
                       duration: Double? = 200, position: Double? = 20,
                       playing: Bool? = true, observedAt: Double = 100) -> TeslaMediaTrack {
        TeslaMediaTrack(title: title, artist: artist, duration: duration,
                        position: position, playing: playing, observedAt: observedAt)
    }

    func testExtrapolationClampsAndPauseFreezes() {
        var clock = TeslaPlaybackClock()
        expectTrue(clock.accept(track(duration: 22), at: 100))
        expectEqual(clock.snapshot(at: 101).position, 21)
        expectEqual(clock.snapshot(at: 105).position, 22)
        expectTrue(clock.accept(track(position: 30, playing: false, observedAt: 106), at: 106))
        expectEqual(clock.snapshot(at: 110).position, 30)
        expectTrue(clock.snapshot(at: 110).canScroll)
        expectEqual(clock.snapshot(at: 110).playing, false)
    }

    func testTrackChangeAndSameTrackReplaceAllFields() {
        var clock = TeslaPlaybackClock()
        expectTrue(clock.accept(track(), at: 100))
        let firstIdentity = clock.snapshot(at: 100).identity
        expectTrue(clock.accept(track("Next", artist: nil, duration: nil, position: nil,
                                      playing: nil, observedAt: 101), at: 101))
        let next = clock.snapshot(at: 102)
        expectEqual(next.title, "Next"); expectEqual(next.artist, "")
        expectNil(next.duration); expectNil(next.position); expectNil(next.playing)
        expectEqual(next.canScroll, false); expectEqual(next.stale, false)
        expectTrue(next.identity != firstIdentity)
        expectTrue(clock.accept(track("Next", observedAt: 103), at: 103))
        expectTrue(clock.accept(track("Next", duration: nil, position: nil,
                                      playing: nil, observedAt: 104), at: 104))
        expectNil(clock.snapshot(at: 104).position)
        expectNil(clock.snapshot(at: 104).duration)
    }

    func testSeeksMoveBackwardAndForward() {
        var clock = TeslaPlaybackClock()
        expectTrue(clock.accept(track(position: 80), at: 100))
        expectTrue(clock.accept(track(position: 10, observedAt: 101), at: 101))
        expectEqual(clock.snapshot(at: 102).position, 11)
        expectTrue(clock.accept(track(position: 150, observedAt: 103), at: 103))
        expectEqual(clock.snapshot(at: 104).position, 151)
    }

    func testUnknownFieldsNeverInventProgressOrPlayback() {
        var clock = TeslaPlaybackClock()
        expectTrue(clock.accept(track(position: nil), at: 100))
        expectNil(clock.snapshot(at: 102).position)
        expectEqual(clock.snapshot(at: 102).canScroll, false)
        expectTrue(clock.accept(track(playing: nil, observedAt: 103), at: 103))
        expectEqual(clock.snapshot(at: 105).position, 20)
        expectNil(clock.snapshot(at: 105).playing)
        expectEqual(clock.snapshot(at: 105).canScroll, false)
        expectTrue(clock.accept(track(duration: nil, position: 0, observedAt: 106), at: 106))
        expectEqual(clock.snapshot(at: 107).position, 1)
        expectTrue(clock.snapshot(at: 107).canScroll)
        expectTrue(clock.accept(track(nil, artist: nil, duration: nil, position: nil,
                                      playing: nil, observedAt: 108), at: 108))
        expectEqual(clock.snapshot(at: 108).title, "")
        expectEqual(clock.snapshot(at: 108).canScroll, false)
    }

    func testFreshnessUsesObservationNotReceipt() {
        var clock = TeslaPlaybackClock()
        expectTrue(clock.accept(track(), at: 103))
        expectEqual(clock.snapshot(at: 103).position, 23)
        expectEqual(clock.snapshot(at: 106).stale, false)
        let stale = clock.snapshot(at: 106.001)
        expectEqual(stale.stale, true); expectEqual(stale.title, "")
        expectEqual(stale.artist, ""); expectNil(stale.position)
        expectNil(stale.playing); expectEqual(stale.canScroll, false)
        expectEqual(stale.observedAt, 100)
        expectEqual(clock.accept(track(observedAt: 104), at: 107.001), false)
        expectTrue(clock.snapshot(at: 107.001).stale)
    }

    func testDuplicateAndOutOfOrderDoNotRefresh() {
        var clock = TeslaPlaybackClock()
        expectTrue(clock.accept(track(), at: 100))
        expectEqual(clock.accept(track("Duplicate", observedAt: 100), at: 102), false)
        expectEqual(clock.accept(track("Old", observedAt: 99), at: 102), false)
        expectEqual(clock.snapshot(at: 103).title, "Title")
        expectEqual(clock.snapshot(at: 103).observedAt, 100)
        expectTrue(clock.snapshot(at: 107).stale)
    }

    func testInvalidDataInvalidatesAndCannotResurrectOldTrack() {
        let invalidTracks = [
            track(duration: -1, observedAt: 101), track(duration: .infinity, observedAt: 101),
            track(duration: .nan, observedAt: 101), track(duration: 86_401, observedAt: 101),
            track(position: -1, observedAt: 101), track(position: .infinity, observedAt: 101),
            track(position: .nan, observedAt: 101), track(position: 202.001, observedAt: 101),
            track(String(repeating: "a", count: 201), observedAt: 101),
            track(artist: String(repeating: "人", count: 201), observedAt: 101),
            track(observedAt: .nan), track(observedAt: .infinity), track(observedAt: 0),
            track(observedAt: -1), track(observedAt: 102)
        ]
        for invalid in invalidTracks {
            var clock = TeslaPlaybackClock()
            expectTrue(clock.accept(track(), at: 100))
            expectEqual(clock.accept(invalid, at: 101), false)
            expectTrue(clock.snapshot(at: 101).stale)
            expectEqual(clock.snapshot(at: 101).title, "")
            expectEqual(clock.accept(track(), at: 101), false)
            expectTrue(clock.snapshot(at: 101).stale)
            expectTrue(clock.accept(track(observedAt: 103), at: 103))
        }
    }

    func testPositionLimitWithUnknownDuration() {
        var clock = TeslaPlaybackClock()
        expectTrue(clock.accept(track(duration: nil, position: 86_400, playing: false), at: 100))
        expectEqual(clock.snapshot(at: 101).position, 86_400)
        expectTrue(clock.snapshot(at: 101).canScroll)
        expectNil(clock.snapshot(at: 101).duration)
        expectEqual(clock.accept(track(duration: nil, position: 86_400.001, observedAt: 101), at: 101), false)
        expectTrue(clock.snapshot(at: 101).stale)
        expectNil(clock.snapshot(at: 101).position)
        expectEqual(clock.snapshot(at: 101).canScroll, false)
        expectEqual(clock.accept(track(duration: nil), at: 101), false)
        expectTrue(clock.snapshot(at: 101).stale)
        expectTrue(clock.accept(track(duration: nil, position: 12, observedAt: 102), at: 102))
        expectEqual(clock.snapshot(at: 103).position, 13)
        expectTrue(clock.accept(track(duration: nil, position: 86_400, playing: true, observedAt: 104), at: 104))
        expectEqual(clock.snapshot(at: 109).position, 86_400)
    }

    func testInvalidClockTimesFailClosedAndResetStartsEmpty() {
        for now in [Double.nan, .infinity, -.infinity, 0, -1] {
            var clock = TeslaPlaybackClock()
            expectTrue(clock.accept(track(), at: 100))
            expectTrue(clock.snapshot(at: now).stale)
            expectEqual(clock.accept(track(observedAt: 101), at: now), false)
            expectTrue(clock.snapshot(at: 101).stale)
        }
        var clock = TeslaPlaybackClock()
        expectTrue(clock.snapshot(at: 100).stale)
        expectEqual(clock.snapshot(at: 100).observedAt, 0)
        expectTrue(clock.accept(track(), at: 100))
        expectTrue(clock.snapshot(at: 99).stale)
        clock.reset()
        expectTrue(clock.snapshot(at: 100).stale)
        expectEqual(clock.snapshot(at: 100).observedAt, 0)
        expectTrue(clock.accept(track(), at: 100))
    }

    func testTextNormalizationBoundariesAndIdentity() {
        var clock = TeslaPlaybackClock()
        expectTrue(clock.accept(track(" \nTitle\t ", artist: " Artist\n", position: 202), at: 100))
        expectEqual(clock.snapshot(at: 100).title, "Title")
        expectEqual(clock.snapshot(at: 100).artist, "Artist")
        expectEqual(clock.snapshot(at: 100).position, 200)
        let first = clock.snapshot(at: 100).identity
        expectTrue(clock.accept(track(duration: 201, observedAt: 101), at: 101))
        expectTrue(first != clock.snapshot(at: 101).identity)
        expectTrue(clock.accept(track(String(repeating: "人", count: 200), duration: 86_400,
                                      observedAt: 102), at: 102))
        expectTrue(clock.accept(track(duration: 0, position: 0, observedAt: 103), at: 103))
        expectEqual(clock.snapshot(at: 104).position, 0)
        expectTrue(clock.accept(track(" ", observedAt: 105), at: 105))
        expectEqual(clock.snapshot(at: 105).canScroll, false)
    }
}
