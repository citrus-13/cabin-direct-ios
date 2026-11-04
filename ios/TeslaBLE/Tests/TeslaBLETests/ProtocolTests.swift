import Foundation
import CryptoKit
@testable import TeslaBLE

// PUBLIC, deliberately compromised test keys from Tesla protocol.md. Never enroll them.
// Swift adaptation and additional negative tests. See PROVENANCE.md and LICENSE-TESLA.
final class ProtocolTests {
    let vin = "5YJ30123456789ABC"
    let client = hex("2538cdc29a97c19c1e99a637d6cf4f8c970c118b56ede1e6323e6d162c4b30db")
    let remote = hex("04c7a1f47138486aa4729971494878d33b1a24e39571f748a6e16c5955b3d877d3a6aaa0e955166474af5d32c410f439a2234137ad1bb085fd4e8813c958f11d97")
    let epoch = hex("4c463f9cc0d3d26906e982ed224adde6")
    let route = hex("2c907bd76c640d360b3027dc7404efde")
    let challenge = hex("1588d5a30eabc6f8fc9a951b11f6fd11")
    let keyBytes = hex("1b2fce19967b79db696f909cff89ea9a")
    let infoBytes = hex("0806124104c7a1f47138486aa4729971494878d33b1a24e39571f748a6e16c5955b3d877d3a6aaa0e955166474af5d32c410f439a2234137ad1bb085fd4e8813c958f11d971a104c463f9cc0d3d26906e982ed224adde6255a0a0000")
    var key: SymmetricKey { SymmetricKey(data: keyBytes) }

    func makeSession(now: @escaping () -> Double = { 100 }) throws -> TeslaSession {
        var sequence: UInt8 = 0
        return try TeslaSession(vin: vin, privateKey: P256.KeyAgreement.PrivateKey(rawRepresentation: client),
                                routingAddress: route, now: now, random: { count in
            sequence &+= 1
            return Data(repeating: sequence, count: count) // Deterministic only in these offline tests.
        })
    }
    func handshakeResponse(uuid: Data, info: Data? = nil, route: Data? = nil) throws -> Data {
        let payload = info ?? infoBytes
        let metadata = try TeslaCrypto.sessionAuthenticationData(vin: vin, challenge: uuid, info: payload)
        let tag = Data(HMAC<SHA256>.authenticationCode(for: metadata, using: TeslaCrypto.sessionSubkey(key)))
        return Proto.bytes(6, Proto.bytes(2, route ?? self.route)) + Proto.bytes(7, Proto.uint32(1, 3))
            + Proto.bytes(15, payload) + Proto.bytes(13, Proto.bytes(6, Proto.bytes(1, tag))) + Proto.bytes(50, uuid)
    }
    func authenticate(_ session: TeslaSession, info: Data? = nil) throws {
        let request = try Proto(session.handshake())
        let response = try handshakeResponse(uuid: unwrap(request.bytes(51)), info: info)
        guard case .ready = try session.receive(response, timeUnit: .milliseconds, observedAt: 1000) else {
            failCheck("Expected authenticated session"); return
        }
    }
    func mediaPayload(duration: UInt32? = 200000, elapsed: UInt32? = 0, playback: UInt32? = 1) -> Data {
        var media = Proto.bytes(3, Data("Artist".utf8)) + Proto.bytes(4, Data("Title".utf8))
        if let playback { media += Proto.uint32(9, playback) }
        var detail = Data()
        if let duration { detail += Proto.uint32(2, duration) }
        if let elapsed { detail += Proto.uint32(3, elapsed) }
        return Proto.bytes(1, Data()) + Proto.bytes(2, Proto.bytes(20, media) + Proto.bytes(21, detail))
    }
    func encryptedReply(request: Data, payload: Data? = nil, counter: UInt32 = 0, flags: UInt32 = 0,
                        fault: UInt32 = 0, overrideRequestHash: Data? = nil) throws -> Data {
        let request = try Proto(request)
        let auth = try unwrap(request.message(13)?.message(5))
        let requestHash = try overrideRequestHash ?? Data([5]) + unwrap(auth.bytes(5))
        let aad = try TeslaCrypto.responseAAD(vin: vin, counter: counter, flags: flags, requestHash: requestHash, fault: fault)
        let nonce = hex("000102030405060708090a0b")
        let box = try AES.GCM.seal(payload ?? mediaPayload(), using: key, nonce: AES.GCM.Nonce(data: nonce), authenticating: aad)
        let signature = Proto.bytes(1, nonce) + Proto.uint32(2, counter) + Proto.bytes(3, box.tag)
        return Proto.bytes(6, Proto.bytes(2, route)) + Proto.bytes(7, Proto.uint32(1, 3))
            + Proto.bytes(10, box.ciphertext) + Proto.bytes(13, Proto.bytes(9, signature))
            + Proto.bytes(12, Proto.uint32(2, fault)) + Proto.bytes(50, try unwrap(request.bytes(51)))
            + Proto.uint32(52, flags)
    }

