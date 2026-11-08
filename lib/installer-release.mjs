import { validatePreviewTag } from './preview-package.mjs';
const keys = ['schema_version', 'kind', 'source_commit', 'actual_release_build', 'metadata_signatures_verified',
  'requested_group_count', 'original_unsigned_executables_unchanged', 'apple_account_used',
  'apple_development_or_distribution_signed', 'profiles_present', 'directly_installable',
  're_signer_import_verified', 'device_test', 'renewal_test', 'vehicle_acceptance',
  'original_executable_sha256', 'metadata_executable_sha256', 'ipa', 'ipa_sha256'];
const full = (pattern, value) => typeof value === 'string' && pattern.exec(value)?.[0] === value;
function requireValue(value) { if (!value) throw new Error('Installer release evidence rejected'); }
function exact(value, expected) {
  requireValue(value && typeof value === 'object' && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()));
}
export function validateInstallerRelease(report, { commit, tag, version, tests }) {
  validatePreviewTag(tag, version);
  requireValue(full(/^[a-f0-9]{40}$/, commit));
  exact(report, keys);
  requireValue(report.schema_version === 1 && report.kind === 'identity-free-adhoc-entitlement-input' &&
    report.source_commit === commit && report.requested_group_count === 1);
  for (const key of ['actual_release_build', 'metadata_signatures_verified', 'original_unsigned_executables_unchanged']) {
    requireValue(report[key] === true);
  }
  for (const key of ['apple_account_used', 'apple_development_or_distribution_signed', 'profiles_present',
    'directly_installable', 're_signer_import_verified', 'device_test', 'renewal_test', 'vehicle_acceptance']) {
    requireValue(report[key] === false);
  }
  for (const key of ['original_executable_sha256', 'metadata_executable_sha256']) {
    exact(report[key], ['app', 'extension']);
    requireValue(Object.values(report[key]).every(value => full(/^[a-f0-9]{64}$/, value)));
  }
  requireValue(report.ipa === 'CabinDirect-' + commit.slice(0, 12) + '-adhoc-entitlement-input.ipa' &&
    full(/^[a-f0-9]{64}$/, report.ipa_sha256));
  exact(tests, ['tests', 'pass', 'fail', 'skipped', 'cancelled']);
  requireValue(Object.values(tests).every(value => Number.isSafeInteger(value) && value >= 0) &&
    tests.tests > 0 && tests.pass === tests.tests && tests.fail === 0 && tests.skipped === 0 && tests.cancelled === 0);
  return [report.ipa, 'INSTALLER-INPUT.json', 'SHA256SUMS.txt'];
}
