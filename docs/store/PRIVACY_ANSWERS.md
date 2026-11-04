# Privacy worksheet — source-reviewed candidates

No label is entered or submitted. Recheck the distributed app, extension, SDKs and support practice. The publisher owns the final answers.

Apple defines collection in terms of off-device data accessible to the developer/partners beyond real-time request servicing. “No developer collection” does not mean “nothing leaves the phone”: the paired browser receives images and optional text. [Apple's definitions](https://developer.apple.com/app-store/app-privacy-details/)

| Path | Candidate answer and evidence |
| --- | --- |
| Developer/partner collection | Candidate Data Not Collected, not finalized. Shipping targets contain no developer endpoint, analytics/ads or account; verify final binary and actual traffic. |
| Tracking | None implemented; no ATT, IDFA or cross-app tracking. Do not add a meaningless permission prompt. |
| Images/OCR | DirectSampleHandler/CapturePipeline/LocalHTTPServer send to the user-selected local browser. Receiver copies/extensions are outside app control. |
| Audio, contacts, location, music accounts, vehicle keys | No V1 collection/permission path; retained research is separate. |
| Credentials/settings | Local App Group and browser cookie, with session expiry and matched cleanup; interrupted files/settings may persist. |
| Diagnostics | Explicit local copy only, not automatic upload. A future support channel requires its own review. |
| Privacy/help links | Explicit external-browser navigation. GitHub/final host has its own network practices; no app background request is added. |

The app manifest declares no tracking, collected-data categories or required-reason APIs. The extension alone declares SystemBootTime reason 35F9.1 for elapsed-time capture/OCR pacing. The original app sample uses wall-clock time. Manifest validation is not label approval.

## Consent, retention and deletion

Capture starts by a user's iOS action; the in-app checkbox cannot control every Control Center entry point. End through the app or system recording controls. Only bounded latest frame/text results are intentionally held in memory, not recording history. Normal matched stop removes active credentials; interruption can leave expired files. Settings/last status may persist.

Close/unpair the receiver and clear its local site data if needed. Manage app/permission removal through iOS. The source cannot erase receiver screenshots or guarantee forensic erasure. The accountless runtime has no account-deletion endpoint.

Publisher/contact and final policy/support URLs remain blocking. Cloud/analytics/relay/lyrics/account/crash/support upload or SDK changes require a fresh audit; optional-support disclosure exceptions are not presumed. Final-binary/network and publisher checks must precede a finalized Data Not Collected answer.
