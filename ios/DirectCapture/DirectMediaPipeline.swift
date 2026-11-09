import Foundation
import CoreMedia
import CoreImage
import ImageIO
import AVFAudio
import AudioToolbox
import VideoToolbox

/// User-started ReplayKit app-audio/video only. No microphone, audio session,
/// persistence, network, or background task. All codecs and mux state are confined
/// to work; admission retains at most two source videos and one source audio buffer.
public final class DirectMediaPipeline {
    private let work = DispatchQueue(label: "CabinDirect.Media", qos: .userInitiated)
    private let workKey = DispatchSpecificKey<UInt8>()
    private let lock = NSLock()
    private var stopped = false
    private var paused = false
    private var lifecycle: UInt64 = 0
    private var videoTickets: [UUID: Double] = [:]
    private var audioTicket: UUID?
    private var lastAdmission = -Double.infinity
    private let longEdge: Int
    private let shortEdge: Int
    private let fps: Int
    private let onInitialization: (EncodedMediaInitialization) -> Void
    private let onFragment: (EncodedMediaFragment) -> Void
    private let onUnavailable: (String) -> Void

    private let context = CIContext(options: [.cacheIntermediates: false])
    private let colorSpace = CGColorSpaceCreateDeviceRGB()
    private var compression: VTCompressionSession?
    private var nextVideoEncoderAttempt = 0.0
    private var pixelPool: CVPixelBufferPool?
    private var dimensions = (width: 0, height: 0)
    private var orientation: CGImagePropertyOrientation?
    private var generation = UUID().uuidString
    private var origin: Double?
    private var lastVideoPTS: Double?
    private var waitingForVideoCadence = false
    private var lastAudioPTS: Double?
    private var lastKeyframe = -Double.infinity
    private var forceKeyframe = true
    private var initialized = false
    private var sequence: UInt64 = 0
    private var videoConfiguration: MP4VideoConfiguration?
    private var audioConfiguration: MP4AudioConfiguration?
    private var pendingVideo: RawVideo?
    private var videoGroup: [MP4MediaSample] = []
    private var audioPackets: [RawAudio] = []
    private var groupBytes = 0
    private var groupObservedAt = 0.0
    private var lastAudioArrival = 0.0
    private var converter: AudioConverterRef?
    private var audioFormat: AVAudioFormat?
    private var heldPCM: AVAudioPCMBuffer?
    private var audioBasePTS = 0.0
    private var audioPacketFrames: UInt64 = 0
    private var audioInputFrames: UInt64 = 0
    private var audioPrimeFrames: UInt32 = 0
    private var maxAudioPacket = 0
    private var audioUnsupported = false
    private var lastError = ""

    public init(maxLongEdge: Int = 960, maxShortEdge: Int = 540, maxFPS: Int = 24,
                onInitialization: @escaping (EncodedMediaInitialization) -> Void,
                onFragment: @escaping (EncodedMediaFragment) -> Void,
                onUnavailable: @escaping (String) -> Void) {
        self.longEdge = max(2, min(960, maxLongEdge)); self.shortEdge = max(2, min(540, maxShortEdge))
        self.fps = max(1, min(24, maxFPS)); self.onInitialization = onInitialization
        self.onFragment = onFragment; self.onUnavailable = onUnavailable
        work.setSpecific(key: workKey, value: 1)
    }

    public func appendVideo(_ sample: CMSampleBuffer, orientation: CGImagePropertyOrientation) {
        guard lock.try() else { return }
        let now = ProcessInfo.processInfo.systemUptime
        guard !stopped, !paused, videoTickets.count < 2, now - lastAdmission >= 1 / Double(fps) else { lock.unlock(); return }
        let ticket = UUID(), token = lifecycle
        videoTickets[ticket] = now; lastAdmission = now; lock.unlock()
        let observed = Date().timeIntervalSince1970
        work.async { [self] in
            autoreleasepool {
                guard current(token) else { releaseVideo(ticket); return }
                encodeVideo(sample, orientation: orientation, observedAt: observed, token: token, ticket: ticket)
            }
        }
    }

    public func appendAudio(_ sample: CMSampleBuffer) {
        guard lock.try() else { return }
        guard !stopped, !paused, audioTicket == nil else { lock.unlock(); return }
        let ticket = UUID(), token = lifecycle
        audioTicket = ticket; lock.unlock()
        work.async { [self] in
            defer { releaseAudio(ticket) }
            autoreleasepool {
                guard current(token) else { return }
                encodeAudio(sample)
            }
        }
    }

