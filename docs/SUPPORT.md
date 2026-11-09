# Cabin Direct — help and support preparation

This is self-help for the **0.8.0 development target**, not a staffed support service, installed-release announcement or finalized App Store Support URL. Publisher/contact remain unconfirmed. Older downloads do not acquire new BLE functionality through these instructions; check the actual app/build first.

## Tesla lyrics — first use

1. Park safely, keep Cabin in the foreground and allow the phone to be near your authorized Tesla.
2. Open **首页 → 歌词** and enter its 17-character VIN (ASCII letters/digits, excluding I/O/Q). Typing alone neither saves the VIN nor contacts a vehicle.
3. Choose **配对 Tesla** and read the separate confirmation. Only confirming creates a host-local key if needed and requests read-only Monitor enrollment. Monitor's vehicle-granted scope is broader than media; Cabin requests only media fields, not location or vehicle controls. Follow the vehicle's keycard/NFC instructions if required.
4. Wait for the actual status. Request sent is not proof of vehicle acceptance. Do not repeatedly enroll while a request is pending.
5. Choose **开始歌词** and separately consent to LRCLIB lookup using current-track title, artist and duration. This reads authenticated vehicle media data without microphone, screen recording, Tesla login/cloud/OAuth or a paid API.

The VIN can also be edited under **设置 → 车辆与配对** when idle. VIN persistence occurs only after explicit valid pairing/start consent. Vehicle keys stay in the host's default Keychain, not the broadcast extension. Remove Cabin's key in the vehicle to revoke authorization; stopping lyrics does not revoke enrollment.

## Screen sharing remains separate

Use **首页 → 投屏 → 开始投屏**, review the notice and personally start the iOS broadcast picker. Display only permitted, non-sensitive content. Optional screen recognition/lyrics are separate default-OFF settings using ReplayKit app audio, never microphone input. Manual/Shortcut imports fill a draft without granting lyric access or starting capture.

The modes are mutually exclusive. Selecting a tab/mode alone starts nothing. Settings also contains screen OCR, privacy and About. No purchase, subscription, paid fallback, VPN change or account upgrade is authorized by troubleshooting.

## Connect the lyric or screen webpage

Use a trusted Wi-Fi/hotspot. Connect the receiver to this iPhone's hotspot, or put both devices on the same network. Guest isolation, VPN routing and browser rules can prevent access; the same network name is not proof of reachability.

The fixed entry `https://citrus-13.github.io/cabin-direct-ios/` remembers only an address you confirm. Cancel navigation or use `?setup=1` to edit, and Forget to clear it. It does not discover changed addresses, bypass pairing or relay media. Direct local phone URLs remain an alternative if public-page access fails.

A preview address before start is not a live listener. After starting, use the current address and separate six-digit **web pairing code** within 120 seconds; five wrong attempts are allowed. This code is not your Tesla vehicle key. Network/address changes end the session; inspect the trusted network and explicitly start/web-pair again. **Local HTTP is unencrypted**: never expose the listener publicly.

## Playback and stopping

Lyrics follows media information the vehicle actually provides. Unknown playback state/position does not scroll. Known pause freezes progress, seek/track updates reset it, and metadata older than six seconds is hidden. Missing lyrics or a different recording version may prevent matching or accurate timing.

Keep Cabin foregrounded. It temporarily keeps the display awake only during a user-started foreground lyric session and restores the previous setting on stop. Moving to background stops that session; returning does not restart it. No background or lock-screen continuity is promised. Stop ends BLE reading, lyric work and the local listener, not the vehicle's original music playback.

Screen sharing is different: backgrounding the host does not itself stop the ReplayKit extension. Use Stop Screen Sharing or iOS recording controls. A heartbeat timeout or released UI wait is not confirmed capture termination.

## Common problems

| Symptom | Safe check |
| --- | --- |
| Pair button disabled | Check the 17-character VIN and that no lyrics, pairing or broadcast operation is busy. |
| Vehicle request sent, no success | Check the actual vehicle confirmation/keycard/NFC flow while parked. Request delivery is not enrollment. Do not infer accepted permissions. |
| No vehicle media | Check Bluetooth permission/range, existing enrollment and actual vehicle support. Monitor media access, firmware and music-source coverage remain physical acceptance gates. |
| No page/address | Join a trusted network, check local-network permission and explicitly start. A preview address is not a listener. |
| Web code expired | Restart the webpage session instead of guessing; vehicle enrollment is separate and need not be repeated solely for an expired web code. |
| Lyrics freeze or disappear | Unknown/stale metadata is intentionally not extrapolated. Check actual song data, BLE connection and foreground state. |
| Wrong lyrics/timing | A candidate recording may differ or have no timed lyrics. Do not assume exact synchronization or universal platform support. |
| Lyrics stop on leaving/locking | Expected foreground-only lifecycle. Return to Cabin and explicitly start when ready. |
| Optional screen recognition unavailable | Service/signing/network admission can fail. No purchase or invented entitlement is a supported fallback. |
| Black/no screen image | Expected in Lyrics mode. For Screen mode, check real recording state and content permission; DRM is not bypassed. |
| Screen stop waits | Check/end capture with iOS recording controls; UI recovery alone does not prove termination. |
| Installation expired | Personal signing is separate and time-limited; see [signing guidance](INSTALL.md). Do not buy anything automatically. |

## Data and evidence

The app has no automatic diagnostic upload or home diagnostic dashboard. LRCLIB receives consented current-track metadata; optional screen Shazam receives audio signatures. Neither receives VIN, vehicle keys, raw audio or screenshots. BLE lyrics relays no audio; screen mode may relay permitted H.264/AAC with an explicit browser sound button and picture-only fallback.

Report only app/build/iOS/browser/vehicle firmware versions and non-sensitive reproduction steps through an authorized channel. Do not post VIN, keys, pairing codes/tokens, private screens, profiles, Apple credentials or device identifiers.

At this update, 46 local offline protocol/clock checks are reported passed; exact 0.8.0 iOS/cloud/UI checks and real phone/parked-car acceptance remain pending. No simulator, successful compilation or prior release establishes installation, vehicle compatibility or App Store approval. Publisher identity/contact, final URLs, privacy labels and lyric rights remain separate submission gates.
