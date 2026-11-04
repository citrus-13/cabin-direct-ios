# V1 App Store readiness — working checklist

Scope: Cabin Direct 0.4.0, a native iPhone local screen companion with a ReplayKit extension and browser receiver. This is an engineering/submission-preparation checklist, **not App Store approval, a legal opinion or an installable release**.

## Evidence gates

| Gate | Current evidence / required next proof |
| --- | --- |
| Published developer preview | [v0.4.0-preview.1](https://github.com/citrus-13/cabin-direct-ios/releases/tag/v0.4.0-preview.1), source12517ec: actual unsigned Release compilation and121 source tests passed; downloaded metadata/checksums independently verified. |
| Updated source / simulator | New store-preparation changes require their own exact-commit iOS and real Simulator run. Do not transfer the historical IPA's evidence automatically; consult the dedicated workflow and simulator report. |
| Signing and installation | No signed IPA, provisioned installation or verified App Group / ReplayKit entitlement behavior. |
| Actual native sample | Source implements an original sample on production transport; verify startup, permission denial/retry, browser pairing, frame advance, expiry and acknowledged teardown on a real iPhone. |
| Actual screen broadcast | Verify manual capture initiation, rotation, optional OCR region, notifications, pause/resume, stale clearing, matching stop, forced termination and explicit unconfirmed UI recovery. |
| Network/device coverage | Trusted Wi-Fi and hotspot, address-change teardown, IPv4/IPv6-only reachability and browser fallback require live evidence. No IPv6-only proof yet. |
| Stability and safety | No thermal/endurance/battery proof or parked Tesla acceptance. Calls, lock/unlock, system termination and long sessions remain tests, not guarantees. |
| Submission materials | [Draft kit](store/README.md) now includes bounded Chinese metadata, English reviewer instructions, disclosure/rights worksheets and screenshot/accessibility plan. Publisher/contact, finalized URLs, real-device proof and submission remain pending. |

The code supplies Connect / Share / Help, diagnostics, a real system broadcast picker and an optional on-device visible-text region. The original sample is foreground-only, at most 1 fps and ten minutes; it is neither recorded phone content nor a fake successful vehicle connection. The main app entering the background must not terminate a real ReplayKit broadcast. Both runtimes must finish server cleanup before reporting a completed stop.

## Reviewable path without a Tesla

After obtaining an authorized, correctly signed build, a reviewer can keep the iPhone app foregrounded on trusted Wi-Fi, open **Connect → original sample**, enter its displayed address on a second user-owned browser device, then enter its separate six-digit code within 120 seconds. Check advancing original JPEG frames, the DEMO banner, state refresh, disconnect/re-pair limits, network changes and explicit stop. This uses the same LocalHTTPServer, bundled receiver, authentication and frame/state routes as the real broadcast; no developer account, vehicle enrollment or cloud server is needed at runtime.

Separately test **Share**: save settings, optionally enable visible-text recognition, acknowledge privacy, manually start the iOS broadcast picker, pair the other browser and display permitted original content. Confirm that backgrounding the main app leaves the real extension running; use app stop or the iOS recording indicator to end it. Keep screen contents non-sensitive and do not submit fabricated capture or vehicle evidence.

This is a proposed reproducible review procedure, **not a promise that the sample alone satisfies App Review**. The app must provide adequate finished utility and reviewers must be able to inspect its actual features. Explain the second-browser/local-network dependency and extension clearly. Consult Apple's [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/), particularly completeness, accurate metadata, minimum functionality, extensions and privacy; approval is Apple's decision. Parked-car compatibility remains a separate hardware/firmware acceptance track, with no universal music, DRM or lock-screen guarantee.

## Privacy and manifest audit

- `ios/PrivacyInfo.xcprivacy`: declares no tracking, collected-data categories or required-reason API categories for the app target.
- `ios/Privacy/Broadcast/PrivacyInfo.xcprivacy`: declares `NSPrivacyAccessedAPICategorySystemBootTime`, reason `35F9.1`, solely for local elapsed-time frame/OCR admission pacing. Device uptime is not placed in public state, diagnostics or off-device data.
- Re-audit the final binary and dependencies, not only source manifests. Apple's [required-reason API documentation](https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api) governs declarations; manifest presence is not compliance approval.
- The [privacy draft](PRIVACY.md) describes V1's intended no-developer-collection behavior. Complete and verify publisher information, policy hosting, support/contact metadata and [App Store privacy answers](https://developer.apple.com/app-store/app-privacy-details/) for the actual submitted build. No privacy label is approved or submitted by this checklist.
- Keep TeslaBLE, vehicle enrollment, LRCLIB and DirectLyrics research source outside both V1 targets and permissions. Re-check that neither target gains Bluetooth or shared-Keychain permission through a later project change.
- Explicitly disclose user-initiated recording, visible notification risks, optional OCR, local **unencrypted HTTP**, session pairing, ephemeral browser credentials and retained local settings. Do not describe local pairing as encryption.

## Before any submission

- [ ] Record a passing actual unsigned V1 compile for the exact submitted source; then independently sign/install and validate both app and extension on-device.
- [ ] Complete the browser/sample and real ReplayKit tests above, including cleanup callbacks, 120-second / five-error pairing limits, eight-hour broadcast expiry, changed-network termination and no false stop confirmation.
- [ ] Test denied local-network access, app lifecycle, accessibility/text sizes, orientations, supported device sizes and IPv6-only environments; resolve crashes and misleading states.
- [ ] Complete separate parked-car and thermal/endurance acceptance before making those claims.
- [ ] Supply real publisher contact, working support/policy URLs, accurate age/category/content metadata and honest device screenshots. No placeholders or invented contact details.
- [ ] Review name/trademark and content rights. Original icon geometry is reproducible with `swift scripts/make-app-icon.swift /absolute/external/AppIcon.png`; it does not clear a product name or third-party marks.
- [ ] Preserve [LICENSE](../LICENSE), [NOTICE](../NOTICE), [third-party inventory](../THIRD_PARTY.md), [Tesla research provenance](../ios/TeslaBLE/PROVENANCE.md) and [legacy WebRTC notices](../ios/App/ThirdPartyNotices.txt). Do not imply retained research runs in V1.
- [ ] Replace developer-stage notices only after the corresponding evidence exists; make no claim of approval, installation or universal compatibility in advance.

No fees, purchases, developer-account changes, publication or pricing/monetization decision are authorized by this checklist.