    public func requestKeyframe() { work.async { [self] in forceKeyframe = true } }

    /// Existing broadcast timer calls this. Missing audio is not synthesized.
    public func tick() {
        work.async { [self] in
            guard active else { return }
            lock.lock()
            let now = ProcessInfo.processInfo.systemUptime
            let delayedTickets = videoTickets.filter { now - $0.value > 1.5 }.map(\.key)
            lock.unlock()
            if !delayedTickets.isEmpty {
                resetGeneration()
                for ticket in delayedTickets { releaseVideo(ticket) }
                nextVideoEncoderAttempt = ProcessInfo.processInfo.systemUptime + 5
                report("视频编码回调超时，已丢弃等待帧并重新请求关键帧。")
            }
            if audioConfiguration != nil && ProcessInfo.processInfo.systemUptime - lastAudioArrival > 1.0 {
                disposeAudio(); resetGeneration()
                report("App 音频已中断，已重置为无音轨画面；不会补造声音。")
            }
        }
    }

    public func setPaused(_ value: Bool) {
        lock.lock()
        guard !stopped, paused != value else { lock.unlock(); return }
        paused = value; lifecycle &+= 1; lastAdmission = -Double.infinity; lock.unlock()
        onWork { waitingForVideoCadence = false; disposeAudio(); resetGeneration() }
    }

    public func stop() {
        lock.lock()
        guard !stopped else { lock.unlock(); return }
        stopped = true; lifecycle &+= 1; lock.unlock()
        onWork { disposeAudio(); resetGeneration() }
    }

    private func encodeVideo(_ sample: CMSampleBuffer, orientation nextOrientation: CGImagePropertyOrientation,
                             observedAt: Double, token: UInt64, ticket: UUID) {
        // No timer retries. Only real source frames may trigger a retry after a
        // bounded cooldown; unsupported encoders must not churn at capture FPS.
        guard compression != nil || ProcessInfo.processInfo.systemUptime >= nextVideoEncoderAttempt else {
            releaseVideo(ticket); return
        }
        guard CMSampleBufferIsValid(sample), CMSampleBufferDataIsReady(sample),
              let input = CMSampleBufferGetImageBuffer(sample),
              CVPixelBufferGetWidth(input) <= 4096, CVPixelBufferGetHeight(input) <= 4096,
              let pts = validPTS(sample) else { releaseVideo(ticket); return }
        if let last = lastVideoPTS, pts - last > 1.5 {
            if !waitingForVideoCadence {
                disposeAudio(); resetGeneration(); waitingForVideoCadence = true
                report("画面更新间隔过长，音画流等待新画面；不会把旧截图标记为新采集。")
            }
            lastVideoPTS = pts; releaseVideo(ticket); return
        }
        if waitingForVideoCadence {
            waitingForVideoCadence = false; resetGeneration()
        } else if let last = lastVideoPTS, pts <= last {
            resetGeneration(); disposeAudio()
        }
        lastVideoPTS = pts
        let oriented = CIImage(cvPixelBuffer: input).oriented(nextOrientation)
        let image = oriented.transformed(by: CGAffineTransform(translationX: -oriented.extent.minX, y: -oriented.extent.minY))
        let fit = CapturePipeline.fittedSize(width: Int(image.extent.width), height: Int(image.extent.height), longEdge: longEdge, shortEdge: shortEdge)
        let width = fit.0 / 2 * 2, height = fit.1 / 2 * 2
        guard width >= 2, height >= 2 else { releaseVideo(ticket); return }
        if self.orientation != nextOrientation || dimensions.width != width || dimensions.height != height {
            resetGeneration(); self.orientation = nextOrientation; dimensions = (width, height)
        }
        if origin == nil { origin = pts - 0.25 } // Shared preroll also accommodates real AAC priming.
        guard let origin, pts >= origin else { resetGeneration(); releaseVideo(ticket); return }
        if compression == nil && !createVideoEncoder(width: width, height: height) {
            nextVideoEncoderAttempt = ProcessInfo.processInfo.systemUptime + 5
            releaseVideo(ticket); return
        }
        guard let compression, let pixelPool else { releaseVideo(ticket); return }
        var pixel: CVPixelBuffer?
        let allocated = CVPixelBufferPoolCreatePixelBufferWithAuxAttributes(kCFAllocatorDefault, pixelPool,
            [kCVPixelBufferPoolAllocationThresholdKey: 3] as CFDictionary, &pixel)
        guard allocated == kCVReturnSuccess, let pixel else { forceKeyframe = true; releaseVideo(ticket); return }
        let scaled = image.transformed(by: CGAffineTransform(scaleX: Double(width) / image.extent.width, y: Double(height) / image.extent.height))
        context.render(scaled, to: pixel, bounds: CGRect(x: 0, y: 0, width: width, height: height), colorSpace: colorSpace)
        let keyframe = forceKeyframe || pts - lastKeyframe >= 1
        forceKeyframe = false
        let epoch = generation
        var flags = VTEncodeInfoFlags()
        let result = VTCompressionSessionEncodeFrame(compression, imageBuffer: pixel,
            presentationTimeStamp: CMSampleBufferGetPresentationTimeStamp(sample), duration: .invalid,
            frameProperties: keyframe ? [kVTEncodeFrameOptionKey_ForceKeyFrame: true] as CFDictionary : nil,
            infoFlagsOut: &flags) { [weak self] status, info, encoded in
                guard let self else { return }
                self.work.async {
                    defer { self.releaseVideo(ticket) }
                    guard self.current(token), self.generation == epoch else { return }
                    guard status == noErr, !info.contains(.frameDropped), let encoded else {
                        self.forceKeyframe = true; return
                    }
                    self.receiveVideo(encoded, pts: pts, observedAt: observedAt)
                }
            }
        if result != noErr || flags.contains(.frameDropped) { forceKeyframe = true; releaseVideo(ticket) }
    }

