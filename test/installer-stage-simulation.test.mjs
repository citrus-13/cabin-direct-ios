import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { assertActualBuild } from '../lib/preview-package.mjs';
import { validateInstallerRelease } from '../lib/installer-release.mjs';

// Execute the production stager with synthetic, memory-only files and subprocesses.
// No real subprocess, GitHub request, account, signing operation, or release exists.
const source = readFileSync(new URL('../scripts/stage-installer-release.mjs', import.meta.url), 'utf8');
const imports = source.match(/^import .+;$/gm) ?? [];
assert.equal(imports.length, 7, 'Review the VM bindings when production imports change');
const executableSource = source.replace(/^import .+;\n/gm, '').replaceAll('import.meta.url', 'scriptURL');
const commit = 'a'.repeat(40), tag = 'v0.4.0-preview.3';
const repository = 'citrus-13/cabin-direct-ios', apiRoot = 'repos/' + repository;
const repo = '/synthetic/repo', runner = '/synthetic/runner';
const work = runner + '/cabin-installer-build', out = runner + '/cabin-installer-input';
const releaseID = 1001;
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function simulate(options = {}) {
  const ipaName = 'CabinDirect-' + commit.slice(0, 12) + '-adhoc-entitlement-input.ipa';
  const ipa = Buffer.from('SYNTHETIC IPA BYTES; NOT AN EXECUTABLE OR INSTALLABLE PRODUCT');
  const report = {
    schema_version: 1, kind: 'identity-free-adhoc-entitlement-input', source_commit: commit,
    actual_release_build: true, metadata_signatures_verified: true, requested_group_count: 1,
    original_unsigned_executables_unchanged: true, apple_account_used: false,
    apple_development_or_distribution_signed: false, profiles_present: false, directly_installable: false,
    re_signer_import_verified: false, device_test: false, renewal_test: false, vehicle_acceptance: false,
    original_executable_sha256: { app: 'b'.repeat(64), extension: 'c'.repeat(64) },
    metadata_executable_sha256: { app: 'd'.repeat(64), extension: 'e'.repeat(64) },
    ipa: ipaName, ipa_sha256: digest(ipa), ...options.reportPatch
  };
  const build = {
    source_commit: commit, configuration: 'Release', evidence_kind: 'actual',
    state: 'unsigned_ios_build_complete', passed: true, full_iOS_build: true,
    unsigned_product_present: true, packaged_privacy_manifests_verified: true, v1_profile_validated: true,
    preflight_only: false, signing_performed: false, device_test: false, source_dirty: false,
    ...options.buildPatch
  };
  const reportBytes = Buffer.from(JSON.stringify(report));
  const names = [ipaName, 'INSTALLER-INPUT.json', 'SHA256SUMS.txt'];
  const entries = new Map([
    [repo + '/package.json', Buffer.from(JSON.stringify({ version: '0.4.0' }))],
    [work + '/ios-build-report.json', Buffer.from(JSON.stringify(build))],
    [runner + '/cabin-installer-tests.tap', Buffer.from(options.tap ?? '# tests 3\n# pass 3\n# fail 0\n# skipped 0\n# cancelled 0\n')],
    [out + '/' + ipaName, ipa], [out + '/INSTALLER-INPUT.json', reportBytes],
    [out + '/SHA256SUMS.txt', Buffer.from(options.checksums ??
      digest(ipa) + '  ' + ipaName + '\n' + digest(reportBytes) + '  INSTALLER-INPUT.json\n')]
  ]);
  const directories = new Set([repo, runner, work, out]);
  function file(name) {
    assert.ok(entries.has(name), 'Unexpected synthetic file read: ' + name);
    return entries.get(name);
  }
  const fakeFS = {
    realpathSync(name) {
      assert.ok(directories.has(name) || entries.has(name), 'Unexpected synthetic realpath: ' + name);
      return name;
    },
    readFileSync(name, encoding) {
      const bytes = file(name);
      return encoding ? bytes.toString(encoding) : Buffer.from(bytes);
    },
    statSync(name) { return this.lstatSync(name); },
    lstatSync(name) {
      const isDirectory = directories.has(name);
      const size = isDirectory ? 0 : file(name).length;
      return { size, isDirectory: () => isDirectory, isFile: () => !isDirectory,
        isSymbolicLink: () => name === options.symlink };
    }
  };
  const calls = [], output = [], uploads = [];
  let tagExists = Boolean(options.existingTag), created = false;
  const reply = (value, binary = false) => ({ status: 0, stdout: binary ? Buffer.from(value) :
    typeof value === 'string' ? value : JSON.stringify(value), stderr: binary ? Buffer.alloc(0) : '' });
  const fail = message => ({ status: 1, stdout: '', stderr: message });
  function fields(args) {
    const values = {};
    for (let i = 0; i < args.length; i++) {
      if (args[i] !== '-f' && args[i] !== '-F' && args[i] !== '--field' && args[i] !== '--raw-field') continue;
      const raw = args[++i], equal = raw.indexOf('=');
      values[raw.slice(0, equal)] = raw.slice(equal + 1);
    }
    return values;
  }
  function fakeSpawn(command, rawArgs, spawnOptions) {
    const args = Array.from(rawArgs);
    calls.push({ command, args, options: { cwd: spawnOptions.cwd, encoding: spawnOptions.encoding } });
    assert.equal(spawnOptions.cwd, repo);
    assert.notEqual(spawnOptions.shell, true);
    if (command === 'git') {
      if (args.join(' ') === 'rev-parse HEAD') return reply(options.head ?? commit);
      if (args.join(' ') === 'status --porcelain') return reply(options.dirty ? ' M synthetic-file' : '');
      assert.fail('Unexpected simulated git operation');
    }
    assert.equal(command, 'gh', 'No other subprocess is permitted by this simulation');
    assert.equal(args[0], 'api', 'No gh release edit/publish/delete command is permitted');
    const explicitHost = args[1] === '--hostname';
    const hostname = explicitHost ? args[2] : 'api.github.com';
    assert.ok(['api.github.com', 'github.com'].includes(hostname),
      'Do not treat uploads.github.com as an instance hostname: gh would prepend api.');
    const endpoint = args[explicitHost ? 3 : 1];
    const methodIndex = args.indexOf('--method');
    const method = methodIndex < 0 ? 'GET' : args[methodIndex + 1];
    assert.ok(['GET', 'POST'].includes(method), 'No PATCH/PUT/DELETE operation is permitted');
    if (endpoint === apiRoot && method === 'GET') {
      return reply({ private: Boolean(options.privateRepo), default_branch: options.defaultBranch ?? 'codex/public-build' });
    }
    if (endpoint === apiRoot + '/releases?per_page=100' && method === 'GET') {
      assert.ok(args.includes('--paginate') && args.includes('--slurp'));
      // Deliberately stale forever: creating a draft must NOT depend on list visibility.
      return reply(options.existingRelease ? [[{ id: 999, tag_name: tag, draft: true }]] : [[]]);
    }
    if (endpoint === apiRoot + '/git/ref/tags/' + tag && method === 'GET') {
      if (!tagExists) return fail('gh: Not Found (HTTP 404)');
      return reply({ ref: 'refs/tags/' + tag, object: { type: 'commit', sha: options.tagSHA ?? commit } });
    }
    if (endpoint === apiRoot + '/git/refs' && method === 'POST') {
      const form = fields(args);
      assert.deepEqual(form, { ref: 'refs/tags/' + tag, sha: commit });
      if (options.concurrentTag) return fail('gh: Reference already exists (HTTP 422)');
      assert.equal(tagExists, false);
      tagExists = true;
      return reply({ ref: form.ref, object: { type: 'commit', sha: commit } });
    }
    if (endpoint === apiRoot + '/releases' && method === 'POST') {
      assert.equal(tagExists, true);
      assert.equal(created, false);
      const form = fields(args);
      assert.equal(form.tag_name, tag);
      assert.equal(form.target_commitish, commit);
      assert.equal(form.draft, 'true');
      assert.equal(form.prerelease, 'true');
      assert.equal(args[args.indexOf('draft=true') - 1], '-F', 'GitHub expects a Boolean, not a string');
      assert.equal(args[args.indexOf('prerelease=true') - 1], '-F');
      assert.equal(form.make_latest, 'false');
      assert.match(form.body, /NOT Apple Ad Hoc distribution/);
      assert.match(form.body, /NOT been validated/);
      created = true;
      return reply({ id: options.createdID ?? releaseID, tag_name: tag, target_commitish: commit,
        draft: true, prerelease: true, assets: [], ...options.createdPatch });
    }
    if (endpoint.startsWith('https://uploads.github.com/') && method === 'POST') {
      assert.equal(created, true);
      assert.equal(explicitHost, true);
      assert.equal(hostname, 'github.com', 'Use GitHub.com auth context with an absolute uploads URL');
      const url = new URL(endpoint);
      assert.equal(url.origin, 'https://uploads.github.com');
      assert.equal(url.pathname, '/repos/' + repository + '/releases/' + releaseID + '/assets');
      const name = url.searchParams.get('name');
      assert.ok(names.includes(name), 'Only the three curated assets may be uploaded');
      assert.ok(!uploads.some(asset => asset.name === name), 'No duplicate/replacement upload');
      const inputIndex = args.indexOf('--input');
      assert.ok(inputIndex >= 0);
      assert.equal(args[inputIndex + 1], out + '/' + name);
      assert.ok(args.includes('Content-Type: application/octet-stream'));
      const bytes = file(args[inputIndex + 1]);
      const asset = { id: 2001 + uploads.length, name, state: 'uploaded', size: bytes.length,
        digest: options.missingDigest ? null : 'sha256:' + digest(bytes) };
      uploads.push(asset);
      return reply({ ...asset, ...options.uploadPatch });
    }
    if (endpoint === apiRoot + '/releases/' + releaseID && method === 'GET') {
      assert.equal(created, true);
      const assets = uploads.map(asset => ({ ...asset }));
      if (options.badDigest && assets.length) assets[0].digest = 'sha256:' + '0'.repeat(64);
      if (options.badAssetSize && assets.length) assets[0].size++;
      return reply({ id: releaseID, tag_name: tag, target_commitish: commit,
        draft: !options.publishedDraft, prerelease: true, assets, ...options.draftPatch });
    }
    const asset = uploads.find(item => endpoint === apiRoot + '/releases/assets/' + item.id);
    if (asset && method === 'GET') {
      assert.equal(spawnOptions.encoding, null, 'Fallback download must preserve bytes');
      assert.ok(args.includes('Accept: application/octet-stream'));
      const bytes = Buffer.from(file(out + '/' + asset.name));
      if (options.badDownload) bytes[0] ^= 1;
      return reply(bytes, true);
    }
    assert.fail('Unexpected simulated GitHub request: ' + method + ' ' + endpoint);
  }
  const env = {
    GITHUB_REPOSITORY: repository, GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REF: 'refs/heads/codex/public-build', GITHUB_SHA: commit,
    GITHUB_RUN_ID: '123456', CABIN_INSTALLER_TAG: tag, RUNNER_TEMP: runner,
    CABIN_IOS_WORK_DIR: work, ...options.env
  };
  let error;
  try {
    vm.runInNewContext(executableSource, {
      fs: fakeFS, path, crypto, spawnSync: fakeSpawn, fileURLToPath,
      assertActualBuild, validateInstallerRelease, Buffer, URL,
      scriptURL: 'file://' + repo + '/scripts/stage-installer-release.mjs',
      process: { env }, console: { log: value => output.push(String(value)) }
    }, { timeout: 1000, contextCodeGeneration: { strings: false, wasm: false } });
  } catch (caught) { error = caught; }
  return { calls, output, uploads, error, names, tagExists, created };
}

