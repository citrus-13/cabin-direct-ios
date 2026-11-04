import Foundation
import CoreMedia
import CoreImage
import ImageIO
import Vision

/// A rectangle in normalized top-left coordinates of the displayed, oriented image.
public struct NormalizedLyricRegion {
    public let x: Double
    public let y: Double
    public let width: Double
    public let height: Double

    public init(x: Double, y: Double, width: Double, height: Double) {
        self.x = x; self.y = y; self.width = width; self.height = height
    }

    func pixelRect(in extent: CGRect) -> CGRect? {
        guard [x, y, width, height].allSatisfy({ $0.isFinite }), width > 0, height > 0 else { return nil }
        let left = max(0, min(1, x)), top = max(0, min(1, y))
        let right = max(0, min(1, x + width)), bottom = max(0, min(1, y + height))
        guard right > left, bottom > top else { return nil }
        // Core Image is bottom-left based. Only pixels within the selected ROI are admitted.
        let rect = CGRect(x: extent.minX + left * extent.width,
                          y: extent.minY + (1 - bottom) * extent.height,
                          width: (right - left) * extent.width,
                          height: (bottom - top) * extent.height)
        let minX = ceil(rect.minX), minY = ceil(rect.minY)
        let maxX = floor(rect.maxX), maxY = floor(rect.maxY)
        guard maxX > minX, maxY > minY else { return nil }
        return CGRect(x: minX, y: minY, width: maxX - minX, height: maxY - minY)
    }
}

public struct CapturedJPEG {
    public let data: Data
    public let sequence: UInt64
    public let updatedAt: Double
    public let width: Int
    public let height: Int
    public init(data: Data, sequence: UInt64, updatedAt: Double, width: Int, height: Int) {
        self.data = data; self.sequence = sequence; self.updatedAt = updatedAt
        self.width = width; self.height = height
    }
}

/// Visible text, not playback metadata or a claim about the currently highlighted lyric.
public struct VisibleTextSnapshot {
    public let lines: [String]
    public let updatedAt: Double
    public let status: String
    public init(lines: [String], updatedAt: Double, status: String) {
        self.lines = lines; self.updatedAt = updatedAt; self.status = status
    }
}

/// In-memory video-only processing. At most one sample buffer and one reduced OCR image
/// are in flight. Audio, disk persistence and network access are deliberately absent.
public final class CapturePipeline {
    private let lock = NSRecursiveLock()
    private let frameQueue = DispatchQueue(label: "CabinDirect.encode", qos: .userInitiated)
    private let textQueue = DispatchQueue(label: "CabinDirect.visibleText", qos: .utility)
    private let context = CIContext(options: [.cacheIntermediates: false])
    private let colorSpace = CGColorSpaceCreateDeviceRGB()
    private let maxLongEdge: Int
    private let maxShortEdge: Int
    private let interval: Double
    private let ocrEnabled: Bool
    private let region: NormalizedLyricRegion
    private let onFrame: (CapturedJPEG) -> Void
    private let onText: (VisibleTextSnapshot) -> Void
    private var paused = false
    private var stopped = false
    private var frameBusy = false
    private var ocrBusy = false
    private var generation: UInt64 = 0
    private var sequence: UInt64 = 0
    private var lastFrame = -Double.infinity
    private var lastOCR = -Double.infinity

    public init(maxLongEdge: Int, maxShortEdge: Int, maxFPS: Int,
                ocrEnabled: Bool, region: NormalizedLyricRegion,
                onFrame: @escaping (CapturedJPEG) -> Void,
                onText: @escaping (VisibleTextSnapshot) -> Void) {
        self.maxLongEdge = min(960, max(1, maxLongEdge))
        self.maxShortEdge = min(540, max(1, maxShortEdge))
        self.interval = 1 / Double(min(8, max(1, maxFPS)))
        self.ocrEnabled = ocrEnabled; self.region = region
        self.onFrame = onFrame; self.onText = onText
    }

    public func append(_ sampleBuffer: CMSampleBuffer, orientation: CGImagePropertyOrientation) {
        lock.lock()
        let now = ProcessInfo.processInfo.systemUptime
        guard !stopped, !paused, !frameBusy, now - lastFrame >= interval,
              CMSampleBufferIsValid(sampleBuffer), CMSampleBufferGetImageBuffer(sampleBuffer) != nil else {
            lock.unlock(); return
        }
        lastFrame = now; frameBusy = true
        let epoch = generation, observedAt = Date().timeIntervalSince1970
        lock.unlock()
        frameQueue.async { [self] in
            autoreleasepool { process(sampleBuffer, orientation: orientation, epoch: epoch, observedAt: observedAt) }
        }
    }

