import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = file => readFileSync(path.join(root, file), 'utf8');
const handler = source('ios/StandaloneBroadcast/DirectSampleHandler.swift');
const runtime = source('ios/StandaloneBroadcast/DirectMusicRuntime.swift');
const app = source('ios/StandaloneApp/CabinDirectApp.swift');

// These source contracts complement executable Foundation-only tests below;
// neither is evidence of signed-device recognition or other-app audio admission.
test('optional music is constructed only inside user-started broadcast runtime', () => {
  const started = handler.split('override func broadcastStarted(')[1].split('override func processSampleBuffer')[0];
  assert.match(started, /DirectBroadcastRuntime\(session: session\)/);
  assert.match(started, /saveSession\(session\)[\s\S]*value\.start\(\)/);
  const broadcastStart = handler.split('private final class DirectBroadcastRuntime')[1].split('func start()')[1].split('func append(')[0];
  assert.match(broadcastStart, /if settings\.musicMode != \.off \{[\s\S]*DirectMusicRuntime\(settings: settings\)/);
  assert.match(broadcastStart, /self\.music\?\.start\(\)/);
  assert.match(runtime, /guard !self\.active, self\.settings\.musicMode != \.off else \{ return \}/);
  const start = runtime.split('func start()')[1].split('func append(')[0];
  assert.match(start, /if self\.settings\.musicMode == \.manual \{[\s\S]*source: "manual"\)[\s\S]*\} else \{[\s\S]*DirectMusicRecognizer\(/);
  for (const file of ['ios/StandaloneApp/CabinDirectApp.swift', 'ios/StandaloneApp/DirectDemoRuntime.swift']) {
    assert.doesNotMatch(source(file), /DirectMusicRuntime\(|DirectMusicRecognizer\(|DirectLyricsClient\(|SHSession\(/);
  }
});

test('only ReplayKit audioApp enters music; microphone and nonvideo samples are discarded', () => {
  const admission = handler.split('override func processSampleBuffer')[1].split('override func broadcastPaused')[0];
  assert.match(admission, /if sampleBufferType == \.audioApp \{ value\?\.appendAudio\(sampleBuffer\); return \}/);
  assert.match(admission, /guard sampleBufferType == \.video else \{ return \}/);
  assert.doesNotMatch(admission, /if[^\n]*\.audioMic|case \.audioMic/);
  assert.match(app, /view\.showsMicrophoneButton = false/);
  assert.match(handler, /running && !paused \? music : nil/);
  assert.match(runtime, /active && !paused \? recognizer : nil/);
  assert.doesNotMatch(handler + runtime + app, /requestRecordPermission|AVAudioSession|AVAudioEngine|startCapture\(|startRecording\(/);
});

test('network lyrics require explicit consent and callbacks remain bound to active track generation', () => {
  const accept = runtime.split('private func accept(')[1].split('private func recognitionStatus')[0];
  assert.match(accept, /guard active, !paused, observedAt >= acceptedAfter, observedAt <= now, now - observedAt <= 3/);
  const consent = accept.indexOf('if !settings.networkLyricsAllowed');
  const lookup = accept.indexOf('client.lookup(');
  assert.ok(consent >= 0 && lookup > consent, 'Consent must be checked before lookup');
  assert.match(accept, /if !settings\.networkLyricsAllowed \{[^\n]*return \}/);
  assert.match(accept, /guard let self, self\.active, !self\.paused, self\.generation == requestGeneration/);
  assert.match(accept, /self\.cachedKey == requestKey, self\.lookupKey == requestKey/);
  assert.match(accept, /let key = value\.key[\s\S]*recognitionID\.prefix\(512\)/);
  assert.match(accept, /if cachedKey != key \{ timeline = nil; cachedKey = key \}/);
  assert.match(accept, /guard lookupKey != key else \{ publish\(\); return \}/);
  const publish = runtime.split('private func publish()')[1].split('func setPaused(')[0];
  assert.match(publish, /if !paused, let clock, let position = clock\.estimate\(at: now, lastAudioAt: lastAudioAt\)/);
  assert.match(publish, /else if clock != nil, !paused \{\s*result\.status = "stale"/);
});

test('pause/resume boundaries cancel pending work and clear music and lyrics before republishing', () => {
  const pause = runtime.split('func setPaused(')[1].split('func stop()')[0];
  assert.match(pause, /acceptedAfter = Date\(\)\.timeIntervalSince1970/);
  for (const expression of [/generation &\+= 1/, /client\.cancel\(\)/, /clock = nil/, /lastAudioAt = nil/,
    /timeline = nil/, /cachedKey = nil/, /lookupKey = nil/, /recognizer\?\.setPaused\(value\)/]) assert.match(pause, expression);
  const broadcastPause = handler.split('func setPaused(')[1].split('private func tick()')[0];
  assert.match(broadcastPause, /observations\.advance\(to:/);
  assert.match(broadcastPause, /music\?\.setPaused\(value\)/);
  assert.match(broadcastPause, /state\.music = nil/);
  assert.match(broadcastPause, /state\.lyricLines = \[\]/);
  assert.match(broadcastPause, /server\.updateFrame\(nil\)/);
});

test('broadcast end stops recognizer and network client and removes public music state', () => {
  const stop = runtime.split('func stop()')[1];
  for (const expression of [/active = false/, /generation &\+= 1/, /recognizer\?\.stop\(\)/, /recognizer = nil/,
    /client\.stop\(\)/, /clock = nil/, /timeline = nil/, /lastAudioAt = nil/]) assert.match(stop, expression);
  assert.match(stop, /DispatchQueue\.getSpecific\(key: queueKey\)/);
  assert.match(stop, /queue\.sync\(execute: finish\)/);
  const broadcastStop = handler.split('private func stopOnQueue(')[1];
  assert.match(broadcastStop, /music\?\.stop\(\); music = nil; state\.music = nil/);
  assert.match(broadcastStop, /server\.stop \{[\s\S]*DirectSessionStore\.finishSession/);
});

test('untrusted track URL fills only a stopped-session draft, revokes network consent and never starts capture', () => {
  const draft = app.split('.onOpenURL { url in')[1].split('.preferredColorScheme')[0];
  assert.ok(draft);
  assert.match(draft, /guard !settingsLocked, let track = DirectTrackImport\.parse\(url\)/);
  for (const expression of [/musicMode = \.manual/, /musicTitle = track\.title/, /musicArtist = track\.artist/,
    /musicPosition = track\.position/, /networkLyricsAllowed = false/, /model\.saved = false/]) assert.match(draft, expression);
  assert.doesNotMatch(draft, /URLSession|\.lookup\(|\.start\(|saveSettings\(|saveSession\(|startCapture\(|startRecording\(|sendActions\(/);
});

test('offline music validation and clock boundaries execute without network or iOS frameworks', t => {
  const compiler = spawnSync('swiftc', ['--version'], { encoding: 'utf8' });
  if (compiler.error?.code === 'ENOENT') return t.skip('Swift unavailable; no device/build evidence inferred');
  assert.equal(compiler.status, 0, compiler.stderr);
  if (process.platform !== 'darwin') return t.skip('Shared configuration requires Apple Security SDK');
  const work = mkdtempSync(path.join(os.tmpdir(), 'cabin-music-contracts-'));
  const executable = path.join(work, 'music-checks');
  const build = spawnSync('swiftc', ['-swift-version', '5', '-module-cache-path', path.join(work, 'module-cache'),
    'ios/Shared/SessionConfiguration.swift', 'ios/Shared/DirectConfiguration.swift',
    'ios/Shared/DirectLyrics.swift', 'ios/Shared/DirectMusicClock.swift', 'ios/DirectMusicChecks/main.swift', '-o', executable],
    { cwd: root, encoding: 'utf8', timeout: 90_000 });
  assert.equal(build.status, 0, build.stderr || build.error?.message);
  const run = spawnSync(executable, [], { encoding: 'utf8', timeout: 15_000 });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /Offline music native acceptance: 18 cases, 0 failures/);
});