    private func createVideoEncoder(width: Int, height: Int) -> Bool {
        var session: VTCompressionSession?
        let created = VTCompressionSessionCreate(allocator: kCFAllocatorDefault, width: Int32(width), height: Int32(height),
            codecType: kCMVideoCodecType_H264,
            encoderSpecification: [kVTVideoEncoderSpecification_EnableHardwareAcceleratedVideoEncoder: true] as CFDictionary,
            imageBufferAttributes: nil, compressedDataAllocator: nil, outputCallback: nil, refcon: nil, compressionSessionOut: &session)
        guard created == noErr, let session else { report("H.264 实时编码器不可用；未建立音画流。"); return false }
        for (key, value): (CFString, CFTypeRef) in [
            (kVTCompressionPropertyKey_RealTime, kCFBooleanTrue),
            (kVTCompressionPropertyKey_AllowFrameReordering, kCFBooleanFalse),
            // Optional hint: some native encoders reject this property entirely.
            // Two admission slots + watchdog are our actual memory/liveness
            // bounds; unsupported hints never imply a guaranteed codec delay.
            (kVTCompressionPropertyKey_MaxFrameDelayCount, NSNumber(value: 1)),
            (kVTCompressionPropertyKey_ProfileLevel, kVTProfileLevel_H264_Baseline_AutoLevel),
            (kVTCompressionPropertyKey_AverageBitRate, NSNumber(value: 1_800_000)),
            (kVTCompressionPropertyKey_ExpectedFrameRate, NSNumber(value: fps)),
            (kVTCompressionPropertyKey_MaxKeyFrameInterval, NSNumber(value: fps)),
            (kVTCompressionPropertyKey_MaxKeyFrameIntervalDuration, NSNumber(value: 1))
        ] {
            let configured = VTSessionSetProperty(session, key: key, value: value)
            #if DIRECT_MEDIA_STANDALONE
            if configured != noErr { print("Synthetic encoder configuration diagnostic: \(key)=\(value), OSStatus=\(configured)") }
            #endif
            if key == kVTCompressionPropertyKey_MaxFrameDelayCount && configured != noErr { continue }
            guard configured == noErr else {
                VTCompressionSessionInvalidate(session); report("编码器不支持所需的低延迟配置。"); return false
            }
        }
        guard VTCompressionSessionPrepareToEncodeFrames(session) == noErr else {
            VTCompressionSessionInvalidate(session); report("无法准备实时视频编码器。"); return false
        }
        var pool: CVPixelBufferPool?
        let attrs: [CFString: Any] = [kCVPixelBufferWidthKey: width, kCVPixelBufferHeightKey: height,
            kCVPixelBufferPixelFormatTypeKey: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange,
            kCVPixelBufferIOSurfacePropertiesKey: [:]]
        guard CVPixelBufferPoolCreate(kCFAllocatorDefault, [kCVPixelBufferPoolMinimumBufferCountKey: 2] as CFDictionary,
                                      attrs as CFDictionary, &pool) == kCVReturnSuccess else {
            VTCompressionSessionInvalidate(session); report("无法分配有界视频缓冲区。"); return false
        }
        compression = session; pixelPool = pool; return true
    }

