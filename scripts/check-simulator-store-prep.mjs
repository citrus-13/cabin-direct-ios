import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireValue, validateDirectories, chooseSimulator, validateTestResults,
  selectAttachments, normalizeScreenshotPNG } from '../lib/simulator-store-prep.mjs';

const repo = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
requireValue(process.platform === 'darwin' && process.argv.length === 2, 'Use this runner on macOS without command-line overrides');
requireValue(!process.env.CABIN_SIM_EVIDENCE_KIND || process.env.CABIN_SIM_EVIDENCE_KIND === 'actual', 'Simulation cannot produce a simulator report');
const { work, out } = validateDirectories(process.env.CABIN_SIM_WORK_DIR, process.env.CABIN_SIM_OUT_DIR, repo);
requireValue(process.env.GITHUB_REPOSITORY === 'citrus-13/cabin-direct-ios' &&
  /^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA || '') && /^[0-9]+$/.test(process.env.GITHUB_RUN_ID || ''), 'Official workflow/source context required');
for (const directory of [work, out, ...['tmp', 'logs', 'module-cache', 'results'].map(name => path.join(work, name))]) {
  fs.mkdirSync(directory, { recursive: true });
}
const env = { ...process.env, TMPDIR: path.join(work, 'tmp'), LC_ALL: 'C',
  CLANG_MODULE_CACHE_PATH: path.join(work, 'module-cache'), SWIFT_MODULE_CACHE_PATH: path.join(work, 'module-cache'),
  SWIFTPM_MODULECACHE_OVERRIDE: path.join(work, 'module-cache') };
