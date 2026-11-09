# Reviewer instructions — draft, not submitted

Keep Candidate Notes within Apple's 4,000-byte field. Supply a real review contact separately in App Store Connect, not public source.

Current-source gate: 0.7.0 retains independent acoustic Lyrics and adds a fixed static entry plus H.264/AAC screen transport. It is not submitted, and previous 0.5.0/0.4.0 build evidence does not validate this revision or microphone route. See [music scope and historical evidence](../MUSIC.md). Free Personal Team Shazam admission, signed-device/background/vehicle results, provider/lyric rights and final privacy labels remain pending.

## Candidate Notes

Cabin Direct has two mutually exclusive modes on Home (首页): Lyrics (歌词) and Screen Sharing (投屏), with secondary Settings (设置). No app login, vehicle account, developer cloud relay or paid API key is needed. UI is Simplified Chinese. No automatic start or paid fallback is included.

Requirements: correctly signed iPhone, trusted reachable Wi-Fi/hotspot, local-network permission and a second user-owned browser. Lyrics also needs microphone permission and network access to Apple/Shazam and LRCLIB. Local HTTP is unencrypted; do not use public networks or expose ports. Receiver assets are bundled.

1. Connect both devices. An observed address can be bookmarked before starting, but its inactive label is not a live listener. No eligible interface means guidance instead of an invented address.
2. Lyrics: select 歌词 and tap 开始歌词. Confirm the per-session microphone/provider notice, then grant iOS microphone permission. Play music audibly near the phone. The host uses built-in-microphone AVAudioEngine input, not ReplayKit or private cross-app playback metadata. Signatures go to Apple/Shazam; matched title/artist go to LRCLIB. No raw-audio upload, recording files or receiver audio stream. Free-team Shazam App Service admission is unproven; unavailable service stops the microphone, without a purchase or invented entitlement.
3. Use the current URL and separate six-digit code in the browser within 120 seconds; five wrong attempts apply. Lyrics mode serves song/lyric state only, never screen frames/OCR. Returned lyrics are candidate versions in runtime memory; timing is estimated, not live player pause/seek state or exact word synchronization.
4. Stop Lyrics before changing mode. Active-microphone background audio is declared, not silent keepalive. Listening may continue when leaving/locking the app until stopped/interrupted; actual background and Bluetooth coexistence require device validation. Explicit stop, audio/network changes, expiry or terminal failure end the session and cancel music work.
5. Screen Sharing: tap 开始投屏, acknowledge the notice and personally confirm the genuine iOS broadcast picker. Capture never starts programmatically; Control Center can also explicitly start a configured extension. Share permitted non-sensitive content. App audio allowed by iOS is transmitted with video to the paired local browser; start muted, explicitly enable sound. Unsupported media browsers fall back to picture-only JPEG. Optional OCR is on-device. Screen music and LRCLIB remain separate default-OFF settings; only ReplayKit audioApp is admitted, never audioMic. Manual/Shortcut import is draft-only, leaves lyric access OFF and starts nothing.
6. Stop screen sharing through the app or iOS recording controls. Matching cleanup is acknowledged; stale heartbeat/UI recovery is not proof capture ended. Backgrounding the host does not itself stop ReplayKit. A changed network needs explicit restart and re-pairing.

Settings has Privacy and About, not diagnostic exports. No DRM bypass, universal music-platform/lock guarantee, CarPlay integration or vehicle control is included. A Tesla is unnecessary for this second-browser procedure; actual vehicle acceptance is separate.

## Maintainer gate

These instructions are proposed, not hardware proof. Validate the exact signed host/extension, privacy manifests and traffic, permissions, rights and reviewer resources before an explicitly authorized submission. Source declarations of no tracking/collected-data categories are not finalized privacy labels. Both current manifests include SystemBootTime reason 35F9.1 for local elapsed-time/recognition timing, not off-device uptime reporting. App Store review is a separate outcome.
