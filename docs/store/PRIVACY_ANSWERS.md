# Privacy worksheet — source-reviewed candidates

No label is entered or submitted. Current 0.5.0 source adds default-OFF Apple/Shazam recognition and independently consented LRCLIB requests; this worksheet must be re-audited, not reused as a finalized Data Not Collected answer. Existing preview.3/preview.2 evidence does not validate the new path. Recheck the distributed app, extension, SDKs and support practice. The publisher owns the final answers.

Apple defines collection in terms of off-device data accessible to the developer/partners beyond real-time request servicing. “No developer collection” does not mean “nothing leaves the phone”: the paired browser receives images and optional text. [Apple's definitions](https://developer.apple.com/app-store/app-privacy-details/)

| Path | Candidate answer and evidence |
| --- | --- |
| Developer/partner collection | No developer endpoint, analytics/ads or account is implemented. Optional third-party Apple/Shazam and LRCLIB processing needs separate provider-practice and final-traffic review before any Data Not Collected answer. |
| Tracking | None implemented; no ATT, IDFA or cross-app tracking. Do not add a meaningless permission prompt. |
| Images/OCR | DirectSampleHandler/CapturePipeline/LocalHTTPServer send to the user-selected local browser. Receiver copies/extensions are outside app control. |
| App audio / recognition | Explicitly selected ReplayKit `audioApp` input becomes fingerprints for Apple/Shazam; no microphone consumption, raw-audio forwarding or recording archive. Default OFF; global-catalog account admission is unproven. |
| Track metadata / lyrics | Separate default-OFF consent sends title/artist to LRCLIB. Returned current-track lyrics remain in runtime memory; bounded metadata/lines reach the paired browser. Providers receive ordinary connection metadata. [Music disclosure](../MUSIC.md). |
| Contacts, location, music accounts, vehicle keys | No implemented access path; retained vehicle research remains separate. |
| Credentials/settings | Local App Group and browser cookie, with session expiry and matched cleanup; interrupted files/settings may persist. |
| Diagnostics | Explicit local copy only, not automatic upload. A future support channel requires its own review. |
| Privacy/help links | Explicit external-browser navigation. GitHub/final host has its own network practices; no app background request is added. |

The app manifest declares no tracking, collected-data categories or required-reason APIs. The extension alone declares SystemBootTime reason 35F9.1 for local elapsed-time pacing; current music recognition/freshness also uses uptime and needs final reason review. The original app sample uses wall-clock time. Manifest validation is not label approval or proof of provider retention practices.

## Consent, retention and deletion

Capture starts by a user's iOS action; the in-app checkbox cannot control every Control Center entry point. End through the app or system recording controls. Only bounded latest frame/text/music results and current-track fetched lyrics are intentionally held in memory, not recording history. Normal matched stop removes active credentials; interruption can leave expired files. Settings/last status, manual track fields and saved opt-in choices may persist. Shortcut import resets network lyrics OFF and prepares a draft only; it neither starts capture nor contacts providers.

Close/unpair the receiver and clear its local site data if needed. Manage app/permission removal through iOS. The source cannot erase receiver screenshots or guarantee forensic erasure. The accountless runtime has no account-deletion endpoint.

Publisher/contact and final policy/support URLs remain blocking. Cloud/analytics/relay/lyrics/account/crash/support upload or SDK changes require a fresh audit; optional-support disclosure exceptions are not presumed. Final-binary/network and publisher checks must precede a finalized Data Not Collected answer.
