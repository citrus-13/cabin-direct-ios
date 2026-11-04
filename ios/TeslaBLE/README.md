# TeslaBLE — experimental native, media-only protocol client

This package implements Tesla's authenticated Infotainment `getMediaState` and
`getMediaDetailState` requests, not just Bluetooth discovery. It has no network
service, account, SDK download or external package dependency. CryptoKit supplies
P-256 ECDH, SHA-1/SHA-256, HMAC-SHA256 and AES-GCM; no custom cryptographic primitive
is implemented.

## Verification status (2026-11-04)

- **Passed:** native macOS build with Apple Swift 6.3.2 and the installed Command
  Line Tools SDK, including the CoreBluetooth transport implementation and client
  connection code (compiled, never executed against Bluetooth).
- **Passed:** 36 native offline check cases, including exact official public ECDH,
  session-HMAC, metadata/AES-GCM and advertisement vectors; official ECDH
  leading-zero fixture; synthesized read-only encrypted request/response and
  negative association/replay/tamper/overflow/truncation tests.
- **Passed, syntax only:** iOS conditional-source parsing using
  `swiftc -frontend -parse -target arm64-apple-ios16.0`. The tool warns that the
  available sysroot is macOS. This is **not** an iOS build or link check.
- **Unavailable here:** XCTest (`no such module XCTest` in Command Line Tools),
  full Xcode/iOS SDK, signing, shared Keychain entitlement/provisioning,
  Bluetooth permission/device testing, Vehicle Monitor enrollment/NFC approval,
  actual media availability/units, and CoreBluetooth operation from a ReplayKit
  upload extension. The native checks are an explicitly labelled command-line
  assertion runner, not XCTest.
- No private production key was created, no Keychain item was read/written by
  checks, no CBCentralManager was instantiated, no scan or vehicle action was
  performed. All test private scalars are intentionally public upstream fixtures.

Do not label this package operational on iPhone or a Tesla until those device
checks pass. No fabricated track or success fallback exists.

## Public API and lifecycle

```swift
let store = TeslaKeyStore(
    accessGroup: provisionedKeychainAccessGroup,
    tag: "tesla-media.\(vin)"
)
let reader = NativeTeslaMediaClient(
    vin: vin,
    keyStore: store,
    timeUnit: .milliseconds, // Explicit setting; verify against actual vehicle.
    onStatus: { status in /* Status only; not proof of enrollment. */ },
    onMedia: { track in /* title/artist/duration/position/playing may be nil. */ }
)
reader.startReading() // Existing Keychain key required; never generates a key.
reader.stop()
```

`TeslaMediaTrack.duration` and `.position` are seconds after conversion using the
mandatory `.milliseconds` or `.seconds` setting. `observedAt` is Unix seconds at
authenticated receipt, **not** a claim of exact vehicle playback latency.
Missing numeric or playback values remain `nil`, not zero or false. Unknown
playback enum values, negative/overflowing timing and absent media are rejected.
No stale fields are merged from an earlier response. Callbacks execute on the
client's private serial queue; dispatch UI updates to the main actor.

The active broadcast reader should own the client and call `stop()` on pause/end.
The app may create a separate client with `allowEnrollment: true` **only for a
fresh user-confirmed enrollment action**, then call
`enrollMonitorKeyExplicitly()`. That path creates a new P-256 key only if none
exists, stores it in Keychain, and sends the official NFC-present-key envelope
with `ROLE_VEHICLE_MONITOR = 5` and iOS form factor `6`. The default client cannot
enroll. There is no owner/driver fallback, removal operation or key overwrite.

Enrollment transmission is not approval: status
`enrollment_request_sent_confirm_with_nfc_and_vehicle_ui_not_yet_verified` only
means all Bluetooth writes were acknowledged. The user must still approve with
their NFC card and the vehicle UI. An existing local key (`try store.hasKey()`)
does not establish that the vehicle enrolled it. Only a subsequent authenticated
session and successfully decrypted media response establish those stages.

