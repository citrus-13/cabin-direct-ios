import { spawnSync } from 'node:child_process';
import { mkdirSync, realpathSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const repo = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const requested = process.env.CABIN_NATIVE_WORK_DIR;
if (process.platform !== 'darwin') throw new Error('Native acceptance requires macOS and its Apple SDK.');
if (!requested || !path.isAbsolute(requested)) throw new Error('Set an explicit absolute CABIN_NATIVE_WORK_DIR outside the repository.');
const lexical = path.resolve(requested);
let ancestor = lexical;
while (!existsSync(ancestor)) ancestor = path.dirname(ancestor);
const work = path.resolve(realpathSync(ancestor), path.relative(ancestor, lexical));
const contains = (base, target) => target === base || target.startsWith(base + path.sep);
if (contains(repo, work) || contains(work, repo) || work === os.homedir() || work === path.parse(work).root) {
  throw new Error('CABIN_NATIVE_WORK_DIR must be a dedicated external directory, not the repository or a broad ancestor.');
}
for (const directory of ['tmp', 'logs', 'scratch', 'cache', 'module-cache', 'bin']) mkdirSync(path.join(work, directory), { recursive: true });
const env = { ...process.env, TMPDIR: path.join(work, 'tmp'),
  CLANG_MODULE_CACHE_PATH: path.join(work, 'module-cache'),
  SWIFTPM_MODULECACHE_OVERRIDE: path.join(work, 'module-cache') };
const results = [];
const reportPath = path.join(work, 'native-report.json');
function report() {
  writeFileSync(reportPath, JSON.stringify({ platform: 'macOS-only', full_iOS_build: false,
    device_test: false, xctest_required: false, generated_at: new Date().toISOString(),
    host: { platform: process.platform, arch: process.arch, release: os.release() },
    work_directory: work, passed: results.every(result => result.status === 'passed'), results }, null, 2) + '\n');
}
function execute(name, command, args) {
  console.log(`\n[${name}] ${command} ${args.join(' ')}`);
  const started = Date.now();
  const result = spawnSync(command, args, { cwd: repo, env, encoding: 'utf8', timeout: 240_000, maxBuffer: 16 * 1024 * 1024 });
  const output = (result.stdout || '') + (result.stderr || '') + (result.error ? `\n${result.error.message}\n` : '');
  const log = path.join(work, 'logs', name + '.log');
  writeFileSync(log, output);
  process.stdout.write(output);
  const status = result.status === 0 && !result.error ? 'passed' : 'failed';
  results.push({ name, status, exit_code: result.status, signal: result.signal, duration_ms: Date.now() - started, log });
  report();
  return status === 'passed';
}
function swiftRun(name, packageDirectory, product) {
  execute(name, 'swift', ['run', '--package-path', packageDirectory,
    '--scratch-path', path.join(work, 'scratch', name), '--cache-path', path.join(work, 'cache', name),
    '--disable-sandbox', '-Xswiftc', '-module-cache-path', '-Xswiftc', path.join(work, 'module-cache'), product]);
}

execute('swift-version', 'swift', ['--version']);
execute('sdk-path', 'xcrun', ['--show-sdk-path']);
swiftRun('direct-core-tcp', 'ios/DirectCore', 'direct-core-tests');
const capture = path.join(work, 'bin', 'direct-capture-checks');
if (execute('capture-compile', 'swiftc', ['-D', 'DIRECT_CAPTURE_STANDALONE', '-module-cache-path', path.join(work, 'module-cache'),
  'ios/DirectCapture/CapturePipeline.swift', 'ios/DirectCapture/Tests/CapturePipelineTests.swift',
  'ios/DirectCapture/Tests/NativeAcceptance.swift', '-o', capture])) execute('capture-tests', capture, []);
const media = path.join(work, 'bin', 'direct-media-checks');
const mux = path.join(work, 'bin', 'direct-mux-checks');
if (execute('mux-compile', 'swiftc', ['-module-cache-path', path.join(work, 'module-cache'),
  'ios/DirectCapture/FragmentedMP4.swift', 'ios/DirectMediaChecks/main.swift', '-o', mux])) execute('mux-tests', mux, []);
if (execute('media-compile', 'swiftc', ['-D', 'DIRECT_MEDIA_STANDALONE', '-application-extension',
  '-module-cache-path', path.join(work, 'module-cache'), 'ios/DirectCapture/CapturePipeline.swift',
  'ios/DirectCapture/FragmentedMP4.swift', 'ios/DirectCapture/DirectMediaPipeline.swift',
  'ios/DirectCapture/Tests/MediaNativeAcceptance.swift', '-o', media])) execute('media-synthetic-tests', media, []);
swiftRun('tesla-ble-offline', 'ios/TeslaBLE', 'TeslaBLEOfflineChecks');
const shared = path.join(work, 'bin', 'direct-integration-checks');
if (execute('shared-compile', 'swiftc', ['-module-cache-path', path.join(work, 'module-cache'),
  'ios/Shared/SessionConfiguration.swift', 'ios/Shared/DirectConfiguration.swift', 'ios/Shared/DirectLyrics.swift',
  'ios/DirectIntegrationChecks/main.swift', '-o', shared])) execute('shared-tests', shared, []);
const music = path.join(work, 'bin', 'direct-music-checks');
if (execute('music-compile', 'swiftc', ['-swift-version', '5', '-module-cache-path', path.join(work, 'module-cache'),
  'ios/Shared/SessionConfiguration.swift', 'ios/Shared/DirectConfiguration.swift', 'ios/Shared/DirectLyrics.swift',
  'ios/Shared/DirectMusicClock.swift', 'ios/DirectMusicChecks/main.swift', '-o', music])) execute('music-tests', music, []);
execute('ios-source-parse-only', 'swiftc', ['-frontend', '-parse',
  'ios/StandaloneApp/CabinDirectApp.swift', 'ios/StandaloneApp/DirectDemoRuntime.swift', 'ios/StandaloneBroadcast/DirectSampleHandler.swift',
  'ios/StandaloneApp/DirectLyricsMode.swift',
  'ios/StandaloneBroadcast/DirectMusicRuntime.swift', 'ios/StandaloneBroadcast/DirectMusicRecognizer.swift',
  'ios/Shared/SessionConfiguration.swift', 'ios/Shared/DirectConfiguration.swift', 'ios/Shared/DirectLyrics.swift',
  'ios/Shared/DirectMusicClock.swift']);
console.log(`\nReport: ${reportPath}\nScope: macOS native execution and Swift syntax parsing only; full_iOS_build=false; no device acceptance.`);
if (results.some(result => result.status !== 'passed')) process.exitCode = 1;
