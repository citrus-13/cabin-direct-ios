import Foundation
#if canImport(XCTest)
import XCTest
#endif
import CoreGraphics
import CoreText
import CoreVideo
import CoreMedia
import ImageIO
import Vision
#if !DIRECT_CAPTURE_STANDALONE
@testable import DirectCapture
#endif

final class CapturePipelineTests: XCTestCase {
    private let fullROI = NormalizedLyricRegion(x: 0, y: 0, width: 1, height: 1)

    private func sample(width: Int, height: Int, draw: ((CGContext) -> Void)? = nil) throws -> CMSampleBuffer {
        var pixel: CVPixelBuffer?
        XCTAssertEqual(CVPixelBufferCreate(kCFAllocatorDefault, width, height, kCVPixelFormatType_32BGRA,
            [kCVPixelBufferCGImageCompatibilityKey: true, kCVPixelBufferCGBitmapContextCompatibilityKey: true] as CFDictionary,
            &pixel), kCVReturnSuccess)
        let buffer = try XCTUnwrap(pixel)
        CVPixelBufferLockBaseAddress(buffer, [])
        let context = try XCTUnwrap(CGContext(data: CVPixelBufferGetBaseAddress(buffer), width: width, height: height,
            bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(buffer), space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue))
        context.setFillColor(CGColor(gray: 1, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        draw?(context)
        CVPixelBufferUnlockBaseAddress(buffer, [])
        var format: CMVideoFormatDescription?
        XCTAssertEqual(CMVideoFormatDescriptionCreateForImageBuffer(allocator: kCFAllocatorDefault, imageBuffer: buffer,
                                                                   formatDescriptionOut: &format), noErr)
        var timing = CMSampleTimingInfo(duration: .invalid, presentationTimeStamp: .zero, decodeTimeStamp: .invalid)
        var result: CMSampleBuffer?
        XCTAssertEqual(CMSampleBufferCreateReadyWithImageBuffer(allocator: kCFAllocatorDefault, imageBuffer: buffer,
            formatDescription: try XCTUnwrap(format), sampleTiming: &timing, sampleBufferOut: &result), noErr)
        return try XCTUnwrap(result)
    }

    private func image(_ frame: CapturedJPEG) throws -> CGImage {
        let source = try XCTUnwrap(CGImageSourceCreateWithData(frame.data as CFData, nil))
        XCTAssertEqual(CGImageSourceGetType(source) as String?, "public.jpeg")
        return try XCTUnwrap(CGImageSourceCreateImageAtIndex(source, 0, nil))
    }

    func testRealJPEGHardLimitsAndNoUpscale() throws {
        for (w, h, expectedW, expectedH) in [(1920, 1080, 960, 540), (1080, 1920, 540, 960), (100, 60, 100, 60)] {
            let encoded = expectation(description: "encoded \(w)x\(h)")
            let pipeline = CapturePipeline(maxLongEdge: 4096, maxShortEdge: 4096, maxFPS: 120,
                ocrEnabled: false, region: fullROI, onFrame: { frame in
                    do {
                        let cg = try self.image(frame)
                        XCTAssertEqual(cg.width, expectedW); XCTAssertEqual(cg.height, expectedH)
                        XCTAssertEqual(frame.width, expectedW); XCTAssertEqual(frame.height, expectedH)
                        XCTAssertLessThanOrEqual(frame.data.count, 512 * 1024)
                        XCTAssertEqual(frame.sequence, 1)
                        XCTAssertLessThan(abs(Date().timeIntervalSince1970 - frame.updatedAt), 5)
                    } catch { XCTFail("\(error)") }
                    encoded.fulfill()
                }, onText: { _ in XCTFail("OCR disabled") })
            pipeline.append(try sample(width: w, height: h), orientation: .up)
            wait(for: [encoded], timeout: 10)
        }
    }

    func testOrientationRotatesDimensionsAndPixels() throws {
        let encoded = expectation(description: "rotated")
        let pipeline = CapturePipeline(maxLongEdge: 960, maxShortEdge: 540, maxFPS: 8,
            ocrEnabled: false, region: fullROI, onFrame: { frame in
                do {
                    let cg = try self.image(frame)
                    XCTAssertEqual(cg.width, 200); XCTAssertEqual(cg.height, 400)
                    // Original upper half is red, lower half blue. Clockwise rotation
                    // places red in the right half and blue in the left half.
                    let bytes = UnsafeMutablePointer<UInt8>.allocate(capacity: 200 * 400 * 4)
                    defer { bytes.deallocate() }
                    let context = try XCTUnwrap(CGContext(data: bytes, width: 200, height: 400,
                        bitsPerComponent: 8, bytesPerRow: 800, space: CGColorSpaceCreateDeviceRGB(),
                        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
                    context.draw(cg, in: CGRect(x: 0, y: 0, width: 200, height: 400))
                    let left = (200 * 200 + 30) * 4, right = (200 * 200 + 170) * 4
                    XCTAssertGreaterThan(bytes[left + 2], 220); XCTAssertLessThan(bytes[left], 30)
                    XCTAssertGreaterThan(bytes[right], 220); XCTAssertLessThan(bytes[right + 2], 30)
                } catch { XCTFail("\(error)") }
                encoded.fulfill()
            }, onText: { _ in })
        let input = try sample(width: 400, height: 200) { context in
            context.setFillColor(CGColor(red: 1, green: 0, blue: 0, alpha: 1))
            context.fill(CGRect(x: 0, y: 100, width: 400, height: 100))
            context.setFillColor(CGColor(red: 0, green: 0, blue: 1, alpha: 1))
            context.fill(CGRect(x: 0, y: 0, width: 400, height: 100))
        }
        pipeline.append(input, orientation: .right)
        wait(for: [encoded], timeout: 10)
    }

    func testBurstDropsFramesAndStopPreventsLaterCallbacks() throws {
        let first = expectation(description: "one frame")
        let stopped = expectation(description: "stopped clears text")
        var count = 0
        let counterLock = NSLock()
        let pipeline = CapturePipeline(maxLongEdge: 960, maxShortEdge: 540, maxFPS: 100,
            ocrEnabled: false, region: fullROI, onFrame: { _ in
                counterLock.lock(); count += 1; let n = count; counterLock.unlock()
                if n == 1 { first.fulfill() } else { XCTFail("Burst admitted extra frame") }
            }, onText: { snapshot in
                XCTAssertEqual(snapshot.status, "stopped"); XCTAssertTrue(snapshot.lines.isEmpty)
                XCTAssertEqual(snapshot.updatedAt, 0); stopped.fulfill()
            })
        let input = try sample(width: 640, height: 360)
        for _ in 0..<100 { pipeline.append(input, orientation: .up) }
        wait(for: [first], timeout: 10)
        pipeline.stop(); pipeline.stop(); pipeline.setPaused(false)
        for _ in 0..<100 { pipeline.append(input, orientation: .up) }
        wait(for: [stopped], timeout: 1)
        Thread.sleep(forTimeInterval: 0.2)
        counterLock.lock(); XCTAssertEqual(count, 1); counterLock.unlock()
    }

    func testPauseClearsAndResumeAdmitsFreshFrame() throws {
        let paused = expectation(description: "paused")
        let resumed = expectation(description: "resumed frame")
        let pipeline = CapturePipeline(maxLongEdge: 960, maxShortEdge: 540, maxFPS: 8,
            ocrEnabled: false, region: fullROI, onFrame: { _ in resumed.fulfill() }, onText: { snapshot in
                XCTAssertEqual(snapshot.status, "paused"); XCTAssertTrue(snapshot.lines.isEmpty)
                XCTAssertEqual(snapshot.updatedAt, 0); paused.fulfill()
            })
        let input = try sample(width: 200, height: 100)
        pipeline.setPaused(true)
        pipeline.append(input, orientation: .up)
        wait(for: [paused], timeout: 1)
        pipeline.setPaused(false)
        pipeline.append(input, orientation: .up)
        wait(for: [resumed], timeout: 10)
    }

    func testRegionClipsAndConvertsTopLeftWithoutAdmittingOutsidePixels() {
        let extent = CGRect(x: 0, y: 0, width: 1000, height: 500)
        XCTAssertEqual(NormalizedLyricRegion(x: 0.1, y: 0.1, width: 0.5, height: 0.2).pixelRect(in: extent),
                       CGRect(x: 100, y: 350, width: 500, height: 100))
        XCTAssertEqual(NormalizedLyricRegion(x: -0.2, y: 0.8, width: 0.5, height: 0.5).pixelRect(in: extent),
                       CGRect(x: 0, y: 0, width: 300, height: 99))
        XCTAssertNil(NormalizedLyricRegion(x: .nan, y: 0, width: 1, height: 1).pixelRect(in: extent))
        XCTAssertNil(NormalizedLyricRegion(x: 2, y: 0, width: 1, height: 1).pixelRect(in: extent))
    }

    func testTextBoundsIncludeEmbeddedNewlinesAndUnicode() {
        let lines = CapturePipeline.boundedLines(["  \n ", "First\nSecond", String(repeating: "星", count: 200)] +
            (1...20).map { "Line \($0)" })
        XCTAssertEqual(lines.count, 8)
        XCTAssertEqual(lines[0], "First"); XCTAssertEqual(lines[1], "Second")
        XCTAssertEqual(lines[2].count, 120)
        XCTAssertFalse(lines.contains { $0.contains("\n") })
    }

    func testStopSuppressesAlreadyAdmittedWork() throws {
        let countsLock = NSLock()
        var frames = 0, texts = 0
        let pipeline = CapturePipeline(maxLongEdge: 960, maxShortEdge: 540, maxFPS: 8,
            ocrEnabled: true, region: fullROI, onFrame: { _ in
                countsLock.lock(); frames += 1; countsLock.unlock()
            }, onText: { _ in countsLock.lock(); texts += 1; countsLock.unlock() })
        pipeline.append(try sample(width: 1920, height: 1080), orientation: .up)
        pipeline.stop()
        countsLock.lock(); let frameCountAfterStop = frames, textCountAfterStop = texts; countsLock.unlock()
        Thread.sleep(forTimeInterval: 0.3)
        countsLock.lock(); defer { countsLock.unlock() }
        XCTAssertEqual(frames, frameCountAfterStop)
        XCTAssertEqual(texts, textCountAfterStop)
        XCTAssertGreaterThan(texts, 0)
    }

    func testRealVisionRecognizesOnlySelectedVisibleRegion() throws {
        guard #available(macOS 13, iOS 16, *) else { throw XCTSkip("Vision text recognition requires macOS 13 / iOS 16") }
        let recognized = expectation(description: "real Vision OCR")
        let pipeline = CapturePipeline(maxLongEdge: 960, maxShortEdge: 540, maxFPS: 8,
            ocrEnabled: true, region: .init(x: 0, y: 0, width: 1, height: 0.5), onFrame: { _ in }, onText: { snapshot in
                XCTAssertEqual(snapshot.status, "visible")
                XCTAssertGreaterThan(snapshot.updatedAt, 0)
                XCTAssertLessThanOrEqual(snapshot.lines.count, 8)
                XCTAssertTrue(snapshot.lines.allSatisfy { $0.count <= 120 })
                let text = snapshot.lines.joined(separator: " ").uppercased()
                XCTAssertTrue(text.contains("VISIBLE SUNSHINE"), "Actual OCR: \(text)")
                XCTAssertFalse(text.contains("SECRET"), "Outside-ROI text must never be admitted")
                recognized.fulfill()
            })
        let input = try sample(width: 640, height: 400) { context in
            let attrs = [kCTFontAttributeName: CTFontCreateWithName("Helvetica-Bold" as CFString, 38, nil),
                         kCTForegroundColorAttributeName: CGColor(gray: 0, alpha: 1)] as [CFString: Any]
            for (text, y) in [("VISIBLE SUNSHINE", 290.0), ("SECRET OUTSIDE", 80.0)] {
                let line = CTLineCreateWithAttributedString(NSAttributedString(string: text,
                    attributes: Dictionary(uniqueKeysWithValues: attrs.map { (NSAttributedString.Key($0.key as String), $0.value) })))
                context.textPosition = CGPoint(x: 30, y: y)
                CTLineDraw(line, context)
            }
        }
        pipeline.append(input, orientation: .up)
        wait(for: [recognized], timeout: 30)
    }
}
