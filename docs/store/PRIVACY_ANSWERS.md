# Privacy worksheet — 0.8.0 candidates, not submitted

No privacy label is entered or approved. Audit the exact host/extension, linked dependencies, provider practices and final traffic before answering. “No developer endpoint” is not “nothing leaves the phone” or a finalized Data Not Collected classification. [Apple privacy reference](https://developer.apple.com/app-store/app-privacy-details/).

| Path | Current intended boundary / required verification |
| --- | --- |
| Vehicle enrollment | Separate explicit confirmation requests Monitor, a broader read-only role than media. App allowlist requests media only, not location or vehicle controls. Real grant/keycard/NFC behavior still needs hardware proof. |
| VIN / vehicle keys | VIN saved locally only after explicit valid pairing/start; host-default Keychain stores the key with no shared vehicle-key group. No VIN/key in logs, webpages, provider requests or ReplayKit extension. Confirm final binary/traffic. |
| BLE lyrics | Authenticated media title/artist/duration/position/playback state when provided. No microphone, Tesla cloud/OAuth, paid API or background mode. |
| LRCLIB | Per-session consent permits bounded current-track title/artist/duration lookup; returned lyric lines stay transient and reach the paired browser. Provider receives normal connection metadata. Review provider retention and content rights. |
| Screen/audio/OCR | User-operated ReplayKit sends permitted frames/audio to local paired browser. Optional Vision OCR stays on-device; browser copies are outside app control. |
| Optional screen recognition | Separate default-OFF ShazamKit audioApp signatures go to Apple/Shazam; no audioMic, raw-audio upload or recording archive. Service admission remains independent. |
| Tracking / accounts | No analytics, ads, IDFA, ATT-based tracking or app account implemented. Recheck dependencies and final release. |
| Web credentials/settings | Lyrics credentials in host memory; screen session coordination in App Group. Web cookie/session expiry is separate from persistent vehicle enrollment and saved preferences. |
| Fixed entry / links | GitHub Pages receives ordinary access metadata; launcher stores only explicitly confirmed local address/navigation choice. No background app navigation or media relay. |
| Diagnostics / clipboard | No diagnostic export or automatic upload. Explicit Copy writes local-only expiring clipboard items; do not confuse this with a support uploader. |

## Consent, retention and revocation

Opening Cabin, typing VIN or switching modes performs no enrollment, key access or provider lookup. Pairing and lyrics consent are separate; request sent is not accepted enrollment. Stop clears runtime media/lyric work and ends the listener, not the persistent vehicle key or preferences. Remove Cabin's key in the vehicle to revoke access; app deletion is not a verified vehicle-revocation procedure.

Lyrics needs foreground operation: no microphone or background modes, no lock-screen continuity. A user-started session temporarily disables display idle sleep and restores the prior value when stopped. Background stops BLE and the lyric session without automatic restart. ReplayKit's independent user-started extension is not stopped merely by host backgrounding.

Only bounded current track/media/lyric state and screen fragments are intentionally retained, not a recording or lyric library. Unknown playback/position does not scroll; stale media is hidden. Receivers may save displayed content. Session expiry or clearing site data cannot erase their screenshots/copies; no forensic erasure claim is made.

## Final audit gates

Check both privacy manifests and required-reason APIs against actual elapsed-time/freshness behavior and packaged binaries. A valid manifest does not settle provider practices or App Store labels. Audit Bluetooth/local-network purpose strings, no microphone/background/shared-vehicle-Keychain permission, and default-off screen service choices.

The publisher must resolve real contact/policy/support details, provider processing classifications, territorial lyric rights and final privacy answers. Future SDK, relay, account or support-upload changes require a fresh audit. No current source declaration or historical compile closes these gates.
