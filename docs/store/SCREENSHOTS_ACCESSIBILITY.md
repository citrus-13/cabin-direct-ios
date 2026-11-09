# Screenshots and accessibility evidence

Actual simulator UI is remote evidence, not physical iPhone installation, ReplayKit capture, hotspot/IPv6, thermal or Tesla proof. No mockup or private screenshot is a device test.

Use an installed Pro Max simulator at an accepted 6.9-inch portrait size: 1320 × 2868, 1290 × 2796 or 1260 × 2736. Preserve the source commit, runtime/model, test identity, attachment name, dimensions and SHA-256. Do not resize unsupported images to hide their origin.

The 0.8.0 UI contract requires four navigation tests and ten real-UI screenshots: inactive Share home, Settings, text-region editor, Privacy/About, lyrics home and its unconfirmed vehicle-pairing consent, including dark/accessibility views. Canonical attachment names are `connect-light`, `share-light`, `privacy-light`, `support-light`, `lyrics-light`, `lyrics-pairing-consent-light`, `visible-text-controls-light`, `help-dark`, `privacy-accessibility` and `support-accessibility`. Historical names remain stable: `connect-light` is Share home, `share-light` is Settings and `help-dark` is dark Settings.

Tests may type a synthetic VIN and cancel the enrollment/start dialogs; they never confirm pairing, access/create keys, request Bluetooth or start a listener. The consent screenshot is not vehicle enrollment proof. No real VIN, credentials, active capture or received vehicle data may be fabricated. These are developer-evidence images, not finalized store selections or proof the current suite has run; historical eight/nine-image results do not satisfy this ten-image contract.

Before submission, resolve the gates and choose one to ten accurate, matching-language screenshots of the exact version, accepted dimensions and RGB/no alpha. See [Apple's specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/) and [accurate-metadata rules](https://developer.apple.com/app-store/review/guidelines/).

UI tests exercise tabs/navigation, OCR control appearance, invalid/synthetic VIN, separate consent cancellation, no edit-only VIN persistence, dark mode and an accessibility text-size launch. IDs/modifiers and smoke tests do not prove complete VoiceOver support or an [Accessibility Nutrition Label](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/overview-of-accessibility-nutrition-labels/).

Real-device manual checks remain: VoiceOver order/actions, Voice Control, large-text clipping, contrast/color-independent status, Reduce Motion, orientation/focus, permission alerts and system broadcast picker.

The runner may remove only its own uniquely created simulator; personal devices and existing simulators remain untouched. No runtime download or Apple login is requested.
