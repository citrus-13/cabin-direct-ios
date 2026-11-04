# Submission handoff — stop before Apple commitments

## Remote preparation

Review source, licenses/icon, unsigned compilation, privacy/support navigation, field-limited Chinese metadata, English review procedure, disclosure worksheets and actual simulator tests/screenshots if CI proves them. Keep commit-pinned evidence and pending gates separate.

### Accept a simulator evidence draft

Before publishing a store-preparation GitHub draft, independently verify:

1. The actual workflow succeeded in this public repository at the intended source commit; the new `store-prep-<runID>` tag resolves to that commit. Do not change an existing preview release.
2. Download exactly the simulator-evidence ZIP, `simulator-report.json` and `SHA256SUMS.txt`. Compare all three hashes against GitHub asset digests or the CI staging receipt, then verify both checksum-file entries. A checksum file alone is not independent provenance.
3. Inspect the ZIP before extraction: exactly eight named PNGs and the report, all root-level regular files, with no duplicates, paths or symlinks. Its report must be byte-identical to the separate report.
4. Revalidate the exact report schema, commit/run, three passing UI tests without skips, owned-simulator cleanup, eight image hashes, accepted native portrait dimensions and decoded no-alpha PNGs. The report must retain simulator-only status and false physical-phone, capture, vehicle, personal/distribution-signing and App Store approval fields.
5. Visually review all eight actual screenshots for the intended state, readability, clipping/overlap, dark mode and accessibility text. Reject credentials, personal data, unrelated content or misleading capture/connection claims. XCTest and valid image bytes do not replace this review.

These are developer evidence, not automatically selected App Store screenshots or proof of real-phone/vehicle operation. The in-app appearance choice is user-visible, affects only the current app run and does not establish a complete accessibility audit.

## Publisher decisions, no device needed

Confirm the public publisher name and authorized contact; never substitute an unrelated private email. Finalize working support/contact and privacy URLs. Decide name/content rights, price/territories, category/age/export/accessibility/trader answers. Later, separately decide distribution membership/agreements. This task buys/accepts nothing and creates no App Store Connect record.

## Connected real iPhone

Sign/provision the exact app and extension with matching App Group identifiers. Verify installation/free-signing limits separately. Test genuine ReplayKit start/pause/resume/stop, app backgrounding, denial/retry, rotation/notifications, pairing limits/expiry, changed-network teardown, forced termination, browser clearing, locked-screen behavior and unconfirmed recovery.

Check final binary/privacy/traffic, IPv6-only and supported real networks, calls/interruption, thermal/battery/endurance and manual accessibility. Source review is not hardware success.

## Parked vehicle

Only vehicle claims need a real parked Tesla/browser/firmware/network test. Do not generalize one result to all vehicles, music services or protected streaming.

## Submission

After evidence and publisher decisions: freeze a source/build, choose honest final screenshots, sign/archive for distribution, complete account metadata, and obtain explicit authorization to upload/submit. An unsigned compile, simulator, draft release, filled template or uploaded binary is not App Review approval. The metadata checker intentionally reports not submission-ready while gates remain open.
