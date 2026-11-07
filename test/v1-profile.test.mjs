import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = file => readFileSync(path.join(root, file), 'utf8');

test('V1 targets exclude vehicle protocols, external lyrics and unrelated permissions', () => {
  const project = source('ios/project.yml').split('  CabinDirect:\n')[1].split('\nschemes:')[0];
  assert.doesNotMatch(project, /TeslaBLE|DirectLyrics|Bluetooth|Keychain|keychain|UIBackgroundModes|WebRTC/);
  assert.equal((project.match(/path: StandaloneWeb/g) || []).length, 2, 'Same receiver is bundled for app demo and extension');
  assert.equal((project.match(/com.apple.security.application-groups:/g) || []).length, 2);
  assert.match(project, /Privacy\/Broadcast\/PrivacyInfo\.xcprivacy/);
  for (const file of ['ios/StandaloneApp/CabinDirectApp.swift', 'ios/StandaloneApp/DirectDemoRuntime.swift', 'ios/StandaloneBroadcast/DirectSampleHandler.swift']) {
    assert.doesNotMatch(source(file), /import TeslaBLE|teslaMedia|lrclib\.net|URLSession|enrollMonitor|startReading|AVAudioSession/);
  }
});

test('V1 start and stop remain user-directed, session-bound and acknowledged', () => {
  const app = source('ios/StandaloneApp/CabinDirectApp.swift');
  assert.match(app, /RPSystemBroadcastPickerView/);
  assert.match(app, /acknowledged && !model\.active/);
  assert.doesNotMatch(app, /sendActions\(|startCapture\(|startRecording\(|RPScreenRecorder\.shared/);
  assert.match(app, /requestStop\(sessionID: status\.sessionID\)/);
  assert.match(app, /next\?\.sessionID == stoppingSessionID/);
  assert.match(source('ios/StandaloneBroadcast/DirectSampleHandler.swift'), /DirectSessionStore\.stopRequested\(for: session\)/);
  assert.match(source('ios/StandaloneBroadcast/DirectSampleHandler.swift'), /server\.stop \{[\s\S]+DirectSessionStore\.finishSession/);
});

test('native demo uses production transport, original pixels and foreground-only bounded lifetime', () => {
  const demo = source('ios/StandaloneApp/DirectDemoRuntime.swift');
  assert.match(demo, /LocalHTTPServer\(configuration:/);
  assert.match(demo, /subdirectory: "StandaloneWeb"/);
  assert.match(demo, /fresh\.createdAt \+ 600/);
  assert.match(demo, /now - lastFrameAt >= 1/);
  assert.match(demo, /format\.scale = 1/);
  assert.match(demo, /CGSize\(width: 960, height: 540\)/);
  assert.match(demo, /source: "demo"/);
  assert.match(demo, /applicationState == \.active/);
  assert.doesNotMatch(demo, /saveSession\(|saveSettings\(|setStatus\(|CapturePipeline|RPScreenRecorder|ReplayKit/);
  const app = source('ios/StandaloneApp/CabinDirectApp.swift');
  assert.match(app, /phase != \.active \{ demo\.stop/);
  assert.match(app, /model\.active, demo\.running \{ demo\.stop/);
});

test('diagnostic export does not interpolate session secrets, addresses or arbitrary screen state', () => {
  const diagnostic = source('ios/StandaloneApp/CabinDirectApp.swift').split('private var diagnosticText: String')[1].split('var body: some View')[0];
  assert.ok(diagnostic);
  assert.doesNotMatch(diagnostic, /\.token|\.pairingCode|\.sessionID|\.lyricLines|\.message|addresses\.joined/);
  assert.match(source('ios/StandaloneApp/CabinDirectApp.swift'), /\.localOnly: true, \.expirationDate:/);
});

test('original application icon is opaque RGB at 1024 square', () => {
  const image = readFileSync(path.join(root, 'ios/AppAssets.xcassets/AppIcon.appiconset/AppIcon.png'));
  assert.equal(image.subarray(1, 4).toString(), 'PNG');
  assert.equal(image.readUInt32BE(16), 1024);
  assert.equal(image.readUInt32BE(20), 1024);
  assert.equal(image[25], 2, 'App Store icon must not carry alpha');
});

test('V1 shared native contracts execute without iOS runtime or network access', t => {
  const compiler = spawnSync('swiftc', ['--version'], { encoding: 'utf8' });
  if (compiler.error?.code === 'ENOENT') return t.skip('Swift not installed; no device/build evidence inferred');
  assert.equal(compiler.status, 0, compiler.stderr);
  const work = mkdtempSync(path.join(os.tmpdir(), 'cabin-v1-contracts-'));
  const executable = path.join(work, 'contracts');
  const build = spawnSync('swiftc', ['-swift-version', '5', '-module-cache-path', path.join(work, 'module-cache'),
    'ios/Shared/SessionConfiguration.swift', 'ios/Shared/DirectConfiguration.swift', 'ios/Shared/DirectLyrics.swift',
    'ios/DirectIntegrationChecks/main.swift', '-o', executable], { cwd: root, encoding: 'utf8', timeout: 90_000 });
  assert.equal(build.status, 0, build.stderr || build.error?.message);
  const run = spawnSync(executable, [], { encoding: 'utf8', timeout: 15_000 });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /Shared native macOS acceptance: 15 cases, 0 failures/);
});

test('shared session cleanup is serialized and cannot delete or overwrite a newer session', t => {
  const compiler = spawnSync('swiftc', ['--version'], { encoding: 'utf8' });
  if (compiler.error?.code === 'ENOENT') return t.skip('Swift not installed; no device evidence inferred');
  const work = mkdtempSync(path.join(os.tmpdir(), 'cabin-v1-store-'));
  const executable = path.join(work, 'store-checks');
  const build = spawnSync('swiftc', ['-swift-version', '5', '-D', 'DIRECT_SESSION_STORE_TEST',
    '-module-cache-path', path.join(work, 'module-cache'), 'ios/Shared/SessionConfiguration.swift',
    'ios/Shared/DirectConfiguration.swift', 'ios/DirectStoreChecks/main.swift', '-o', executable],
    { cwd: root, encoding: 'utf8', timeout: 90_000 });
  assert.equal(build.status, 0, build.stderr || build.error?.message);
  const run = spawnSync(executable, [work], { encoding: 'utf8', timeout: 15_000 });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /Session-store native concurrency acceptance: 0 failures/);
});
