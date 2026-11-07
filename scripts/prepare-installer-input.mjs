import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertActualBuild, assertDeviceExecutable, auditBundleTree } from '../lib/preview-package.mjs';
import { installerInputEntitlements, assertUnsignedInput } from '../lib/installer-input.mjs';

// Identity-free metadata signatures ONLY. This is NOT Apple's Ad Hoc distribution.
// No account, Keychain identity lookup, provisioning, install, upload or overwrite.
const repo = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const contains = (base, value) => value === base || value.startsWith(base + path.sep);
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function requireValue(value) { if (!value) throw new Error('Installer-input precondition failed'); }
function externalDirectory(value) {
  requireValue(typeof value === 'string' && path.isAbsolute(value));
  const resolved = path.resolve(value);
  let ancestor = resolved;
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const actual = path.resolve(fs.realpathSync(ancestor), path.relative(ancestor, resolved));
  requireValue(!contains(repo, actual) && !contains(actual, repo) && actual !== os.homedir() && actual !== path.parse(actual).root);
  return actual;
}
function run(command, args, input) {
  const result = spawnSync(command, args, { cwd: repo, encoding: 'utf8', input, timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } });
  requireValue(!result.error && result.status === 0);
  return result;
}
const plist = file => JSON.parse(run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', file]).stdout);

try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: node scripts/prepare-installer-input.mjs --build-dir /verified-release-build --out /new-output');
    console.log('Copies a clean, verified public unsigned build; adds identity-free entitlement metadata. Does not install or use an Apple account.');
  } else {
    requireValue(process.platform === 'darwin' && args.length === 4 && args[0] === '--build-dir' && args[2] === '--out');
    const work = externalDirectory(args[1]), out = externalDirectory(args[3]);
    requireValue(!contains(work, out) && !contains(out, work) && !fs.existsSync(out));
    requireValue(run('git', ['status', '--porcelain']).stdout.trim() === '');
    const commit = run('git', ['rev-parse', 'HEAD']).stdout.trim();
    const reportFile = path.join(work, 'ios-build-report.json');
    requireValue(fs.statSync(reportFile).size <= 1024 * 1024);
    const build = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
    assertActualBuild(build, { commit, configuration: 'Release' });
    const source = path.join(work, 'DerivedData/Build/Products/Release-iphoneos/CabinDirect.app');
    const sourceExtension = path.join(source, 'PlugIns/DirectBroadcastExtension.appex');
    requireValue(build.artifacts?.unsigned_app === source && build.artifacts?.broadcast_extension === sourceExtension);
    auditBundleTree(source);
    requireValue(JSON.stringify(fs.readdirSync(path.join(source, 'PlugIns'))) === JSON.stringify(['DirectBroadcastExtension.appex']));
    const ai = plist(path.join(source, 'Info.plist')), ei = plist(path.join(sourceExtension, 'Info.plist'));
    const entitlements = installerInputEntitlements(ai, ei);
    const version = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).version;
    requireValue(ai.CFBundleShortVersionString === version && ei.CFBundleShortVersionString === version &&
      ai.CFBundleVersion === ei.CFBundleVersion && typeof ai.CFBundleVersion === 'string');
    const originals = [
      ['app', path.join(source, 'CabinDirect')],
      ['extension', path.join(sourceExtension, 'DirectBroadcastExtension')]
    ];
    const originalHashes = {};
    for (const [name, binary] of originals) {
      assertUnsignedInput(fs.readFileSync(binary));
      originalHashes[name] = hash(binary);
    }
    fs.mkdirSync(out, { recursive: true });
    const payload = path.join(out, 'staging/Payload'), app = path.join(payload, 'CabinDirect.app');
    fs.mkdirSync(payload, { recursive: true });
    fs.cpSync(source, app, { recursive: true, errorOnExist: true, force: false });
    const entitlementsFile = path.join(out, 'requested-entitlements.plist');
    const xml = run('/usr/bin/plutil', ['-convert', 'xml1', '-o', '-', '-'], JSON.stringify(entitlements)).stdout;
    fs.writeFileSync(entitlementsFile, xml, { flag: 'wx' });
    const metadataHashes = {};
    for (const [name, bundle, executable] of [
      ['extension', path.join(app, 'PlugIns/DirectBroadcastExtension.appex'), 'DirectBroadcastExtension'],
      ['app', app, 'CabinDirect']
    ]) {
      // Always "-", never a user-supplied signing identity. Work on copies only.
      run('/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', '--generate-entitlement-der', '--entitlements', entitlementsFile, bundle]);
      run('/usr/bin/codesign', ['--verify', '--strict', bundle]);
      const details = run('/usr/bin/codesign', ['--display', '--verbose=4', bundle]);
      requireValue(/Signature=adhoc/.test(details.stdout + details.stderr) && !/Authority=/.test(details.stdout + details.stderr));
      const extracted = run('/usr/bin/codesign', ['--display', '--entitlements', ':-', bundle]).stdout;
      const actual = JSON.parse(run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], extracted).stdout);
      requireValue(JSON.stringify(actual) === JSON.stringify(entitlements));
      requireValue(!fs.existsSync(path.join(bundle, 'embedded.mobileprovision')));
      const binary = path.join(bundle, executable);
      assertDeviceExecutable(fs.readFileSync(binary));
      metadataHashes[name] = hash(binary);
    }
    requireValue(originals.every(([name, binary]) => hash(binary) === originalHashes[name]));
    const ipaName = 'CabinDirect-' + commit.slice(0, 12) + '-adhoc-entitlement-input.ipa', ipa = path.join(out, ipaName);
    run('/usr/bin/ditto', ['-c', '-k', '--norsrc', '--noextattr', '--keepParent', payload, ipa]);
    const entries = run('/usr/bin/unzip', ['-Z1', ipa]).stdout.trim().split('\n');
    requireValue(entries.length > 2 && entries.every(value => value === 'Payload/' || value.startsWith('Payload/CabinDirect.app/')) &&
      !entries.some(value => value.split('/').includes('..') || value.includes('\\')));
    requireValue(fs.statSync(ipa).size > 0 && fs.statSync(ipa).size <= 64 * 1024 * 1024);
    const evidence = {
      schema_version: 1, kind: 'identity-free-adhoc-entitlement-input',
      source_commit: commit, actual_release_build: true, metadata_signatures_verified: true,
      requested_group_count: 1, original_unsigned_executables_unchanged: true,
      apple_account_used: false, apple_development_or_distribution_signed: false, profiles_present: false,
      directly_installable: false, re_signer_import_verified: false, device_test: false,
      renewal_test: false, vehicle_acceptance: false,
      original_executable_sha256: originalHashes, metadata_executable_sha256: metadataHashes,
      ipa: ipaName, ipa_sha256: hash(ipa)
    };
    fs.writeFileSync(path.join(out, 'INSTALLER-INPUT.json'), JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
    fs.writeFileSync(path.join(out, 'SHA256SUMS.txt'), [ipaName, 'INSTALLER-INPUT.json']
      .map(name => hash(path.join(out, name)) + '  ' + name).join('\n') + '\n', { flag: 'wx' });
    console.log(JSON.stringify(evidence, null, 2));
  }
} catch {
  // Do not echo local paths, account-shaped data or raw subprocess output.
  console.log(JSON.stringify({ kind: 'identity-free-adhoc-entitlement-input', state: 'preparation_failed', directly_installable: false }));
  process.exitCode = 1;
}
