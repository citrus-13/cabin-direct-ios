# Experimental music — current source, not a music release

Scope: 0.5.0 development on 2026-11-08. This feature is **not present in preview.3 or preview.2**, and historical compilation, simulator screenshots and downloaded-IPA checks do not establish its success. Source tests, native compilation, signing/service admission and on-device acceptance are distinct gates. No music-compatible release, real iPhone result or App Store approval is claimed here.

## Explicit choices and data flow

Music mode and network lyrics are both OFF by default. Save the desired settings before personally starting the iOS system broadcast. An import or settings change never starts capture. The original foreground connection sample is not a music-recognition demonstration.

| Choice | Processing and recipient | Not provided |
| --- | --- | --- |
| Music OFF | No music recognition or external lyric lookup. Optional visible-region OCR remains a separate on-device setting. | No background-player discovery. |
| Experimental app-audio recognition | While the user-started broadcast is active, accept only usable ReplayKit `audioApp` buffers, create a fingerprint and ask Apple/Shazam to match it. Apple receives the fingerprint, not raw audio forwarded by Cabin. | No microphone input, audio relay, recording archive, DRM bypass or guaranteed app coverage. |
| Manual / Shortcut track | User supplies title, artist and starting position; no fingerprint recognition. Position is manually estimated. | No proof the named song is playing, and no pause/seek/change notifications. |
| Separate LRCLIB consent | Send the selected/matched title and artist to `https://lrclib.net` to request current-track timed lyrics. A client-identification header names Cabin and its public project. | No music credentials, screenshot, microphone or app-audio payload sent to LRCLIB. |

The paired browser receives only the bounded current metadata/lyric lines in addition to the existing screen/OCR transport, never an audio stream. Local HTTP is still unencrypted: use only a trusted network, not a publicly exposed listener. Third-party services necessarily receive requests and ordinary connection metadata such as IP address; this is no longer a wholly offline workflow when an opt-in is enabled.

Raw app-audio buffers are transient recognition input, not saved media. Returned lyric data is retained only for the current track in runtime memory, not a downloaded library or disk cache. Stop/teardown clears runtime music state; pause, stale state and disconnect hide old receiver results. Manual title/artist/position and saved consent settings can persist as local settings/session configuration, unlike fetched lyric text. A receiver can independently copy what it displays; the app cannot erase those copies or promise forensic memory erasure.

## Background and matching limits

Backgrounding the main app can leave its **already user-started system broadcast extension** active. This is not autonomous always-on background listening. No fake/silent audio keepalive, automatic broadcast start, private system-wide Now Playing API or microphone fallback is used. iOS may interrupt or stop a broadcast; locks, calls, headphones, playback routing, source apps and protected content require individual device tests.

ReplayKit may provide silence or no usable app audio. Receiving sample callbacks alone is not success: the recognition path checks non-silent audio. Protected content is unsupported, not worked around. A music fragment in a live stream can match only if usable audio is supplied and the recording is recognizable in Shazam's catalog. No guarantee covers all songs, covers/remixes, advertisements, live performances or all streaming apps.

Shazam's matched offset plus elapsed time is an **estimate**, not the third-party player's transport state. Pauses, seeks and new songs may be invisible between recognition windows. Bounded freshness and audio-activity checks hide old results; manual timing is also limited and cannot auto-follow another player. Missing, mismatched, instrumental or untimed lyric results must remain honest unavailable states, never fabricated lyrics or exact word synchronization.

The current runtime queries lyrics with title/artist only, without verified recording duration or album identity. Even a title/artist match is a **candidate lyric version**, not proof the live/remastered/edited recording matches. Do not describe the resulting timed lines as guaranteed synchronization.

## Free route and fallbacks

No paid API key, paid recognition backend or account upgrade is built into this mode. This does **not** prove that the current free Personal Team can access Shazam's global catalog. Apple requires the App ID's ShazamKit **App Service** to be enabled; account/service admission must be verified separately on the actual signed device. On service failure, stop attempts for that broadcast and offer the manual/system-Shortcut route, not a paid signup or repeated signing changes.

Do not add `com.apple.developer.shazamkit`: Apple DTS identifies it as a nonexistent entitlement. App Service configuration is server-side; a missing made-up key in a profile is not a provisioning defect. Building source, installing both targets, free-signing renewal and App Group access are also separate checks; see [free installation](FREE_INSTALL.md). Future App Store distribution has separate membership, rights and submission requirements and is not promised to cost zero.

