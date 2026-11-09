import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

// These tests simulate CLI contracts in an isolated fixture checkout. They never
// invoke Xcode, sign, provision, access credentials, or establish a real iOS build.
const productionScript = fileURLToPath(new URL('../scripts/build-ios.mjs', import.meta.url));
const fakeTool = String.raw`
const fs = require('node:fs'), path = require('node:path');
const tool = path.basename(process.argv[1]), args = process.argv.slice(2), root = process.cwd();
fs.appendFileSync(process.env.FIXTURE_TRACE, JSON.stringify({tool,args,developer:process.env.DEVELOPER_DIR || null,tmp:process.env.TMPDIR,cache:process.env.CLANG_MODULE_CACHE_PATH})+'\n');
function put(file, value) { fs.mkdirSync(path.dirname(file), {recursive:true}); fs.writeFileSync(file, typeof value==='string' ? value : JSON.stringify(value)); }
if (tool==='xcodegen') {
  if(process.env.FIXTURE_GENERATE_FAIL) process.exit(7);
  const objects={root:{isa:'PBXProject',targets:['app','ext'],packageReferences:['p1','p2','p3']},
    app:{name:'CabinDirect',productType:'com.apple.product-type.application',buildPhases:['resources'],packageProductDependencies:['core','tesla']},
    ext:{name:'DirectBroadcastExtension',productType:'com.apple.product-type.app-extension',buildPhases:['resources'],packageProductDependencies:['core','capture']},
    core:{isa:'XCSwiftPackageProductDependency',productName:process.env.FIXTURE_BAD_PRODUCT?'WebRTC':'DirectCore'},
    tesla:{isa:'XCSwiftPackageProductDependency',productName:'TeslaBLE'},
    capture:{isa:'XCSwiftPackageProductDependency',productName:'DirectCapture'},
    resources:{isa:'PBXResourcesBuildPhase',files:['webBuild','privacyBuild','licenseBuild','noticeBuild']},webBuild:{fileRef:'web'},
    privacyBuild:{fileRef:'privacy'},privacy:{path:'PrivacyInfo.xcprivacy'},licenseBuild:{fileRef:'license'},license:{path:'../LICENSE'},noticeBuild:{fileRef:'notice'},notice:{path:'../NOTICE'},
    web:{path:process.env.FIXTURE_BAD_RESOURCE?'WrongWeb':'StandaloneWeb',lastKnownFileType:'folder'},
    p1:{isa:'XCLocalSwiftPackageReference',relativePath:process.env.FIXTURE_BAD_PACKAGE?'../DirectCore':'DirectCore'},
    p2:{isa:'XCLocalSwiftPackageReference',relativePath:'DirectCapture'},
    p3:{isa:'XCLocalSwiftPackageReference',relativePath:'TeslaBLE'}};
  put(path.join(root,'ios/TeslaCompanion.xcodeproj/project.pbxproj'), {objects,rootObject:'root'});
  put(path.join(root,'ios/TeslaCompanion.xcodeproj/xcshareddata/xcschemes/CabinDirect.xcscheme'), '<Scheme/>');
  const common={TCAppGroupIdentifier:'group.$(DIRECT_APP_BUNDLE_PREFIX)',NSLocalNetworkUsageDescription:'Connect a browser on your trusted local network.'};
  common.CFBundleShortVersionString = process.env.FIXTURE_BAD_VERSION ? '1.0' : '$(MARKETING_VERSION)';
  common.CFBundleVersion = '$(CURRENT_PROJECT_VERSION)';
  if(process.env.FIXTURE_BAD_PERMISSION) common.NSMicrophoneUsageDescription='No microphone allowed';
  put(path.join(root,'ios/Config/Direct-App-Info.plist'), {...common,NSBluetoothAlwaysUsageDescription:'Read only Tesla media over Bluetooth after explicit user pairing.'});
  put(path.join(root,'ios/Config/Direct-Broadcast-Info.plist'), {...common,NSExtension:{NSExtensionPointIdentifier:'com.apple.broadcast-services-upload',NSExtensionPrincipalClass:'$(PRODUCT_MODULE_NAME).DirectSampleHandler',RPBroadcastProcessMode:'RPBroadcastProcessModeSampleBuffer'}});
  const entitlements={'com.apple.security.application-groups':[common.TCAppGroupIdentifier]};
  if(process.env.FIXTURE_BAD_KEYCHAIN) entitlements['keychain-access-groups']=['forbidden-in-v1'];
  put(path.join(root,'ios/Config/Direct-App.entitlements'),entitlements);
  put(path.join(root,'ios/Config/Direct-Broadcast.entitlements'),process.env.FIXTURE_BAD_ENTITLEMENT?{}:entitlements);
  put(path.join(root,'ios/PrivacyInfo.xcprivacy'),{NSPrivacyTracking:!!process.env.FIXTURE_BAD_PRIVACY,NSPrivacyTrackingDomains:[],NSPrivacyCollectedDataTypes:[],NSPrivacyAccessedAPITypes:[{NSPrivacyAccessedAPIType:'NSPrivacyAccessedAPICategorySystemBootTime',NSPrivacyAccessedAPITypeReasons:['35F9.1']},{NSPrivacyAccessedAPIType:'NSPrivacyAccessedAPICategoryUserDefaults',NSPrivacyAccessedAPITypeReasons:['CA92.1']}]});
  put(path.join(root,'ios/Privacy/Broadcast/PrivacyInfo.xcprivacy'),{NSPrivacyTracking:false,NSPrivacyTrackingDomains:[],NSPrivacyCollectedDataTypes:[],NSPrivacyAccessedAPITypes:[{NSPrivacyAccessedAPIType:'NSPrivacyAccessedAPICategorySystemBootTime',NSPrivacyAccessedAPITypeReasons:[process.env.FIXTURE_BAD_API_REASON?'WRONG.1':'35F9.1']}]});
} else if(tool==='plutil') {
  if(process.env.FIXTURE_INVALID_PLIST) { console.error('Simulated invalid plist'); process.exit(1); }
  process.stdout.write(fs.readFileSync(args.at(-1),'utf8'));
} else if(tool==='xcode-select') { console.log(process.env.FIXTURE_DEVELOPER); }
else if(tool==='xcrun') {
  if(process.env.FIXTURE_SDK_MISSING) { console.error('Simulated missing iphoneos SDK'); process.exit(72); }
  console.log(process.env.FIXTURE_SDK);
} else if(tool==='xcodebuild') {
  if(process.env.FIXTURE_BUILD_MODE==='fail') { console.error('Simulated compiler failure'); process.exit(65); }
  if(process.env.FIXTURE_BUILD_MODE!=='missing-product') {
    const configuration=args[args.indexOf('-configuration')+1];
    const app=path.join(args[args.indexOf('-derivedDataPath')+1],'Build/Products/'+configuration+'-iphoneos/CabinDirect.app');
    for(const name of ['CabinDirect','Info.plist','PlugIns/DirectBroadcastExtension.appex/DirectBroadcastExtension','PlugIns/DirectBroadcastExtension.appex/Info.plist']) put(path.join(app,name),'SIMULATED NOT AN IOS BINARY');
    put(path.join(app,'PrivacyInfo.xcprivacy'),process.env.FIXTURE_BAD_PACKAGED_PRIVACY ? '{}' : fs.readFileSync(path.join(root,'ios/PrivacyInfo.xcprivacy'),'utf8'));
    put(path.join(app,'PlugIns/DirectBroadcastExtension.appex/PrivacyInfo.xcprivacy'),fs.readFileSync(path.join(root,'ios/Privacy/Broadcast/PrivacyInfo.xcprivacy'),'utf8'));
  }
}
`;

