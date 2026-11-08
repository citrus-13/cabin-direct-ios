import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Source-profile checks only. They do not launch Simulator, establish UIKit
// compilation, generate screenshots or count as physical-device accessibility QA.
const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const app = read('ios/StandaloneApp/CabinDirectApp.swift');
const project = read('ios/project.yml');
const ui = read('ios/StorePrepUITests/CabinDirectUITests.swift');

test('two-tab functional navigation and region controls expose stable accessibility identifiers', () => {
  for (const identifier of ['tab.share', 'tab.settings', 'screen.share', 'screen.settings', 'screen.region',
    'share.headline', 'action.broadcast.prepare', 'network.http-warning', 'setting.visible-text', 'setting.region.open',
    'setting.region.preview', 'setting.region.x', 'setting.region.y', 'setting.region.width', 'setting.region.height',
    'consent.screen-sharing', 'setting.music-mode', 'consent.network-lyrics',
    'action.broadcast.stop', 'action.stop-recovery', 'action.system-broadcast-picker', 'session.status',
    'help.privacy', 'help.support']) {
    assert.ok(app.includes('"' + identifier + '"'), `Missing identifier ${identifier}`);
  }
  assert.deepEqual([...app.matchAll(/\.accessibilityIdentifier\("(tab\.[^"]+)"\)/g)].map(match => match[1]), ['tab.share', 'tab.settings']);
  assert.match(app, /@State private var selectedTab = 0/);
  assert.match(app, /NavigationLink \{ regionView \}/);
  for (const removed of ['tab.connect', 'tab.help', 'screen.connect', 'screen.help', 'help.diagnostics',
    'notice.device-unverified', 'action.diagnostics.copy', 'setting.port', 'action.demo.start', 'action.demo.stop']) {
    assert.ok(!app.includes('"' + removed + '"'), `Removed UI identifier must stay absent: ${removed}`);
  }
  assert.match(app, /\.accessibilityValue\("\\\(Int\(value\.wrappedValue \* 100\)\)%"\)/);
  assert.match(app, /@ScaledMetric\(relativeTo: \.body\)/);
  assert.match(app, /\.frame\(height: regionPreviewHeight\)/);
  assert.match(app, /dynamicTypeSize\.isAccessibilitySize/);
  assert.match(app, /\.accessibilityElement\(children: \.contain\)/);
  assert.doesNotMatch(app, /CommandLine\.arguments|ProcessInfo\.processInfo\.arguments|UITEST|UI_TEST/);
});

test('native privacy/support pages are user-opened functional pages with actual bundle metadata and no upload', () => {
  const privacy = app.split('private struct DirectPrivacyStatementView: View')[1].split('private struct DirectSupportAboutView: View')[0];
  const support = app.split('private struct DirectSupportAboutView: View')[1].split('private struct DirectRegionPreview: View')[0];
  assert.ok(privacy && support);
  assert.match(privacy, /https:\/\/github\.com\/citrus-13\/cabin-direct-ios\/blob\/codex\/public-build\/docs\/PRIVACY\.md/);
  assert.match(support, /https:\/\/github\.com\/citrus-13\/cabin-direct-ios\/blob\/codex\/public-build\/docs\/SUPPORT\.md/);
  assert.match(privacy, /Text\("隐私说明"\)/);
  assert.doesNotMatch(privacy, /草稿/);
  assert.match(privacy, /控制中心/);
  assert.match(support, /个人预览版/);
  assert.match(support, /forInfoDictionaryKey: "CFBundleShortVersionString"/);
  assert.match(support, /forInfoDictionaryKey: "CFBundleVersion"/);
  assert.match(support, /\.accessibilityIdentifier\("setting\.appearance"\)\s*\.accessibilityLabel\("App 外观"\)\s*\.accessibilityValue\(appearanceName\)/);
  assert.match(support, /private var appearanceName: String \{ colorScheme == \.dark \? "深色" : "浅色" \}/);
  assert.match(support, /\.accessibilityIdentifier\("about\.heading"\)\s*\.accessibilityValue\(textSizeName\)/);
  assert.match(support, /private var textSizeName: String \{ dynamicTypeSize\.isAccessibilitySize \? "辅助功能字号" : "标准字号" \}/);
  assert.match(privacy, /Link\("完整隐私说明", destination: sourceURL\)/);
  assert.match(support, /Link\("项目与支持", destination: sourceURL\)/);
  assert.doesNotMatch(privacy + support, /URLSession|openURL\(|UIApplication\.shared\.open|mailto:|\.onAppear|\.task\s*\{/);
  for (const identifier of ['privacy.heading', 'privacy.source-link', 'about.version', 'setting.appearance', 'about.heading', 'support.source-link']) {
    assert.ok((privacy + support).includes('"' + identifier + '"'));
  }
  assert.doesNotMatch(support, /about\.appearance|about\.text-size|当前外观|当前文字大小|尚待补全/);
});

test('store-prep UI target/scheme is separate and leaves the shipping version and scheme intact', () => {
  const target = project.split('  CabinDirectStorePrepUITests:\n')[1].split('\nschemes:')[0];
  assert.match(target, /type: bundle\.ui-testing/);
  assert.match(target, /sources:\n      - StorePrepUITests/);
  assert.match(target, /TEST_TARGET_NAME: CabinDirect/);
  assert.match(target, /dependencies:\n      - target: CabinDirect/);
  assert.doesNotMatch(target, /TeslaBLE|WebRTC|DirectLyrics|entitlements:|TCAppGroupIdentifier/);
  const schemes = project.split('\nschemes:\n')[1];
  assert.match(schemes, /^  CabinDirect:\n    build:\n      targets:\n        CabinDirect: all/m);
  assert.match(schemes, /  CabinDirectStorePrep:\n[\s\S]*?CabinDirectStorePrepUITests: \[test\]/);
  assert.match(schemes, /- name: CabinDirectStorePrepUITests\n          parallelizable: false/);
  const shipping = project.split('  CabinDirect:\n')[1].split('  CabinDirectStorePrepUITests:\n')[0];
  const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  assert.deepEqual([...shipping.matchAll(/MARKETING_VERSION: "([^"]+)"/g)].map(match => match[1]), [version, version]);
});

test('UI expected version/build matches independent package and shipping target release configuration', () => {
  const expected = ui.match(/XCTAssertEqual\(version\.label, "版本 ([0-9]+\.[0-9]+\.[0-9]+)（构建 ([0-9]+(?:\.[0-9]+){0,2})）"\)/);
  assert.ok(expected, 'UI test must assert an exact authored version/build, not its own observed label');
  assert.match(ui, /XCTAssertTrue\(version\.waitForExistence\(timeout: 5\)\)/);
  const packageVersion = JSON.parse(read('package.json')).version;
  const globalBuild = project.split('\npackages:')[0].match(/CURRENT_PROJECT_VERSION: "([^"]+)"/)?.[1];
  assert.ok(globalBuild, 'Global build number must be explicit');
  const shipping = project.split('  CabinDirect:\n')[1].split('  CabinDirectStorePrepUITests:\n')[0];
  const targets = [shipping.split('  DirectBroadcastExtension:\n')[0], shipping.split('  DirectBroadcastExtension:\n')[1]];
  assert.ok(targets.every(Boolean), 'Both shipping target declarations must be checked');
  for (const target of targets) {
    const version = target.match(/MARKETING_VERSION: "([^"]+)"/)?.[1];
    const build = target.match(/CURRENT_PROJECT_VERSION: "([^"]+)"/)?.[1] ?? globalBuild;
    assert.equal(version, packageVersion);
    assert.equal(expected[1], version, 'Update UI release expectation when shipping version changes');
    assert.equal(expected[2], build, 'Update UI release expectation when shipping build changes');
  }
});

test('light and dark Settings inspect exact default-off music value without granting consent', () => {
  const helper = ui.split('private func assertMusicDefaults(in app: XCUIApplication)')[1].split('private func launch(')[0];
  assert.ok(helper);
  assert.match(helper, /element\("setting\.music-mode", in: app\)/);
  assert.match(helper, /reveal\(mode, identifier: "setting\.music-mode", in: app\)/);
  assert.match(helper, /XCTAssertTrue\(mode\.isHittable/);
  assert.match(helper, /XCTAssertEqual\(mode\.value as\? String, "关闭"/);
  assert.match(helper, /app\.switches\["consent\.network-lyrics"\]/);
  assert.match(helper, /!lyricsConsent\.exists \|\| !isVisible\(lyricsConsent, in: app\)/);
  assert.doesNotMatch(helper, /\.tap\(|setOn\(|launchArguments|launchEnvironment/);
  assert.equal((ui.match(/assertMusicDefaults\(in: app\)/g) || []).length, 2);
  const light = ui.split('func testLightNavigationAndPrivacy()')[1].split('func testVisibleTextRegionControls()')[0];
  assert.ok(light.indexOf('attach("share-light"') < light.indexOf('assertMusicDefaults(in: app)'));
  const dark = ui.split('func testDarkAndAccessibilityNavigation()')[1].split('private func assertMusicDefaults(')[0];
  assert.ok(dark.lastIndexOf('tapTab("tab.settings"') < dark.indexOf('assertMusicDefaults(in: app)'));
  assert.ok(dark.indexOf('assertMusicDefaults(in: app)') < dark.indexOf('dark-share-controls-verified'));
  assert.match(app, /\.accessibilityIdentifier\("setting\.music-mode"\)/);
  assert.match(app, /\.accessibilityIdentifier\("consent\.network-lyrics"\)/);
});

test('public appearance control and About heading expose actual environments without diagnostic rows', () => {
  assert.match(app, /@State private var appearanceChoice: DirectAppearanceChoice = \.system/);
  assert.match(app, /\.preferredColorScheme\(appearanceChoice\.colorScheme\)/);
  assert.match(app, /DirectSupportAboutView\(appearanceChoice: \$appearanceChoice\)/);
  assert.match(app, /Picker\("App 外观", selection: \$appearanceChoice\)/);
  assert.match(app, /\.pickerStyle\(\.segmented\)/);
  assert.match(app, /本次打开期间生效；不修改系统设置/);
  assert.doesNotMatch(app, /@AppStorage|UserDefaults|appearanceChoice.*forKey/);
  assert.ok(app.indexOf('private enum DirectAppearanceChoice') > app.indexOf('struct DirectSetupView: View'),
    'SwiftUI-dependent enum remains outside the exact production-model extraction');
  assert.match(ui, /selectDarkAppearance\(in: app\)/);
  assert.match(ui, /app\.segmentedControls\.buttons\["深色"\]/);
  assert.match(ui, /waitForValue\("深色", on: appearance, timeout: 5\)/);
  assert.match(ui, /setOn\(visibleText, identifier: "setting\.visible-text", in: app\)/);
  assert.match(ui, /XCTAssertEqual\(switchValue\(visibleText\), "1"/);
  assert.match(ui, /if waitForValue\("1", on: control, timeout: 2\) \{ return \}/);
  assert.match(ui, /control\.coordinate\(withNormalizedOffset: CGVector\(dx: 0\.93, dy: 0\.5\)\)\.tap\(\)/);
  assert.match(ui, /String\(describing: control\.value \?\? ""\)/);
});

test('XCUITest contract is three genuine navigation checks and eight retained real-UI screenshots', () => {
  assert.deepEqual([...ui.matchAll(/func (test\w+)\(/g)].map(match => match[1]), [
    'testLightNavigationAndPrivacy', 'testVisibleTextRegionControls', 'testDarkAndAccessibilityNavigation'
  ]);
  const screenshots = [...ui.matchAll(/attach\("([a-z-]+)"/g)].map(match => match[1]);
  assert.equal(screenshots.length, 8);
  assert.deepEqual(screenshots.toSorted(), [
    'connect-light', 'share-light', 'privacy-light', 'support-light', 'visible-text-controls-light',
    'help-dark', 'privacy-accessibility', 'support-accessibility'
  ].toSorted());
  assert.match(ui, /XCTAttachment\(screenshot: app\.screenshot\(\)\)/);
  assert.match(ui, /attachment\.lifetime = \.keepAlways/);
  assert.match(ui, /XCUIDevice\.shared\.appearance = appearance/);
  assert.match(ui, /UICTContentSizeCategoryAccessibilityXXXL/);
  assert.match(ui, /XCTAssertEqual\(appearance\.value as\? String, "深色"/);
  assert.match(ui, /XCTAssertEqual\(textSize\.value as\? String, "辅助功能字号"/);
  assert.match(ui, /reveal\(preview, identifier: "setting\.region\.preview", in: app, requiresHittable: false\)/);
  assert.match(ui, /XCTAssertTrue\(slider\.isHittable/);
  assert.match(ui, /target\.frame\.intersection/);
  assert.match(ui, /surface\.swipeDown\(velocity: \.slow\)/);
  assert.match(ui, /surface\.swipeUp\(velocity: \.slow\)/);
  assert.match(ui, /details\(appearance, identifier: "setting\.appearance"\)/);
  assert.match(ui, /let textSize = element\("about\.heading", in: app\)/);
  assert.match(ui, /tap\("setting\.region\.open", in: app\)/);
  assert.match(ui, /element\("screen\.region", in: app\)\.waitForExistence\(timeout: 5\)/);
  assert.doesNotMatch(ui, /app\.debugDescription|app\.description|\.preferredColorScheme|\.environment\(/);
  assert.doesNotMatch(ui, /launchEnvironment|demo\.start|saveSettings|saveSession|setStatus|URLSession|startCapture|startRecording|sendActions/);
  const args = ui.split('app.launchArguments = [')[1].split('app.launch()')[0];
  assert.deepEqual([...args.matchAll(/"(-[A-Za-z]+)"/g)].map(match => match[1]), [
    '-AppleLanguages', '-AppleLocale', '-AppleInterfaceStyle', '-UIPreferredContentSizeCategoryName'
  ]);
});

test('dark accessibility flow verifies actual values and keeps Settings/Privacy screenshot order', () => {
  const dark = ui.split('func testDarkAndAccessibilityNavigation()')[1].split('private func launch(')[0];
  assert.equal((dark.match(/tap\("help\.support", in: app\)/g) || []).length, 1);
  const order = ['selectDarkAppearance(in: app)', 'XCTAssertEqual(appearance.value as? String, "深色"',
    'XCTAssertEqual(textSize.value as? String, "辅助功能字号"', 'attach("support-accessibility"',
    'attach("help-dark"', 'attach("privacy-accessibility"'];
  const positions = order.map(value => dark.indexOf(value));
  positions.push(dark.lastIndexOf('tapTab("tab.settings"'));
  assert.ok(positions.every(position => position >= 0));
  assert.deepEqual(positions, positions.toSorted((left, right) => left - right));
  assert.match(dark, /XCTAssertTrue\(app\.switches\["setting\.visible-text"\]\.isHittable/);
  const checkpoints = [...dark.matchAll(/print\("([^"\n]*)"\)/g)].map(match => match[1]);
  assert.deepEqual(checkpoints, ['[STORE-PREP TEST] dark-launched', '[STORE-PREP TEST] dark-support-opened',
    '[STORE-PREP TEST] dark-support-selected', '[STORE-PREP TEST] dark-environment-verified',
    '[STORE-PREP TEST] dark-support-attached', '[STORE-PREP TEST] dark-help-attached',
    '[STORE-PREP TEST] dark-privacy-attached', '[STORE-PREP TEST] dark-share-controls-verified']);
  assert.ok(checkpoints.every(value => !value.includes('\\(')), 'Checkpoints contain authored static text only');
});

test('home and settings reject removed diagnostics while tests never trigger preparation or persistence', () => {
  const home = app.split('private var shareView: some View')[1].split('private func prepareBroadcast()')[0];
  assert.ok(home);
  assert.doesNotMatch(home, /开发验证版|实机验收|测试报告|DEMO|原创演示|诊断/);
  assert.match(ui, /XCTAssertEqual\(app\.tabBars\.buttons\.count, 2\)/);
  assert.match(ui, /XCTAssertTrue\(selected\.isSelected/);
  assert.match(ui, /element\("action\.broadcast\.prepare", in: app\)\.exists/);
  assert.match(ui, /XCTAssertFalse\(element\(identifier, in: app\)\.exists/);
  assert.match(ui, /"help\.diagnostics", "notice\.device-unverified", "action\.diagnostics\.copy"/);
  assert.match(ui, /"开发验证版", "实机验收", "测试报告", "DEMO", "原创演示"/);
  assert.match(ui, /label CONTAINS %@/);
  assert.doesNotMatch(ui, /tap\("action\.(?:broadcast\.prepare|system-broadcast-picker|settings\.save|demo\.start)"/);
  assert.doesNotMatch(ui, /\.buttons\["action\.(?:broadcast\.prepare|system-broadcast-picker|settings\.save|demo\.start)"\]\.tap\(/);
  const light = ui.split('func testLightNavigationAndPrivacy()')[1].split('func testVisibleTextRegionControls()')[0];
  assert.ok(light.indexOf('assertSimpleHome(in: app)') < light.indexOf('attach("connect-light"'));
  assert.ok(light.indexOf('tapTab("tab.settings"') < light.indexOf('attach("share-light"'));
});
