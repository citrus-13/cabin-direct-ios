# Cabin Direct — help and support preparation

This is public self-help for the developer preview, not a staffed support service or a finalized App Store Support URL. The publisher's public name and contact method await explicit confirmation. The repository issue tracker is currently disabled; no private-report channel or response time is promised. Do not post personal information here.

## Connect safely

Use your own trusted Wi-Fi/hotspot. The iPhone and receiver browser must actually reach one another; a matching network name alone is insufficient. Guest isolation, VPN routing and vehicle-browser policy can prevent access. The app does not change your VPN, guess hotspot addresses, open public ports or provide a developer relay.

In current 0.5.3 source, there is one automatic local-network flow. For **this iPhone's Personal Hotspot**, connect the car/browser to that hotspot first. For **home Wi-Fi or another device's hotspot**, connect both phone and receiver to that network. Opening Cabin shows the current observed local address under **车机连接地址**, labelled **尚未开始投屏**. You may copy/bookmark it in advance, but the webpage will not serve content before broadcasting. With no eligible interface, connection guidance replaces the address; an old address is not cached as a current one. Changing networks can change the bookmark target. Passive address discovery starts no listener, capture, pairing session or network probe and writes no settings. Expired/ambiguous runtime state and pending stops retain uncertainty/stopping labels rather than claiming idle.

Then open **投屏 → 开始投屏**, review the short sharing notice and personally confirm the iOS system broadcast panel. Settings are saved when you start; there is no separate save or diagnostic step. On the receiver browser, open the address (check it still matches Cabin if using a bookmark) and enter the separate six-digit code within 120 seconds. Display only content that permits recording. Audio stays with your original player/audio route.

Only actual observed, eligible interface addresses are offered. IPv4 is preferred and IPv6 remains available; extra candidates are under **打不开？试试其他地址**. Known tunnel, cellular and peer-only interface prefixes are excluded from discovery, but ordering is not proof that a receiver can reach a listener. Discovery filtering is not a firewall: the local listener binding is unchanged. There is no synthesized gateway, automatic VPN change, public relay, or network scan. If no address is available, connect the receiver first and retry. A changed eligible interface/address set still ends sharing and requires a fresh explicit start and pairing. Physical tests of each hotspot/Wi-Fi setup remain required; guest isolation and vehicle browser policy can block access.

**设置** contains music recognition, optional lyrics and visible-text extraction. Those choices apply to the next broadcast. The original sample and diagnostic screens are no longer part of the app interface; their development fixtures remain in the source tests.

Current source also offers [experimental music](MUSIC.md), absent from preview.3/preview.2: both app-audio recognition and separate LRCLIB access default OFF. It consumes no microphone buffers, saves no recording and relays no audio. Recognition only works with system-provided usable app audio and actual Shazam service admission, not every music/streaming app. Manual/Shortcut import is draft-only, leaves network access OFF and never starts capture.

## Common problems

| Symptom | Safe check |
| --- | --- |
| No address | Check reachability and iOS local-network permission. Do not expose the port publicly. |
| Pairing failed/expired | Five wrong attempts and a 120-second initial window apply. Stop/start a new session instead of guessing. |
| Black/no image | Check system broadcast state and permitted visible content. Protected content may be unavailable; no DRM bypass is provided. |
| Old/blank image | Pause, stale state or disconnect hides old content intentionally. A heartbeat does not prove receipt. |
| Network changed | Interface/address changes stop the source; inspect the new trusted network and restart/re-pair. |
| Stop waits | Use iOS's recording indicator/Control Center to check/end capture. UI recovery alone is not stop confirmation. |
| Installation expired | Personal Team provisioning is time-limited. See the [signing guide](INSTALL.md); do not buy anything just to troubleshoot. |
| Music unavailable / no audio | Verify you are testing new source, not preview.3. Check the explicit setting and active user-started broadcast. Silence, protected content or App Service denial is not success; use manual/system-Shortcut input rather than a paid signup or fake entitlement. |
| Lyrics missing / timing wrong | LRCLIB access requires separate consent; a track may have no timed lyrics. Matching/manual offsets are estimates and cannot read another player's pause/seek state. Do not infer live synchronization or fabricate missing lyrics. |

## Diagnostics and data choices

Freshness, session matching, expired codes and stop confirmation are handled internally. The interface shows only connection status and short actions when help is needed, not ports, frame counters, heartbeats or diagnostic exports. Nothing is automatically uploaded. Never send pairing codes, tokens, private screens, profiles, Apple passwords or device identifiers.

A future report can include app/build version from 设置 → 关于 Cabin, iOS/browser version and non-sensitive reproduction steps. Do not claim phone/vehicle success from simulator or compile results.

End sharing and confirm cleanup, or use system recording controls. Close/unpair the receiver. Normal stop does not erase preferences. iOS controls app removal, permission and clipboard expiry; the app cannot delete receiver copies. Read the [privacy draft](PRIVACY.md) for retention/interruption limits.

## Publisher action before submission

Supply an authorized public identity, monitored contact method and final policy/support URLs, and verify access. This page alone does not satisfy the contact requirement. No private email has been substituted.
