// Changed, media-only Swift integration of Tesla vehicle-command protocol flows (Apache-2.0).
// Source attribution and changes: ../../PROVENANCE.md; license: ../../LICENSE-TESLA.
import Foundation
import CryptoKit

/// Callbacks run on a private serial queue. UI consumers must dispatch to the main actor.
/// startReading requires a previously enrolled Keychain key and never creates one.
/// Device behavior (including ReplayKit extension CoreBluetooth access) is not verified.
public final class NativeTeslaMediaClient {
    private let vin: String
    private let keyStore: TeslaKeyStore
    private let timeUnit: TeslaMediaTimeUnit
    private let allowEnrollment: Bool
    private let onStatus: (String) -> Void
    private let onMedia: (TeslaMediaTrack) -> Void
    private let queue = DispatchQueue(label: "CabinDirect.TeslaBLE.reader")
    private var session: TeslaSession?
    private var ticker: DispatchSourceTimer?
    private var nextPollAt: Double = 0
    private var enrollmentMessage: Data?
    #if canImport(CoreBluetooth)
    private var transport: TeslaBluetoothTransport?
    #endif

    public init(vin: String, keyStore: TeslaKeyStore, timeUnit: TeslaMediaTimeUnit,
                allowEnrollment: Bool = false,
                onStatus: @escaping (String) -> Void, onMedia: @escaping (TeslaMediaTrack) -> Void) {
        self.vin = vin; self.keyStore = keyStore; self.timeUnit = timeUnit
        self.allowEnrollment = allowEnrollment; self.onStatus = onStatus; self.onMedia = onMedia
    }
    public func startReading() {
        queue.async { [weak self] in self?.begin(enroll: false) }
    }
    public func stop() {
        queue.async { [self] in end(); onStatus("stopped") }
    }
    /// Must be exposed only by the containing app following a fresh, explicit user confirmation.
    /// This sends a ROLE_VEHICLE_MONITOR request; sent != NFC-approved != enrolled != media-readable.
    public func enrollMonitorKeyExplicitly() {
        queue.async { [weak self] in
            guard let self else { return }
            guard self.allowEnrollment else { self.onStatus("enrollment_disabled"); return }
            self.begin(enroll: true)
        }
    }
    private func begin(enroll: Bool) {
        end()
        #if os(iOS)
        beginOnDevice(enroll: enroll)
        #else
        onStatus("unavailable_requires_iphone")
        #endif
    }
    // Compiled/typechecked on macOS as well, but never invoked there by the public API.
    private func beginOnDevice(enroll: Bool) {
        #if canImport(CoreBluetooth)
        do {
            guard vin.utf8.count == 17, vin.utf8.allSatisfy({ (48...57).contains($0) || (65...90).contains($0) }) else {
                throw TeslaProtocolError.invalidVIN
            }
            let key: CryptoKit.P256.KeyAgreement.PrivateKey
            if enroll {
                key = try keyStore.createForExplicitEnrollmentIfMissing()
                enrollmentMessage = try TeslaEnrollment.monitorRequest(publicKey: key.publicKey.x963Representation)
            } else {
                guard let existing = try keyStore.load() else { throw TeslaProtocolError.missingKey }
                key = existing
                session = try TeslaSession(vin: vin, privateKey: key)
            }
            transport = TeslaBluetoothTransport(vin: vin, queue: queue,
                ready: { [weak self] in self?.connected() },
                received: { [weak self] data in self?.receive(data) },
                failed: { [weak self] error in self?.fail(error) })
            onStatus(enroll ? "connecting_for_explicit_monitor_enrollment" : "connecting_read_only")
            transport?.start()
        } catch { fail(error) }
        #endif
    }
    private func connected() {
        #if canImport(CoreBluetooth)
        do {
            if let message = enrollmentMessage {
                onStatus("sending_monitor_enrollment_request")
                try transport?.send(message, completed: { [weak self] in
                    self?.end()
                    self?.onStatus("enrollment_request_sent_confirm_with_nfc_and_vehicle_ui_not_yet_verified")
                })
                return
            }
            guard let session, let transport else { throw TeslaProtocolError.transport }
            onStatus("authenticating_infotainment")
            try transport.send(session.handshake())
            let timer = DispatchSource.makeTimerSource(queue: queue)
            timer.schedule(deadline: .now() + 0.5, repeating: 0.5)
            timer.setEventHandler { [weak self] in self?.tick() }
            ticker = timer; timer.resume()
        } catch { fail(error) }
        #endif
    }
    private func tick() {
        #if canImport(CoreBluetooth)
        guard let session, let transport else { return }
        if session.pendingExpired { fail(TeslaProtocolError.expired); return }
        if !transport.isSending, !session.hasPending, ProcessInfo.processInfo.systemUptime >= nextPollAt {
            do { try transport.send(session.mediaRequest()) } catch { fail(error) }
        }
        #endif
    }
    private func receive(_ data: Data) {
        guard enrollmentMessage == nil, let session else { return }
        do {
            switch try session.receive(data, timeUnit: timeUnit, observedAt: Date().timeIntervalSince1970) {
            case .ready:
                onStatus("authenticated_session_media_not_yet_verified")
                nextPollAt = 0; tick()
            case .media(let media):
                nextPollAt = ProcessInfo.processInfo.systemUptime + 2
                onStatus("authenticated_media_received")
                onMedia(media)
            }
        } catch { fail(error) }
    }
    private func fail(_ error: Error) {
        end()
        // No remote text, VIN, key, nonce, command bytes or raw errors in callbacks/logs.
        let status: String
        switch error as? TeslaProtocolError {
        case .missingKey: status = "missing_or_unenrolled_key_explicit_enrollment_required"
        case .invalidVIN: status = "invalid_vin"
        case .keychain: status = "keychain_unavailable_check_access_group_and_unlock"
        case .expired: status = "timeout_stopped_no_automatic_retry"
        case .noMedia: status = "media_unavailable_no_assumed_values"
        case .invalidTime: status = "invalid_media_time"
        case .vehicleFault(let value): status = "authenticated_vehicle_fault_\(value)_no_role_escalation"
        case .unavailable: status = "bluetooth_unavailable_or_denied"
        default: status = "protocol_or_authentication_failure_stopped"
        }
        onStatus(status)
    }
    private func end() {
        ticker?.cancel(); ticker = nil
        #if canImport(CoreBluetooth)
        transport?.stop(); transport = nil
        #endif
        session = nil; enrollmentMessage = nil; nextPollAt = 0
    }
    deinit {
        ticker?.cancel()
        #if canImport(CoreBluetooth)
        transport?.stop()
        #endif
    }
}