const writes = result => result.calls.filter(call => call.command === 'gh' && call.args.includes('--method'));
function rejected(result) {
  assert.ok(result.error, 'Expected simulated stager refusal');
  assert.notEqual(result.error.name, 'AssertionError', 'A fake-transport assertion is not evidence of production refusal');
  assert.equal(result.output.length, 0, 'A failed staging run must not print successful draft evidence');
}

test('SIMULATED stager uses returned draft ID despite permanently stale release list; uploads exactly three assets', () => {
  const result = simulate();
  assert.ifError(result.error);
  assert.deepEqual(result.uploads.map(asset => asset.name), result.names);
  assert.equal(result.calls.filter(call => call.args[1] === apiRoot + '/releases?per_page=100').length, 1);
  assert.equal(writes(result).length, 5, 'Exactly one create-only tag, one draft, and three asset uploads');
  assert.equal(result.output.length, 1);
  const evidence = JSON.parse(result.output[0]);
  assert.equal(evidence.release_id, releaseID);
  assert.equal(evidence.source_commit, commit);
  assert.equal(evidence.draft, true);
  assert.equal(evidence.prerelease, true);
  assert.equal(evidence.directly_installable, false);
  assert.equal(evidence.maintainer_download_review_required, true);
  assert.deepEqual(evidence.assets.map(asset => asset.name), result.names);
});