    public func setPaused(_ value: Bool) {
        lock.lock(); defer { lock.unlock() }
        guard !stopped, paused != value else { return }
        paused = value; generation &+= 1
        if value { onText(.init(lines: [], updatedAt: 0, status: "paused")) }
        else { lastFrame = -Double.infinity; lastOCR = -Double.infinity }
    }

    public func stop() {
        lock.lock(); defer { lock.unlock() }
        guard !stopped else { return }
        stopped = true; generation &+= 1
        onText(.init(lines: [], updatedAt: 0, status: "stopped"))
    }

    private func isCurrent(_ epoch: UInt64) -> Bool { !stopped && !paused && generation == epoch }

    static func fittedSize(width: Int, height: Int, longEdge: Int, shortEdge: Int) -> (Int, Int) {
        guard width > 0, height > 0 else { return (0, 0) }
        let scale = min(1, Double(longEdge) / Double(max(width, height)),
                        Double(shortEdge) / Double(min(width, height)))
        return (max(1, Int(floor(Double(width) * scale))), max(1, Int(floor(Double(height) * scale))))
    }

    static func boundedLines(_ candidates: [String]) -> [String] {
        Array(candidates.lazy.flatMap { $0.split(whereSeparator: { $0.isNewline }) }
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }.prefix(8).map { String($0.prefix(120)) })
    }

    private func process(_ sample: CMSampleBuffer, orientation: CGImagePropertyOrientation,
                         epoch: UInt64, observedAt: Double) {
        defer { lock.lock(); frameBusy = false; lock.unlock() }
        lock.lock(); let current = isCurrent(epoch); lock.unlock()
        guard current, let buffer = CMSampleBufferGetImageBuffer(sample) else { return }
        let oriented = CIImage(cvPixelBuffer: buffer).oriented(orientation)
        let image = oriented.transformed(by: CGAffineTransform(translationX: -oriented.extent.minX, y: -oriented.extent.minY))
        let (width, height) = Self.fittedSize(width: Int(image.extent.width), height: Int(image.extent.height),
                                            longEdge: maxLongEdge, shortEdge: maxShortEdge)
        guard width > 0, height > 0 else { clearText(epoch: epoch); return }
        let scaled = image.transformed(by: CGAffineTransform(scaleX: Double(width) / image.extent.width,
                                                             y: Double(height) / image.extent.height))
        guard let data = context.jpegRepresentation(of: scaled, colorSpace: colorSpace,
                    options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.55]),
              data.count <= 512 * 1024 else { clearText(epoch: epoch); return }
        lock.lock()
        guard isCurrent(epoch) else { lock.unlock(); return }
        sequence &+= 1
        onFrame(.init(data: data, sequence: sequence, updatedAt: observedAt, width: width, height: height))
        let now = ProcessInfo.processInfo.systemUptime
        let runOCR = isCurrent(epoch) && ocrEnabled && !ocrBusy && now - lastOCR >= 1
        if runOCR { ocrBusy = true; lastOCR = now }
        lock.unlock()
        guard runOCR else { return }
        guard let rect = region.pixelRect(in: image.extent) else {
            lock.lock(); ocrBusy = false; lock.unlock(); clearText(epoch: epoch); return
        }
        let crop = image.cropped(to: rect).transformed(by: CGAffineTransform(translationX: -rect.minX, y: -rect.minY))
        let scale = min(1, 640 / max(rect.width, rect.height))
        let reduced = crop.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        guard let cgImage = context.createCGImage(reduced, from: reduced.extent) else {
            lock.lock(); ocrBusy = false; lock.unlock(); clearText(epoch: epoch); return
        }
        textQueue.async { [self] in
            autoreleasepool {
                defer { lock.lock(); ocrBusy = false; lock.unlock() }
                lock.lock(); let current = isCurrent(epoch); lock.unlock()
                guard current else { return }
                let request = VNRecognizeTextRequest()
                request.recognitionLevel = .accurate
                request.usesLanguageCorrection = false
                do {
                    try VNImageRequestHandler(cgImage: cgImage, options: [:]).perform([request])
                    let candidates = (request.results ?? []).compactMap { result -> String? in
                        guard let candidate = result.topCandidates(1).first, candidate.confidence >= 0.5 else { return nil }
                        return candidate.string
                    }
                    let lines = Self.boundedLines(candidates)
                    lock.lock(); defer { lock.unlock() }
                    if isCurrent(epoch) {
                        onText(.init(lines: lines, updatedAt: observedAt, status: lines.isEmpty ? "empty" : "visible"))
                    }
                } catch { clearText(epoch: epoch) }
            }
        }
    }

    private func clearText(epoch: UInt64) {
        lock.lock(); defer { lock.unlock() }
        if isCurrent(epoch) && ocrEnabled { onText(.init(lines: [], updatedAt: 0, status: "stale")) }
    }
}
