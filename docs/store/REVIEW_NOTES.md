# Reviewer instructions — draft, not submitted

Keep the candidate Notes below within Apple's 4,000-byte field. Supply a real review contact in App Store Connect separately, not in public source.

Current-source gate: these candidate Notes describe the simplified 0.5.1 interface and optional music choices but are not ready for submission. Review the [experimental music scope and exact-build evidence](../MUSIC.md). The tagged 0.5.0 preview passed compilation/tests; that does not validate a later revision. Provider/lyric rights, service access and real-device evidence remain pending. Earlier 0.4.0 preview.3 does not contain the new mode.

## Candidate Notes

Cabin Direct is an iPhone-local screen companion with a ReplayKit broadcast upload extension. It requires no app login, vehicle account, developer cloud, paid API or music-service account. Its UI is Simplified Chinese. Audio stays with the original player/audio route.

Requirements: a correctly signed iPhone installation, local-network permission, trusted Wi-Fi/hotspot and a second user-owned device with a reachable web browser. Do not use a public network: local HTTP is unencrypted. Receiver assets are bundled in the app.

1. Connect both devices to a trusted, mutually reachable network. Open the default Share tab (投屏).
2. Tap 开始投屏. Settings are validated and saved, then a short sharing notice appears. Acknowledge it and personally operate the genuine iOS broadcast picker to confirm Cabin Direct. Capture is never started programmatically. iOS Control Center can also explicitly start its configured extension.
3. Return to read the current address/code. On the second device, open that URL and enter the separate six-digit code within 120 seconds; five wrong attempts are allowed. Display your own non-sensitive permitted content. Optional OCR reads only the selected visible region on device. Backgrounding the main app does not itself end a real broadcast.
4. Stop through the app or iOS recording controls. Matching-session cleanup is acknowledged internally; heartbeat expiry alone is not stop confirmation. A changed network/address set ends the session; restart/re-pair manually.
5. Settings (设置) contains default-OFF music. Opt-in recognition converts usable ReplayKit app audio to fingerprints for Apple/Shazam, without microphone input, recording or audio relay. A separate opt-in sends title/artist to LRCLIB for candidate timed lyrics, kept for the current track in memory. Recording version is unverified; timing is estimated, not live pause/seek state. Free-team Shazam App Service access is unproven. On failure use manual/Shortcut draft input; importing leaves lyric access OFF and starts no capture. No paid upgrade or silent-audio keepalive is used.

Settings contains Privacy and About. Diagnostic pages, exports and the original sample are not in the 0.5.1 interface; no diagnostic is uploaded automatically. Screens, notifications and receiver copies can be sensitive.

No DRM bypass, universal music-platform/locked-screen guarantee, CarPlay integration or vehicle control is included. A Tesla is not needed for the second-browser procedure; actual vehicle/firmware compatibility is separate.

## Maintainer gate

These instructions are proposed, not hardware proof. Do not submit a developer preview as a finished app. Validate the exact signed app/extension and review resources. The sample does not guarantee minimum-functionality acceptance; Apple's review is a separate outcome.
