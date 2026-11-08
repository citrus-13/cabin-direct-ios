import Foundation
import AVFAudio
import CoreMedia
import ShazamKit

struct DirectRecognizedTrack {
    let title: String
    let artist: String
    let position: Double
    let observedAt: Double
    let recognitionID: String
}

/// Optional, consent-gated recognition of ReplayKit .audioApp samples only.
/// The caller must never pass .audioMic samples, and must call tick() about once
/// per second while the genuine user-started broadcast is running. No recording,
/// file persistence, microphone access, playback session, or custom catalog.
/// ShazamKit generates a signature for Apple's catalog; availability is not
/// promised for a free signing account. Any service error disables this instance.
final class DirectMusicRecognizer: NSObject, SHSessionDelegate {
    private static let sampleRate = 44_100.0
    private static let maxChunkDuration = 0.25
    private static let noAudioAfter = 3.0
    private static let maxWindowDuration = 12.0
    private static let maxWindowAudio = 10.0
    private static let cooldown = 15.0
    private static let maxFailures = 3
    private static let minimumRMS = 0.0001 // -80 dBFS; zero/protected audio is not activity.

    private let queue = DispatchQueue(label: "CabinDirect.MusicRecognition")
    private let queueKey = DispatchSpecificKey<UInt8>()
    private let admission = NSLock()
    // Admission fields are accessed only under admission, including lifecycle reads.
    private var generation: UInt64 = 0
    private var stopped = false
    private var paused = false
    private var disabled = false
    private var audioInFlight = false

    // All remaining mutable state and every client callback belong to queue.
    private let onMatch: (DirectRecognizedTrack) -> Void
    private let onStatus: (String) -> Void
    private let onAudioActivity: ((Double) -> Void)?
    private var matchingSession: SHSession?
    private var sessionGeneration: UInt64 = 0
    private var converter: AVAudioConverter?
    private var inputFormat: AVAudioFormat?
    private var expectedPTS: Double?
    private var windowStarted = 0.0
    private var windowAudio = 0.0
    private var lastActivity = 0.0
    private var waitingSince = ProcessInfo.processInfo.systemUptime
    private var nextAttempt = 0.0
    private var failures = 0
    private var lastStatus = ""

    init(onMatch: @escaping (DirectRecognizedTrack) -> Void,
         onStatus: @escaping (String) -> Void,
         onAudioActivity: ((Double) -> Void)? = nil) {
        self.onMatch = onMatch
        self.onStatus = onStatus
        self.onAudioActivity = onAudioActivity
        super.init()
        queue.setSpecific(key: queueKey, value: 1)
    }

    /// Retains at most one admitted sample. Busy callbacks are dropped, not queued.
    func append(_ sample: CMSampleBuffer) {
        admission.lock()
        guard !stopped, !paused, !disabled, !audioInFlight else { admission.unlock(); return }
        audioInFlight = true
        let token = generation
        admission.unlock()
        queue.async { [weak self] in
            guard let self else { return }
            defer {
                self.admission.lock(); self.audioInFlight = false; self.admission.unlock()
            }
            autoreleasepool {
                guard self.isCurrent(token) else { return }
                self.process(sample, generation: token)
            }
        }
    }

    func setPaused(_ value: Bool) {
        admission.lock()
        guard !stopped, paused != value else { admission.unlock(); return }
        paused = value
        generation &+= 1 // Invalidate already admitted audio before waiting for queue.
        admission.unlock()
        onQueue {
            self.clearWindow()
            self.lastActivity = 0
            self.waitingSince = ProcessInfo.processInfo.systemUptime
            // A service failure is terminal even after resume; no hidden retry.
            if !self.isDisabled {
                self.status(value ? "paused" : "waiting")
            }
        }
    }

    func stop() {
        admission.lock()
        guard !stopped else { admission.unlock(); return }
        stopped = true; generation &+= 1
        admission.unlock()
        onQueue {
            self.clearWindow()
            self.lastActivity = 0
            self.status("stopped")
        }
    }

