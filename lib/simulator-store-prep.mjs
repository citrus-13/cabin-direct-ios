import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { inflateSync, deflateSync } from 'node:zlib';

export const EXPECTED_TESTS = Object.freeze([
  'CabinDirectUITests/testLightNavigationAndPrivacy',
  'CabinDirectUITests/testVisibleTextRegionControls',
  'CabinDirectUITests/testDarkAndAccessibilityNavigation'
]);
export const SCREENSHOT_NAMES = Object.freeze([
  'connect-light', 'share-light', 'privacy-light', 'support-light',
  'visible-text-controls-light', 'help-dark', 'privacy-accessibility', 'support-accessibility'
]);
export function requireValue(value, message) { if (!value) throw new Error(message); }
const within = (base, candidate) => candidate === base || candidate.startsWith(base + path.sep);

export function validateDirectories(workInput, outInput, repo) {
  function resolve(input) {
    requireValue(typeof input === 'string' && path.isAbsolute(input) && !/[\x00-\x1f]/.test(input), 'Explicit absolute dedicated directories required');
    const lexical = path.resolve(input);
    let ancestor = lexical;
    while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
    const resolved = path.resolve(fs.realpathSync(ancestor), path.relative(ancestor, lexical));
    const broad = [path.parse(resolved).root, os.homedir(), '/tmp', '/private/tmp', '/Users', '/var', '/private/var'];
    requireValue(!broad.includes(resolved) && resolved.split(path.sep).filter(Boolean).length >= 3 &&
      !within(repo, resolved) && !within(resolved, repo) && !within(resolved, os.homedir()), 'Directories must not be broad or overlap source/home');
    if (fs.existsSync(resolved)) requireValue(fs.lstatSync(resolved).isDirectory() && fs.readdirSync(resolved).length === 0, 'Dedicated directory must be empty');
    return resolved;
  }
  const work = resolve(workInput), out = resolve(outInput);
  requireValue(!within(work, out) && !within(out, work), 'Work and output directories must not overlap');
  return { work, out };
}

const versionNumber = value => {
  requireValue(typeof value === 'string' && /^[0-9]{1,3}(\.[0-9]{1,3}){0,2}$/.test(value), 'Invalid simulator runtime version');
  const [major, minor = 0, patch = 0] = value.split('.').map(Number);
  requireValue(minor < 256 && patch < 256, 'Invalid simulator runtime version');
  return major * 65536 + minor * 256 + patch;
};
export function chooseSimulator(inventory) {
  requireValue(Array.isArray(inventory?.runtimes) && Array.isArray(inventory?.devicetypes), 'Missing simulator inventory');
  const runtimes = inventory.runtimes.filter(item => item.isAvailable === true &&
    /^com\.apple\.CoreSimulator\.SimRuntime\.iOS-[0-9-]+$/.test(item.identifier || '') &&
    /^[0-9]{1,3}(\.[0-9]{1,3}){0,2}$/.test(item.version || ''))
    .sort((a, b) => versionNumber(b.version) - versionNumber(a.version));
  for (const model of ['iPhone 17 Pro Max', 'iPhone 18 Pro Max']) {
    const type = inventory.devicetypes.find(item => item.name === model &&
      /^com\.apple\.CoreSimulator\.SimDeviceType\.iPhone-(17|18)-Pro-Max$/.test(item.identifier || ''));
    if (!type) continue;
    for (const runtime of runtimes) {
      const number = versionNumber(runtime.version);
      if (number < (model.includes('17') ? 26 : 27) * 65536) continue;
      if (Number.isInteger(type.minRuntimeVersion) && number < type.minRuntimeVersion) continue;
      if (Number.isInteger(type.maxRuntimeVersion) && number > type.maxRuntimeVersion) continue;
      if (Array.isArray(runtime.supportedDeviceTypes) && !runtime.supportedDeviceTypes.some(item => item.identifier === type.identifier)) continue;
      return { model, device_type: type.identifier, runtime: runtime.identifier, os_version: runtime.version };
    }
  }
  throw new Error('No installed available matching iPhone 17/18 Pro Max runtime; runtime downloads are disabled');
}

