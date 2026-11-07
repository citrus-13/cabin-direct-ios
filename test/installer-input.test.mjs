import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { installerInputEntitlements, assertUnsignedInput, PUBLIC_APP_ID, APP_GROUP_KEY } from '../lib/installer-input.mjs';

function fixture() {
  const common = { TCAppGroupIdentifier: 'group.' + PUBLIC_APP_ID, TCInstallerIdentifierResolutionVersion: 1 };
  return [
    { ...common, CFBundleIdentifier: PUBLIC_APP_ID, CFBundleExecutable: 'CabinDirect', TCBroadcastExtensionIdentifier: PUBLIC_APP_ID + '.broadcast' },
    { ...common, CFBundleIdentifier: PUBLIC_APP_ID + '.broadcast', CFBundleExecutable: 'DirectBroadcastExtension',
      NSExtension: { NSExtensionPointIdentifier: 'com.apple.broadcast-services-upload',
        RPBroadcastProcessMode: 'RPBroadcastProcessModeSampleBuffer',
        NSExtensionPrincipalClass: 'DirectBroadcastExtension.DirectSampleHandler' } }
  ];
}
test('synthetic fresh public metadata requests exactly one shared group, never signing authority', () => {
  const values = fixture(), before = structuredClone(values);
  assert.deepEqual(installerInputEntitlements(...values), { [APP_GROUP_KEY]: ['group.' + PUBLIC_APP_ID] });
  assert.deepEqual(values, before);
});
test('installer input rejects legacy, private, mismatched, remapped or ambiguous metadata', () => {
  for (const role of [0, 1]) {
    for (const [field, value] of [
      ['CFBundleIdentifier', 'org.private.app'], ['CFBundleExecutable', '../unrelated'],
      ['TCAppGroupIdentifier', 'group.org.unrelated'], ['TCInstallerIdentifierResolutionVersion', undefined],
      ['TCInstallerIdentifierResolutionVersion', true], ['TCInstallerIdentifierResolutionVersion', '1'],
      ['ALTAppGroups', []], ['ALTBundleIdentifier', PUBLIC_APP_ID]
    ]) {
      const values = fixture(); values[role][field] = value;
      assert.throws(() => installerInputEntitlements(...values));
    }
  }
  for (const field of Object.keys(fixture()[1].NSExtension)) {
    const values = fixture(); values[1].NSExtension[field] = 'unrelated';
    assert.throws(() => installerInputEntitlements(...values));
  }
  assert.throws(() => installerInputEntitlements(null, null));
});
function binary(signed = false) {
  // Format-only synthetic bytes; not a compiled executable or signing evidence.
  const b = Buffer.alloc(signed ? 72 : 56);
  for (const [offset, value] of [[0, 0xfeedfacf], [4, 0x0100000c], [12, 2],
    [16, signed ? 2 : 1], [20, signed ? 40 : 24], [32, 0x32], [36, 24], [40, 2]]) b.writeUInt32LE(value, offset);
  if (signed) { b.writeUInt32LE(0x1d, 56); b.writeUInt32LE(16, 60); }
  return b;
}
test('format gate rejects previously signed inputs and non-device binaries before any copying', () => {
  assert.doesNotThrow(() => assertUnsignedInput(binary()));
  assert.throws(() => assertUnsignedInput(binary(true)), /Previously signed/);
  const simulator = binary(); simulator.writeUInt32LE(7, 40);
  assert.throws(() => assertUnsignedInput(simulator), /device platform/);
  assert.throws(() => assertUnsignedInput(Buffer.from('not executable')));
});
const cli = fileURLToPath(new URL('../scripts/prepare-installer-input.mjs', import.meta.url));
test('packaging CLI help is offline and invalid inputs fail with no paths or raw errors', () => {
  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0); assert.match(help.stdout, /Does not install/);
  for (const args of [[], ['--sign', 'PRIVATE-IDENTITY'], ['--build-dir', 'relative', '--out', '/PRIVATE-PATH'],
    ['--build-dir', '/', '--out', '/PRIVATE-PATH'], ['--build-dir', '/missing-private-build', '--out', '/missing-private-output']]) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1); assert.equal(result.stderr, '');
    assert.equal(JSON.parse(result.stdout).state, 'preparation_failed');
    assert.doesNotMatch(result.stdout, /PRIVATE-|missing-private|ENOENT|\/Users\//);
  }
});
test('packaging is copy-only with fixed identity-free metadata signing, never credentials or profile generation', () => {
  const source = readFileSync(cli, 'utf8');
  assert.match(source, /!fs.existsSync\(out\)/);
  assert.match(source, /errorOnExist: true, force: false/);
  assert.match(source, /assertActualBuild\(build/);
  assert.match(source, /assertUnsignedInput\(/);
  assert.match(source, /\['--force', '--sign', '-', '--timestamp=none'/);
  assert.match(source, /originals.every/);
  assert.doesNotMatch(source, /shell:\s*true|--deep|security.*import|find-identity|find-generic-password|allowProvisioning|fetch\(|rmSync|unlinkSync/);
});
test('experimental cloud workflow is public-only, manual, pinned, read-only and does not publish artifacts', () => {
  const source = readFileSync(new URL('../.github/workflows/cabin-installer-check.yml', import.meta.url), 'utf8');
  assert.match(source, /workflow_dispatch: \{\}/);
  assert.match(source, /github.event.repository.private == false/);
  assert.match(source, /github.repository == 'citrus-13\/cabin-direct-ios'/);
  assert.match(source, /github.ref == 'refs\/heads\/codex\/public-build'/);
  assert.match(source, /runs-on: xcode-27/);
  assert.match(source, /contents: read/);
  assert.match(source, /CABIN_IOS_CONFIGURATION: Release/);
  assert.match(source, /timeout-minutes: 30/);
  assert.match(source, /node scripts\/build-ios.mjs/);
  assert.match(source, /node scripts\/prepare-installer-input.mjs/);
  assert.match(source, /npm test/);
  assert.match(source, /persist-credentials: false/);
  assert.doesNotMatch(source, /uses:.*(?:upload-artifact|cache)|secrets\.|: write|gh release|git push|npm publish|continue-on-error|self-hosted|xlarge/);
  for (const match of source.matchAll(/uses:\s*(\S+)/g)) assert.match(match[1], /^actions\/[a-z-]+@[a-f0-9]{40}$/);
});
