// Original bounded Swift wire codec for the reduced Tesla vehicle-command schema adaptation.
// Upstream schema attribution (Apache-2.0): ../../PROVENANCE.md and ../../LICENSE-TESLA.
import Foundation

// Minimal, bounded protobuf codec. Not a general protobuf implementation.
// Field mappings are derived from Tesla's Apache-2.0 schemas; see PROVENANCE.md.
enum TeslaProtocolError: Error, Equatable {
    case malformed, oversized, unsupported, missingKey, invalidVIN
    case authentication, association, expired, replay, counterExhausted
    case vehicleFault(UInt32), applicationRejected, noMedia, invalidTime
    case keychain(Int32), transport, unavailable
}

struct ProtoField {
    let number: Int
    let wire: UInt8
    let scalar: UInt64
    let bytes: Data
}

struct Proto {
    static let maxBytes = 1024
    let fields: [ProtoField]

    init(_ data: Data) throws {
        guard data.count <= Self.maxBytes else { throw TeslaProtocolError.oversized }
        let input = Array(data)
        var offset = 0
        var result: [ProtoField] = []
        func readVarint() throws -> UInt64 {
            var value: UInt64 = 0
            for index in 0..<10 {
                guard offset < input.count else { throw TeslaProtocolError.malformed }
                let byte = input[offset]; offset += 1
                guard index < 9 || byte <= 1 else { throw TeslaProtocolError.malformed }
                value |= UInt64(byte & 0x7f) << (index * 7)
                if byte & 0x80 == 0 {
                    guard index == 0 || byte != 0 else { throw TeslaProtocolError.malformed }
                    return value
                }
            }
            throw TeslaProtocolError.malformed
        }
        while offset < input.count {
            guard result.count < 128 else { throw TeslaProtocolError.oversized }
            let tag = try readVarint()
            let number = tag >> 3
            guard number > 0, number <= 0x1fffffff else { throw TeslaProtocolError.malformed }
            let wire = UInt8(tag & 7)
            var scalar: UInt64 = 0
            var bytes = Data()
            switch wire {
            case 0: scalar = try readVarint()
            case 1, 5:
                let size = wire == 1 ? 8 : 4
                guard size <= input.count - offset else { throw TeslaProtocolError.malformed }
                for index in 0..<size { scalar |= UInt64(input[offset + index]) << (index * 8) }
                offset += size
            case 2:
                let length = try readVarint()
                guard length <= UInt64(input.count - offset) else { throw TeslaProtocolError.malformed }
                let end = offset + Int(length)
                bytes = Data(input[offset..<end]); offset = end
            default: throw TeslaProtocolError.malformed // Groups are not used by this protocol.
            }
            result.append(ProtoField(number: Int(number), wire: wire, scalar: scalar, bytes: bytes))
        }
        fields = result
    }

    func field(_ number: Int, wire: UInt8) throws -> ProtoField? {
        let matches = fields.filter { $0.number == number }
        guard matches.count <= 1, matches.first == nil || matches.first?.wire == wire else {
            throw TeslaProtocolError.malformed
        }
        return matches.first
    }
    func bytes(_ number: Int) throws -> Data? { try field(number, wire: 2)?.bytes }
    func message(_ number: Int) throws -> Proto? { try bytes(number).map { try Proto($0) } }
    func uint32(_ number: Int, fixed: Bool = false) throws -> UInt32? {
        guard let value = try field(number, wire: fixed ? 5 : 0)?.scalar else { return nil }
        guard value <= UInt64(UInt32.max) else { throw TeslaProtocolError.malformed }
        return UInt32(value)
    }
    func int32(_ number: Int) throws -> Int32? {
        guard let value = try field(number, wire: 0)?.scalar else { return nil }
        if value <= UInt64(Int32.max) { return Int32(value) }
        // Negative int32 is sign-extended to 64 bits, never silently truncate overflow.
        guard value >= UInt64.max - UInt64(Int32.max) else { throw TeslaProtocolError.malformed }
        return Int32(truncatingIfNeeded: value)
    }
    func string(_ number: Int) throws -> String? {
        guard let data = try bytes(number) else { return nil }
        guard data.count <= 512, let text = String(data: data, encoding: .utf8) else {
            throw TeslaProtocolError.malformed
        }
        return text
    }
    func oneOf(_ numbers: [Int], required: Bool = false) throws -> Int? {
        let matches = fields.filter { numbers.contains($0.number) }
        guard matches.count <= 1, !required || matches.count == 1 else {
            throw TeslaProtocolError.malformed
        }
        return matches.first?.number
    }
    static func varint(_ value: UInt64) -> Data {
        var remaining = value
        var result = Data()
        repeat {
            var byte = UInt8(remaining & 0x7f); remaining >>= 7
            if remaining != 0 { byte |= 0x80 }
            result.append(byte)
        } while remaining != 0
        return result
    }
    static func bytes(_ number: Int, _ data: Data) -> Data {
        var output = varint(UInt64(number * 8 + 2))
        output.append(varint(UInt64(data.count))); output.append(data)
        return output
    }
    static func uint32(_ number: Int, _ value: UInt32) -> Data {
        var output = varint(UInt64(number * 8)); output.append(varint(UInt64(value)))
        return output
    }
    static func fixed32(_ number: Int, _ value: UInt32) -> Data {
        var output = varint(UInt64(number * 8 + 5))
        for shift in stride(from: 0, to: 32, by: 8) { output.append(UInt8(truncatingIfNeeded: value >> shift)) }
        return output
    }
}

struct BLEFramer {
    private var buffer = Data()
    mutating func reset() { buffer.removeAll(keepingCapacity: false) }
    mutating func receive(_ fragment: Data) throws -> [Data] {
        // Process bytes incrementally, so coalesced notifications never allocate an unbounded buffer.
        guard fragment.count <= 4096 else { throw TeslaProtocolError.oversized }
        var frames: [Data] = []
        for byte in fragment {
            buffer.append(byte)
            if buffer.count >= 2 {
                let count = Int(buffer[0]) * 256 + Int(buffer[1])
                guard count > 0, count <= Proto.maxBytes else { reset(); throw TeslaProtocolError.oversized }
                if buffer.count == count + 2 {
                    frames.append(Data(buffer.dropFirst(2))); reset()
                }
            }
        }
        return frames
    }
    static func chunks(_ message: Data, maximumWriteLength: Int) throws -> [Data] {
        guard !message.isEmpty, message.count <= Proto.maxBytes else { throw TeslaProtocolError.oversized }
        guard maximumWriteLength > 0, maximumWriteLength <= 65535 else { throw TeslaProtocolError.transport }
        var framed = Data([UInt8(message.count >> 8), UInt8(message.count & 0xff)])
        framed.append(message)
        return stride(from: 0, to: framed.count, by: maximumWriteLength).map {
            Data(framed[$0..<min(framed.count, $0 + maximumWriteLength)])
        }
    }
}
