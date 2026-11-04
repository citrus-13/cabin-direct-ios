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
let fixtureStarted = Date().timeIntervalSince1970
var random = [UInt8](repeating: 0, count: 32)
guard SecRandomCopyBytes(kSecRandomDefault, random.count, &random) == errSecSuccess else { fatalError("Randomness unavailable") }
let token = Data(random).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
let mapping = [("/", "index.html", "text/html; charset=utf-8"), ("/direct.js", "direct.js", "application/javascript; charset=utf-8"), ("/direct.css", "direct.css", "text/css; charset=utf-8")]
var assets: [String: LocalHTTPAsset] = [:]
for (path, name, type) in mapping { assets[path] = LocalHTTPAsset(data: try Data(contentsOf: URL(fileURLWithPath: assetDirectory).appendingPathComponent(name)), contentType: type) }
let server = LocalHTTPServer(configuration: .init(token: token, pairingCode: code, expiresAt: Date().timeIntervalSince1970 + 1800), assets: assets, bindToLoopback: true)
server.start(port: port, onReady: { port in print("Synthetic macOS fixture: http://127.0.0.1:\(port) | pair code \(code) | no iPhone proof"); fflush(stdout) }, onFailure: { error in fputs("Fixture failed: \(error)\n", stderr); exit(1) })
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