    func testOfficialECDHAndSessionSubkeyVectors() throws {
        let derived = try TeslaCrypto.sharedKey(privateKey: P256.KeyAgreement.PrivateKey(rawRepresentation: client), remotePublic: remote)
        expectEqual(derived.withUnsafeBytes { Data($0) }, keyBytes)
        let subkey = TeslaCrypto.sessionSubkey(derived).withUnsafeBytes { Data($0) }
        expectEqual(subkey, hex("fceb679ee7bca756fcd441bf238bf2f338629b41d9eb9c67be1b32c9672ce300"))
    }
    func testOfficialSessionHMACAndConstantTimeValidation() throws {
        let metadata = try TeslaCrypto.sessionAuthenticationData(vin: vin, challenge: challenge, info: infoBytes)
        let tag = Data(HMAC<SHA256>.authenticationCode(for: metadata, using: TeslaCrypto.sessionSubkey(key)))
        let expected = hex("996c1fe38331be138f8039c194b14db2198846ed7d8251e6749284d7b32ea002")
        expectEqual(tag, expected)
        try TeslaCrypto.verifySession(key: key, vin: vin, challenge: challenge, info: infoBytes, tag: expected)
        expectThrowsError(try TeslaCrypto.verifySession(key: key, vin: vin, challenge: Data(repeating: 0, count: 16), info: infoBytes, tag: expected))
        expectThrowsError(try TeslaCrypto.verifySession(key: key, vin: vin, challenge: challenge, info: infoBytes, tag: Data(expected.dropLast())))
    }
    func testOfficialAESGCMMetadataCiphertextAndTagVector() throws {
        let metadata = try TeslaCrypto.commandMetadata(vin: vin, epoch: epoch, counter: 7, expires: 2655, flags: 2)
        expectEqual(metadata, hex("000105010103021135594a333031323334353637383941424303104c463f9cc0d3d26906e982ed224adde6040400000a5f050400000007070400000002ff"))
        // Published HVAC vector tests only the internal crypto primitive; it cannot pass media allowlist.
        let plaintext = hex("120452020801")
        let box = try TeslaCrypto.seal(plaintext, key: key, metadata: metadata, nonce: hex("dbf79447fa156674dae1caed"))
        expectEqual(box.ciphertext, hex("38038e8c0f2e"))
        expectEqual(box.tag, hex("c228e0ff64991481db3a7bbc133696c5"))
        expectThrowsError(try TeslaSession.validateMediaQuery(plaintext))
    }
    func testOfficialAdvertisementVector() {
        expectEqual(TeslaSession.advertisementName(vin: "5YJS0000000000000"), "S1a87a5a75f3df858C")
    }
    func testOfficialLeadingZeroSharedCoordinateFixture() throws {
        // Port of upstream native_test.go TestSharedSecretPadding, with public synthetic scalar.
        let scalar = Data(repeating: 0, count: 30) + Data([1, 0x3f])
        let peer = hex("04c4ff45b968e87469af648ed34c34a934d74a1d76f272d153fc81114ddfecc178f688e62bec19c9b144e9415361fa4fecab5ded4336336b9751c9a78ffa270fae")
        let key = try P256.KeyAgreement.PrivateKey(rawRepresentation: scalar)
        let shared = try key.sharedSecretFromKeyAgreement(with: P256.KeyAgreement.PublicKey(x963Representation: peer))
        let bytes = shared.withUnsafeBytes { Data($0) }
        expectEqual(bytes.count, 32); expectEqual(bytes.first, 0)
        let derived = try TeslaCrypto.sharedKey(privateKey: key, remotePublic: peer)
        expectEqual(derived.withUnsafeBytes { Data($0) }, Data(Insecure.SHA1.hash(data: bytes).prefix(16)))
    }
    func testResponseMetadataAgainstLiteralProtocolEncoding() throws {
        let requestHash = hex("05c228e0ff64991481db3a7bbc133696c5")
        let expected = hex("000109010103021135594a3330313233343536373839414243050400000005070400000002081105c228e0ff64991481db3a7bbc133696c5090400000000ff")
        expectEqual(try TeslaCrypto.responseAAD(vin: vin, counter: 5, flags: 2, requestHash: requestHash, fault: 0),
                    Data(SHA256.hash(data: expected)))
        // Even zero flags are always serialized for responses, unlike zero request flags.
        let zeroFlags = hex("000109010103021135594a3330313233343536373839414243050400000005070400000000081105c228e0ff64991481db3a7bbc133696c5090400000000ff")
        expectEqual(try TeslaCrypto.responseAAD(vin: vin, counter: 5, flags: 0, requestHash: requestHash, fault: 0),
                    Data(SHA256.hash(data: zeroFlags)))
    }
    func testInvalidP256PointsRejected() throws {
        let privateKey = try P256.KeyAgreement.PrivateKey(rawRepresentation: client)
        for bytes in [Data(), Data(repeating: 0, count: 65), Data([4]) + Data(repeating: 255, count: 64)] {
            expectThrowsError(try TeslaCrypto.sharedKey(privateKey: privateKey, remotePublic: bytes))
        }
    }
    func testHandshakeAuthenticatesBeforeMediaRequest() throws {
        let session = try makeSession()
        expectThrowsError(try session.mediaRequest())
        try authenticate(session)
        expectNoThrow(try session.mediaRequest())
        expectThrowsError(try session.mediaRequest()) // Single in-flight request.
    }
    func testMediaRequestIsEncryptedAllowlistedAndFlagsTwo() throws {
        let session = try makeSession(); try authenticate(session)
        let request = try Proto(session.mediaRequest())
        expectEqual(try request.uint32(52), 2)
        expectEqual(try request.message(6)?.uint32(1), 3)
        let auth = try unwrap(request.message(13)?.message(5))
        expectEqual(try auth.bytes(1), epoch)
        expectEqual(try auth.uint32(3), 7)
        let metadata = try TeslaCrypto.commandMetadata(vin: vin, epoch: epoch, counter: 7, expires: 2655, flags: 2)
        let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: unwrap(auth.bytes(2))),
                                      ciphertext: unwrap(request.bytes(10)), tag: unwrap(auth.bytes(5)))
        let clear = try AES.GCM.open(box, using: key, authenticating: Data(SHA256.hash(data: metadata)))
        expectEqual(clear, hex("12070a057a00820100"))
        try TeslaSession.validateMediaQuery(clear)
        expectThrowsError(try TeslaSession.validateMediaQuery(Proto.bytes(2, Proto.bytes(15, Data()))))
        expectThrowsError(try TeslaSession.validateMediaQuery(clear + Proto.bytes(4, Data())))
    }
    func testAuthenticatedEncryptedMediaResponseAndReplayRejected() throws {
        let session = try makeSession(); try authenticate(session)
        let response = try encryptedReply(request: session.mediaRequest())
        guard case .media(let track) = try session.receive(response, timeUnit: .milliseconds, observedAt: 1000) else { return failCheck() }
        expectEqual(track.title, "Title"); expectEqual(track.artist, "Artist")
        expectEqual(track.position, 0); expectEqual(track.duration, 200); expectEqual(track.playing, true)
        expectThrowsError(try session.receive(response, timeUnit: .milliseconds, observedAt: 1000))
        _ = try session.mediaRequest()
        expectThrowsError(try session.receive(response, timeUnit: .milliseconds, observedAt: 1000))
    }
    func testWrongRequestHashCannotDecrypt() throws {
        let session = try makeSession(); try authenticate(session)
        let response = try encryptedReply(request: session.mediaRequest(), overrideRequestHash: Data(repeating: 0, count: 17))
        expectThrowsError(try session.receive(response, timeUnit: .seconds, observedAt: 1000))
    }
    func testTamperedCiphertextFlagsFaultNonceAndCounterRejected() throws {
        for changedField in [10, 52, 12, 13] {
            let session = try makeSession(); try authenticate(session)
            let response = try Proto(encryptedReply(request: session.mediaRequest()))
            var changed = Data()
            for field in response.fields {
                if field.number == changedField {
                    if field.wire == 0 { changed += Proto.uint32(field.number, UInt32(field.scalar) ^ 1) }
                    else { var bytes = field.bytes; bytes[bytes.count - 1] ^= 1; changed += Proto.bytes(field.number, bytes) }
                } else { changed += encode(field) }
            }
            expectThrowsError(try session.receive(changed, timeUnit: .seconds, observedAt: 1000))
        }
    }
    func testPlaintextFallbackRejected() throws {
        let session = try makeSession(); try authenticate(session)
        let request = try Proto(session.mediaRequest())
        let response = Proto.bytes(6, Proto.bytes(2, route)) + Proto.bytes(7, Proto.uint32(1, 3))
            + Proto.bytes(10, mediaPayload()) + Proto.bytes(50, try unwrap(request.bytes(51)))
        expectThrowsError(try session.receive(response, timeUnit: .seconds, observedAt: 1000))
    }
    func testResponseNonceLengthAndCounterTamperRejected() throws {
        for variant in 0..<4 {
            let session = try makeSession(); try authenticate(session)
            let response = try Proto(encryptedReply(request: session.mediaRequest()))
            let signature = try unwrap(response.message(13)?.message(9))
            let originalNonce = try unwrap(signature.bytes(1))
            let nonce: Data
            switch variant {
            case 0: nonce = Data(originalNonce.dropLast())
            case 1: nonce = originalNonce + Data([0])
            case 2: nonce = Data(repeating: 1, count: 12)
            default: nonce = originalNonce
            }
            let modified = Proto.bytes(1, nonce) + Proto.uint32(2, variant == 3 ? 1 : 0)
                + Proto.bytes(3, try unwrap(signature.bytes(3)))
            var encoded = Data()
            for field in response.fields {
                encoded += field.number == 13 ? Proto.bytes(13, Proto.bytes(9, modified)) : encode(field)
            }
            expectThrowsError(try session.receive(encoded, timeUnit: .seconds, observedAt: 1000))
        }
    }
    func testAuthenticatedFaultIsNotMediaSuccess() throws {
        let session = try makeSession(); try authenticate(session)
        let response = try encryptedReply(request: session.mediaRequest(), fault: 7)
        expectThrowsError(try session.receive(response, timeUnit: .seconds, observedAt: 1000)) {
            expectEqual($0 as? TeslaProtocolError, .vehicleFault(7))
        }
    }
    func testHandshakeWrongRoutingUUIDAndDomainRejected() throws {
        for field in [6, 7, 50] {
            let session = try makeSession()
            let request = try Proto(session.handshake())
            let response = try Proto(handshakeResponse(uuid: unwrap(request.bytes(51))))
            var changed = Data()
            for item in response.fields {
                if item.number == field {
                    var bytes = item.bytes; bytes[bytes.count - 1] ^= 1; changed += Proto.bytes(item.number, bytes)
                } else { changed += encode(item) }
            }
            expectThrowsError(try session.receive(changed, timeUnit: .seconds, observedAt: 1000))
        }
    }
    func testExpiredHandshakeAndCommandResponsesRejected() throws {
        var time = 100.0
        let session = try makeSession(now: { time })
        let request = try Proto(session.handshake())
        let response = try handshakeResponse(uuid: unwrap(request.bytes(51)))
        time = 106
        expectTrue(session.pendingExpired)
        expectThrowsError(try session.receive(response, timeUnit: .seconds, observedAt: 1000))
        let second = try makeSession(now: { time }); try authenticate(second)
        let media = try encryptedReply(request: second.mediaRequest())
        time = 112
        expectThrowsError(try second.receive(media, timeUnit: .seconds, observedAt: 1000))
    }
    func testSessionResyncCannotRollbackClockOrCounter() throws {
        let session = try makeSession(); try authenticate(session)
        let request = try Proto(session.mediaRequest())
        let rolledBack = Proto.uint32(1, 1) + Proto.bytes(2, remote) + Proto.bytes(3, epoch) + Proto.fixed32(4, 2649)
        expectThrowsError(try session.receive(handshakeResponse(uuid: unwrap(request.bytes(51)), info: rolledBack),
                                               timeUnit: .seconds, observedAt: 1000))
        let valid = Proto.uint32(1, 1) + Proto.bytes(2, remote) + Proto.bytes(3, epoch) + Proto.fixed32(4, 2650)
        _ = try session.receive(handshakeResponse(uuid: unwrap(request.bytes(51)), info: valid), timeUnit: .seconds, observedAt: 1000)
        let next = try Proto(session.mediaRequest())
        expectEqual(try next.message(13)?.message(5)?.uint32(3), 8)
    }
    func testCounterExhaustionFailsClosed() throws {
        let session = try makeSession()
        let info = Proto.uint32(1, UInt32.max) + Proto.bytes(2, remote) + Proto.bytes(3, epoch) + Proto.fixed32(4, 2650)
        try authenticate(session, info: info)
        expectThrowsError(try session.mediaRequest()) { expectEqual($0 as? TeslaProtocolError, .counterExhausted) }
    }
    func testAuthenticatedNewEpochMayResetCounter() throws {
        let session = try makeSession(); try authenticate(session)
        let request = try Proto(session.mediaRequest())
        let nextEpoch = Data(repeating: 0xaa, count: 16)
        let info = Proto.uint32(1, 0) + Proto.bytes(2, remote) + Proto.bytes(3, nextEpoch) + Proto.fixed32(4, 1)
        _ = try session.receive(handshakeResponse(uuid: unwrap(request.bytes(51)), info: info), timeUnit: .seconds, observedAt: 1000)
        let next = try Proto(session.mediaRequest())
        expectEqual(try next.message(13)?.message(5)?.uint32(3), 1)
        expectEqual(try next.message(13)?.message(5)?.bytes(1), nextEpoch)
    }
    func testUnauthenticatedSessionChangeRejected() throws {
        let session = try makeSession()
        let request = try Proto(session.handshake())
        let response = try Proto(handshakeResponse(uuid: unwrap(request.bytes(51))))
        var changed = Data()
        for field in response.fields {
            if field.number == 15 { var info = field.bytes; info[1] ^= 1; changed += Proto.bytes(15, info) }
            else { changed += encode(field) }
        }
        expectThrowsError(try session.receive(changed, timeUnit: .seconds, observedAt: 1000))
        expectThrowsError(try session.mediaRequest())
    }
    func testMissingVersusZeroPlaybackAndTiming() throws {
        let absent = try TeslaMediaParser.parse(mediaPayload(duration: nil, elapsed: nil, playback: nil), timeUnit: .milliseconds, observedAt: 1000)
        expectNil(absent.duration); expectNil(absent.position); expectNil(absent.playing)
        let zero = try TeslaMediaParser.parse(mediaPayload(duration: 0, elapsed: 0, playback: 0), timeUnit: .seconds, observedAt: 1000)
        expectEqual(zero.duration, 0); expectEqual(zero.position, 0); expectEqual(zero.playing, false)
    }
    func testTimeUnitsExplicitAndInvalidTimingRejected() throws {
        let ms = try TeslaMediaParser.parse(mediaPayload(duration: 1234, elapsed: 120), timeUnit: .milliseconds, observedAt: 1000)
        let seconds = try TeslaMediaParser.parse(mediaPayload(duration: 1234, elapsed: 120), timeUnit: .seconds, observedAt: 1000)
        expectEqual(ms.duration, 1.234); expectEqual(ms.position, 0.12)
        expectEqual(seconds.duration, 1234); expectEqual(seconds.position, 120)
        expectThrowsError(try TeslaMediaParser.parse(mediaPayload(duration: UInt32.max), timeUnit: .seconds, observedAt: 1000))
        expectThrowsError(try TeslaMediaParser.parse(mediaPayload(playback: 99), timeUnit: .seconds, observedAt: 1000))
        expectThrowsError(try TeslaMediaParser.parse(mediaPayload(), timeUnit: .seconds, observedAt: .nan))
    }
    func testAbsentMediaAndApplicationFailureAreNotSuccess() throws {
        expectThrowsError(try TeslaMediaParser.parse(Proto.bytes(1, Data()) + Proto.bytes(2, Data()), timeUnit: .seconds, observedAt: 1000))
        expectThrowsError(try TeslaMediaParser.parse(Proto.bytes(1, Proto.uint32(1, 1)) + Proto.bytes(2, Proto.bytes(20, Proto.bytes(4, Data("x".utf8)))), timeUnit: .seconds, observedAt: 1000))
        expectThrowsError(try TeslaMediaParser.parse(Proto.bytes(2, Proto.bytes(20, Data())), timeUnit: .seconds, observedAt: 1000))
    }
    func testMonitorEnrollmentOnlyRoleFiveIOSFormSix() throws {
        let publicKey = try P256.KeyAgreement.PrivateKey(rawRepresentation: client).publicKey.x963Representation
        let toVCSEC = try Proto(TeslaEnrollment.monitorRequest(publicKey: publicKey))
        let signed = try unwrap(toVCSEC.message(1))
        expectEqual(try signed.uint32(3), 2)
        let unsigned = try Proto(unwrap(signed.bytes(2)))
        let whitelist = try unwrap(unsigned.message(16))
        let permission = try unwrap(whitelist.message(5))
        expectEqual(try permission.uint32(4), 5)
        expectEqual(try permission.message(1)?.bytes(1), publicKey)
        expectEqual(try whitelist.message(6)?.uint32(1), 6)
        expectNil(try whitelist.bytes(1))
        expectThrowsError(try TeslaSession.validateMediaQuery(TeslaEnrollment.monitorRequest(publicKey: publicKey)))
    }

    private func encode(_ field: ProtoField) -> Data {
        switch field.wire {
        case 0: return Proto.varint(UInt64(field.number * 8)) + Proto.varint(field.scalar)
        case 5: return Proto.fixed32(field.number, UInt32(field.scalar))
        default: return Proto.bytes(field.number, field.bytes)
        }
    }
}

private func hex(_ value: String) -> Data {
    precondition(value.count % 2 == 0)
    let chars = Array(value)
    return Data(stride(from: 0, to: chars.count, by: 2).map { UInt8(String(chars[$0...$0 + 1]), radix: 16)! })
}