function fixture(extra = {}) {
  const base = process.env.CABIN_IOS_TEST_WORK_DIR || os.tmpdir();
  mkdirSync(base, { recursive: true });
  const root = realpathSync(mkdtempSync(path.join(base, 'cabin-ios-simulated-')));
  const repo = path.join(root, 'repo'), work = path.join(root, 'work'), bin = path.join(root, 'bin');
  mkdirSync(path.join(repo, 'scripts'), { recursive: true }); mkdirSync(bin);
  copyFileSync(productionScript, path.join(repo, 'scripts/build-ios.mjs'));
  for (const name of ['DirectCore', 'DirectCapture', 'TeslaBLE']) {
    mkdirSync(path.join(repo, 'ios', name), { recursive: true });
    writeFileSync(path.join(repo, 'ios', name, 'Package.swift'), '// simulated fixture');
  }
  mkdirSync(path.join(repo, 'ios/StandaloneWeb'));
  for (const name of ['index.html', 'direct.js', 'direct.css']) writeFileSync(path.join(repo, 'ios/StandaloneWeb', name), 'SIMULATED fixture');
  writeFileSync(path.join(repo, 'ios/project.yml'), 'name: SimulatedFixture');
  for (const name of ['xcodegen', 'plutil', 'xcode-select', 'xcrun', 'xcodebuild']) {
    const file = path.join(bin, name); writeFileSync(file, `#!${process.execPath}\n${fakeTool}`); chmodSync(file, 0o700);
  }
  const developer = path.join(root, 'FakeXcode.app/Contents/Developer');
  const sdk = path.join(developer, 'Platforms/iPhoneOS.platform/Developer/SDKs/iPhoneOS99.0.sdk');
  mkdirSync(sdk, { recursive: true }); mkdirSync(path.join(developer, 'usr/bin'), { recursive: true });
  writeFileSync(path.join(developer, 'usr/bin/xcodebuild'), 'SIMULATED marker');
  const trace = path.join(root, 'trace.jsonl');
  const env = { PATH: bin, CABIN_IOS_WORK_DIR: work, CABIN_IOS_EVIDENCE_KIND: 'simulated',
    FIXTURE_TRACE: trace, FIXTURE_DEVELOPER: developer, FIXTURE_SDK: sdk, ...extra };
  return { root, repo, work, developer, env, run(options = []) {
    const result = spawnSync(process.execPath, [path.join(repo, 'scripts/build-ios.mjs'), ...options],
      { env, encoding: 'utf8', timeout: 30_000 });
    const report = existsSync(path.join(work, 'ios-build-report.json')) ? JSON.parse(readFileSync(path.join(work, 'ios-build-report.json'), 'utf8')) : null;
    const calls = existsSync(trace) ? readFileSync(trace, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
    return { ...result, report, calls };
  }};
}

test('[SIMULATED] successful CLI build is labelled simulated, unsigned and not actual iOS evidence', () => {
  const f = fixture(), result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.report.state, 'simulated_build_complete');
  assert.equal(result.report.evidence_kind, 'simulated');
  assert.equal(result.report.full_iOS_build, false);
  assert.equal(result.report.unsigned_product_present, true);
  assert.equal(result.report.installable_ipa_created, false);
  assert.equal(result.report.signing_performed, false);
  assert.equal(result.report.path_exceptions.length, 2);
  const build = result.calls.find(call => call.tool === 'xcodebuild');
  assert.ok(build.args.includes('CODE_SIGNING_ALLOWED=NO'));
  assert.ok(build.args.includes('CODE_SIGNING_REQUIRED=NO'));
  assert.ok(build.args.includes('DEVELOPMENT_TEAM='));
  assert.ok(build.args.includes('generic/platform=iOS'));
  assert.ok(build.args.includes('-skipPackageUpdates'));
  assert.ok(!build.args.includes('-disableAutomaticPackageResolution'));
  assert.ok(!build.args.some(arg => arg.includes('allowProvisioning')));
  assert.equal(build.developer, f.developer);
  for (const call of result.calls) { assert.equal(call.tmp, path.join(f.work, 'tmp')); assert.equal(call.cache, path.join(f.work, 'module-cache')); }
  assert.deepEqual(result.calls[0].args, ['--spec', 'ios/project.yml', '--project', 'ios']);
});

