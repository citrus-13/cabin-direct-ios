import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = file => readFileSync(path.join(root, file), 'utf8');

test('BLE lyrics stays in host; broadcast excludes vehicle protocols and neither target captures microphone', () => {
  const legacy = source('ios/project.yml').split('  CabinDirect:\n')[0];
  assert.equal((legacy.match(/excludes: \[DirectConfiguration.swift, DirectLyrics.swift, DirectMusicClock.swift\]/g) || []).length, 2,
    'Legacy harness targets must not compile Cabin-only helpers without their settings type');
  const project = source('ios/project.yml').split('  CabinDirect:\n')[1].split('\nschemes:')[0];
  assert.doesNotMatch(project, /TCKeychainAccessGroup|keychain-access-groups|WebRTC/);
  const host = project.split('  DirectBroadcastExtension:\n')[0];
  assert.match(host, /NSBluetoothAlwaysUsageDescription:/);
  assert.match(host, /- package: TeslaBLE/);
  assert.doesNotMatch(host, /NSMicrophoneUsageDescription|UIBackgroundModes|StandaloneBroadcast\/DirectMusic/);
  const extension = project.split('  DirectBroadcastExtension:\n')[1].split('  CabinDirectStorePrepUITests:')[0];
  assert.match(extension, /Shared\/DirectLyrics\.swift/);
  assert.match(extension, /Shared\/DirectMusicClock\.swift/);
  assert.match(extension, /- StandaloneBroadcast/);
  assert.match(host, /Shared\/DirectLyrics.swift/);
  assert.match(host, /Shared\/DirectMusicClock.swift/);
  assert.doesNotMatch(extension, /NSMicrophoneUsageDescription|UIBackgroundModes|TeslaBLE|Bluetooth/);
  assert.equal((project.match(/path: StandaloneWeb/g) || []).length, 2, 'Same receiver is bundled for app demo and extension');
  assert.equal((project.match(/com.apple.security.application-groups:/g) || []).length, 2);
  assert.match(project, /Privacy\/Broadcast\/PrivacyInfo\.xcprivacy/);
  for (const file of ['ios/StandaloneApp/CabinDirectApp.swift', 'ios/StandaloneApp/DirectDemoRuntime.swift', 'ios/StandaloneBroadcast/DirectSampleHandler.swift']) {
    // User-visible provider attribution is allowed; network execution stays in
    // the opt-in extension client, never the setup app or demo runtime.
    assert.doesNotMatch(source(file), /import TeslaBLE|teslaMedia|URLSession|enrollMonitor|startReading|AVAudioSession/);
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
  assert.doesNotMatch(app, /demo\.start|@StateObject private var demo/);
  assert.match(app, /if phase == \.active \{ model\.refresh\(\) \}/);
});

test('diagnostics remain internal and cannot expose arbitrary runtime state through the product UI', () => {
  const app = source('ios/StandaloneApp/CabinDirectApp.swift');
  const view = app.split('struct DirectSetupView: View {')[1];
  assert.ok(view);
  assert.doesNotMatch(view, /DirectDiagnosticsView|diagnosticText|action\.diagnostics|help\.diagnostics/);
  assert.doesNotMatch(view, /Text\(model\.message\)|Text\(status\.message\)|Text\(demo\.message\)|status\.frames|measuredFPS/);
  assert.match(app, /func refresh\(\)/);
  assert.match(app, /next\.isCurrent/);
  assert.match(source('ios/StandaloneApp/CabinDirectApp.swift'), /\.localOnly: true, \.expirationDate:/);
});

test('simplified start validates settings but still requires fresh consent and the system picker', () => {
  const app = source('ios/StandaloneApp/CabinDirectApp.swift');
  const prepare = app.split('private func prepareBroadcast()')[1].split('private var broadcastSheet')[0];
  const sheet = app.split('private var broadcastSheet')[1].split('private var settingsView')[0];
  assert.match(prepare, /guard !settingsLocked else \{ return \}/);
  assert.match(prepare, /model\.save\(\)[\s\S]*guard model\.saved else[\s\S]*return/);
  assert.match(prepare, /acknowledged = false[\s\S]*showBroadcast = true/);
  assert.doesNotMatch(prepare, /startCapture|startRecording|sendActions|\.start\(/);
  assert.match(sheet, /Toggle\("我已停车，同意共享屏幕和应用声音", isOn: \$acknowledged\)/);
  assert.match(sheet, /画面、通知和系统允许的应用声音会发送到已配对的设备/);
  assert.match(sheet, /投屏不使用麦克风/);
  assert.match(sheet, /model\.saved && acknowledged && !model\.active && !model\.stopPending/);
  assert.match(sheet, /HTTP 未加密/);
  assert.match(app, /model\.requestStop\(\)[\s\S]*actionNotice = model\.stopPending \? nil : "请点 iPhone 顶部的录屏标记停止投屏。"/);
  assert.match(app, /guard let value = model\.status, value\.isCurrent else \{ return nil \}/);
  assert.match(app, /guard addressPresentation\.state == \.listening,/);
  assert.match(source('ios/Shared/DirectConfiguration.swift'), /guard status\.isCurrent\(at: now\), status\.sessionID == sessionID else/);
});

test('original application icon is opaque RGB at 1024 square', () => {
  const image = readFileSync(path.join(root, 'ios/AppAssets.xcassets/AppIcon.appiconset/AppIcon.png'));
  assert.equal(image.subarray(1, 4).toString(), 'PNG');
  assert.equal(image.readUInt32BE(16), 1024);
  assert.equal(image.readUInt32BE(20), 1024);
  assert.equal(image[25], 2, 'App Store icon must not carry alpha');
});

test('universal local mode is automatic and keeps runtime safety gates off the main UI', () => {
  const app = source('ios/StandaloneApp/CabinDirectApp.swift');
  const shared = source('ios/Shared/DirectConfiguration.swift');
  const runtime = source('ios/StandaloneBroadcast/DirectSampleHandler.swift');
  assert.match(app, /车机连接这台手机的热点，或与手机连接同一 Wi-Fi/);
  assert.match(app, /guard !DirectNetworkAddresses\.current\(\)\.isEmpty else/);
  assert.match(app, /if let address = receiverURLs\.first/);
  assert.match(app, /DisclosureGroup\("打不开？试试其他地址"\)/);
  assert.match(app, /receiverURLs\.dropFirst\(\)/);
  assert.doesNotMatch(app, /172\.20\.10\.1|NWBrowser|networkMode|Text\(model\.message\)/);
  assert.match(shared, /return prioritized\(result\)/);
  assert.match(shared, /guard eligible\.count <= 16 else \{ return \[\] \}/);
  assert.match(runtime, /DirectNetworkAddresses\.matches\(initial: networkAddresses, current: DirectNetworkAddresses\.current\(\)\)/);
  assert.match(runtime, /addresses: listenerReady \? networkAddresses\.map/);
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
  assert.match(run.stdout, /Shared native macOS acceptance: 22 cases, 0 failures/);
});

test('idle address preview is passive, current and explicitly separated from listening and pairing', () => {
  const app = source('ios/StandaloneApp/CabinDirectApp.swift');
  const shared = source('ios/Shared/DirectConfiguration.swift');
  const home = app.split('private var shareView: some View')[1].split('private func prepareBroadcast()')[0];
  const policy = shared.split('struct DirectAddressPresentation {')[1].split('struct DirectObservationGate')[0];
  assert.match(home, /\n            connectionSection\n/);
  assert.doesNotMatch(home, /if currentStatus != nil \{ connectionSection \}/);
  assert.match(app, /if observed != observedAddresses \{ observedAddresses = observed \}/);
  assert.match(app, /DirectNetworkAddresses\.prioritized\(addressProvider\(\)\)/);
  assert.match(app, /case \.notStarted: return "尚未开始投屏"/);
  assert.match(app, /可先收藏；开始投屏后才能打开。换网络后地址可能变化。/);
  assert.match(app, /\.onChange\(of: receiverURLs\) \{ _ in copied = "" \}/);
  assert.match(policy, /stopPending \|\| status\?\.state == "stopping"/);
  assert.match(policy, /state: \.unconfirmed, urls: \[\]/);
  assert.match(policy, /DirectNetworkAddresses\.prioritized\(observed\)/);
  assert.doesNotMatch(policy, /\.fresh\(|saveSettings|saveSession|setStatus|NWListener|URLSession|\.start\(/);
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
