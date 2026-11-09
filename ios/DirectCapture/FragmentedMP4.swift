import Foundation

public struct EncodedMediaInitialization {
    public let generation: String
    public let data: Data
    public let mime: String
    public let hasAudio: Bool
    public init(generation: String, data: Data, mime: String, hasAudio: Bool) {
        self.generation = generation; self.data = data; self.mime = mime; self.hasAudio = hasAudio
    }
}

public struct EncodedMediaFragment {
    public let generation: String
    public let sequence: UInt64
    public let data: Data
    public let start: Double
    public let duration: Double
    public let independent: Bool
    /// Capture freshness, not the media decode timestamp.
    public let updatedAt: Double
    public init(generation: String, sequence: UInt64, data: Data, start: Double,
                duration: Double, independent: Bool, updatedAt: Double) {
        self.generation = generation; self.sequence = sequence; self.data = data
        self.start = start; self.duration = duration; self.independent = independent; self.updatedAt = updatedAt
    }
}

struct MP4VideoConfiguration {
    let width: Int
    let height: Int
    let sps: Data
    let pps: Data
    var codec: String { "avc1." + sps.dropFirst().prefix(3).map { String(format: "%02X", $0) }.joined() }
}

struct MP4AudioConfiguration {
    let sampleRate: UInt32
    let channels: UInt16
    let audioSpecificConfig: Data
}

struct MP4MediaSample {
    let data: Data
    let decodeTime: UInt64
    let duration: UInt32
    let sync: Bool
}

enum FragmentedMP4Error: Error { case invalidConfiguration, invalidSample, limitExceeded }

/// Small original ISO BMFF writer: AVC without reordering and AAC-LC only.
/// No files, network, Apple frameworks or unbounded box sizes. Byte offsets are
/// movie-fragment relative; video uses 90 kHz, audio its actual sampling rate.
enum FragmentedMP4 {
    static let videoTimescale: UInt32 = 90_000
    static let maximumFragmentBytes = 1024 * 1024

    static func initialization(video: MP4VideoConfiguration, audio: MP4AudioConfiguration?) throws -> Data {
        guard (2...960).contains(video.width), (2...960).contains(video.height),
              min(video.width, video.height) <= 540,
              video.width % 2 == 0, video.height % 2 == 0,
              (4...4096).contains(video.sps.count), (1...4096).contains(video.pps.count),
              video.sps.first.map({ $0 & 0x1f == 7 }) == true,
              video.pps.first.map({ $0 & 0x1f == 8 }) == true else { throw FragmentedMP4Error.invalidConfiguration }
        if let audio {
            guard [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000].contains(audio.sampleRate),
                  (1...2).contains(audio.channels), (2...64).contains(audio.audioSpecificConfig.count) else {
                throw FragmentedMP4Error.invalidConfiguration
            }
        }
        var ftyp = MP4Bytes(); ftyp.ascii("isom"); ftyp.u32(512)
        for brand in ["isom", "iso6", "avc1", "mp41"] { ftyp.ascii(brand) }
        var moov = MP4Bytes()
        moov.append(movieHeader(nextTrackID: audio == nil ? 2 : 3))
        moov.append(track(id: 1, timescale: videoTimescale, width: video.width, height: video.height,
                          sampleEntry: avcEntry(video), audio: false))
        if let audio {
            moov.append(track(id: 2, timescale: audio.sampleRate, width: 0, height: 0,
                              sampleEntry: aacEntry(audio), audio: true))
        }
        var mvex = MP4Bytes()
        for id: UInt32 in audio == nil ? [1] : [1, 2] {
            var trex = MP4Bytes(); trex.u32(id); trex.u32(1); trex.u32(0); trex.u32(0); trex.u32(0)
            mvex.append(fullBox("trex", payload: trex.data))
        }
        moov.append(box("mvex", mvex.data))
        return box("ftyp", ftyp.data) + box("moov", moov.data)
    }

