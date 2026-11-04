import Foundation

// Dependency-free assertions: this is explicitly NOT XCTest or an iOS device test.
private var failures = 0
private var cases = 0
struct CheckFailure: Error {}
func failCheck(_ message: String = "check failed", file: StaticString = #fileID, line: UInt = #line) {
    failures += 1
    print("  FAILURE \(file):\(line): \(message)")
}
func expectEqual<T: Equatable>(_ actual: @autoclosure () throws -> T, _ expected: @autoclosure () throws -> T,
                               file: StaticString = #fileID, line: UInt = #line) {
    do { if try actual() != expected() { failCheck("values unequal", file: file, line: line) } }
    catch { failCheck("unexpected error", file: file, line: line) }
}
func expectTrue(_ actual: @autoclosure () throws -> Bool, file: StaticString = #fileID, line: UInt = #line) {
    expectEqual(try actual(), true, file: file, line: line)
}
func expectNil<T>(_ actual: @autoclosure () throws -> T?, file: StaticString = #fileID, line: UInt = #line) {
    do { if try actual() != nil { failCheck("value was not nil", file: file, line: line) } }
    catch { failCheck("unexpected error", file: file, line: line) }
}
func expectThrowsError<T>(_ expression: @autoclosure () throws -> T, _ message: String = "expected rejection",
                          file: StaticString = #fileID, line: UInt = #line, _ handler: ((Error) -> Void)? = nil) {
    do { _ = try expression(); failCheck(message, file: file, line: line) }
    catch { handler?(error) }
}
func expectNoThrow<T>(_ expression: @autoclosure () throws -> T, file: StaticString = #fileID, line: UInt = #line) {
    do { _ = try expression() } catch { failCheck("unexpected rejection", file: file, line: line) }
}
func unwrap<T>(_ value: T?, file: StaticString = #fileID, line: UInt = #line) throws -> T {
    guard let value else { failCheck("required fixture absent", file: file, line: line); throw CheckFailure() }
    return value
}
func run(_ name: String, _ check: () throws -> Void) {
    cases += 1
    let previous = failures
    do { try check() } catch { failCheck("uncaught test error in \(name)") }
    print("\(failures == previous ? "PASS" : "FAIL") \(name)")
}

print("TeslaBLE offline native checks; public/synthetic fixtures only; no Bluetooth or Keychain calls")
let crypto = ProtocolTests()
run("official ECDH and session subkey vectors", crypto.testOfficialECDHAndSessionSubkeyVectors)
run("official session HMAC vector", crypto.testOfficialSessionHMACAndConstantTimeValidation)
run("official AES-GCM metadata, ciphertext and tag", crypto.testOfficialAESGCMMetadataCiphertextAndTagVector)
run("official advertisement-name vector", crypto.testOfficialAdvertisementVector)
run("official leading-zero ECDH fixture", crypto.testOfficialLeadingZeroSharedCoordinateFixture)
run("response metadata literal encoding", crypto.testResponseMetadataAgainstLiteralProtocolEncoding)
run("reject invalid P256 points", crypto.testInvalidP256PointsRejected)
run("handshake gate and single request", crypto.testHandshakeAuthenticatesBeforeMediaRequest)
run("encrypted media allowlist and flags=2", crypto.testMediaRequestIsEncryptedAllowlistedAndFlagsTwo)
run("authenticated response and replay rejection", crypto.testAuthenticatedEncryptedMediaResponseAndReplayRejected)
run("request-hash association", crypto.testWrongRequestHashCannotDecrypt)
run("ciphertext and metadata tamper rejection", crypto.testTamperedCiphertextFlagsFaultNonceAndCounterRejected)
run("reject plaintext fallback", crypto.testPlaintextFallbackRejected)
run("response nonce and counter tamper rejection", crypto.testResponseNonceLengthAndCounterTamperRejected)
run("authenticated fault is not success", crypto.testAuthenticatedFaultIsNotMediaSuccess)
run("routing, UUID and domain association", crypto.testHandshakeWrongRoutingUUIDAndDomainRejected)
run("handshake and command deadlines", crypto.testExpiredHandshakeAndCommandResponsesRejected)
run("session clock and counter rollback rejection", crypto.testSessionResyncCannotRollbackClockOrCounter)
run("counter exhaustion", crypto.testCounterExhaustionFailsClosed)
run("authenticated epoch rollover", crypto.testAuthenticatedNewEpochMayResetCounter)
run("unauthenticated session change rejection", crypto.testUnauthenticatedSessionChangeRejected)
run("absent versus zero fields", crypto.testMissingVersusZeroPlaybackAndTiming)
run("explicit time units and invalid fields", crypto.testTimeUnitsExplicitAndInvalidTimingRejected)
run("absent media and rejected action", crypto.testAbsentMediaAndApplicationFailureAreNotSuccess)
run("monitor enrollment role=5 form=6", crypto.testMonitorEnrollmentOnlyRoleFiveIOSFormSix)
let wire = WireTests()
run("uint32 bounds and duplicate fields", wire.testUint32BoundsAndDuplicateFields)
run("int32 sign extension", wire.testInt32SignExtensionWithoutTruncation)
run("malformed protobuf input", wire.testMalformedVarintsLengthsAndWireTypes)
run("UTF-8 and resource caps", wire.testUTF8AndResourceBounds)
run("all length-delimited truncations", wire.testAllTruncationsOfLengthDelimitedPayloadFail)
run("ambiguous oneof rejection", wire.testOneofAmbiguityRejected)
run("BLE chunking and bytewise reassembly", wire.testBLEChunksAndBytewiseReassembly)
run("BLE coalesced and partial frames", wire.testBLECoalescedAndPartialFrames)
run("BLE size and MTU bounds", wire.testBLEOversizeZeroAndInvalidMTURejected)
run("fixed32 little-endian wire format", wire.testFixed32Endianness)
run("TLV metadata ordering and lengths", wire.testMetadataTagsOrderAndLengthBounds)
print("RESULT: \(cases) cases, \(failures) failures. macOS native only; iOS build/device unverified.")
exit(failures == 0 ? 0 : 1)
