# Cabin Direct — privacy statement draft

**Draft for the 0.8.0 development target, not a finalized privacy policy or approved App Store label.** Covers foreground Tesla BLE lyrics and separate ReplayKit screen sharing, not legacy Node/WebRTC tools. Prior 0.5.0 binary checks and superseded 0.6/0.7 microphone designs do not validate this integration. Publisher identity, contact, effective date, final URLs and jurisdiction-appropriate disclosures remain unresolved. Verify the exact final signed binary and traffic before distribution.

## Explicit vehicle enrollment and lyrics

Opening Cabin, selecting a mode or editing a VIN does not read/enroll a vehicle, access keys or start lyric networking. VIN is saved in local host preferences only following explicit valid pairing/start consent.

**Pair Tesla** requires its own confirmation before creating a host key if needed and requesting enrollment. The Tesla role is read-only **Monitor**, broader than media-only authority. Cabin's request allowlist is limited to authenticated media reads; it does not request location or issue unlock, start, playback-control or other vehicle-control commands. Vehicle keycard/NFC confirmation may be required. Request sent does not prove accepted enrollment.

Keys use the host's default Keychain with `accessGroup: nil`, not a shared vehicle-key group. The ReplayKit extension does not receive vehicle keys. There is no Tesla cloud/OAuth login, Fleet API or paid Tesla service. VIN and keys are not placed in webpage state, URLs, provider requests or application diagnostic logs. Stopping a session does not delete/revoke the enrolled vehicle key; removing Cabin's key in the vehicle revokes that vehicle authorization.

**Start Lyrics** has separate per-session consent. It reads the vehicle's media title, artist, duration, position and playback state when available and uses current-track title/artist/duration to obtain lyrics through LRCLIB. No microphone, acoustic recognition, screen recording, audio files or audio stream is used by this mode. LRCLIB receives the request and ordinary connection metadata such as IP address, not VIN, vehicle keys, location, music-account credentials, raw audio or screenshots.

Unknown position/playback does not produce invented scrolling. Known pause freezes progress; seek and track updates reset results as appropriate. Metadata older than six seconds is hidden. These source/offline safeguards do not establish actual firmware field meanings, timing units or universal source coverage.

## Separate screen sharing

Capture starts through the user's genuine iOS broadcast action, not automatically. The guided path saves validated settings and presents a notice before the system picker; Control Center can also start an already configured extension. Screens may expose notifications/private information. Use only permitted, non-sensitive content; protected/DRM content is not bypassed.

Default screen sharing has no developer cloud relay, analytics, advertising, remote OCR or lyric lookup. Optional screen recognition and LRCLIB access remain separate default-OFF choices. ShazamKit recognition accepts ReplayKit app audio, never microphone buffers, and sends signatures to Apple/Shazam. Screen lyric opt-in sends current-track metadata to LRCLIB. Neither receives raw audio/screens. Failure does not switch to microphone or a paid service.

System-permitted app audio may separately be encoded as AAC with H.264 video for the paired local receiver. Browser playback may require an explicit sound action; JPEG fallback is silent. Optional visible-region OCR uses on-device Vision and may be wrong or delayed. It reads visible pixels, not music accounts/background playback.

## Local receiver and fixed entry

The host serves bounded current media/lyric state to the browser paired on a trusted network. Only screen mode adds video/audio, fallback frames or optional OCR. Browser assets contain no remote fonts, analytics or provider trackers.

**HTTP is unencrypted.** Web pairing controls access, not confidentiality against network observers. Do not expose the listener publicly or share codes with untrusted people. A receiver can save displayed content; Cabin cannot revoke its copies or guarantee forensic erasure. Interface/address changes stop the session and require explicit restart/web pairing. Cabin does not change network/VPN settings.

The optional GitHub Pages fixed entry serves a static launcher, not media, a VIN directory or phone discovery. It stores an explicitly confirmed local address/navigation preference in that browser's localStorage; Forget removes it. It stores no vehicle key, VIN, pairing code or media. GitHub may receive ordinary website access metadata including IP address under its own practices. Direct local URLs remain available without the public launcher.

## Local storage and retention

- **Vehicle preferences/keys:** explicit-action VIN persistence in host preferences; host-default Keychain vehicle key is persistent and separate from webpage sessions. Not shared with the extension.
- **Lyrics:** bounded current-track metadata/lines in memory, not a lyric download library. Stop clears runtime work; missing/stale data is hidden. No copyrighted lyric fixtures are bundled.
- **Screen/audio/OCR:** bounded in-memory encoding/playback buffers and short fragment history, not intentional recording files or OCR archives.
- **Lyrics web credentials:** random token, six-digit code and session configuration remain in host memory, not the broadcast shared session file. Stop/expiry ends access; maximum session lifetime is eight hours.
- **Broadcast credentials:** private App Group configuration/session files coordinate host and extension. Normal completed stop removes matching credentials; expiry remains enforceable if forced termination prevents cleanup.
- **Other preferences/status:** screen options, OCR region, port, manual track/offset and screen consent choices may persist. Independent lyrics consent does not overwrite them. Manual/Shortcut import creates a draft with lyric networking OFF and starts nothing.
- **Web pairing:** successful pairing sets a local HttpOnly same-site cookie no longer valid than its source session; initial pairing allows 120 seconds and five wrong attempts. Disconnect tries to delete the cookie; source stop/expiry invalidates access even if deletion is unconfirmed.
- **Clipboard:** explicit Copy alone writes a local-only item with 120-second expiry. iOS and other local apps control/read clipboard access.
- **Diagnostics:** no automatic diagnostic uploads or user-facing diagnostic export. This does not mean consented LRCLIB or optional screen Shazam requests stay on device.

## Foreground lifecycle and stopping

Lyrics declares no background modes and uses no microphone or silent audio keepalive. A user-started foreground session temporarily keeps the display awake and restores the prior idle-timer setting on stop. Entering background stops BLE reading, lyric work and the local listener; returning does not restart them. No lock-screen/background continuity is promised.

Explicit stop, terminal failure, expiry or relevant network change ends the session and awaits cleanup before restart. Missing songs/lyrics remain honest unavailable states. Playback on the vehicle's original source is not controlled.

Backgrounding the host does not itself stop a real ReplayKit extension. Screen stop waits for matching cleanup, or users can end capture via iOS controls. A stale heartbeat or released UI wait is not proof of termination.

## Permissions, rights and remaining verification

The host needs Bluetooth for explicit vehicle operations and local-network access for its receiver. It requests no microphone/background permission and no shared vehicle-Keychain entitlement. Screen sharing uses user-operated ReplayKit. Optional Shazam admission remains a separate signed-app/service gate.

Source privacy manifests are declarations, not finalized App Store privacy labels. Re-audit elapsed-time API reasons, final dependencies, provider practices and exact binary/traffic before completing [App Store privacy disclosures](https://developer.apple.com/app-store/app-privacy-details/) or [required-reason API declarations](https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api). Reference links are not a fresh compliance determination.

The integration record reports 46 offline protocol/clock checks passed; exact 0.8.0 iOS/cloud/UI and physical phone/car checks are pending at this update. Verify actual Monitor permissions, enrollment, firmware/units, source metadata coverage, lifecycle and data boundaries on authorized hardware. API access and Apache-2.0 do not license third-party lyrics. No installation, App Store approval, exact synchronization or universal compatibility is claimed.
