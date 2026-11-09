import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const read = file => readFileSync(join(root, file), 'utf8');

test('real fMP4 box layout preserves clocks, offsets, samples and rejects invalid bounds', { timeout: 120_000 }, t => {
  const available = spawnSync('swiftc', ['--version'], { encoding: 'utf8', timeout: 10_000 });
  if (available.error?.code === 'ENOENT') return t.skip('Swift compiler unavailable; cloud macOS requires no skipped checks');
  assert.equal(available.status, 0, available.stderr);
  const work = mkdtempSync(join(tmpdir(), 'cabin-mux-'));
  const cache = join(work, 'module-cache'); mkdirSync(cache);
  const executable = join(work, 'mux-checks');
  const env = { ...process.env, TMPDIR: work, CLANG_MODULE_CACHE_PATH: cache };
  const compile = spawnSync('swiftc', ['-module-cache-path', cache,
    'ios/DirectCapture/FragmentedMP4.swift', 'ios/DirectMediaChecks/main.swift', '-o', executable],
  { cwd: root, env, encoding: 'utf8', timeout: 90_000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(compile.status, 0, compile.stdout + compile.stderr);
  const result = spawnSync(executable, [], { cwd: root, env, encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal((result.stdout.match(/^PASS /gm) || []).length, 5, result.stdout);
});

test('screen media remains separate from microphone lyrics and has no recorder or networking', () => {
  const native = read('ios/DirectCapture/DirectMediaPipeline.swift');
  const lyrics = read('ios/StandaloneApp/DirectLyricsMode.swift');
  const runtime = read('ios/StandaloneBroadcast/DirectSampleHandler.swift');
  assert.doesNotMatch(native, /AVAudioEngine|AVAudioSession|AVAudioRecorder|URLSession|\.write\(to:|FileManager/);
  assert.match(native, /if #available\(iOS 17\.4, \*\) \{\s*specification = \[kVTVideoEncoderSpecification_EnableHardwareAcceleratedVideoEncoder/);
  assert.match(native, /encoderSpecification: specification/);
  assert.doesNotMatch(lyrics, /DirectMediaPipeline|updateMediaFragment|updateMediaInitialization/);
  assert.match(runtime, /sampleBufferType == \.audioApp/);
  assert.match(runtime, /guard sampleBufferType == \.video else/);
  assert.match(runtime, /media\?\.setPaused\(value\)/);
  assert.match(runtime, /media\?\.stop\(\); media = nil; server\.clearMedia\(\)/);
  const pkg = read('ios/DirectCapture/Package.swift');
  assert.match(pkg, /FragmentedMP4.swift/); assert.match(pkg, /DirectMediaPipeline.swift/);
});

test('original synthetic A/V really encodes and decodes with bounded shared-clock skew', { timeout: 240_000 }, t => {
  if (process.platform !== 'darwin') return t.skip('Apple codec SDK unavailable; never substitute mock device evidence');
  const work = mkdtempSync(join(tmpdir(), 'cabin-media-'));
  const cache = join(work, 'module-cache'); mkdirSync(cache);
  const executable = join(work, 'media-native');
  const env = { ...process.env, TMPDIR: work, CLANG_MODULE_CACHE_PATH: cache };
  // Exporting fixtures is explicit outside npm test; repeated tests must not overwrite evidence.
  delete env.CABIN_MEDIA_FIXTURE_DIR;
  const compile = spawnSync('swiftc', ['-D', 'DIRECT_MEDIA_STANDALONE', '-application-extension',
    '-module-cache-path', cache, 'ios/DirectCapture/CapturePipeline.swift', 'ios/DirectCapture/FragmentedMP4.swift',
    'ios/DirectCapture/DirectMediaPipeline.swift', 'ios/DirectCapture/Tests/MediaNativeAcceptance.swift', '-o', executable],
  { cwd: root, env, encoding: 'utf8', timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(compile.status, 0, compile.stdout + compile.stderr);
  const result = spawnSync(executable, [], { cwd: root, env, encoding: 'utf8', timeout: 90_000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PASS real H264\/AAC-LC encode \+ fMP4 demux\/decode/);
  assert.match(result.stdout, /PASS decoded common-clock flash\/tone markers/);
  assert.match(result.stdout, /PASS sparse600ms\/1s video/);
  assert.match(result.stdout, /no ReplayKit, microphone, network, signing, iPhone or Tesla acceptance/);
});
