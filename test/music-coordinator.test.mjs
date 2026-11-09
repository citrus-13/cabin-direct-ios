import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));

test('actual Swift music coordinator handles fake callbacks, version cache, consent and stop (not device recognition)', { timeout: 180_000 }, t => {
  if (process.platform !== 'darwin') return t.skip('Apple CoreMedia SDK unavailable; no device acceptance inferred');
  const version = spawnSync('xcrun', ['swiftc', '--version'], { encoding: 'utf8' });
  assert.equal(version.status, 0, version.stderr);
  // Honor per-command TMPDIR: all generated modules/binaries remain in session tmp.
  const work = mkdtempSync(join(tmpdir(), 'music-coordinator-'));
  const coreSource = readFileSync(join(root, 'ios/DirectCore/LocalHTTPServer.swift'), 'utf8');
  const state = coreSource.match(/public struct LocalMusicState: Codable \{[\s\S]*?\n\}\n/);
  assert.ok(state, 'Actual LocalMusicState declaration must be available for the no-server stub module');
  const stub = join(work, 'DirectCore.swift');
  writeFileSync(stub, 'import Foundation\n' + state[0]);
  const flags = ['-swift-version', '5', '-application-extension', '-module-cache-path', join(work, 'module-cache')];
  const compileCore = spawnSync('xcrun', ['swiftc', ...flags, '-emit-library', '-emit-module', '-module-name', 'DirectCore',
    stub, '-emit-module-path', join(work, 'DirectCore.swiftmodule'), '-o', join(work, 'libDirectCore.dylib')],
  { cwd: root, encoding: 'utf8', timeout: 120_000 });
  assert.equal(compileCore.status, 0, compileCore.stderr);
  const binary = join(work, 'music-coordinator-checks');
  const compiled = spawnSync('xcrun', ['swiftc', ...flags, '-I', work, '-L', work, '-lDirectCore',
    '-Xlinker', '-rpath', '-Xlinker', work,
    'ios/Shared/SessionConfiguration.swift', 'ios/Shared/DirectConfiguration.swift', 'ios/Shared/DirectMusicClock.swift',
    'ios/StandaloneBroadcast/DirectMusicRuntime.swift', 'ios/DirectMusicRuntimeChecks/Fakes.swift',
    'ios/DirectMusicRuntimeChecks/main.swift', '-o', binary],
  { cwd: root, encoding: 'utf8', timeout: 120_000 });
  assert.equal(compiled.status, 0, compiled.stderr);
  const run = spawnSync(binary, [], { cwd: root, encoding: 'utf8', timeout: 20_000 });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.equal((run.stdout.match(/^PASS /gm) || []).length, 15, run.stdout);
  assert.match(run.stdout, /no real audio, network or signed-device acceptance/);
  t.diagnostic(run.stdout.trim());
});
