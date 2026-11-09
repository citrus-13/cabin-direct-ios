import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validatePreviewTag, assertActualBuild, assertDeviceExecutable, auditBundleTree, makePreviewInfo } from '../lib/preview-package.mjs';

const repo = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const contains = (base, value) => value === base || value.startsWith(base + path.sep);
function requireValue(value, message) { if (!value) throw new Error(message); }
function externalDirectory(value) {
  requireValue(typeof value === 'string' && path.isAbsolute(value), 'An explicit absolute external directory is required');
  const resolved = path.resolve(value);
  let ancestor = resolved;
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const actual = path.resolve(fs.realpathSync(ancestor), path.relative(ancestor, resolved));
  requireValue(!contains(repo, actual) && !contains(actual, repo) && actual !== os.homedir() && actual !== path.parse(actual).root,
    'Preview paths must be dedicated external directories');
  return actual;
}
function run(command, args, acceptable = [0]) {
  const result = spawnSync(command, args, { cwd: repo, encoding: 'utf8', timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } });
  requireValue(!result.error && acceptable.includes(result.status), `${path.basename(command)} verification failed`);
  return result;
}
function plist(file) { return JSON.parse(run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', file]).stdout); }
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
requireValue(process.platform === 'darwin', 'Preview packaging requires macOS');
const version = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).version;
const tag = validatePreviewTag(process.env.CABIN_PREVIEW_TAG, version);
const work = externalDirectory(process.env.CABIN_IOS_WORK_DIR);
const out = externalDirectory(process.env.CABIN_PREVIEW_OUT_DIR);
requireValue(!contains(work, out) && !contains(out, work), 'Preview output and build work must be separate directories');
requireValue(run('git', ['status', '--porcelain']).stdout.trim() === '', 'Refusing to package an uncommitted worktree');
const commit = run('git', ['rev-parse', 'HEAD']).stdout.trim();
requireValue(commit === process.env.GITHUB_SHA, 'Workflow/source commit mismatch');
const report = JSON.parse(fs.readFileSync(path.join(work, 'ios-build-report.json'), 'utf8'));
assertActualBuild(report, { commit, configuration: 'Release' });
const app = path.join(work, 'DerivedData/Build/Products/Release-iphoneos/CabinDirect.app');
const extension = path.join(app, 'PlugIns/DirectBroadcastExtension.appex');
requireValue(report.artifacts?.unsigned_app === app && report.artifacts?.broadcast_extension === extension, 'Unexpected report product paths');
const audit = auditBundleTree(app);
requireValue(JSON.stringify(fs.readdirSync(path.join(app, 'PlugIns')).sort()) === JSON.stringify(['DirectBroadcastExtension.appex']), 'Unexpected app extension');
const appInfo = plist(path.join(app, 'Info.plist')), extensionInfo = plist(path.join(extension, 'Info.plist'));
requireValue(appInfo.CFBundleExecutable === 'CabinDirect' && extensionInfo.CFBundleExecutable === 'DirectBroadcastExtension', 'Unexpected executable names');
requireValue(appInfo.CFBundleShortVersionString === version && extensionInfo.CFBundleShortVersionString === version, 'Product version mismatch');
requireValue(typeof appInfo.CFBundleIdentifier === 'string' && /^[a-zA-Z0-9.-]+$/.test(appInfo.CFBundleIdentifier) &&
  extensionInfo.CFBundleIdentifier === appInfo.CFBundleIdentifier + '.broadcast' &&
  appInfo.TCBroadcastExtensionIdentifier === extensionInfo.CFBundleIdentifier, 'Product bundle identifiers do not agree');
const executableHashes = {};
for (const [name, bundle, executable] of [['app', app, 'CabinDirect'], ['extension', extension, 'DirectBroadcastExtension']]) {
  const binary = path.join(bundle, executable);
  assertDeviceExecutable(fs.readFileSync(binary));
  run('/usr/bin/otool', ['-hv', binary]);
  const libraries = run('/usr/bin/otool', ['-L', binary]).stdout;
  requireValue(!/WebRTC/.test(libraries) && (name === 'app' || !/TeslaBLE|CoreBluetooth/.test(libraries)),
    'Unapproved dependency or vehicle protocol leaked into broadcast extension');
  const signature = run('/usr/bin/codesign', ['--display', '--verbose=4', bundle], [0, 1]);
  const details = signature.stdout + signature.stderr;
  requireValue(!/Authority=/.test(details) && (signature.status === 1 ? /not signed at all/.test(details) : /Signature=adhoc/.test(details)),
    'Preview must not contain a personal/distribution signing identity');
  executableHashes[name] = hash(binary);
}
const logFile = process.env.CABIN_PREVIEW_TEST_LOG;
requireValue(typeof logFile === 'string' && path.isAbsolute(logFile) && fs.statSync(logFile).size < 2 * 1024 * 1024, 'Missing bounded source-test log');
const tap = fs.readFileSync(logFile, 'utf8');
const testSummary = {};
for (const [key, label] of [['tests', 'tests'], ['passed', 'pass'], ['failed', 'fail'], ['skipped', 'skipped'], ['cancelled', 'cancelled']]) {
  const matches = [...tap.matchAll(new RegExp('^# ' + label + ' ([0-9]+)' + String.fromCharCode(13) + '?$', 'gm'))];
  requireValue(matches.length === 1, 'Ambiguous source-test totals');
  testSummary[key] = Number(matches[0][1]);
}
const info = makePreviewInfo({ report, tag, version, commit, executableHashes, testSummary,
  runURL: `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` });
fs.mkdirSync(out, { recursive: true });
requireValue(fs.readdirSync(out).length === 0, 'Preview directory must be empty; existing outputs are never overwritten');
const payload = path.join(out, 'staging/Payload');
fs.mkdirSync(payload, { recursive: true });
fs.cpSync(app, path.join(payload, 'CabinDirect.app'), { recursive: true, errorOnExist: true, force: false });
const ipaName = `CabinDirect-${tag}-unsigned.ipa`, ipa = path.join(out, ipaName);
run('/usr/bin/ditto', ['-c', '-k', '--norsrc', '--noextattr', '--keepParent', payload, ipa]);
const entries = run('/usr/bin/unzip', ['-Z1', ipa]).stdout.trim().split('\n');
requireValue(entries.length > 2 && entries.every(value => value === 'Payload/' || value.startsWith('Payload/CabinDirect.app/')) &&
  !entries.some(value => value.split('/').includes('..') || value.includes('\\')), 'Unexpected IPA archive layout');
requireValue(fs.statSync(ipa).size > 0 && fs.statSync(ipa).size <= 64 * 1024 * 1024, 'Unexpected IPA size');
fs.writeFileSync(path.join(out, 'BUILD-INFO.json'), JSON.stringify(info, null, 2) + '\n', { flag: 'wx' });
const sums = [ipaName, 'BUILD-INFO.json'].map(name => `${hash(path.join(out, name))}  ${name}`).join('\n') + '\n';
fs.writeFileSync(path.join(out, 'SHA256SUMS.txt'), sums, { flag: 'wx' });
console.log(JSON.stringify({ tag, ipa: ipaName, bundle_files: audit.files, bundle_bytes: audit.bytes,
  source_commit: commit, requires_personal_signing: true, source_tests: testSummary }, null, 2));
