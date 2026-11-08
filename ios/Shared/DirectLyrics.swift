import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

struct DirectLyricLine: Equatable {
    let time: Double
    let text: String
}

struct DirectLyricTimeline {
    let lines: [DirectLyricLine]
    init(lrc: String) {
        guard lrc.utf8.count <= 512_000 else { lines = []; return }
        let pattern = try! NSRegularExpression(pattern: #"\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]"#)
        var parsed: [DirectLyricLine] = []
        var offset: Double = 0
        for raw in lrc.components(separatedBy: .newlines).prefix(4_000) {
            if parsed.count >= 8_000 { break }
            let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            if value.lowercased().hasPrefix("[offset:"), value.hasSuffix("]"),
               let milliseconds = Double(value.dropFirst(8).dropLast()), milliseconds.isFinite,
               abs(milliseconds) <= 600_000 { offset = milliseconds / 1000; continue }
            let string = value as NSString
            let matches = pattern.matches(in: value, range: NSRange(location: 0, length: string.length))
            guard let last = matches.last else { continue }
            let text = String(string.substring(from: last.range.location + last.range.length).prefix(120))
                .trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { continue }
            for match in matches {
                guard let minutes = Double(string.substring(with: match.range(at: 1))),
                      let seconds = Double(string.substring(with: match.range(at: 2))), seconds < 60 else { continue }
                let fractionRange = match.range(at: 3)
                let fraction = fractionRange.location == NSNotFound ? 0 :
                    (Double("0." + string.substring(with: fractionRange)) ?? 0)
                parsed.append(.init(time: minutes * 60 + seconds + fraction, text: text))
                if parsed.count >= 8_000 { break }
            }
        }
        lines = parsed.map { .init(time: max(0, $0.time - offset), text: $0.text) }
            .sorted { $0.time == $1.time ? $0.text < $1.text : $0.time < $1.time }
    }

    func visible(at position: Double) -> [String] {
        guard position.isFinite, position >= 0, let index = lines.lastIndex(where: { $0.time <= position }) else { return [] }
        return Array(lines[max(0, index - 1)...min(lines.count - 1, index + 2)].map(\.text))
    }
}

enum DirectLyricsRetry {
    /// Retry-After is a lower bound, never permission for an automatic retry.
    static func delay(header: String?, now: Date) -> Double {
        guard let header else { return 60 }
        let value = header.trimmingCharacters(in: .whitespacesAndNewlines)
        if let seconds = Double(value), seconds.isFinite, seconds >= 0 {
            return max(60, seconds)
        }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss zzz"
        guard let date = formatter.date(from: value) else { return 60 }
        return max(60, date.timeIntervalSince(now))
    }
}

/// Optional exact-track lookup. No account/API key, background discovery, microphone or disk cache.
/// The caller must obtain opt-in before constructing a request containing song metadata.
final class DirectLyricsClient: NSObject, URLSessionDataDelegate {
    private let lock = NSLock()
    private var current: URLSessionDataTask?
    private var body = Data()
    private var done: ((Result<DirectLyricTimeline, Error>) -> Void)?
    private var expected: (title: String, artist: String, duration: Double?)?
    private var responseOK = false
    private var lastRequestAt: Double = -.infinity
    private var nextAllowedAt: Double = -.infinity
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 10
        config.timeoutIntervalForResource = 12
        let queue = OperationQueue()
        queue.maxConcurrentOperationCount = 1
        return URLSession(configuration: config, delegate: self, delegateQueue: queue)
    }()

    func lookup(title: String, artist: String, duration: Double?, completion: @escaping (Result<DirectLyricTimeline, Error>) -> Void) {
        cancel()
        guard !title.isEmpty, !artist.isEmpty, title.count <= 200, artist.count <= 200 else {
            completion(.failure(DemoError.message("曲名和歌手不完整，未查询网络歌词。"))); return
        }
        var url = URLComponents(string: "https://lrclib.net/api/get")!
        url.queryItems = [.init(name: "track_name", value: title), .init(name: "artist_name", value: artist)]
        if let duration, duration.isFinite, duration > 0, duration < 86_400 {
            url.queryItems?.append(.init(name: "duration", value: String(duration)))
        }
        var request = URLRequest(url: url.url!)
        request.setValue("CabinDirect/0.5 (+https://github.com/citrus-13/cabin-direct-ios; opt-in lyrics)", forHTTPHeaderField: "User-Agent")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        lock.lock()
        let now = ProcessInfo.processInfo.systemUptime
        guard now - lastRequestAt >= 10, now >= nextAllowedAt else {
            lock.unlock()
            completion(.failure(DemoError.message("歌词服务冷却中，本次不查询网络歌词；没有自动重试。")))
            return
        }
        lastRequestAt = now
        body = Data(); responseOK = false; done = completion; expected = (title, artist, duration)
        let task = session.dataTask(with: request)
        current = task
        lock.unlock()
        task.resume()
    }

    func cancel() {
        lock.lock()
        let task = current
        current = nil; done = nil; expected = nil; body = Data()
        lock.unlock()
        task?.cancel()
    }

    func stop() { cancel(); session.invalidateAndCancel() }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        lock.lock()
        guard current === dataTask else { lock.unlock(); completionHandler(.cancel); return }
        if let http = response as? HTTPURLResponse, http.statusCode == 429 {
            let delay = DirectLyricsRetry.delay(header: http.value(forHTTPHeaderField: "Retry-After"), now: Date())
            nextAllowedAt = max(nextAllowedAt, ProcessInfo.processInfo.systemUptime + delay)
        }
        let valid = current === dataTask && (response as? HTTPURLResponse)?.statusCode == 200 &&
            response.url?.scheme == "https" && response.url?.host == "lrclib.net" &&
            (response.expectedContentLength < 0 || response.expectedContentLength <= 1_048_576) &&
            (response.mimeType == "application/json")
        responseOK = valid
        lock.unlock()
        completionHandler(valid ? .allow : .cancel)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.lock()
        guard current === dataTask else { lock.unlock(); return }
        if body.count + data.count > 1_048_576 {
            responseOK = false
            lock.unlock(); dataTask.cancel(); return
        }
        body.append(data)
        lock.unlock()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        lock.lock()
        guard current === task, let callback = done, let track = expected else { lock.unlock(); return }
        let bytes = body, valid = responseOK
        current = nil; done = nil; expected = nil; body = Data()
        lock.unlock()
        guard error == nil, valid,
              let item = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any],
              let returnedTitle = item["trackName"] as? String,
              let returnedArtist = item["artistName"] as? String,
              Self.normalized(returnedTitle) == Self.normalized(track.title),
              Self.normalized(returnedArtist) == Self.normalized(track.artist),
              let lrc = item["syncedLyrics"] as? String else {
            callback(.failure(DemoError.message("没有匹配的逐行歌词，或查询不可用；不会反复重试。"))); return
        }
        if let duration = track.duration {
            guard let returned = item["duration"] as? Double, returned.isFinite, abs(duration - returned) <= 2 else {
                callback(.failure(DemoError.message("歌词版本时长不匹配，已拒绝显示。"))); return
            }
        }
        let timeline = DirectLyricTimeline(lrc: lrc)
        guard !timeline.lines.isEmpty else {
            callback(.failure(DemoError.message("此曲目没有可用的逐行时间轴。"))); return
        }
        callback(.success(timeline))
    }

    private static func normalized(_ text: String) -> String {
        text.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "en_US_POSIX"))
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
