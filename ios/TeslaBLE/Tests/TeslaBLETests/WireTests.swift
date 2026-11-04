import Foundation
@testable import TeslaBLE

final class WireTests {
    func testUint32BoundsAndDuplicateFields() throws {
        expectEqual(try Proto(Proto.uint32(1, UInt32.max)).uint32(1), UInt32.max)
        expectThrowsError(try Proto(Data([8]) + Proto.varint(UInt64(UInt32.max) + 1)).uint32(1))
        expectThrowsError(try Proto(Proto.uint32(1, 0) + Proto.uint32(1, 1)).uint32(1))
        expectThrowsError(try Proto(Proto.bytes(1, Data())).uint32(1))
        expectNil(try Proto(Data()).uint32(1))
    }
    func testInt32SignExtensionWithoutTruncation() throws {
        expectEqual(try Proto(Data([8]) + Proto.varint(UInt64.max)).int32(1), -1)
        expectEqual(try Proto(Data([8]) + Proto.varint(UInt64.max - UInt64(Int32.max))).int32(1), Int32.min)
        expectThrowsError(try Proto(Data([8]) + Proto.varint(UInt64(UInt32.max))).int32(1))
        expectThrowsError(try Proto(Data([8]) + Proto.varint(UInt64.max - UInt64(Int32.max) - 1)).int32(1))
    }
    func testMalformedVarintsLengthsAndWireTypes() {
        let malformed = [Data([0]), Data([8, 128]), Data([8]) + Data(repeating: 255, count: 10),
                         Data([8, 128, 0]), Data([10, 255, 255, 255, 255, 15]),
                         Data([10, 5, 1]), Data([13, 1, 2, 3]), Data([11]), Data([15]),
                         Data([9, 1]), Proto.varint(UInt64(0x20000000) << 3)]
        for data in malformed { expectThrowsError(try Proto(data), "Rejected bounded malformed input \(data.count) bytes") }
    }
    func testUTF8AndResourceBounds() {
        expectThrowsError(try Proto(Proto.bytes(1, Data([255]))).string(1))
        expectThrowsError(try Proto(Proto.bytes(1, Data(repeating: 65, count: 513))).string(1))
        expectThrowsError(try Proto(Data(repeating: 0, count: 1025)))
        expectThrowsError(try Proto(Data(repeating: 8, count: 258)))
    }
    func testAllTruncationsOfLengthDelimitedPayloadFail() {
        let data = Proto.bytes(16, Data(repeating: 65, count: 129))
        for count in 1..<data.count { expectThrowsError(try Proto(Data(data.prefix(count)))) }
        expectNoThrow(try Proto(data))
    }
    func testOneofAmbiguityRejected() throws {
        let data = try Proto(Proto.bytes(10, Data()) + Proto.bytes(15, Data()))
        expectThrowsError(try data.oneOf([10, 14, 15], required: true))
        expectThrowsError(try Proto(Data()).oneOf([10, 15], required: true))
    }
    func testBLEChunksAndBytewiseReassembly() throws {
        let message = Data((0..<1024).map { UInt8(truncatingIfNeeded: $0) })
        let chunks = try BLEFramer.chunks(message, maximumWriteLength: 20)
        expectTrue(chunks.allSatisfy { $0.count <= 20 })
        expectEqual(chunks[0].prefix(2), Data([4, 0]))
        var parser = BLEFramer()
        var output: [Data] = []
        for byte in chunks.flatMap({ $0 }) { output += try parser.receive(Data([byte])) }
        expectEqual(output, [message])
    }
    func testBLECoalescedAndPartialFrames() throws {
        let one = try BLEFramer.chunks(Data([1, 2, 3]), maximumWriteLength: 20)[0]
        let two = try BLEFramer.chunks(Data([4, 5]), maximumWriteLength: 20)[0]
        var parser = BLEFramer()
        expectEqual(try parser.receive(one + two.prefix(3)), [Data([1, 2, 3])])
        expectEqual(try parser.receive(Data(two.suffix(1))), [Data([4, 5])])
    }
    func testBLEOversizeZeroAndInvalidMTURejected() {
        var parser = BLEFramer()
        expectThrowsError(try parser.receive(Data([4, 1])))
        expectThrowsError(try parser.receive(Data([0, 0])))
        expectThrowsError(try parser.receive(Data(repeating: 1, count: 4097)))
        expectThrowsError(try BLEFramer.chunks(Data(repeating: 1, count: 1025), maximumWriteLength: 20))
        expectThrowsError(try BLEFramer.chunks(Data(), maximumWriteLength: 20))
        expectThrowsError(try BLEFramer.chunks(Data([1]), maximumWriteLength: 0))
    }
    func testFixed32Endianness() throws {
        let encoded = Proto.fixed32(4, 0x12345678)
        expectEqual(encoded, Data([0x25, 0x78, 0x56, 0x34, 0x12]))
        expectEqual(try Proto(encoded).uint32(4, fixed: true), 0x12345678)
    }
    func testMetadataTagsOrderAndLengthBounds() {
        expectThrowsError(try TeslaCrypto.metadata([(3, Data()), (2, Data())]))
        expectThrowsError(try TeslaCrypto.metadata([(2, Data()), (2, Data())]))
        expectThrowsError(try TeslaCrypto.metadata([(255, Data())]))
        expectThrowsError(try TeslaCrypto.metadata([(2, Data(repeating: 1, count: 256))]))
    }
}
