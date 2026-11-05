import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkInstallReadiness } from '../lib/install-readiness.mjs';

// Synthetic metadata only. Passing fixtures are NOT signed-app/device evidence.
const now = Date.parse('2026-11-05T12:00:00Z');
const team = 'ABCDEFGHIJ', group = 'group.org.fixture.cabin.direct';
const appID = 'org.fixture.cabin.direct';
const GROUP = 'com.apple.security.application-groups', TEAM = 'com.apple.developer.team-identifier';
function fixture() {
  function target(bundleID, executable) {
    const entitlements = { 'application-identifier': `${team}.${bundleID}`, [TEAM]: team,
      [GROUP]: [group], 'get-task-allow': true };
    return { info: { CFBundleIdentifier: bundleID, CFBundleExecutable: executable,
      CFBundleShortVersionString: '0.4.0', CFBundleVersion: '1', TCAppGroupIdentifier: group },
    signedEntitlements: structuredClone(entitlements), signatureVerified: true, deviceExecutableVerified: true,
    profile: { entitlements, teamIdentifiers: [team], appIdentifierPrefixes: [team], deviceCount: 1,
      creationDate: '2026-11-05T10:00:00Z', expirationDate: '2026-11-12T10:00:00Z' } };
  }
  const app = target(appID, 'CabinDirect'), extension = target(appID + '.broadcast', 'DirectBroadcastExtension');
  app.info.TCBroadcastExtensionIdentifier = extension.info.CFBundleIdentifier;
  extension.info.NSExtension = { NSExtensionPointIdentifier: 'com.apple.broadcast-services-upload',
    RPBroadcastProcessMode: 'RPBroadcastProcessModeSampleBuffer',
    NSExtensionPrincipalClass: 'DirectBroadcastExtension.DirectSampleHandler' };
  return { app, extension };
}
test('synthetic matching development metadata passes consistency only, never installation or trust', () => {
  const result = checkInstallReadiness(fixture(), now);
  assert.equal(result.passed, true);
  assert.equal(result.state, 'consistency_passed_device_acceptance_pending');
  assert.equal(result.renewal, 'more_than_48_hours_remaining');
  for (const key of ['apple_account_tier_verified', 'apple_profile_trust_verified',
    'signing_certificate_profile_match_verified', 'specific_device_registration_verified',
    'installation_performed', 'device_test', 'vehicle_acceptance', 'renewal_test']) assert.equal(result[key], false);
});
test('identifier remapping is accepted only when both custom references and signed profiles agree', () => {
  const value = fixture();
  const remap = item => JSON.parse(JSON.stringify(item).replaceAll('org.fixture', 'org.renamed'));
  assert.equal(checkInstallReadiness(remap(value), now).passed, true);
});
const cases = [
  ['host_identifier_not_personalized', f => { f.app.info.CFBundleIdentifier = 'com.example.cabin'; }],
  ['extension_identifier_not_nested', f => { f.extension.info.CFBundleIdentifier = 'org.other.extension'; }],
  ['broadcast_reference_mismatch', f => { f.app.info.TCBroadcastExtensionIdentifier = 'org.stale.extension'; }],
  ['shared_group_reference_mismatch', f => { f.extension.info.TCAppGroupIdentifier = 'group.org.stale'; }],
  ['product_version_mismatch', f => { f.extension.info.CFBundleVersion = '2'; }],
  ['unexpected_product_executables', f => { f.app.info.CFBundleExecutable = '../../private'; }],
  ['broadcast_extension_configuration_invalid', f => { delete f.extension.info.NSExtension; }],
  ['app_signature_integrity_not_verified', f => { f.app.signatureVerified = false; }],
  ['extension_signature_integrity_not_verified', f => { f.extension.signatureVerified = false; }],
  ['app_device_executable_not_verified', f => { f.app.deviceExecutableVerified = false; }],
  ['extension_team_mismatch', f => { f.extension.profile.teamIdentifiers = ['ZZZZZZZZZZ']; }],
  ['app_application_identifier_mismatch', f => { f.app.profile.entitlements['application-identifier'] = team + '.*'; }],
  ['extension_shared_group_not_provisioned', f => { delete f.extension.signedEntitlements[GROUP]; }],
  ['app_shared_group_not_provisioned', f => { f.app.profile.entitlements[GROUP] = ['group.org.other']; }],
  ['app_shared_group_not_provisioned', f => { f.app.signedEntitlements[GROUP].push('group.org.extra'); }],
  ['app_not_development_provisioning', f => { f.app.profile.entitlements['get-task-allow'] = false; }],
  ['extension_no_provisioned_devices', f => { f.extension.profile.deviceCount = 0; }],
  ['app_unexpected_signed_entitlements', f => { f.app.signedEntitlements['aps-environment'] = 'development'; }],
  ['app_unexpected_keychain_access', f => { f.app.signedEntitlements['keychain-access-groups'] = [team + '.*']; }],
  ['app_profile_expired_or_dates_invalid', f => { f.app.profile.expirationDate = '2026-11-05T12:00:00Z'; }],
  ['extension_profile_expired_or_dates_invalid', f => { f.extension.profile.creationDate = '2026-11-06T12:00:00Z'; }],
  ['app_profile_expired_or_dates_invalid', f => { f.app.profile.expirationDate = 'not-a-date'; }],
  ['cross_target_team_mismatch', f => { f.extension.signedEntitlements[TEAM] = 'ZZZZZZZZZZ'; }],
  ['cross_target_app_prefix_mismatch', f => { f.extension.profile.appIdentifierPrefixes = ['ZZZZZZZZZZ']; }]
];
for (const [index, [failure, mutate]] of cases.entries()) {
  test(`reject inconsistent synthetic signing metadata ${index + 1}: ${failure}`, () => {
    const value = fixture(); mutate(value);
    const result = checkInstallReadiness(value, now);
    assert.equal(result.passed, false);
    assert.ok(result.failures.includes(failure));
    assert.equal(result.installation_performed, false);
  });
}
test('only the default per-app keychain group may match an exact or prefix-wildcard profile grant', () => {
  for (const wildcard of [false, true]) {
    const value = fixture();
    value.app.signedEntitlements['keychain-access-groups'] = [team + '.' + appID];
    value.app.profile.entitlements['keychain-access-groups'] = [team + '.' + (wildcard ? '*' : appID)];
    assert.equal(checkInstallReadiness(value, now).passed, true);
  }
});
test('legacy App ID prefix may differ from team, but must match across both targets and profiles', () => {
  const value = fixture();
  for (const target of [value.app, value.extension]) {
    target.profile.appIdentifierPrefixes = ['0123456789'];
    const appIdentifier = '0123456789.' + target.info.CFBundleIdentifier;
    target.profile.entitlements['application-identifier'] = appIdentifier;
    target.signedEntitlements['application-identifier'] = appIdentifier;
  }
  assert.equal(checkInstallReadiness(value, now).passed, true);
});
test('earliest of host and extension expiry controls renewal warning', () => {
  const value = fixture();
  value.extension.profile.expirationDate = '2026-11-06T12:00:00Z';
  assert.equal(checkInstallReadiness(value, now).renewal, 'within_48_hours');
  assert.equal(checkInstallReadiness(value, Date.parse('2026-11-06T12:00:00Z')).passed, false);
});
test('missing objects, invalid time and unresolved substitution variables fail closed', () => {
  for (const value of [null, {}, { app: {} }, { app: [], extension: 'bad' }]) {
    assert.equal(checkInstallReadiness(value, now).passed, false);
  }
  assert.equal(checkInstallReadiness(fixture(), NaN).passed, false);
  const value = fixture(); value.app.info.TCAppGroupIdentifier = '$(DIRECT_APP_GROUP_IDENTIFIER)';
  assert.equal(checkInstallReadiness(value, now).passed, false);
});
test('reports do not leak identifiers, arbitrary metadata, profile names or devices', () => {
  const value = fixture();
  value.app.profile.Name = 'PRIVATE-PROFILE'; value.app.profile.ProvisionedDevices = ['PRIVATE-UDID'];
  value.extra = { password: 'PRIVATE-SECRET', account: 'nobody@private.invalid' };
  const report = JSON.stringify(checkInstallReadiness(value, now));
  for (const text of [team, group, appID, 'PRIVATE-', 'nobody@', '2026-11-12']) assert.ok(!report.includes(text));
});
const cli = fileURLToPath(new URL('../scripts/check-install.mjs', import.meta.url));
test('CLI help is offline and incomplete inspection emits redacted failure, not raw tool errors', () => {
  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0); assert.match(help.stdout, /does not install/);
  for (const args of [[], ['--app', 'relative/CabinDirect.app'], ['--app', '/PRIVATE-ACCOUNT-NOT-PRESENT/CabinDirect.app'], ['--sign']]) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1); assert.equal(result.stderr, '');
    assert.equal(JSON.parse(result.stdout).state, 'inspection_incomplete');
    assert.doesNotMatch(result.stdout, /PRIVATE-ACCOUNT|ENOENT|\/Users\//);
  }
});
test('CLI source uses fixed read-only system tools without shell, writes, network or keychain enumeration', () => {
  const source = readFileSync(cli, 'utf8');
  assert.match(source, /'\/usr\/bin\/codesign', \['--verify', '--strict'/);
  assert.match(source, /'\/usr\/bin\/security', \['cms', '-D', '-i'/);
  assert.doesNotMatch(source, /shell:\s*true|writeFile|mkdir|copyFile|fetch\(|https:|find-identity|find-generic-password|--sign|--force|--deep/);
});
