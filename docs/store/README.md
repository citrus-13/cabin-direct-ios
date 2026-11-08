# App Store preparation kit — not a submission

Prepared for the screen-companion-v1 profile. These files create no Apple account, app record, price, contract, upload, TestFlight invitation or review submission.

**Current-source addendum (2026-11-08):** 0.5.0 development introduces [optional experimental music](../MUSIC.md), not included in preview.3/preview.2. The Chinese JSON listing now discloses the new opt-ins and pending gates, but remains a developer draft, not ready for submission. Historical screenshot/release materials describe the earlier screen-only profile. Revalidate all fields, provider/lyric rights and privacy answers after exact-revision builds and device acceptance, before any submission. No historical green check validates the music path.

| Material | Status |
| --- | --- |
| [Chinese listing](metadata.zh-Hans.json) | Copyable draft with checked field limits. Chinese is the implemented UI language; English/French UI is not invented. |
| [Reviewer instructions](REVIEW_NOTES.md) | English review path explaining manual capture and a second browser, pending hardware proof. |
| [Privacy answers](PRIVACY_ANSWERS.md) | Source-backed candidates, not an approved/submitted label. |
| [Screenshot/accessibility plan](SCREENSHOTS_ACCESSIBILITY.md) | Simulator evidence is not phone/vehicle acceptance or final store assets. |
| [Export/content worksheet](EXPORT_AND_RIGHTS.md) | Technical inventory and remaining publisher decisions, not legal clearance. |
| [Submission handoff](SUBMISSION_HANDOFF.md) | Exact remaining gates. |
| [Support](../SUPPORT.md) / [privacy](../PRIVACY.md) | Public drafts; final publisher/contact and working policy/support URLs remain pending. |

Run node scripts/check-store-metadata.mjs to validate draft structure and limits. A successful draft check still reports submission_ready: false while required evidence is missing. The --require-submission-ready option blocks rather than uploading anything.

## Cost and authority

Remote tests use a standard public GitHub runner without Actions artifact/cache uploads, paid SDKs/APIs or runtime downloads. Actual simulator screenshots can be preserved in a separate draft GitHub prerelease, downloaded/reviewed by the maintainer before public publication. No signed installable app or device test is implied.

The existing v0.4.0-preview.1 tag/IPA remain unchanged. Store-preparation source can move ahead of that historical binary; compare exact commits.

No fee or Apple membership is purchased by this kit. Future distribution membership, agreements and submission are separate decisions. Free remote development does not promise permanent free signing or a zero-cost App Store account.

## Primary references checked 2026-11-04

- [Review guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [App fields](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information/) / [version fields and limits](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information/)
- [Screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/)
- [Privacy details](https://developer.apple.com/app-store/app-privacy-details/) / [export compliance](https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance/)
- [Accessibility labels](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/overview-of-accessibility-nutrition-labels/)
- [Runner billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) / [release storage](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)
