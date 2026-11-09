# App Store preparation kit — 0.8.0 draft, not submitted

The current draft covers **foreground Tesla BLE lyrics plus separate ReplayKit screen sharing**. The internal validator retains its historical `screen-companion-v1` profile identifier; that identifier does not mean the host excludes TeslaBLE. No Apple account, app record, price, contract, upload, TestFlight invitation or review submission is created.

Vehicle enrollment and lyrics start require separate consent. Monitor is broader read-only vehicle authorization than the app's media-only request allowlist. The host uses its default Keychain, no shared vehicle-key access group, no microphone, no background mode and no Tesla cloud/OAuth/paid API. Optional screen Shazam remains separate. Exact hardware/firmware behavior, privacy labels and lyric rights remain unverified gates.

| Material | Status |
| --- | --- |
| [Chinese listing](metadata.zh-Hans.json) | 0.8.0 developer draft, Simplified Chinese UI only; all external evidence flags remain false. |
| [Reviewer instructions](REVIEW_NOTES.md) | Distinguishes second-browser screen review from vehicle-dependent BLE review. |
| [Privacy answers](PRIVACY_ANSWERS.md) | Audit worksheet, not approved Data Not Collected answers. |
| [Screenshot/accessibility plan](SCREENSHOTS_ACCESSIBILITY.md) | Four navigation tests and ten named screenshots are the current contract, not proof they ran. |
| [Export/content worksheet](EXPORT_AND_RIGHTS.md) | Includes current TeslaBLE/CryptoKit encryption; no exemption invented. |
| [Submission handoff](SUBMISSION_HANDOFF.md) | Remaining phone, car, publisher and authorization gates. |
| [Support](../SUPPORT.md) / [privacy](../PRIVACY.md) | Drafts; real publisher/contact and final working URLs remain pending. |

Run `node scripts/check-store-metadata.mjs` for draft structure/field limits. Passing always leaves `submission_ready: false` and requires independent review; `--require-submission-ready` blocks rather than uploading. Do not mark source declarations as external evidence.

The integration record reports 46 local offline protocol/clock checks passed. Exact current iOS/cloud/UI evidence must be checked independently, and neither compilation nor screenshots prove installation, Monitor enrollment or vehicle playback semantics. Earlier 0.5/0.4 releases and eight/nine-image screenshot contracts are historical, not 0.8.0 acceptance.

No purchases, paid fallback, Apple membership/account changes or publication are authorized by this kit. Future distribution membership, pricing, agreements and submission require separate decisions; no zero-cost App Store or permanent free-signing promise is made.

Reference links: [review guidelines](https://developer.apple.com/app-store/review/guidelines/), [version fields](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information/), [screenshots](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/), [privacy](https://developer.apple.com/app-store/app-privacy-details/), [export compliance](https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance/). These are not a refreshed legal/approval determination in this documentation update.
