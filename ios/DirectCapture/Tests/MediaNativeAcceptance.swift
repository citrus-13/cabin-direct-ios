#if DIRECT_MEDIA_STANDALONE
import Foundation
import AVFoundation
import CoreVideo
import CoreMedia
import AudioToolbox

private func requireMedia(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() { fatalError(message) }
}

private final class MediaRecorder {
    private let lock = NSLock()
    private var initializations: [String: EncodedMediaInitialization] = [:]
    private var fragments: [String: [EncodedMediaFragment]] = [:]
    private var issues: [String] = []
    func initialize(_ value: EncodedMediaInitialization) { lock.lock(); initializations[value.generation] = value; lock.unlock() }
    func append(_ value: EncodedMediaFragment) { lock.lock(); fragments[value.generation, default: []].append(value); lock.unlock() }
    func error(_ value: String) { lock.lock(); issues.append(value); lock.unlock() }
    var snapshot: ([String: EncodedMediaInitialization], [String: [EncodedMediaFragment]], [String]) {
        lock.lock(); defer { lock.unlock() }; return (initializations, fragments, issues)
    }
}

private func syntheticVideo(pts: Double) -> CMSampleBuffer {
    var pixel: CVPixelBuffer?
    requireMedia(CVPixelBufferCreate(kCFAllocatorDefault, 320, 180, kCVPixelFormatType_32BGRA,
        [kCVPixelBufferIOSurfacePropertiesKey: [:]] as CFDictionary, &pixel) == kCVReturnSuccess, "create synthetic video")
    let buffer = pixel!
    CVPixelBufferLockBaseAddress(buffer, [])
    memset(CVPixelBufferGetBaseAddress(buffer)!, Int(floor(pts)) % 2 == 0 ? 200 : 48, CVPixelBufferGetBytesPerRow(buffer) * 180)
    CVPixelBufferUnlockBaseAddress(buffer, [])
    var format: CMVideoFormatDescription?
    requireMedia(CMVideoFormatDescriptionCreateForImageBuffer(allocator: kCFAllocatorDefault, imageBuffer: buffer, formatDescriptionOut: &format) == noErr, "create video format")
    var timing = CMSampleTimingInfo(duration: CMTime(value: 3, timescale: 50),
        presentationTimeStamp: CMTime(seconds: pts, preferredTimescale: 90_000), decodeTimeStamp: .invalid)
    var sample: CMSampleBuffer?
    requireMedia(CMSampleBufferCreateReadyWithImageBuffer(allocator: kCFAllocatorDefault, imageBuffer: buffer,
        formatDescription: format!, sampleTiming: &timing, sampleBufferOut: &sample) == noErr, "create synthetic video sample")
    return sample!
}

private func syntheticAudio(frame: Int, pts: Double) -> CMSampleBuffer {
    let frames = 960
    let values = (0..<frames).map { (frame + $0) / 48000 % 2 == 0 ? Float(0.25 * sin(2 * Double.pi * 440 * Double(frame + $0) / 48000)) : 0 }
    var description = AudioStreamBasicDescription(mSampleRate: 48000, mFormatID: kAudioFormatLinearPCM,
        mFormatFlags: kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked, mBytesPerPacket: 4,
        mFramesPerPacket: 1, mBytesPerFrame: 4, mChannelsPerFrame: 1, mBitsPerChannel: 32, mReserved: 0)
    var format: CMAudioFormatDescription?
    requireMedia(CMAudioFormatDescriptionCreate(allocator: kCFAllocatorDefault, asbd: &description,
        layoutSize: 0, layout: nil, magicCookieSize: 0, magicCookie: nil, extensions: nil, formatDescriptionOut: &format) == noErr, "create audio format")
    var block: CMBlockBuffer?
    requireMedia(CMBlockBufferCreateWithMemoryBlock(allocator: kCFAllocatorDefault, memoryBlock: nil,
        blockLength: frames * 4, blockAllocator: kCFAllocatorDefault, customBlockSource: nil,
        offsetToData: 0, dataLength: frames * 4, flags: 0, blockBufferOut: &block) == noErr, "create audio block")
    values.withUnsafeBytes { raw in
        requireMedia(CMBlockBufferReplaceDataBytes(with: raw.baseAddress!, blockBuffer: block!, offsetIntoDestination: 0, dataLength: frames * 4) == noErr, "fill audio block")
    }
    var timing = CMSampleTimingInfo(duration: CMTime(value: 1, timescale: 48000),
        presentationTimeStamp: CMTime(seconds: pts, preferredTimescale: 48000), decodeTimeStamp: .invalid)
    var size = 4, sample: CMSampleBuffer?
    requireMedia(CMSampleBufferCreateReady(allocator: kCFAllocatorDefault, dataBuffer: block, formatDescription: format,
        sampleCount: frames, sampleTimingEntryCount: 1, sampleTimingArray: &timing,
        sampleSizeEntryCount: 1, sampleSizeArray: &size, sampleBufferOut: &sample) == noErr, "create audio sample")
    return sample!
}

