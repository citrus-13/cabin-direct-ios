import Foundation
import AppKit
import Security
import DirectCore

// Original synthetic content only. This macOS fixture is not an iPhone/ReplayKit test.
let arguments = CommandLine.arguments
func argument(_ name: String, fallback: String) -> String {
    guard let index = arguments.firstIndex(of: name), arguments.indices.contains(index + 1) else { return fallback }
    return arguments[index + 1]
}
let port = UInt16(argument("--port", fallback: "8765")) ?? 8765
let code = argument("--paircode", fallback: "482619")
let assetDirectory = argument("--assets", fallback: "../StandaloneWeb")
let pauseAfter = Double(argument("--pause-after", fallback: "0")) ?? 0
let mediaManifestPath = argument("--media-fixture", fallback: "")
struct MediaFixtureManifest: Decodable {
    struct Fragment: Decodable { let file: String; let sequence: UInt64; let start: Double; let duration: Double; let independent: Bool }
    let schema: Int; let mime: String; let hasAudio: Bool; let initFile: String; let fragments: [Fragment]
}
struct MediaFixture {
    let manifest: MediaFixtureManifest; let initialization: Data; let fragments: [Data]
    init(path: String) throws {
        guard path.hasPrefix("/") else { throw NSError(domain: "Fixture requires an absolute manifest path", code: 1) }
        let url = URL(fileURLWithPath: path).standardizedFileURL.resolvingSymlinksInPath(), directory = url.deletingLastPathComponent()
        func bounded(_ file: URL, max: Int) throws -> Data {
            let attributes = try FileManager.default.attributesOfItem(atPath: file.path)
            guard attributes[.type] as? FileAttributeType == .typeRegular,
                  let size = attributes[.size] as? NSNumber, size.intValue > 0, size.intValue <= max else {
                throw NSError(domain: "Invalid fixture file bounds", code: 2)
            }
            let handle = try FileHandle(forReadingFrom: file)
            defer { try? handle.close() }
            let data = try handle.read(upToCount: max + 1) ?? Data()
            guard !data.isEmpty, data.count <= max else { throw NSError(domain: "Fixture changed during read", code: 3) }
            return data
        }
        func child(_ name: String) throws -> URL {
            guard !name.isEmpty, name.count <= 100, !name.contains(".."),
                  name.range(of: "^[A-Za-z0-9._-]+$", options: .regularExpression) != nil else { throw NSError(domain: "Invalid fixture filename", code: 4) }
            let file = directory.appendingPathComponent(name).resolvingSymlinksInPath()
            guard file.deletingLastPathComponent() == directory else { throw NSError(domain: "Fixture escapes directory", code: 5) }
            return file
        }
        manifest = try JSONDecoder().decode(MediaFixtureManifest.self, from: bounded(url, max: 65_536))
        guard manifest.schema == 1, !manifest.fragments.isEmpty, manifest.fragments.count <= 512,
              manifest.fragments.first?.independent == true else { throw NSError(domain: "Invalid media fixture", code: 6) }
        let mimePattern = manifest.hasAudio ? "^video/mp4; codecs=\"avc1\\.[A-Fa-f0-9]{6}, ?mp4a\\.40\\.2\"$" : "^video/mp4; codecs=\"avc1\\.[A-Fa-f0-9]{6}\"$"
        guard manifest.mime.range(of: mimePattern, options: .regularExpression) != nil else { throw NSError(domain: "Invalid fixture codec", code: 11) }
        initialization = try bounded(child(manifest.initFile), max: 65_536)
        var result: [Data] = [], total = initialization.count, previous: MediaFixtureManifest.Fragment?
        for fragment in manifest.fragments {
            guard fragment.start.isFinite, fragment.start >= 0, fragment.start <= 86400, fragment.duration.isFinite, fragment.duration > 0, fragment.duration <= 2,
                  fragment.sequence <= 9_007_199_254_740_991 else { throw NSError(domain: "Invalid fixture timestamp", code: 7) }
            if let previous {
                guard fragment.sequence == previous.sequence + 1,
                      abs(fragment.start - previous.start - previous.duration) <= 0.1 else { throw NSError(domain: "Noncontiguous fixture", code: 8) }
            }
            let data = try bounded(child(fragment.file), max: 1_048_576)
            total += data.count; guard total <= 33_554_432 else { throw NSError(domain: "Fixture exceeds 32 MiB", code: 9) }
            result.append(data); previous = fragment
        }
        guard let first = manifest.fragments.first, let last = manifest.fragments.last,
              last.start + last.duration - first.start <= 120 else { throw NSError(domain: "Fixture duration exceeds limit", code: 10) }
        fragments = result
    }
}
let mediaFixture: MediaFixture?
do { mediaFixture = mediaManifestPath.isEmpty ? nil : try MediaFixture(path: mediaManifestPath) }
catch { fputs("Media fixture rejected: \(error)\n", stderr); exit(1) }
let fixtureStarted = Date().timeIntervalSince1970
var random = [UInt8](repeating: 0, count: 32)
guard SecRandomCopyBytes(kSecRandomDefault, random.count, &random) == errSecSuccess else { fatalError("Randomness unavailable") }
let token = Data(random).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
let mapping = [("/", "index.html", "text/html; charset=utf-8"), ("/direct.js", "direct.js", "application/javascript; charset=utf-8"), ("/direct.css", "direct.css", "text/css; charset=utf-8")]
var assets: [String: LocalHTTPAsset] = [:]
for (path, name, type) in mapping { assets[path] = LocalHTTPAsset(data: try Data(contentsOf: URL(fileURLWithPath: assetDirectory).appendingPathComponent(name)), contentType: type) }
let server = LocalHTTPServer(configuration: .init(token: token, pairingCode: code, expiresAt: Date().timeIntervalSince1970 + 1800), assets: assets, bindToLoopback: true)
var fixtureReady = false
server.start(port: port, onReady: { port in
    DispatchQueue.main.async { fixtureReady = true }
    print("Synthetic macOS fixture: http://127.0.0.1:\(port) | pair code \(code) | no iPhone proof"); fflush(stdout)
}, onFailure: { error in fputs("Fixture failed: \(error)\n", stderr); exit(1) })
if let fixture = mediaFixture {
    // Original generated test media only; these bytes are not live iPhone capture.
    let first = fixture.manifest.fragments[0], last = fixture.manifest.fragments.last!
    let period = max(1, last.start + last.duration - first.start)
    var generation = UUID().uuidString, index = 0, loopStart = Date().timeIntervalSince1970
    let mediaTimer = DispatchSource.makeTimerSource(queue: .main)
    mediaTimer.schedule(deadline: .now(), repeating: 0.02)
    mediaTimer.setEventHandler {
        guard fixtureReady else { return }
        let now = Date().timeIntervalSince1970
        if pauseAfter > 0 && now - fixtureStarted >= pauseAfter {
            server.updateState(.init(captureState: "paused", source: "demo")); server.clearMedia(); return
        }
        if now - loopStart >= period {
            generation = UUID().uuidString; index = 0; loopStart = now; server.clearMedia()
        }
        server.updateState(.init(captureState: "live", source: "demo", message: "Original synthetic media fixture, not iPhone or vehicle evidence"))
        if index == 0 {
            server.updateMediaInitialization(.init(generation: generation, data: fixture.initialization, mime: fixture.manifest.mime, hasAudio: fixture.manifest.hasAudio))
        }
        while index < fixture.manifest.fragments.count && fixture.manifest.fragments[index].start - first.start <= now - loopStart {
            let fragment = fixture.manifest.fragments[index]
            server.updateMediaFragment(.init(generation: generation, sequence: fragment.sequence, data: fixture.fragments[index],
                start: fragment.start, duration: fragment.duration, independent: fragment.independent, updatedAt: now))
            index += 1
        }
    }
    print("Original fMP4 fixture: \(fixture.manifest.fragments.count) fragments, \(period)s loop; loopback only; muted until user gesture")
    mediaTimer.resume()
    withExtendedLifetime(mediaTimer) { RunLoop.main.run() }
    exit(0)
}
var sequence: UInt64 = 0
let timer = DispatchSource.makeTimerSource(queue: .main)
timer.schedule(deadline: .now(), repeating: 0.5)
timer.setEventHandler {
    if pauseAfter > 0 && Date().timeIntervalSince1970 - fixtureStarted >= pauseAfter {
        server.updateFrame(nil)
        server.updateState(.init(captureState: "paused", message: "合成测试已暂停 · 旧画面与文字应隐藏"))
        return
    }
    sequence += 1
    let size = NSSize(width: 960, height: 540)
    // Explicit pixel backing: NSImage.lockFocus() inherits the display's Retina
    // scale and silently turns a 960x540-point image into a 1920x1080 JPEG.
    guard let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 960, pixelsHigh: 540,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
        let context = NSGraphicsContext(bitmapImageRep: bitmap) else { fatalError("Fixture bitmap allocation failed") }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    NSColor(calibratedRed: 0.07, green: 0.10, blue: 0.09, alpha: 1).setFill(); NSRect(origin: .zero, size: size).fill()
    NSColor(calibratedRed: 0.23, green: 0.31, blue: 0.22, alpha: 1).setFill(); NSBezierPath(roundedRect: NSRect(x: 48, y: 42, width: 864, height: 456), xRadius: 24, yRadius: 24).fill()
    let white: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 42, weight: .medium), .foregroundColor: NSColor.white]
    let small: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 21), .foregroundColor: NSColor(calibratedRed: 0.83, green: 0.92, blue: 0.68, alpha: 1)]
    ("CABIN DIRECT" as NSString).draw(at: NSPoint(x: 90, y: 410), withAttributes: small)
    ("A quiet road, a little light." as NSString).draw(at: NSPoint(x: 90, y: 284), withAttributes: white)
    ("Original synthetic screen fixture" as NSString).draw(at: NSPoint(x: 90, y: 234), withAttributes: small)
    ("LOCAL ONLY  ·  FRAME \(sequence)" as NSString).draw(at: NSPoint(x: 90, y: 90), withAttributes: small)
    NSGraphicsContext.restoreGraphicsState()
    guard let jpeg = bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.75]) else { return }
    if sequence == 1 {
        guard let decoded = NSBitmapImageRep(data: jpeg), decoded.pixelsWide == 960, decoded.pixelsHigh == 540 else { fatalError("Fixture JPEG dimensions do not match metadata") }
        print("Verified decoded fixture JPEG: 960x540 pixels"); fflush(stdout)
    }
    let time = Date().timeIntervalSince1970
    server.updateState(.init(captureState: "live", sequence: sequence, frameUpdatedAt: time, width: 960, height: 540, lyricState: "ready", lyricLines: ["A quiet road,", "a little light."], lyricUpdatedAt: time, message: "合成测试画面 · macOS 原生服务 · 非 iPhone 实测"))
    server.updateFrame(.init(data: jpeg, sequence: sequence, updatedAt: time, width: 960, height: 540))
}
timer.resume()
RunLoop.main.run()
