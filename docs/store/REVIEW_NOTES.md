# Reviewer instructions — draft, not submitted

Keep the candidate Notes below within Apple's 4,000-byte field. Supply a real review contact in App Store Connect separately, not in public source.

## Candidate Notes

Cabin Direct is an iPhone-local screen companion with a ReplayKit broadcast upload extension. It requires no app login, vehicle account, developer cloud, paid API or music-service account. Its UI is Simplified Chinese. Audio stays with the original player/audio route.

Requirements: a correctly signed iPhone installation, local-network permission, trusted Wi-Fi/hotspot and a second user-owned device with a reachable web browser. Do not use a public network: local HTTP is unencrypted. Receiver assets are bundled in the app.

1. Connect both devices to a trusted, mutually reachable network. Open Connect (连接).
2. Optional connection sample: keep the iPhone app foregrounded and select 启动原创样例演示. It generates clearly labelled original cards, not a screen recording. On the second device, open the displayed local URL, then enter the separate six-digit code within 120 seconds. Five wrong attempts are allowed. Check changing cards/DEMO label. Stop before real sharing. The sample stops on backgrounding or after ten minutes.
3. For real sharing, open Share (共享). Save settings (保存共享设置), review/acknowledge privacy, then personally operate the genuine iOS broadcast picker and confirm Cabin Direct. Capture is never started programmatically. iOS Control Center can also explicitly start its configured extension.
4. Return to read the current address/code, pair the browser, then display your own non-sensitive permitted content. Optional OCR reads only the selected visible region on device; it is not a lyrics API. Backgrounding the main app does not itself end a real broadcast.
5. Stop through the app or iOS recording controls. Matching-session cleanup is acknowledged; heartbeat expiry alone is not stop confirmation. A changed network/address set ends the session; restart/re-pair manually.

Help (帮助) contains privacy/support and an explicit redacted diagnostic copy action. No diagnostic is uploaded automatically. Screens, notifications and receiver copies can be sensitive.

No DRM bypass, universal music-platform/locked-screen guarantee, CarPlay integration or vehicle control is included. A Tesla is not needed for the browser/sample procedure; actual vehicle/firmware compatibility is separate. The sample alone does not demonstrate real capture and is not a substitute for reviewing that feature.

## Maintainer gate

These instructions are proposed, not hardware proof. Do not submit a developer preview as a finished app. Validate the exact signed app/extension and review resources. The sample does not guarantee minimum-functionality acceptance; Apple's review is a separate outcome.
