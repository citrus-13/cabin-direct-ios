# Cabin Direct — privacy statement draft

**Draft for source review, not a finalized public privacy policy or approved App Store privacy label.** Applies to current 0.6.0 development source: the CabinDirect host's independent acoustic lyrics mode and the separate DirectBroadcastExtension screen mode. It does not describe the Node/WebRTC harness or retained vehicle research tools. Historical 0.5.0 and 0.4.0 preview binaries do not contain the new independent acoustic mode. Source checks, compilation, signing, service access and physical-device results are separate evidence. Publisher identity, contact, final URLs, effective date and jurisdiction-appropriate disclosures remain unfilled; verify this draft against the final binary before submission.

## Two user-started modes

**Lyrics:** selecting the mode or opening Cabin does nothing by itself. An explicit Start Lyrics action presents a per-session notice explaining microphone listening and third-party processing, followed by iOS microphone permission if needed. The host uses a real AVAudioEngine input with the built-in microphone to hear music audible from car speakers or another source. It does not start ReplayKit, read another app's Now Playing/account state, save audio files or relay an audio stream.

Acoustic audio is transient recognition input. ShazamKit creates signatures for Apple/Shazam matching; Cabin does not upload raw audio or screens. Matched title/artist are sent to LRCLIB for candidate current-track lyrics. Providers receive the requests and ordinary connection metadata such as IP address under their own practices. This consented mode is not wholly offline. Free Personal Team admission to Apple's ShazamKit App Service remains unproven; service failure does not authorize a purchase, invented entitlement or paid fallback.

**Screen sharing:** the default path has no app account, developer cloud relay, analytics, advertising, remote OCR or lyric lookup. Capture starts only through the user's real iOS broadcast action, not programmatically. Optional screen-mode recognition and LRCLIB access remain separate, default-OFF choices. Recognition accepts only usable ReplayKit app-audio buffers, never microphone buffers; a screen-mode failure never silently switches to acoustic capture. No raw audio or screens go to the recognition/lyric providers. Playback remains the original player's responsibility.

The guided screen path validates/saves settings and asks the user to confirm its notice and iOS broadcast picker. Control Center can also explicitly start an already-configured extension: the extra app checkbox is not an unavoidable system gate. Screens may expose messages, notifications or account details; use permitted non-sensitive content. Protected/DRM content may be unavailable and is not bypassed.

Optional screen-region OCR stays on device using Vision and may be wrong or delayed. It reads visible pixels, not music accounts or background tracks. The retained development sample draws original labelled cards, captures nothing and is not evidence of phone/vehicle behavior.

## Where data goes

The phone serves state and bounded current song/lyric lines to the browser the user pairs on a trusted local network. Only screen mode adds JPEG frames and optional visible text. Acoustic mode never serves screen frames or OCR. Neither receiver path provides an audio stream. Receiver HTML/CSS/JavaScript is bundled without remote fonts, analytics or provider trackers; lyrics are requested by the host in acoustic mode or the extension in opted-in screen mode.

A receiver is outside the publisher's control and may save what it displays; Cabin cannot revoke copies or screenshots. **Local HTTP is unencrypted.** Pairing is access control, not confidentiality against network observers. Use only a trusted Wi-Fi/hotspot, never publicly expose the listener, and do not share codes with untrusted people. A change to the eligible interface/address snapshot stops the session and requires explicit restart/re-pairing; the app does not change network or VPN settings.

## Local storage and retention

- **Audio and lyrics:** bounded transient input and current-track results, not an audio archive or downloaded lyric library. Stop clears runtime work; stale/disconnected receivers hide old results. This is not a promise of forensic memory erasure.
- **Screen/OCR:** latest bounded in-memory results, not an intentional video or text-history recording. Pause, staleness and disconnect hide old content.
- **Lyrics-session credentials:** random token, six-digit code and settings stay in the host session's memory, not the ReplayKit shared session file. Stop/expiry makes the local listener unavailable; the maximum session lifetime is eight hours.
- **Broadcast credentials:** the app and extension coordinate through private App Group session/configuration files. Normal completed stop removes the matching credential file; sessions expire within eight hours. Forced termination may prevent file cleanup, but expiry still invalidates credentials. The retained foreground sample keeps an in-memory session capped at ten minutes.
- **Preferences/status:** saved screen options, OCR region, port, manual title/artist/offset and consent settings can persist locally, as can bounded broadcast status/stop requests. Normal stop does not erase preferences. Acoustic per-session consent does not silently overwrite screen-mode choices. Manual/Shortcut import creates a draft with network lyrics OFF and never starts capture or lookup; originating URL/Shortcut history is outside Cabin's control.
- **Browser pairing:** successful pairing sets an HttpOnly, same-site local-origin cookie valid no longer than the source session. First pairing has a 120-second window and five wrong attempts. Disconnect attempts cookie deletion; when unreachable, deletion stays unconfirmed. Stopping the source or expiry invalidates access even if a cookie remains.
- **Clipboard:** only explicit copy actions write local-only clipboard items with 120-second expiry. iOS controls clipboard behavior; other local apps may read a copied item before expiry.
- **Diagnostics:** internal freshness, session and cleanup checks do not imply analytics. The UI provides simple status/help, not diagnostic exports; Cabin does not automatically upload diagnostics. This does not mean that consented Shazam/LRCLIB requests stay on device.

## Stopping, background use and interruption

Explicit Stop Lyrics stops the microphone/engine, cancels music and lyric work, clears results and waits for local-server cleanup before restart. Interruption, audio-route or network change, expiry and terminal service/startup failure can stop the mode. No automatic restart or paid fallback is performed. Silence/no match is an honest waiting state, not fabricated content.

The host declares audio background use for the genuine, user-started microphone session, not silent audio keepalive. Listening may continue after leaving or locking the app until stopped or interrupted; users should explicitly stop it when finished. Reliable background/lock behavior and player/Bluetooth coexistence require physical-device testing and are not guaranteed. Mixing without ducking, A2DP eligibility and preferred built-in input are requests to iOS, not verified universal routing outcomes.

Backgrounding the main app does not itself stop a real ReplayKit extension. Stop Screen Sharing waits for matching-session cleanup, or the user can end capture with iOS recording controls. Heartbeat expiry is not stop confirmation. A user may release a stuck local waiting UI only after checking the system recording state; that does not forge stopped state, erase credentials or prove termination. The retained foreground sample stops when no longer active.

## Permissions and submission declarations

The host uses local-network permission and, only for explicit acoustic mode, microphone permission. Screen sharing uses user-operated ReplayKit, with optional app-audio processing remaining microphone-free. TeslaBLE, vehicle enrollment and shared-Keychain access remain excluded; standard audio routing is not vehicle-control permission. Shazam catalog access requires actual App ID service admission, not a fabricated entitlement or purchase.

The app and extension privacy manifests declare no tracking/collected-data categories and include SystemBootTime reason `35F9.1` for local elapsed-time pacing and recognition freshness. Device uptime is not sent in public receiver state or provider requests. Those source declarations are **not finalized App Store privacy labels** and do not establish that third-party processing needs no disclosure. Audit the exact binary, SDK/provider practices and traffic before completing [App Store privacy disclosures](https://developer.apple.com/app-store/app-privacy-details/) and [required-reason API declarations](https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api).

Service access, lyric display rights, publisher information and device evidence remain submission gates. API access or the repository's license does not license third-party lyrics. This draft claims no App Store approval, permanent privacy guarantee, exact synchronization or universal platform support. See [music scope and acceptance](MUSIC.md).
