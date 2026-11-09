import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

test('production model refresh emits only necessary idle changes while preserving live and expiry redraws (native macOS Combine)', t => {
  if (process.platform !== 'darwin') return t.skip('macOS Combine unavailable; no native model or iOS proof inferred');
  assert.ok(process.env.TMPDIR && path.isAbsolute(process.env.TMPDIR), 'Explicit session TMPDIR required');
  const source = readFileSync(path.join(root, 'ios/StandaloneApp/CabinDirectApp.swift'), 'utf8');
  const begin = '@MainActor\nfinal class DirectSetupModel: ObservableObject {', end = '\nstruct DirectSetupView: View {';
  assert.equal(source.split(begin).length, 2, 'Require one exact production-model extraction boundary');
  assert.equal(source.split(end).length, 2, 'Require one exact production-view extraction boundary');
  const start = source.indexOf(begin), finish = source.indexOf(end);
  assert.ok(finish > start);
  const extracted = source.slice(start, finish);
  assert.match(extracted, /func refresh\(\)/);
  assert.doesNotMatch(extracted, /\bimport\b|struct DirectSetupView|UIKit|SwiftUI/);
  // This is the production class verbatim; only its platform-neutral imports
  // are supplied. No replacement implementation, mocked Combine or fake clock.
  const work = mkdtempSync(path.join(process.env.TMPDIR, 'cabin-model-refresh-'));
  mkdirSync(path.join(work, 'tmp'));
  mkdirSync(path.join(work, 'container'));
  const modelFile = path.join(work, 'ProductionDirectSetupModel.swift');
  writeFileSync(modelFile, 'import Foundation\nimport Combine\n\n' + extracted, { flag: 'wx' });
  assert.equal(readFileSync(modelFile, 'utf8').slice('import Foundation\nimport Combine\n\n'.length), extracted);
  const executable = path.join(work, 'model-checks'), env = { ...process.env, TMPDIR: path.join(work, 'tmp') };
  const build = spawnSync('swiftc', ['-swift-version', '5', '-parse-as-library', '-D', 'DIRECT_SESSION_STORE_TEST',
    '-module-cache-path', path.join(work, 'module-cache'), 'ios/Shared/SessionConfiguration.swift',
    'ios/Shared/DirectConfiguration.swift', modelFile, 'ios/DirectModelChecks/main.swift', '-o', executable],
  { cwd: root, env, encoding: 'utf8', timeout: 90_000, maxBuffer: 2 * 1024 * 1024 });
  assert.equal(build.status, 0, build.stderr || build.error?.message || 'Native Combine compilation failed');
  const result = spawnSync(executable, [path.join(work, 'container')], { env, encoding: 'utf8', timeout: 15_000, maxBuffer: 16_384 });
  assert.equal(result.status, 0, result.stdout || result.stderr || result.error?.message || 'Native Combine checks failed');
  assert.equal(result.stderr, '');
  const counts = JSON.parse(result.stdout.trim());
  assert.ok(Object.values(counts).every(value => Number.isInteger(value) && value >= 0), 'Native output contains counts only');
  assert.equal(counts.failures, 0); assert.equal(counts.runtime_errors, 0); assert.ok(counts.checks >= 20);
  assert.equal(counts.idle_events, 0); assert.equal(counts.cleared_idle_events, 0);
  assert.equal(counts.repeated_status_events, 10); assert.equal(counts.repeated_session_events, 10);
  assert.equal(counts.heartbeat_fps_events, 1); assert.ok(counts.expiry_events > 0); assert.ok(counts.cleared_events >= 2);
  t.diagnostic(JSON.stringify(counts));
  // Fixtures remain in the explicit session tmp directory for inspection;
  // this test never deletes directories or real/shared application data.
});
