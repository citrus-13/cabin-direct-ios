import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Source-profile checks only. They do not launch Simulator, establish UIKit
// compilation, generate screenshots or count as physical-device accessibility QA.
const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const app = read('ios/StandaloneApp/CabinDirectApp.swift');
const project = read('ios/project.yml');
const ui = read('ios/StorePrepUITests/CabinDirectUITests.swift');

test('native navigation/actions/visible-text controls expose stable accessibility identifiers', () => {
  for (const identifier of ['tab.connect', 'tab.share', 'tab.help', 'screen.connect', 'screen.share', 'screen.help',
    'connect.headline', 'notice.device-unverified', 'network.http-warning', 'setting.visible-text',
    'setting.region.preview', 'setting.region.x', 'setting.region.y', 'setting.region.width', 'setting.region.height',
    'setting.port', 'consent.screen-sharing', 'action.settings.save', 'action.demo.start', 'action.demo.stop',
    'action.broadcast.stop', 'action.stop-recovery', 'action.system-broadcast-picker', 'session.status',
    'help.privacy', 'help.support', 'help.diagnostics', 'action.diagnostics.copy']) {
    assert.ok(app.includes('"' + identifier + '"'), `Missing identifier ${identifier}`);
  }
  assert.match(app, /\.accessibilityValue\("\\\(Int\(value\.wrappedValue \* 100\)\)%"\)/);
  assert.match(app, /@ScaledMetric\(relativeTo: \.body\)/);
  assert.match(app, /\.fixedSize\(horizontal: false, vertical: true\)/);
  assert.match(app, /dynamicTypeSize\.isAccessibilitySize/);
  assert.match(app, /\.accessibilityElement\(children: \.contain\)/);
  assert.doesNotMatch(app, /CommandLine\.arguments|ProcessInfo\.processInfo\.arguments|UITEST|UI_TEST/);
});

test('native privacy/support pages are user-opened drafts with actual bundle version and no upload', () => {
  const privacy = app.split('private struct DirectPrivacyStatementView: View')[1].split('private struct DirectSupportAboutView: View')[0];
  const support = app.split('private struct DirectSupportAboutView: View')[1].split('private struct DirectRegionPreview: View')[0];
  assert.ok(privacy && support);
  assert.match(privacy, /https:\/\/github\.com\/citrus-13\/cabin-direct-ios\/blob\/codex\/public-build\/docs\/PRIVACY\.md/);
  assert.match(support, /https:\/\/github\.com\/citrus-13\/cabin-direct-ios\/blob\/codex\/public-build\/docs\/SUPPORT\.md/);
  assert.match(privacy, /草稿/);
  assert.match(privacy, /控制中心/);
  assert.match(support, /联系.*尚待补全/);
  assert.match(support, /forInfoDictionaryKey: "CFBundleShortVersionString"/);
  assert.match(support, /forInfoDictionaryKey: "CFBundleVersion"/);
  assert.match(support, /\.accessibilityLabel\("当前外观"\)\s*\.accessibilityValue\(appearanceName\)/);
  assert.match(support, /private var appearanceName: String \{ colorScheme == \.dark \? "深色" : "浅色" \}/);
  assert.match(support, /\.accessibilityLabel\("当前文字大小"\)\s*\.accessibilityValue\(textSizeName\)/);
  assert.match(support, /private var textSizeName: String \{ dynamicTypeSize\.isAccessibilitySize \? "辅助功能字号" : "标准字号" \}/);
  assert.match(privacy, /Link\("手动打开公开隐私草稿", destination: sourceURL\)/);
  assert.match(support, /Link\("手动打开公开支持说明", destination: sourceURL\)/);
  assert.doesNotMatch(privacy + support, /URLSession|openURL\(|UIApplication\.shared\.open|mailto:|\.onAppear|\.task\s*\{/);
  for (const identifier of ['privacy.heading', 'privacy.source-link', 'about.version', 'about.appearance', 'about.text-size', 'support.source-link']) {
    assert.ok((privacy + support).includes('"' + identifier + '"'));
  }
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

test('public session-only appearance setting drives the app while diagnostics still read actual environments', () => {
  assert.match(app, /@State private var appearanceChoice: DirectAppearanceChoice = \.system/);
  assert.match(app, /\.preferredColorScheme\(appearanceChoice\.colorScheme\)/);
  assert.match(app, /DirectSupportAboutView\(appearanceChoice: \$appearanceChoice\)/);
  assert.match(app, /Picker\("App 外观", selection: \$appearanceChoice\)/);
  assert.match(app, /\.pickerStyle\(\.segmented\)/);
  assert.match(app, /只在本次 App 运行期间生效，不保存/);
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
  assert.match(ui, /details\(appearance, identifier: "about\.appearance"\)/);
  assert.doesNotMatch(ui, /app\.debugDescription|app\.description|\.preferredColorScheme|\.environment\(/);
  assert.doesNotMatch(ui, /launchEnvironment|demo\.start|saveSettings|saveSession|setStatus|URLSession|startCapture|startRecording|sendActions/);
  const args = ui.split('app.launchArguments = [')[1].split('app.launch()')[0];
  assert.deepEqual([...args.matchAll(/"(-[A-Za-z]+)"/g)].map(match => match[1]), [
    '-AppleLanguages', '-AppleLocale', '-AppleInterfaceStyle', '-UIPreferredContentSizeCategoryName'
  ]);
});

test('dark accessibility flow verifies and captures Support once before Help/Privacy/Share', () => {
  const dark = ui.split('func testDarkAndAccessibilityNavigation()')[1].split('private func launch(')[0];
  assert.equal((dark.match(/tap\("help\.support", in: app\)/g) || []).length, 1);
  const order = ['selectDarkAppearance(in: app)', 'XCTAssertEqual(appearance.value as? String, "深色"',
    'XCTAssertEqual(textSize.value as? String, "辅助功能字号"', 'attach("support-accessibility"',
    'attach("help-dark"', 'attach("privacy-accessibility"', 'tapTab("tab.share"'];
  const positions = order.map(value => dark.indexOf(value));
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