function testIdentifier(value) {
  requireValue(typeof value === 'string' && value.length < 300, 'Missing test identity');
  return value.replace(/^CabinDirectStorePrepUITests\//, '').replace(/\(\)$/, '');
}
export function validateTestResults(summary, tree) {
  requireValue(summary?.result === 'Passed' && summary.totalTestCount === EXPECTED_TESTS.length &&
    summary.passedTests === EXPECTED_TESTS.length && summary.failedTests === 0 && summary.skippedTests === 0 &&
    (summary.expectedFailures === undefined || summary.expectedFailures === 0), 'Expected all simulator UI tests passed without skips/failures');
  requireValue(Array.isArray(tree?.testNodes), 'Missing structured test tree');
  const pending = [...tree.testNodes], found = [];
  let visited = 0;
  while (pending.length) {
    const node = pending.pop();
    requireValue(node && typeof node === 'object' && ++visited <= 1000, 'Invalid or excessive test tree');
    if (node.nodeType === 'Test Case') {
      requireValue(node.result === 'Passed', 'Simulator test case did not pass');
      found.push(testIdentifier(node.nodeIdentifier));
    } else if (Array.isArray(node.children)) pending.push(...node.children);
  }
  requireValue(found.length === EXPECTED_TESTS.length && new Set(found).size === found.length &&
    EXPECTED_TESTS.every(name => found.includes(name)), 'Simulator test identities do not match expected suite');
  return { tests: found.length, passed: found.length, failed: 0, skipped: 0, expected_failures: 0 };
}

export function selectAttachments(manifest) {
  requireValue(Array.isArray(manifest) && manifest.length <= 100, 'Invalid attachment manifest');
  const selected = new Map();
  for (const entry of manifest) {
    requireValue(Array.isArray(entry.attachments) && entry.attachments.length <= 1000, 'Invalid attachment manifest entry');
    for (const attachment of entry.attachments) {
      const suggested = attachment.suggestedHumanReadableName;
      if (typeof suggested !== 'string' || suggested.length > 300) continue;
      const name = SCREENSHOT_NAMES.find(item => suggested === item || suggested === item + '.png' ||
        (suggested.startsWith(item + '_') && /^[A-Za-z0-9_-]+\.png$/.test(suggested.slice(item.length + 1))));
      if (!name) continue;
      const file = attachment.exportedFileName;
      requireValue(typeof file === 'string' && /^[A-Za-z0-9_.-]+\.png$/.test(file) &&
        !file.startsWith('.') && !file.includes('..'), 'Unsafe screenshot attachment filename');
      requireValue(attachment.isAssociatedWithFailure !== true && !selected.has(name), 'Duplicate or failed screenshot attachment');
      selected.set(name, file);
    }
  }
  requireValue(selected.size === SCREENSHOT_NAMES.length && new Set(selected.values()).size === selected.size, 'Missing or duplicate named screenshots');
  return SCREENSHOT_NAMES.map(name => ({ name, file: selected.get(name) }));
}

const crcTable = Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : value >>> 1;
  return value >>> 0;
});
export function pngCRC(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function decodeScreenshotPNG(bytes) {
  requireValue(Buffer.isBuffer(bytes) && bytes.length >= 57 && bytes.length <= 20 * 1024 * 1024 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'Invalid bounded PNG screenshot');
  let offset = 8, width, height, colour, ended = false, idatClosed = false, chunks = 0;
  const compressed = [], colourChunks = [];
  while (offset < bytes.length) {
    requireValue(++chunks <= 10000 && bytes.length - offset >= 12, 'Invalid PNG chunk table');
    const length = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8);
    requireValue(/^[A-Za-z]{4}$/.test(type) && length <= bytes.length - offset - 12 &&
      pngCRC(bytes.subarray(offset + 4, offset + 8 + length)) === bytes.readUInt32BE(offset + 8 + length), 'Invalid PNG chunk length/checksum');
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    requireValue(type[0] === type[0].toLowerCase() || ['IHDR', 'PLTE', 'IDAT', 'IEND'].includes(type), 'Unsupported critical PNG chunk');
    if (chunks === 1) {
      requireValue(type === 'IHDR' && length === 13, 'Missing PNG header');
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      requireValue(['1320x2868', '1290x2796', '1260x2736'].includes(`${width}x${height}`), 'Screenshot dimensions not accepted for selected store slot');
      colour = data[9];
      requireValue(data[8] === 8 && [2, 6].includes(colour) && data[10] === 0 && data[11] === 0 && data[12] === 0,
        'Screenshot must be noninterlaced 8-bit RGB or RGBA PNG');
    } else {
      requireValue(type !== 'IHDR' && type !== 'tRNS' && type !== 'acTL', 'Duplicate header, transparency or animation in screenshot');
      if (type === 'IDAT') {
        requireValue(!idatClosed, 'Noncontiguous PNG image data'); compressed.push(data);
      } else if (compressed.length) idatClosed = true;
      if (type === 'IEND') {
        requireValue(length === 0 && compressed.length > 0 && offset + 12 === bytes.length, 'Invalid PNG end');
        ended = true;
      }
      if (['iCCP', 'sRGB', 'gAMA', 'cHRM', 'cICP', 'mDCV', 'cLLI'].includes(type)) colourChunks.push(Buffer.from(bytes.subarray(offset, offset + 12 + length)));
    }
    offset += 12 + length;
  }
  requireValue(ended, 'Incomplete PNG screenshot');
  const rowSize = width * (colour === 6 ? 4 : 3) + 1, raw = inflateSync(Buffer.concat(compressed), { maxOutputLength: rowSize * height });
  requireValue(raw.length === rowSize * height, 'Invalid PNG decoded size');
  for (let row = 0; row < height; row++) requireValue(raw[row * rowSize] <= 4, 'Invalid PNG scanline filter');
  return { width, height, colour, raw, colourChunks };
}
export function validateScreenshotPNG(bytes) {
  const { width, height, colour } = decodeScreenshotPNG(bytes);
  requireValue(colour === 2, 'Screenshot must be RGB without an alpha channel');
  return { width, height, has_alpha: false };
}
function pngChunk(type, data) {
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length); chunk.write(type, 4, 'ascii'); data.copy(chunk, 8);
  chunk.writeUInt32BE(pngCRC(chunk.subarray(4, 8 + data.length)), 8 + data.length);
  return chunk;
}
export function normalizeScreenshotPNG(input) {
  const decoded = decodeScreenshotPNG(input), { width, height, colour, raw, colourChunks } = decoded;
  if (colour === 2) return { bytes: input, width, height, has_alpha: false, lossless_opaque_alpha_normalized: false };
  const stride = width * 4, rgbStride = width * 3 + 1, rgb = Buffer.alloc(rgbStride * height);
  let previous = Buffer.alloc(stride);
  for (let row = 0; row < height; row++) {
    const filter = raw[row * (stride + 1)], current = Buffer.alloc(stride);
    for (let column = 0; column < stride; column++) {
      const left = column >= 4 ? current[column - 4] : 0, up = previous[column], upperLeft = column >= 4 ? previous[column - 4] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = Math.floor((left + up) / 2);
      else if (filter === 4) {
        const p = left + up - upperLeft, a = Math.abs(p - left), b = Math.abs(p - up), c = Math.abs(p - upperLeft);
        predictor = a <= b && a <= c ? left : b <= c ? up : upperLeft;
      }
      current[column] = (raw[row * (stride + 1) + 1 + column] + predictor) & 255;
    }
    for (let pixel = 0; pixel < width; pixel++) {
      requireValue(current[pixel * 4 + 3] === 255, 'Screenshot contains nonopaque pixels; transparent content is never composited');
      current.copy(rgb, row * rgbStride + 1 + pixel * 3, pixel * 4, pixel * 4 + 3);
    }
    previous = current;
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  // Preserve native pixels/dimensions/color interpretation. Only an entirely
  // opaque alpha channel is removed; there is no resizing or compositing.
  const bytes = Buffer.concat([input.subarray(0, 8), pngChunk('IHDR', header), ...colourChunks,
    pngChunk('IDAT', deflateSync(rgb)), pngChunk('IEND', Buffer.alloc(0))]);
  validateScreenshotPNG(bytes);
  return { bytes, width, height, has_alpha: false, lossless_opaque_alpha_normalized: true };
}
