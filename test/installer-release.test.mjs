import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateInstallerRelease } from '../lib/installer-release.mjs';
const commit = 'a'.repeat(40), tag = 'v0.4.0-preview.3', version = '0.4.0';
const tests = { tests: 206, pass: 206, fail: 0, skipped: 0, cancelled: 0 };
const options = () => ({ commit, tag, version, tests: { ...tests } });
function fixture() {
  return { schema_version: 1, kind: 'identity-free-adhoc-entitlement-input', source_commit: commit,
    actual_release_build: true, metadata_signatures_verified: true, requested_group_count: 1,
    original_unsigned_executables_unchanged: true, apple_account_used: false,
    apple_development_or_distribution_signed: false, profiles_present: false, directly_installable: false,
    re_signer_import_verified: false, device_test: false, renewal_test: false, vehicle_acceptance: false,
    original_executable_sha256: { app: 'b'.repeat(64), extension: 'c'.repeat(64) },
    metadata_executable_sha256: { app: 'd'.repeat(64), extension: 'e'.repeat(64) },
    ipa: 'CabinDirect-' + commit.slice(0, 12) + '-adhoc-entitlement-input.ipa', ipa_sha256: 'f'.repeat(64) };
}
test('synthetic candidate evidence allows exactly three explicitly named public assets', () => {
  const value = fixture(), before = structuredClone(value);
  assert.deepEqual(validateInstallerRelease(value, options()), [value.ipa, 'INSTALLER-INPUT.json', 'SHA256SUMS.txt']);
  assert.deepEqual(value, before);
});
test('candidate rejects missing/extra keys, false success and invented installation claims', () => {
  for (const key of Object.keys(fixture())) {
    const value = fixture(); delete value[key]; assert.throws(() => validateInstallerRelease(value, options()), key);
  }
  for (const [key, value] of Object.entries(fixture())) {
    if (typeof value !== 'boolean') continue;
    for (const bad of [!value, String(value), Number(value), null]) {
      assert.throws(() => validateInstallerRelease({ ...fixture(), [key]: bad }, options()), key);
    }
  }
  for (const bad of [null, [], { ...fixture(), raw_profile: 'PRIVATE-SYNTHETIC' }]) {
    assert.throws(() => validateInstallerRelease(bad, options()));
  }
});
test('candidate schema, source, paths, hashes and tag must match exactly', () => {
  for (const patch of [{ schema_version: 2 }, { kind: 'unsigned-developer-preview' }, { source_commit: 'b'.repeat(40) },
    { requested_group_count: 2 }, { ipa: '../private.ipa' }, { ipa_sha256: 'f'.repeat(64) + '\n' }]) {
    assert.throws(() => validateInstallerRelease({ ...fixture(), ...patch }, options()));
  }
  for (const field of ['original_executable_sha256', 'metadata_executable_sha256']) {
    for (const bad of [{ app: 'b'.repeat(64) }, { app: 'b'.repeat(64), extension: '../file' },
      { app: 'b'.repeat(64), extension: 'c'.repeat(64), identity: 'private' }]) {
      assert.throws(() => validateInstallerRelease({ ...fixture(), [field]: bad }, options()));
    }
  }
  for (const patch of [{ commit: commit + '\n' }, { tag: tag + '\n' }, { tag: 'v0.5.0-preview.3' }, { version: '0.4' }]) {
    assert.throws(() => validateInstallerRelease(fixture(), { ...options(), ...patch }));
  }
});
test('candidate release rejects skipped, failed, cancelled or ambiguous test evidence', () => {
  for (const patch of [{ tests: 0, pass: 0 }, { pass: 205 }, { fail: 1 }, { skipped: 1 },
    { cancelled: 1 }, { tests: '206' }, { pass: -1 }, { untrusted: true }]) {
    assert.throws(() => validateInstallerRelease(fixture(), { ...options(), tests: { ...tests, ...patch } }));
  }
});
test('draft stager has create-only refs, exact assets, remote verification and no publication', () => {
  const source = fs.readFileSync(new URL('../scripts/stage-installer-release.mjs', import.meta.url), 'utf8');
  for (const fragment of ['validateInstallerRelease(info', 'assertActualBuild', "'/git/refs', '--method', 'POST'",
    "'-F', 'draft=true', '-F', 'prerelease=true'", "'-f', 'make_latest=false'",
    "'--hostname', 'github.com'", "'https://uploads.github.com/' + apiRoot", "api('/releases/' + created.id)", 'draft.assets.length === names.length',
    'assets[0].digest ===', 'hash(bytes) === expected.sha256']) assert.ok(source.includes(fragment), fragment);
  assert.doesNotMatch(source, /\['release', 'edit'|--draft=false|--clobber|--force|rmSync|unlinkSync|shell:\s*true/);
});
test('separate public manual workflow adds only bounded draft staging authority', () => {
  const source = fs.readFileSync(new URL('../.github/workflows/cabin-installer-release.yml', import.meta.url), 'utf8');
  for (const fragment of ['workflow_dispatch:', 'github.event.repository.private == false',
    "github.repository == 'citrus-13/cabin-direct-ios'", "github.ref == 'refs/heads/codex/public-build'",
    'runs-on: xcode-27', 'timeout-minutes: 30', 'cancel-in-progress: false',
    'permissions:\n  contents: read', '    permissions:\n      contents: write',
    'CABIN_IOS_CONFIGURATION: Release', 'node scripts/stage-installer-release.mjs']) assert.ok(source.includes(fragment), fragment);
  assert.ok(source.indexOf('node scripts/prepare-installer-input.mjs') < source.indexOf('GH_TOKEN:'));
  assert.ok(source.includes('npm test -- --test-concurrency=1'), 'Codec fixtures run without competing test-file compilers; no tests are skipped');
  assert.doesNotMatch(source, /secrets\.|upload-artifact|continue-on-error|self-hosted|xlarge|publish-preview|draft=false|allowProvisioning/);
  for (const match of source.matchAll(/uses:\s*(\S+)/g)) assert.match(match[1], /^actions\/[a-z-]+@[a-f0-9]{40}$/);
  const experiment = fs.readFileSync(new URL('../.github/workflows/cabin-installer-check.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(experiment, /contents: write|stage-installer-release|GH_TOKEN/);
});
