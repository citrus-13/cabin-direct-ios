import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, truncateSync, symlinkSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:net';
import { validatePreviewTag, assertActualBuild, assertDeviceExecutable, auditBundleTree, makePreviewInfo } from '../lib/preview-package.mjs';

const commit = 'a'.repeat(40), version = '0.4.0', tag = 'v0.4.0-preview.1';
function actual() {
  return { source_commit: commit, configuration: 'Release', evidence_kind: 'actual',
    state: 'unsigned_ios_build_complete', passed: true, full_iOS_build: true,
    unsigned_product_present: true, packaged_privacy_manifests_verified: true, v1_profile_validated: true,
    preflight_only: false, signing_performed: false, device_test: false, source_dirty: false };
}
function options() {
  return { report: actual(), tag, version, commit,
    runURL: 'https://github.com/citrus-13/cabin-direct-ios/actions/runs/123456789',
    executableHashes: { app: 'b'.repeat(64), extension: 'c'.repeat(64) },
    testSummary: { tests: 9, passed: 9, failed: 0, skipped: 0, cancelled: 0 } };
}
function fixture(t) {
  assert.ok(process.env.TMPDIR && path.isAbsolute(process.env.TMPDIR), 'Tests require explicit absolute TMPDIR');
  const root = mkdtempSync(path.join(process.env.TMPDIR, 'preview-audit-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const app = path.join(root, 'Synthetic.app'); mkdirSync(app);
  return { root, app };
}

function syntheticExecutable(commands = [{ command: 0x32, size: 24, platform: 2, tools: 0 }]) {
  const size = commands.reduce((sum, item) => sum + item.size, 0);
  const buffer = Buffer.alloc(32 + size);
  for (const [offset, value] of [[0, 0xfeedfacf], [4, 0x0100000c], [12, 2], [16, commands.length], [20, size]]) {
    buffer.writeUInt32LE(value, offset);
  }
  let offset = 32;
  for (const item of commands) {
    buffer.writeUInt32LE(item.command, offset); buffer.writeUInt32LE(item.size, offset + 4);
    if (item.command === 0x32 && item.size >= 24) {
      buffer.writeUInt32LE(item.platform, offset + 8); buffer.writeUInt32LE(item.tools, offset + 20);
    }
    offset += item.size;
  }
  return buffer;
}

test('device executable accepts bounded thin arm64 iOS Mach-O command tables', () => {
  const minimal = syntheticExecutable(), before = Buffer.from(minimal);
  assert.deepEqual(assertDeviceExecutable(minimal), { architecture: 'arm64', platform: 'ios' });
  assert.deepEqual(minimal, before, 'Validation is read-only');
  assertDeviceExecutable(syntheticExecutable([{ command: 0x19, size: 72 }, { command: 0x32, size: 32, platform: 2, tools: 1 }]));
  assertDeviceExecutable(Buffer.concat([minimal, Buffer.from('synthetic executable payload')]));
});

test('device executable rejects text, fat, endian, architecture, type and platform mismatches', () => {
  for (const bad of [null, 'not a binary', new Uint8Array(56), Buffer.alloc(31), Buffer.from('not an object file'.repeat(8))]) {
    assert.throws(() => assertDeviceExecutable(bad));
  }
  for (const [offset, value] of [[0, 0xcafebabe], [0, 0xbebafeca], [0, 0xcffaedfe], [0, 0xfeedface],
    [4, 0x01000007], [4, 12], [12, 6], [40, 1], [40, 7], [40, 0]]) {
    const binary = syntheticExecutable(); binary.writeUInt32LE(value, offset);
    assert.throws(() => assertDeviceExecutable(binary), `${offset}:${value}`);
  }
});

test('device executable rejects truncated, oversized, unaligned and inconsistent commands', () => {
  const original = syntheticExecutable();
  for (let length = 0; length < original.length; length++) assert.throws(() => assertDeviceExecutable(original.subarray(0, length)));
  for (const [offset, value] of [[16, 0], [16, 2], [16, 4097], [16, 0xffffffff], [20, 0], [20, 16],
    [20, 25], [20, 32], [20, 1024 * 1024 + 8], [20, 0xffffffff], [36, 0], [36, 4], [36, 8],
    [36, 16], [36, 25], [36, 32], [36, 0xfffffff8], [52, 1], [52, 0xffffffff]]) {
    const binary = Buffer.from(original); binary.writeUInt32LE(value, offset);
    assert.throws(() => assertDeviceExecutable(binary), `${offset}:${value}`);
  }
  const trailingCommand = syntheticExecutable([{ command: 0x32, size: 24, platform: 2, tools: 0 }, { command: 0x19, size: 8 }]);
  trailingCommand.writeUInt32LE(1, 16);
  assert.throws(() => assertDeviceExecutable(trailingCommand), /Incomplete/);
  assert.throws(() => assertDeviceExecutable(syntheticExecutable([{ command: 0x19, size: 8 }])), /Incomplete/);
  assert.throws(() => assertDeviceExecutable(syntheticExecutable([{ command: 0x32, size: 32, platform: 2, tools: 0 }])), /tool bounds/);
});

test('device executable rejects duplicate and conflicting build-version declarations', () => {
  for (const platform of [2, 7, 1]) {
    assert.throws(() => assertDeviceExecutable(syntheticExecutable([
      { command: 0x32, size: 24, platform: 2, tools: 0 },
      { command: 0x32, size: 24, platform, tools: 0 }
    ])), /duplicate/);
  }
});

test('preview tags accept only exact version-bound positive bounded sequences', () => {
  for (const suffix of ['1', '99', '9999']) assert.equal(validatePreviewTag(`v${version}-preview.${suffix}`, version), `v${version}-preview.${suffix}`);
  for (const bad of ['v0.4.0', 'v0.4.1-preview.1', '../v0.4.0-preview.1', 'v0.4.0-preview.0', 'v0.4.0-preview.01',
    'v0.4.0-preview.-1', 'v0.4.0-preview.10000', 'v0.4.0-preview.1/../../x', `${tag}\n`, `${tag}\r`, `${tag}\0`, `${tag} `, null, 1]) {
    assert.throws(() => validatePreviewTag(bad, version));
  }
  for (const bad of ['0.4', '0.4.0-beta', 'v0.4.0', '0.4.0\n', '0/4/0', null, 4]) assert.throws(() => validatePreviewTag(tag, bad));
});

test('actual build requires every exact success/exclusion field and the supplied commit', () => {
  const report = actual(); assert.equal(assertActualBuild(report, { commit }), report);
  for (const [key, value] of Object.entries(report)) {
    const missing = actual(); delete missing[key]; assert.throws(() => assertActualBuild(missing, { commit }), key);
    if (typeof value === 'boolean') {
      for (const bad of [!value, String(value), value ? 1 : 0, null]) assert.throws(() => assertActualBuild({ ...actual(), [key]: bad }, { commit }), key);
    }
  }
  for (const patch of [{ evidence_kind: 'simulated' }, { state: 'simulated_build_complete' }, { state: 'preflight_complete' },
    { source_commit: 'd'.repeat(40) }, { configuration: 'Debug' }, { source_dirty: true }]) {
    assert.throws(() => assertActualBuild({ ...actual(), ...patch }, { commit }));
  }
  for (const bad of ['', 'a'.repeat(39), `${commit}\n`, 'g'.repeat(40), null]) assert.throws(() => assertActualBuild(actual(), { commit: bad }));
  assert.throws(() => assertActualBuild(actual(), { commit, configuration: 'Debug' }));
  assert.throws(() => assertActualBuild(Object.create(actual()), { commit }), /Missing data field/);
  const accessor = actual(); Object.defineProperty(accessor, 'passed', { get() { throw new Error('Accessor ran'); } });
  assert.throws(() => assertActualBuild(accessor, { commit }), /Missing data field/);
});

test('bundle audit counts regular files recursively without modifying contents', t => {
  const { app } = fixture(t); mkdirSync(path.join(app, 'PlugIns', 'Synthetic.appex'), { recursive: true });
  const binary = path.join(app, 'Synthetic'); writeFileSync(binary, 'ORIGINAL SYNTHETIC BYTES');
  writeFileSync(path.join(app, 'PlugIns', 'Synthetic.appex', 'Info.plist'), 'fixture');
  assert.deepEqual(auditBundleTree(app), { files: 2, bytes: Buffer.byteLength('ORIGINAL SYNTHETIC BYTESfixture') });
  assert.equal(readFileSync(binary, 'utf8'), 'ORIGINAL SYNTHETIC BYTES');
  assert.throws(() => auditBundleTree('Synthetic.app'));
  assert.throws(() => auditBundleTree(path.dirname(app)));
  const file = path.join(path.dirname(app), 'File.app'); writeFileSync(file, 'not a directory');
  assert.throws(() => auditBundleTree(file));
});

test('bundle audit rejects signing material, secrets and forbidden paths at every depth', t => {
  const { app } = fixture(t); const nested = path.join(app, 'PlugIns'); mkdirSync(nested);
  const names = ['embedded.mobileprovision', 'identity.p12', 'AuthKey.p8', 'certificate.pem', 'private.key', 'public.cer',
    'UPPER.P12', '.env', '.env.local', '.ENV.production', '.DS_Store', '.git', 'node_modules', '_CodeSignature'];
  for (const name of names) {
    const item = path.join(nested, name);
    if (['.git', 'node_modules', '_CodeSignature'].includes(name)) mkdirSync(item);
    else writeFileSync(item, 'synthetic placeholder, not a credential');
    assert.throws(() => auditBundleTree(app), /Forbidden bundle entry/, name);
    rmSync(item, { recursive: true });
  }
});

test('bundle audit rejects root, file, directory and broken symbolic links', t => {
  const { root, app } = fixture(t); const target = path.join(root, 'original.txt'); writeFileSync(target, 'fixture');
  const alias = path.join(root, 'Alias.app'); symlinkSync(app, alias);
  assert.throws(() => auditBundleTree(alias), /real directory/);
  for (const destination of [target, root, path.join(root, 'absent')]) {
    const entry = path.join(app, 'link'); symlinkSync(destination, entry);
    assert.throws(() => auditBundleTree(app), /symlinks/); rmSync(entry);
  }
  assert.equal(readFileSync(target, 'utf8'), 'fixture');
});

test('bundle audit rejects special Unix socket files', async t => {
  if (process.platform === 'win32') { t.skip('Unix filesystem sockets only'); return; }
  const { app } = fixture(t), server = createServer();
  // Some canonical session paths exceed the OS socket-address limit. Bind using
  // a short relative pathname while staying within this test's owned directory.
  const cwd = process.cwd();
  try {
    process.chdir(app);
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen('fixture.sock', resolve); });
    assert.throws(() => auditBundleTree(app), /special files/);
  } finally {
    await new Promise(resolve => server.close(resolve));
    process.chdir(cwd);
  }
});

