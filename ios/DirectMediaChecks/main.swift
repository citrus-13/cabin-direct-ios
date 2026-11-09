// Foundation-only writer checks: suitable for macOS/Linux Swift. No codecs,
// microphone, network, signing or platform playback claims.
import Foundation

func check(_ value: @autoclosure () -> Bool, _ message: String) { if !value() { fatalError(message) } }
func rejects(_ label: String, _ operation: () throws -> Void) {
    do { try operation(); fatalError("Expected rejection: " + label) } catch {}
}
struct Box { let type: String; let start: Int; let body: Int; let end: Int }
func integer(_ data: Data, _ offset: Int, _ count: Int = 4) -> UInt64 {
    check(offset >= 0 && count > 0 && offset + count <= data.count, "integer bounds")
    return data[offset..<(offset + count)].reduce(0) { ($0 << 8) | UInt64($1) }
}
func boxes(_ data: Data, _ range: Range<Int>? = nil) -> [Box] {
    let range = range ?? 0..<data.count
    var cursor = range.lowerBound, result: [Box] = []
    while cursor < range.upperBound {
        check(cursor + 8 <= range.upperBound, "short box")
        let length = Int(integer(data, cursor))
        check(length >= 8 && length <= range.upperBound - cursor, "box exceeds parent")
        result.append(Box(type: String(data: data[(cursor + 4)..<(cursor + 8)], encoding: .ascii)!, start: cursor, body: cursor + 8, end: cursor + length))
        cursor += length
    }
    return result
}

let video = MP4VideoConfiguration(width: 960, height: 540, sps: Data([0x67, 0x42, 0, 0x1e, 0, 1]), pps: Data([0x68, 1]))
let audio = MP4AudioConfiguration(sampleRate: 48000, channels: 2, audioSpecificConfig: Data([0x11, 0x90]))
let videoInit = try FragmentedMP4.initialization(video: video, audio: nil)
let mixedInit = try FragmentedMP4.initialization(video: video, audio: audio)
check(video.codec == "avc1.42001E", "RFC6381 codec derived from actual SPS")
for (data, count) in [(videoInit, 1), (mixedInit, 2)] {
    let top = boxes(data)
    check(top.map(\.type) == ["ftyp", "moov"], "init boxes")
    let movie = boxes(data, top[1].body..<top[1].end)
    check(movie.filter { $0.type == "trak" }.count == count, "track count")
    check(movie.contains { $0.type == "mvex" }, "fragment defaults absent")
    check(data.count <= 64 * 1024, "init cap")
}
print("PASS video-only/muxed init bounds and actual AVC codec descriptor")

let v1 = MP4MediaSample(data: Data([0, 0, 0, 2, 0x65, 0x88]), decodeTime: 90_000, duration: 3750, sync: true)
let v2 = MP4MediaSample(data: Data([0, 0, 0, 1, 0x41]), decodeTime: 93_750, duration: 3750, sync: false)
let a1 = MP4MediaSample(data: Data([0x21, 0x10]), decodeTime: 48_000, duration: 1024, sync: true)
let a2 = MP4MediaSample(data: Data([0x21, 0x11, 0x12]), decodeTime: 49_024, duration: 1024, sync: true)
let fragment = try FragmentedMP4.fragment(sequence: 1, video: [v1, v2], audio: [a1, a2])
let top = boxes(fragment)
check(top.map(\.type) == ["moof", "mdat"], "fragment boxes")
let fragments = boxes(fragment, top[0].body..<top[0].end).filter { $0.type == "traf" }
check(fragments.count == 2, "muxed tracks absent")
var expectedPayload = top[1].body
for (track, expectedID, expectedTime, samples) in [(fragments[0], 1, UInt64(90_000), [v1, v2]), (fragments[1], 2, UInt64(48_000), [a1, a2])] {
    let children = boxes(fragment, track.body..<track.end)
    let tfhd = children.first { $0.type == "tfhd" }!
    let tfdt = children.first { $0.type == "tfdt" }!
    let trun = children.first { $0.type == "trun" }!
    check(integer(fragment, tfhd.body) == 0x020000, "tfhd must use default-base-is-moof")
    check(integer(fragment, tfhd.body + 4) == expectedID, "track identity")
    check(fragment[tfdt.body] == 1 && integer(fragment, tfdt.body + 4, 8) == expectedTime, "64bit tfdt")
    check(integer(fragment, trun.body) == 0x000701, "trun duration/size/flags/offset fields")
    check(integer(fragment, trun.body + 4) == 2, "sample count")
    check(integer(fragment, trun.body + 8) == expectedPayload, "movie relative payload offset")
    for (index, sample) in samples.enumerated() {
        let entry = trun.body + 12 + index * 12
        check(integer(fragment, entry) == sample.duration, "sample duration")
        check(integer(fragment, entry + 4) == sample.data.count, "sample byte size")
        check(integer(fragment, entry + 8) == (sample.sync ? 0x02000000 : 0x01010000), "sample sync flags")
        check(fragment[expectedPayload..<(expectedPayload + sample.data.count)] == sample.data, "sample payload preserved")
        expectedPayload += sample.data.count
    }
}
check(expectedPayload == fragment.count, "mdat does not exactly cover runs")
print("PASS sample durations/sync flags/byte offsets and exact multiplexed payloads")

