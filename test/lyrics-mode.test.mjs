import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const host = read('ios/StandaloneApp/DirectLyricsMode.swift');
const app = read('ios/StandaloneApp/CabinDirectApp.swift');

// Source boundaries, not proof of Bluetooth permission, enrollment or physical media.
test('lyrics reads authenticated vehicle metadata only after explicit start, never microphone/broadcast', () => {
  assert.match(host, /import TeslaBLE/);
  assert.doesNotMatch(host, /import AVFAudio|AVAudioSession|AVAudioEngine|requestRecordPermission|DirectMusicRuntime|DirectMusicRecognizer|import ReplayKit|startCapture\(|startRecording\(|saveSession\(|saveSettings\(|setStatus\(/);
  assert.match(host, /guard consent, !busy else/);
  assert.match(host, /allowEnrollment: enrollment/);
  assert.match(host, /enrollment: false/);
  assert.match(host, /self\.reader\?\.startReading\(\)/);
  assert.match(host, /source: "tesla-ble-lyrics"/);
  assert.match(host, /timeUnit: \.milliseconds/);
  assert.match(app, /lyrics\.start\(settings: model\.settings, consent: true\)/);
  assert.match(app, /lyrics\.pairTesla\(consent: true\)/);
});

test('vehicle pairing is a separate foreground consent and uses only the host default keychain', () => {
  const pair = host.split('func pairTesla(consent:')[1].split('func start(settings:')[0];
  assert.match(pair, /guard consent, !busy, validVIN, UIApplication\.shared\.applicationState == \.active/);
  assert.match(pair, /enrollment: true/);
  assert.match(pair, /client\.enrollMonitorKeyExplicitly\(\)/);
  assert.match(host, /TeslaKeyStore\(accessGroup: nil, tag:/);
  assert.match(host, /TeslaVehicleIdentity\.isValidVIN/);
  assert.doesNotMatch(host, /SecItemDelete|load\(\)|rawRepresentation|privateKey|auth\.tesla|fleet-api|https:\/\/.*tesla/);
  const init = host.split('init()')[1].split('private func rememberVIN')[0];
  assert.doesNotMatch(init, /makeReader|hasKey|startReading|pairTesla|set\(/);
  assert.match(app, /Monitor/);
});

test('lyrics lifecycle clears vehicle and query work and restores foreground screen behavior', () => {
  const stop = host.split('func stop(reason:')[1].split('private func tick()')[0];
  for (const re of [/generation = UUID\(\)/, /timer\?\.invalidate/, /reader\?\.stop/,
    /lyricClient\?\.stop/, /clock\.reset/, /invalidateLookup/, /server\.stop/, /finishStop/]) assert.match(stop, re);
  assert.match(host, /UIApplication\.shared\.isIdleTimerDisabled = previousIdleTimer/);
  assert.match(host, /DirectNetworkAddresses\.matches/);
  assert.match(host, /func onBackground\(\)[\s\S]*if busy \{ stop/);
  assert.match(app, /phase == \.background \{ lyrics\.onBackground\(\) \}/);
});

test('lyrics callbacks bind to lookup revision and fresh identity; quick skips defer first request', () => {
  assert.match(host, /lookupRevision = UUID\(\)/);
  assert.match(host, /self\.lookupRevision == revision, self\.lookupIdentity == identity/);
  assert.match(host, /guard !current\.stale else \{[\s\S]*?self\.invalidateLookup\(\); self\.publish\(\); return/);
  assert.match(host, /guard current\.identity == identity else/);
  assert.match(host, /ProcessInfo\.processInfo\.systemUptime >= nextLyricsLookupAt/);
  assert.match(host, /lookupPending = false; nextLyricsLookupAt = ProcessInfo\.processInfo\.systemUptime \+ 10/);
  assert.match(host, /requestLyricsIfReady\(ticket: generation\)/);
  assert.match(host, /if snapshot\.stale, !lookupIdentity\.isEmpty \{\s*invalidateLookup/);
  assert.match(host, /snapshot\.canScroll \? lookupState : "matched"/);
  assert.match(host, /duration: snapshot\.duration/);
});