test('bundle byte bound accepts exactly 64 MiB and rejects one additional byte', t => {
  const { app } = fixture(t), file = path.join(app, 'Synthetic'); writeFileSync(file, '');
  truncateSync(file, 64 * 1024 * 1024);
  assert.deepEqual(auditBundleTree(app), { files: 1, bytes: 64 * 1024 * 1024 });
  truncateSync(file, 64 * 1024 * 1024 + 1);
  assert.throws(() => auditBundleTree(app), /byte limit/);
});

test('bundle file bound accepts exactly 10000 and rejects 10001', t => {
  const { app } = fixture(t);
  for (let i = 0; i < 10_000; i++) writeFileSync(path.join(app, `fixture-${i}`), '');
  assert.deepEqual(auditBundleTree(app), { files: 10_000, bytes: 0 });
  writeFileSync(path.join(app, 'one-too-many'), ''); assert.throws(() => auditBundleTree(app), /file limit/);
});

test('preview metadata is an explicit allowlist, never raw build report or caller extras', () => {
  const input = options();
  input.report.secret = 'SYNTHETIC-DO-NOT-COPY'; input.report.paths = ['SYNTHETIC-PRIVATE-PATH'];
  input.env = { secret: 'SYNTHETIC-DO-NOT-COPY' }; input.error = 'SYNTHETIC-ERROR';
  input.executableHashes.path = 'SYNTHETIC-PRIVATE-PATH'; input.testSummary.raw_output = 'SYNTHETIC-RAW-OUTPUT';
  Object.defineProperty(input.report, 'unrelatedGetter', { get() { throw new Error('Must not inspect unrelated fields'); } });
  const result = makePreviewInfo(input);
  assert.deepEqual(result, { schema_version: 1, kind: 'unsigned-developer-preview', tag, version, source_commit: commit,
    configuration: 'Release', full_iOS_build: true, signing_performed: false, requires_personal_signing: true,
    device_test: false, vehicle_acceptance: false, app_store_approved: false, run_url: input.runURL,
    executable_sha256: { app: 'b'.repeat(64), extension: 'c'.repeat(64) },
    source_tests: { tests: 9, passed: 9, failed: 0, skipped: 0, cancelled: 0 } });
  assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC|secret|paths|env|raw_output|error/);
  input.testSummary.passed = 0; assert.equal(result.source_tests.passed, 9, 'No caller-owned nested references retained');
});