    static func fragment(sequence: UInt32, video: [MP4MediaSample], audio: [MP4MediaSample]) throws -> Data {
        guard sequence > 0, !video.isEmpty, video.count <= 48, audio.count <= 96 else { throw FragmentedMP4Error.invalidSample }
        var total = 0
        for samples in [video, audio] {
            var end: UInt64?
            for sample in samples {
                guard !sample.data.isEmpty, sample.data.count <= 512 * 1024, sample.duration > 0,
                      sample.duration <= videoTimescale * 2,
                      sample.decodeTime <= UInt64.max - UInt64(sample.duration),
                      end.map({ sample.decodeTime == $0 }) ?? true else { throw FragmentedMP4Error.invalidSample }
                total += sample.data.count
                guard total <= maximumFragmentBytes - 4096 else { throw FragmentedMP4Error.limitExceeded }
                end = sample.decodeTime + UInt64(sample.duration)
            }
        }
        // Build once to determine moof size, then fill the fixed-width offsets.
        func movieFragment(videoOffset: Int32, audioOffset: Int32) -> Data {
            var body = MP4Bytes(); var mfhd = MP4Bytes(); mfhd.u32(sequence)
            body.append(fullBox("mfhd", payload: mfhd.data))
            body.append(trackFragment(id: 1, samples: video, offset: videoOffset))
            if !audio.isEmpty { body.append(trackFragment(id: 2, samples: audio, offset: audioOffset)) }
            return box("moof", body.data)
        }
        let emptyOffsets = movieFragment(videoOffset: 0, audioOffset: 0)
        let videoBytes = video.reduce(0) { $0 + $1.data.count }
        let moof = movieFragment(videoOffset: Int32(emptyOffsets.count + 8),
                                 audioOffset: Int32(emptyOffsets.count + 8 + videoBytes))
        var payload = Data(); payload.reserveCapacity(total)
        for sample in video { payload.append(sample.data) }
        for sample in audio { payload.append(sample.data) }
        let result = moof + box("mdat", payload)
        guard result.count <= maximumFragmentBytes else { throw FragmentedMP4Error.limitExceeded }
        return result
    }

    private static func trackFragment(id: UInt32, samples: [MP4MediaSample], offset: Int32) -> Data {
        var tfhd = MP4Bytes(); tfhd.u32(id)
        var tfdt = MP4Bytes(); tfdt.u64(samples[0].decodeTime)
        var trun = MP4Bytes(); trun.u32(UInt32(samples.count)); trun.u32(UInt32(bitPattern: offset))
        for sample in samples {
            trun.u32(sample.duration); trun.u32(UInt32(sample.data.count))
            trun.u32(sample.sync ? 0x02000000 : 0x01010000)
        }
        return box("traf", fullBox("tfhd", flags: 0x020000, payload: tfhd.data) +
                   fullBox("tfdt", version: 1, payload: tfdt.data) + fullBox("trun", flags: 0x000701, payload: trun.data))
    }

    private static func movieHeader(nextTrackID: UInt32) -> Data {
        var b = MP4Bytes(); b.u32(0); b.u32(0); b.u32(1000); b.u32(0)
        b.u32(0x00010000); b.u16(0x0100); b.zeros(10); b.matrix(); b.zeros(24); b.u32(nextTrackID)
        return fullBox("mvhd", payload: b.data)
    }

    private static func track(id: UInt32, timescale: UInt32, width: Int, height: Int,
                              sampleEntry: Data, audio: Bool) -> Data {
        var tkhd = MP4Bytes(); tkhd.u32(0); tkhd.u32(0); tkhd.u32(id); tkhd.u32(0); tkhd.u32(0)
        tkhd.zeros(8); tkhd.u16(0); tkhd.u16(0); tkhd.u16(audio ? 0x0100 : 0); tkhd.u16(0)
        tkhd.matrix(); tkhd.u32(UInt32(width) << 16); tkhd.u32(UInt32(height) << 16)
        var mdhd = MP4Bytes(); mdhd.u32(0); mdhd.u32(0); mdhd.u32(timescale); mdhd.u32(0); mdhd.u16(0x55c4); mdhd.u16(0)
        var hdlr = MP4Bytes(); hdlr.u32(0); hdlr.ascii(audio ? "soun" : "vide"); hdlr.zeros(12)
        hdlr.ascii(audio ? "Cabin Audio" : "Cabin Video"); hdlr.u8(0)
        var dref = MP4Bytes(); dref.u32(1); dref.append(fullBox("url ", flags: 1, payload: Data()))
        var stsd = MP4Bytes(); stsd.u32(1); stsd.append(sampleEntry)
        var stbl = MP4Bytes(); stbl.append(fullBox("stsd", payload: stsd.data))
        for kind in ["stts", "stsc", "stco"] { stbl.append(fullBox(kind, payload: Data(repeating: 0, count: 4))) }
        stbl.append(fullBox("stsz", payload: Data(repeating: 0, count: 8)))
        let mediaHeader = audio ? fullBox("smhd", payload: Data(repeating: 0, count: 4)) :
            fullBox("vmhd", flags: 1, payload: Data(repeating: 0, count: 8))
        let minf = box("minf", mediaHeader + box("dinf", fullBox("dref", payload: dref.data)) + box("stbl", stbl.data))
        let mdia = box("mdia", fullBox("mdhd", payload: mdhd.data) + fullBox("hdlr", payload: hdlr.data) + minf)
        return box("trak", fullBox("tkhd", flags: 7, payload: tkhd.data) + mdia)
    }

