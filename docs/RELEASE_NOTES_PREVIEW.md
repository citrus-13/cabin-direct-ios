# Cabin Direct v0.4.0-preview.1 — unsigned prerelease

**Source version 0.4.0. Experimental preview, not a stable release, App Store approval or TestFlight distribution.** Availability is established only by the actual [GitHub Releases page](https://github.com/citrus-13/cabin-direct-ios/releases) and its linked successful workflow. These notes do not claim a pending build succeeded. The previous `b2b8cb2` compile is earlier-prototype evidence, not evidence for this preview's exact source.

## Included functionality

- Native **Connect / Share / Help**, saved settings, truthful live/paused/stale state, explicit matching-session stop and redacted diagnostics.
- User-initiated ReplayKit screen sharing to a paired browser through an iPhone-local HTTP/MJPEG service; optional on-device visible-text OCR with an adjustable region. Capture is never started programmatically. The in-app guided path has an acknowledgment; iOS may also start an already-configured extension through explicit Control Center actions.
- Original 960 × 540 synthetic sample on the same production pairing/state/frame transport: at most 1 fps, ten-minute maximum, foreground-only and clearly labeled DEMO—not your phone screen. Use a second user-owned browser device while the iPhone app stays foregrounded; no Tesla is needed for this test.
- Six-digit pairing available for 120 seconds, at most five wrong attempts, credential-free URLs, HttpOnly session cookie and an eight-hour maximum for real broadcast sessions. Paused/stale results are hidden. Network-interface/address changes terminate the session and require manual restart/re-pairing.
- Stop acknowledgment waits for actual server cleanup. If an extension dies without confirmation, explicit user-checked recovery releases only local UI waiting and never fabricates a successful stop.

No developer cloud, app account, tracking, microphone/audio relay, paid API, vehicle enrollment or remote lyrics service is enabled in the V1 targets. TeslaBLE/DirectLyrics and the legacy Node/WebRTC harness remain separate research source/offline regression material. The original player keeps its audio route.

## Package and verification

The release profile rebuilds the exact source in **Release configuration**, runs the configured CI tests and packaged-privacy gates, then publishes three assets:

1. `CabinDirect-v0.4.0-preview.1-unsigned.ipa`
2. `BUILD-INFO.json`
3. `SHA256SUMS.txt`

GitHub also offers the tagged source archive. No Apple signing certificate, provisioning profile, private repository history, personal device evidence or account data is included. Use `shasum -a256 -c SHA256SUMS.txt` with all assets together, inspect the build information and matching source, then follow [INSTALL.md](https://github.com/citrus-13/cabin-direct-ios/blob/v0.4.0-preview.1/docs/INSTALL.md). A checksum is not a trusted app signature. **The IPA is unsigned and cannot install directly; correct app/extension signing and provisioning remain your own separate steps.** Start with Xcode/free Personal Team if available; required App Group support and third-party re-signing are not guaranteed. No membership purchase or VPN replacement is requested.

## Known limits and security

**HTTP is unencrypted.** Only use a trusted local network, protect the pairing code and do not expose the listener to the internet. Shared screens can contain private notifications. OCR may be wrong or delayed; DRM/protected content may black out and is not bypassed. There is no universal music-platform or lock-screen guarantee.

No phone is currently available for acceptance testing. There is no signed IPA/install proof, actual iPhone capture acceptance, parked Tesla/firmware acceptance, IPv6-only network proof or thermal/endurance proof. A CI build, self-rendered sample or desktop receiver cannot establish those outcomes. Backgrounding the main app does not stop the real ReplayKit extension; the sample does stop. Runtime independence from a Mac does not eliminate signature expiry or renewal.

The [privacy statement](https://github.com/citrus-13/cabin-direct-ios/blob/v0.4.0-preview.1/docs/PRIVACY.md) remains a source-reviewed draft; real publisher contact, policy/support metadata, device screenshots and other [App Store readiness work](https://github.com/citrus-13/cabin-direct-ios/blob/v0.4.0-preview.1/docs/APP_STORE_READINESS.md) remain separate. Original icon generation and license/provenance are documented in the [README](https://github.com/citrus-13/cabin-direct-ios/blob/v0.4.0-preview.1/README.md). The project is unaffiliated with Tesla, Apple or music services, and makes no trademark-clearance or pricing promise.

中文摘要：这是未签名预览包，不是 App Store / TestFlight，也不能直接安装。请先核对构建信息与校验和，再自行确认 Xcode 签名、App Group 和录屏扩展。手机尚不可用，真机、实车与稳定性未验收；HTTP 不加密，仅在可信局域网、停车状态下测试。运行时不依赖 Mac，不代表免签名或永久安装。