test('SIMULATED stager refuses existing tags or draft releases before any remote write', () => {
  for (const options of [{ existingTag: true }, { existingRelease: true }]) {
    const result = simulate(options); rejected(result);
    assert.equal(writes(result).length, 0);
    assert.equal(result.created, false);
  }
});

test('SIMULATED create-only tag race leaves existing ref untouched and never creates a release', () => {
  const result = simulate({ concurrentTag: true }); rejected(result);
  assert.equal(writes(result).length, 1);
  assert.equal(result.created, false);
});

test('SIMULATED malformed create response stops before uploading and never discovers a replacement draft by listing', () => {
  for (const createdPatch of [{ id: 0 }, { id: -1 }, { id: '1001' }, { draft: false },
    { prerelease: false }, { tag_name: 'v0.4.0-preview.2' }, { target_commitish: 'f'.repeat(40) },
    { assets: [{ name: 'unexpected' }] }]) {
    const result = simulate({ createdPatch }); rejected(result);
    assert.equal(writes(result).length, 2);
    assert.equal(result.uploads.length, 0);
    assert.equal(result.calls.filter(call => call.args[1] === apiRoot + '/releases?per_page=100').length, 1);
  }
});

test('SIMULATED unexpected upload response aborts without retrying, replacing, deleting, or publishing', () => {
  for (const uploadPatch of [{ id: 0 }, { name: 'unexpected' }, { state: 'starter' }, { size: 0 }]) {
    const result = simulate({ uploadPatch }); rejected(result);
    assert.equal(result.created, true);
    assert.equal(result.uploads.length, 1);
    assert.equal(writes(result).length, 3);
  }
});

