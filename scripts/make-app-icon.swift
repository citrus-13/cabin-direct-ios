import AppKit

// Original geometric artwork. No font, third-party asset, screenshot or trademark.
// Regenerate with: swift scripts/make-app-icon.swift /absolute/AppIcon.png
guard CommandLine.arguments.count == 2 else { fatalError("Pass one explicit PNG output path") }
let output = URL(fileURLWithPath: CommandLine.arguments[1])
guard output.pathExtension == "png", let space = CGColorSpace(name: CGColorSpace.sRGB),
      let bitmap = CGContext(data: nil, width: 1024, height: 1024, bitsPerComponent: 8,
        bytesPerRow: 0, space: space, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { fatalError("Cannot allocate icon bitmap") }
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(cgContext: bitmap, flipped: false)
NSColor(calibratedRed: 0.035, green: 0.075, blue: 0.11, alpha: 1).setFill()
NSRect(x: 0, y: 0, width: 1024, height: 1024).fill()
let screen = NSBezierPath(roundedRect: NSRect(x: 172, y: 300, width: 680, height: 454), xRadius: 64, yRadius: 64)
screen.lineWidth = 40
NSColor(calibratedRed: 0.25, green: 0.92, blue: 0.81, alpha: 1).setStroke()
screen.stroke()
let stand = NSBezierPath()
stand.move(to: NSPoint(x: 512, y: 280)); stand.line(to: NSPoint(x: 512, y: 224))
stand.move(to: NSPoint(x: 418, y: 214)); stand.line(to: NSPoint(x: 606, y: 214))
stand.lineWidth = 36; stand.lineCapStyle = .round; stand.stroke()
NSColor(calibratedRed: 0.84, green: 0.93, blue: 0.67, alpha: 1).setFill()
NSBezierPath(roundedRect: NSRect(x: 262, y: 406, width: 126, height: 242), xRadius: 26, yRadius: 26).fill()
NSColor(calibratedRed: 0.84, green: 0.93, blue: 0.67, alpha: 1).setStroke()
for radius in [70.0, 132.0] {
    let arc = NSBezierPath()
    arc.appendArc(withCenter: NSPoint(x: 470, y: 527), radius: radius, startAngle: -48, endAngle: 48)
    arc.lineWidth = 26; arc.lineCapStyle = .round; arc.stroke()
}
NSGraphicsContext.restoreGraphicsState()
guard let image = bitmap.makeImage(), let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else { fatalError("Cannot encode PNG") }
try png.write(to: output, options: .atomic)
print("Wrote original opaque 1024x1024 application icon")
