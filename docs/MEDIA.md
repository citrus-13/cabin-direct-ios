# Cabin 0.7.0 connection and media candidate

This is original source, not extracted Tesla Air implementation. Remote compilation, synthetic codec tests and browser playback must remain separate from actual iPhone and vehicle acceptance.

## Fixed bookmark, not a public media relay

The optional free entry is <https://citrus-13.github.io/cabin-direct-ios/>. The user explicitly confirms a private local address and whether to remember it. Later visits offer a three-second cancelable navigation to that address. `?setup=1` opens setup without automatic navigation. Forget removes the remembered address.

The static entry makes no discovery, media or authentication requests. It does not guess the phone address, store pairing credentials, scan a network or proxy private content. GitHub performs ordinary access logging. A changed local address must be updated; a new phone session still requires pairing. The phone's direct HTTP address continues to work without GitHub Pages.

## One local media clock

User-started ReplayKit app-video and app-audio samples feed a bounded VideoToolbox H.264 / AudioConverter AAC-LC producer. Source presentation timestamps and a common origin determine both tracks. An original Foundation fMP4 writer emits initialization data and finite fragments. The authenticated local server retains only a bounded live window. A compatible browser appends both tracks to one MediaSource SourceBuffer and plays one video element.

- At most 960/540 long/short edges and 24 video frames per second, without upscaling; JPEG compatibility and OCR remain capped at four frames per second.
- Two admitted source-video buffers, one audio buffer, three scaled pixel buffers. Each media fragment is at most 1 MiB; initialization is at most 64 KiB; server history at most 4 MiB / three seconds / 60 fragments.
- H.264 Baseline, real-time and no frame reordering are required. `MaxFrameDelayCount` is a best-effort tuning hint: the tested Mac returns OSStatus -12900. It is not a latency guarantee. Bounded admission, a 1.5-second callback watchdog and a five-second source-triggered retry cooldown handle unavailable/stalled encoders.
- Groups normally cover about 200–250 ms. Sparse 600 ms / one-second video has separate regression coverage; large gaps, changed formats/orientation, pause and resume establish a fresh generation and keyframe.
- AAC uses the actual source format, validated codec configuration and priming offset. Missing audio is not synthesized. Detected source gaps reset rather than silently compressing the audio timeline.
- The receiver starts muted. A user sound gesture is remembered only within the currently authorized page session. Disconnect, authorization loss or new pairing clears it. Short outages retry at two/four/eight seconds; hard media incompatibility falls back to explicitly silent JPEG.
- Backlog is trimmed and common audio/video playback is corrected together. A seek is not accepted as proof of decoder progress. Pause, hidden/offline state, expiry, disconnect and switching to lyrics stop media.

Independent microphone lyrics does not instantiate this producer, broadcast a screen or serve an audio stream. Opening the app and selecting a mode do not start capture.

## Evidence and remaining gates

On the development Mac, original synthetic bright/dark video and gated tone were really encoded, demuxed and decoded: 104 video frames, 303,040 PCM samples and six matched transitions. Restoring actual fMP4 track origins yielded a maximum measured marker difference of 84 ms. This is a synthetic media-timeline result, **not** end-to-end latency or Tesla audio synchronization.

The same 26-fragment / 6.24-second synthetic sequence was served by the production DirectCore server and played in an existing Chrome browser. The video was 320×180, readyState 4, playing and muted; a sampled iteration had 13 decoded frames, zero dropped frames and nonzero decoded audio bytes. Disconnect removed the media source and paused/hidden/muted the element. The page visibly labels this DEMO, not phone capture.

Before claiming real-device completion, test physical ReplayKit capture and application audio, actual free-signing capabilities, broadcast-extension memory/thermal endurance, portrait/landscape transitions, pauses, hotspot connection, audio output routing and sound on the specific Tesla browser. Keep the vehicle parked. Compare a permitted common-clock flash/tone source, not DRM-protected content. Browser autoplay restrictions and unavailable/blocked source audio cannot be bypassed or promised away. Lyrics recognition and timing require their own microphone/service/device tests.

No paid service, Apple account, signing certificate, provisioning profile or VPN configuration is included. Free personal installation still has renewal requirements; this is not App Store distribution or a permanent-signing promise.
