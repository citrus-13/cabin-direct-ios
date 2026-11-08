# Installer-input candidate with the compatibility fixes

Target release: [v0.4.0-preview.3](https://github.com/citrus-13/cabin-direct-ios/releases/tag/v0.4.0-preview.3).
Availability is established only when that page is public and lists the three checked assets.
The separate manual workflow first creates an unpublished draft; the maintainer downloads and verifies it before publishing.

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
