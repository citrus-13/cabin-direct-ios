# Cabin Direct — V1 local screen companion preview

**Current source: 0.5.2, automatic local connection.** Two tabs: **投屏** (start/stop, one preferred observed address and code; alternatives collapsed) and **设置** (music, optional lyrics and visible text). No manual network mode: connect the receiver to this iPhone's hotspot or put both devices on the same trusted Wi-Fi/other hotspot before starting. Session checks remain internal; no developer diagnostics or demo setup are required in the app. Address priority is not a reachability test; physical hotspot/vehicle acceptance remains pending. Source changes do not update previously downloaded or installed packages.

**New experimental music preview: [v0.5.0-preview.1](https://github.com/citrus-13/cabin-direct-ios/releases/tag/v0.5.0-preview.1).** [Download the personal-signing input IPA](https://github.com/citrus-13/cabin-direct-ios/releases/download/v0.5.0-preview.1/CabinDirect-4ec061dd1ca1-adhoc-entitlement-input.ipa). Exact source `4ec061dd1ca1399763a4ad36076af98932b1a664` passed [actual iOS Release compilation and 239 tests](https://github.com/citrus-13/cabin-direct-ios/actions/runs/42476798870); downloaded bytes, executable hashes and metadata signatures were independently checked. Optional ShazamKit app-audio recognition and separately consented LRCLIB lyrics are default OFF. Free-account service access, personal signing/install and real-device compatibility remain **unverified**. See [music scope and evidence](docs/MUSIC.md). This is not a directly installable Apple-signed app; older previews do not contain this music mode.

**Earlier installer-input candidate:** [download preview.3 IPA](https://github.com/citrus-13/cabin-direct-ios/releases/download/v0.4.0-preview.3/CabinDirect-46b507e417a8-adhoc-entitlement-input.ipa) / [verification guide](docs/INSTALLER_CANDIDATE.md), containing identifier/shared-group compatibility fixes but no new music mode. Independently downloaded and checked on 2026-11-08. Its identity-free metadata signatures do **not** authorize direct iPhone installation; personal signing is still required.

Cabin is a developer-stage iPhone app and ReplayKit broadcast extension for sharing permitted visible content with a user-owned browser on a trusted local network. A parked-car browser is one possible receiver, not a verified compatibility claim. Once installed and correctly provisioned, the native runtime needs no Mac, Node server, app account, cloud relay or paid API. Signing and periodic renewal are separate. Source changes do not retroactively change preview binaries.

**Not an App Store or TestFlight release; not signed or directly installable.** Check [GitHub Releases](https://github.com/citrus-13/cabin-direct-ios/releases) for actual preview availability and its linked [workflow evidence](https://github.com/citrus-13/cabin-direct-ios/actions/workflows/cabin-preview-release.yml). A preview package is built anew in **Release** configuration only after the configured CI test and packaged-privacy gates; these instructions do not assert that a pending run has succeeded or that a release already exists. The earlier `b2b8cb2` compile covers only the previous prototype. There is no signed IPA, public device-evidence screenshot, real iPhone / Tesla acceptance result, IPv6-only network proof or thermal endurance proof. No phone is currently available for the remaining device tests.

## Download or build

The [v0.4.0-preview.2 release](https://github.com/citrus-13/cabin-direct-ios/releases/tag/v0.4.0-preview.2) has exactly three uploaded assets: `CabinDirect-v0.4.0-preview.2-unsigned.ipa`, `BUILD-INFO.json` and `SHA256SUMS.txt`, with the tagged source archive also available through GitHub. Its source is `5c47c77222d9e8808d1a406f4e3b389bce68e342`; its [actual Release build](https://github.com/citrus-13/cabin-direct-ios/actions/runs/41929575013) passed with 161 source tests. Verify the checksums and build information together. An unsigned IPA is a reviewable packaging artifact, **not** an over-the-air installation, trusted signature or hardware test result. No private signing certificate, provisioning profile, account data, private source history or personal evidence is included.

Start with the [installation and signing guide](docs/INSTALL.md), preferably building from source in Xcode with your own free Personal Team. App Group / embedded-extension provisioning must be checked; success is not guaranteed for every free account or re-signing utility. Do not purchase membership merely to follow this guide. See [preview release notes](docs/RELEASE_NOTES_PREVIEW.md) for scope and limitations.

Development can continue through the public repository's free standard GitHub macOS runner without local Xcode. Read the [free-install and renewal plan](docs/FREE_INSTALL.md) for the separate device/signing gates and the new read-only `npm run check:install -- --app /absolute/path/CabinDirect.app` check. Neither cloud compilation nor that consistency check installs an app or proves a free re-signing route works.

Later source also includes conservative AltStore/SideStore identifier resolution and a separate [identity-free entitlement-packaging experiment](docs/FREE_INSTALL.md#identity-free-entitlement-packaging-experiment). These changes are **not in preview.2**. That experiment uses no Apple account and publishes no replacement IPA; its metadata signature is not Apple distribution signing or installation/renewal evidence.

## Native app flow

Remote App Store preparation continues in the [draft submission kit](docs/store/README.md). The v0.4.0-preview.2 source includes native privacy/support navigation, accessibility improvements and a separate Simulator UI-test scheme; preview.1 is historical. The [exact-commit store-preparation run](https://github.com/citrus-13/cabin-direct-ios/actions/runs/41927097055) passed three Simulator UI tests and produced eight original Simulator screenshots. This is Simulator evidence, not phone, capture or vehicle acceptance.

- **投屏 / Share:** the default screen has one start action, a stop action when active, and current address/code only for a fresh matching session. Starting saves validated settings and opens a short privacy confirmation before the genuine iOS broadcast picker. The app does not programmatically start capture.
- **设置 / Settings:** optional music recognition, separately consented lyrics, on-device visible-text extraction and its region. Privacy and About are secondary pages. Technical state, frame counters and diagnostic exports are not part of the interface.
- The existing player/audio route remains responsible for sound. Current source never consumes microphone buffers or relays audio to the receiver; optional experimental music may process system-provided app-audio buffers into Shazam fingerprints, only when explicitly selected for a user-started broadcast.

The original recording-free sample remains a development fixture, not a 0.5.1 app entry point. Its explicitly labeled synthetic frames must never be presented as phone or vehicle evidence.

For the app's guided sharing path, use **投屏 → 开始投屏**, acknowledge the privacy notice and confirm in iOS's broadcast panel. There is no separate save/test step. An already-configured extension may also be started explicitly from iOS Control Center; the extra in-app checkbox is not an unavoidable system gate. The app never starts capture automatically. Return to the app for the current address/code, connect your browser, then open content that permits screen recording. Moving the main app into the background **does not stop the real ReplayKit extension**. Keep the source visible; lock-screen continuity is not promised.

## Transport, privacy and stopping

**Local HTTP is unencrypted.** Use only a network you control; pairing is access control, not encryption. Do not expose the listener to the public internet or forward its port. Shared messages, notifications, screen content and optional OCR text can be sensitive. No universal music-app, DRM-video, background-music or locked-screen support is claimed.

- First pairing is limited to **120 seconds**, with at most **five wrong attempts per session**. Successful pairing uses an HttpOnly session cookie; addresses contain neither token nor pairing code. A real broadcast session has an **eight-hour maximum**, while the foreground sample is capped at ten minutes. New browsers after the pairing window need a newly started session.
- Capture preserves orientation/aspect ratio without upscaling, is bounded to 960/540 long/short edges and at most 8 fps, and retains latest results rather than a recording history. Optional OCR is off by default, stays on-device and recognizes only text visible within the selected region—not background tracks or guaranteed highlighted-lyric timing.
- Paused, stale or disconnected results are hidden. Listener readiness, heartbeats and encoded-frame counts are not proof that a browser or vehicle received a frame.
- An explicit app stop requests termination of the **matching** broadcast. The UI remains pending until runtime cleanup is reported. The sample similarly waits for server teardown before permitting a restart. You can also end real capture from the iPhone system recording indicator.
- Sessions retain their startup interface/address snapshot and advertise those addresses. An interface/address-set change ends the session; inspect the new trusted network, then start and pair again. The app does not change VPN or network settings.
- If an extension disappears without confirming stop, the UI does **not** infer success from heartbeat expiry. After checking the iPhone system recording state yourself, a confirmation can release only the local UI wait. It does not mark shared state stopped or invalidate old credentials.

The default screen-sharing path has no developer-server collection, tracking, login, remote OCR or network lyrics lookup. Current source has two separate opt-ins: app-audio fingerprints sent to Apple/Shazam for recognition, and title/artist sent to LRCLIB for current-track lyrics. Neither transfers raw audio or screenshots to those providers. The local receiver may display track metadata and bounded current lyric lines; it does not receive an audio stream. Read [music limitations](docs/MUSIC.md) and the [draft privacy statement](docs/PRIVACY.md) for third-party processing, storage, cookie, clipboard and crash-cleanup limits. Publisher contact details and public policy/support metadata are still required before submission.

## Shipping scope versus retained research

The `CabinDirect` target depends on DirectCore; `DirectBroadcastExtension` depends on DirectCore and DirectCapture. Current development adds `DirectLyrics` and ShazamKit to the broadcast path for the optional [experimental music mode](docs/MUSIC.md); earlier previews did not include this enabled functionality. TeslaBLE, vehicle enrollment, Bluetooth usage descriptions and shared-Keychain permissions remain excluded. Legacy vehicle settings fall back to screen sharing and do not reactivate vehicle access.

`ios/TeslaBLE/` and the older vehicle/lyrics bridge remain **research-only source and offline regression material**. `ios/Shared/DirectLyrics.swift` is an opt-in runtime dependency in the new developer preview, not proof of working music recognition on a signed phone. The older Node/WebRTC harness and its `TeslaCompanion` scheme are separate runtime paths. The shared Xcode project can resolve the legacy WebRTC package; that does not make WebRTC a Cabin Direct runtime dependency. Do not run legacy network/vehicle scripts merely to try the V1 sample.

## Build and local checks

Node.js 22+, macOS and XcodeGen 2.42+ support source checks/project generation. Actual iOS compilation requires full Xcode and an iPhoneOS SDK; Command Line Tools alone are insufficient.

```sh
npm ci --ignore-scripts
npm test
npm run check
CABIN_NATIVE_WORK_DIR=/absolute/external/native-checks npm run test:native
CABIN_IOS_WORK_DIR=/absolute/external/ios-build npm run ios:preflight
CABIN_IOS_WORK_DIR=/absolute/external/ios-build npm run build:ios
```

Keep generated build/report directories outside the repository. Use a per-command `DEVELOPER_DIR` if necessary; scripts do not change global Xcode selection. XcodeGen's ignored project/config files remain at their required `ios/` paths.

The manual `.github/workflows/cabin-public-build.yml` workflow is restricted to the approved maintainer's public repository and distinguishes actual unsigned compilation from source tests. Compile-only validation is separate from explicitly requested preview publication. The preview path rebuilds the exact revision in Release configuration, requires the configured tests and packaged-privacy validation, and publishes only the unsigned IPA, build information and checksums. It does not sign, purchase services, publish to App Store/TestFlight or use Apple-account secrets. Starting a workflow, passing source tests or creating a tag is not a successful release result; inspect the final run and assets.

Signing/provisioning, installing the app and embedded extension, and testing App Group access are separate user-controlled steps. Building from source for your device requires you to use your own Apple Account through Xcode; never put account credentials in shell commands or this repository. No paid membership purchase, optional installation utility or VPN replacement is required by this guide. See the [App Store readiness checklist](docs/APP_STORE_READINESS.md) for missing evidence and metadata; neither source publication nor a successful compile guarantees review acceptance.

The public project reference is the [existing GitHub repository](https://github.com/citrus-13/cabin-direct-ios). This does not establish an enabled issue tracker, support service or publisher identity/contact email. Real policy/support metadata remains pending for any future App Store submission. Do not post tokens, codes, profiles, device identifiers or private screens publicly.

## License, provenance and artwork

Original project source and original sample fixtures are Apache-2.0; third-party material retains its terms. See [LICENSE](LICENSE), [NOTICE](NOTICE), [THIRD_PARTY.md](THIRD_PARTY.md), the retained [Tesla research provenance](ios/TeslaBLE/PROVENANCE.md) and [upstream license](ios/TeslaBLE/LICENSE-TESLA), and [legacy WebRTC notices](ios/App/ThirdPartyNotices.txt). Research notices describe retained source, not shipping permissions or features. Third-party song lyrics are not bundled or licensed by this repository.

The opaque 1024 × 1024 app icon is original geometric artwork generated by [scripts/make-app-icon.swift](scripts/make-app-icon.swift), without third-party imagery, fonts or product logos. To reproduce a comparison file on macOS:

```sh
swift scripts/make-app-icon.swift /absolute/external/AppIcon.png
```

The bundled result lives in `ios/AppAssets.xcassets/AppIcon.appiconset/`. Original artwork is not trademark/name clearance. Cabin Direct is not affiliated with Tesla, Apple or any music service; no store listing, pricing promise or commercial approval is established.