Both executing targets need appropriate Bluetooth usage descriptions. Shared
Keychain storage requires a separately provisioned **Keychain access group**;
App Groups alone do not share keys. Read `TCKeychainAccessGroup` from the host's
configuration and pass it through; do not substitute an App Group identifier.
Use a VIN-specific tag consistently in app and extension. Keys use
`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`, are non-synchronizing, and
have no public export API. These are Keychain-backed software keys, not a claim
of Secure Enclave/nonextractable hardware storage. The package never logs raw
errors, VINs, keys or protocol bytes.

## Protocol/security boundaries

- Exact outgoing media allowlist is
  `Action(2) → VehicleAction.getVehicleData(1) → {getMediaState(15), getMediaDetailState(16)}`.
  VehicleAction fields 15/16 themselves are **write commands** and are rejected.
  There is no arbitrary-command public API. Explicit enrollment is the only
  separate non-read operation.
- Session info is challenge/UUID-associated, routing/domain checked, verified
  using the official HMAC, and accepted only within five monotonic seconds of
  the request. Resynchronization verifies the same remote public key, refuses
  same-epoch clock rollback and never decreases the same-epoch counter.
- Command TTL is five domain-clock seconds, UUID/routing identifiers and AES-GCM
  nonces come from system CSPRNG, counters cannot wrap. Session state is never
  written to disk and every client start requires a fresh handshake.
- Requests set `FLAG_ENCRYPT_RESPONSE` to **2**, not 1. Responses must contain
  AES-GCM response authentication: old-firmware plaintext fallback is refused.
  Response metadata authenticates the VIN/domain/counter/flags/request-tag/fault.
  Each media request permits one final response; consuming its UUID rejects all
  further responses/counters for that request. Wrong requests and unsolicited
  frames fail closed. There is no automatic reconnect/retry or privilege change.
- Tesla's session HMAC protects the integrity of session information relative
  to the supplied ECDH vehicle public key. Per the official specification, it
  does not by itself certify vehicle identity. There is no independent vehicle
  certificate verification or across-connection vehicle-key pinning in this
  implementation; the remote key is fixed within an active session.
- Vehicle Monitor is a vehicle-level read role, **not a vehicle-enforced
  media-only scope**. The package's own action allowlist is narrower. Vehicle
  firmware support, read permissions and media fields must be checked on-device.
- Maximum message is 1,024 bytes. Protobuf parsing bounds fields and lengths,
  rejects duplicates of consumed singular fields and ambiguous oneofs, validates
  wire types, UTF-8, fixed/varint integer widths, and detects truncation/overflow.
  Larger legitimate media replies fail closed rather than increasing the cap.
- BLE uses official 0211 service, 0212 writes **with response**, 0213 notifications,
  exact VIN-derived advertised-name filtering, two-byte big-endian framing and
  negotiated write chunk size. Connection deadline is 20 seconds; write and
  request deadlines are five seconds; stale partial fragments reset after one
  second. Polling waits two seconds after a successful media response. No wake,
  lock, start, charging, volume, playback or other control command exists.

## Re-run offline checks

Use existing project storage; scratch/cache must remain in the session `tmp/`.
From the repository root, set `SESSION_TMP` to this conversation's canonical tmp
path and run (no dependency download is required):

```sh
TMPDIR="$SESSION_TMP" swift run --package-path ios/TeslaBLE \
  --scratch-path "$SESSION_TMP/swift-teslable-build" \
  --cache-path "$SESSION_TMP/swift-teslable-cache" \
  --disable-sandbox TeslaBLEOfflineChecks
```

The runner is a debug-only `@testable` target; production builds consume the
`TeslaBLE` library product, never its public-fixture executable. To build only
the production module in release mode, use `swift build -c release --target
TeslaBLE` with the same scratch/cache options. Do not enroll any key from tests.

See [PROVENANCE.md](PROVENANCE.md) for exact pinned sources and licensing.
