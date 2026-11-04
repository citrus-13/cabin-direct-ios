import { lstatSync, readdirSync } from 'node:fs';
import path from 'node:path';

const COMMIT = /^[a-f0-9]{40}$/i;
const HASH = /^[a-f0-9]{64}$/i;
const RUN = /^https:\/\/github\.com\/citrus-13\/cabin-direct-ios\/actions\/runs\/[0-9]+$/;
const MAX_FILES = 10_000;
const MAX_BYTES = 64 * 1024 * 1024;

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}
function matches(pattern, value) {
  // JavaScript's $ may match before a final newline; identifiers must match in full.
  return typeof value === 'string' && pattern.exec(value)?.[0] === value;
}
function record(value, label) {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), `Invalid ${label}`);
}
function own(value, key) {
  // Evidence must be data, not inherited values or accessors with side effects.
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  requireValue(descriptor && Object.hasOwn(descriptor, 'value'), `Missing data field: ${key}`);
  return descriptor.value;
}

export function validatePreviewTag(tag, version) {
  requireValue(matches(/^[0-9]+\.[0-9]+\.[0-9]+$/, version), 'Invalid release version');
  requireValue(typeof tag === 'string' && tag.startsWith(`v${version}-preview.`), 'Invalid preview tag');
  const suffix = tag.slice(`v${version}-preview.`.length);
  requireValue(matches(/^[1-9][0-9]{0,3}$/, suffix), 'Invalid preview sequence');
  return tag;
}

export function assertActualBuild(report, { commit, configuration = 'Release' } = {}) {
  record(report, 'build report');
  requireValue(matches(COMMIT, commit), 'Invalid source commit');
  requireValue(configuration === 'Release', 'Preview requires Release configuration');
  requireValue(own(report, 'source_commit') === commit, 'Build/source commit mismatch');
  requireValue(own(report, 'configuration') === 'Release', 'Build is not Release');
  requireValue(own(report, 'evidence_kind') === 'actual', 'Build evidence is not actual');
  requireValue(own(report, 'state') === 'unsigned_ios_build_complete', 'Unsigned iOS build is incomplete');
  for (const key of ['passed', 'full_iOS_build', 'unsigned_product_present', 'packaged_privacy_manifests_verified', 'v1_profile_validated']) {
    requireValue(own(report, key) === true, `Build requirement not satisfied: ${key}`);
  }
  for (const key of ['preflight_only', 'signing_performed', 'device_test', 'source_dirty']) {
    requireValue(own(report, key) === false, `Build exclusion not satisfied: ${key}`);
  }
  return report;
}

export function assertDeviceExecutable(buffer) {
  // Inspect bytes directly: otool can exit successfully for a non-object file.
  // This is a bounded format/platform gate, not a signature or execution proof.
  requireValue(Buffer.isBuffer(buffer) && buffer.length >= 32 && buffer.length <= MAX_BYTES, 'Invalid executable buffer');
  requireValue(buffer.readUInt32LE(0) === 0xfeedfacf, 'Expected thin little-endian Mach-O 64');
  requireValue(buffer.readUInt32LE(4) === 0x0100000c, 'Expected arm64 executable');
  requireValue(buffer.readUInt32LE(12) === 2, 'Expected MH_EXECUTE executable');
  const count = buffer.readUInt32LE(16), size = buffer.readUInt32LE(20);
  requireValue(count > 0 && count <= 4096 && size <= 1024 * 1024 && size % 8 === 0 &&
    count <= Math.floor(size / 8) && size <= buffer.length - 32, 'Invalid Mach-O command bounds');
  const end = 32 + size;
  let offset = 32, buildVersions = 0;
  for (let index = 0; index < count; index++) {
    requireValue(end - offset >= 8, 'Truncated Mach-O command header');
    const command = buffer.readUInt32LE(offset), commandSize = buffer.readUInt32LE(offset + 4);
    requireValue(commandSize >= 8 && commandSize % 8 === 0 && commandSize <= end - offset, 'Invalid Mach-O command size');
    if (command === 0x32) { // LC_BUILD_VERSION
      requireValue(++buildVersions === 1 && commandSize >= 24, 'Invalid or duplicate build-version command');
      requireValue(buffer.readUInt32LE(offset + 8) === 2, 'Expected iOS device platform');
      const tools = buffer.readUInt32LE(offset + 20);
      requireValue(tools === (commandSize - 24) / 8, 'Invalid build-version tool bounds');
    }
    offset += commandSize;
  }
  requireValue(offset === end && buildVersions === 1, 'Incomplete Mach-O command table');
  return { architecture: 'arm64', platform: 'ios' };
}

export function auditBundleTree(appPath) {
  requireValue(typeof appPath === 'string' && path.isAbsolute(appPath) && appPath.endsWith('.app'), 'Expected an absolute .app directory');
  const root = lstatSync(appPath);
  requireValue(root.isDirectory() && !root.isSymbolicLink(), 'App root must be a real directory');
  const pending = [appPath];
  let files = 0, bytes = 0;
  while (pending.length) {
    const directory = pending.pop();
    for (const name of readdirSync(directory)) {
      const lower = name.toLowerCase();
      requireValue(!['.git', 'node_modules', '.ds_store', '_codesignature'].includes(lower) &&
        !lower.startsWith('.env') && !/\.(mobileprovision|p12|p8|pem|key|cer)$/.test(lower), 'Forbidden bundle entry');
      const entry = path.join(directory, name);
      const stat = lstatSync(entry);
      requireValue(!stat.isSymbolicLink(), 'Bundle symlinks are forbidden');
      if (stat.isDirectory()) pending.push(entry);
      else {
        requireValue(stat.isFile(), 'Bundle special files are forbidden');
        files += 1; bytes += stat.size;
        requireValue(files <= MAX_FILES, 'Bundle exceeds file limit');
        requireValue(Number.isSafeInteger(bytes) && bytes <= MAX_BYTES, 'Bundle exceeds byte limit');
      }
    }
  }
  return { files, bytes };
}

export function makePreviewInfo({ report, tag, version, commit, runURL, executableHashes, testSummary }) {
  validatePreviewTag(tag, version);
  assertActualBuild(report, { commit, configuration: 'Release' });
  requireValue(matches(RUN, runURL), 'Invalid official workflow run URL');
  record(executableHashes, 'executable hashes');
  const app = own(executableHashes, 'app'), extension = own(executableHashes, 'extension');
  requireValue(matches(HASH, app) && matches(HASH, extension), 'Invalid executable SHA-256');
  record(testSummary, 'source test summary');
  const counts = {};
  for (const key of ['tests', 'passed', 'failed', 'skipped', 'cancelled']) {
    const value = own(testSummary, key);
    requireValue(Number.isSafeInteger(value) && value >= 0, `Invalid test count: ${key}`);
    counts[key] = value;
  }
  requireValue(counts.passed > 0 && counts.tests === counts.passed && counts.failed === 0 && counts.skipped === 0 && counts.cancelled === 0, 'Source tests did not all pass');
  // Deliberate allowlist: never spread a report, caller metadata or process.env here.
  return {
    schema_version: 1,
    kind: 'unsigned-developer-preview',
    tag, version, source_commit: commit.toLowerCase(),
    configuration: 'Release',
    full_iOS_build: true,
    signing_performed: false,
    requires_personal_signing: true,
    device_test: false,
    vehicle_acceptance: false,
    app_store_approved: false,
    run_url: runURL,
    executable_sha256: { app: app.toLowerCase(), extension: extension.toLowerCase() },
    source_tests: counts
  };
}
