import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const workflow = readFileSync(new URL('../.github/workflows/cabin-public-build.yml', import.meta.url), 'utf8');
const active = workflow.split('\n').filter(line => !line.trimStart().startsWith('#')).join('\n');

test('[STRUCTURAL] public CI has manual trigger only and one guarded job', () => {
  assert.match(active, /^on:\n  workflow_dispatch: \{\}\n/m);
  assert.doesNotMatch(active, /^\s+(?:push|pull_request|pull_request_target|schedule|workflow_run|workflow_call):/m);
  const jobs = active.split('\njobs:\n')[1];
  assert.ok(jobs);
  assert.deepEqual([...jobs.matchAll(/^  ([A-Za-z_]+):$/gm)].map(match => match[1]), ['public_unsigned_ios']);
  assert.match(jobs, /^    if: \$\{\{ github.event_name == 'workflow_dispatch' && github.event.repository.private == false && github.repository_owner == 'citrus-13' \}\}$/m);
  assert.ok(jobs.indexOf('    if:') < jobs.indexOf('    runs-on:'), 'Guard belongs to the job before runner selection');
});

test('[SIMULATED] job expression blocks private and wrong-owner events before allocation', () => {
  const expression = active.match(/^    if: \$\{\{ (.+) \}\}$/m)?.[1];
  assert.ok(expression);
  for (const [eventName, privacy, owner, expected] of [
    ['workflow_dispatch', true, 'citrus-13', false],
    ['workflow_dispatch', false, 'someone-else', false],
    ['push', false, 'citrus-13', false],
    ['pull_request', false, 'citrus-13', false],
    ['workflow_dispatch', false, 'citrus-13', true]
  ]) {
    const github = { event_name: eventName, event: { repository: { private: privacy } }, repository_owner: owner };
    assert.equal(vm.runInNewContext(expression, { github }, { timeout: 100 }), expected);
  }
});

test('[STRUCTURAL] only standard xcode-27, bounded time, read-only permissions and cancellation', () => {
  assert.deepEqual([...active.matchAll(/runs-on:\s*(\S+)/g)].map(match => match[1]), ['xcode-27']);
  assert.doesNotMatch(active, /xlarge|self-hosted|larger-runner/);
  const timeout = Number(active.match(/timeout-minutes:\s*(\d+)/)?.[1]);
  assert.ok(timeout > 0 && timeout <= 30);
  assert.match(active, /^permissions:\n  contents: read\n/m);
  assert.doesNotMatch(active, /^\s+(?:contents|packages|actions|id-token): write$/m);
  assert.match(active, /group: cabin-public-build-\$\{\{ github.ref \}\}/);
  assert.match(active, /cancel-in-progress: true/);
});