// Build/test commands have no need for publication credentials. Never print env.
for (const name of Object.keys(env)) if (/TOKEN|PASSWORD|SECRET|PRIVATE_KEY|CREDENTIAL/i.test(name)) delete env[name];
const report = {
  schema_version: 1, evidence_kind: 'actual', kind: 'simulator-store-preparation', state: 'starting', passed: false,
  source_commit: process.env.GITHUB_SHA,
  workflow_url: 'https://github.com/citrus-13/cabin-direct-ios/actions/runs/' + process.env.GITHUB_RUN_ID,
  configuration: 'Release', simulator_only: true, physical_iphone_test: false, vehicle_test: false, capture_test: false,
  personal_signing: false, distribution_signing: false, simulator_adhoc_signing: true,
  app_store_approved: false, simulator: null, tests: null, screenshots: [], owned_simulator_deleted: false, phases: []
};
let active, interrupted = false, ownedUDID = null, ownedName = null, ownedRuntime = null, phase = 'preflight';
const priorDeviceIDs = new Set();
function stopActive() {
  if (active?.pid) { try { process.kill(-active.pid, 'SIGKILL'); } catch { /* Already exited. */ } }
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { interrupted = true; stopActive(); });
const redact = text => text.replace(/(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|Bearer\s+\S+)/gi, '[REDACTED]');
async function run(name, command, args, timeout = 60_000, cleanup = false) {
  phase = name;
  requireValue(cleanup || !interrupted, 'Interrupted');
  console.log('[simulator phase] ' + name + ' started');
  const result = await new Promise(resolve => {
    const child = spawn(command, args, { cwd: repo, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    active = child;
    const output = [], errors = [];
    let bytes = 0, timedOut = false, overflow = false, spawnError = false;
    const collect = list => chunk => {
      bytes += chunk.length;
      if (bytes > 32 * 1024 * 1024) { overflow = true; stopActive(); }
      else list.push(chunk);
    };
    child.stdout.on('data', collect(output)); child.stderr.on('data', collect(errors));
    child.on('error', () => { spawnError = true; });
    const timer = setTimeout(() => { timedOut = true; stopActive(); }, timeout);
    child.on('close', (status, signal) => {
      clearTimeout(timer); active = null;
      resolve({ status, signal, timedOut, overflow, spawnError,
        stdout: Buffer.concat(output).toString('utf8'), stderr: Buffer.concat(errors).toString('utf8') });
    });
  });
  fs.writeFileSync(path.join(work, 'logs', name + '.log'), redact(result.stdout + result.stderr), { flag: 'wx' });
  const ok = result.status === 0 && !result.timedOut && !result.overflow && !result.spawnError && (cleanup || !interrupted);
  report.phases.push({ name, passed: ok, exit_code: result.status, timed_out: result.timedOut });
  console.log('[simulator phase] ' + name + (ok ? ' passed' : ' failed'));
  requireValue(ok, 'Command phase failed: ' + name);
  return result.stdout;
}
const jsonRun = async (...args) => JSON.parse(await run(...args));
function readJSON(file, max = 2 * 1024 * 1024) {
  const stat = fs.lstatSync(file);
  requireValue(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= max, 'Invalid bounded JSON result');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
try {
  const commit = (await run('source-commit', 'git', ['rev-parse', 'HEAD'])).trim();
  requireValue(commit === report.source_commit && !(await run('source-clean', 'git', ['status', '--porcelain'])).trim(), 'Source must be clean and match workflow commit');
  const version = await run('xcode-version', 'xcodebuild', ['-version']);
  requireValue(/^Xcode 27(?:\.[0-9]+)*\s*$/m.test(version), 'Expected installed Xcode 27');
  const help = await run('xcresult-attachment-help', 'xcrun', ['xcresulttool', 'export', 'attachments', '--help']);
  requireValue(help.includes('--path') && help.includes('--output-path'), 'Unsupported xcresult attachment export interface');
  for (const command of ['summary', 'tests']) {
    const schema = await jsonRun('xcresult-' + command + '-schema', 'xcrun', ['xcresulttool', 'get', 'test-results', command, '--schema']);
    requireValue(schema && typeof schema === 'object', 'Missing structured xcresult schema');
  }
  const inventory = await jsonRun('simulator-inventory', 'xcrun', ['simctl', 'list', '--json']);
  const selected = chooseSimulator(inventory);
  report.simulator = { model: selected.model, runtime: selected.runtime, os_version: selected.os_version };
  const name = 'CabinDirect-StorePrep-' + crypto.randomUUID();
  const existingDevices = Object.values(inventory.devices || {}).flat();
  requireValue(!existingDevices.some(item => item.name === name), 'Owned simulator name collision');
  for (const item of existingDevices) priorDeviceIDs.add(item.udid);
  ownedName = name; ownedRuntime = selected.runtime;
  const created = (await run('create-owned-simulator', 'xcrun', ['simctl', 'create', name, selected.device_type, selected.runtime])).trim();
  requireValue(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(created), 'Invalid created simulator identity');
  ownedUDID = created;
  const afterCreate = await jsonRun('verify-owned-simulator', 'xcrun', ['simctl', 'list', 'devices', '--json']);
  const owned = afterCreate.devices?.[selected.runtime]?.filter(item => item.udid === ownedUDID && item.name === name);
  requireValue(owned?.length === 1 && owned[0].isAvailable === true, 'Created simulator identity is not available');
  if (owned[0].state !== 'Booted') await run('boot-owned-simulator', 'xcrun', ['simctl', 'boot', ownedUDID]);
  await run('wait-owned-simulator', 'xcrun', ['simctl', 'bootstatus', ownedUDID, '-b'], 240_000);
  await run('generate-project', 'xcodegen', ['--spec', 'ios/project.yml', '--project', 'ios']);
  const result = path.join(work, 'results', 'CabinDirectStorePrep.xcresult');
  await run('simulator-ui-tests', 'xcodebuild', [
    'test', '-project', path.join(repo, 'ios/TeslaCompanion.xcodeproj'), '-scheme', 'CabinDirectStorePrep',
    '-configuration', 'Release', '-sdk', 'iphonesimulator', '-destination', 'platform=iOS Simulator,id=' + ownedUDID,
    '-destination-timeout', '120', '-parallel-testing-enabled', 'NO', '-maximum-concurrent-test-simulator-destinations', '1',
    '-test-timeouts-enabled', 'YES', '-default-test-execution-time-allowance', '120',
    '-maximum-test-execution-time-allowance', '180', '-derivedDataPath', path.join(work, 'DerivedData'),
    '-clonedSourcePackagesDirPath', path.join(work, 'SourcePackages'), '-resultBundlePath', result, '-skipPackageUpdates',
    'CODE_SIGNING_ALLOWED=YES', 'CODE_SIGNING_REQUIRED=NO', 'CODE_SIGN_IDENTITY=-', 'DEVELOPMENT_TEAM=', 'CODE_SIGN_STYLE=Manual',
    'COMPILER_INDEX_STORE_ENABLE=NO', 'CLANG_MODULE_CACHE_PATH=' + path.join(work, 'module-cache'),
    'SWIFT_MODULE_CACHE_PATH=' + path.join(work, 'module-cache')
  ], 900_000);
  const summary = await jsonRun('test-summary', 'xcrun', ['xcresulttool', 'get', 'test-results', 'summary', '--path', result, '--compact']);
  const tree = await jsonRun('test-identities', 'xcrun', ['xcresulttool', 'get', 'test-results', 'tests', '--path', result, '--compact']);
  report.tests = validateTestResults(summary, tree);
  const exported = path.join(work, 'attachments');
  await run('export-test-attachments', 'xcrun', ['xcresulttool', 'export', 'attachments', '--path', result, '--output-path', exported], 120_000);
  const attachments = selectAttachments(readJSON(path.join(exported, 'manifest.json')));
  const screenshots = [];
  for (const { name: imageName, file } of attachments) {
    const source = path.join(exported, file), stat = fs.lstatSync(source);
    requireValue(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 20 * 1024 * 1024, 'Screenshot must be a bounded regular file');
    const normalized = normalizeScreenshotPNG(fs.readFileSync(source)), { bytes } = normalized;
    screenshots.push({ name: imageName, file: imageName + '.png', ...normalized,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
  }
  requireValue(!(await run('source-clean-after-tests', 'git', ['status', '--porcelain'])).trim() &&
    (await run('source-commit-after-tests', 'git', ['rev-parse', 'HEAD'])).trim() === commit, 'Source changed during simulator run');
  for (const screenshot of screenshots) {
    fs.writeFileSync(path.join(out, screenshot.file), screenshot.bytes, { flag: 'wx' });
    report.screenshots.push({ name: screenshot.name, file: screenshot.file, sha256: screenshot.sha256,
      width: screenshot.width, height: screenshot.height, has_alpha: false,
      lossless_opaque_alpha_normalized: screenshot.lossless_opaque_alpha_normalized });
  }
  report.state = 'simulator_ui_tests_complete'; report.passed = true;
} catch (error) {
  report.state = interrupted ? 'interrupted' : 'simulator_preparation_failed'; report.failed_phase = phase;
  report.passed = false; process.exitCode = 1;
  fs.writeFileSync(path.join(work, 'logs', 'validation-failure.log'), redact(String(error.message).slice(0, 2000)), { flag: 'wx' });
} finally {
  // A timed-out create can have completed before its stdout reached us. Resolve
  // only this run's random name/runtime, excluding every pre-existing device.
  if (ownedName && !ownedUDID) {
    try {
      const listing = JSON.parse(await run('cleanup-locate-owned-create', 'xcrun', ['simctl', 'list', 'devices', '--json'], 60_000, true));
      const candidates = (listing.devices?.[ownedRuntime] || []).filter(item => item.name === ownedName && !priorDeviceIDs.has(item.udid));
      requireValue(candidates.length <= 1, 'Ambiguous owned simulator creation');
      if (candidates.length === 1) {
        requireValue(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(candidates[0].udid), 'Invalid owned simulator identity');
        ownedUDID = candidates[0].udid;
      }
    } catch {
      report.state = 'owned_simulator_cleanup_failed'; report.passed = false; process.exitCode = 1;
    }
  }
  if (ownedUDID) {
    try {
      const listing = JSON.parse(await run('cleanup-list-owned', 'xcrun', ['simctl', 'list', 'devices', '--json'], 60_000, true));
      const owned = Object.values(listing.devices || {}).flat().filter(item => item.udid === ownedUDID);
      requireValue(owned.length === 1, 'Owned simulator missing before cleanup');
      if (owned[0].state !== 'Shutdown') await run('cleanup-shutdown-owned', 'xcrun', ['simctl', 'shutdown', ownedUDID], 60_000, true);
      await run('cleanup-delete-owned', 'xcrun', ['simctl', 'delete', ownedUDID], 60_000, true);
      const verified = JSON.parse(await run('cleanup-verify-owned', 'xcrun', ['simctl', 'list', 'devices', '--json'], 60_000, true));
      requireValue(!Object.values(verified.devices || {}).flat().some(item => item.udid === ownedUDID), 'Owned simulator remains after cleanup');
      report.owned_simulator_deleted = true;
    } catch {
      report.state = 'owned_simulator_cleanup_failed'; report.passed = false; process.exitCode = 1;
    }
  }
  if (interrupted) { report.state = 'interrupted'; report.passed = false; process.exitCode = 1; }
  fs.writeFileSync(path.join(out, 'simulator-report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(report, null, 2));
}