test('metadata rejects malformed hashes and noncanonical official run URLs', () => {
  for (const field of ['app', 'extension']) for (const bad of ['', 'a'.repeat(63), 'a'.repeat(65), 'z'.repeat(64), `${'a'.repeat(64)}\n`, null]) {
    const input = options(); input.executableHashes[field] = bad; assert.throws(() => makePreviewInfo(input));
  }
  for (const bad of ['http://github.com/citrus-13/cabin-direct-ios/actions/runs/1',
    'https://github.com.evil.invalid/citrus-13/cabin-direct-ios/actions/runs/1',
    'https://github.com/other/cabin-direct-ios/actions/runs/1',
    'https://github.com/citrus-13/other/actions/runs/1',
    'https://fake:fake@github.com/citrus-13/cabin-direct-ios/actions/runs/1',
    'https://github.com/citrus-13/cabin-direct-ios/actions/runs/../1',
    'https://github.com/citrus-13/cabin-direct-ios/actions/runs/1?token=synthetic',
    'https://github.com/citrus-13/cabin-direct-ios/actions/runs/1#fragment',
    `${options().runURL}\n`, null]) assert.throws(() => makePreviewInfo({ ...options(), runURL: bad }));
});

test('metadata rejects incomplete test evidence and rechecks actual build requirements', () => {
  for (const patch of [{ tests: 0, passed: 0 }, { tests: 10 }, { failed: 1 }, { skipped: 1 }, { cancelled: 1 },
    { passed: '9' }, { tests: NaN }, { passed: Infinity }, { skipped: -1 }, { tests: 9.5 }, { tests: Number.MAX_SAFE_INTEGER + 1 }]) {
    const input = options(); Object.assign(input.testSummary, patch); assert.throws(() => makePreviewInfo(input));
  }
  for (const field of ['tests', 'passed', 'failed', 'skipped', 'cancelled']) {
    const input = options(); delete input.testSummary[field]; assert.throws(() => makePreviewInfo(input));
  }
  for (const patch of [{ evidence_kind: 'simulated' }, { source_commit: 'f'.repeat(40) }, { source_dirty: true }, { configuration: 'Debug' }]) {
    const input = options(); Object.assign(input.report, patch); assert.throws(() => makePreviewInfo(input));
  }
});
