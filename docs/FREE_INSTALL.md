# Free development, installation and renewal: separate gates

Checked against primary documentation on **2026-11-05**. No payment, signing account, certificate export, cloud credential upload or VPN replacement is requested by this guide. Cabin Direct remains a developer preview, not an installable App Store/TestFlight release.

## Continue development without local Xcode

Keep the native Swift/ReplayKit project. Editing code and running the repository's free standard GitHub macOS workflow do not require Xcode on the user's own Mac. Public repositories' standard hosted runners are currently free ([GitHub policy](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job)); do not switch to larger/paid runners, a private-repository paid allocation or external paid build service.

The existing [preview.2](https://github.com/citrus-13/cabin-direct-ios/releases/tag/v0.4.0-preview.2) is an unsigned arm64 iOS app **plus** ReplayKit extension, from source `5c47c77222d9e8808d1a406f4e3b389bce68e342`. The [Release build](https://github.com/citrus-13/cabin-direct-ios/actions/runs/41929575013) and [separate Simulator run](https://github.com/citrus-13/cabin-direct-ios/actions/runs/41927097055) establish remote build/test evidence only. Later source-level checks do not change the released IPA. Keep historical release files and tags intact.

## Choose a first-install route only after checking prerequisites

| Route | Prerequisite and remaining risk |
| --- | --- |
| Xcode + free Personal Team | Recommended first-validation route for this native source. Needs full compatible Xcode, personal Apple sign-in, correctly provisioned host/extension/shared group, and a supported connection to the iPhone. No membership purchase. |
| SideStore | Candidate for later renewal without a nearby computer, **not a verified Cabin installer**. Current official initial setup uses a computer, USB, trust and personal account approval; refresh has Wi-Fi/local-VPN prerequisites. Do not disable or replace an existing VPN silently. |
| AltStore Classic / AltServer | Alternative installer, not a replacement for iOS signing. Initial setup and subsequent refresh require the documented computer/device connection. Remote access to a distant Mac alone is not proof this works. |
| Website / PWA | No native signing for a webpage, but not a drop-in replacement for this app's ReplayKit upload extension and shared container. Keep it a separate reduced-function candidate, not a completed mirroring solution. |

Primary instructions: [Apple Personal Team](https://developer.apple.com/help/account/basics/about-your-developer-account), [SideStore installation](https://docs.sidestore.io/docs/installation/install), [SideStore prerequisites](https://docs.sidestore.io/docs/installation/prerequisites), [AltStore Classic on macOS](https://faq.altstore.io/altstore-classic/how-to-install-altstore-macos), [AltServer connectivity](https://faq.altstore.io/altstore-classic/altserver).

Apple's current [Device Hub instructions](https://developer.apple.com/documentation/xcode/managing-your-simulated-and-physical-devices-in-device-hub) permit initial wireless pairing on iOS/iPadOS 27+ when both devices are on the **same Wi-Fi**, with on-device PIN/trust/Developer Mode steps. Earlier versions use the documented cable path. An Internet connection or Tailscale membership does not establish that this pairing prerequisite is satisfied. Do not copy private pairing records into the repository, reports or a cloud runner.

## Do not treat re-signing as a generic one-click fix

The host and ReplayKit extension need compatible App Groups. A tool may change bundle IDs and group entitlements without updating our custom `TCAppGroupIdentifier` and `TCBroadcastExtensionIdentifier` Info.plist values. An unsigned Mach-O also has no existing signed entitlement blob for a re-signer to discover. Do not infer that a tool reconstructs these capabilities merely because source `.entitlements` files exist in the repository. Exact tool-version behavior and the resulting signed products must be checked; **stock import of preview.2 has not been accepted as working**.

Source evidence: SideStore 0.6.4's pinned [SideSign entitlement reader](https://github.com/SideStore/SideSign/blob/7f818429fec3c8d7b63871b8bfdf063603cd2115/Sources/Models/AppBundle.swift#L166-L177) and [signing filter](https://github.com/SideStore/SideSign/blob/7f818429fec3c8d7b63871b8bfdf063603cd2115/Sources/CodeSigning/CodeSignerAPI.swift#L95-L122), plus its [profile preparation](https://github.com/SideStore/SideStore/blob/0.6.4/SideStore/Core/Operations/PipelineOperations/FetchProvisioningProfilesOperation.swift#L291-L301), show why missing input group entitlements are not inferred. AltStore v2.3's pinned [reader](https://github.com/rileytestut/AltSign/blob/0d3c1a3cac608e724ca0c8d7404253cd5fee9495/AltSign/Model/ALTApplication.mm#L153-L192) and [filter](https://github.com/rileytestut/AltSign/blob/0d3c1a3cac608e724ca0c8d7404253cd5fee9495/AltSign/Signing/ALTSigner.mm#L353-L396) have the same relevant behavior. This is source analysis, not an executed installer test. Readable entitlement metadata need not be a previous valid Apple-issued signature, but an identity-free ad-hoc packaging experiment would still need separate validation and must not replace the historical unsigned release silently.

The required relationships are listed in [INSTALL.md](INSTALL.md#recommended-build-from-source-with-xcode). Keep the extension. Never strip required entitlements to make an installer report success, add unrelated capabilities, buy membership, use another publisher's certificate, or claim a free route is proven without device testing. Apple's [entitlement troubleshooting guide](https://developer.apple.com/library/archive/technotes/tn2415/_index.html) explains why the signed entitlements and embedded profile—not only source settings—matter.

## Read-only local signing check

After signing **personally and locally** through an authorized route, use the default branch's tool on the resulting `CabinDirect.app` (for an IPA, use your trusted archive utility to inspect/extract your own package first):

```sh
npm run check:install -- --app /absolute/path/CabinDirect.app
```

Requires Node 22+ and macOS system `plutil`, `codesign` and `security`. It does not need the Xcode GUI or login and does not write files. It only examines the explicit app and its one embedded extension, never enumerates Keychain identities or the computer's pairing/profile stores, and never contacts a server.

Checks include:

- arm64 iOS executable format and local `codesign --verify --strict` integrity for both products;
- exact development-profile application identifiers, matching signing teams and shared group;
- both custom Info.plist references, embedded ReplayKit configuration and matching product versions;
- bounded development entitlement allowlist and default per-app Keychain access only when provisioned;
- profile creation/expiry dates, using the **earlier** host/extension expiry for a 48-hour renewal warning.

Output is an allowlisted redacted JSON summary: no paths, Apple IDs, Team IDs, device IDs, group names, certificate material or raw tool errors. Input profiles remain local/in memory. The script does not accept arbitrary tool-path overrides or shell commands.

Interpretation:

- Exit `0`, `consistency_passed_device_acceptance_pending`: these narrow consistency checks passed, **not** an installation guarantee.
- Exit `1`, `blocked_before_device_acceptance`: one or more fixed failure codes identify mismatched settings or expired profiles. Inspect your local signing settings; do not publish raw profiles.
- Exit `1`, `inspection_incomplete`: missing/unsigned/unreadable/unsupported product, profile or tool result. The public unsigned preview is expected to fail here. This is not evidence that signing is impossible.

The checker deliberately does **not** prove Apple profile trust, signing certificate membership in the profile, account tier, registration of your particular phone, full entitlement authorization, source/binary authenticity, installability, revocation state, expiry of the signing certificate, phone behavior or renewal. Apple/iOS still makes the installation decision. It is a conservative check of this project's development layout, not a universal app or distribution validator. No real personally signed product has yet been validated; unit fixtures are synthetic and explicitly labeled.

## Renewal and stability acceptance

Apple documents **seven-day** Personal Team provisioning expiry. A free installation is not permanent; an automatic refresh candidate must still successfully renew before expiry. Do not promise unattended indefinite use. Preserve your own trusted signing setup and plan for an unavailable phone/network, expired session, changed pairing, account reauthentication and signing-tool updates.

Before calling a route stable, record the following locally without account/device secrets:

1. Install the host **and** extension; verify shared-container access and local-network permission on the real phone.
2. Use the original foreground sample with a second user-owned browser; establish pairing and actual changing frames.
3. Personally start ReplayKit; verify actual permitted screen content, orientation, pause/resume, stale clearing and stopping. A sample is not capture evidence.
4. Renew with the chosen free route while still valid, then confirm **both** product profiles actually advanced, reopen and repeat capture. A refresh button saying success is insufficient.
5. Repeat across a real renewal boundary and an interrupted-refresh/recovery case. Do not manipulate device clocks or security checks to fabricate success. Never uninstall user data merely to retry.
6. Separately test screen-lock behavior, backgrounding, network changes, a bounded endurance session, and later a parked Tesla's specific browser/firmware. Record unsupported cases honestly.

Status today: remote compilation and Simulator evidence exist; personal signing, installation, actual ReplayKit capture, successful renewal and vehicle acceptance remain **pending**. No paid program, VPN mutation, new public device evidence or account credential upload is authorized by this guide.
