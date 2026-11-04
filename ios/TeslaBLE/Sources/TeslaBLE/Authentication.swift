import Foundation
import CryptoKit
import Security

// Swift adaptation of Tesla vehicle-command authentication; changed from Go to a
// media-only, ephemeral-session client using CryptoKit.
// Tesla vehicle-command attribution and Apache-2.0 terms: ../../PROVENANCE.md and ../../LICENSE-TESLA.
enum TeslaCrypto {
    static func random(_ count: Int) throws -> Data {
        var bytes = [UInt8](repeating: 0, count: count)
        guard SecRandomCopyBytes(kSecRandomDefault, count, &bytes) == errSecSuccess else {
            throw TeslaProtocolError.authentication
        }
        return Data(bytes)
    }
    static func sharedKey(privateKey: P256.KeyAgreement.PrivateKey, remotePublic: Data) throws -> SymmetricKey {
        guard remotePublic.count == 65, remotePublic.first == 4 else { throw TeslaProtocolError.authentication }
        let publicKey = try P256.KeyAgreement.PublicKey(x963Representation: remotePublic)
        let secret = try privateKey.sharedSecretFromKeyAgreement(with: publicKey)
        // Tesla KDF: SHA1 of the 32-byte, big-endian, padded shared x-coordinate,
        // truncated to 16 bytes. This is NOT HKDF and not SHA1(private/public key).
        let digest = secret.withUnsafeBytes { Insecure.SHA1.hash(data: Data($0)) }
        return SymmetricKey(data: Data(digest.prefix(16)))
    }
    static func bigEndian(_ value: UInt32) -> Data {
        Data([UInt8(truncatingIfNeeded: value >> 24), UInt8(truncatingIfNeeded: value >> 16),
              UInt8(truncatingIfNeeded: value >> 8), UInt8(truncatingIfNeeded: value)])
    }
    static func metadata(_ fields: [(UInt8, Data)]) throws -> Data {
        var previous: UInt8? = nil
        var result = Data()
        for (tag, value) in fields {
            guard tag < 255, previous == nil || tag > previous!, value.count <= 255 else {
                throw TeslaProtocolError.malformed
            }
            previous = tag
            result.append(tag); result.append(UInt8(value.count)); result.append(value)
        }
        result.append(255)
        return result
    }
    static func sessionAuthenticationData(vin: String, challenge: Data, info: Data) throws -> Data {
        var result = try metadata([(0, Data([6])), (2, Data(vin.utf8)), (6, challenge)])
        result.append(info)
        return result
    }
    static func sessionSubkey(_ key: SymmetricKey) -> SymmetricKey {
        SymmetricKey(data: Data(HMAC<SHA256>.authenticationCode(for: Data("session info".utf8), using: key)))
    }
    static func verifySession(key: SymmetricKey, vin: String, challenge: Data, info: Data, tag: Data) throws {
        let data = try sessionAuthenticationData(vin: vin, challenge: challenge, info: info)
        guard tag.count == 32,
              HMAC<SHA256>.isValidAuthenticationCode(tag, authenticating: data, using: sessionSubkey(key)) else {
            throw TeslaProtocolError.authentication
        }
    }
    static func commandMetadata(vin: String, epoch: Data, counter: UInt32, expires: UInt32, flags: UInt32) throws -> Data {
        var fields: [(UInt8, Data)] = [(0, Data([5])), (1, Data([3])), (2, Data(vin.utf8)),
                                      (3, epoch), (4, bigEndian(expires)), (5, bigEndian(counter))]
        if flags != 0 { fields.append((7, bigEndian(flags))) }
        return try metadata(fields)
    }
    static func responseAAD(vin: String, counter: UInt32, flags: UInt32, requestHash: Data, fault: UInt32) throws -> Data {
        let encoded = try metadata([(0, Data([9])), (1, Data([3])), (2, Data(vin.utf8)),
                                    (5, bigEndian(counter)), (7, bigEndian(flags)),
                                    (8, requestHash), (9, bigEndian(fault))])
        return Data(SHA256.hash(data: encoded))
    }
    static func seal(_ plaintext: Data, key: SymmetricKey, metadata: Data, nonce: Data) throws -> AES.GCM.SealedBox {
        guard nonce.count == 12 else { throw TeslaProtocolError.authentication }
        return try AES.GCM.seal(plaintext, using: key, nonce: AES.GCM.Nonce(data: nonce),
                                authenticating: Data(SHA256.hash(data: metadata)))
    }
}

enum SessionResult {
    case ready
    case media(TeslaMediaTrack)
}

