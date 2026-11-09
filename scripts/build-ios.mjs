import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const repo = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--preflight-only')) throw new Error('Usage: node scripts/build-ios.mjs [--preflight-only]');
const preflightOnly = args.includes('--preflight-only');
const simulated = process.env.CABIN_IOS_EVIDENCE_KIND === 'simulated';
const configuration = process.env.CABIN_IOS_CONFIGURATION || 'Debug';
if (!['Debug', 'Release'].includes(configuration)) throw new Error('CABIN_IOS_CONFIGURATION must be Debug or Release.');
if (process.platform !== 'darwin') throw new Error('This runner requires macOS.');
const requested = process.env.CABIN_IOS_WORK_DIR;
if (!requested || !path.isAbsolute(requested)) throw new Error('Set an explicit absolute external CABIN_IOS_WORK_DIR.');
const lexical = path.resolve(requested);
let ancestor = lexical;
while (!existsSync(ancestor)) ancestor = path.dirname(ancestor);
const work = path.resolve(realpathSync(ancestor), path.relative(ancestor, lexical));
const contains = (base, target) => target === base || target.startsWith(base + path.sep);
if (contains(repo, work) || contains(work, repo) || work === os.homedir() || work === path.parse(work).root) {
  throw new Error('CABIN_IOS_WORK_DIR must be a dedicated external directory, not the repository or a broad ancestor.');
}
for (const name of ['tmp', 'logs', 'module-cache', 'DerivedData', 'SourcePackages', 'results']) mkdirSync(path.join(work, name), { recursive: true });
const project = path.join(repo, 'ios/TeslaCompanion.xcodeproj');
const reportPath = path.join(work, 'ios-build-report.json');
const env = { ...process.env, TMPDIR: path.join(work, 'tmp'),
  CLANG_MODULE_CACHE_PATH: path.join(work, 'module-cache'),
  SWIFT_MODULE_CACHE_PATH: path.join(work, 'module-cache'),
  SWIFTPM_MODULECACHE_OVERRIDE: path.join(work, 'module-cache') };
