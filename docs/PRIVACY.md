# Cabin Direct V1 — privacy statement draft

**Draft for source review, not a finalized public privacy policy or approved App Store privacy label.** Applies to the intended Cabin Direct 0.4.0 app and DirectBroadcastExtension targets, not the separate Node/WebRTC harness or retained vehicle/lyrics research tools. Before submission, the publisher must supply its actual identity, contact method, support/policy URLs, effective date and jurisdiction-appropriate disclosures, and verify this text against the final binary. Those details have not been invented here.

## What V1 does and does not collect

V1 has no app account, developer-hosted receiving server, cloud relay, analytics, advertising/tracking integration, cloud OCR or external lyrics lookup. Its implemented runtime does not send screens, recognized text, credentials or diagnostics to a developer service. No microphone or player audio is captured or relayed; the original player and existing audio connection remain responsible for sound.

Screen sharing starts only after the user saves settings, acknowledges the privacy warning, personally opens the iOS system broadcast picker and confirms capture in iOS. Shared screens can expose messages, notifications, account details and other private content. Use permitted content, consider Focus mode and avoid secrets; the app cannot guarantee every notification is hidden. Recording-protected/DRM content may be unavailable and is not bypassed.

Optional visible-text recognition is off by default. If enabled, Apple's on-device Vision processing reads only the configured region of the currently captured visible image. Recognition may be wrong or delayed; it does not access background music accounts, vehicle information or a lyrics service. Latest images/text are transient runtime results, not a recording archive. The original foreground sample captures nothing: it draws its own explicitly labeled cards and uses the same local receiving path, at most 1 fps and ten minutes.

## Where data goes

The iPhone serves latest JPEG frames, runtime state and optional recognized text to a browser the user pairs on their own local network. Receiver HTML/CSS/JavaScript is bundled locally, without external fonts, analytics or remote media. A receiver device is user-selected and outside the publisher's control: its user, browser, extensions or operating system may save or expose what it displays. The app cannot revoke screenshots or copies already made by a receiver.

**HTTP traffic is not encrypted.** Pairing limits access but does not provide confidentiality against someone who can observe or interfere with the network. Only use Wi-Fi / hotspots you control; do not use a public/untrusted network, expose ports to the internet or share session codes with untrusted people. The session advertises its startup interface/address snapshot. If the local interface/address set changes, the session stops and requires explicit restart/re-pairing rather than silently migrating to another network.

## Local storage and retention

- **Frames and OCR:** only bounded latest results are held in process memory. Old results are hidden when paused/stale/disconnected and runtime memory is cleared during teardown; V1 does not intentionally write a video or OCR-history archive. This is not a promise of forensic memory erasure or control over receiver/browser storage.
- **Broadcast credentials:** a random session token, six-digit pairing code and session configuration are placed in the app's private App Group so the app and its ReplayKit extension can coordinate. A normal completed stop removes the matching session-credential file; real sessions expire after at most eight hours. Expiry makes credentials unusable even if forced termination prevented file cleanup. Invalid/expired local files may remain until overwritten or the app's data is removed. The original sample keeps its session in its own process, not the shared store, and expires within ten minutes.
- **Settings and status:** the chosen mode, OCR region and port are retained locally for convenience. A bounded last runtime status and a local stop request may also remain; status is not a recording archive. Normal session stop does not delete saved settings. Removing the app is a separate user-controlled action and is not performed automatically.
- **Browser pairing:** a successful pairing sets an HttpOnly, same-site session cookie for that local origin. Its validity cannot outlast the source session; it is not an account or tracking cookie. Initial pairing is limited to 120 seconds and five wrong attempts. A browser disconnect attempts to clear its cookie; if unreachable, the interface explicitly leaves clearance unconfirmed. Stopping the source or expiry invalidates it even if a cookie remains in browser storage.
- **Clipboard:** addresses/codes are copied only by explicit user actions. App copy uses local-only clipboard items with 120-second expiry; redacted diagnostic copy uses a five-minute expiry. iOS controls clipboard behavior, and another local app may read a copied item before expiry.
- **Diagnostics:** the app displays actual reported state, freshness, port, frame count and estimated frame rate. Its manual diagnostic export omits tokens, pairing codes, session identifiers, addresses, raw runtime messages and captured/recognized content; nothing is automatically uploaded. If a user independently sends a copied diagnostic to someone, that communication is outside this local runtime.

## Stopping and interrupted sessions

An app stop applies only to the matching active broadcast and stays pending until runtime cleanup is reported. The original sample also waits for server cleanup before allowing restart. Backgrounding the main app does not stop the real ReplayKit extension; end it through the app's stop action or iOS's system recording controls. The sample stops when the app is not active, on expiry, or on a detected real broadcast/network change.

If the extension is terminated without confirmation, the app does not equate heartbeat timeout with a successful stop. After personally checking the system recording state, a user may explicitly release only the local waiting UI. This does not write a stopped status, erase credentials or prove that broadcasting ended. Close the browser and use iOS's recording controls if there is any doubt.

## Permissions and submission declarations

V1 uses the local-network permission and user-operated ReplayKit capture. TeslaBLE, vehicle-key enrollment, LRCLIB and DirectLyrics remain research-only source/offline tests, absent from both shipping targets; V1 requests no Bluetooth or shared-Keychain permission for those features.

The app privacy manifest declares no tracking/collected-data categories and no required-reason APIs. The extension manifest declares only SystemBootTime reason `35F9.1` for elapsed-time pacing of local frame/OCR work. Device uptime is not transmitted off-device or included in public receiver state or diagnostic exports. These are source declarations, not an Apple determination; the final publisher must audit the shipped binary and complete accurate [App Store privacy disclosures](https://developer.apple.com/app-store/app-privacy-details/) and [required-reason API declarations](https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api).

Any future cloud, analytics, support upload, account or external lookup feature requires a new implementation/privacy review and updated disclosures before release. This draft makes no App Store approval, permanent privacy guarantee or universal compatibility claim.
