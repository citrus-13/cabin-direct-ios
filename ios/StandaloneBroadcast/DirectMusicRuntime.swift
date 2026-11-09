import Foundation
import CoreMedia
import AVFAudio
import DirectCore

/// Lives only as long as a user-started broadcast or consented acoustic session.
final class DirectMusicRuntime {
    enum Input { case broadcast, microphone }
    private let settings: DirectSettings
    private let input: Input
    private let queue = DispatchQueue(label: "CabinDirect.MusicState")
    private let queueKey = DispatchSpecificKey<UInt8>()
    private let onState: (LocalMusicState) -> Void
    private var recognizer: DirectMusicRecognizer?
    // The microphone callback must never queue.sync behind state/network work.
    private let microphoneAdmission = NSLock()
    private var microphoneRecognizer: DirectMusicRecognizer?
    private let client = DirectLyricsClient()
    private var active = false
    private var paused = false
    private var recognitionUnavailable = false
    private var generation: UInt64 = 0
    private var acceptedAfter: Double = 0
    private var clock: DirectMusicClock?
    private var lastAudioAt: Double?
    private var timeline: DirectLyricTimeline?
    private var cachedKey: String?
    private var lookupKey: String?
    private var lookupState = "matched"
    private var status = "waiting"
    private var message = "等待识曲；不会读取音乐 App 的后台播放控制。"

    init(settings: DirectSettings, input: Input = .broadcast,
         onState: @escaping (LocalMusicState) -> Void) {
        self.settings = settings; self.input = input; self.onState = onState
        if input == .microphone { message = "等待麦克风收音识曲；仅识别环境中实际听得到的音乐。" }
        queue.setSpecific(key: queueKey, value: 1)
    }

    func start() {
        queue.async {
            guard !self.active, self.settings.musicMode != .off else { return }
            // Acoustic mode must never silently substitute user-entered metadata.
            guard self.input != .microphone || self.settings.musicMode != .manual else { return }
            self.active = true; self.acceptedAfter = Date().timeIntervalSince1970
            if self.settings.musicMode == .manual {
                self.accept(title: self.settings.musicTitle, artist: self.settings.musicArtist,
                            position: self.settings.musicPosition, observedAt: self.acceptedAfter, source: "manual")
            } else {
                self.recognizer = DirectMusicRecognizer(onMatch: { [weak self] track in
                    self?.queue.async { [weak self] in
                        self?.accept(title: track.title, artist: track.artist, position: track.position,
                                     observedAt: track.observedAt, source: "shazam", recognitionID: track.recognitionID)
                    }
                }, onStatus: { [weak self] value in
                    self?.queue.async { [weak self] in self?.recognitionStatus(value) }
                }, onAudioActivity: { [weak self] timestamp in
                    self?.queue.async { [weak self] in
                        guard let self, self.active, !self.paused, !self.recognitionUnavailable,
                              timestamp >= self.acceptedAfter else { return }
                        self.lastAudioAt = timestamp
                    }
                }, continuousNoMatch: self.input == .microphone)
                self.updateMicrophoneIngress()
            }
            self.publish()
        }
    }

    func append(_ sample: CMSampleBuffer) {
        guard input == .broadcast else { return }
        // This sync returns a handle only; audio admission and single-buffer bounding are in recognizer.
        let value = queue.sync { active && !paused ? recognizer : nil }
        value?.append(sample)
    }

    func appendMicrophone(_ buffer: AVAudioPCMBuffer) {
        guard input == .microphone, microphoneAdmission.try() else { return }
        let value = microphoneRecognizer
        microphoneAdmission.unlock()
        value?.appendPCM(buffer)
    }

    /// Called only on the state queue, never from the audio tap.
    private func updateMicrophoneIngress() {
        microphoneAdmission.lock()
        microphoneRecognizer = input == .microphone && active && !paused && !recognitionUnavailable ? recognizer : nil
        microphoneAdmission.unlock()
    }

    func tick() {
        queue.async {
            guard self.active else { return }
            self.recognizer?.tick()
            self.publish()
        }
    }

    private func accept(title: String, artist: String, position: Double, observedAt: Double, source: String, recognitionID: String = "") {
        let now = Date().timeIntervalSince1970
        guard active, !paused, observedAt >= acceptedAfter, observedAt <= now, now - observedAt <= 3,
              !recognitionUnavailable,
              let value = DirectMusicClock(title: title, artist: artist, source: source,
                                           position: position, matchedAt: observedAt) else { return }
        clock = value
        // Same-title live/remastered recordings must never inherit the other recording's cache.
        let key = value.key + "\u{1e}" + (source == "manual" ? "manual" :
            (recognitionID.isEmpty ? UUID().uuidString : String(recognitionID.prefix(512))))
        if cachedKey != key { timeline = nil; cachedKey = key }
        message = source == "manual" ? "用户 / 快捷指令提供的曲目；进度为手动估算，不感知暂停、跳转或换曲。" :
            (input == .microphone ? "麦克风环境声音经 ShazamKit 匹配；播放位置是估算，不是播放器实时进度。" :
             "ShazamKit 匹配；播放位置是估算，不是播放器实时进度。")
        if !settings.networkLyricsAllowed { lookupState = "matched"; publish(); return }
        if timeline != nil { lookupState = "lyrics"; publish(); return }
        guard lookupKey != key else { publish(); return }
        lookupKey = key; lookupState = "loading"
        let requestGeneration = generation, requestKey = key
        client.lookup(title: title, artist: artist, duration: nil) { [weak self] result in
            self?.queue.async { [weak self] in
                guard let self, self.active, !self.paused, self.generation == requestGeneration,
                      self.cachedKey == requestKey, self.lookupKey == requestKey else { return }
                switch result {
                case .success(let lyrics): self.timeline = lyrics; self.lookupState = "lyrics"
                case .failure: self.timeline = nil; self.lookupState = "no-lyrics"
                }
                self.publish()
            }
        }
        publish()
    }

