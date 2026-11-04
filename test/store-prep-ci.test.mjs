import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { assertActualBuild } from '../lib/preview-package.mjs';
import { SCREENSHOT_NAMES } from '../lib/simulator-store-prep.mjs';

// Structural checks and isolated in-memory fixtures only. The fake PNG decoder,
// archive and CLI cannot establish actual iOS/Simulator, screenshot or draft proof.
// No real subprocess, network/API call or filesystem mutation is performed here.
const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const workflow = read('.github/workflows/cabin-store-prep.yml');
const stager = read('scripts/stage-store-prep.mjs');
const repository = 'citrus-13/cabin-direct-ios';
const branch = 'codex/public-build';
const commit = 'a'.repeat(40);
const runID = '123';
const tag = 'store-prep-' + runID;
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');

function section(source, key) {
  const lines = source.split('\n'), start = lines.indexOf(key + ':');
  assert.ok(start >= 0, 'Missing ' + key);
  let end = start + 1;
  while (end < lines.length && !/^[A-Za-z_][\w-]*:/.test(lines[end])) end++;
  return lines.slice(start + 1, end).filter(line => !/^\s*#/.test(line)).join('\n');
}
const steps = [...workflow.matchAll(/^      - name: (.+)$/gm)].map((item, index, all) => ({
  name: item[1], body: workflow.slice(item.index, all[index + 1]?.index ?? workflow.length)
}));
function shell(step) {
  const match = /^        run: (.+)$/m.exec(step.body);
  if (!match) return '';
  if (match[1] !== '|') return match[1];
  return step.body.slice(match.index + match[0].length).split('\n')
    .filter(line => /^          /.test(line)).map(line => line.slice(10)).join('\n');
}
function stepIndex(command) {
  const index = steps.findIndex(step => shell(step).includes(command));
  assert.ok(index >= 0, 'Missing ' + command);
  return index;
}

test('Store Prep dispatch-only real job guard rejects nonmanual/private/other-owner/nondefault refs', () => {
  assert.deepEqual([...section(workflow, 'on').matchAll(/^  ([\w-]+):/gm)].map(item => item[1]), ['workflow_dispatch']);
  const jobs = section(workflow, 'jobs');
  const guard = /^    if: \$\{\{\s*(.*?)\s*\}\}$/m.exec(jobs)?.[1];
  assert.ok(guard);
  assert.match(guard, /github\.event_name == 'workflow_dispatch'/);
  assert.match(guard, /github\.event\.repository\.private == false/);
  assert.match(guard, /github\.repository_owner == 'citrus-13'/);
  assert.match(guard, /github\.ref == 'refs\/heads\/codex\/public-build'/);
  const context = () => ({ repository, repository_owner: 'citrus-13', event_name: 'workflow_dispatch',
    ref: 'refs/heads/' + branch, event: { repository: { private: false, default_branch: branch } } });
  const accepts = github => vm.runInNewContext(guard, { github }, { timeout: 100 });
  assert.equal(accepts(context()), true);
  for (const event_name of ['push', 'pull_request', 'pull_request_target', 'schedule', 'release', 'workflow_run']) {
    assert.equal(accepts({ ...context(), event_name }), false);
  }
  assert.equal(accepts({ ...context(), repository_owner: 'another-owner' }), false);
  assert.equal(accepts({ ...context(), event: { repository: { private: true } } }), false);
  for (const ref of ['refs/heads/main', 'refs/heads/codex/public-preview', 'refs/tags/v0.4.0', 'refs/pull/1/merge']) {
    assert.equal(accepts({ ...context(), ref }), false);
  }
});

test('Store Prep uses only one bounded standard job, pinned actions and draft-step token', () => {
  assert.match(section(workflow, 'permissions'), /^  contents: read\s*$/);
  const jobs = section(workflow, 'jobs');
  assert.deepEqual([...jobs.matchAll(/^  ([\w-]+):/gm)].map(item => item[1]), ['remote_store_prep']);
  assert.match(jobs, /^    runs-on: xcode-27$/m);
  const timeout = Number(/^    timeout-minutes: (\d+)$/m.exec(jobs)?.[1]);
  assert.ok(timeout > 0 && timeout <= 30);
  assert.equal((workflow.match(/contents: write/g) || []).length, 1);
  assert.match(jobs, /^    permissions:\n      contents: write$/m);
  assert.match(workflow, /^  cancel-in-progress: false$/m);
  assert.deepEqual([...workflow.matchAll(/^\s+uses: (\S+)/gm)].map(item => item[1]), [
    'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
    'actions/setup-node@2028fbc5c25fe9cf00d9f06a71cc4710d4507903'
  ]);
  assert.match(workflow, /^          persist-credentials: false$/m);
  assert.match(workflow, /^          package-manager-cache: false$/m);
  assert.doesNotMatch(workflow, /upload-artifact|download-artifact|uses:.*(?:\/cache@|apple-actions)|self-hosted|matrix:|macos-\S*-(?:large|xlarge)/);
  const staging = stepIndex('node scripts/stage-store-prep.mjs');
  for (const [index, step] of steps.entries()) {
    assert.doesNotMatch(shell(step), /\$\{\{/, 'No GitHub expression interpolation into shell');
    if (index !== staging) assert.doesNotMatch(step.body, /GH_TOKEN|GITHUB_TOKEN|github\.token|secrets\./);
    assert.doesNotMatch(shell(step), /security\s+(?:import|create-keychain)|fastlane|altool|notarytool|allowProvisioningUpdates/);
  }
  assert.match(steps[staging].body, /^          GH_TOKEN: \$\{\{ github\.token \}\}$/m);
  assert.equal((workflow.match(/GH_TOKEN:/g) || []).length, 1);
  assert.doesNotMatch(workflow.slice(0, workflow.indexOf('    steps:')), /GH_TOKEN|GITHUB_TOKEN|secrets\./);
  assert.match(section(read('.github/workflows/cabin-public-build.yml'), 'permissions'), /^  contents: read\s*$/);
});

test('Store Prep validates metadata then actual Release/source tests/Simulator before draft staging', () => {
  assert.match(workflow, /^      CABIN_IOS_CONFIGURATION: Release$/m);
  const metadata = stepIndex('node scripts/check-store-metadata.mjs');
  const build = stepIndex('node scripts/build-ios.mjs');
  const tests = stepIndex('node --test');
  const simulator = stepIndex('node scripts/check-simulator-store-prep.mjs');
  const staging = stepIndex('node scripts/stage-store-prep.mjs');
  assert.ok(metadata < build && build < tests && tests < simulator && simulator < staging);
  assert.match(shell(steps[tests]), /tee "\$CABIN_STORE_TEST_LOG"/);
  for (const index of [metadata, build, tests, simulator, staging]) {
    assert.doesNotMatch(steps[index].body, /continue-on-error:|if:.*(?:always|failure)\(/);
  }
  assert.doesNotMatch(stager, /\['release',\s*'edit'|--draft=false|release',\s*'delete|--clobber|--force/);
  assert.match(stager, /assertActualBuild\(build,\{commit,configuration:'Release'\}\)/);
  assert.match(stager, /validateScreenshotPNG\(bytes\)/);
});

function simulateStager(options = {}) {
  const runner = '/simulated-runner', out = runner + '/cabin-store-screenshots';
  const staging = runner + '/cabin-store-release', buildDir = runner + '/cabin-store-ios';
  const zipName = 'CabinDirect-' + tag + '-simulator-evidence.zip';
  const assetNames = [zipName, 'simulator-report.json', 'SHA256SUMS.txt'];
  const files = new Map(), directories = new Set([runner, out, buildDir]);
  const calls = [], logs = [], summaries = [], decodedPNGs = [];
  const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const putJSON = (file, value) => files.set(file, Buffer.from(JSON.stringify(value)));
  const build = { source_commit: commit, configuration: 'Release', evidence_kind: 'actual',
    state: 'unsigned_ios_build_complete', passed: true, full_iOS_build: true, unsigned_product_present: true,
    packaged_privacy_manifests_verified: true, v1_profile_validated: true,
    preflight_only: false, signing_performed: false, device_test: false, source_dirty: false, ...options.build };
  putJSON(buildDir + '/ios-build-report.json', build);
  files.set(runner + '/tests.tap', Buffer.from(options.tap ?? '# tests 5\n# pass 5\n# fail 0\n# skipped 0\n# cancelled 0\n'));
  const screenshots = SCREENSHOT_NAMES.map(name => {
    const bytes = Buffer.from('SIMULATED PNG FIXTURE / ' + name);
    files.set(path.join(out, name + '.png'), bytes);
    return { name, file: name + '.png', sha256: hash(bytes), width: 1320, height: 2868,
      has_alpha: false, lossless_opaque_alpha_normalized: false };
  });
  const report = { schema_version: 1, evidence_kind: 'actual', kind: 'simulator-store-preparation', passed: true,
    state: 'simulator_ui_tests_complete', source_commit: commit, configuration: 'Release',
    workflow_url: 'https://github.com/' + repository + '/actions/runs/' + runID,
    simulator_only: true, owned_simulator_deleted: true, simulator_adhoc_signing: true,
    physical_iphone_test: false, vehicle_test: false, capture_test: false, app_store_approved: false,
    personal_signing: false, distribution_signing: false,
    simulator: { model: 'iPhone 17 Pro Max', runtime: 'com.apple.CoreSimulator.SimRuntime.iOS-27-0', os_version: '27.0' },
    phases: [{ name: 'simulator-ui-tests', passed: true, exit_code: 0, timed_out: false }],
    tests: { tests: 3, passed: 3, failed: 0, skipped: 0, expected_failures: 0, ...options.tests },
    screenshots, ...options.report };
  options.mutateScreenshots?.(report.screenshots);
  putJSON(out + '/simulator-report.json', report);
  if (options.tamperedPNG) files.set(out + '/connect-light.png', Buffer.from('SIMULATED TAMPERED BYTES'));
  if (options.extraFile) files.set(out + '/unreviewed.log', Buffer.from('SIMULATED EXTRA FILE'));
  if (options.existingStaging) directories.add(staging);
  let state = 'absent', tagCreated = false;
  const get = file => { assert.ok(files.has(file), 'Unexpected simulated file read: ' + file); return files.get(file); };
  const draft = () => ({ id: 456, tag_name: tag, draft: true, prerelease: true, target_commitish: commit,
    assets: assetNames.map((name, index) => ({ id: 100 + index, name, state: 'uploaded',
      size: get(path.join(staging, name)).length,
      digest: options.noDigest ? undefined : 'sha256:' + (options.badRemoteDigest ? '0'.repeat(64) : hash(get(path.join(staging, name)))) })) });
  const fakeFS = {
    constants: { COPYFILE_EXCL: 1 },
    realpathSync(file) { return path.resolve(file); },
    existsSync(file) { return files.has(file) || directories.has(file); },
    readFileSync(file, encoding) { const bytes = get(file); return encoding ? bytes.toString(encoding) : bytes; },
    readdirSync(directory) {
      assert.ok(directories.has(directory));
      return [...files.keys()].filter(file => path.dirname(file) === directory).map(file => path.basename(file));
    },
    lstatSync(file) { return { isFile: () => true, isSymbolicLink: () => !!options.symlink,
      size: options.oversizedEvidence ? 21 * 1024 * 1024 : get(file).length }; },
    statSync(file) { return { size: options.oversizedArchive && file.endsWith('.zip') ? 65 * 1024 * 1024 : get(file).length }; },
    mkdirSync(directory) { assert.equal(directory, staging); assert.equal(directories.has(directory), false); directories.add(directory); },
    copyFileSync(source, destination, flag) {
      assert.equal(flag, 1); assert.equal(files.has(destination), false);
      assert.equal(destination, staging + '/simulator-report.json'); files.set(destination, Buffer.from(get(source)));
    },
    writeFileSync(file, bytes, flags) {
      assert.equal(file, staging + '/SHA256SUMS.txt'); assert.equal(flags.flag, 'wx');
      assert.equal(files.has(file), false); files.set(file, Buffer.from(bytes));
    },
    appendFileSync(file, text) { assert.equal(file, '/simulated-summary'); summaries.push(text); }
  };
  const fakeSpawn = (command, args, settings) => {
    calls.push({ command, args: [...args] });
    const ok = value => ({ status: 0, stdout: Buffer.isBuffer(value) || typeof value === 'string' ? value : JSON.stringify(value), stderr: '' });
    if (command === 'git') {
      assert.deepEqual([...args], args[0] === 'rev-parse' ? ['rev-parse', 'HEAD'] : ['status', '--porcelain']);
      return ok(args[0] === 'rev-parse' ? options.gitHead ?? commit : options.dirty ? ' M SIMULATED.txt' : '');
    }
    if (command === '/usr/bin/ditto') {
      assert.equal(args.at(-2), out); assert.equal(args.at(-1), path.join(staging, zipName));
      files.set(path.join(staging, zipName), Buffer.from('SIMULATED ARCHIVE / NOT AN ACTUAL ZIP'));
      return ok('');
    }
    if (command === '/usr/bin/unzip') {
      assert.equal(args[0], '-Z1');
      const names = [...SCREENSHOT_NAMES.map(name => name + '.png'), 'simulator-report.json'];
      return ok([...names, ...(options.badArchive ? ['../unexpected.txt'] : [])].join('\n') + '\n');
    }
    assert.equal(command, 'gh', 'All external operations remain fake');
    const route = args.find(value => value.startsWith('repos/' + repository));
    if (args[0] === 'api') {
      if (route === 'repos/' + repository) return ok({ private: false, default_branch: branch, ...options.repo });
      if (route === 'repos/' + repository + '/releases?per_page=100') {
        assert.ok(args.includes('--paginate') && args.includes('--slurp'));
        const existing = options.existingDraft ? [{ id: 456, tag_name: tag, draft: true }] : [];
        return ok([[], state === 'draft' ? [draft()] : existing]);
      }
      if (route === 'repos/' + repository + '/git/ref/tags/' + tag) {
        return options.existingTag || tagCreated ? ok({ ref: options.wrongRefName ? 'refs/tags/unrelated' : 'refs/tags/' + tag,
          object: { type: 'commit', sha: options.wrongRefCommit ? 'b'.repeat(40) : commit } })
          : { status: 1, stdout: '', stderr: 'HTTP 404' };
      }
      if (route === 'repos/' + repository + '/git/refs') {
        assert.ok(args.includes('POST') && args.includes('ref=refs/tags/' + tag) && args.includes('sha=' + commit));
        assert.equal(tagCreated, false);
        if (options.concurrentTag) return { status: 1, stdout: '', stderr: 'HTTP 422 Reference already exists' };
        tagCreated = true; return ok({ ref: 'refs/tags/' + tag, object: { type: 'commit', sha: commit } });
      }
      if (route === 'repos/' + repository + '/releases/456') return ok({ ...draft(), ...options.draft });
      if (route?.startsWith('repos/' + repository + '/releases/assets/')) {
        assert.equal(settings.encoding, null); assert.ok(args.includes('Accept: application/octet-stream'));
        const bytes = Buffer.from(get(path.join(staging, assetNames[Number(route.split('/').at(-1)) - 100])));
        if (options.badDownload) bytes[0] ^= 0xff;
        return ok(bytes);
      }
    }
    if (args[0] === 'release' && args[1] === 'create') { state = 'draft'; return ok(''); }
    assert.fail('Unexpected simulated command: ' + JSON.stringify({ command, args }));
  };
  const env = { GITHUB_REPOSITORY: repository, GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REF: 'refs/heads/' + branch, GITHUB_SHA: commit, GITHUB_RUN_ID: runID,
    CABIN_IOS_WORK_DIR: buildDir, CABIN_SIM_OUT_DIR: out, CABIN_SIM_RELEASE_DIR: staging,
    RUNNER_TEMP: runner, CABIN_STORE_TEST_LOG: runner + '/tests.tap',
    GITHUB_STEP_SUMMARY: '/simulated-summary', GH_TOKEN: 'SIMULATED_NOT_A_REAL_TOKEN', ...options.env };
  const code = stager.replace(/^import .*;\n/gm, '').replaceAll('import.meta.url', 'moduleURL');
  let error;
  try {
    vm.runInNewContext(code, { fs: fakeFS, path, crypto, Buffer, spawnSync: fakeSpawn, fileURLToPath,
      moduleURL: new URL('../scripts/stage-store-prep.mjs', import.meta.url).href,
      assertActualBuild, SCREENSHOT_NAMES, validateScreenshotPNG(bytes) {
        decodedPNGs.push(Buffer.from(bytes));
        assert.ok(bytes.toString().startsWith('SIMULATED PNG FIXTURE / '));
        if (options.badPNG) throw new Error('SIMULATED PNG rejection');
        return { width: 1320, height: 2868, has_alpha: false };
      }, process: { env }, console: { log: value => logs.push(String(value)) } },
    { timeout: 500, contextCodeGeneration: { strings: false, wasm: false } });
  } catch (caught) { error = caught; }
  return { error, calls, logs, summaries, state, assetNames, staging, files, decodedPNGs };
}

const writes = result => result.calls.filter(({ command, args }) => command === 'gh' &&
  (args[0] === 'release' || args.includes('POST') || args.includes('PATCH') || args.includes('DELETE')));

test('[SIMULATED] clean actual-evidence-shaped inputs produce exactly three assets in a verified draft only', () => {
  const result = simulateStager();
  assert.ifError(result.error);
  assert.equal(result.state, 'draft');
  assert.equal(result.decodedPNGs.length, 8);
  const ghWrites = writes(result);
  assert.equal(ghWrites.length, 2, 'Only create ref and create draft; never publish/edit');
  const create = ghWrites.find(({ args }) => args[0] === 'release');
  assert.equal(create.args[1], 'create');
  for (const flag of ['--verify-tag', '--draft', '--prerelease', '--latest=false']) assert.ok(create.args.includes(flag));
  assert.deepEqual(create.args.filter(value => value.startsWith(result.staging + '/')),
    result.assetNames.map(name => path.join(result.staging, name)));
  assert.ok(!result.calls.some(({ args }) => args.includes('--draft=false') || args.includes('edit') || args.includes('--force')));
  const receipt = JSON.parse(result.logs.at(-1));
  assert.equal(receipt.draft, true); assert.equal(receipt.simulator_only, true);
  assert.equal(receipt.app_store_submitted, false); assert.equal(receipt.maintainer_visual_review_required, true);
  assert.match(result.summaries.join(''), /Not hardware\/capture\/vehicle acceptance/);
});

test('[SIMULATED] unauthorized/dirty/private/nondefault contexts fail before draft or tag mutation', () => {
  for (const options of [{ env: { GITHUB_EVENT_NAME: 'push' } }, { env: { GITHUB_REPOSITORY: 'other/repo' } },
    { env: { GITHUB_REF: 'refs/heads/main' } }, { env: { GITHUB_SHA: 'not-a-commit' } },
    { env: { GITHUB_RUN_ID: '123;unexpected' } }, { dirty: true }, { gitHead: 'b'.repeat(40) },
    { repo: { private: true } }, { repo: { default_branch: 'main' } }]) {
    const result = simulateStager(options);
    assert.ok(result.error, JSON.stringify(options)); assert.equal(writes(result).length, 0);
  }
});

test('[SIMULATED] existing drafts/tags and create races are preserved, never overwritten', () => {
  for (const options of [{ existingDraft: true }, { existingTag: true }, { concurrentTag: true }]) {
    const result = simulateStager(options); assert.ok(result.error);
    assert.ok(!result.calls.some(({ command, args }) => command === 'gh' && args[0] === 'release'));
    assert.ok(!result.calls.some(({ args }) => args.includes('PATCH') || args.includes('DELETE') || args.includes('--force')));
  }
});

test('[SIMULATED] real Release/privacy build and source tests are mandatory, not simulated/skipped evidence', () => {
  for (const build of [{ evidence_kind: 'simulated' }, { source_commit: 'b'.repeat(40) }, { configuration: 'Debug' },
    { packaged_privacy_manifests_verified: false }, { full_iOS_build: false }, { signing_performed: true },
    { device_test: true }, { source_dirty: true }, { preflight_only: true }, { v1_profile_validated: false }]) {
    const result = simulateStager({ build }); assert.ok(result.error, JSON.stringify(build)); assert.equal(writes(result).length, 0);
  }
  for (const tap of ['# tests 5\n# pass 4\n# fail 1\n# skipped 0\n# cancelled 0\n',
    '# tests 5\n# pass 5\n# fail 0\n# skipped 1\n# cancelled 0\n',
    '# tests 5\n# pass 5\n# fail 0\n# skipped 0\n# cancelled 1\n',
    '# tests 5\n# tests 5\n# pass 5\n# fail 0\n# skipped 0\n# cancelled 0\n']) {
    const result = simulateStager({ tap }); assert.ok(result.error); assert.equal(writes(result).length, 0);
  }
});

test('[SIMULATED] actual Simulator report requires exactly three passing UI tests and eight hashed PNGs', () => {
  for (const report of [{ evidence_kind: 'simulated' }, { source_commit: 'b'.repeat(40) }, { configuration: 'Debug' },
    { passed: false }, { workflow_url: 'https://example.invalid/run' }, { owned_simulator_deleted: false },
    { simulator_only: false }, { physical_iphone_test: true }, { vehicle_test: true }, { capture_test: true },
    { personal_signing: true }, { distribution_signing: true }, { app_store_approved: true }]) {
    const result = simulateStager({ report }); assert.ok(result.error, JSON.stringify(report)); assert.equal(writes(result).length, 0);
  }
  for (const tests of [{ tests: 2 }, { passed: 2 }, { failed: 1 }, { skipped: 1 }, { expected_failures: 1 }]) {
    const result = simulateStager({ tests }); assert.ok(result.error); assert.equal(writes(result).length, 0);
  }
  for (const options of [{ badPNG: true }, { tamperedPNG: true },
    { mutateScreenshots: images => images.pop() },
    { mutateScreenshots: images => { images[1] = { ...images[0] }; } },
    { mutateScreenshots: images => { images[0].sha256 = '0'.repeat(64); } },
    { mutateScreenshots: images => { images[0].has_alpha = true; } },
    { mutateScreenshots: images => { images[0].width = 1; } }]) {
    const result = simulateStager(options); assert.ok(result.error); assert.equal(writes(result).length, 0);
  }
});

test('[SIMULATED] source/private extras, symlinks, oversized files and invalid archive layout are rejected', () => {
  for (const options of [{ extraFile: true }, { existingStaging: true }, { symlink: true }, { oversizedEvidence: true },
    { oversizedArchive: true }, { badArchive: true }, { env: { CABIN_SIM_RELEASE_DIR: root } }]) {
    const result = simulateStager(options); assert.ok(result.error); assert.equal(writes(result).length, 0);
  }
});

test('[SIMULATED] raw logs/private paths are rejected at every strict report nesting level', () => {
  for (const options of [{ report: { raw_log: 'SIMULATED RAW TEXT' } },
    { report: { simulator: { model: 'iPhone 17 Pro Max', runtime: 'com.apple.CoreSimulator.SimRuntime.iOS-27-0',
      os_version: '27.0', private_path: '/SIMULATED/private' } } },
    { tests: { raw_log: 'SIMULATED RAW TEXT' } },
    { report: { phases: [{ name: 'simulator-ui-tests', passed: true, exit_code: 0, timed_out: false,
      private_path: '/SIMULATED/private' }] } },
    { mutateScreenshots: images => { images[0].raw_log = 'SIMULATED RAW TEXT'; } }]) {
    const result = simulateStager(options);
    assert.ok(result.error); assert.equal(writes(result).length, 0);
    assert.equal(result.logs.length, 0); assert.equal(result.summaries.length, 0);
  }
});

test('[SIMULATED] draft identity/ref/target/hash mismatches cannot yield a success receipt', () => {
  for (const options of [{ wrongRefCommit: true }, { wrongRefName: true },
    { draft: { id: 999 } }, { draft: { tag_name: 'unrelated-tag' } }, { draft: { target_commitish: 'b'.repeat(40) } },
    { draft: { draft: false } }, { draft: { prerelease: false } }, { draft: { assets: [] } }, { badRemoteDigest: true }]) {
    const result = simulateStager(options);
    assert.ok(result.error, 'Rejected mismatch: ' + JSON.stringify(options));
    assert.equal(result.logs.length, 0); assert.equal(result.summaries.length, 0);
  }
});

test('[SIMULATED] draft downloads verify bytes when API has no digest and corrupt bytes fail closed', () => {
  const good = simulateStager({ noDigest: true }); assert.ifError(good.error);
  assert.equal(good.calls.filter(({ args }) => args.some(value => value.includes('/releases/assets/'))).length, 3);
  assert.equal(good.state, 'draft');
  const bad = simulateStager({ noDigest: true, badDownload: true });
  assert.ok(bad.error); assert.equal(bad.logs.length, 0); assert.equal(bad.summaries.length, 0);
});

test('[SIMULATED] Store Prep failure diagnostics are failure-only, bounded and scrub synthetic secrets', () => {
  const step = steps.find(item => item.name === 'Bounded failure diagnostics');
  assert.match(step.body, /^        if: \$\{\{ failure\(\) \}\}$/m);
  const diagnostic = /<<'DIAGNOSTICS'\n([\s\S]*?)\nDIAGNOSTICS\s*$/.exec(shell(step))?.[1];
  assert.ok(diagnostic);
  const secret = 'SIMULATED_SECRET_VALUE_123456789';
  const text = ['error: token=' + secret, 'error: cookie=' + secret, 'error: pairing code=' + secret,
    'error: ghp_' + secret, 'error: https://user:' + secret + '@example.invalid',
    'error: /Users/SIMULATED_PERSON/private/path.swift', 'error: -----BEGIN PRIVATE KEY-----',
    'error: ' + secret, 'error: -----END PRIVATE KEY-----',
    ...Array.from({ length: 60 }, () => 'error: harmless compiler failure ' + 'x'.repeat(1100))].join('\n');
  const logs = [];
  vm.runInNewContext(diagnostic.replace(/^import .*;\n/gm, ''), {
    fs: { existsSync: () => true, readFileSync: () => text },
    process: { env: { CABIN_SIM_WORK_DIR: '/simulated-simulator', CABIN_IOS_WORK_DIR: '/simulated-build' } },
    console: { log: value => logs.push(String(value)) }
  }, { timeout: 100 });
  const output = logs.join('\n');
  assert.equal(output.includes(secret), false);
  assert.equal(/SIMULATED_PERSON|BEGIN PRIVATE KEY|END PRIVATE KEY/.test(output), false);
  assert.ok(logs.length <= 4 && output.length <= 205_000);
  for (const log of logs) assert.ok(log.split('\n').length <= 50);
});