const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' });
const dirt = spawnSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' });
const report = {
  schema_version: 1, evidence_kind: simulated ? 'simulated' : 'actual', preflight_only: preflightOnly,
  state: 'starting', passed: false, project_generated: false, project_validated: false,
  build_profile: 'screen-companion-v1', v1_profile_validated: false,
  configuration,
  source_commit: revision.status === 0 && /^[a-f0-9]{40}$/.test(revision.stdout.trim()) ? revision.stdout.trim() : null,
  source_dirty: dirt.status !== 0 || dirt.stdout.trim().length > 0,
  full_xcode_available: false, iphoneos_sdk_available: false, full_iOS_build: false,
  build_command_succeeded: false, unsigned_product_present: false,
  packaged_privacy_manifests_verified: false,
  signing_performed: false, device_test: false, installable_ipa_created: false,
  package_resolution: 'Initial resolution of fixed free dependencies is allowed; skipPackageUpdates avoids unnecessary updates. Canonical project includes legacy build-only WebRTC, not a CabinDirect runtime dependency.',
  artifact_note: 'An unsigned .app is a compile artifact, not an installable IPA or device acceptance.',
  work_directory: work, project_path: project, developer_directory: null, iphoneos_sdk_path: null,
  path_exceptions: [
    { path: project, reason: 'XcodeGen project must remain beside ios/project.yml: local Swift package references and folder resources are relative to ios.' },
    { path: path.join(repo, 'ios/Config'), reason: 'XcodeGen generates plist and entitlement configuration at source-spec-mandated paths.' }
  ], phases: [], artifacts: {}
};
function save() { report.updated_at = new Date().toISOString(); writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n'); }
function finish(state, message, exitCode) {
  report.state = state; report.message = message; save();
  console.log(`${message}\nReport: ${reportPath}\nfull_iOS_build=${report.full_iOS_build}; evidence_kind=${report.evidence_kind}`);
  process.exitCode = exitCode;
}
function execute(name, command, parameters, timeout = 60_000) {
  console.log(`[${name}] ${command} ${parameters.join(' ')}`);
  const started = Date.now();
  const result = spawnSync(command, parameters, { cwd: repo, env, encoding: 'utf8', timeout, maxBuffer: 32 * 1024 * 1024 });
  const stdout = result.stdout || '', stderr = result.stderr || '';
  const log = path.join(work, 'logs', name + '.log');
  writeFileSync(log, stdout + stderr + (result.error ? `\n${result.error.message}\n` : ''));
  const ok = result.status === 0 && !result.error;
  report.phases.push({ name, status: ok ? 'passed' : 'failed', exit_code: result.status,
    signal: result.signal, duration_ms: Date.now() - started, log, command, arguments: parameters });
  save();
  if (!ok) console.error(stderr.trim() || result.error?.message || `${name} exited ${result.status}`);
  return { ok, stdout };
}
function requireValue(condition, message) { if (!condition) throw new Error(message); }
function plist(file, label) {
  requireValue(existsSync(file), `Missing ${label}: ${file}`);
  const converted = execute(label, 'plutil', ['-convert', 'json', '-o', '-', file]);
  requireValue(converted.ok, `${label} is not a valid plist`);
  return JSON.parse(converted.stdout);
}
function validatePrivacy(file, expectedAPIs, label) {
  const privacy = plist(file, label);
  const normalized = values => Array.isArray(values) ? values.map(value => ({
    type: value.NSPrivacyAccessedAPIType, reasons: value.NSPrivacyAccessedAPITypeReasons
  })) : null;
  requireValue(privacy.NSPrivacyTracking === false && ['NSPrivacyTrackingDomains', 'NSPrivacyCollectedDataTypes']
    .every(key => Array.isArray(privacy[key]) && privacy[key].length === 0) &&
    JSON.stringify(normalized(privacy.NSPrivacyAccessedAPITypes)) === JSON.stringify(normalized(expectedAPIs)),
    'Unexpected privacy declaration; review actual data and API behavior before changing it');
}
const capturePrivacyReasons = [{ NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategorySystemBootTime', NSPrivacyAccessedAPITypeReasons: ['35F9.1'] }];
const hostPrivacyReasons = [...capturePrivacyReasons, { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults', NSPrivacyAccessedAPITypeReasons: ['CA92.1'] }];
function validateProject() {
  const pbx = plist(path.join(project, 'project.pbxproj'), 'validate-project-pbx');
  const objects = pbx.objects;
  requireValue(objects && objects[pbx.rootObject]?.isa === 'PBXProject', 'Invalid PBX project root');
  const root = objects[pbx.rootObject];
  const targets = (root.targets || []).map(id => objects[id]);
  const app = targets.find(target => target?.name === 'CabinDirect');
  const broadcast = targets.find(target => target?.name === 'DirectBroadcastExtension');
  requireValue(app?.productType === 'com.apple.product-type.application', 'CabinDirect application target missing');
  requireValue(broadcast?.productType === 'com.apple.product-type.app-extension', 'DirectBroadcastExtension target missing');
  requireValue(existsSync(path.join(project, 'xcshareddata/xcschemes/CabinDirect.xcscheme')), 'CabinDirect shared scheme missing');
  for (const name of ['DirectCore', 'DirectCapture', 'TeslaBLE']) {
    const expected = path.join(repo, 'ios', name);
    requireValue((root.packageReferences || []).some(id => objects[id]?.isa === 'XCLocalSwiftPackageReference' &&
      path.resolve(repo, 'ios', objects[id].relativePath || '') === expected), `Local package reference is not canonical: ${name}`);
    requireValue(existsSync(path.join(expected, 'Package.swift')), `Missing local package manifest: ${name}`);
  }
  for (const [target, allowed] of [[app, ['DirectCore', 'TeslaBLE']], [broadcast, ['DirectCore', 'DirectCapture']]]) {
    const products = (target.packageProductDependencies || []).map(id => objects[id]?.productName).sort();
    requireValue(JSON.stringify(products) === JSON.stringify(allowed.sort()), `Unexpected package products in ${target.name}`);
    const resources = (target.buildPhases || []).map(id => objects[id]).filter(phase => phase?.isa === 'PBXResourcesBuildPhase')
      .flatMap(phase => (phase.files || []).map(id => objects[objects[id]?.fileRef]));
    requireValue(resources.some(reference => reference?.path === 'StandaloneWeb' && reference?.lastKnownFileType === 'folder'),
      `StandaloneWeb must be a folder resource in ${target.name}`);
    for (const resource of ['PrivacyInfo.xcprivacy', 'LICENSE', 'NOTICE']) {
      requireValue(resources.some(reference => path.basename(reference?.path || '') === resource), `Missing ${resource} in ${target.name}`);
    }
  }
  for (const name of ['index.html', 'direct.js', 'direct.css']) {
    const file = path.join(repo, 'ios/StandaloneWeb', name);
    requireValue(existsSync(file) && statSync(file).size > 0, `Missing or empty StandaloneWeb asset: ${name}`);
  }
  const config = path.join(repo, 'ios/Config');
  const appInfo = plist(path.join(config, 'Direct-App-Info.plist'), 'validate-app-info');
  const extensionInfo = plist(path.join(config, 'Direct-Broadcast-Info.plist'), 'validate-extension-info');
  const appEntitlements = plist(path.join(config, 'Direct-App.entitlements'), 'validate-app-entitlements');
  const extensionEntitlements = plist(path.join(config, 'Direct-Broadcast.entitlements'), 'validate-extension-entitlements');
  requireValue(appInfo.TCAppGroupIdentifier && appInfo.TCAppGroupIdentifier === extensionInfo.TCAppGroupIdentifier, 'App Group identifiers differ');
  for (const info of [appInfo, extensionInfo]) {
    requireValue(info.CFBundleShortVersionString === '$(MARKETING_VERSION)' &&
      info.CFBundleVersion === '$(CURRENT_PROJECT_VERSION)', 'V1 generated version must resolve from build settings');
    requireValue(typeof info.NSLocalNetworkUsageDescription === 'string' && info.NSLocalNetworkUsageDescription.length > 20, 'Local network explanation missing');
    requireValue(!info.NSBluetoothPeripheralUsageDescription && !info.TCKeychainAccessGroup,
      'No Bluetooth peripheral role or shared vehicle Keychain group');
    if (info === appInfo) {
      requireValue(!info.UIBackgroundModes?.length && !info.NSMicrophoneUsageDescription &&
        typeof info.NSBluetoothAlwaysUsageDescription === 'string' && info.NSBluetoothAlwaysUsageDescription.length > 30,
        'Foreground lyrics requires Bluetooth explanation, no microphone or background mode');
    } else {
      requireValue(!info.UIBackgroundModes?.length && !info.NSMicrophoneUsageDescription && !info.NSBluetoothAlwaysUsageDescription,
        'Screen extension must not request Bluetooth, microphone or background modes');
    }
  }
  for (const entitlements of [appEntitlements, extensionEntitlements]) {
    requireValue(Object.keys(entitlements).every(key => key === 'com.apple.security.application-groups'), 'Unexpected V1 entitlement');
  }
  for (const key of ['com.apple.security.application-groups']) {
    requireValue(Array.isArray(appEntitlements[key]) && appEntitlements[key].length > 0 &&
      JSON.stringify(appEntitlements[key]) === JSON.stringify(extensionEntitlements[key]), `Entitlement mismatch: ${key}`);
  }
  const extension = extensionInfo.NSExtension;
  requireValue(extension?.NSExtensionPointIdentifier === 'com.apple.broadcast-services-upload' &&
    extension?.RPBroadcastProcessMode === 'RPBroadcastProcessModeSampleBuffer' &&
    extension?.NSExtensionPrincipalClass?.endsWith('.DirectSampleHandler'), 'ReplayKit sample-buffer configuration invalid');
  for (const [file, expectedAPIs] of [
    ['PrivacyInfo.xcprivacy', hostPrivacyReasons],
    ['Privacy/Broadcast/PrivacyInfo.xcprivacy', capturePrivacyReasons]
  ]) {
    validatePrivacy(path.join(repo, 'ios', file), expectedAPIs, 'validate-privacy-' + (expectedAPIs.length ? 'broadcast' : 'app'));
  }
  report.v1_profile_validated = true;
  report.project_validated = true; save();
}

save();
if (!execute('generate-project', 'xcodegen', ['--spec', 'ios/project.yml', '--project', 'ios']).ok) {
  finish('project_generation_failed', 'XcodeGen failed; no iOS compilation was performed.', 1);
} else {
  report.project_generated = true; save();
  try { validateProject(); }
  catch (error) { finish('project_validation_failed', error.message, 1); }
  if (report.project_validated) {
    let developer = process.env.DEVELOPER_DIR;
    if (!developer) {
      const selected = execute('select-developer-directory', 'xcode-select', ['-p']);
      if (selected.ok) developer = selected.stdout.trim();
    }
    if (developer?.endsWith('.app')) developer = path.join(developer, 'Contents/Developer');
    if (developer && path.isAbsolute(developer)) {
      env.DEVELOPER_DIR = developer; report.developer_directory = developer;
      report.full_xcode_available = existsSync(path.join(developer, 'usr/bin/xcodebuild')) &&
        existsSync(path.join(developer, 'Platforms/iPhoneOS.platform'));
    }
    const sdk = execute('locate-iphoneos-sdk', 'xcrun', ['--sdk', 'iphoneos', '--show-sdk-path']);
    const sdkPath = sdk.stdout.trim();
    report.iphoneos_sdk_available = sdk.ok && path.isAbsolute(sdkPath) && existsSync(sdkPath) &&
      statSync(sdkPath).isDirectory() && /^iPhoneOS.*\.sdk$/.test(path.basename(sdkPath));
    if (report.iphoneos_sdk_available) report.iphoneos_sdk_path = sdkPath;
    save();
    if (preflightOnly) {
      report.passed = true;
      finish(report.full_xcode_available && report.iphoneos_sdk_available ? 'preflight_complete' : 'preflight_complete_sdk_unavailable',
        'Project generation and validation passed. Preflight only: no iOS compilation or signing performed.', 0);
    } else if (!report.full_xcode_available || !report.iphoneos_sdk_available) {
      finish('blocked_missing_full_xcode_or_iphoneos_sdk', 'Project generated and validated, but full Xcode/iPhoneOS SDK is unavailable. Build blocked; no compile success claimed.', 2);
    } else {
      const resultBundle = path.join(work, 'results', `CabinDirect-${Date.now()}-${process.pid}.xcresult`);
      report.artifacts.result_bundle = resultBundle; save();
      const build = execute('unsigned-generic-ios-build', 'xcodebuild', ['-project', project, '-scheme', 'CabinDirect',
        '-configuration', configuration, '-destination', 'generic/platform=iOS', '-sdk', 'iphoneos',
        '-derivedDataPath', path.join(work, 'DerivedData'), '-clonedSourcePackagesDirPath', path.join(work, 'SourcePackages'),
        '-resultBundlePath', resultBundle, '-skipPackageUpdates',
        'CODE_SIGNING_ALLOWED=NO', 'CODE_SIGNING_REQUIRED=NO', 'CODE_SIGN_IDENTITY=', 'DEVELOPMENT_TEAM=', 'CODE_SIGN_STYLE=Manual',
        `CLANG_MODULE_CACHE_PATH=${path.join(work, 'module-cache')}`, `SWIFT_MODULE_CACHE_PATH=${path.join(work, 'module-cache')}`,
        'COMPILER_INDEX_STORE_ENABLE=NO', 'build'], 600_000);
      report.build_command_succeeded = build.ok;
      const app = path.join(work, `DerivedData/Build/Products/${configuration}-iphoneos/CabinDirect.app`);
      const extension = path.join(app, 'PlugIns/DirectBroadcastExtension.appex');
      report.unsigned_product_present = [path.join(app, 'CabinDirect'), path.join(app, 'Info.plist'),
        path.join(extension, 'DirectBroadcastExtension'), path.join(extension, 'Info.plist')].every(existsSync);
      if (report.unsigned_product_present) { report.artifacts.unsigned_app = app; report.artifacts.broadcast_extension = extension; }
      let privacyError = '';
      if (build.ok && report.unsigned_product_present) {
        try {
          validatePrivacy(path.join(app, 'PrivacyInfo.xcprivacy'), hostPrivacyReasons, 'validate-packaged-app-privacy');
          validatePrivacy(path.join(extension, 'PrivacyInfo.xcprivacy'), capturePrivacyReasons, 'validate-packaged-extension-privacy');
          report.packaged_privacy_manifests_verified = true;
        } catch (error) { privacyError = error.message; }
      }
      report.full_iOS_build = build.ok && report.unsigned_product_present && report.packaged_privacy_manifests_verified && !simulated;
      report.passed = build.ok && report.unsigned_product_present && report.packaged_privacy_manifests_verified;
      finish(!build.ok ? 'ios_compilation_failed' : !report.unsigned_product_present ? 'build_product_missing' : privacyError ? 'packaged_privacy_invalid' : simulated ? 'simulated_build_complete' : 'unsigned_ios_build_complete',
        !build.ok ? 'Unsigned iOS compilation failed; inspect build log.' : !report.unsigned_product_present ? 'Build command succeeded but expected app/extension artifacts are missing.' : privacyError ? privacyError :
          simulated ? 'SIMULATED CLI test only: no actual iOS build is established.' : 'Unsigned generic iOS build passed. App/extension artifacts exist; no installable IPA, signing or device validation.',
        report.passed ? 0 : 1);
    }
  }
}
