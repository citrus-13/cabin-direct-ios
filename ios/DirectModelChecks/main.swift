import Foundation
import Combine
import Darwin

// macOS-only Combine acceptance for the extracted, unmodified production model.
// DIRECT_SESSION_STORE_TEST redirects all store I/O to this invocation's fixture.
// No iPhone, UI rendering, ReplayKit, socket, account or vehicle is exercised.
@main
enum DirectModelChecks {
    @MainActor
    static func main() {
        var checks = 0, failures = 0, runtimeErrors = 0
        var idleEvents = 0, repeatedStatusEvents = 0, repeatedSessionEvents = 0
        var heartbeatEvents = 0, expiryEvents = 0, clearedEvents = 0, clearedIdleEvents = 0
        func expect(_ condition: @autoclosure () -> Bool) {
            checks += 1
            if !condition() { failures += 1 }
        }
        do {
            guard CommandLine.arguments.count == 2 else { throw CheckError.missingContainer }
            let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
            let live = root.appendingPathComponent("live", isDirectory: true)
            let empty = root.appendingPathComponent("empty", isDirectory: true)
            try FileManager.default.createDirectory(at: live, withIntermediateDirectories: false)
            try FileManager.default.createDirectory(at: empty, withIntermediateDirectories: false)
            DirectSessionStore.testContainer = live

            var interfaces = [DirectInterfaceAddress(interface: "en0", address: "192.168.7.20")]
            let model = DirectSetupModel(addressProvider: { interfaces })
            expect(model.status == nil && model.session == nil && model.measuredFPS == nil)
            expect(model.observedAddresses == interfaces)
            var changes = 0, statusChanges = 0, sessionChanges = 0, fpsChanges = 0
            var subscriptions = Set<AnyCancellable>()
            model.objectWillChange.sink { changes += 1 }.store(in: &subscriptions)
            model.$status.dropFirst().sink { _ in statusChanges += 1 }.store(in: &subscriptions)
            model.$session.dropFirst().sink { _ in sessionChanges += 1 }.store(in: &subscriptions)
            model.$measuredFPS.dropFirst().sink { _ in fpsChanges += 1 }.store(in: &subscriptions)

            for _ in 0..<10 { model.refresh() }
            idleEvents = changes
            expect(changes == 0 && statusChanges == 0 && sessionChanges == 0 && fpsChanges == 0)
            let beforeNetwork = changes
            interfaces = [.init(interface: "en0", address: "192.168.8.30")]
            model.refresh()
            expect(model.observedAddresses == interfaces && changes - beforeNetwork == 1)
            interfaces = []; model.refresh()
            expect(model.observedAddresses.isEmpty && changes - beforeNetwork == 2)
            for _ in 0..<10 { model.refresh() }
            expect(changes - beforeNetwork == 2)
            expect(model.session == nil && model.status == nil && !model.active && !model.stopPending)
            expect(DirectSessionStore.session() == nil && DirectSessionStore.status() == nil)
            expect(!FileManager.default.fileExists(atPath: live.appendingPathComponent("direct-settings.json").path))

            // Deliberately synthetic local fixture values, never printed or used
            // for a server. The real store methods and OS file lock are exercised.
            let now = Date().timeIntervalSince1970
            let session = DirectBroadcastSession(id: "synthetic-combine-model", token: String(repeating: "X", count: 43),
                pairingCode: "123456", createdAt: now, expiresAt: now + 7200, settings: DirectSettings())
            try DirectSessionStore.saveSession(session)
            DirectSessionStore.setStatus(.init(sessionID: session.id, state: "broadcasting", message: "Synthetic model check",
                addresses: [], port: 0, frames: 10, updatedAt: now))
            model.refresh()
            expect(model.active && model.session?.id == session.id && model.status?.frames == 10)
            let statusBefore = statusChanges, sessionBefore = sessionChanges, changesBefore = changes
            for _ in 0..<10 { model.refresh() }
            repeatedStatusEvents = statusChanges - statusBefore
            repeatedSessionEvents = sessionChanges - sessionBefore
            expect(repeatedStatusEvents == 10 && repeatedSessionEvents == 10)
            expect(changes - changesBefore >= 20)

            let fpsBefore = fpsChanges
            DirectSessionStore.setStatus(.init(sessionID: session.id, state: "broadcasting", message: "Synthetic model check",
                addresses: [], port: 0, frames: 15, updatedAt: now + 0.25))
            model.refresh()
            heartbeatEvents = fpsChanges - fpsBefore
            expect(heartbeatEvents == 1 && abs((model.measuredFPS ?? -1) - 20) < 0.001)

            // Keep the stored status bytes unchanged while the actual production
            // Date-based freshness boundary expires. No fake/injected clock.
            let nearExpiry = DirectRuntimeStatus(sessionID: session.id, state: "broadcasting", message: "Synthetic model check",
                addresses: [], port: 0, frames: 15, updatedAt: Date().timeIntervalSince1970 - 6)
            DirectSessionStore.setStatus(nearExpiry)
            model.refresh()
            expect(model.active && model.measuredFPS != nil)
            let beforeExpiry = changes, beforeExpiryStatus = statusChanges
            let deadline = Date().addingTimeInterval(4)
            while model.active && Date() < deadline { Thread.sleep(forTimeInterval: 0.025) }
            model.refresh()
            expiryEvents = changes - beforeExpiry
            expect(!model.active && model.measuredFPS == nil)
            expect(expiryEvents > 0 && statusChanges - beforeExpiryStatus == 1)
            expect(DirectSessionStore.status()?.updatedAt == nearExpiry.updatedAt)

            // A different empty test container models unavailable shared state
            // without deleting any fixture files or changing production storage.
            DirectSessionStore.testContainer = empty
            let beforeClear = changes, statusBeforeClear = statusChanges, sessionBeforeClear = sessionChanges
            model.refresh()
            clearedEvents = changes - beforeClear
            expect(model.status == nil && model.session == nil && model.measuredFPS == nil)
            expect(statusChanges - statusBeforeClear == 1 && sessionChanges - sessionBeforeClear == 1 && clearedEvents >= 2)
            let beforeIdle = changes
            for _ in 0..<10 { model.refresh() }
            clearedIdleEvents = changes - beforeIdle
            expect(clearedIdleEvents == 0)
            withExtendedLifetime(subscriptions) {}
        } catch { runtimeErrors += 1; failures += 1 }
        // Counts only: never emit fixture credentials, identifiers, addresses,
        // user messages, filesystem paths or arbitrary error descriptions.
        print("{\"checks\":\(checks),\"failures\":\(failures),\"runtime_errors\":\(runtimeErrors),\"idle_events\":\(idleEvents),\"repeated_status_events\":\(repeatedStatusEvents),\"repeated_session_events\":\(repeatedSessionEvents),\"heartbeat_fps_events\":\(heartbeatEvents),\"expiry_events\":\(expiryEvents),\"cleared_events\":\(clearedEvents),\"cleared_idle_events\":\(clearedIdleEvents)}")
        if failures != 0 { exit(1) }
    }
    private enum CheckError: Error { case missingContainer }
}
