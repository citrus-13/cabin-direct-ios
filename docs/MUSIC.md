# Music and lyrics — independent lyrics retained in 0.7.0, device acceptance pending

Current source separates **歌词** (independent acoustic recognition) from **投屏** (ReplayKit). These modes are mutually exclusive and neither starts automatically. Selecting Lyrics does not request microphone permission or open a server; the user must explicitly start and accept the per-session notice. Settings remain a secondary page, not a diagnostics dashboard.

Historical binary evidence only: [v0.5.0-preview.1](https://github.com/citrus-13/cabin-direct-ios/releases/tag/v0.5.0-preview.1), released 2026-11-08 from `4ec061dd1ca1399763a4ad36076af98932b1a664`. [The complete cloud run](https://github.com/citrus-13/cabin-direct-ios/actions/runs/42476798870) passed actual iOS Release compilation and 239 tests, zero failed/skipped. The downloaded 640,918-byte IPA, both executable hashes and identity-free metadata signatures were checked independently; the extension links ShazamKit. SHA-256: `9b6ccdf50c14128cf8220774bad74be65f55150db84df4d17f51b1f922cb3065`. The package still requires personal signing. Source/compile evidence is not Shazam service admission, actual recognition, phone installation, Tesla acceptance or App Store approval. Earlier 0.4.0 preview.3/preview.2 do not contain this music mode. Later documentation and legacy-target isolation maintenance does not change this tagged binary.

That historical result does not validate 0.6.0 microphone capture, its background audio declaration or the new host listener. No 0.6.0 signed-device, free-service-admission or vehicle result is established by this document.

## Explicit choices and data flow

| Mode/choice | Processing and recipient | Boundary |
| --- | --- | --- |
| Independent Lyrics | After per-session recognition/lyric consent and iOS microphone permission, the host listens to audible music with its built-in microphone. ShazamKit sends a signature to Apple/Shazam; matched title/artist go to LRCLIB for current-track lyrics. | No ReplayKit, screen frames/OCR, private Now Playing access, audio files or raw-audio upload. |
| Screen music OFF | No recognition or external lyric lookup. Optional visible-region OCR is separate and on-device. | No microphone or background-player discovery. |
| Screen app-audio recognition | Only an explicitly user-started broadcast accepts usable ReplayKit `audioApp` buffers for ShazamKit signatures. | ReplayKit `audioMic` is discarded; no fallback to microphone, raw-audio relay, DRM bypass or guaranteed app coverage. |
| Screen manual / Shortcut track | User supplies title, artist and estimated starting position without fingerprint recognition. | No proof the track is actually playing; no real-time pause/seek/change notifications. |
| Screen LRCLIB opt-in | Separate default-OFF consent allows matched/manual title and artist to be sent to `https://lrclib.net`. | Importing a draft keeps this OFF and starts no capture or lookup. |

Independent Lyrics intentionally includes recognition and lyric retrieval in its visible per-session consent; it does not turn on or overwrite the saved screen-mode settings. The phone sends no music credentials, screen image or raw audio to LRCLIB. A client-identification header names Cabin and its public project. Both providers receive ordinary connection metadata such as IP address; consented recognition/lookup is not a wholly offline workflow.

The independent-lyrics browser gets bounded current metadata/lyric lines, never an audio stream. The separate 0.7.0 screen mode may relay system-permitted application audio as AAC with video; this does not turn acoustic lyrics into a broadcast. In independent Lyrics it gets no image frames or OCR at all. Local HTTP is unencrypted: use a trusted network and do not expose the listener publicly. Stop clears current runtime work; stale, paused or disconnected states hide old results. A receiver may independently copy displayed content, and Cabin cannot revoke copies or promise forensic memory erasure.

Audio buffers are transient recognition input, not stored recordings. Lyrics are retained for the current track in memory, not a disk cache or downloaded library. Manual title/artist/offset and saved screen consent choices may persist as settings, unlike fetched lyric text. Acoustic session credentials stay in host memory, separate from ReplayKit's App Group session.

## Acoustic routing, lifecycle and background limits

The host requests AVAudioEngine input with AVAudioSession `playAndRecord`, `mixWithOthers`, `allowBluetoothA2DP` and the built-in microphone. It does not request HFP voice input, duck the player or deliberately redirect playback to the phone speaker. These are implementation requests, not proof of the actual iPhone/car route. Test that the original player continues and that the actual input remains the phone microphone on the target hardware.

The app declares background audio for this genuine user-started microphone session. Listening may continue when leaving or locking Cabin until Stop or an interruption/failure; there is no silent-audio keepalive, unattended automatic start or automatic restart. Background/lock reliability is **unverified**, not guaranteed by the declaration. Explicit Stop stops microphone capture, cancels recognition/lyric work, clears results and waits for local listener cleanup. Calls, audio-route changes, network changes, expiry or terminal service failure can stop the session.

Acoustic recognition needs music actually audible near the iPhone. Muting speakers, headphone-only playback, noise, unsupported recordings or catalog gaps can prevent a match. Silence/no-match remains an honest waiting state; the user-started mode can retry after bounded cooldowns and can be stopped. A service error is terminal for the session, not permission for paid fallback.

The separate screen mode may continue through its already user-started ReplayKit extension after the host backgrounds. That is not microphone listening. ReplayKit can supply silence or no usable app audio, particularly for protected content. Sample callbacks alone do not prove recognition. No claim covers every platform, song, stream, live performance, cover or remix.

## Lyrics and timing

Shazam's matched offset plus elapsed time is an **estimate**, not another player's live transport state. Pauses, seeks and track changes can be invisible between recognition windows. The receiver requires a fresh music heartbeat and a recent match independently of screen-frame freshness; old recognition cannot be kept valid by merely refreshing a heartbeat. Manual timing is also bounded and cannot auto-follow another player.

The runtime queries lyrics with title/artist, without verified recording duration or album identity. A matching name is a **candidate version**, not proof the live/remastered/edited recording matches. Missing, mismatched, instrumental or untimed results stay unavailable/no-lyrics states, never fabricated content or promised exact word synchronization.

## No paid fallback; service admission remains unproven

No paid API key, paid backend or membership upgrade is built into either music path. This does **not** prove the current free Personal Team can access Shazam's global catalog. Apple's actual App ID ShazamKit **App Service** must be admitted and verified on the signed target phone. On service failure the acoustic host stops the microphone; screen mode stops recognition attempts for that session. Neither purchases anything or repeatedly changes signing.

Do not add `com.apple.developer.shazamkit`: Apple DTS identifies it as a nonexistent entitlement. App Service configuration is server-side. Signing, App Groups, installation, service admission and periodic free-signing renewal remain separate checks; see [free installation](FREE_INSTALL.md). Future App Store distribution has separate membership, rights and submission requirements and is not promised to cost zero.

The retained screen-mode manual/system-Shortcut route is not an automatic acoustic fallback. A user-controlled Recognize Music / Open URLs workflow may fill a draft:

```text
cabin-direct://track?title=Original%20Fixture&artist=Cabin%20Test&position=0
```

This is an original fixture, not a bundled song/lyric. Import keeps network lyric consent OFF, starts no capture, and supplies only an estimated offset. Review the screen settings, opt into LRCLIB if desired and explicitly start the broadcast. No signed/installable Shortcut or successful target-phone Shortcut test is supplied here. Apple's own Shazam app having internal/headphone features does not grant Cabin those capabilities.

## LRCLIB and content rights

LRCLIB documents free anonymous API access without a mandatory key. Identify the client, honor `429`/`Retry-After`, bound requests and never bulk-download a library. This work performs no provider registration or paid-service signup.

Free API access, open-source code and the repository's Apache-2.0 license **do not grant third-party lyric rights**. No third-party lyrics/artwork are bundled as examples. Verify provider terms and territorial display rights before distribution; a service-access letter is not proof of underlying lyric rights. Audit the final binary, traffic and provider disclosures before claiming Data Not Collected or submission readiness.

## Acceptance checklist — current device evidence pending

- [x] Historical tagged 0.5.0 source passed 239 cloud tests, including 18 executable offline music cases and 8 actual coordinator scenarios with fake recognizer/provider (no real audio/service calls), plus iOS Release app/extension compilation in run 42476798870. Its local native runner separately passed 18 TCP, 8 capture, 36 retained-research, 15 shared and 18 music checks. These results and independently checked binary apply only to that revision, not 0.6.0 acoustic behavior or signed-device/service acceptance.
- [ ] Exact 0.6.0 build/signing and installed host/extension checked independently; no simulator or source result substituted for a physical-device test.
- [ ] Free Personal Team and actual Shazam App Service admission verified without new purchases, made-up entitlements or exposed credentials.
- [ ] Opening/selecting Lyrics causes no permission/network/capture action; explicit start, denied permission, stop during permission, startup failure and stop/restart safely gate the microphone.
- [ ] Actual audible music recognized through the built-in mic while playback remains on the intended car/speaker route; headphones, silence/no-match and service failure stay honest non-success states.
- [ ] Lyrics-mode receiver never requests or receives screen frames; pairing, token expiry, stale recognition and disconnected-page cleanup verified.
- [ ] Background, lock/unlock, calls, route change, network change, expiry and explicit stop checked on the phone, including microphone/lookup cleanup and absence of automatic restart.
- [ ] Screen music OFF makes no recognition/lyric requests; recognition-only does not query LRCLIB; screen mode admits `audioApp`, never `audioMic`.
- [ ] Missing lyrics, wrong recording versions, pause/seek/track changes and manual/Shortcut drafts do not fabricate or overclaim synchronization.
- [ ] Publisher/contact, final privacy labels, provider/lyric rights and authorized submission remain separate gates. Vehicle acceptance remains separate from a second-browser test.

## Primary references checked 2026-11-08

- [Apple SHSession](https://developer.apple.com/documentation/shazamkit/shsession) / [ShazamKit App Service](https://developer.apple.com/help/account/services/shazamkit/) / [Apple DTS on nonexistent entitlements](https://developer.apple.com/forums/thread/799000)
- [ReplayKit](https://developer.apple.com/documentation/replaykit) / [ReplayKit security and consent](https://support.apple.com/guide/security/replaykit-security-seca5fc039dd/web)
- [Matched offset](https://developer.apple.com/documentation/shazamkit/shmatchedmediaitem/predictedcurrentmatchoffset) / [Now Playing publishes an app's own media](https://developer.apple.com/documentation/mediaplayer/mpnowplayinginfocenter)
- [Apple Shazam Shortcuts](https://support.apple.com/guide/shazam/identify-a-song-using-the-shortcuts-app-deve5143aaf5/web) / [Personal Team limits](https://developer.apple.com/help/account/basics/about-your-developer-account)
- [LRCLIB API](https://lrclib.net/docs) ([current Markdown reference](https://lrclib.net/docs.md))
- [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/), including intended background use, recording consent and third-party rights (2.5.4, 2.5.14, 5.2.1–5.2.2)