private func audioDecodeBase(_ data: Data) -> Double {
    func integer(_ offset: Int, _ count: Int) -> UInt64 { data[offset..<(offset + count)].reduce(0) { ($0 << 8) | UInt64($1) } }
    func boxes(_ start: Int, _ end: Int) -> [(String, Int, Int)] {
        var result: [(String, Int, Int)] = [], position = start
        while position + 8 <= end {
            let size = Int(integer(position, 4))
            requireMedia(size >= 8 && size <= end - position, "invalid MP4 box bounds")
            result.append((String(data: data[(position + 4)..<(position + 8)], encoding: .ascii)!, position + 8, position + size))
            position += size
        }
        requireMedia(position == end, "trailing MP4 bytes")
        return result
    }
    for moof in boxes(0, data.count) where moof.0 == "moof" {
        for traf in boxes(moof.1, moof.2) where traf.0 == "traf" {
            let children = boxes(traf.1, traf.2)
            if let tfhd = children.first(where: { $0.0 == "tfhd" }), integer(tfhd.1 + 4, 4) == 2,
               let tfdt = children.first(where: { $0.0 == "tfdt" }) {
                requireMedia(data[tfdt.1] == 1, "expected 64-bit decode time")
                return Double(integer(tfdt.1 + 4, 8)) / 48000
            }
        }
    }
    fatalError("audio tfdt absent")
}