    private func recognitionStatus(_ value: String) {
        guard active, !paused, !recognitionUnavailable else { return }
        switch value {
        case "recognizing":
            // Do not continue showing the old track while a new recognition window starts.
            clock = nil; status = "recognizing"
            message = input == .microphone ? "正在通过麦克风识别听得到的环境音乐。" : "正在识别系统允许提供的音频；不使用麦克风。"
        case "unavailable":
            recognitionUnavailable = true
            updateMicrophoneIngress()
            clock = nil; client.cancel(); generation &+= 1
            status = "unavailable"
            message = input == .microphone ?
                "声学识曲服务不可用，可能当前签名未支持 ShazamKit 服务。本次已停止尝试，不会付费升级；没有识曲结果。" :
                "识曲服务不可用，可能未启用 App ID 的 ShazamKit 服务。本次不再尝试，不会付费升级；可改用系统快捷指令或手动曲目。"
        case "no-audio", "no-match":
            clock = nil; status = "waiting"
            if input == .microphone {
                message = value == "no-audio" ? "麦克风未收到可用的非静音环境声音；请确认附近有可听见的音乐。" :
                    "暂未匹配到歌曲；本次用户启动的收音将在 15–60 秒冷却后继续尝试，可随时停止。"
            } else {
                message = value == "no-audio" ? "未收到可用的非静音 App 音频；播放器或受保护内容可能不允许。" : "未匹配到歌曲；本次不会无限重试。"
            }
        default: break
        }
        publish()
    }

    private func publish() {
        guard active else { return }
        let now = Date().timeIntervalSince1970
        var result = LocalMusicState(status: paused ? "paused" : status, updatedAt: now,
                                     source: settings.musicMode == .manual ? "manual" : "shazam", message: message)
        if !paused, let clock, let position = clock.estimate(at: now, lastAudioAt: lastAudioAt) {
            result.status = lookupState; result.title = clock.title; result.artist = clock.artist
            result.position = position; result.matchedAt = clock.matchedAt
            result.lines = timeline?.visible(at: position) ?? []
            if lookupState == "lyrics" { result.message += " 歌词仅按歌名、歌手匹配，录音版本未核验；不是精确同步。" }
            if lookupState == "no-lyrics" { result.message += " LRCLIB 无匹配的逐行歌词或暂不可用；不会补造歌词。" }
        } else if clock != nil, !paused {
            result.status = "stale"; result.message = "音乐状态已过期或音频中断，已隐藏旧曲目与歌词。"
        }
        onState(result)
    }

    func setPaused(_ value: Bool) {
        queue.async {
            guard self.active else { return }
            self.paused = value; self.acceptedAfter = Date().timeIntervalSince1970
            self.generation &+= 1; self.client.cancel(); self.clock = nil; self.lastAudioAt = nil
            self.timeline = nil; self.cachedKey = nil; self.lookupKey = nil
            self.recognizer?.setPaused(value)
            self.updateMicrophoneIngress()
            self.status = value ? "paused" : (self.recognitionUnavailable ? "unavailable" : "waiting")
            self.message = value ? "广播暂停，音乐与歌词已清空。" :
                (self.recognitionUnavailable ? "识曲服务在本次广播中不可用；暂停恢复不会重试或付费升级。请结束后选择手动曲目。" :
                    (self.settings.musicMode == .manual ? "手动曲目计时已失效，请结束并按实际进度重新开始。" : "等待恢复后的新识曲结果。"))
            if self.input == .microphone {
                self.message = value ? "收音暂停，音乐与歌词已清空。" :
                    (self.recognitionUnavailable ? "本次声学识曲服务不可用；恢复不会重试或付费升级，没有识曲结果。" : "等待恢复收音后的新识曲结果。")
            }
            self.publish()
        }
    }

    func stop() {
        let finish = {
            self.active = false; self.generation &+= 1
            self.updateMicrophoneIngress()
            self.recognizer?.stop(); self.recognizer = nil
            self.client.stop(); self.clock = nil; self.timeline = nil; self.lastAudioAt = nil
        }
        if DispatchQueue.getSpecific(key: queueKey) != nil { finish() }
        else { queue.sync(execute: finish) }
    }
}