    private func receiveVideo(_ sample: CMSampleBuffer, pts: Double, observedAt: Double) {
        guard active, let origin, let format = CMSampleBufferGetFormatDescription(sample),
              let block = CMSampleBufferGetDataBuffer(sample) else { return }
        let size = CMBlockBufferGetDataLength(block)
        guard size > 0, size <= 512 * 1024 else { resetGeneration(); return }
        let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false) as? [[CFString: Any]]
        let sync = attachments?.first?[kCMSampleAttachmentKey_NotSync] as? Bool != true
        let dts = CMSampleBufferGetDecodeTimeStamp(sample)
        guard !dts.isNumeric || abs(CMTimeGetSeconds(dts) - pts) < 0.0001 else { resetGeneration(); report("编码器产生了不受支持的重排帧。"); return }
        var data = Data(count: size)
        let copied = data.withUnsafeMutableBytes { CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: size, destination: $0.baseAddress!) }
        guard copied == noErr, validAVCC(data) else { resetGeneration(); return }
        if videoConfiguration == nil {
            guard sync, let config = videoConfig(format) else { forceKeyframe = true; return }
            videoConfiguration = config
        }
        if !initialized || sync {
            guard sync, let config = videoConfiguration else { forceKeyframe = true; return }
            do {
                let bytes = try FragmentedMP4.initialization(video: config, audio: audioConfiguration)
                let codecs = config.codec + (audioConfiguration == nil ? "" : ",mp4a.40.2")
                onInitialization(.init(generation: generation, data: bytes, mime: "video/mp4; codecs=\"\(codecs)\"", hasAudio: audioConfiguration != nil))
                initialized = true
            } catch { resetGeneration(); report("媒体初始化数据无效，已停止当前片段。"); return }
        }
        if sync { lastKeyframe = pts }
        let tick = (pts - origin) * Double(FragmentedMP4.videoTimescale)
        guard tick.isFinite, tick >= 0, tick <= Double(UInt64.max / 2) else { resetGeneration(); return }
        let next = RawVideo(data: data, ticks: UInt64(tick.rounded()), sync: sync, observedAt: observedAt)
        if let previous = pendingVideo {
            guard next.ticks > previous.ticks, next.ticks - previous.ticks <= 135_000 else { resetGeneration(); return }
            // Never bury an IDR inside a dependent fragment. If audio is so late
            // that the preceding group cannot close, discard it and restart.
            if previous.sync && !videoGroup.isEmpty {
                flushIfReady(force: true)
                guard videoGroup.isEmpty else { disposeAudio(); resetGeneration(); return }
            }
            videoGroup.append(.init(data: previous.data, decodeTime: previous.ticks,
                                    duration: UInt32(next.ticks - previous.ticks), sync: previous.sync))
            groupBytes += previous.data.count; groupObservedAt = previous.observedAt
        }
        pendingVideo = next
        flushIfReady(force: sync)
    }

    private func encodeAudio(_ sample: CMSampleBuffer) {
        guard !audioUnsupported, !waitingForVideoCadence, CMSampleBufferDataIsReady(sample), let pts = validPTS(sample),
              let description = CMSampleBufferGetFormatDescription(sample),
              let pointer = CMAudioFormatDescriptionGetStreamBasicDescription(description) else { return }
        let source = pointer.pointee, frames = CMSampleBufferGetNumSamples(sample)
        guard source.mFormatID == kAudioFormatLinearPCM,
              [8000.0, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000].contains(source.mSampleRate),
              (1...2).contains(source.mChannelsPerFrame), source.mBytesPerFrame > 0, source.mBytesPerFrame <= 8,
              frames > 0, frames <= 12_000, Double(frames) / source.mSampleRate <= 0.25,
              let format = AVAudioFormat(streamDescription: pointer),
              [.pcmFormatFloat32, .pcmFormatInt16, .pcmFormatInt32].contains(format.commonFormat),
              let owned = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(frames)) else { return }
        owned.frameLength = AVAudioFrameCount(frames)
        guard CMSampleBufferCopyPCMDataIntoAudioBufferList(sample, at: 0, frameCount: Int32(frames), into: owned.mutableAudioBufferList) == noErr else { return }
        // Even a single dropped callback must not be time-compressed by the
        // output packet counter. Permit only sub-millisecond timestamp rounding.
        let tolerance = max(1 / source.mSampleRate, 0.001)
        let absoluteExpected = audioBasePTS + Double(audioInputFrames) / source.mSampleRate
        if let expected = lastAudioPTS,
           abs(pts - expected) > tolerance || abs(pts - absoluteExpected) > tolerance {
            disposeAudio(); resetGeneration()
        }
        if audioFormat != format {
            disposeAudio(); resetGeneration()
            guard createAudioEncoder(format: format, pts: pts) else { return }
        }
        lastAudioPTS = pts + Double(frames) / source.mSampleRate
        lastAudioArrival = ProcessInfo.processInfo.systemUptime
        guard let converter else { return }
        let input = AACInput(buffer: owned)
        // AudioConverter may keep its last input pointer until its next input
        // callback. Keep the previous PCM alive across FillComplexBuffer calls.
        input.previous = heldPCM
        let capacity = maxAudioPacket * 16
        var bytes = [UInt8](repeating: 0, count: capacity)
        var descriptions = [AudioStreamPacketDescription](repeating: .init(), count: 16)
        var count: UInt32 = 16
        let result = bytes.withUnsafeMutableBytes { memory in
            var list = AudioBufferList(mNumberBuffers: 1, mBuffers: AudioBuffer(mNumberChannels: source.mChannelsPerFrame,
                mDataByteSize: UInt32(capacity), mData: memory.baseAddress))
            return descriptions.withUnsafeMutableBufferPointer { packetDescriptions in
                AudioConverterFillComplexBuffer(converter, mediaAACInput, Unmanaged.passUnretained(input).toOpaque(),
                    &count, &list, packetDescriptions.baseAddress)
            }
        }
        heldPCM = owned
        guard result == noErr || result == mediaNoAudioData else {
            disposeAudio(); resetGeneration(); audioUnsupported = true
            report("AAC 音频编码失败；保留无音轨画面，不使用麦克风替代。"); return
        }
        guard count <= 16 else { disposeAudio(); resetGeneration(); return }
        // All input must be consumed; otherwise dropping the remainder would
        // silently time-compress audio. Reset instead of hiding the discontinuity.
        guard input.offset == frames else { disposeAudio(); resetGeneration(); return }
        audioInputFrames += UInt64(frames)
        if count > 0, audioConfiguration == nil {
            guard let config = audioConfig(converter, rate: UInt32(source.mSampleRate), channels: UInt16(source.mChannelsPerFrame)) else {
                disposeAudio(); resetGeneration(); audioUnsupported = true
                report("AAC-LC 配置不可用；只输出画面。"); return
            }
            resetGeneration(); audioConfiguration = config
        }
        for index in 0..<Int(count) {
            let packet = descriptions[index]
            guard packet.mStartOffset >= 0, packet.mDataByteSize > 0,
                  packet.mStartOffset <= Int64(capacity), Int(packet.mDataByteSize) <= capacity - Int(packet.mStartOffset),
                  packet.mVariableFramesInPacket == 0 || packet.mVariableFramesInPacket == 1024 else { disposeAudio(); resetGeneration(); return }
            let packetPTS = audioBasePTS + (Double(audioPacketFrames) - Double(audioPrimeFrames)) / source.mSampleRate
            audioPacketFrames += 1024
            if origin == nil { origin = min(pts, packetPTS) - 0.25 }
            let start = Int(packet.mStartOffset)
            audioPackets.append(.init(data: Data(bytes[start..<(start + Int(packet.mDataByteSize))]), pts: packetPTS))
        }
        if audioPackets.count > 96 { disposeAudio(); resetGeneration(); report("音画缓冲达到上限，正在等待新的关键帧。"); return }
        flushIfReady()
    }

    private func createAudioEncoder(format: AVAudioFormat, pts: Double) -> Bool {
        var source = format.streamDescription.pointee
        var target = AudioStreamBasicDescription(mSampleRate: source.mSampleRate, mFormatID: kAudioFormatMPEG4AAC,
            mFormatFlags: 2, mBytesPerPacket: 0, mFramesPerPacket: 1024, // ISO MPEG-4 audio object type AAC-LC.
            mBytesPerFrame: 0, mChannelsPerFrame: source.mChannelsPerFrame, mBitsPerChannel: 0, mReserved: 0)
        var created: AudioConverterRef?
        guard AudioConverterNew(&source, &target, &created) == noErr, let created else {
            audioUnsupported = true; report("AAC-LC 编码器不可用；只输出画面。"); return false
        }
        var bitrate: UInt32 = source.mChannelsPerFrame == 1 ? 64_000 : 128_000
        _ = AudioConverterSetProperty(created, kAudioConverterEncodeBitRate, UInt32(MemoryLayout<UInt32>.size), &bitrate)
        var packetSize: UInt32 = 0, propertySize = UInt32(MemoryLayout<UInt32>.size)
        guard AudioConverterGetProperty(created, kAudioConverterPropertyMaximumOutputPacketSize, &propertySize, &packetSize) == noErr,
              packetSize > 0, packetSize <= 16_384 else { AudioConverterDispose(created); return false }
        var prime = AudioConverterPrimeInfo(), primeSize = UInt32(MemoryLayout<AudioConverterPrimeInfo>.size)
        guard AudioConverterGetProperty(created, kAudioConverterPrimeInfo, &primeSize, &prime) == noErr,
              prime.leadingFrames <= 8192 else { AudioConverterDispose(created); return false }
        converter = created; audioFormat = format; maxAudioPacket = Int(packetSize)
        audioBasePTS = pts; audioPacketFrames = 0; audioInputFrames = 0; audioPrimeFrames = prime.leadingFrames
        return true
    }

    private func flushIfReady(force: Bool = false) {
        guard active, initialized, let first = videoGroup.first, let last = videoGroup.last, let origin else { return }
        let videoEnd = last.decodeTime + UInt64(last.duration)
        let seconds = Double(videoEnd - first.decodeTime) / Double(FragmentedMP4.videoTimescale)
        guard seconds >= 0.20 || force else { return }
        if seconds > 1.5 || videoGroup.count > 24 || groupBytes > 768 * 1024 {
            disposeAudio(); resetGeneration(); report("接收或编码未能及时跟上；已丢弃积压并请求关键帧。"); return
        }
        var audio: [MP4MediaSample] = [], consumed = 0
        if let config = audioConfiguration {
            let end = origin + Double(videoEnd) / Double(FragmentedMP4.videoTimescale)
            guard let latest = audioPackets.last, latest.pts + 1024 / Double(config.sampleRate) >= end else { return }
            for packet in audioPackets {
                guard packet.pts < end else { break }
                let ticks = (packet.pts - origin) * Double(config.sampleRate)
                guard ticks >= 0, ticks.isFinite, ticks <= Double(UInt64.max / 2) else { disposeAudio(); resetGeneration(); return }
                audio.append(.init(data: packet.data, decodeTime: UInt64(ticks.rounded()), duration: 1024, sync: true)); consumed += 1
            }
            guard !audio.isEmpty else { return }
        }
        do {
            guard sequence < UInt64(UInt32.max) else { resetGeneration(); return }
            sequence += 1
            let bytes = try FragmentedMP4.fragment(sequence: UInt32(sequence), video: videoGroup, audio: audio)
            onFragment(.init(generation: generation, sequence: sequence, data: bytes,
                start: Double(first.decodeTime) / Double(FragmentedMP4.videoTimescale), duration: seconds,
                independent: first.sync, updatedAt: groupObservedAt))
            videoGroup.removeAll(keepingCapacity: true); groupBytes = 0
            if consumed > 0 { audioPackets.removeFirst(consumed) }
        } catch { disposeAudio(); resetGeneration(); report("媒体片段校验失败，已清空积压并请求关键帧。") }
    }

    private func resetGeneration() {
        if let compression { VTCompressionSessionInvalidate(compression) }
        compression = nil; pixelPool = nil; generation = UUID().uuidString
        origin = nil; lastVideoPTS = nil; lastKeyframe = -Double.infinity; forceKeyframe = true
        initialized = false; sequence = 0; videoConfiguration = nil
        pendingVideo = nil; videoGroup.removeAll(keepingCapacity: false); audioPackets.removeAll(keepingCapacity: false)
        groupBytes = 0; groupObservedAt = 0
    }

    private func disposeAudio() {
        if let converter { AudioConverterDispose(converter) }
        converter = nil; audioFormat = nil; audioConfiguration = nil; heldPCM = nil
        lastAudioPTS = nil; audioPackets.removeAll(keepingCapacity: false); audioPacketFrames = 0; audioInputFrames = 0
    }

    private func videoConfig(_ format: CMFormatDescription) -> MP4VideoConfiguration? {
        var spsPointer: UnsafePointer<UInt8>?, ppsPointer: UnsafePointer<UInt8>?
        var spsSize = 0, ppsSize = 0, parameterCount = 0
        var headerLength: Int32 = 0
        guard CMVideoFormatDescriptionGetH264ParameterSetAtIndex(format, parameterSetIndex: 0, parameterSetPointerOut: &spsPointer,
            parameterSetSizeOut: &spsSize, parameterSetCountOut: &parameterCount, nalUnitHeaderLengthOut: &headerLength) == noErr,
              parameterCount >= 2, headerLength == 4, spsSize >= 4, spsSize <= 4096, let spsPointer,
              CMVideoFormatDescriptionGetH264ParameterSetAtIndex(format, parameterSetIndex: 1, parameterSetPointerOut: &ppsPointer,
            parameterSetSizeOut: &ppsSize, parameterSetCountOut: nil, nalUnitHeaderLengthOut: nil) == noErr,
              ppsSize > 0, ppsSize <= 4096, let ppsPointer else { return nil }
        return .init(width: dimensions.width, height: dimensions.height,
                     sps: Data(bytes: spsPointer, count: spsSize), pps: Data(bytes: ppsPointer, count: ppsSize))
    }

    private func validAVCC(_ bytes: Data) -> Bool {
        var offset = 0, count = 0
        while offset + 4 <= bytes.count {
            let size = bytes[offset..<(offset + 4)].reduce(0) { ($0 << 8) | Int($1) }; offset += 4
            guard size > 0, size <= bytes.count - offset, count < 256 else { return false }
            offset += size; count += 1
        }
        return count > 0 && offset == bytes.count
    }

    private func audioConfig(_ converter: AudioConverterRef, rate: UInt32, channels: UInt16) -> MP4AudioConfiguration? {
        var size: UInt32 = 0
        guard AudioConverterGetPropertyInfo(converter, kAudioConverterCompressionMagicCookie, &size, nil) == noErr,
              size > 0, size <= 4096 else { return nil }
        var cookie = [UInt8](repeating: 0, count: Int(size))
        guard AudioConverterGetProperty(converter, kAudioConverterCompressionMagicCookie, &size, &cookie) == noErr else { return nil }
        guard let asc = Self.audioSpecificConfig(Data(cookie.prefix(Int(size)))), asc.count >= 2 else { return nil }
        let object = asc[0] >> 3, index = Int((asc[0] & 7) << 1 | asc[1] >> 7), channelConfig = (asc[1] >> 3) & 15
        let rates: [UInt32] = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350]
        guard object == 2, index < rates.count, rates[index] == rate, channelConfig == channels else { return nil }
        return .init(sampleRate: rate, channels: channels, audioSpecificConfig: asc)
    }

    /// Apple AAC cookies contain an MPEG-4 descriptor, not necessarily just ASC.
    static func audioSpecificConfig(_ cookie: Data) -> Data? {
        if cookie.count == 2 { return cookie }
        func parse(_ start: Int, _ end: Int, _ depth: Int) -> Data? {
            guard depth < 4 else { return nil }
            var offset = start
            while offset + 2 <= end {
                let tag = cookie[offset]; offset += 1
                var length = 0, terminated = false
                for _ in 0..<4 {
                    guard offset < end else { return nil }
                    let byte = cookie[offset]; offset += 1; length = (length << 7) | Int(byte & 127)
                    if byte & 128 == 0 { terminated = true; break }
                }
                guard terminated, length <= end - offset else { return nil }
                let limit = offset + length
                if tag == 5 { return (2...64).contains(length) ? Data(cookie[offset..<limit]) : nil }
                if tag == 3, length >= 3 {
                    let flags = cookie[offset + 2]; var child = offset + 3
                    if flags & 0x80 != 0 { child += 2 }
                    if flags & 0x40 != 0 { guard child < limit else { return nil }; child += 1 + Int(cookie[child]) }
                    if flags & 0x20 != 0 { child += 2 }
                    if child <= limit, let found = parse(child, limit, depth + 1) { return found }
                } else if tag == 4, length >= 13, let found = parse(offset + 13, limit, depth + 1) { return found }
                offset = limit
            }
            return nil
        }
        return parse(0, cookie.count, 0)
    }

    private func validPTS(_ sample: CMSampleBuffer) -> Double? {
        let time = CMSampleBufferGetPresentationTimeStamp(sample), seconds = CMTimeGetSeconds(time)
        return time.isNumeric && seconds.isFinite && seconds >= 0 ? seconds : nil
    }
    private func report(_ message: String) {
        guard active, message != lastError else { return }; lastError = message; onUnavailable(message)
    }
    private var active: Bool { lock.lock(); defer { lock.unlock() }; return !stopped && !paused }
    private func current(_ token: UInt64) -> Bool { lock.lock(); defer { lock.unlock() }; return !stopped && !paused && lifecycle == token }
    private func releaseVideo(_ ticket: UUID) { lock.lock(); videoTickets.removeValue(forKey: ticket); lock.unlock() }
    private func releaseAudio(_ ticket: UUID) { lock.lock(); if audioTicket == ticket { audioTicket = nil }; lock.unlock() }
    private func onWork(_ action: () -> Void) { if DispatchQueue.getSpecific(key: workKey) != nil { action() } else { work.sync(execute: action) } }

    #if DIRECT_MEDIA_STANDALONE
    /// Deterministic admission-only fault injection. No actual encoder is hung.
    func verifyWatchdogTicketOwnershipForTesting() -> Bool {
        let old = UUID(), fresh = UUID(), now = ProcessInfo.processInfo.systemUptime
        lock.lock(); videoTickets[old] = now - 2; videoTickets[fresh] = now; lock.unlock()
        let previousGeneration = generation
        tick(); work.sync {}
        lock.lock()
        let isolated = videoTickets[old] == nil && videoTickets[fresh] != nil
        lock.unlock()
        releaseVideo(old) // A duplicate late completion must not release fresh.
        lock.lock(); let preserved = videoTickets[fresh] != nil; lock.unlock()
        releaseVideo(fresh)
        return isolated && preserved && generation != previousGeneration && nextVideoEncoderAttempt > now
    }
    #endif
}

