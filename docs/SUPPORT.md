# Cabin Direct — help and support preparation

This is self-help for 0.7.0 development source, not a staffed support service or finalized App Store Support URL. Publisher name/contact remain unconfirmed; no private-report channel or response time is promised. Do not post personal information. Earlier preview downloads do not acquire the independent acoustic mode through these instructions; verify the actual app/build first.

## Choose a mode

**首页 → 歌词 → 开始歌词:** read the per-session microphone/provider notice and allow iOS microphone access. Let the iPhone hear music from car speakers or another audible source. No recording-screen picker is needed and no screen frames are shared. The host tries to identify the song through Apple/Shazam and obtains candidate lyrics from LRCLIB. Start and Stop are explicit; selecting a mode alone does nothing. Free Personal Team service admission is unproven, so automatic recognition may be unavailable even if the app builds or installs.

**首页 → 投屏 → 开始投屏:** settings are validated/saved, then you acknowledge the notice and personally confirm the real iOS broadcast picker. Display only permitted, non-sensitive visible content. Optional screen music and lyric access are separate default-OFF settings, using ReplayKit app audio only, not the microphone. Manual/Shortcut import creates a draft, keeps lyric networking OFF and never starts capture.

The two modes are mutually exclusive. **设置** holds screen music, lyric and OCR options, privacy and About. The original development sample and diagnostic screens are not ordinary app workflows. No new subscription, paid API or account upgrade is required by these instructions, and failure does not authorize a purchase.

## Connect safely

Use a trusted Wi-Fi/hotspot. For this iPhone's Personal Hotspot, connect the receiver first; for another hotspot/Wi-Fi, connect both devices. Mutual reachability is necessary: the same network name alone proves nothing. Guest isolation, VPN routing and browser policy can block access. Cabin does not change your VPN, invent hotspot addresses, scan networks, open public ports or use a developer relay.

The fixed entry `https://citrus-13.github.io/cabin-direct-ios/` remembers an address only after you confirm it. Next time it can navigate automatically; cancel or use `?setup=1` to edit, and Forget to clear the saved address. It does not discover a changed IP, bypass pairing or carry media. A public-page load needs internet access; use the phone address directly when offline.

An observed local address may be previewed/bookmarked while the mode is stopped, but is marked inactive; no page is served until a session starts. No eligible interface means guidance instead of a guessed/old address. After starting, use the current address and separate six-digit pairing code within 120 seconds; five wrong attempts are allowed. Codes are not embedded in URLs. Check a bookmark still matches the current address.

IPv4 is preferred; eligible IPv6 addresses can also be used. Screen mode offers collapsed alternative addresses. Interface filtering is not a firewall or proof of connectivity. A changed eligible interface/address set ends the session; inspect the new trusted network, explicitly restart and pair again. Physical hotspot/Wi-Fi and vehicle-browser acceptance are still required. **HTTP is unencrypted**, so never expose the listener publicly.

## Listening, playback and stopping

Lyrics listens through the phone's built-in microphone, not the car microphone or a private music-account API. It requests mixing without ducking and A2DP eligibility; actual Bluetooth/player coexistence must be verified on the target phone. Music must be audible nearby: headphones, mute, noise and catalog gaps may prevent matching.

A genuine user-started microphone session may continue after leaving or locking Cabin. Explicitly stop when finished. Background/lock reliability is unverified; there is no silent-audio keepalive or automatic restart. Stop Lyrics closes the microphone, cancels recognition/lyric work and ends the local session. Calls, audio-route/network changes, expiry or service failure can stop it too.

Stop Screen Sharing waits for matching-extension cleanup; iOS recording controls can also end capture. Backgrounding Cabin does not itself stop ReplayKit. Heartbeat timeout or releasing a waiting UI is not proof capture ended. The browser can disconnect locally without stopping either source mode. Normal stop does not erase saved preferences or receiver copies.

## Common problems

| Symptom | Safe check |
| --- | --- |
| No address/page | Connect the devices, check local-network permission and start the intended mode. A preview address is not a live listener. Do not expose the port publicly. |
| Pairing failed/expired | Five wrong attempts and a 120-second initial window apply. Stop/start a new session instead of guessing. |
| Microphone denied | Allow Cabin microphone access in iOS settings if you want acoustic recognition; otherwise leave Lyrics stopped. Screen sharing does not require this microphone path. |
| Lyrics waiting/no match | Make nearby music audible and check noise/catalog limitations. Silence or callbacks are not recognition proof; no lyrics are invented. |
| Recognition unavailable | Network, provider or current signing/service admission may fail. Microphone mode stops safely. Do not buy membership or add a fake entitlement; see [music limits](MUSIC.md). |
| Lyrics absent/timing wrong | A candidate recording may have no timed lyrics or be a different version. Offsets are estimates, not another player's live pause/seek state. |
| Black/no screen image | This is expected in Lyrics mode. In Screen mode check system broadcast state and permitted content; protected content is not bypassed. |
| Old/blank content | Freshness/disconnect rules intentionally hide old content. A heartbeat does not prove browser/vehicle receipt. |
| Network/audio route changed | The session may stop. Inspect the intended trusted network and playback/input route, then explicitly restart. |
| Screen stop waits | Check/end capture with iOS recording controls. UI-only recovery is not confirmed termination. |
| Installation expired | Personal Team provisioning is time-limited. See [signing](INSTALL.md); do not buy anything merely to troubleshoot. |

## Data choices and future reports

No diagnostic exports or automatic diagnostic uploads are provided. Consented Shazam/LRCLIB processing is different: signatures go to Apple/Shazam and title/artist to LRCLIB, not raw audio or screens. No audio recording files are created. Acoustic lyrics never relays audio. Screen mode uses a shared H.264/AAC timeline with an explicit receiver sound button; unsupported browsers retain picture-only JPEG. Do not enable both receiver audio and another audible output if that produces echo. Read the [privacy draft](PRIVACY.md) for retention and provider boundaries.

A future report can include app/build version from 设置 → 关于 Cabin, iOS/browser version and non-sensitive reproduction steps. Never send pairing codes, tokens, private screens, profiles, Apple passwords or device identifiers. Do not claim phone/vehicle success from a simulator or compile.

## Publisher action before submission

Supply an authorized public identity, monitored contact, final policy/support URLs and verify access. No private email is substituted. Verify final privacy labels, lyric rights and the exact signed app's behavior; this page alone does not satisfy those gates.