test('SIMULATED stager rejects changed remote digest, asset size, publication state, or target SHA', () => {
  for (const options of [{ badDigest: true }, { badAssetSize: true }, { publishedDraft: true },
    { draftPatch: { target_commitish: 'f'.repeat(40) } }]) {
    const result = simulate(options); rejected(result);
    assert.equal(result.created, true);
    assert.equal(result.uploads.length, 3);
    assert.equal(writes(result).length, 5, 'Verification failure never edits, publishes, deletes, or retries assets');
  }
});

test('SIMULATED missing server digests cause exact binary downloads and SHA-256 verification', () => {
  const result = simulate({ missingDigest: true });
  assert.ifError(result.error);
  assert.equal(result.calls.filter(call => call.args[1]?.startsWith(apiRoot + '/releases/assets/')).length, 3);
  const corrupt = simulate({ missingDigest: true, badDownload: true }); rejected(corrupt);
  assert.equal(writes(corrupt).length, 5);
});

test('SIMULATED stager real validation helpers reject stale/build/test/checksum/context evidence before remote writes', () => {
  for (const options of [
    { buildPatch: { evidence_kind: 'simulated' } }, { buildPatch: { source_commit: 'f'.repeat(40) } },
    { reportPatch: { profiles_present: true } }, { reportPatch: { source_commit: 'f'.repeat(40) } },
    { dirty: true }, { head: 'f'.repeat(40) }, { privateRepo: true }, { defaultBranch: 'other' },
    { env: { GITHUB_EVENT_NAME: 'push' } }, { env: { GITHUB_REPOSITORY: 'unrelated/repository' } },
    { env: { CABIN_INSTALLER_TAG: '../escape' } }, { checksums: 'incorrect\n' },
    { tap: '# tests 3\n# pass 2\n# fail 0\n# skipped 1\n# cancelled 0\n' },
    { tap: '# tests 3\n# pass 3\n# fail 0\n# skipped 0\n# cancelled 0\n# pass 3\n' },
    { symlink: out + '/INSTALLER-INPUT.json' }
  ]) {
    const result = simulate(options); rejected(result);
    assert.equal(writes(result).length, 0);
  }
});