private struct RawVideo { let data: Data; let ticks: UInt64; let sync: Bool; let observedAt: Double }
private struct RawAudio { let data: Data; let pts: Double }
private let mediaNoAudioData: OSStatus = 0x6e646174

private final class AACInput {
    let buffer: AVAudioPCMBuffer
    var previous: AVAudioPCMBuffer?
    var offset = 0
    init(buffer: AVAudioPCMBuffer) { self.buffer = buffer }
}

private let mediaAACInput: AudioConverterComplexInputDataProc = { _, requested, output, _, opaque in
    guard let opaque else { requested.pointee = 0; return mediaNoAudioData }
    let context = Unmanaged<AACInput>.fromOpaque(opaque).takeUnretainedValue()
    let available = Int(context.buffer.frameLength) - context.offset
    guard available > 0 else { requested.pointee = 0; return mediaNoAudioData }
    let count = min(Int(requested.pointee), available)
    let source = UnsafeMutableAudioBufferListPointer(context.buffer.mutableAudioBufferList)
    output.pointee.mNumberBuffers = UInt32(source.count)
    let destination = UnsafeMutableAudioBufferListPointer(output)
    let stride = Int(context.buffer.format.streamDescription.pointee.mBytesPerFrame)
    for index in 0..<source.count {
        destination[index] = AudioBuffer(mNumberChannels: source[index].mNumberChannels,
            mDataByteSize: UInt32(count * stride), mData: source[index].mData?.advanced(by: context.offset * stride))
    }
    requested.pointee = UInt32(count); context.offset += count; context.previous = nil
    return noErr
}
