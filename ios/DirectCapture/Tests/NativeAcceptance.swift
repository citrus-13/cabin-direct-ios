// Command Line Tools does not ship XCTest. This tiny compatibility runner executes
// the same synthetic-media test cases; full Xcode continues to use normal XCTest.
#if DIRECT_CAPTURE_STANDALONE && !canImport(XCTest)
import Foundation

private let failureLock = NSLock()
private var failures = 0
func XCTFail(_ message: String = "", file: StaticString = #filePath, line: UInt = #line) {
    failureLock.lock(); failures += 1; failureLock.unlock()
    print("FAIL \(file):\(line): \(message)")
}
func XCTAssertTrue(_ condition: @autoclosure () -> Bool, _ message: String = "", file: StaticString = #filePath, line: UInt = #line) {
    if !condition() { XCTFail(message, file: file, line: line) }
}
func XCTAssertFalse(_ condition: @autoclosure () -> Bool, _ message: String = "", file: StaticString = #filePath, line: UInt = #line) {
    XCTAssertTrue(!condition(), message, file: file, line: line)
}
func XCTAssertEqual<T: Equatable>(_ lhs: T, _ rhs: T, file: StaticString = #filePath, line: UInt = #line) {
    XCTAssertTrue(lhs == rhs, "\(lhs) != \(rhs)", file: file, line: line)
}
func XCTAssertLessThan<T: Comparable>(_ lhs: T, _ rhs: T, file: StaticString = #filePath, line: UInt = #line) {
    XCTAssertTrue(lhs < rhs, "\(lhs) not < \(rhs)", file: file, line: line)
}
func XCTAssertLessThanOrEqual<T: Comparable>(_ lhs: T, _ rhs: T, file: StaticString = #filePath, line: UInt = #line) {
    XCTAssertTrue(lhs <= rhs, "\(lhs) not <= \(rhs)", file: file, line: line)
}
func XCTAssertGreaterThan<T: Comparable>(_ lhs: T, _ rhs: T, file: StaticString = #filePath, line: UInt = #line) {
    XCTAssertTrue(lhs > rhs, "\(lhs) not > \(rhs)", file: file, line: line)
}
func XCTAssertNil<T>(_ value: T?, file: StaticString = #filePath, line: UInt = #line) {
    XCTAssertTrue(value == nil, "Expected nil", file: file, line: line)
}
struct NativeTestError: Error {}
struct XCTSkip: Error { let reason: String; init(_ reason: String) { self.reason = reason } }
func XCTUnwrap<T>(_ value: T?, file: StaticString = #filePath, line: UInt = #line) throws -> T {
    guard let value else { XCTFail("Unexpected nil", file: file, line: line); throw NativeTestError() }
    return value
}
final class NativeExpectation {
    let name: String
    let semaphore = DispatchSemaphore(value: 0)
    init(_ name: String) { self.name = name }
    func fulfill() { semaphore.signal() }
}
class XCTestCase {
    func expectation(description: String) -> NativeExpectation { NativeExpectation(description) }
    func wait(for expectations: [NativeExpectation], timeout: Double) {
        for expected in expectations {
            if expected.semaphore.wait(timeout: .now() + timeout) == .timedOut {
                XCTFail("Timed out: \(expected.name)")
            }
        }
    }
}

@main struct NativeAcceptance {
    static func main() {
        let tests = CapturePipelineTests()
        let cases: [(String, () throws -> Void)] = [
            ("JPEG real encode, hard limits and no upscale", tests.testRealJPEGHardLimitsAndNoUpscale),
            ("JPEG real orientation pixels and dimensions", tests.testOrientationRotatesDimensionsAndPixels),
            ("Burst dropping and stopped state", tests.testBurstDropsFramesAndStopPreventsLaterCallbacks),
            ("Pause clearing and resume", tests.testPauseClearsAndResumeAdmitsFreshFrame),
            ("Top-left ROI clipping", tests.testRegionClipsAndConvertsTopLeftWithoutAdmittingOutsidePixels),
            ("Text Unicode, embedded newline and length bounds", tests.testTextBoundsIncludeEmbeddedNewlinesAndUnicode),
            ("Stop suppresses already-admitted work", tests.testStopSuppressesAlreadyAdmittedWork),
            ("Real Vision selected-region recognition", tests.testRealVisionRecognizesOnlySelectedVisibleRegion)
        ]
        for (name, test) in cases {
            failureLock.lock(); let before = failures; failureLock.unlock()
            do { try test() }
            catch let skip as XCTSkip { print("SKIP \(name): \(skip.reason)"); continue }
            catch { XCTFail("\(name): \(error)") }
            failureLock.lock(); let after = failures; failureLock.unlock()
            print("\(after == before ? "PASS" : "FAIL") \(name)")
        }
        print("Native macOS acceptance: \(cases.count) cases, \(failures) failures. This is not an iOS build.")
        if failures > 0 { exit(1) }
    }
}
#endif