test('[SIMULATED] missing SDK blocks default build without invoking xcodebuild', () => {
  const result = fixture({ FIXTURE_SDK_MISSING: '1' }).run();
  assert.equal(result.status, 2);
  assert.equal(result.report.state, 'blocked_missing_full_xcode_or_iphoneos_sdk');
  assert.equal(result.report.project_generated, true); assert.equal(result.report.project_validated, true);
  assert.equal(result.report.passed, false); assert.equal(result.report.full_iOS_build, false);
  assert.ok(!result.calls.some(call => call.tool === 'xcodebuild'));
});

test('[SIMULATED] preflight only validates generation without claiming compilation', () => {
  const result = fixture({ FIXTURE_SDK_MISSING: '1' }).run(['--preflight-only']);
  assert.equal(result.status, 0);
  assert.equal(result.report.state, 'preflight_complete_sdk_unavailable');
  assert.equal(result.report.full_iOS_build, false); assert.equal(result.report.build_command_succeeded, false);
  assert.ok(!result.calls.some(call => call.tool === 'xcodebuild'));
});

test('[SIMULATED] explicit DEVELOPER_DIR remains per-command and bypasses xcode-select', () => {
  const f = fixture(); f.env.DEVELOPER_DIR = f.developer;
  const result = f.run(['--preflight-only']);
  assert.equal(result.status, 0);
  assert.equal(result.report.developer_directory, f.developer);
  assert.ok(!result.calls.some(call => call.tool === 'xcode-select'));
  assert.equal(result.calls.find(call => call.tool === 'xcrun').developer, f.developer);
});

