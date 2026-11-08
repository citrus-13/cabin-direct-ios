# Screenshots and accessibility evidence

Actual simulator UI is remote evidence, not physical iPhone installation, ReplayKit capture, hotspot/IPv6, thermal or Tesla proof. No mockup or private screenshot is a device test.

Use an installed Pro Max simulator at an accepted 6.9-inch portrait size: 1320 × 2868, 1290 × 2796 or 1260 × 2736. Preserve the source commit, runtime/model, test identity, attachment name, dimensions and SHA-256. Do not resize unsupported images to hide their origin.

Candidate 0.5.1 real-UI screenshots: the inactive Share home, functional Settings, the optional text-region editor, Privacy and About, including dark appearance and accessibility text size. Historical attachment names remain stable: `connect-light` is now the Share home, `share-light` is Settings and `help-dark` is dark Settings. Do not fabricate active capture, pairing or vehicle receipt. These are developer-evidence images, not finalized store selections; personal-preview status remains in About, while diagnostic/testing copy is no longer in the main UI.

Before submission, resolve the gates and choose one to ten accurate, matching-language screenshots of the exact version, accepted dimensions and RGB/no alpha. See [Apple's specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/) and [accurate-metadata rules](https://developer.apple.com/app-store/review/guidelines/).

UI tests exercise tabs/navigation, OCR control appearance, dark mode and an accessibility text-size launch. IDs/modifiers and smoke tests do not prove complete VoiceOver support or an [Accessibility Nutrition Label](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/overview-of-accessibility-nutrition-labels/).

Real-device manual checks remain: VoiceOver order/actions, Voice Control, large-text clipping, contrast/color-independent status, Reduce Motion, orientation/focus, permission alerts and system broadcast picker.

The runner may remove only its own uniquely created simulator; personal devices and existing simulators remain untouched. No runtime download or Apple login is requested.
