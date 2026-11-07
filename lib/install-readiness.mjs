// Consistency checks for a user-selected, locally signed Cabin Direct product.
// No account access, signing, installation or certificate-trust decision here.
const GROUP = 'com.apple.security.application-groups';
const TEAM = 'com.apple.developer.team-identifier';
const own = (value, key) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.hasOwn(value, key) ? value[key] : undefined;
const id = value => typeof value === 'string' && value.length <= 255 &&
  /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.exec(value)?.[0] === value;
const single = value => Array.isArray(value) && value.length === 1 ? value[0] : undefined;
const date = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) return NaN;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value.replace('Z', '.000Z') ? parsed : NaN;
};
const same = (a, b) => typeof a === 'string' && a.length > 0 && a === b;
const permittedKeys = new Set(['application-identifier', TEAM, GROUP, 'get-task-allow', 'keychain-access-groups']);

// Match the conservative production Swift resolver; legacy previews lack the marker.
export function resolvedInstallGroup(info) {
  const requested = own(info, 'TCAppGroupIdentifier');
  if (!id(requested) || !requested.startsWith('group.')) return undefined;
  if (!Object.hasOwn(info, 'ALTAppGroups')) return requested;
  const groups = own(info, 'ALTAppGroups');
  if (own(info, 'TCInstallerIdentifierResolutionVersion') !== 1 || !Array.isArray(groups) ||
    groups.length === 0 || groups.length > 32 || !groups.every(group => id(group) && group.startsWith('group.'))) return undefined;
  const candidates = groups.filter(group => group === requested || (group.startsWith(requested + '.') &&
    /^[A-Z0-9]{10}$/.exec(group.slice(requested.length + 1))?.[0] === group.slice(requested.length + 1)));
  return candidates.length === 1 ? candidates[0] : undefined;
}

function broadcastReferenceMatches(host, extension) {
  const requested = own(host, 'TCBroadcastExtensionIdentifier'), actual = own(extension, 'CFBundleIdentifier');
  if (!id(requested) || !id(actual)) return false;
  if (requested === actual) return true;
  const original = own(host, 'ALTBundleIdentifier');
  return own(host, 'TCInstallerIdentifierResolutionVersion') === 1 &&
    own(extension, 'TCInstallerIdentifierResolutionVersion') === 1 && id(original) &&
    requested === original + '.broadcast' && own(extension, 'ALTBundleIdentifier') === requested;
}

