import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { inflateSync } from 'node:zlib';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { EXPECTED_TESTS, SCREENSHOT_NAMES, chooseSimulator, validateDirectories, validateTestResults,
  selectAttachments, validateScreenshotPNG, normalizeScreenshotPNG, pngCRC, requireValue } from '../lib/simulator-store-prep.mjs';

// These deterministic fixtures never invoke Xcode, simctl, accounts or a network.
// Passing them is not evidence that an actual simulator or screenshot ran.
const repo = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
const runtime = 'com.apple.CoreSimulator.SimRuntime.iOS-27-0';
const device = 'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro-Max';
test('simulator command uses default single execution, not invalid one-iteration repetition', () => {
  const source = fs.readFileSync(path.join(repo,'scripts/check-simulator-store-prep.mjs'),'utf8');
  assert.doesNotMatch(source, /'-test-iterations'/);
  assert.match(source, /'-test-timeouts-enabled', 'YES'/);
  assert.match(source, /'-default-test-execution-time-allowance', '180'/);
  assert.match(source, /'-maximum-test-execution-time-allowance', '240'/);
  assert.match(source, /\], 1_200_000\)/);
});
function inventory() {
  return { runtimes: [{ identifier: runtime, version: '27.0', isAvailable: true,
    supportedDeviceTypes: [{ identifier: device }] }],
  devicetypes: [{ identifier: device, name: 'iPhone 17 Pro Max', minRuntimeVersion: 26 * 65536, maxRuntimeVersion: 0xffffffff }] };
}
function summary() { return { result: 'Passed', totalTestCount: 4, passedTests: 4, failedTests: 0, skippedTests: 0, expectedFailures: 0 }; }
function tree() {
  return { testNodes: [{ nodeType: 'Test Plan', children: [{ nodeType: 'Unit test bundle', children:
    EXPECTED_TESTS.map(nodeIdentifier => ({ nodeType: 'Test Case', nodeIdentifier: 'CabinDirectStorePrepUITests/' + nodeIdentifier + '()', result: 'Passed' }))
  }] }] };
}
function manifest() {
  return [{ testName: EXPECTED_TESTS[0], attachments: SCREENSHOT_NAMES.map((name, index) => ({
    suggestedHumanReadableName: `${name}_0_ABC-${index}.png`, exportedFileName: `synthetic-${index}.png`, isAssociatedWithFailure: false
  })) }];
}
function chunk(type, data = Buffer.alloc(0)) {
  const bytes = Buffer.alloc(12 + data.length);
  bytes.writeUInt32BE(data.length); bytes.write(type, 4, 'ascii'); data.copy(bytes, 8);
  bytes.writeUInt32BE(pngCRC(bytes.subarray(4, 8 + data.length)), 8 + data.length);
  return bytes;
}
function png({ width = 1320, height = 2868, colour = 2, alpha = false, filter = 0, short = false, extra = [] } = {}) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = colour;
  const row = width * 3 + 1, raw = Buffer.alloc(row * height - (short ? 1 : 0));
  for (let offset = 0; offset < raw.length; offset += row) raw[offset] = filter;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    ...(alpha ? [chunk('tRNS', Buffer.alloc(6))] : []), ...extra, chunk('IDAT', deflateSync(raw)), chunk('IEND')]);
}

