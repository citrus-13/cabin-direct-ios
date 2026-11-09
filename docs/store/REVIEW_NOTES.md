# Reviewer instructions — 0.8.0 draft, not submitted

Supply a real review contact and an authorized way to assess vehicle-dependent functionality before submission. The proposed Candidate Notes below are bounded for the 4,000-byte field; the surrounding maintainer notes are not part of that field. Prior releases/simulator captures do not validate this build. No account changes or external submission are authorized here.

## Candidate Notes

Cabin Direct offers two mutually exclusive Home modes: Lyrics (歌词) and Screen Sharing (投屏), plus Settings (设置). UI is Simplified Chinese. Nothing starts on launch, tab selection or VIN typing. No app login, Tesla cloud/OAuth, paid API or microphone is used for BLE lyrics.

Use a correctly signed iPhone, trusted reachable Wi-Fi/hotspot, local-network permission and a user-owned browser. Local HTTP is unencrypted; do not expose it publicly. Full lyrics review also requires an authorized parked Tesla, Bluetooth access, supported firmware and internet access for LRCLIB. Screen mode alone can be tested without a Tesla; it does not validate BLE functionality.

1. Lyrics: enter the vehicle's 17-character VIN, then choose 配对 Tesla. A separate confirmation explains Monitor enrollment. Monitor grants broader read-only vehicle authority than media; Cabin's request allowlist reads media only, not location, unlock, start or playback controls. Confirming may create a key in the host's default Keychain (no shared vehicle-key group). Follow vehicle keycard/NFC instructions if required. Request sent is not accepted enrollment.
2. Tap 开始歌词 and separately consent to current-track title/artist/duration lookup via LRCLIB. Start uses an existing key; it does not silently enroll. VIN persists only after explicit valid pairing/start, and neither VIN nor keys goes to LRCLIB or the webpage. No ReplayKit, Shazam, audio stream or recording is used by this mode.
3. Use the displayed local URL and separate six-digit web code within 120 seconds; five wrong attempts apply. A preview address before start is not a listener. The fixed entry remembers only a confirmed local address and does not relay media. Web pairing is separate from vehicle enrollment.
4. Lyrics stays foreground-only. Start temporarily keeps the screen awake; stop restores the prior idle-timer setting. Backgrounding stops BLE, lyric work and the listener; returning never restarts them. Known pause freezes progress; seeks/track changes reset it. Unknown playback/position does not scroll, and six-second stale metadata is hidden. Firmware units, source availability and lyric versions need actual verification.
5. Stop Lyrics before changing mode. Screen Sharing: tap 开始投屏, accept the notice and personally operate the real iOS broadcast picker. Share permitted, non-sensitive content. System-permitted app audio/video goes to the paired browser; enable sound explicitly if needed, with silent JPEG fallback. Optional OCR is on-device. Screen Shazam and lyric lookup remain separate default-OFF settings using audioApp, never audioMic. Manual/Shortcut import fills a draft without enabling lookup or capture.
6. Stop Screen Sharing via the app or iOS recording controls. Backgrounding the host does not itself stop ReplayKit. Stale heartbeat/UI recovery does not prove capture ended. Network changes require explicit restart and web pairing.

Settings contains Privacy/About, not diagnostic exports. No DRM bypass, CarPlay integration, universal source/vehicle compatibility or lock-screen lyrics guarantee is claimed. Removing Cabin's vehicle key revokes enrollment; ordinary session stop does not. Publisher/contact, content rights, final privacy labels and full phone/car evidence must be resolved before submission.

## Maintainer gate

Validate the exact signed app/extension, Monitor grant, enrollment flow, firmware media units/coverage, request/response authentication, host Keychain, privacy manifests, provider traffic, lifecycle and screen fallback. Reference [music acceptance](../MUSIC.md#evidence-and-acceptance) and [readiness](../APP_STORE_READINESS.md). Offline fixtures are not signed-device or vehicle proof.

Candidate notes do not establish review accessibility or minimum functionality acceptance. Provide legitimate authorized reviewer resources rather than claiming a second browser reproduces every feature. No private credentials, real VIN or vehicle key belongs in these public notes. Final export, rights, publisher and submission decisions remain open.