    /// Use the broadcast's existing 1 Hz timer; this class starts no background timer.
    func tick() {
        queue.async { [weak self] in
            guard let self, self.isActive else { return }
            let now = ProcessInfo.processInfo.systemUptime
            if now - max(self.lastActivity, self.waitingSince) >= Self.noAudioAfter {
                self.clearWindow()
                self.status("no-audio")
            } else if self.matchingSession != nil && now - self.windowStarted >= Self.maxWindowDuration {
                self.noMatch(now: now)
            }
        }
    }

    private func process(_ sample: CMSampleBuffer, generation token: UInt64) {
        let now = ProcessInfo.processInfo.systemUptime
        if matchingSession != nil && now - windowStarted >= Self.maxWindowDuration {
            noMatch(now: now)
        }
        guard isCurrent(token), CMSampleBufferDataIsReady(sample),
              let description = CMSampleBufferGetFormatDescription(sample),
              CMFormatDescriptionGetMediaType(description) == kCMMediaType_Audio,
              let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(description) else { return }
        let frames = CMSampleBufferGetNumSamples(sample)
        let rate = asbd.pointee.mSampleRate
        // Cap every allocation independently of the untrusted source buffer size.
        guard asbd.pointee.mFormatID == kAudioFormatLinearPCM,
              rate.isFinite, rate >= 8_000, rate <= 96_000,
              (1...2).contains(asbd.pointee.mChannelsPerFrame),
              (16...32).contains(asbd.pointee.mBitsPerChannel),
              asbd.pointee.mBytesPerFrame > 0, asbd.pointee.mBytesPerFrame <= 8,
              frames > 0, frames <= 24_000,
              Double(frames) / rate <= Self.maxChunkDuration,
              let format = AVAudioFormat(streamDescription: asbd),
              [.pcmFormatFloat32, .pcmFormatInt16, .pcmFormatInt32].contains(format.commonFormat),
              let owned = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(frames)) else {
            status("no-audio")
            return
        }
        owned.frameLength = AVAudioFrameCount(frames)
        guard CMSampleBufferCopyPCMDataIntoAudioBufferList(sample, at: 0, frameCount: Int32(frames),
                                                          into: owned.mutableAudioBufferList) == noErr else { return }

