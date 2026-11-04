import Foundation
import Darwin

// Compiled only with DIRECT_SESSION_STORE_TEST. No real app group, account or device.
guard CommandLine.arguments.count == 2 else { fatalError("Explicit test container required") }
DirectSessionStore.testContainer = URL(fileURLWithPath: CommandLine.arguments[1])
var failures = 0
func check(_ value: @autoclosure () -> Bool, _ label: String) {
    if !value() { failures += 1; print("FAIL: \(label)") }
}
func live(_ session: DirectBroadcastSession) -> DirectRuntimeStatus {
    .init(sessionID: session.id, state: "broadcasting", message: "Synthetic test only", addresses: [],
          port: 8787, frames: 1, updatedAt: Date().timeIntervalSince1970)
}
let old = try DirectBroadcastSession.fresh(settings: DirectSettings())
let next = try DirectBroadcastSession.fresh(settings: DirectSettings())
try DirectSessionStore.saveSession(old)
DirectSessionStore.setStatus(live(old))
try DirectSessionStore.requestStop(sessionID: old.id)
check(DirectSessionStore.stopRequested(for: old), "Matching request reaches current session")
check(!DirectSessionStore.stopRequested(for: next), "Stop request cannot target the next session")

try DirectSessionStore.saveSession(next)
DirectSessionStore.setStatus(live(next))
DirectSessionStore.finishSession(matching: old.id, message: "Old cleanup", frames: 3)
DirectSessionStore.setStatus(live(old))
check(DirectSessionStore.session()?.id == next.id, "Delayed old cleanup preserves new credentials")
check(DirectSessionStore.status()?.sessionID == next.id, "Delayed old status cannot overwrite new state")

// Hold the old terminal mutation inside the real OS lock. A new writer cannot
// interleave between compare/delete/status, then wins completely after unlock.
try DirectSessionStore.saveSession(old)
let entered = DispatchSemaphore(value: 0), release = DispatchSemaphore(value: 0)
let oldDone = DispatchSemaphore(value: 0), newStarted = DispatchSemaphore(value: 0), newDone = DispatchSemaphore(value: 0)
DirectSessionStore.beforeFinishForTesting = { entered.signal(); _ = release.wait(timeout: .now() + 3) }
DispatchQueue.global().async {
    DirectSessionStore.finishSession(matching: old.id, message: "Synthetic stopped", frames: 4)
    oldDone.signal()
}
check(entered.wait(timeout: .now() + 3) == .success, "Old cleanup holds OS lock")
DispatchQueue.global().async {
    newStarted.signal()
    try? DirectSessionStore.saveSession(next)
    DirectSessionStore.setStatus(live(next))
    newDone.signal()
}
check(newStarted.wait(timeout: .now() + 3) == .success, "New writer started")
check(newDone.wait(timeout: .now() + 0.05) == .timedOut, "Writer cannot enter compare/delete transaction")
release.signal()
check(oldDone.wait(timeout: .now() + 3) == .success, "Old cleanup completes")
check(newDone.wait(timeout: .now() + 3) == .success, "New writer completes after unlock")
DirectSessionStore.beforeFinishForTesting = nil
check(DirectSessionStore.session()?.id == next.id, "New credentials survive forced interleaving")
check(DirectSessionStore.status()?.sessionID == next.id && DirectSessionStore.status()?.state == "broadcasting", "New live status survives forced interleaving")

DirectSessionStore.finishSession(matching: next.id, message: "Current stopped", frames: 5)
check(DirectSessionStore.session() == nil, "Current session cleanup removes only ephemeral session")
check(DirectSessionStore.status()?.sessionID == next.id && DirectSessionStore.status()?.state == "stopped", "Terminal acknowledgement retains matching identity")
DirectSessionStore.setStatus(live(old))
check(DirectSessionStore.status()?.sessionID == next.id, "Old publisher cannot revive a terminal session")
print("Session-store native concurrency acceptance: \(failures) failures. Synthetic local files only; not iOS runtime proof.")
if failures > 0 { exit(1) }