export function checkInstallReadiness(input, now = Date.now()) {
  const failures = [];
  const check = (ok, code) => { if (!ok) failures.push(code); };
  check(Number.isFinite(now), 'invalid_check_time');
  const app = own(input, 'app') || {}, extension = own(input, 'extension') || {};
  const ai = own(app, 'info') || {}, ei = own(extension, 'info') || {};
  const appID = own(ai, 'CFBundleIdentifier'), extID = own(ei, 'CFBundleIdentifier');
  const group = resolvedInstallGroup(ai);
  const signedTeam = own(own(app, 'signedEntitlements'), TEAM);
  const defaultOriginal = 'com.example.teslacompanion.direct';
  const mappedPublicHost = own(ai, 'TCInstallerIdentifierResolutionVersion') === 1 &&
    own(ai, 'ALTBundleIdentifier') === defaultOriginal &&
    typeof signedTeam === 'string' && /^[A-Z0-9]{10}$/.exec(signedTeam)?.[0] === signedTeam &&
    appID === defaultOriginal + '.' + signedTeam;
  check(id(appID) && (!appID.startsWith('com.example.') || mappedPublicHost), 'host_identifier_not_personalized');
  check(id(extID) && typeof appID === 'string' && extID.startsWith(appID + '.'), 'extension_identifier_not_nested');
  check(broadcastReferenceMatches(ai, ei), 'broadcast_reference_mismatch');
  check(same(group, resolvedInstallGroup(ei)), 'shared_group_reference_mismatch');
  check(same(own(ai, 'CFBundleShortVersionString'), own(ei, 'CFBundleShortVersionString')) &&
    same(own(ai, 'CFBundleVersion'), own(ei, 'CFBundleVersion')), 'product_version_mismatch');
  check(own(ai, 'CFBundleExecutable') === 'CabinDirect' &&
    own(ei, 'CFBundleExecutable') === 'DirectBroadcastExtension', 'unexpected_product_executables');
  const point = own(ei, 'NSExtension') || {};
  check(own(point, 'NSExtensionPointIdentifier') === 'com.apple.broadcast-services-upload' &&
    own(point, 'RPBroadcastProcessMode') === 'RPBroadcastProcessModeSampleBuffer' &&
    typeof own(point, 'NSExtensionPrincipalClass') === 'string' &&
    point.NSExtensionPrincipalClass === 'DirectBroadcastExtension.DirectSampleHandler', 'broadcast_extension_configuration_invalid');
  const teams = [], prefixes = [], remaining = [];
  for (const [role, target, bundleID] of [['app', app, appID], ['extension', extension, extID]]) {
    const ent = own(target, 'signedEntitlements') || {};
    const profile = own(target, 'profile') || {};
    const pe = own(profile, 'entitlements') || {};
    const team = own(ent, TEAM), prefix = single(own(profile, 'appIdentifierPrefixes'));
    teams.push(team); prefixes.push(prefix);
    check(own(target, 'signatureVerified') === true, role + '_signature_integrity_not_verified');
    check(own(target, 'deviceExecutableVerified') === true, role + '_device_executable_not_verified');
    check(typeof team === 'string' && /^[A-Z0-9]{10}$/.test(team) &&
      same(team, single(own(profile, 'teamIdentifiers'))) && same(team, own(pe, TEAM)), role + '_team_mismatch');
    check(typeof prefix === 'string' && /^[A-Z0-9]{10}$/.test(prefix) && id(bundleID) &&
      own(ent, 'application-identifier') === prefix + '.' + bundleID &&
      own(pe, 'application-identifier') === prefix + '.' + bundleID, role + '_application_identifier_mismatch');
    check(same(single(own(ent, GROUP)), group) && same(single(own(pe, GROUP)), group), role + '_shared_group_not_provisioned');
    check(own(ent, 'get-task-allow') === true && own(pe, 'get-task-allow') === true, role + '_not_development_provisioning');
    check(Number.isSafeInteger(own(profile, 'deviceCount')) && profile.deviceCount > 0,
      role + '_no_provisioned_devices');
    check(Object.keys(ent).length > 0 && Object.keys(ent).every(key => permittedKeys.has(key)), role + '_unexpected_signed_entitlements');
    if (Object.hasOwn(ent, 'keychain-access-groups')) {
      const keychain = single(ent['keychain-access-groups']);
      const allowed = own(pe, 'keychain-access-groups');
      check(keychain === prefix + '.' + bundleID && Array.isArray(allowed) &&
        (allowed.includes(keychain) || allowed.includes(prefix + '.*')), role + '_unexpected_keychain_access');
    }
    const start = date(own(profile, 'creationDate')), end = date(own(profile, 'expirationDate'));
    const validDates = Number.isFinite(start) && Number.isFinite(end) && Number.isFinite(now) && start <= now && end > now && end > start;
    check(validDates, role + '_profile_expired_or_dates_invalid');
    if (validDates) remaining.push(end - now);
  }
  check(same(teams[0], teams[1]), 'cross_target_team_mismatch');
  check(same(prefixes[0], prefixes[1]), 'cross_target_app_prefix_mismatch');
  const passed = failures.length === 0;
  const expiresSoon = remaining.length === 2 && Math.min(...remaining) <= 48 * 60 * 60 * 1000;
  // Allowlist only. Never return input, paths, identifiers, raw profile or tool output.
  return {
    schema_version: 1,
    kind: 'local-development-signing-consistency',
    passed,
    state: passed ? 'consistency_passed_device_acceptance_pending' : 'blocked_before_device_acceptance',
    failures,
    renewal: remaining.length === 2 ? (expiresSoon ? 'within_48_hours' : 'more_than_48_hours_remaining') : 'unknown',
    apple_account_tier_verified: false,
    apple_profile_trust_verified: false,
    signing_certificate_profile_match_verified: false,
    specific_device_registration_verified: false,
    installation_performed: false,
    device_test: false,
    vehicle_acceptance: false,
    renewal_test: false
  };
}
