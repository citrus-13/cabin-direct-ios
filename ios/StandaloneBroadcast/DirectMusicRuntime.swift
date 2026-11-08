import Foundation
import CoreMedia
import DirectCore

/// Lives only as long as the user-started broadcast; no background-task or audio keepalive tricks.
final class DirectMusicRuntime {
    private let settings: DirectSettings
    private let queue = DispatchQueue(label: "CabinDirect.MusicState")
    private let queueKey = DispatchSpecificKey<UInt8>()
    private let onState: (LocalMusicState) -> Void
    private var recognizer: DirectMusicRecognizer?
    private let client = DirectLyricsClient()
    private var active = false
    private var paused = false
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

    init(settings: DirectSettings, onState: @escaping (LocalMusicState) -> Void) {
        self.settings = settings; self.onState = onState
        queue.setSpecific(key: queueKey, value: 1)
    }

    func start() {
        queue.async {
            guard !self.active, self.settings.musicMode != .off else { return }
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
                        guard let self, self.active, !self.paused,
                              timestamp >= self.acceptedAfter else { return }
                        self.lastAudioAt = timestamp
                    }
                })
            }
            self.publish()
        }
    }

    func append(_ sample: CMSampleBuffer) {
        // This sync returns a handle only; audio admission and single-buffer bounding are in recognizer.
        let value = queue.sync { active && !paused ? recognizer : nil }
        value?.append(sample)
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
              let value = DirectMusicClock(title: title, artist: artist, source: source,
                                           position: position, matchedAt: observedAt) else { return }
        clock = value
        // Same-title live/remastered recordings must never inherit the other recording's cache.
        let key = value.key + "\u{1e}" + (source == "manual" ? "manual" :
            (recognitionID.isEmpty ? UUID().uuidString : String(recognitionID.prefix(512))))
        if cachedKey != key { timeline = nil; cachedKey = key }
        message = source == "manual" ? "用户 / 快捷指令提供的曲目；进度为手动估算，不感知暂停、跳转或换曲。" :
            "ShazamKit 匹配；播放位置是估算，不是播放器实时进度。"
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
        guard active, !paused else { return }
        switch value {
        case "recognizing":
            // Do not continue showing the old track while a new recognition window starts.
            clock = nil; status = "recognizing"; message = "正在识别系统允许提供的音频；不使用麦克风。"
        case "unavailable":
            clock = nil; client.cancel(); generation &+= 1
            status = "unavailable"; message = "识曲服务不可用，可能未启用 App ID 的 ShazamKit 服务。本次不再尝试，不会付费升级；可改用系统快捷指令或手动曲目。"
        case "no-audio", "no-match":
            clock = nil; status = "waiting"
            message = value == "no-audio" ? "未收到可用的非静音 App 音频；播放器或受保护内容可能不允许。" : "未匹配到歌曲；本次不会无限重试。"
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
            self.status = value ? "paused" : "waiting"
            self.message = value ? "广播暂停，音乐与歌词已清空。" :
                (self.settings.musicMode == .manual ? "手动曲目计时已失效，请结束并按实际进度重新开始。" : "等待恢复后的新识曲结果。")
            self.publish()
        }
    }

    func stop() {
        let finish = {
            self.active = false; self.generation &+= 1
            self.recognizer?.stop(); self.recognizer = nil
            self.client.stop(); self.clock = nil; self.timeline = nil; self.lastAudioAt = nil
        }
        if DispatchQueue.getSpecific(key: queueKey) != nil { finish() }
        else { queue.sync(execute: finish) }
    }
}