/// Confined to the client's serial queue. Exposes no arbitrary-command method.
final class TeslaSession {
    static let encryptedResponseFlag: UInt32 = 2 // 1 << FLAG_ENCRYPT_RESPONSE (enum value 1)
    let vin: String
    let publicKey: Data
    let routingAddress: Data
    private let privateKey: P256.KeyAgreement.PrivateKey
    private let now: () -> Double // Monotonic seconds, never wall-clock for expiry.
    private let random: (Int) throws -> Data
    private var session: State?
    private var pending: Pending?

    struct State {
        let key: SymmetricKey
        let remotePublic: Data
        let epoch: Data
        let clock: UInt32
        let receivedAt: Double
        var counter: UInt32
    }
    struct Pending {
        let uuid: Data
        let requestHash: Data? // nil means handshake
        let sentAt: Double
    }

    init(vin: String, privateKey: P256.KeyAgreement.PrivateKey,
         routingAddress: Data? = nil,
         now: @escaping () -> Double = { ProcessInfo.processInfo.systemUptime },
         random: @escaping (Int) throws -> Data = TeslaCrypto.random) throws {
        guard vin.utf8.count == 17, vin.utf8.allSatisfy({ (48...57).contains($0) || (65...90).contains($0) }) else {
            throw TeslaProtocolError.invalidVIN
        }
        self.vin = vin; self.privateKey = privateKey; publicKey = privateKey.publicKey.x963Representation
        self.routingAddress = try routingAddress ?? random(16)
        guard self.routingAddress.count == 16 else { throw TeslaProtocolError.malformed }
        self.now = now; self.random = random
    }
    static func advertisementName(vin: String) -> String {
        "S" + Insecure.SHA1.hash(data: Data(vin.utf8)).prefix(8).map { String(format: "%02x", $0) }.joined() + "C"
    }
    var hasPending: Bool { pending != nil }
    var pendingExpired: Bool { pending.map { now() - $0.sentAt > 5 } ?? false }

    func handshake() throws -> Data {
        guard pending == nil else { throw TeslaProtocolError.association }
        let uuid = try random(16)
        guard uuid.count == 16 else { throw TeslaProtocolError.malformed }
        let data = envelope(payloadField: 14, payload: Proto.bytes(1, publicKey), uuid: uuid)
        pending = Pending(uuid: uuid, requestHash: nil, sentAt: now())
        return data
    }
    // Exact allowlist: Action.vehicleAction.GetVehicleData.{getMediaState,getMediaDetailState}.
    // VehicleAction fields 15/16 are WRITE commands, so nesting is security-relevant.
    static var mediaQuery: Data {
        Proto.bytes(2, Proto.bytes(1, Proto.bytes(15, Data()) + Proto.bytes(16, Data())))
    }
    static func validateMediaQuery(_ data: Data) throws {
        let action = try Proto(data)
        guard action.fields.count == 1, let vehicle = try action.message(2), vehicle.fields.count == 1,
              let get = try vehicle.message(1), get.fields.count == 2,
              let state = try get.bytes(15), state.isEmpty,
              let detail = try get.bytes(16), detail.isEmpty else { throw TeslaProtocolError.unsupported }
    }
    func mediaRequest() throws -> Data {
        guard pending == nil, var current = session else { throw TeslaProtocolError.association }
        guard current.counter < UInt32.max else { throw TeslaProtocolError.counterExhausted }
        let elapsed = now() - current.receivedAt
        let expires = Double(current.clock) + floor(elapsed) + 5
        guard elapsed >= 0, expires.isFinite, expires <= Double(UInt32.max) else { throw TeslaProtocolError.expired }
        current.counter += 1
        let uuid = try random(16)
        guard uuid.count == 16 else { throw TeslaProtocolError.malformed }
        let plaintext = Self.mediaQuery
        try Self.validateMediaQuery(plaintext)
        let metadata = try TeslaCrypto.commandMetadata(vin: vin, epoch: current.epoch, counter: current.counter,
                                                        expires: UInt32(expires), flags: Self.encryptedResponseFlag)
        let box = try TeslaCrypto.seal(plaintext, key: current.key, metadata: metadata, nonce: random(12))
        let auth = Proto.bytes(1, current.epoch) + Proto.bytes(2, Data(box.nonce)) + Proto.uint32(3, current.counter)
            + Proto.fixed32(4, UInt32(expires)) + Proto.bytes(5, box.tag)
        let signature = Proto.bytes(1, Proto.bytes(1, publicKey)) + Proto.bytes(5, auth)
        let message = envelope(payloadField: 10, payload: box.ciphertext, uuid: uuid)
            + Proto.bytes(13, signature) + Proto.uint32(52, Self.encryptedResponseFlag)
        guard message.count <= Proto.maxBytes else { throw TeslaProtocolError.oversized }
        session = current
        pending = Pending(uuid: uuid, requestHash: Data([5]) + box.tag, sentAt: now())
        return message
    }
    private func envelope(payloadField: Int, payload: Data, uuid: Data) -> Data {
        Proto.bytes(6, Proto.uint32(1, 3)) + Proto.bytes(7, Proto.bytes(2, routingAddress))
            + Proto.bytes(payloadField, payload) + Proto.bytes(51, uuid)
    }