    private static func avcEntry(_ config: MP4VideoConfiguration) -> Data {
        var avcc = MP4Bytes(); avcc.u8(1); avcc.append(Data(config.sps.dropFirst().prefix(3)))
        avcc.u8(0xff); avcc.u8(0xe1); avcc.u16(UInt16(config.sps.count)); avcc.append(config.sps)
        avcc.u8(1); avcc.u16(UInt16(config.pps.count)); avcc.append(config.pps)
        var b = MP4Bytes(); b.zeros(6); b.u16(1); b.zeros(16); b.u16(UInt16(config.width)); b.u16(UInt16(config.height))
        b.u32(0x00480000); b.u32(0x00480000); b.u32(0); b.u16(1); b.zeros(32); b.u16(0x0018); b.u16(0xffff)
        b.append(box("avcC", avcc.data)); return box("avc1", b.data)
    }

    private static func aacEntry(_ config: MP4AudioConfiguration) -> Data {
        var decoder = MP4Bytes(); decoder.u8(0x40); decoder.u8(0x15); decoder.zeros(3)
        decoder.u32(128_000); decoder.u32(128_000); decoder.append(descriptor(5, config.audioSpecificConfig))
        var es = MP4Bytes(); es.u16(2); es.u8(0); es.append(descriptor(4, decoder.data)); es.append(descriptor(6, Data([2])))
        var b = MP4Bytes(); b.zeros(6); b.u16(1); b.zeros(8); b.u16(config.channels); b.u16(16); b.u16(0); b.u16(0)
        b.u32(config.sampleRate << 16); b.append(fullBox("esds", payload: descriptor(3, es.data)))
        return box("mp4a", b.data)
    }

    private static func descriptor(_ tag: UInt8, _ data: Data) -> Data {
        var length = data.count, bytes = [UInt8(length & 0x7f)]; length >>= 7
        while length > 0 { bytes.insert(UInt8(length & 0x7f) | 0x80, at: 0); length >>= 7 }
        return Data([tag] + bytes) + data
    }

    private static func fullBox(_ kind: String, version: UInt8 = 0, flags: UInt32 = 0, payload: Data) -> Data {
        var b = MP4Bytes(); b.u8(version); b.u8(UInt8((flags >> 16) & 255)); b.u8(UInt8((flags >> 8) & 255)); b.u8(UInt8(flags & 255)); b.append(payload)
        return box(kind, b.data)
    }

    private static func box(_ kind: String, _ data: Data) -> Data {
        var b = MP4Bytes(); b.u32(UInt32(data.count + 8)); b.ascii(kind); b.append(data); return b.data
    }
}

private struct MP4Bytes {
    var data = Data()
    mutating func u8(_ x: UInt8) { data.append(x) }
    mutating func u16(_ x: UInt16) { u8(UInt8(x >> 8)); u8(UInt8(x & 255)) }
    mutating func u32(_ x: UInt32) { u16(UInt16(x >> 16)); u16(UInt16(x & 65535)) }
    mutating func u64(_ x: UInt64) { u32(UInt32(x >> 32)); u32(UInt32(x & 0xffff_ffff)) }
    mutating func append(_ x: Data) { data.append(x) }
    mutating func ascii(_ x: String) { data.append(contentsOf: x.utf8) }
    mutating func zeros(_ count: Int) { data.append(Data(repeating: 0, count: count)) }
    mutating func matrix() { for x: UInt32 in [0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000] { u32(x) } }
}