test('[SIMULATED] generation failure is distinct from compilation failure', () => {
  const result = fixture({ FIXTURE_GENERATE_FAIL: '1' }).run();
  assert.equal(result.status, 1); assert.equal(result.report.state, 'project_generation_failed');
  assert.equal(result.report.project_generated, false); assert.equal(result.report.full_iOS_build, false);
  assert.equal(result.calls.length, 1);
});

for (const flag of ['FIXTURE_BAD_RESOURCE', 'FIXTURE_BAD_PACKAGE', 'FIXTURE_BAD_ENTITLEMENT', 'FIXTURE_INVALID_PLIST',
  'FIXTURE_BAD_PRODUCT', 'FIXTURE_BAD_PERMISSION', 'FIXTURE_BAD_KEYCHAIN', 'FIXTURE_BAD_PRIVACY', 'FIXTURE_BAD_API_REASON']) {
  test(`[SIMULATED] structural validation rejects ${flag}`, () => {
    const result = fixture({ [flag]: '1' }).run();
    assert.equal(result.status, 1); assert.equal(result.report.state, 'project_validation_failed');
    assert.equal(result.report.project_generated, true); assert.equal(result.report.project_validated, false);
    assert.ok(!result.calls.some(call => call.tool === 'xcodebuild'));
  });
}

test('[SIMULATED] build failure and absent products never count as compilation success', () => {
  for (const [mode, state] of [['fail', 'ios_compilation_failed'], ['missing-product', 'build_product_missing']]) {
    const result = fixture({ FIXTURE_BUILD_MODE: mode }).run();
    assert.equal(result.status, 1); assert.equal(result.report.state, state);
    assert.equal(result.report.full_iOS_build, false); assert.equal(result.report.passed, false);
  }
});

test('[SIMULATED] unsafe work paths are rejected before tool invocation including symlink aliases', () => {
  for (const mode of ['missing', 'relative', 'repo', 'ancestor', 'symlink']) {
    const f = fixture();
    if (mode === 'missing') delete f.env.CABIN_IOS_WORK_DIR;
    if (mode === 'relative') f.env.CABIN_IOS_WORK_DIR = 'relative';
    if (mode === 'repo') f.env.CABIN_IOS_WORK_DIR = path.join(f.repo, 'cache');
    if (mode === 'ancestor') f.env.CABIN_IOS_WORK_DIR = f.root;
    if (mode === 'symlink') { symlinkSync(f.repo, path.join(f.root, 'alias')); f.env.CABIN_IOS_WORK_DIR = path.join(f.root, 'alias/cache'); }
    const result = f.run();
    assert.equal(result.status, 1); assert.equal(result.calls.length, 0); assert.equal(result.report, null);
  }
});

test('[SIMULATED] compiler success with invalid packaged privacy never counts as a successful product', () => {
  const result = fixture({ FIXTURE_BAD_PACKAGED_PRIVACY: '1' }).run();
  assert.equal(result.status, 1);
  assert.equal(result.report.state, 'packaged_privacy_invalid');
  assert.equal(result.report.build_command_succeeded, true);
  assert.equal(result.report.unsigned_product_present, true);
  assert.equal(result.report.packaged_privacy_manifests_verified, false);
  assert.equal(result.report.full_iOS_build, false);
});

test('[SIMULATED] explicit Release configuration remains unsigned and validates Release products', () => {
  const result = fixture({ CABIN_IOS_CONFIGURATION: 'Release' }).run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.report.configuration, 'Release');
  assert.equal(result.report.full_iOS_build, false);
  const args = result.calls.find(call => call.tool === 'xcodebuild').args;
  assert.equal(args[args.indexOf('-configuration') + 1], 'Release');
  assert.match(result.report.artifacts.unsigned_app, /Release-iphoneos/);
});

test('[SIMULATED] unknown build configuration is rejected before any build tool', () => {
  const result = fixture({ CABIN_IOS_CONFIGURATION: 'Release;anything' }).run();
  assert.equal(result.status, 1);
  assert.equal(result.calls.length, 0);
  assert.equal(result.report, null);
});

test('[SIMULATED] generated default version cannot silently diverge from build settings', () => {
  const result = fixture({ FIXTURE_BAD_VERSION: '1' }).run();
  assert.equal(result.status, 1);
  assert.equal(result.report.state, 'project_validation_failed');
  assert.equal(result.report.project_validated, false);
  assert.equal(result.calls.some(call => call.tool === 'xcodebuild'), false);
});