function opaqueRGBA(filter, nonopaque = false) {
  const width = 1260, height = 2736, stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height), expected = Buffer.alloc((width * 3 + 1) * height);
  let previous = Buffer.alloc(stride);
  for (let row = 0; row < height; row++) {
    const current = Buffer.alloc(stride);
    for (let x = 0; x < width; x++) {
      const colour = [x % 256, row % 256, (x + row) % 256];
      current.set([...colour, nonopaque && row === height - 1 && x === width - 1 ? 254 : 255], x * 4);
      expected.set(colour, row * (width * 3 + 1) + 1 + x * 3);
    }
    raw[row * (stride + 1)] = filter;
    for (let column = 0; column < stride; column++) {
      const left = column >= 4 ? current[column - 4] : 0, up = previous[column], ul = column >= 4 ? previous[column - 4] : 0;
      const p = left + up - ul, a = Math.abs(p - left), b = Math.abs(p - up), c = Math.abs(p - ul);
      const predictor = [0, left, up, Math.floor((left + up) / 2), a <= b && a <= c ? left : b <= c ? up : ul][filter];
      raw[row * (stride + 1) + 1 + column] = (current[column] - predictor) & 255;
    }
    previous = current;
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return { bytes: Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk('sRGB', Buffer.from([0])), chunk('IDAT', deflateSync(raw)), chunk('IEND')]), expected };
}

test('[SIMULATED] runtime selection uses installed available supported iPhone types, preferring 17 Pro Max', () => {
  const input = inventory();
  assert.deepEqual(chooseSimulator(input), { model: 'iPhone 17 Pro Max', device_type: device, runtime, os_version: '27.0' });
  input.devicetypes.unshift({ name: 'iPhone 18 Pro Max', identifier: device.replace('-17-', '-18-') });
  input.runtimes[0].supportedDeviceTypes.push({ identifier: device.replace('-17-', '-18-') });
  assert.equal(chooseSimulator(input).model, 'iPhone 17 Pro Max');
  input.devicetypes.pop(); assert.equal(chooseSimulator(input).model, 'iPhone 18 Pro Max');
  input.runtimes[0].isAvailable = false; assert.throws(() => chooseSimulator(input), /downloads are disabled/);
});

test('[SIMULATED] missing, unavailable, mismatched and old runtime inventories fail closed', () => {
  for (const patch of [{ runtimes: [] }, { devicetypes: [] }, { runtimes: null }]) assert.throws(() => chooseSimulator({ ...inventory(), ...patch }));
  for (const patch of [{ isAvailable: false }, { isAvailable: 'true' }, { version: '25.0' }, { version: '27.0\n' },
    { identifier: 'com.apple.CoreSimulator.SimRuntime.tvOS-27-0' }, { supportedDeviceTypes: [] }]) {
    const input = inventory(); Object.assign(input.runtimes[0], patch); assert.throws(() => chooseSimulator(input));
  }
  for (const patch of [{ minRuntimeVersion: 28 * 65536 }, { maxRuntimeVersion: 26 * 65536 }, { name: 'iPad Pro' }]) {
    const input = inventory(); Object.assign(input.devicetypes[0], patch); assert.throws(() => chooseSimulator(input));
  }
});

