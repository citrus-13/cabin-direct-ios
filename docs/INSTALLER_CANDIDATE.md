# Installer-input candidate with the compatibility fixes

Published candidate: [v0.4.0-preview.3](https://github.com/citrus-13/cabin-direct-ios/releases/tag/v0.4.0-preview.3), independently downloaded and verified on 2026-11-08.
[Download the IPA](https://github.com/citrus-13/cabin-direct-ios/releases/download/v0.4.0-preview.3/CabinDirect-46b507e417a8-adhoc-entitlement-input.ipa) (545,218 bytes).
Its exact source is `46b507e417a86fb11fe56d29f267ed0a170657a3`.
The separate manual workflow stages drafts only; publication follows an independent download review.

The [actual cloud run](https://github.com/citrus-13/cabin-direct-ios/actions/runs/42428225932) compiled the iOS Release products, passed 212 tests with no failures/skips, and uploaded all three assets.
Its **overall conclusion is failure**: the post-upload draft-list lookup failed. The existing draft was recovered by its exact ID, independently downloaded and checked, then published without replacing its tag or files.
Both packaged executables, metadata signatures/entitlements, runtime resolver markers, source resources, privacy manifests, versions and ReplayKit entry point passed the download review.
Later publishing-script maintenance is not a different binary; the candidate remains tied to the exact source above.

This candidate includes the runtime identifier/shared-group resolver added after preview.2.
The host finds its own packaged ReplayKit extension after supported identifier remapping;
malformed or ambiguous mappings fail closed.

## What to download

Download the `.ipa`, `INSTALLER-INPUT.json` and `SHA256SUMS.txt` from the same release.
The IPA filename includes the first 12 characters of its exact source commit.
Compare that commit with the release tag, workflow and metadata, then verify:

```sh
shasum -a 256 -c SHA256SUMS.txt
```

Both listed files must report OK. Hashes verify consistency, not Apple's authorization to install.
The metadata records original and packaged executable hashes and the candidate IPA hash.
The executable metadata signatures are checked separately in CI and again after downloading.

Candidate IPA SHA-256: `62b983d099de204b9c10d008d097c36b9bb3c09d6e09e25d48cd652afb0ddb57`.

## Not a directly installable Apple-signed app

This is a device arm64 Release build with **identity-free ad-hoc entitlement metadata** in both the app and broadcast extension.
It is **not Apple Ad Hoc distribution**, an Apple development/distribution signature, TestFlight or an App Store release.
No Apple account, certificate or provisioning profile is included. The package requests only the existing shared App Group.
It still needs subsequent personal signing/provisioning and iPhone trust/device steps through an authorized free route.
Do not remove the extension or required shared-group entitlement to force installation.

SideStore/AltStore import, personal signing, actual iPhone capture, periodic renewal and parked-vehicle operation remain unverified.
Do not assume the metadata repair grants a free account a capability or provides permanent signing.
No paid service or VPN change is needed to download and inspect it; do not purchase membership or replace an existing VPN merely to try this candidate.

See [free installation and renewal gates](FREE_INSTALL.md) and the [installation guide](INSTALL.md).
Existing preview.1/preview.2 releases and tags are preserved; preview.2 lacks the new resolver.
