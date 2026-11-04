import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { validatePreviewTag } from '../lib/preview-package.mjs';

// Source assertions and isolated, in-memory simulations only. No subprocess,
// GitHub/API request, filesystem mutation, Xcode, signing or release is executed.
// Passing these tests is not proof of an actual build, package or publication.
const root = fileURLToPath(new URL('../', import.meta.url));
const read = file => readFileSync(path.join(root, file), 'utf8');
const workflow = read('.github/workflows/cabin-preview-release.yml');
const compileWorkflow = read('.github/workflows/cabin-public-build.yml');
const publisher = read('scripts/publish-preview.mjs');
const packager = read('scripts/package-preview.mjs');
const repository = 'citrus-13/cabin-direct-ios';
const branch = 'codex/public-build';
const tag = 'v0.4.0-preview.1';
const commit = 'a'.repeat(40);

function section(source, key) {
  const lines = source.split('\n');
  const start = lines.findIndex(line => line === `${key}:`);
  assert.ok(start >= 0, `Missing ${key} section`);
  let end = start + 1;
  while (end < lines.length && !/^[A-Za-z_][\w-]*:/.test(lines[end])) end++;
  return lines.slice(start + 1, end).filter(line => !/^\s*#/.test(line)).join('\n');
}

const steps = [...workflow.matchAll(/^      - name: (.+)$/gm)].map((match, index, all) => ({
  name: match[1], body: workflow.slice(match.index, all[index + 1]?.index ?? workflow.length)
}));

function shell(step) {
  const match = /^        run: (.+)$/m.exec(step.body);
  if (!match) return '';
  if (match[1] !== '|') return match[1];
  return step.body.slice(match.index + match[0].length).split('\n')
    .filter(line => /^          /.test(line)).map(line => line.slice(10)).join('\n');
}

function stepIndex(script) {
  const index = steps.findIndex(step => shell(step).includes(script));
  assert.ok(index >= 0, `Missing step invoking ${script}`);
  return index;
}

test('preview CI is manual-only and its real job guard rejects wrong trigger/owner/privacy/ref', () => {
  const triggers = section(workflow, 'on');
  assert.deepEqual([...triggers.matchAll(/^  ([\w-]+):/gm)].map(match => match[1]), ['workflow_dispatch']);
  assert.doesNotMatch(triggers, /^\s*(?:push|pull_request|pull_request_target|schedule|release|workflow_run|tags):/m);
  const expression = /^    if: \$\{\{\s*(.*?)\s*\}\}$/m.exec(section(workflow, 'jobs'))?.[1];
  assert.ok(expression, 'Job must be guarded before runner allocation');
  assert.match(expression, /github\.event_name\s*==\s*'workflow_dispatch'/);
  assert.match(expression, /github\.event\.repository\.private\s*==\s*false/);
  assert.match(expression, /github\.repository_owner\s*==\s*'citrus-13'/);
  assert.match(expression, /github\.ref\s*==\s*'refs\/heads\/codex\/public-build'/);
  const context = () => ({ event_name: 'workflow_dispatch', repository, repository_owner: 'citrus-13',
    ref: `refs/heads/${branch}`, event: { repository: { private: false, default_branch: branch } } });
  const accepts = github => vm.runInNewContext(expression, { github }, { timeout: 100 });
  assert.equal(accepts(context()), true);
  for (const event_name of ['push', 'pull_request', 'pull_request_target', 'schedule', 'workflow_run', 'release']) {
    assert.equal(accepts({ ...context(), event_name }), false, event_name);
  }
  assert.equal(accepts({ ...context(), event: { repository: { private: true, default_branch: branch } } }), false);
  assert.equal(accepts({ ...context(), repository_owner: 'another-owner' }), false);
  for (const ref of ['refs/heads/main', 'refs/heads/codex/public-preview', `refs/tags/${tag}`, 'refs/pull/1/merge', `refs/heads/${branch}-suffix`]) {
    assert.equal(accepts({ ...context(), ref }), false, ref);
  }
});

test('preview CI has one bounded standard runner and only its release job can write contents', () => {
  assert.match(section(workflow, 'permissions'), /^  contents: read\s*$/);
  const jobs = section(workflow, 'jobs');
  assert.deepEqual([...jobs.matchAll(/^  ([\w-]+):/gm)].map(match => match[1]), ['unsigned_preview']);
  assert.match(jobs, /^    permissions:\n      contents: write$/m);
  assert.equal((workflow.match(/contents: write/g) || []).length, 1);
  assert.match(jobs, /^    runs-on: xcode-27$/m);
  assert.equal((jobs.match(/runs-on:/g) || []).length, 1);
  const timeout = Number(/^    timeout-minutes: (\d+)$/m.exec(jobs)?.[1]);
  assert.ok(timeout > 0 && timeout <= 30);
  assert.doesNotMatch(jobs, /self-hosted|macos-\S*-(?:large|xlarge)|matrix:|continue-on-error:\s*true/);
  assert.match(section(compileWorkflow, 'permissions'), /^  contents: read\s*$/);
  assert.doesNotMatch(compileWorkflow, /contents:\s*write|scripts\/publish-preview\.mjs/);
  assert.match(workflow, /^  cancel-in-progress: false$/m, 'Do not cancel a draft publication midway');
});

test('preview actions are exactly pinned official checkout/setup-node without persisted credentials/cache', () => {
  const actions = [...workflow.matchAll(/^\s+uses: (\S+)/gm)].map(match => match[1]);
  assert.deepEqual(actions, [
    'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
    'actions/setup-node@2028fbc5c25fe9cf00d9f06a71cc4710d4507903'
  ]);
  for (const action of actions) assert.match(action, /^actions\/[\w-]+@[a-f0-9]{40}$/);
  const checkout = steps.find(step => step.body.includes('uses: actions/checkout@'));
  const node = steps.find(step => step.body.includes('uses: actions/setup-node@'));
  assert.match(checkout.body, /^          persist-credentials: false$/m);
  assert.match(node.body, /^          package-manager-cache: false$/m);
  assert.doesNotMatch(workflow, /uses:.*(?:upload-artifact|download-artifact|\/cache@|apple-actions|codesign|appstore)/i);
  for (const step of steps) {
    assert.doesNotMatch(shell(step), /security\s+(?:import|create-keychain)|(?:altool|notarytool|fastlane)\b|allowProvisioningUpdates|codesign\s+(?:--sign|-s)\b/);
  }
});

test('preview tag stays in env and Release build/tests/package/publish are ordered with isolated token', () => {
  assert.match(workflow, /^      CABIN_PREVIEW_TAG: \$\{\{ inputs\.tag \}\}$/m);
  assert.match(workflow, /^      CABIN_IOS_CONFIGURATION: Release$/m);
  const build = stepIndex('node scripts/build-ios.mjs');
  const tests = stepIndex('node --test');
  const audit = stepIndex('node scripts/package-preview.mjs');
  const publish = stepIndex('node scripts/publish-preview.mjs');
  assert.ok(build < tests && tests < audit && audit < publish);
  assert.match(shell(steps[tests]), /tee "\$CABIN_PREVIEW_TEST_LOG"/);
  for (const index of [build, tests, audit, publish]) {
    assert.doesNotMatch(steps[index].body, /continue-on-error:|if:.*(?:always|failure)\(/);
  }
  for (const [index, step] of steps.entries()) {
    assert.doesNotMatch(shell(step), /\$\{\{/, `${step.name}: no expression interpolation into shell`);
    if (index !== publish) assert.doesNotMatch(step.body, /GH_TOKEN|GITHUB_TOKEN|github\.token|secrets\./);
  }
  assert.equal((workflow.match(/GH_TOKEN:/g) || []).length, 1);
  assert.match(steps[publish].body, /^          GH_TOKEN: \$\{\{ github\.token \}\}$/m);
  assert.doesNotMatch(workflow.slice(0, workflow.indexOf('    steps:')), /GH_TOKEN|GITHUB_TOKEN|secrets\./);
  assert.match(read('scripts/build-ios.mjs'), /const configuration = process\.env\.CABIN_IOS_CONFIGURATION \|\| 'Debug'/);
  assert.match(read('scripts/build-ios.mjs'), /'-configuration', configuration/);
});

test('package script requires actual Release/privacy evidence and audits only the unsigned app payload', () => {
  assert.match(packager, /assertActualBuild\(report, \{ commit, configuration: 'Release' \}\)/);
  assert.match(packager, /auditBundleTree\(app\)/);
  assert.match(packager, /Release-iphoneos\/CabinDirect\.app/);
  assert.match(packager, /source-test totals|source-test log/);
  assert.match(packager, /makePreviewInfo\(\{ report, tag, version, commit, executableHashes, testSummary/);
  assert.match(packager, /run\('\/usr\/bin\/otool', \['-hv', binary\]\)/);
  assert.match(packager, /'--display', '--verbose=4'/);
  assert.doesNotMatch(packager, /'--sign'|'--force'|'--deep'|allowProvisioning|embedded\.mobileprovision.*write/);
  assert.match(packager, /fs\.cpSync\(app, path\.join\(payload, 'CabinDirect\.app'\)/);
  assert.match(packager, /force: false/);
  assert.match(packager, /'SHA256SUMS\.txt'/);
  assert.match(packager, /'BUILD-INFO\.json'/);
  assert.match(packager, /flag: 'wx'/);
});

function simulatePublisher(options = {}) {
  const out = '/simulated-preview';
  const names = [`CabinDirect-${tag}-unsigned.ipa`, 'BUILD-INFO.json', 'SHA256SUMS.txt'];
  const info = { schema_version: 1, kind: 'unsigned-developer-preview', source_commit: commit, tag, version: '0.4.0',
    configuration: 'Release', full_iOS_build: true, signing_performed: false,
    requires_personal_signing: true, device_test: false, vehicle_acceptance: false, app_store_approved: false,
    run_url: `https://github.com/${repository}/actions/runs/123`,
    executable_sha256: { app: 'a'.repeat(64), extension: 'b'.repeat(64) },
    source_tests: { tests: 1, passed: 1, failed: 0, skipped: 0, cancelled: 0 }, ...options.info };
  const files = new Map([
    [`${root}package.json`, Buffer.from(JSON.stringify({ version: '0.4.0' }))],
    [path.join(out, names[0]), Buffer.from('SIMULATED ZIP FIXTURE — NOT AN IPA')],
    [path.join(out, names[1]), Buffer.from(JSON.stringify(info))]
  ]);
  const hash = name => crypto.createHash('sha256').update(files.get(path.join(out, name))).digest('hex');
  const sums = names.slice(0, 2).map(name => `${hash(name)}  ${name}`).join('\n') + '\n';
  files.set(path.join(out, names[2]), Buffer.from(options.badChecksum ? sums.replace(/^[a-f0-9]/, 'z') : sums));
  const get = file => { assert.ok(files.has(file), `Unexpected simulated file access: ${file}`); return files.get(file); };
  const calls = [], logs = [], summaries = [];
  let state = 'absent', tagCreated = false, repoReads = 0, refReads = 0;
  const draft = () => ({ id: 123, tag_name: tag, target_commitish: commit,
    draft: state === 'draft', prerelease: true,
    html_url: `https://github.com/${repository}/releases/tag/${tag}`,
    assets: names.map((name, index) => ({ id: 100 + index, name, state: 'uploaded', size: get(path.join(out, name)).length,
      digest: options.noDigest ? undefined : `sha256:${options.badRemoteDigest ? '0'.repeat(64) : hash(name)}` })),
    ...(state === 'draft' ? options.draft : options.published) });
  const fakeFS = {
    readFileSync(file, encoding) { const value = get(file); return encoding ? value.toString(encoding) : value; },
    lstatSync(file) { return { size: get(file).length, isFile: () => true, isSymbolicLink: () => !!options.symlink }; },
    statSync(file) { return { size: get(file).length }; },
    appendFileSync(file, value) { assert.equal(file, '/simulated-summary'); summaries.push(value); }
  };
  const fakeSpawn = (command, args, executionOptions) => {
    assert.equal(command, 'gh', 'All CLI operations stay inside this simulation');
    calls.push([...args]);
    const ok = value => ({ status: 0, stdout: Buffer.isBuffer(value) || typeof value === 'string' ? value : JSON.stringify(value), stderr: '' });
    if (args[0] === 'api') {
      const endpoint = args.find(value => value.replace(/^\//, '').startsWith(`repos/${repository}`))?.replace(/^\//, '');
      if (endpoint === `repos/${repository}`) {
        repoReads++;
        return ok({ private: false, default_branch: branch, ...options.repo,
          ...(repoReads > 1 ? options.repoBeforePublish : {}) });
      }
      if (endpoint?.match(new RegExp(`^repos/${repository}/releases(?:\\?|$)`))) {
        const releases = state !== 'absent' ? [draft()]
          : options.existingRelease || options.existingDraft ? [{ ...draft(), draft: !!options.existingDraft }] : [];
        if (options.duplicateDraft && state === 'draft') releases.push({ ...draft(), id: 124 });
        if (options.unrelatedRelease) releases.unshift({ ...draft(), id: 999, tag_name: 'v0.4.0-preview.999' });
        if (options.multiplePages) return ok([[], releases]);
        return ok(args.includes('--slurp') ? [releases] : releases);
      }
      if (endpoint === `repos/${repository}/releases/123`) return ok(draft());
      if (endpoint?.startsWith(`repos/${repository}/releases/assets/`)) {
        assert.equal(executionOptions.encoding, null, 'Asset fallback must preserve raw bytes');
        assert.ok(args.includes('Accept: application/octet-stream'));
        const index = Number(endpoint.split('/').at(-1)) - 100;
        assert.ok(index >= 0 && index < names.length);
        const bytes = Buffer.from(get(path.join(out, names[index])));
        if (options.badDownload) bytes[0] ^= 0xff;
        return ok(bytes);
      }
      if (endpoint === `repos/${repository}/git/refs`) {
        assert.ok(args.includes('POST'), 'Tag refs are create-only, never patched');
        assert.ok(args.includes(`ref=refs/tags/${tag}`));
        assert.ok(args.includes(`sha=${commit}`));
        assert.equal(tagCreated, false, 'Never overwrite a created tag');
        if (options.concurrentTag) return { status: 1, stdout: '', stderr: 'HTTP 422 Reference already exists' };
        tagCreated = true;
        return ok({ ref: `refs/tags/${tag}`, object: { type: 'commit', sha: commit } });
      }
      if (endpoint === `repos/${repository}/git/ref/tags/${tag}`) {
        refReads++;
        return options.existingTag || tagCreated
          ? ok({ ref: `refs/tags/${tag}`, object: { type: options.annotatedTag ? 'tag' : 'commit',
            sha: options.wrongTagCommit || (options.tagRace && refReads >= 3) ? 'b'.repeat(40) : commit } })
          : { status: 1, stdout: '', stderr: 'HTTP 404' };
      }
    }
    if (args[0] === 'release' && args[1] === 'create') { state = 'draft'; return ok(''); }
    if (args[0] === 'release' && args[1] === 'edit') { state = 'published'; return ok(''); }
    assert.fail(`Unexpected simulated command: ${JSON.stringify(args)}`);
  };
  const env = { GITHUB_REPOSITORY: repository, GITHUB_REF: `refs/heads/${branch}`,
    GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_SHA: commit, CABIN_PREVIEW_TAG: tag,
    CABIN_PREVIEW_OUT_DIR: out, GITHUB_STEP_SUMMARY: '/simulated-summary', GH_TOKEN: 'SIMULATED_NOT_A_REAL_TOKEN', ...options.env };
  const script = publisher.replace(/^import .*;\n/gm, '').replaceAll('import.meta.url', 'moduleURL');
  let error;
  try {
    vm.runInNewContext(script, { fs: fakeFS, path, crypto, Buffer, spawnSync: fakeSpawn,
      fileURLToPath, moduleURL: new URL('../scripts/publish-preview.mjs', import.meta.url).href,
      validatePreviewTag, process: { env }, console: { log: value => logs.push(value) } },
    { timeout: 500, contextCodeGeneration: { strings: false, wasm: false } });
  } catch (caught) { error = caught; }
  return { error, calls, logs, summaries, state, names, out, repoReads, refReads };
}

test('[SIMULATED] publisher creates a non-latest prerelease draft, verifies assets, then publishes', () => {
  const result = simulatePublisher({ unrelatedRelease: true, multiplePages: true });
  assert.ifError(result.error);
  assert.equal(result.state, 'published');
  const create = result.calls.findIndex(args => args[0] === 'release' && args[1] === 'create');
  const edit = result.calls.findIndex(args => args[0] === 'release' && args[1] === 'edit');
  assert.ok(create >= 0 && edit > create);
  assert.ok(result.calls.slice(create + 1, edit).some(args => args[0] === 'api'), 'Verify draft before edit');
  for (const index of [create, edit]) {
    assert.ok(result.calls[index].includes('--prerelease'));
    assert.ok(result.calls[index].includes('--latest=false'));
    assert.ok(!result.calls[index].some(value => /--clobber|--force|--delete/.test(value)));
  }
  assert.ok(result.calls[create].includes('--draft'));
  assert.ok(result.calls[create].includes('--verify-tag'));
  assert.ok(result.calls[edit].includes('--draft=false'));
  assert.deepEqual(result.calls[create].filter(value => value.startsWith(result.out + '/')),
    result.names.map(name => path.join(result.out, name)));
  assert.ok(result.calls[create].includes(commit), 'Release targets exact source SHA');
  const createRef = result.calls.findIndex(args => args.includes(`repos/${repository}/git/refs`));
  assert.ok(createRef >= 0 && createRef < create, 'Create tag pinned to source before draft creation');
  assert.ok(result.refReads >= 4, 'Read tag before creation and verify it before/after publication');
  assert.equal(result.repoReads, 2, 'Recheck public/default branch immediately before publication');
  assert.equal(result.calls.at(-1)[0], 'api', 'Read back final public state');
  assert.match(result.summaries.join(''), /Requires personal signing/);
  assert.doesNotMatch(publisher, /--clobber|--force|release',\s*'delete|git',\s*'push/);
  assert.doesNotMatch(publisher, /\/releases\/tags\//, 'Draft lookup must use authenticated list and stable ID, not public tag endpoint');
});

test('[SIMULATED] publisher rejects wrong repository/default branch/private/trigger without release writes', () => {
  for (const options of [
    { env: { CABIN_PREVIEW_TAG: 'v0.4.0-preview.1;echo SIMULATED_INJECTION' } },
    { env: { GITHUB_REPOSITORY: 'another-owner/cabin-direct-ios' } },
    { env: { GITHUB_REF: 'refs/heads/main' } },
    { env: { GITHUB_REF: `refs/tags/${tag}` } },
    { env: { GITHUB_EVENT_NAME: 'push' } },
    { repo: { private: true } },
    { repo: { default_branch: 'main' } }
  ]) {
    const result = simulatePublisher(options);
    assert.ok(result.error, JSON.stringify(options));
    assert.ok(!result.calls.some(args => args[0] === 'release'), 'No mutations in unauthorized context');
    assert.ok(!result.calls.some(args => args.some(value => ['POST', 'PATCH', 'PUT', 'DELETE'].includes(value))),
      'Unauthorized context cannot even create a tag reference');
  }
});

test('[SIMULATED] existing tags/releases, invalid metadata and checksums never get overwritten', () => {
  for (const options of [
    { existingRelease: true }, { existingDraft: true }, { existingTag: true },
    { badChecksum: true }, { symlink: true }, { concurrentTag: true },
    { info: { source_commit: 'b'.repeat(40) } }, { info: { tag: 'v0.4.0-preview.2' } },
    { info: { requires_personal_signing: false } }, { info: { device_test: true } },
    { info: { app_store_approved: true } }, { info: { vehicle_acceptance: true } },
    { info: { configuration: 'Debug' } }, { info: { signing_performed: true } },
    { info: { full_iOS_build: false } }
  ]) {
    const result = simulatePublisher(options);
    assert.ok(result.error, JSON.stringify(options));
    assert.ok(!result.calls.some(args => args[0] === 'release'), 'Reject before draft creation');
  }
});

test('[SIMULATED] incomplete drafts remain drafts and unconfirmed publication never reports success', () => {
  for (const draft of [{ draft: false }, { prerelease: false }, { tag_name: 'v0.4.0-preview.2' },
    { target_commitish: 'b'.repeat(40) }, { assets: [] },
    { assets: [{ name: `CabinDirect-${tag}-unsigned.ipa`, state: 'uploaded', size: 0 },
      { name: 'BUILD-INFO.json', state: 'uploaded', size: 0 }, { name: 'SHA256SUMS.txt', state: 'uploaded', size: 0 }] }]) {
    const result = simulatePublisher({ draft });
    assert.ok(result.error);
    assert.equal(result.state, 'draft');
    assert.ok(!result.calls.some(args => args[0] === 'release' && args[1] === 'edit'));
    assert.equal(result.logs.length, 0);
  }
  const result = simulatePublisher({ published: { prerelease: false } });
  assert.ok(result.error);
  assert.equal(result.logs.length, 0);
  assert.equal(result.summaries.length, 0);
  for (const options of [{ badRemoteDigest: true }, { wrongTagCommit: true }, { annotatedTag: true },
    { duplicateDraft: true }, { tagRace: true }, { repoBeforePublish: { private: true } },
    { repoBeforePublish: { default_branch: 'main' } }]) {
    const failed = simulatePublisher(options);
    assert.ok(failed.error, JSON.stringify(options));
    assert.ok(!failed.calls.some(args => args[0] === 'release' && args[1] === 'edit'),
      'Do not publish before remote assets and exact tag commit are verified');
  }
});

test('[SIMULATED] absent remote digests require byte-preserving authenticated download/hash verification', () => {
  const good = simulatePublisher({ noDigest: true });
  assert.ifError(good.error);
  assert.equal(good.state, 'published');
  const edit = good.calls.findIndex(args => args[0] === 'release' && args[1] === 'edit');
  const downloads = good.calls.map((args, index) => ({ args, index }))
    .filter(({ args }) => args.some(value => value.includes('/releases/assets/')));
  assert.equal(downloads.length, 6, 'Each of the three files is verified before and after publication');
  assert.equal(downloads.filter(item => item.index < edit).length, 3);
  assert.equal(downloads.filter(item => item.index > edit).length, 3);
  const bad = simulatePublisher({ noDigest: true, badDownload: true });
  assert.ok(bad.error);
  assert.equal(bad.state, 'draft');
  assert.ok(!bad.calls.some(args => args[0] === 'release' && args[1] === 'edit'));
  assert.equal(bad.summaries.length, 0);
});

test('[SIMULATED] failure diagnostics are failure-only, bounded and redact sensitive compiler text', () => {
  const step = steps.find(item => item.name === 'Bounded compiler failure diagnostics');
  assert.ok(step);
  assert.match(step.body, /^        if: \$\{\{ failure\(\) \}\}$/m);
  const body = shell(step);
  const diagnostic = /<<'DIAGNOSTICS'\n([\s\S]*?)\nDIAGNOSTICS\s*$/.exec(body)?.[1];
  assert.ok(diagnostic);
  const secret = 'SIMULATED_SENSITIVE_VALUE_123456789';
  const fakeLog = [
    'note: non-error output must not be emitted',
    `error: Authorization: Bearer ${secret}`,
    `error: cookie=cabin_viewer=${secret}`,
    `error: pairing code: ${secret}`,
    `error: token=${secret}`,
    `error: ghp_${secret}`,
    `error: github_pat_${secret}`,
    `error: https://synthetic:${secret}@example.invalid/source`,
    'error: /Users/SIMULATED_PRIVATE_USER/private/source.swift:1:1 failed',
    'error: /home/SIMULATED_PRIVATE_USER/private/source.swift:1:1 failed',
    'error: -----BEGIN PRIVATE KEY-----',
    `error: ${secret}`,
    'error: -----END PRIVATE KEY-----',
    ...Array.from({ length: 80 }, (_, index) => `error: harmless compiler failure ${index} ${'x'.repeat(1200)}`)
  ].join('\n');
  const output = [];
  const script = diagnostic.replace(/^import .*;\n/gm, '');
  vm.runInNewContext(script, {
    fs: { existsSync: () => true, readFileSync: () => fakeLog },
    process: { env: { CABIN_IOS_WORK_DIR: '/simulated-build' } },
    console: { log: value => output.push(String(value)) }
  }, { timeout: 100, contextCodeGeneration: { strings: false, wasm: false } });
  const text = output.join('\n');
  assert.equal(text.includes(secret), false, 'Never print tokens/cookies/pairing material or key bodies');
  assert.equal(/BEGIN PRIVATE KEY|END PRIVATE KEY|non-error output/.test(text), false,
    'Never print key delimiters or unrelated output');
  assert.equal(/SIMULATED_PRIVATE_USER/.test(text), false, 'Redact personal home-directory paths');
  assert.ok(text.length <= 41_000, 'Bound output bytes/chars, not just error count');
  assert.ok(text.split('\n').length <= 40, 'Bound number of diagnostic lines');
  assert.match(text, /harmless compiler failure/);
});