test('[SIMULATED] external directories reject broad, source, overlapping, populated and symlink-aliased targets', t => {
  assert.ok(process.env.TMPDIR && path.isAbsolute(process.env.TMPDIR), 'Explicit task TMPDIR required');
  const root = fs.mkdtempSync(path.join(process.env.TMPDIR, 'sim-prep-check-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const work = path.join(root, 'work'), out = path.join(root, 'out');
  assert.deepEqual(validateDirectories(work, out, repo), { work: fs.realpathSync(root) + '/work', out: fs.realpathSync(root) + '/out' });
  for (const bad of ['/', '/tmp', '/private/tmp', '/Users', os.homedir(), repo, path.dirname(repo), path.join(repo, 'generated'), 'relative', work + '\n']) {
    assert.throws(() => validateDirectories(bad, out, repo));
  }
  for (const bad of [work, path.join(work, 'inside'), root]) assert.throws(() => validateDirectories(work, bad, repo));
  fs.mkdirSync(work); fs.writeFileSync(path.join(work, 'preserve.txt'), 'synthetic');
  assert.throws(() => validateDirectories(work, out, repo), /empty/);
  assert.equal(fs.readFileSync(path.join(work, 'preserve.txt'), 'utf8'), 'synthetic');
  const alias = path.join(root, 'source-alias'); fs.symlinkSync(repo, alias);
  assert.throws(() => validateDirectories(alias, out, repo));
});

test('[SIMULATED] structured XCTest validation requires exact successful identities and no skips', () => {
  assert.deepEqual(validateTestResults(summary(), tree()), { tests: 4, passed: 4, failed: 0, skipped: 0, expected_failures: 0 });
  for (const patch of [{ result: 'Failed' }, { totalTestCount: 3 }, { passedTests: 2 }, { skippedTests: 1 }, { failedTests: 1 },
    { expectedFailures: 1 }, { passedTests: '3' }]) assert.throws(() => validateTestResults({ ...summary(), ...patch }, tree()));
  for (const field of ['result', 'totalTestCount', 'passedTests', 'skippedTests', 'failedTests']) {
    const input = summary(); delete input[field]; assert.throws(() => validateTestResults(input, tree()));
  }
  for (const patch of [{ result: 'Skipped' }, { nodeIdentifier: 'Other/testSomething' }, { nodeIdentifier: EXPECTED_TESTS[1] }, { nodeIdentifier: null }]) {
    const input = tree(); Object.assign(input.testNodes[0].children[0].children[0], patch);
    assert.throws(() => validateTestResults(summary(), input));
  }
  assert.throws(() => validateTestResults(summary(), { testNodes: [] }));
});

test('[SIMULATED] attachment selection requires every exact named screenshot and rejects traversal or duplicates', () => {
  const input = manifest(); input[0].attachments.push({ suggestedHumanReadableName: 'unrelated-system-screenshot.png', exportedFileName: '../../ignore' });
  assert.deepEqual(selectAttachments(input), SCREENSHOT_NAMES.map((name, index) => ({ name, file: `synthetic-${index}.png` })));
  for (const bad of ['../secret.png', '/private/file.png', 'directory/file.png', 'directory\\file.png', '.hidden.png', 'file..png', 'photo.jpg', 'photo.png\n']) {
    const input = manifest(); input[0].attachments[0].exportedFileName = bad; assert.throws(() => selectAttachments(input));
  }
  const missing = manifest(); missing[0].attachments.pop(); assert.throws(() => selectAttachments(missing), /Missing/);
  const duplicate = manifest(); duplicate[0].attachments.push({ ...duplicate[0].attachments[0] }); assert.throws(() => selectAttachments(duplicate), /Duplicate/);
  const sameFile = manifest(); sameFile[0].attachments[1].exportedFileName = sameFile[0].attachments[0].exportedFileName;
  assert.throws(() => selectAttachments(sameFile), /duplicate/);
  const failed = manifest(); failed[0].attachments[0].isAssociatedWithFailure = true; assert.throws(() => selectAttachments(failed));
});

test('[SIMULATED] PNG validator accepts original opaque RGB bytes at each supported native portrait size', () => {
  for (const [width, height] of [[1320, 2868], [1290, 2796], [1260, 2736]]) {
    const bytes = png({ width, height }), before = Buffer.from(bytes);
    assert.deepEqual(validateScreenshotPNG(bytes), { width, height, has_alpha: false });
    assert.deepEqual(bytes, before);
  }
});

test('[SIMULATED] PNG validator rejects transparency, wrong sizes, truncation, CRC and malformed compressed data', () => {
  for (const options of [{ width: 2868, height: 1320 }, { width: 1, height: 1 }, { colour: 6 }, { alpha: true },
    { filter: 5 }, { short: true }, { extra: [chunk('acTL', Buffer.alloc(8))] },
    { extra: [chunk('FAKE', Buffer.alloc(8))] }]) assert.throws(() => validateScreenshotPNG(png(options)));
  const valid = png();
  for (const bytes of [Buffer.from('not png'), valid.subarray(0, valid.length - 1), Buffer.concat([valid, Buffer.from('extra')])]) {
    assert.throws(() => validateScreenshotPNG(bytes));
  }
  const corrupt = Buffer.from(valid); corrupt[corrupt.length - 1] ^= 1;
  assert.throws(() => validateScreenshotPNG(corrupt), /checksum/);
  const overflow = Buffer.from(valid); overflow.writeUInt32BE(0xffffffff, 8);
  assert.throws(() => validateScreenshotPNG(overflow));
});

test('[SIMULATED] opaque RGBA normalizes losslessly for every PNG filter; genuine transparency is refused', () => {
  for (let filter = 0; filter <= 4; filter++) {
    const original = opaqueRGBA(filter), normalized = normalizeScreenshotPNG(original.bytes);
    assert.equal(normalized.lossless_opaque_alpha_normalized, true);
    assert.deepEqual(validateScreenshotPNG(normalized.bytes), { width: 1260, height: 2736, has_alpha: false });
    let offset = 8, compressed;
    while (offset < normalized.bytes.length) {
      const length = normalized.bytes.readUInt32BE(offset);
      if (normalized.bytes.toString('ascii', offset + 4, offset + 8) === 'IDAT') compressed = normalized.bytes.subarray(offset + 8, offset + 8 + length);
      offset += 12 + length;
    }
    assert.deepEqual(inflateSync(compressed), original.expected, 'Every native RGB pixel is preserved');
    assert.ok(normalized.bytes.includes(Buffer.from('sRGB')), 'Color interpretation retained');
  }
  assert.throws(() => normalizeScreenshotPNG(opaqueRGBA(4, true).bytes), /nonopaque pixels/);
  const original = png(); assert.equal(normalizeScreenshotPNG(original).bytes, original, 'Opaque RGB is never reencoded');
});

async function simulateRunner(options = {}) {
  const work = '/simulated/work', out = '/simulated/out', commit = 'a'.repeat(40);
  const udid = '11111111-2222-3333-4444-555555555555', calls = [], files = new Map(), consoleOutput = [];
  let owned = null, activeChild;
  const pngBytes = png();
  const fakeFS = {
    realpathSync: () => repo,
    existsSync: file => files.has(file) || (options.testFailure && file === work+'/results/CabinDirectStorePrep.xcresult'),
    mkdirSync() {},
    readFileSync(file, encoding) { assert.ok(files.has(file), 'Unexpected fake read: ' + file); const value = files.get(file); return encoding ? value.toString(encoding) : value; },
    lstatSync(file) { assert.ok(files.has(file)); return { isFile: () => true, isSymbolicLink: () => false, size: files.get(file).length }; },
    writeFileSync(file, value, flags) { assert.ok(file.startsWith(work + '/') || file.startsWith(out + '/')); if (flags?.flag === 'wx') assert.equal(files.has(file), false); files.set(file, Buffer.from(value)); }
  };
  const fakeProcess = { platform: 'darwin', argv: ['node', '/fake/script.mjs'], exitCode: 0, on() {},
    env: { CABIN_SIM_WORK_DIR: work, CABIN_SIM_OUT_DIR: out, GITHUB_REPOSITORY: 'citrus-13/cabin-direct-ios', GITHUB_SHA: commit,
      GITHUB_RUN_ID: '123', GH_TOKEN: 'SYNTHETIC_NOT_REAL', ...options.env },
    kill(pid, signal) { assert.equal(pid, -4321); assert.equal(signal, 'SIGKILL'); activeChild.emit('close', null, signal); }
  };
  const fakeSpawn = (command, args, settings) => {
    assert.equal(settings.env.GH_TOKEN, undefined, 'No publication token passed to subprocesses');
    assert.equal(settings.detached, true); calls.push({ command, args });
    const child = new EventEmitter(); child.pid = 4321; child.stdout = new PassThrough(); child.stderr = new PassThrough(); activeChild = child;
    queueMicrotask(() => {
      let output = '', status = 0;
      if (command === 'git') output = args[0] === 'rev-parse' ? commit : options.dirty ? ' M file' : '';
      else if (command === 'xcodegen') output = 'Generated';
      else if (command === 'xcodebuild') {
        if (args[0] === '-version') output = 'Xcode 27.0\nBuild version 18A1\n';
        else if (options.timeout) return;
        else if (options.testFailure) status = 65;
      } else if (command === 'xcrun' && args[0] === 'simctl') {
        if (args[1] === 'list') output = JSON.stringify({ ...inventory(), devices: { [runtime]: owned ? [owned] : [] } });
        else if (args[1] === 'create') {
          owned = { udid, name: args[2], isAvailable: true, state: 'Shutdown' };
          output = udid; if (options.failedCreateAfterCreation) { status = 1; output = ''; }
        } else if (args[1] === 'boot') owned.state = 'Booted';
        else if (args[1] === 'bootstatus') assert.equal(args[2], udid);
        else if (args[1] === 'shutdown') { assert.equal(args[2], udid); owned.state = 'Shutdown'; }
        else if (args[1] === 'delete') { assert.equal(args[2], udid); if (options.cleanupFailure) status = 1; else owned = null; }
        else assert.fail('Unexpected simulated simctl command');
      } else if (command === 'xcrun' && args[0] === 'xcresulttool') {
        if (args.includes('--help')) output = '--path --output-path';
        else if (args.includes('--schema')) output = '{}';
        else if (args[1] === 'get') output = JSON.stringify(args[3] === 'summary' ? { ...summary(), ...options.summary } : tree());
        else if (args[1] === 'export') {
          const selected = manifest(); if (options.missingScreenshot) selected[0].attachments.pop();
          files.set(work + '/attachments/manifest.json', Buffer.from(JSON.stringify(selected)));
          for (let index = 0; index < SCREENSHOT_NAMES.length; index++) files.set(work + '/attachments/synthetic-' + index + '.png', pngBytes);
        } else assert.fail('Unexpected simulated xcresult command');
      } else assert.fail('Unexpected simulated subprocess');
      child.stdout.end(output); child.stderr.end(''); child.emit('close', status, null);
    });
    return child;
  };
  const script = fs.readFileSync(path.join(repo, 'scripts/check-simulator-store-prep.mjs'), 'utf8')
    .replace(/^import[\s\S]*?;\n/gm, '').replaceAll('import.meta.url', 'moduleURL');
  const context = { fs: fakeFS, path, crypto, spawn: fakeSpawn, process: fakeProcess, fileURLToPath,
    moduleURL: new URL('../scripts/check-simulator-store-prep.mjs', import.meta.url).href,
    requireValue, validateDirectories: () => ({ work, out }), chooseSimulator, validateTestResults, selectAttachments, normalizeScreenshotPNG,
    Buffer, setTimeout: callback => setTimeout(callback, 20), clearTimeout, console: { log: value => consoleOutput.push(value) } };
  await vm.runInNewContext('(async () => {\n' + script + '\n})()', context, { timeout: 1000 });
  const report = JSON.parse(files.get(out + '/simulator-report.json').toString());
  return { report, calls, files, code: fakeProcess.exitCode, owned, consoleOutput };
}

test('[SIMULATED RUNNER] successful command flow validates and curates ten screenshots, then deletes only its simulator', async () => {
  const result = await simulateRunner();
  assert.equal(result.report.passed, true); assert.equal(result.report.owned_simulator_deleted, true);
  assert.equal(result.report.simulator_only, true); assert.equal(result.report.physical_iphone_test, false);
  assert.equal(result.report.capture_test, false); assert.equal(result.report.personal_signing, false);
  assert.equal(result.report.screenshots.length, 10); assert.equal(result.code, 0); assert.equal(result.owned, null);
  assert.equal([...result.files.keys()].filter(name => name.startsWith('/simulated/out/')).length, SCREENSHOT_NAMES.length + 1);
  assert.equal(result.calls.filter(item => item.args[1] === 'create').length, 1);
  assert.doesNotMatch(JSON.stringify(result.report), /SYNTHETIC_NOT_REAL|\/simulated|11111111/);
});

test('[SIMULATED RUNNER] failed tests, skips and missing screenshots fail closed and still clean up', async () => {
  for (const options of [{ testFailure: true }, { summary: { skippedTests: 1 } }, { missingScreenshot: true }]) {
    const result = await simulateRunner(options);
    assert.equal(result.report.passed, false); assert.equal(result.code, 1); assert.equal(result.owned, null);
    assert.equal(result.report.owned_simulator_deleted, true);
    assert.equal([...result.files.keys()].filter(name => name.startsWith('/simulated/out/')).length, 1, 'No screenshot assets released on failure');
  }
});

test('[SIMULATED RUNNER] dirty source creates no simulator; timed-out tests and interrupted create retain owned-only cleanup', async () => {
  const dirty = await simulateRunner({ dirty: true });
  assert.equal(dirty.report.passed, false); assert.equal(dirty.calls.some(item => item.args[1] === 'create'), false);
  for (const options of [{ timeout: true }, { failedCreateAfterCreation: true }]) {
    const result = await simulateRunner(options);
    assert.equal(result.report.passed, false); assert.equal(result.report.owned_simulator_deleted, true); assert.equal(result.owned, null);
  }
});

test('[SIMULATED RUNNER] cleanup failure cannot be reported as successful simulator preparation', async () => {
  const result = await simulateRunner({ cleanupFailure: true });
  assert.equal(result.report.passed, false); assert.equal(result.report.state, 'owned_simulator_cleanup_failed');
  assert.equal(result.report.owned_simulator_deleted, false); assert.equal(result.code, 1);
});

test('[SIMULATED RUNNER] partial actual-result-shaped observations stay failed and never rerun tests', async () => {
  const result = await simulateRunner({testFailure:true,summary:{result:'Failed',totalTestCount:3,
    passedTests:1,failedTests:2,skippedTests:0,testFailures:[{testIdentifier:'KNOWN_SYNTHETIC_TEST',message:'SYNTHETIC assertion failed'}]}});
  assert.equal(result.report.passed,false);
  assert.equal(result.report.failed_phase,'simulator-ui-tests');
  assert.equal(result.report.tests.passed,1); assert.equal(result.report.tests.failed,2);
  assert.equal(result.report.screenshots.length,0);
  assert.equal(result.calls.filter(call=>call.command==='xcodebuild' && call.args[0]==='test').length,1);
  assert.equal(result.report.owned_simulator_deleted,true);
  assert.ok(result.consoleOutput.some(line=>line.startsWith('[failed simulator observations] ')));
});

test('[STATIC] runner has owned-only cleanup, external outputs and no signing/account/runtime-download/publication flow', () => {
  const source = fs.readFileSync(path.join(repo, 'scripts/check-simulator-store-prep.mjs'), 'utf8');
  assert.match(source, /'CabinDirectStorePrep'/);
  assert.match(source, /'-parallel-testing-enabled', 'NO'/);
  assert.match(source, /'CODE_SIGN_IDENTITY=-'/);
  assert.match(source, /'DEVELOPMENT_TEAM='/);
  assert.match(source, /'simctl', 'shutdown', ownedUDID/);
  assert.match(source, /'simctl', 'delete', ownedUDID/);
  assert.match(source, /finally/);
  assert.match(source, /validateTestResults\(summary, tree\)/);
  assert.match(source, /normalizeScreenshotPNG\(fs.readFileSync\(source\)\)/);
  assert.match(source, /owned_simulator_deleted/);
  assert.doesNotMatch(source, /allowProvisioningUpdates|downloadPlatform|downloadAllPlatforms|simctl', 'privacy|shutdown', 'all|delete', 'all|security',|rmSync|release', 'create|upload-artifact/);
});
