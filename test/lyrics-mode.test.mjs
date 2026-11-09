import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const host = read('ios/StandaloneApp/DirectLyricsMode.swift');
const app = read('ios/StandaloneApp/CabinDirectApp.swift');

// These are source-boundary tests; UI, permission, background, Bluetooth audio,
// microphone, Apple service admission and physical car checks remain separate.
test('lyrics is explicit, permission gated and independent of screen broadcast', () => {
  assert.doesNotMatch(host, /import ReplayKit|RPSystemBroadcastPickerView|startCapture\(|startRecording\(|saveSession\(|saveSettings\(|setStatus\(/);
  assert.match(host, /guard consent, !busy else/);
  assert.match(host, /requestRecordPermission/);
  assert.match(host, /guard granted else/);
  assert.match(host, /self\.generation == ticket/);
  assert.match(host, /input: \.microphone/);
  assert.match(host, /source: "microphone-lyrics"/);
  assert.match(app, /showLyricsConsent = true/);
  assert.match(app, /lyrics\.start\(settings: model\.settings, consent: true\)/);
  assert.match(app, /离开 App 或锁屏期间/);
  const page = app.split('@ViewBuilder private var lyricsSections: some View')[1].split('private func prepareBroadcast')[0];
  assert.doesNotMatch(page, /DirectBroadcastPicker|TextField|musicTitle|musicArtist/);
});

test('lyrics audio uses built-in mic, no music playback override or silent keepalive', () => {
  assert.match(host, /\.mixWithOthers, \.allowBluetoothA2DP/);
  assert.match(host, /portType == \.builtInMic/);
  assert.match(host, /inputs\.count == 1/);
  assert.match(host, /inputs\.first\?\.uid == inputUID/);
  assert.match(host, /guard actualInputIsBuiltIn else/);
  assert.doesNotMatch(host, /AVAudioPlayer|AVAudioRecorder|AVAudioFile|overrideOutputAudioPort|\.duckOthers|\.allowBluetooth\]/);
  assert.match(host, /appendMicrophone\(buffer\)/);
});

test('lyrics stop and failed startup close audio, cancel callbacks and await listener cleanup', () => {
  const stop = host.split('func stop(reason:')[1].split('private func tick()')[0];
  for (const expression of [/generation = UUID\(\)/, /timer\?\.invalidate/, /removeObserver/,
    /engine\?\.stop/, /removeTap/, /tracker\?\.stop/, /setActive\(false/, /server\.stop/, /finishStop/]) assert.match(stop, expression);
  assert.match(host, /catch \{\s*stop\(reason:/);
  assert.match(host, /DirectNetworkAddresses\.matches/);
  assert.match(host, /state\.status == "unavailable"[\s\S]*self\.stop\(reason:/);
  assert.match(host, /AVAudioSession\.interruptionNotification/);
  assert.match(host, /AVAudioSession\.mediaServicesWereResetNotification/);
  assert.match(app, /model\.active \|\| model\.stopPending \|\| lyrics\.busy/);
});