test('[STRUCTURAL] official actions are full-SHA pinned and persistent caches/auth are disabled', () => {
  const actions = [...active.matchAll(/uses:\s*([^\s#]+)/g)].map(match => match[1]);
  assert.deepEqual(actions, [
    'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
    'actions/setup-node@2028fbc5c25fe9cf00d9f06a71cc4710d4507903'
  ]);
  for (const action of actions) assert.match(action, /^actions\/[a-z-]+@[a-f0-9]{40}$/);
  assert.match(active, /persist-credentials: false/);
  assert.match(active, /package-manager-cache: false/);
  assert.match(active, /node-version: '22'/);
  assert.doesNotMatch(active, /uses:\s*(?:actions\/(?:upload-artifact|cache)|[^\s]+\/[^\s]*release)/);
  assert.doesNotMatch(active, /\$\{\{\s*secrets\.|gh release|git push|npm publish|allowProvisioning|security import|APPLE_ID/);
});

test('[STRUCTURAL] locked source checks and actual unsigned build run without preflight substitute', () => {
  assert.match(active, /HOMEBREW_NO_AUTO_UPDATE: '1'/);
  assert.match(active, /HOMEBREW_NO_INSTALL_UPGRADE: '1'/);
  assert.match(active, /brew install xcodegen/);
  assert.doesNotMatch(active, /brew (?:upgrade|update)/);
  assert.match(active, /npm ci --ignore-scripts --no-audit --no-fund/);
  assert.match(active, /npm run check/); assert.match(active, /run: npm test/);
  const jobEnvironment = active.match(/^    env:\n([\s\S]+?)^    steps:/m)?.[1];
  assert.ok(jobEnvironment);
  assert.doesNotMatch(jobEnvironment, /\$\{\{\s*runner\./, 'Runner context is unavailable in job-level env');
  assert.match(active, /"CABIN_IOS_WORK_DIR=\$RUNNER_TEMP\/cabin-ios-build"/);
  assert.match(active, /export TMPDIR="\$RUNNER_TEMP\/cabin-ci-tmp"/);
  assert.match(active, />> "\$GITHUB_ENV"/);
  assert.match(active, /run: node scripts\/build-ios\.mjs 2>&1/);
  assert.ok(active.indexOf('run: node scripts/build-ios.mjs') < active.indexOf('run: npm test'), 'Compiler diagnostics precede runtime/regression tests');
  assert.doesNotMatch(active, /--preflight-only|continue-on-error/);
  assert.match(active, /if: \$\{\{ always\(\) \}\}/);
  assert.match(active, /GITHUB_STEP_SUMMARY/);
});

test('[SIMULATED] initial shell step exports only task paths and rejects newline env injection', () => {
  const code = workflow.match(/- name: Prepare ephemeral runner directories\n        run: \|\n([\s\S]+?)\n\n/)?.[1]
    .split('\n').map(line => line.replace(/^          /, '')).join('\n');
  assert.ok(code);
  const base = process.env.CABIN_IOS_TEST_WORK_DIR || os.tmpdir();
  mkdirSync(base, { recursive: true });
  for (const unsafe of [false, true]) {
    const root = mkdtempSync(path.join(base, 'cabin-ci-init-simulated-'));
    const runnerTemp = path.join(root, unsafe ? 'runner\nUNRELATED=value' : 'runner temp');
    const envFile = path.join(root, 'github-env');
    const result = spawnSync('/bin/bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', code], {
      cwd: root, env: { PATH: '/usr/bin:/bin', RUNNER_TEMP: runnerTemp, GITHUB_ENV: envFile }, encoding: 'utf8', timeout: 5_000
    });
    if (unsafe) {
      assert.notEqual(result.status, 0); assert.equal(existsSync(envFile), false);
    } else {
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(readFileSync(envFile, 'utf8').trim().split('\n'), [
        `CABIN_IOS_WORK_DIR=${runnerTemp}/cabin-ios-build`,
        `CABIN_IOS_TEST_WORK_DIR=${runnerTemp}/cabin-ios-simulated-tests`,
        `TMPDIR=${runnerTemp}/cabin-ci-tmp`,
        `npm_config_cache=${runnerTemp}/cabin-npm-cache`
      ]);
      assert.equal(existsSync(path.join(runnerTemp, 'cabin-ci-tmp')), true);
    }
  }
});

const summaryCode = workflow.match(/node --input-type=module <<'SUMMARY_JS'\n([\s\S]+?)\n          SUMMARY_JS/)?.[1]
  .split('\n').map(line => line.replace(/^          /, '')).join('\n');
function simulateSummary(report, outcome = 'success') {
  assert.ok(summaryCode, 'Inline summary program extracted for local simulation');
  const base = process.env.CABIN_IOS_TEST_WORK_DIR || os.tmpdir();
  mkdirSync(base, { recursive: true });
  const root = mkdtempSync(path.join(base, 'cabin-ci-summary-simulated-'));
  const work = path.join(root, 'cabin-ios-build'), repository = path.join(root, 'repo');
  mkdirSync(work); mkdirSync(path.join(repository, '.github/workflows'), { recursive: true });
  writeFileSync(path.join(repository, '.github/workflows/cabin-public-build.yml'), workflow);
  if (report) writeFileSync(path.join(work, 'ios-build-report.json'), JSON.stringify(report));
  const logs = path.join(root, 'cabin-ci-logs'); mkdirSync(logs);
  writeFileSync(path.join(logs, 'ios-build.log'), [
    'SIMULATED compiler tail', 'token=synthetic-sensitive-value', 'Authorization: Bearer synthetic-auth',
    'ghp_syntheticcredential123456', 'github_pat_syntheticcredential123456',
    'https://fakeuser:fakepassword@example.invalid/repository',
    '-----BEGIN PRIVATE KEY-----\nSYNTHETIC-KEY-BODY\n-----END PRIVATE KEY-----',
    '<script>synthetic</script>', '```', 'SIMULATED END'
  ].join('\n'));
  mkdirSync(path.join(work, 'logs'));
  writeFileSync(path.join(work, 'logs/unsigned-generic-ios-build.log'), [
    'SIMULATED original compiler context',
    'Sample.swift:4:2: error: SYNTHETIC_EARLY_SWIFT_DIAGNOSTIC',
    'token=synthetic-compiler-sensitive-value',
    'SIMULATED next compiler context',
    ...Array.from({ length: 150 }, (_, index) => `SIMULATED filler ${index}`),
    '** BUILD FAILED **'
  ].join('\n'));
  const summary = path.join(root, 'summary.md');
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', summaryCode], {
    env: { CABIN_IOS_WORK_DIR: work, RUNNER_TEMP: root, GITHUB_WORKSPACE: repository,
      GITHUB_STEP_SUMMARY: summary, GITHUB_SHA: 'a'.repeat(40), BUILD_OUTCOME: outcome },
    encoding: 'utf8', timeout: 10_000
  });
  assert.equal(result.status, 0, result.stderr);
  return { text: readFileSync(summary, 'utf8'), stdout: result.stdout, reportHash: report ? crypto.createHash('sha256').update(JSON.stringify(report)).digest('hex') : null };
}

test('[SIMULATED] summary strips synthetic secret patterns and preserves bounded hash evidence', () => {
  const { text, reportHash } = simulateSummary({ state: 'simulated_build_complete', evidence_kind: 'simulated', full_iOS_build: false });
  assert.match(text, /Actual unsigned iOS compilation: NOT established/);
  assert.ok(text.includes(reportHash));
  assert.match(text, /Source commit: a{40}/);
  assert.match(text, /No signing, provisioning, installable IPA, device acceptance or artifact upload/);
  for (const value of ['synthetic-sensitive-value', 'synthetic-auth', 'ghp_syntheticcredential', 'github_pat_syntheticcredential', 'fakeuser:fakepassword', 'SYNTHETIC-KEY-BODY', '<script>']) assert.ok(!text.includes(value), value);
  assert.match(text, /SIMULATED END/);
  assert.ok(text.length < 20_000);
});

test('[SIMULATED] missing report or failed build never becomes successful compilation evidence', () => {
  assert.match(simulateSummary(null).text, /NOT established/);
  assert.match(simulateSummary({ state: 'unsigned_ios_build_complete', evidence_kind: 'actual', full_iOS_build: true }, 'failure').text, /NOT established/);
  assert.match(simulateSummary({ state: 'simulated_build_complete', evidence_kind: 'simulated', full_iOS_build: true }).text, /NOT established/);
});

test('[SIMULATED] early compiler errors survive long trailing noise in scrubbed bounded summary and console', () => {
  const { text, stdout } = simulateSummary({ state: 'ios_compilation_failed', evidence_kind: 'actual', full_iOS_build: false }, 'failure');
  assert.match(text, /Compiler diagnostics \(first 40 matches, 2 context lines, max 16 KB\)/);
  for (const output of [text, stdout]) {
    assert.match(output, /SYNTHETIC_EARLY_SWIFT_DIAGNOSTIC/);
    assert.match(output, /SIMULATED original compiler context/);
    assert.match(output, /SIMULATED next compiler context/);
    assert.ok(!output.includes('synthetic-compiler-sensitive-value'));
  }
  assert.ok(stdout.length <= 16_100);
});