    func receive(_ data: Data, timeUnit: TeslaMediaTimeUnit, observedAt: Double) throws -> SessionResult {
        guard let request = pending else { throw TeslaProtocolError.replay }
        guard now() >= request.sentAt, now() - request.sentAt <= 5 else { throw TeslaProtocolError.expired }
        let envelope = try Proto(data)
        guard let to = try envelope.message(6), try to.oneOf([1, 2], required: true) == 2,
              try to.bytes(2) == routingAddress,
              let from = try envelope.message(7), try from.oneOf([1, 2], required: true) == 1,
              try from.uint32(1) == 3, try envelope.bytes(50) == request.uuid else {
            throw TeslaProtocolError.association
        }
        let payloadKind = try envelope.oneOf([10, 14, 15], required: true)
        guard let signature = try envelope.message(13) else { throw TeslaProtocolError.authentication }
        let signatureKind = try signature.oneOf([5, 6, 8, 9, 10], required: true)
        let status = try envelope.message(12)
        let fault = try status?.uint32(2) ?? 0
        let operation = try status?.uint32(1) ?? 0

        if payloadKind == 15 {
            guard signatureKind == 6, let info = try envelope.bytes(15),
                  let tagMessage = try signature.message(6), let tag = try tagMessage.bytes(1) else {
                throw TeslaProtocolError.authentication
            }
            try acceptSession(info: info, tag: tag, challenge: request.uuid)
            pending = nil
            // Status outside SessionInfo is not part of its HMAC. Do not trust it as approval.
            return .ready
        }
        guard request.requestHash != nil, payloadKind == 10, signatureKind == 9,
              let current = session, let encrypted = try envelope.bytes(10),
              let auth = try signature.message(9), let nonce = try auth.bytes(1),
              let tag = try auth.bytes(3), nonce.count == 12, tag.count == 16 else {
            throw TeslaProtocolError.authentication // Never accept plaintext fallback.
        }
        let counter = try auth.uint32(2) ?? 0 // A valid first response counter may be zero.
        let flags = try envelope.uint32(52) ?? 0
        let aad = try TeslaCrypto.responseAAD(vin: vin, counter: counter, flags: flags,
                                              requestHash: request.requestHash!, fault: fault)
        let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: nonce), ciphertext: encrypted, tag: tag)
        let plaintext = try AES.GCM.open(box, using: current.key, authenticating: aad)
        // This read-only command has one final response. Consuming its UUID also rejects all replay
        // counters for it; no multi-response stream or retry reuses a request UUID/tag.
        pending = nil
        guard fault == 0 else { throw TeslaProtocolError.vehicleFault(fault) }
        guard operation == 0 else { throw TeslaProtocolError.applicationRejected }
        return .media(try TeslaMediaParser.parse(plaintext, timeUnit: timeUnit, observedAt: observedAt))
    }
    private func acceptSession(info encoded: Data, tag: Data, challenge: Data) throws {
        let info = try Proto(encoded)
        guard let remote = try info.bytes(2), let epoch = try info.bytes(3), epoch.count == 16 else {
            throw TeslaProtocolError.authentication
        }
        let key = try TeslaCrypto.sharedKey(privateKey: privateKey, remotePublic: remote)
        try TeslaCrypto.verifySession(key: key, vin: vin, challenge: challenge, info: encoded, tag: tag)
        guard try info.uint32(5) ?? 0 == 0 else { throw TeslaProtocolError.missingKey }
        let clock = try info.uint32(4, fixed: true) ?? 0
        var counter = try info.uint32(1) ?? 0
        if let old = session {
            guard remote == old.remotePublic else { throw TeslaProtocolError.authentication }
            if epoch == old.epoch {
                guard clock >= old.clock else { throw TeslaProtocolError.replay }
                counter = max(counter, old.counter)
            }
        }
        session = State(key: key, remotePublic: remote, epoch: epoch, clock: clock, receivedAt: now(), counter: counter)
    }
}