@main private struct MediaNativeAcceptance {
    static func main() throws {
        let recorder = MediaRecorder()
        let pipeline = DirectMediaPipeline(onInitialization: recorder.initialize, onFragment: recorder.append, onUnavailable: recorder.error)
        // The tone and gray pixels are generated fixtures only. Timing is common
        // source time (100 + tick / 50), independent of callback delivery clocks.
        for tick in 0..<340 {
            if tick >= 15 { pipeline.appendAudio(syntheticAudio(frame: tick * 960, pts: 100 + Double(tick) / 50)) }
            if tick % 3 == 0 { pipeline.appendVideo(syntheticVideo(pts: 100 + Double(tick) / 50), orientation: .up) }
            Thread.sleep(forTimeInterval: 0.02)
        }
        Thread.sleep(forTimeInterval: 0.2)
        let beforePause = recorder.snapshot
        print("Native media diagnostics: generations=\(beforePause.0.count), fragmentCounts=\(beforePause.1.values.map(\.count)), issues=\(beforePause.2)")
        guard let best = beforePause.1.filter({ beforePause.0[$0.key]?.hasAudio == true }).max(by: { $0.value.count < $1.value.count }),
              let configuration = beforePause.0[best.key] else { fatalError("No real encoded muxed audio/video generation") }
        requireMedia(best.value.count >= 5, "not enough real A/V fragments")
        requireMedia(best.value.first!.independent, "first fragment is not independently decodable")
        requireMedia(best.value.filter(\.independent).count >= 2, "periodic IDR fragments absent")
        for (index, fragment) in best.value.enumerated() {
            requireMedia(fragment.sequence == UInt64(index + 1), "noncontiguous fragment sequence")
            requireMedia(fragment.data.count <= 1024 * 1024 && fragment.duration > 0 && fragment.duration <= 0.75, "fragment bound")
            if index > 0 {
                let previous = best.value[index - 1]
                requireMedia(abs(fragment.start - previous.start - previous.duration) < 0.0001, "video timeline discontinuity")
            }
        }
        var bytes = configuration.data
        for fragment in best.value { bytes.append(fragment.data) }
        let directory = URL(fileURLWithPath: ProcessInfo.processInfo.environment["TMPDIR"] ?? NSTemporaryDirectory())
        let url = directory.appendingPathComponent("cabin-media-native-\(UUID().uuidString).mp4")
        try bytes.write(to: url, options: .withoutOverwriting)
        let asset = AVURLAsset(url: url)
        guard let video = asset.tracks(withMediaType: .video).first, let audio = asset.tracks(withMediaType: .audio).first else {
            fatalError("AVFoundation could not demux both tracks")
        }
        let reader = try AVAssetReader(asset: asset)
        let videoOutput = AVAssetReaderTrackOutput(track: video, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
        let audioOutput = AVAssetReaderTrackOutput(track: audio, outputSettings: [AVFormatIDKey: kAudioFormatLinearPCM,
            AVLinearPCMIsFloatKey: true, AVLinearPCMBitDepthKey: 32, AVLinearPCMIsNonInterleaved: false])
        reader.add(videoOutput); reader.add(audioOutput)
        requireMedia(reader.startReading(), "AVAssetReader refused fMP4")
        var videoCount = 0, audioCount = 0, audible = false
        var videoStart: Double?, audioStart: Double?
        var videoMarkers: [(Double, Bool)] = [], audioMarkers: [(Double, Bool)] = []
        var lastVideoBright: Bool?, lastAudioLoud: Bool?
        let rawVideoBase = best.value.first!.start
        let rawAudioBase = audioDecodeBase(best.value.first!.data)
        while let sample = videoOutput.copyNextSampleBuffer() {
            videoCount += 1
            if videoStart == nil { videoStart = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sample)) }
            requireMedia(CMSampleBufferGetImageBuffer(sample) != nil, "H264 did not decode pixels")
            let pixel = CMSampleBufferGetImageBuffer(sample)!
            CVPixelBufferLockBaseAddress(pixel, .readOnly)
            let bright = CVPixelBufferGetBaseAddress(pixel)!.load(as: UInt8.self) > 120
            CVPixelBufferUnlockBaseAddress(pixel, .readOnly)
            if let previous = lastVideoBright, previous != bright {
                videoMarkers.append((rawVideoBase + CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sample)) - videoStart!, bright))
            }
            lastVideoBright = bright
        }
        while let sample = audioOutput.copyNextSampleBuffer() {
            audioCount += CMSampleBufferGetNumSamples(sample)
            if audioStart == nil { audioStart = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sample)) }
            if let block = CMSampleBufferGetDataBuffer(sample) {
                let length = CMBlockBufferGetDataLength(block)
                var decoded = [Float](repeating: 0, count: length / 4)
                decoded.withUnsafeMutableBytes { raw in
                    requireMedia(CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: length, destination: raw.baseAddress!) == noErr, "read decoded AAC")
                }
                if decoded.contains(where: { abs($0) > 0.05 }) { audible = true }
                for offset in stride(from: 0, to: decoded.count - 255, by: 256) {
                    let values = decoded[offset..<(offset + 256)]
                    let loud = sqrt(values.reduce(0.0) { $0 + Double($1 * $1) } / 256) > 0.03
                    if let previous = lastAudioLoud, previous != loud {
                        let at = rawAudioBase + CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sample)) - audioStart! + Double(offset) / 48000
                        audioMarkers.append((at, loud))
                    }
                    lastAudioLoud = loud
                }
            }
        }
        requireMedia(reader.status == .completed, "fMP4 demux/decode did not complete: \(String(describing: reader.error))")
        requireMedia(videoCount >= 10 && audioCount > 48000 && audible, "decoded media missing video or real tone")
        requireMedia(abs(videoStart! - audioStart!) < 0.25, "track clocks not aligned to shared source origin")
        requireMedia(videoMarkers.count >= 4 && audioMarkers.count >= 4, "missing synthetic flash/tone transitions")
        let offsets = videoMarkers.map { marker in
            audioMarkers.filter { $0.1 == marker.1 }.map { abs($0.0 - marker.0) }.min() ?? Double.infinity
        }
        requireMedia(offsets.allSatisfy { $0 <= 0.12 }, "decoded source-clock flash/tone skew exceeded120ms: \(offsets)")
        print("PASS real H264/AAC-LC encode + fMP4 demux/decode: \(videoCount) frames, \(audioCount) audio samples; firstPTS video=\(videoStart!), audio=\(audioStart!)")
        print("PASS decoded common-clock flash/tone markers: \(offsets.count), max skew=\(offsets.max()!) seconds; not phone/browser latency")
        print("PASS independent IDR fragments, byte caps and contiguous source timeline")
        if let fixturePath = ProcessInfo.processInfo.environment["CABIN_MEDIA_FIXTURE_DIR"] {
            requireMedia(fixturePath.hasPrefix("/"), "fixture destination must be explicit absolute path")
            let destination = URL(fileURLWithPath: fixturePath, isDirectory: true)
            try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
            try configuration.data.write(to: destination.appendingPathComponent("init.mp4"), options: .withoutOverwriting)
            var records: [[String: Any]] = []
            for fragment in best.value {
                let name = String(format: "%06llu.m4s", fragment.sequence)
                try fragment.data.write(to: destination.appendingPathComponent(name), options: .withoutOverwriting)
                records.append(["file": name, "sequence": fragment.sequence, "start": fragment.start,
                                "duration": fragment.duration, "independent": fragment.independent])
            }
            let manifest: [String: Any] = ["schema": 1, "generation": configuration.generation,
                "mime": configuration.mime, "hasAudio": configuration.hasAudio, "initFile": "init.mp4",
                "synthetic": true, "pattern": "same-source-clock alternating 1s bright/tone and dark/silence; never autoplay unmuted",
                "fragments": records]
            let json = try JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted, .sortedKeys])
            try json.write(to: destination.appendingPathComponent("manifest.json"), options: .withoutOverwriting)
            print("Synthetic fixture manifest: \(destination.appendingPathComponent("manifest.json").path)")
        }
        // Deliberately omit a 40 ms source interval. The packet ordinal must not
        // compress it away and append into the old source-time generation.
        let beforeGap = Set(recorder.snapshot.0.keys)
        for tick in 342..<400 {
            pipeline.appendAudio(syntheticAudio(frame: tick * 960, pts: 100 + Double(tick) / 50))
            if tick % 3 == 0 { pipeline.appendVideo(syntheticVideo(pts: 100 + Double(tick) / 50), orientation: .up) }
            Thread.sleep(forTimeInterval: 0.02)
        }
        Thread.sleep(forTimeInterval: 0.1)
        let gapState = recorder.snapshot
        requireMedia(gapState.0.contains(where: { !beforeGap.contains($0.key) && $0.value.hasAudio && !(gapState.1[$0.key] ?? []).isEmpty }), "dropped40ms audio did not reset generation")
        print("PASS dropped40ms source audio resets generation instead of compressing time")
        pipeline.setPaused(true)
        let pausedCount = recorder.snapshot.1.values.reduce(0) { $0 + $1.count }
        pipeline.appendVideo(syntheticVideo(pts: 110), orientation: .up)
        pipeline.appendAudio(syntheticAudio(frame: 0, pts: 110))
        Thread.sleep(forTimeInterval: 0.1)
        requireMedia(recorder.snapshot.1.values.reduce(0) { $0 + $1.count } == pausedCount, "paused producer emitted a fragment")
        pipeline.setPaused(false)
        for tick in 0..<30 {
            pipeline.appendVideo(syntheticVideo(pts: 120 + Double(tick) / 15), orientation: .right)
            Thread.sleep(forTimeInterval: 0.067)
        }
        pipeline.stop()
        let after = recorder.snapshot
        requireMedia(after.0.contains(where: { $0.key != best.key && !$0.value.hasAudio && !(after.1[$0.key] ?? []).isEmpty }), "resume/rotation did not produce fresh video-only generation")
        let stoppedCount = after.1.values.reduce(0) { $0 + $1.count }
        pipeline.appendVideo(syntheticVideo(pts: 130), orientation: .up)
        Thread.sleep(forTimeInterval: 0.1)
        requireMedia(recorder.snapshot.1.values.reduce(0) { $0 + $1.count } == stoppedCount, "stopped producer emitted")
        print("PASS pause/stop invalidation and fresh rotated generation")
        let sparse = MediaRecorder()
        let sparsePipeline = DirectMediaPipeline(onInitialization: sparse.initialize, onFragment: sparse.append, onUnavailable: sparse.error)
        for tick in 0..<260 {
            sparsePipeline.appendAudio(syntheticAudio(frame: tick * 960, pts: 200 + Double(tick) / 50))
            if (tick < 90 && tick % 30 == 0) || (tick >= 90 && (tick - 90) % 50 == 0) {
                sparsePipeline.appendVideo(syntheticVideo(pts: 200 + Double(tick) / 50), orientation: .up)
            }
            Thread.sleep(forTimeInterval: 0.02)
        }
        sparsePipeline.stop()
        let sparseResult = sparse.snapshot
        let sparseFragments = sparseResult.1.filter { sparseResult.0[$0.key]?.hasAudio == true }.flatMap(\.value)
        requireMedia(sparseFragments.contains { abs($0.duration - 0.6) < 0.01 }, "600ms sparse video failed to produce muxed A/V")
        requireMedia(sparseFragments.contains { abs($0.duration - 1.0) < 0.01 }, "1s sparse video failed to produce muxed A/V")
        requireMedia(sparseFragments.allSatisfy { $0.duration <= 1.5 && $0.data.count <= 1024 * 1024 }, "sparse output exceeded bounds")
        print("PASS sparse600ms/1s video with continuous real PCM retains A/V instead of reset loop")
        requireMedia(DirectMediaPipeline.audioSpecificConfig(Data([5, 2, 0x12, 0x10])) == Data([0x12, 0x10]), "ASC descriptor extraction")
        requireMedia(DirectMediaPipeline.audioSpecificConfig(Data([5, 0x81, 0x7f, 1])) == nil, "malformed cookie accepted")
        print("PASS AAC descriptor extraction rejects malformed cookie lengths")
        let faultPipeline = DirectMediaPipeline(onInitialization: { _ in }, onFragment: { _ in }, onUnavailable: { _ in })
        requireMedia(faultPipeline.verifyWatchdogTicketOwnershipForTesting(), "watchdog failed to isolate expired admission ticket")
        faultPipeline.stop()
        print("PASS deterministic watchdog fault injection releases expired ticket only and backs off retry")
        print("Media native checks: synthetic fixtures only; no ReplayKit, microphone, network, signing, iPhone or Tesla acceptance. Fixture: \(url.path)")
    }
}
#endif