let future = MP4MediaSample(data: v1.data, decodeTime: UInt64(UInt32.max) + 12345, duration: 3750, sync: true)
let futureFragment = try FragmentedMP4.fragment(sequence: 2, video: [future], audio: [])
let futureMoof = boxes(futureFragment)[0]
let futureTraf = boxes(futureFragment, futureMoof.body..<futureMoof.end).first { $0.type == "traf" }!
let futureTfdt = boxes(futureFragment, futureTraf.body..<futureTraf.end).first { $0.type == "tfdt" }!
check(integer(futureFragment, futureTfdt.body + 4, 8) == future.decodeTime, "decode clock truncated to32bits")
print("PASS 64bit source timeline survives UInt32 rollover")

rejects("odd dimensions") { _ = try FragmentedMP4.initialization(video: .init(width: 959, height: 540, sps: video.sps, pps: video.pps), audio: nil) }
rejects("oversized dimensions") { _ = try FragmentedMP4.initialization(video: .init(width: 1920, height: 1080, sps: video.sps, pps: video.pps), audio: nil) }
rejects("invalid SPS") { _ = try FragmentedMP4.initialization(video: .init(width: 960, height: 540, sps: Data([1, 2, 3, 4]), pps: video.pps), audio: nil) }
rejects("audio rate exceeds sample entry") { _ = try FragmentedMP4.initialization(video: video, audio: .init(sampleRate: 96000, channels: 2, audioSpecificConfig: audio.audioSpecificConfig)) }
rejects("unsupported channels") { _ = try FragmentedMP4.initialization(video: video, audio: .init(sampleRate: 48000, channels: 3, audioSpecificConfig: audio.audioSpecificConfig)) }
print("PASS codec dimensions/rates/channels and parameter bounds reject invalid configuration")

rejects("missing video") { _ = try FragmentedMP4.fragment(sequence: 1, video: [], audio: [a1]) }
rejects("zero sequence") { _ = try FragmentedMP4.fragment(sequence: 0, video: [v1], audio: []) }
rejects("time gap") { _ = try FragmentedMP4.fragment(sequence: 1, video: [v1, .init(data: v2.data, decodeTime: 100_000, duration: 3750, sync: false)], audio: []) }
rejects("timestamp overflow") { _ = try FragmentedMP4.fragment(sequence: 1, video: [.init(data: v1.data, decodeTime: UInt64.max, duration: 1, sync: true)], audio: []) }
rejects("oversized sample") { _ = try FragmentedMP4.fragment(sequence: 1, video: [.init(data: Data(repeating: 1, count: 512 * 1024 + 1), decodeTime: 0, duration: 1, sync: true)], audio: []) }
rejects("oversized fragment") {
    let big = Data(repeating: 1, count: 512 * 1024)
    _ = try FragmentedMP4.fragment(sequence: 1, video: [.init(data: big, decodeTime: 0, duration: 1, sync: true), .init(data: big, decodeTime: 1, duration: 1, sync: false)], audio: [])
}
print("PASS invalid sequence/gaps/overflow and memory limits fail closed")
print("Pure Swift fMP4 checks passed; no native codec/device/browser acceptance inferred.")
