# Cabin Direct — experimental iPhone-local screen and lyrics companion

An independently implemented, developer-stage screen companion for a parked Tesla browser. The `CabinDirect` iOS app and ReplayKit broadcast extension contain a native local HTTP/MJPEG server, bounded JPEG capture, optional on-device visible-text recognition, and an experimental read-only Tesla media protocol client.

**Not yet a validated iPhone/Tesla product.** Local macOS native checks and source tests do not establish iOS signing, installation, ReplayKit/Bluetooth extension behavior, hotspot reachability, vehicle enrollment or music-platform compatibility. Check the actual unsigned iOS workflow result separately. There is no signed, installable IPA, device acceptance claim, paid cloud service or DRM bypass.

## Runtime design

- The broadcast extension owns the local server and capture pipeline. The standalone runtime does not require a Mac, Node server, WebRTC package or cloud relay.
- Local HTTP transport is unencrypted: use only a trusted personal hotspot/Wi-Fi. Pairing lasts 120 seconds with five wrong attempts maximum; the viewer uses a session cookie rather than credential-bearing URLs.
- Screen images preserve aspect/orientation, never upscale, and are capped at 960/540 long/short edges and 8 fps. Slow viewers receive the newest frame rather than queued history. Stale, paused and disconnected imagery is hidden.
- OCR is optional and off by default. It recognizes only visible text in a selected screen region; it is not a universal background music API or reliable highlighted-lyric timing detector.
- Optional Tesla media reads use a reduced official-protocol adaptation, CryptoKit and shared Keychain storage. Reading never generates a key. Monitor-key enrollment requires a separate explicit owner gesture and physical vehicle/NFC approval. No owner/driver fallback, wake, driving, playback or other vehicle-control request is exposed.
- Optional LRCLIB queries require opt-in and send only song metadata, not VIN, screen, credentials or OCR text. Returned lyrics are not included in this source distribution.
- Audio remains with the user's existing player/Bluetooth route. Protected streaming content is outside the support promise.

The earlier Node/WebRTC validation harness is retained for regression testing and uses a different runtime path. Its fixed WebRTC dependency may be resolved while building the shared Xcode project, but is not a `CabinDirect` app dependency.

## Free, unsigned iOS compilation

The manual workflow in `.github/workflows/cabin-public-build.yml` is restricted to a public repository owned by the approved maintainer. It uses the **standard** `xcode-27` GitHub-hosted runner, read-only permissions and a 30-minute limit. There are no push/PR/scheduled triggers, paid larger runners, Actions caches, artifact uploads, release publication or Apple-account secrets.

Run it from **Actions → Cabin Direct public unsigned iOS compile → Run workflow**. The actual compiler result precedes source tests. Logs and the job summary record source commit, compiler diagnostics and hashes of the report/app/extension executables.

Build products are ephemeral and are **not uploaded**. A successful unsigned build is compile evidence, not an installable IPA, permanent signature, runtime success or a complete car test. Public standard-runner pricing is governed by [GitHub's current rules](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job); this project does not enable a paid fallback.

## Local developer checks

Requires Node.js 22+, macOS and XcodeGen 2.42+ for project generation. Full Xcode with an iPhoneOS SDK is required for actual iOS compilation.

```sh
npm ci --ignore-scripts
npm test
npm run check
CABIN_NATIVE_WORK_DIR=/absolute/external/native-checks npm run test:native
CABIN_IOS_WORK_DIR=/absolute/external/ios-build npm run ios:preflight
CABIN_IOS_WORK_DIR=/absolute/external/ios-build npm run build:ios
```

Output directories must be outside this repository. If necessary set `DEVELOPER_DIR=/absolute/Xcode.app/Contents/Developer` per command; the scripts do not change global Xcode selection. XcodeGen's ignored project/configuration files remain at their required `ios/` paths. The build script distinguishes generation, validation, missing SDK, compiler failure and actual unsigned app/extension products. Simulated CLI test reports cannot count as actual iOS builds.

For signing later, choose `CabinDirect`, set your own unique bundle prefix and signing team, and verify App Group and shared Keychain provisioning for both targets. Never commit keys, provisioning profiles, Apple login state or device pairing files.

## Installation and renewal are separate

Free Apple Personal Team profiles expire after seven days. Periodic refresh/re-signing is required; it is not one permanent installation. Existing unchanged code normally does not need a new GitHub build for each refresh. Any installation/renewal tool is an optional user choice, not a dependency of this app.

SideStore is **not required**. Xcode, AltStore/AltServer and Sideloadly are other possible routes with their own computer, pairing and local-network requirements. Compatibility of this app's broadcast extension, App Group and shared Keychain after re-signing still requires device testing. No renewal tool has been installed or configured by this project. Do not replace an active VPN without user consent.

## Required parked-device acceptance

1. Actual iOS build, personal signing, installation and shared entitlement validation.
2. Real iPhone broadcast, local browser pairing, rotation, OCR ROI, pause/resume, stale-frame clearing and end-of-session cleanup.
3. Parked Tesla on normal Wi-Fi, then iPhone personal hotspot: distinguish routing/HTTP restrictions from decoder failures.
4. Each music app's visible lyrics and capture restrictions. No platform is marked universally passed.
5. Explicit owner-approved monitor-key enrollment, authenticated media fields and verified timing units, only if that optional path is chosen.
6. Memory/thermal behavior, calls, lock/unlock, long sessions and renewal recovery. Lock-screen streaming is not guaranteed.

## License and provenance

The project's original source is released under **Apache-2.0**, with the owner's explicit approval. Third-party works retain their original terms; see [LICENSE](LICENSE), [NOTICE](NOTICE), [THIRD_PARTY.md](THIRD_PARTY.md), and the preserved Tesla/WebRTC notices. No private repository history, personal screenshots, account data or proprietary researched-product assets are part of this snapshot.

This project is not affiliated with Tesla, Apple or any music service. Use only while parked; shared screens may contain private messages and notifications.