Fallback: manually enter title/artist and an estimated starting offset, or build a **user-controlled** Shortcuts workflow using Apple's Recognize Music action and an Open URLs action. Pass URL-encoded values using this draft-only import shape:

```text
cabin-direct://track?title=Original%20Fixture&artist=Cabin%20Test&position=0
```

The example names an original test fixture, not an actual song or bundled lyrics. `position` is seconds, not a trusted live playback offset. Import prepares manual draft settings, resets network lyrics consent to OFF, and does not start capture or make a lyric request. Review/save settings, separately choose LRCLIB access if desired, and personally start the system broadcast. No signed/installable Shortcut is supplied by these instructions. Apple's own Shazam app can identify some on-device/headphone playback, but that does not grant Cabin the same internal-audio access or prove this Shortcut chain on the target phone.

## LRCLIB and content rights

LRCLIB documents free anonymous access without a mandatory API key. Identify the client; honor `429` and `Retry-After`, make bounded requests and do not bulk-download a library. Optional provider registration can supply an API-access authorization document; no registration or paid service is performed by this work.

Free API access, open-source code and this repository's Apache-2.0 license **do not grant rights to third-party song lyrics**. No third-party lyrics or artwork are bundled as examples. Before distribution, verify permission under the service terms and rights to display lyrics in the intended territories; a service-access letter alone does not prove underlying lyric rights. Review the final binary, traffic and disclosures before claiming Data Not Collected or submission readiness.

## Acceptance checklist — evidence pending

- [ ] Source checks and focused unit tests pass for defaults OFF, imports leaving network OFF, parsing/sanitization, bounded payloads, rate limiting and stop/pause/stale result rejection. Record actual commands/results separately; this checklist does not assert a pass.
- [ ] Exact-revision iOS app and extension compile with ShazamKit and current privacy resources. Historical preview builds do not count.
- [ ] Actual free-account signing, App Groups and Shazam App Service admission verified without new purchases, fake entitlements or credential disclosure; if unavailable, verify honest failure and manual fallback.
- [ ] On an installed iPhone, OFF mode makes no Shazam/LRCLIB requests; recognition-only mode sends no lyric request; separate lyric consent is required; no microphone buffers or audio stream reach the receiver.
- [ ] Test actual non-silent permitted audio for each claimed app/route, including headphones and a live stream where relevant. All-zero/no-audio, no-match, service failure and denied/absent permissions remain non-success states.
- [ ] Test a second paired browser receiving bounded current metadata/lines; missing lyrics, pure instrumental and wrong versions do not produce invented content.
- [ ] Pause, resume, seek, track switch, calls, lock/unlock, main-app backgrounding, changed network, forced extension termination and explicit stop clear/hide stale state correctly; no always-on or exact-progress claim.
- [ ] Verify Shortcut/manual import and starting-offset behavior on-device, including active-session rejection. No automatic capture or network-consent escalation.
- [ ] Finalize rights, privacy disclosures, publisher contact and any provider permissions before a future release/submission. Real-device and vehicle evidence remain separate.

## Primary references checked 2026-11-08

- [Apple SHSession](https://developer.apple.com/documentation/shazamkit/shsession) / [ShazamKit App Service](https://developer.apple.com/help/account/services/shazamkit/) / [Apple DTS on nonexistent entitlements](https://developer.apple.com/forums/thread/799000)
- [ReplayKit](https://developer.apple.com/documentation/replaykit) / [ReplayKit security and consent](https://support.apple.com/guide/security/replaykit-security-seca5fc039dd/web)
- [Matched offset](https://developer.apple.com/documentation/shazamkit/shmatchedmediaitem/predictedcurrentmatchoffset) / [Now Playing publishes an app's own media](https://developer.apple.com/documentation/mediaplayer/mpnowplayinginfocenter)
- [Apple Shazam Shortcuts](https://support.apple.com/guide/shazam/identify-a-song-using-the-shortcuts-app-deve5143aaf5/web) / [Personal Team limits](https://developer.apple.com/help/account/basics/about-your-developer-account)
- [LRCLIB API](https://lrclib.net/docs) ([current Markdown reference](https://lrclib.net/docs.md))
- [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/), including intended background use, recording consent and third-party rights (2.5.4, 2.5.14, 5.2.1–5.2.2)
