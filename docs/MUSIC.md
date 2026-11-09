# Music and lyrics — 0.8.0 Tesla BLE development

Current development separates **歌词** (foreground vehicle-metadata lyrics) from **投屏** (ReplayKit). Neither starts automatically. Opening Cabin, changing tabs, typing a VIN or selecting Lyrics does not enroll a vehicle, access its key, read media, request lyrics or start a listener. The UI is a start/stop and connection flow, not a diagnostic dashboard.

## Explicit choices and data flow

1. Enter the vehicle's 17-character VIN. Typing alone is a draft; a valid VIN is saved locally only after explicit pairing or start consent.
2. First-time **配对 Tesla** has its own confirmation. Only that action may create a host-local key and send a Monitor enrollment request. The vehicle may require keycard/NFC confirmation. A request being sent is not enrollment success.
3. **开始歌词** separately asks for per-session consent to obtain lyrics for current tracks using their title, artist and duration. Start requires an existing vehicle key; it never silently creates or enrolls one.
4. Authenticated BLE media fields supply title, artist, duration, position and playback state when the vehicle exposes them. LRCLIB receives current-track title/artist/duration, not VIN, vehicle keys, location, account credentials, audio or screenshots. Providers still receive ordinary connection metadata such as IP address.
5. The paired local browser receives bounded current song/lyric state, never screen frames, OCR, raw VIN, vehicle keys or an audio stream in this mode.

The vehicle grants read-only **Monitor** authorization, broader than media information. Cabin's request allowlist only exposes media reads, not location, unlocking, starting or other vehicle-control commands. This distinction must remain visible at enrollment. There is no Tesla cloud/OAuth/Fleet API, paid API key or membership purchase in this route.

Keys are stored through the host's default Keychain with `accessGroup: nil`. They are not shared with ReplayKit or written to project files. Normal stop does not revoke the enrolled vehicle key; remove Cabin's key in the vehicle to revoke authorization. Keys and VIN must never be included in public reports.

## Foreground lifecycle and timing

Keep Cabin foregrounded while parked. There are no microphone or background-mode permissions, no acoustic input, no audio session/keepalive for lyrics and no lock-screen continuity promise. A user-started foreground lyrics session temporarily keeps the display awake; stop restores the previous idle-timer setting.

Entering background stops the BLE reader, lyric work and local listener. Returning to Cabin never starts them again. Explicit stop, network change, expiry or terminal failure also ends the session; wait for cleanup before restarting. This does not stop an independently running ReplayKit extension.

Authenticated state drives the lyric clock. Known pause freezes progression; valid seek and track changes reset the relevant clock/results. Unknown playback state or position does not invent scrolling. Metadata older than six seconds is hidden. This conservative behavior is covered only by offline fixtures so far: real firmware enum meanings, position/duration units, optional fields, source coverage and update cadence still need physical checks.

An exact title match is not proof of the recording version. Missing, instrumental, untimed or mismatched lyrics remain honest unavailable/candidate states. No exact word synchronization or universal music-platform support is claimed.

## Separate screen-mode music

Screen music remains default OFF. Optional ShazamKit recognition uses only ReplayKit `audioApp`, never `audioMic`; optional LRCLIB access is a separate opt-in. Recognition-only does not authorize lyric lookup. Screen sharing can relay system-permitted app audio as AAC alongside video to the local receiver; this does not make BLE lyrics an audio relay.

Manual/Shortcut import fills title/artist/estimated position as a draft and leaves lyric networking OFF. It starts no capture or lookup. That route cannot observe another app's real pause/seek/change state and is not an automatic fallback from BLE. Example original fixture:

```text
cabin-direct://track?title=Original%20Fixture&artist=Cabin%20Test&position=0
```

Shazam service admission/free signing remains a separate unverified screen-mode gate. A compile or Apple's own Shazam app does not establish Cabin admission. Do not fabricate a Shazam entitlement or buy membership as an automatic fallback.

## Network, retention and rights

Local HTTP is unencrypted. Use only a trusted network, never expose the listener publicly, and distinguish the webpage's short-lived pairing code from persistent vehicle enrollment. Lyrics-session credentials stay in host memory; screen sessions use their separate App Group coordination. Current-track lyric data is transient, not a downloaded library. Receivers may copy what they display; Cabin cannot revoke their copies or promise forensic erasure.

LRCLIB lookup is bounded and current-track-only under explicit consent; no bulk download or copyrighted song/lyric fixture is included. Free API access and Apache-2.0 source licensing do not grant third-party lyric display rights. Validate provider terms, territorial rights, privacy disclosures and the exact signed binary before distribution.

## Evidence and acceptance

The integration record reports **46 local offline protocol/clock checks passed** with public/synthetic fixtures and no vehicle access. At this documentation update, exact 0.8.0 iOS/cloud compilation and Simulator UI results are pending. None of these substitutes for a phone/car test.

- [ ] Compile the exact 0.8.0 host/extension and run the safe UI suite; confirm cancellation never requests Bluetooth, reads/creates keys or starts networking.
- [ ] Independently sign/install on the authorized phone; verify default host Keychain behavior without shared vehicle-key entitlement.
- [ ] With a parked authorized Tesla, verify Monitor enrollment, keycard/NFC flow, denied/rejected/expired requests and honest request-versus-success status.
- [ ] Verify actual firmware grants the required media reads under Monitor; check authenticated response handling and duration/position units.
- [ ] Check multiple music sources: vehicle-native services and phone Bluetooth playback where available. Missing fields must stay unknown, not inferred as universal support.
- [ ] Verify pause, resume, seek, rapid track changes, missing/untimed lyrics, six-second staleness, BLE disconnect/reconnect and no stale lyric carryover.
- [ ] Verify background, lock, calls, network change, expiry, explicit stop/restart and idle-timer restoration; no automatic restart or background guarantee.
- [ ] Confirm VIN/keys/location never reach the webpage, LRCLIB, logs or extension; audit network opt-in and local permission denial.
- [ ] Recheck optional screen Shazam/lyrics OFF-by-default, `audioApp`-only input, real ReplayKit controls and independent stop behavior.
- [ ] Resolve publisher/contact, final privacy labels, lyric rights and explicit publication authority separately.

### Historical evidence — not 0.8.0 acceptance

[v0.5.0-preview.1](https://github.com/citrus-13/cabin-direct-ios/releases/tag/v0.5.0-preview.1), source `4ec061dd1ca1399763a4ad36076af98932b1a664`, has a recorded [iOS Release compilation and 239-test run](https://github.com/citrus-13/cabin-direct-ios/actions/runs/42476798870). Its 640,918-byte IPA and metadata signatures were independently checked in that earlier work (SHA-256 `9b6ccdf50c14128cf8220774bad74be65f55150db84df4d17f51b1f922cb3065`). It contains optional broadcast music, not this BLE lyrics integration, and still requires personal signing. Earlier 0.6/0.7 microphone/background designs are superseded; their source does not validate the present route.

### Reference materials

Protocol provenance and pinned upstream references are in [TeslaBLE provenance](../ios/TeslaBLE/PROVENANCE.md). [LRCLIB documentation](https://lrclib.net/docs), [Apple ShazamKit](https://developer.apple.com/documentation/shazamkit) and [ReplayKit](https://developer.apple.com/documentation/replaykit) are reference links, not refreshed service, rights or hardware evidence in this documentation-only update.
