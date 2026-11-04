# Cabin Direct — V1 local screen companion

Version **0.4.0** is a developer-stage, source-only iPhone app and ReplayKit broadcast extension for sharing permitted visible content with a user-owned browser on a trusted local network. A parked-car browser is one possible receiver, not a verified compatibility claim. The native runtime needs no Mac, Node server, account, cloud relay or paid API.

**Not App Store approved, signed, installed or device-validated.** The previously recorded unsigned iOS compile for `b2b8cb2` covers the earlier prototype only. Actual compilation of any V1 revision requires its own [recorded workflow result](https://github.com/citrus-13/cabin-direct-ios/actions/workflows/cabin-public-build.yml); verify the exact commit, actual compiler output and packaged privacy checks. There is no signed IPA, public device-evidence screenshot, real iPhone / Tesla acceptance result, IPv6-only network proof or thermal endurance proof. A green source test or old compile cannot establish those outcomes.

## Native app flow

- **Connect:** network guidance, current session address and code, an original foreground-only sample, and redacted runtime diagnostics.
- **Share:** save settings, optionally enable on-device visible-text recognition and adjust its region, acknowledge screen/notification exposure, then personally operate the genuine iOS system broadcast picker. The app does not programmatically start capture.
- **Help:** privacy, connection troubleshooting, audio behavior and compatibility limits. The existing player and existing audio route remain responsible for sound; V1 neither captures nor relays microphone or app audio.

For a recording-free check, connect the iPhone and a **second user-owned browser device** to the same trusted Wi-Fi / hotspot. Keep Cabin Direct in the foreground, start its original sample, enter the displayed address in that other browser and pair with the separately displayed six-digit code. The sample sends self-rendered 960 × 540 JPEG cards through the **same DirectCore server, pairing, state and image transport** used by real broadcasts. It advances at no more than 1 fps, is clearly labeled “DEMO / original sample / not your phone screen,” expires within ten minutes and stops when the app is not active. It requires no Tesla and provides no evidence of screen capture or vehicle compatibility.

For real sharing, use **Share**, save settings, acknowledge the privacy notice and confirm in iOS's broadcast panel. Return to the app for the current address/code, connect your browser, then open content that permits screen recording. Moving the main app into the background **does not stop the real ReplayKit extension**. Keep the source visible; lock-screen continuity is not promised.

## Transport, privacy and stopping

**Local HTTP is unencrypted.** Use only a network you control; pairing is access control, not encryption. Do not expose the listener to the public internet or forward its port. Shared messages, notifications, screen content and optional OCR text can be sensitive. No universal music-app, DRM-video, background-music or locked-screen support is claimed.

- First pairing is limited to **120 seconds**, with at most **five wrong attempts per session**. Successful pairing uses an HttpOnly session cookie; addresses contain neither token nor pairing code. A real broadcast session has an **eight-hour maximum**, while the foreground sample is capped at ten minutes. New browsers after the pairing window need a newly started session.
- Capture preserves orientation/aspect ratio without upscaling, is bounded to 960/540 long/short edges and at most 8 fps, and retains latest results rather than a recording history. Optional OCR is off by default, stays on-device and recognizes only text visible within the selected region—not background tracks or guaranteed highlighted-lyric timing.
- Paused, stale or disconnected results are hidden. Listener readiness, heartbeats and encoded-frame counts are not proof that a browser or vehicle received a frame.
- An explicit app stop requests termination of the **matching** broadcast. The UI remains pending until runtime cleanup is reported. The sample similarly waits for server teardown before permitting a restart. You can also end real capture from the iPhone system recording indicator.
- Sessions retain their startup interface/address snapshot and advertise those addresses. An interface/address-set change ends the session; inspect the new trusted network, then start and pair again. The app does not change VPN or network settings.
- If an extension disappears without confirming stop, the UI does **not** infer success from heartbeat expiry. After checking the iPhone system recording state yourself, a confirmation can release only the local UI wait. It does not mark shared state stopped or invalidate old credentials.

V1 has no developer-server collection, tracking, login, remote OCR or network lyrics service. Read the [draft privacy statement](docs/PRIVACY.md) for storage, cookie, clipboard and crash-cleanup limits. Publisher contact details and public policy/support metadata are still required before submission.

## Shipping scope versus retained research

The `CabinDirect` target depends on DirectCore; `DirectBroadcastExtension` depends on DirectCore and DirectCapture. Neither shipping target includes TeslaBLE, vehicle enrollment, LRCLIB, DirectLyrics, Bluetooth usage descriptions or shared-Keychain permissions. Legacy vehicle settings fall back to screen sharing and do not reactivate vehicle access.

`ios/TeslaBLE/`, `ios/Shared/DirectLyrics.swift` and the vehicle/lyrics bridge remain **research-only source and offline regression material**, not enabled V1 functionality. The older Node/WebRTC harness and its `TeslaCompanion` scheme are separate runtime paths. The shared Xcode project can resolve the legacy WebRTC package; that does not make WebRTC a Cabin Direct runtime dependency. Do not run legacy network/vehicle scripts merely to try the V1 sample.

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

The manual `.github/workflows/cabin-public-build.yml` workflow is restricted to the approved maintainer's public repository, uses a standard hosted runner with a 30-minute limit and read-only repository permissions, and distinguishes actual unsigned compilation from source tests. It has no push/PR/schedule trigger, paid fallback, artifact upload, release publication, signing or Apple-account secrets. It records revision and bounded build evidence; products are ephemeral, not installable IPA downloads. Starting a workflow or passing source tests is not an actual-build result.

Signing/provisioning, installing the app and embedded extension, and testing App Group access are separate user-controlled steps. No account registration, purchase, installation utility or VPN setup is required by these source instructions. See the [App Store readiness checklist](docs/APP_STORE_READINESS.md) for missing evidence and metadata; neither source publication nor a successful compile guarantees review acceptance.

## License, provenance and artwork

Original project source and original sample fixtures are Apache-2.0; third-party material retains its terms. See [LICENSE](LICENSE), [NOTICE](NOTICE), [THIRD_PARTY.md](THIRD_PARTY.md), the retained [Tesla research provenance](ios/TeslaBLE/PROVENANCE.md) and [upstream license](ios/TeslaBLE/LICENSE-TESLA), and [legacy WebRTC notices](ios/App/ThirdPartyNotices.txt). Research notices describe retained source, not shipping permissions or features. Third-party song lyrics are not bundled or licensed by this repository.

The opaque 1024 × 1024 app icon is original geometric artwork generated by [scripts/make-app-icon.swift](scripts/make-app-icon.swift), without third-party imagery, fonts or product logos. To reproduce a comparison file on macOS:

```sh
swift scripts/make-app-icon.swift /absolute/external/AppIcon.png
```

The bundled result lives in `ios/AppAssets.xcassets/AppIcon.appiconset/`. Original artwork is not trademark/name clearance. Cabin Direct is not affiliated with Tesla, Apple or any music service; no store listing, pricing promise or commercial approval is established.
