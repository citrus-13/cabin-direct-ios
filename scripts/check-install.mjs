import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkInstallReadiness } from '../lib/install-readiness.mjs';
import { assertDeviceExecutable } from '../lib/preview-package.mjs';

// Read-only inspection of ONE explicit local .app. No IPA extraction, signing,
// keychain query, pairing discovery, account login, network request or file write.
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') {
  console.log('Usage: node scripts/check-install.mjs --app /absolute/path/CabinDirect.app\nRead-only macOS signing-consistency check. It does not install, renew or establish device acceptance.');
  process.exit(0);
}
function requireValue(ok) { if (!ok) throw new Error('inspection_failed'); }
function run(command, args, input) {
  const result = spawnSync(command, args, { input, encoding: 'utf8', timeout: 15_000,
    maxBuffer: 4 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } });
  requireValue(!result.error && result.status === 0);
  return result.stdout;
}
function bounded(file, maximum) {
  const stat = fs.lstatSync(file);
  requireValue(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= maximum);
  return fs.readFileSync(file);
}
function realDirectory(directory) {
  const stat = fs.lstatSync(directory);
  requireValue(stat.isDirectory() && !stat.isSymbolicLink());
}
function jsonPlist(bytes) {
  return JSON.parse(run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], bytes));
}
function profileField(xml, name, format = 'json') {
  const value = run('/usr/bin/plutil', ['-extract', name, format, '-o', '-', '-'], xml);
  return format === 'json' ? JSON.parse(value) : value.trim();
}
function inspect(bundle, executable) {
  const info = jsonPlist(bounded(path.join(bundle, 'Info.plist'), 1024 * 1024));
  requireValue(info.CFBundleExecutable === executable);
  assertDeviceExecutable(bounded(path.join(bundle, executable), 64 * 1024 * 1024));
  run('/usr/bin/codesign', ['--verify', '--strict', bundle]);
  const signedEntitlements = jsonPlist(run('/usr/bin/codesign', ['--display', '--entitlements', ':-', bundle]));
  const profileFile = path.join(bundle, 'embedded.mobileprovision');
  bounded(profileFile, 1024 * 1024);
  const xml = run('/usr/bin/security', ['cms', '-D', '-i', profileFile]);
  const devices = profileField(xml, 'ProvisionedDevices');
  requireValue(Array.isArray(devices) && devices.length <= 1000 && devices.every(value => typeof value === 'string'));
  return { info, signedEntitlements, signatureVerified: true, deviceExecutableVerified: true,
    profile: {
      entitlements: profileField(xml, 'Entitlements'),
      teamIdentifiers: profileField(xml, 'TeamIdentifier'),
      appIdentifierPrefixes: profileField(xml, 'ApplicationIdentifierPrefix'),
      creationDate: profileField(xml, 'CreationDate', 'raw'),
      expirationDate: profileField(xml, 'ExpirationDate', 'raw'),
      deviceCount: devices.length
    }
  };
}
try {
  requireValue(process.platform === 'darwin' && args.length === 2 && args[0] === '--app' &&
    path.isAbsolute(args[1]) && path.basename(args[1]) === 'CabinDirect.app');
  realDirectory(args[1]);
  const app = fs.realpathSync(args[1]);
  const plugins = path.join(app, 'PlugIns');
  realDirectory(plugins);
  requireValue(JSON.stringify(fs.readdirSync(plugins)) === JSON.stringify(['DirectBroadcastExtension.appex']));
  const extension = path.join(plugins, 'DirectBroadcastExtension.appex');
  realDirectory(extension);
  const result = checkInstallReadiness({ app: inspect(app, 'CabinDirect'),
    extension: inspect(extension, 'DirectBroadcastExtension') });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.passed ? 0 : 1;
} catch {
  // Tool stderr, file paths, account/certificate data and profile/device IDs stay private.
  console.log(JSON.stringify({ schema_version: 1, kind: 'local-development-signing-consistency',
    passed: false, state: 'inspection_incomplete',
    failures: ['expected_readable_signed_development_app_with_embedded_extension_and_profiles'],
    installation_performed: false, device_test: false, vehicle_acceptance: false, renewal_test: false }, null, 2));
  process.exitCode = 1;
}