        let pts = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sample))
        guard pts.isFinite, pts >= 0 else { return }
        if inputFormat != format || (expectedPTS.map { abs(pts - $0) > 0.1 } ?? false) {
            // Never stitch a seek, format change, pause or dropped-audio gap into a match.
            clearWindow()
        }
        expectedPTS = pts + Double(frames) / rate
        guard let pcm = convert(owned), isCurrent(token) else { return }
        guard isAudible(pcm) else {
            // Never join music from opposite sides of a silent/protected interval.
            clearWindow()
            return
        }
        lastActivity = now
        onAudioActivity?(Date().timeIntervalSince1970)
        guard isCurrent(token), now >= nextAttempt else { return }
        if matchingSession == nil {
            let session = SHSession() // Native global catalog only; App Service may reject access.
            session.delegate = self
            matchingSession = session
            sessionGeneration = token
            windowStarted = now; windowAudio = 0
            status("recognizing")
        }
        guard isCurrent(token), let session = matchingSession else { return }
        // iOS 16 requires the same supported PCM format for the entire session.
        session.matchStreamingBuffer(pcm, at: nil)
        windowAudio += Double(pcm.frameLength) / Self.sampleRate
        if windowAudio >= Self.maxWindowAudio {
            // Stop feeding, but allow the asynchronous result until the 12s deadline.
            nextAttempt = now + Self.maxWindowDuration
        }
    }

    private func convert(_ input: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
        guard let outputFormat = AVAudioFormat(standardFormatWithSampleRate: Self.sampleRate, channels: 1) else { return nil }
        if inputFormat != input.format || converter == nil {
            converter = AVAudioConverter(from: input.format, to: outputFormat)
            inputFormat = input.format
        }
        let capacity = AVAudioFrameCount(ceil(Double(input.frameLength) * Self.sampleRate / input.format.sampleRate) + 64)
        guard capacity <= 11_100, let output = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: capacity),
              let converter else { return nil }
        var supplied = false
        var error: NSError?
        let result = converter.convert(to: output, error: &error) { _, status in
            guard !supplied else { status.pointee = .noDataNow; return nil }
            supplied = true; status.pointee = .haveData
            return input
        }
        guard error == nil, result != .error, output.frameLength > 0 else { return nil }
        return output
    }

    private func isAudible(_ buffer: AVAudioPCMBuffer) -> Bool {
        guard buffer.format.channelCount == 1, let samples = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return false }
        var energy = 0.0
        for index in 0..<Int(buffer.frameLength) {
            let value = Double(samples[index])
            guard value.isFinite, abs(value) <= 1.5 else { return false }
            energy += value * value
        }
        return sqrt(energy / Double(buffer.frameLength)) >= Self.minimumRMS
    }

    func session(_ session: SHSession, didFind match: SHMatch) {
        queue.async { [weak self] in
            guard let self, self.accepts(session), let item = match.mediaItems.first else { return }
            let title = Self.text(item.title), artist = Self.text(item.artist)
            let position = item.predictedCurrentMatchOffset
            guard !title.isEmpty, !artist.isEmpty, position.isFinite, position >= 0, position <= 86_400 else {
                self.noMatch(now: ProcessInfo.processInfo.systemUptime); return
            }
            let identifier = Self.text(item.shazamID)
            let track = DirectRecognizedTrack(title: title, artist: artist, position: position,
                observedAt: Date().timeIntervalSince1970,
                recognitionID: identifier)
            self.failures = 0
            self.clearWindow()
            self.nextAttempt = ProcessInfo.processInfo.systemUptime + Self.cooldown
            self.status("waiting")
            // Lifecycle is checked again immediately before publishing metadata.
            guard self.isActive else { return }
            self.onMatch(track)
        }
    }

    func session(_ session: SHSession, didNotFindMatchFor signature: SHSignature, error: Error?) {
        queue.async { [weak self] in
            guard let self, self.accepts(session) else { return }
            if error != nil {
                // Don't disclose raw service errors or account identifiers, retry,
                // upgrade an account, or claim a missing App Service is available.
                self.disable("unavailable")
            } else {
                self.noMatch(now: ProcessInfo.processInfo.systemUptime)
            }
        }
    }

    private func accepts(_ session: SHSession) -> Bool {
        guard matchingSession === session, isCurrent(sessionGeneration) else { return false }
        let now = ProcessInfo.processInfo.systemUptime
        return now - windowStarted <= Self.maxWindowDuration && lastActivity > 0 && now - lastActivity <= Self.noAudioAfter
    }

    private func noMatch(now: Double) {
        clearWindow()
        failures += 1
        nextAttempt = now + Self.cooldown
        if failures >= Self.maxFailures {
            disable("no-match")
        } else {
            status("no-match")
        }
    }

    private func disable(_ message: String) {
        admission.lock(); disabled = true; generation &+= 1; admission.unlock()
        clearWindow()
        status(message)
    }

    private func clearWindow() {
        matchingSession?.delegate = nil
        matchingSession = nil
        converter?.reset(); converter = nil; inputFormat = nil; expectedPTS = nil
        windowStarted = 0; windowAudio = 0
    }

    private func status(_ value: String) {
        let bounded = String(value.prefix(240))
        guard bounded != lastStatus else { return }
        lastStatus = bounded
        onStatus(bounded)
    }

    private static func text(_ value: String?) -> String {
        guard let value, value.count <= 2_048 else { return "" }
        return String(String.UnicodeScalarView(value.unicodeScalars.filter { !CharacterSet.controlCharacters.contains($0) }))
            .trimmingCharacters(in: .whitespacesAndNewlines).prefix(256).description
    }

    private var isDisabled: Bool {
        admission.lock(); defer { admission.unlock() }
        return disabled
    }

    private var isActive: Bool {
        admission.lock(); defer { admission.unlock() }
        return !stopped && !paused && !disabled
    }

    private func isCurrent(_ token: UInt64) -> Bool {
        admission.lock(); defer { admission.unlock() }
        return !stopped && !paused && !disabled && generation == token
    }

    private func onQueue(_ action: () -> Void) {
        if DispatchQueue.getSpecific(key: queueKey) != nil { action() } else { queue.sync(execute: action) }
    }
}
