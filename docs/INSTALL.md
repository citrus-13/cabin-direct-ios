# Installing the unsigned preview

Preview tag: **v0.4.0-preview.1**; source version: **0.4.0**. This is not App Store/TestFlight distribution. The download, if published, is **unsigned and cannot be installed directly**. You must build/sign or re-sign it using your own authorized account and inspect both the app and ReplayKit extension. No signed IPA, device installation or vehicle acceptance is claimed. A physical iPhone is needed; remote source/CI checks cannot replace it.

## Recommended: build from source with Xcode

Use a Mac with a current full Xcode compatible with your phone's iOS, its iPhoneOS SDK and XcodeGen 2.42+. Command Line Tools alone are insufficient. The source deployment minimum is iOS 16. Node.js 22+ is needed for the repository's JavaScript checks, not for the native app at runtime.

1. Get the source from the [public repository](https://github.com/citrus-13/cabin-direct-ios) or GitHub's tagged source archive. When the preview tag has actually been published, select `v0.4.0-preview.1` and compare its commit with `BUILD-INFO.json`. Review the source and [privacy draft](PRIVACY.md); do not treat a downloaded binary as trusted solely because its checksum matches.
2. From the source root, generate and open the project:

   ```sh
   xcodegen --spec ios/project.yml --project ios
   open ios/TeslaCompanion.xcodeproj
   ```

   The project filename is historical. Choose the **CabinDirect** scheme, **not TeslaCompanion**. Project generation follows [XcodeGen's official usage documentation](https://github.com/yonaskolb/XcodeGen/blob/master/Docs/Usage.md). Regenerating overwrites generated project settings, so keep any durable local configuration in your own reviewed copy of `ios/project.yml`.
3. In **Xcode → Settings → Accounts**, sign in yourself and select your free **Personal Team**, if available. In each of **CabinDirect** and **DirectBroadcastExtension → Signing & Capabilities**, use the same team and inspect automatic signing. Enter credentials only into the Apple/Xcode UI; this repository and CI need no Apple password, certificate or provisioning profile.
4. In the project's build settings, choose a unique `APP_BUNDLE_PREFIX` you control; do not use the repository's `com.example` default. Preserve the derived settings and their relationship below. Ensure **both targets** share the same provisioned App Group. Merely changing one target's Bundle Identifier, or letting a re-signing tool rewrite identifiers independently, is insufficient.
5. Connect/unlock your iPhone, approve its trust/developer-mode prompts as required by iOS, choose it as the run destination and build/run **CabinDirect**. Follow [Apple's physical-device running guidance](https://developer.apple.com/documentation/xcode/running-your-app-on-simulated-or-physical-devices). Confirm the installed app contains its broadcast extension and can access the shared group before trying real sharing.

Expected identifier relationships after substituting your own prefix:

| Value | Must resolve to |
| --- | --- |
| `DIRECT_APP_BUNDLE_PREFIX` | `$(APP_BUNDLE_PREFIX).direct` |
| Main app bundle identifier | `$(DIRECT_APP_BUNDLE_PREFIX)` |
| Embedded extension bundle identifier | `$(DIRECT_APP_BUNDLE_PREFIX).broadcast` |
| `DIRECT_APP_GROUP_IDENTIFIER` | `group.$(DIRECT_APP_BUNDLE_PREFIX)` |
| `TCAppGroupIdentifier` in **both** Info.plists | The same actual, provisioned App Group identifier |
| Main app `TCBroadcastExtensionIdentifier` | The actual embedded extension bundle identifier |
| `com.apple.security.application-groups` in both **signed entitlements** | The same group allowed by both provisioning profiles |

Inspect the **signed** products, not just the source `.entitlements` files. Xcode can reveal the built product; these optional read-only commands inspect your local copy:

```sh
codesign -d --entitlements :- "/path/to/CabinDirect.app"
codesign -d --entitlements :- "/path/to/CabinDirect.app/PlugIns/DirectBroadcastExtension.appex"
plutil -p "/path/to/CabinDirect.app/Info.plist"
plutil -p "/path/to/CabinDirect.app/PlugIns/DirectBroadcastExtension.appex/Info.plist"
```

Check that signing/profiles permit the declared identifiers and shared group; do not publish raw signing/profile/device details. See [Apple's App Group configuration reference](https://developer.apple.com/documentation/xcode/configuring-app-groups). **Personal Team or third-party re-signing may reject or alter the necessary App Group/extension capabilities. This exact free-signing combination has not been proved on-device.** If provisioning fails, stop and inspect the error; do not strip the extension or shared entitlement and then claim full functionality, and do not purchase membership just to complete these instructions.

Apple documents seven-day expiry for Personal Team provisioning profiles; expect rebuilding/reinstalling or authorized renewal rather than a permanent installation. Account/device/App ID limits also apply. See [Apple's account overview](https://developer.apple.com/help/account/basics/about-your-developer-account). Once a valid installation is running, the phone's native local service does not need a Mac—**that does not remove signing/renewal maintenance**.

## Optional: inspect an unsigned release package

When published, obtain the three assets from the [v0.4.0-preview.1 release](https://github.com/citrus-13/cabin-direct-ios/releases/tag/v0.4.0-preview.1):

- `CabinDirect-v0.4.0-preview.1-unsigned.ipa`
- `BUILD-INFO.json`
- `SHA256SUMS.txt`

Keep them together in a dedicated download directory and, from that directory on macOS, run:

```sh
shasum -a256 -c SHA256SUMS.txt
```

Every listed file must report `OK`. Compare `BUILD-INFO.json` with the release tag's actual commit, Release configuration, workflow/run evidence and test/privacy results. Missing metadata, mismatches or failed gates mean stop. A checksum detects differences against the downloaded manifest; it is **not an Apple code signature, independent publisher authentication, a source audit or a device-success guarantee**. Review the matching source even for a checksum-matched unsigned binary. No private certificates/profiles or Apple credentials accompany these assets.

[Sideloadly](https://sideloadly.io/), [AltStore Classic / AltServer](https://altstore.io/) and [SideStore](https://docs.sidestore.io/) are optional independent tools, not dependencies or verified installation paths for Cabin Direct. Their account, device-pairing, refresh and sometimes local-network/VPN requirements differ. Do not remove the embedded extension, silently rewrite App Group / custom Info.plist mappings, share credentials with this project, replace an existing VPN or assume free re-signing preserves these capabilities. Inspect the resulting signed entitlements and mappings exactly as above; no compatible outcome is promised and no purchase is required by this guide.

## First-device acceptance checklist

There is no phone available for the project's current remote work. Perform these checks yourself on an authorized device before treating the preview as usable:

- [ ] Verify installation, the embedded extension, matching shared group and local-network permission; handle denied permission without bypassing it.
- [ ] On your trusted Wi-Fi/hotspot, keep the iPhone app foregrounded. Use **Connect → original sample** and a **second user-owned browser device**. Open the displayed address, pair within 120 seconds and confirm the advancing original card and explicit DEMO label. This is no screen or Tesla capture. It stops on leaving the foreground, at ten minutes or on a network-address change.
- [ ] Stop the sample and wait for cleanup. In **Share**, save settings, optionally choose a visible-text region, acknowledge privacy and personally confirm iOS's broadcast picker. Display only permitted original, non-sensitive content. iOS Control Center may also explicitly start an already-configured extension; the app does not automate capture or control every system entry point.
- [ ] Verify new frames, orientation, optional OCR, pause/resume, stale-frame clearing, browser disconnect/re-pair limits and matching-session stop. Moving the main app to the background should not stop a real ReplayKit broadcast. Use the system recording indicator if needed; stale heartbeat or UI recovery alone never confirms a stop.
- [ ] Change/lose the source network and confirm teardown; manually restart/re-pair only after checking the new trusted network. HTTP is unencrypted. Never expose the listener publicly.
- [ ] Test expiry, interrupted sessions, signing renewal, lock/unlock, calls and thermal/battery stability. No lock-screen continuity, DRM or universal music-platform promise exists.
- [ ] Only later, parked and safe, test a real Tesla's particular browser/firmware and routing. A working desktop receiver or sample does not establish car acceptance.

Public reference: [project repository](https://github.com/citrus-13/cabin-direct-ios). Do not assume its issue tracker is enabled or publish personal evidence, pairing codes, profiles or account information. Publisher contact and final policy/support metadata remain pending for any future App Store submission.
