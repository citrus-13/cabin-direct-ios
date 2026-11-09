# App Store readiness — 0.8.0 working checklist

Scope: foreground Tesla BLE lyrics in the CabinDirect host, plus separate ReplayKit screen sharing and a local browser receiver. This is engineering/submission preparation, **not App Store approval, a legal opinion, an installed build or an authorized submission**. Existing draft store materials must be reconciled with this feature set before use.

## Current evidence gates

| Gate | Evidence / missing proof |
| --- | --- |
| Offline BLE and lyric clock | Integration record reports 46 local public/synthetic protocol/clock checks passed. No vehicle, Bluetooth or Keychain access is implied. |
| Exact 0.8.0 compilation/UI | iOS/cloud compilation and safe Simulator UI results pending at this documentation update. Inspect exact-commit reports rather than transferring older passes. |
| Signing/installation | Current signed phone installation, host-default Keychain and extension/App Group behavior remain independent unverified gates. |
| Tesla authorization | Real Monitor enrollment/keycard/NFC flow, granted permissions and authenticated media availability must be verified on an authorized parked vehicle. |
| Metadata/timing | Check firmware, position/duration units, missing fields, native and phone-fed music sources, pause/seek/change and six-second staleness on hardware. |
| Lifecycle | Verify foreground display-awake behavior, previous idle-timer restoration, background stop, no automatic restart, disconnect and error cleanup. |
| Screen/audio | Real ReplayKit start/stop, system-permitted audio, optional Shazam service admission, receiver sound and fallback still require device/browser proof. |
| Network/endurance | Trusted Wi-Fi/hotspot, permission denial, address changes, IPv4/IPv6-only, battery/thermal/endurance and actual vehicle-browser behavior remain acceptance work. |
| Submission | Publisher/contact, final URLs, rights, privacy labels, screenshots and explicit submission authority remain unresolved. |

Historical only: [v0.5.0-preview.1](https://github.com/citrus-13/cabin-direct-ios/releases/tag/v0.5.0-preview.1), source `4ec061d`, has recorded [Release compilation and 239 tests](https://github.com/citrus-13/cabin-direct-ios/actions/runs/42476798870) with independent package checks. Earlier 0.4.0 store preparation also recorded Simulator navigation/screenshots. Neither validates the 0.8.0 BLE runtime, a signed phone, Monitor authorization or App Store acceptance. Superseded microphone/background designs are not the current scope.

## Review paths and required dependencies

The actual UI is **首页** with **歌词 / 投屏** selection, plus **设置** and nested privacy/About pages. The old original development sample is not an ordinary home entry point; do not instruct reviewers to use removed Connect/Share/Help or diagnostic screens.

For screen mode, a correctly signed phone and second user-owned browser on trusted Wi-Fi can exercise **投屏 → 开始投屏**, its notice, genuine iOS broadcast picker, local URL and separate six-digit web code. Use original permitted content. Verify real capture, receiver behavior, stop, staleness and address changes. Backgrounding the host must not itself terminate ReplayKit.

Full Tesla lyrics evaluation needs an authorized parked Tesla: valid VIN, separately confirmed Monitor enrollment and possible keycard/NFC action, then separately confirmed start/LRCLIB processing. A simulator or second browser cannot prove vehicle enrollment or media semantics. Give reviewers an authorized workable review plan for vehicle-dependent functionality before submission; do not claim the screen-only path tests all features.

No account, Tesla cloud/OAuth, paid API or microphone is part of BLE lyrics. The host uses its default Keychain without a shared vehicle-key access group. Monitor grants broader read-only authority than media, while this app's request allowlist is media-only; explain both accurately.

## Privacy and package audit

- Verify host Bluetooth/local-network purpose strings, no microphone/background-mode declarations, and no vehicle keys or BLE operation in the extension.
- Confirm opening/tab selection/VIN typing causes no vehicle action, key access, listener or provider lookup. Separate explicit enrollment from per-session lyric consent; cancellation must be inert.
- Confirm VIN persists only after explicit valid pairing/start and never appears in logs, provider calls or webpage state. Keys remain host-local; normal session stop does not revoke enrollment.
- Confirm only consented current-track title/artist/duration goes to LRCLIB. Optional screen Shazam is a separate opt-in and receives signatures, not raw audio/screens.
- Audit exact app/extension privacy manifests and required-reason API declarations against the implementation and binary, not older checklist claims. Source manifests are not approved privacy labels.
- Disclose broader Monitor authorization, vehicle revocation, retained VIN/keys, foreground-only lifecycle, local **unencrypted HTTP**, short-lived web pairing and receiver copying.
- Preserve [NOTICE](../NOTICE), [third-party inventory](../THIRD_PARTY.md), [Tesla protocol provenance](../ios/TeslaBLE/PROVENANCE.md) and its [upstream license](../ios/TeslaBLE/LICENSE-TESLA) in distributions containing the adapted runtime.
- Reconcile the [draft privacy statement](PRIVACY.md), [support page](SUPPORT.md), [music acceptance checklist](MUSIC.md#evidence-and-acceptance) and older [store draft kit](store/README.md) before use. No placeholder publisher/contact or outdated microphone/research-only claims may be submitted.

## Before any submission

- [ ] Exact-commit iOS host/extension build and safe UI tests pass, including invalid VIN, consent cancellation and no automatic operations.
- [ ] Independently sign/install and validate host Keychain, App Group/ReplayKit, local-network and Bluetooth denial/retry.
- [ ] Complete actual parked-car enrollment/Monitor/firmware/media-field checks and multi-source metadata tests.
- [ ] Validate pause/resume/seek/track changes, unknown state, six-second stale hiding, disconnect, background stop and idle-timer restoration.
- [ ] Validate real screen/audio and optional recognition/lyrics boundaries independently.
- [ ] Check 120-second/five-error web pairing, session expiry, no token/VIN URL leakage, address-change cleanup and honest stop confirmation.
- [ ] Check accessibility, supported screens/orientations, privacy/consent readability and IPv6-only behavior.
- [ ] Obtain thermal/endurance evidence before making reliability claims; no universal lock-screen or music-platform promises.
- [ ] Supply real publisher/contact, working policy/support URLs, accurate metadata, rights analysis and honest screenshots of the actual build.
- [ ] Resolve lyric/content and name/trademark rights; API access and original icon/source licensing do not clear them.
- [ ] Agree an accessible review plan for vehicle-dependent functionality and obtain explicit submission authority.

No fees, purchases, account changes, publication or pricing decision is authorized by this checklist. Apple's [review guidelines](https://developer.apple.com/app-store/review/guidelines/) remain a reference, not an approval forecast or freshly verified legal determination.
