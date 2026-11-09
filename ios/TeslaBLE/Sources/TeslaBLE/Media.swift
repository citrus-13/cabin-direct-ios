// Reduced, changed Swift adaptation of Tesla vehicle-command media/VCSEC schemas (Apache-2.0).
// Source attribution and changes: ../../PROVENANCE.md; license: ../../LICENSE-TESLA.
import Foundation

public enum TeslaVehicleIdentity {
    /// VIN input is normalized by the UI; protocol callers must supply canonical ASCII.
    public static func isValidVIN(_ vin: String) -> Bool {
        vin.utf8.count == 17 && vin.utf8.allSatisfy {
            (48...57).contains($0) || ((65...90).contains($0) && ![73, 79, 81].contains($0))
        }
    }
}

public enum TeslaMediaTimeUnit: String, Codable, Sendable {
    case milliseconds
    case seconds

    func seconds(_ raw: Int32?) throws -> Double? {
        guard let raw else { return nil }
        guard raw >= 0 else { throw TeslaProtocolError.invalidTime }
        return Double(raw) / (self == .milliseconds ? 1000 : 1)
    }
}

public struct TeslaMediaTrack: Sendable, Equatable {
    public let title: String?
    public let artist: String?
    public let duration: Double?
    public let position: Double?
    public let playing: Bool?
    public let observedAt: Double
}

enum TeslaMediaParser {
    static func parse(_ data: Data, timeUnit: TeslaMediaTimeUnit, observedAt: Double) throws -> TeslaMediaTrack {
        guard observedAt.isFinite, observedAt > 0 else { throw TeslaProtocolError.invalidTime }
        let response = try Proto(data)
        guard let status = try response.message(1), try status.uint32(1) ?? 0 == 0,
              try response.oneOf([2, 3, 5, 9], required: true) == 2,
              let vehicle = try response.message(2), let media = try vehicle.message(20) else {
            throw TeslaProtocolError.noMedia
        }
        let detail = try vehicle.message(21)
        let title = try media.string(4)
        let artist = try media.string(3)
        let playback = try media.int32(9)
        let playing: Bool?
        switch playback {
        case .none: playing = nil
        case 0, 2: playing = false
        case 1: playing = true
        default: throw TeslaProtocolError.unsupported
        }
        // Never mix prior detail/track fields into a new response. Missing is genuinely unknown.
        let duration = try timeUnit.seconds(detail?.int32(2))
        let position = try timeUnit.seconds(detail?.int32(3))
        guard title != nil || artist != nil || playback != nil else { throw TeslaProtocolError.noMedia }
        return TeslaMediaTrack(title: title, artist: artist, duration: duration,
                               position: position, playing: playing, observedAt: observedAt)
    }
}

enum TeslaEnrollment {
    // This sole non-read operation is available only via an explicit app enrollment gesture.
    // The result is raw ToVCSECMessage (not a RoutableMessage), matching SendAddKeyRequestWithRole.
    static func monitorRequest(publicKey: Data) throws -> Data {
        guard publicKey.count == 65, publicKey.first == 4 else { throw TeslaProtocolError.authentication }
        let permission = Proto.bytes(1, Proto.bytes(1, publicKey)) + Proto.uint32(4, 5)
        let whitelist = Proto.bytes(5, permission) + Proto.bytes(6, Proto.uint32(1, 6))
        let unsigned = Proto.bytes(16, whitelist)
        let signed = Proto.bytes(2, unsigned) + Proto.uint32(3, 2)
        return Proto.bytes(1, signed)
    }
}
