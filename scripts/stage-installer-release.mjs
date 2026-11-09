import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertActualBuild } from '../lib/preview-package.mjs';
import { validateInstallerRelease } from '../lib/installer-release.mjs';

const repoPath = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const repository = 'citrus-13/cabin-direct-ios', apiRoot = 'repos/' + repository;
const commit = process.env.GITHUB_SHA, tag = process.env.CABIN_INSTALLER_TAG;
function requireValue(value) { if (!value) throw new Error('Installer release staging failed; inspect existing draft/tag before retrying'); }
function run(command, args, binary = false, allow404 = false) {
  const result = spawnSync(command, args, { cwd: repoPath, encoding: binary ? null : 'utf8',
    timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
  if (allow404 && result.status !== 0 && /HTTP 404/.test(String(result.stderr || ''))) return null;
  requireValue(!result.error && result.status === 0);
  return result.stdout;
}
const api = (suffix, ...args) => JSON.parse(run('gh', ['api', apiRoot + suffix, ...args]));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const whole = (pattern, value) => typeof value === 'string' && pattern.exec(value)?.[0] === value;
requireValue(process.env.GITHUB_REPOSITORY === repository && process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' &&
  process.env.GITHUB_REF === 'refs/heads/codex/public-build' && whole(/^[a-f0-9]{40}$/, commit) &&
  whole(/^[0-9]+$/, process.env.GITHUB_RUN_ID));
requireValue(run('git', ['rev-parse', 'HEAD']).trim() === commit && !run('git', ['status', '--porcelain']).trim());
const version = JSON.parse(fs.readFileSync(path.join(repoPath, 'package.json'), 'utf8')).version;
const runner = fs.realpathSync(process.env.RUNNER_TEMP);
const out = path.join(runner, 'cabin-installer-input'), work = fs.realpathSync(process.env.CABIN_IOS_WORK_DIR);
requireValue(work === path.join(runner, 'cabin-installer-build') && fs.realpathSync(out) === out &&
  fs.lstatSync(out).isDirectory() && !fs.lstatSync(out).isSymbolicLink());
const buildFile = path.join(work, 'ios-build-report.json');
requireValue(fs.statSync(buildFile).size < 1024 * 1024);
assertActualBuild(JSON.parse(fs.readFileSync(buildFile, 'utf8')), { commit, configuration: 'Release' });
const tapFile = path.join(runner, 'cabin-installer-tests.tap');
requireValue(fs.statSync(tapFile).size < 2 * 1024 * 1024);
const tap = fs.readFileSync(tapFile, 'utf8'), tests = {};
for (const label of ['tests', 'pass', 'fail', 'skipped', 'cancelled']) {
  const matches = [...tap.matchAll(new RegExp('^# ' + label + ' ([0-9]+)$', 'gm'))];
  requireValue(matches.length === 1); tests[label] = Number(matches[0][1]);
}
const infoFile = path.join(out, 'INSTALLER-INPUT.json');
requireValue(fs.statSync(infoFile).size < 16 * 1024);
const info = JSON.parse(fs.readFileSync(infoFile, 'utf8'));
const names = validateInstallerRelease(info, { commit, tag, version, tests });
const files = new Map();
for (const name of names) {
  const file = path.join(out, name), stat = fs.lstatSync(file);
  requireValue(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= 64 * 1024 * 1024);
  const bytes = fs.readFileSync(file);
  files.set(name, { size: bytes.length, sha256: hash(bytes) });
}
requireValue(files.get(info.ipa).sha256 === info.ipa_sha256);
const sums = fs.readFileSync(path.join(out, 'SHA256SUMS.txt'), 'utf8').trim().split('\n');
requireValue(sums.length === 2 && names.slice(0, 2).every((name, i) => sums[i] === files.get(name).sha256 + '  ' + name));
const currentRepo = api('');
requireValue(currentRepo.private === false && currentRepo.default_branch === 'codex/public-build');
const releases = api('/releases?per_page=100', '--paginate', '--slurp');
requireValue(Array.isArray(releases) && releases.every(Array.isArray) &&
  !releases.flat().some(item => item.tag_name === tag) &&
  run('gh', ['api', apiRoot + '/git/ref/tags/' + tag], false, true) === null);
// Create-only ref. Concurrent conflicts fail rather than moving existing tags.
api('/git/refs', '--method', 'POST', '-f', 'ref=refs/tags/' + tag, '-f', 'sha=' + commit);
function verifyTag() {
  const ref = api('/git/ref/tags/' + tag);
  requireValue(ref.ref === 'refs/tags/' + tag && ref.object?.type === 'commit' && ref.object.sha === commit);
}
verifyTag();
const notes = [
  '# Cabin Direct ' + tag + ' — requires personal signing',
  '',
  '包含独立歌词和投屏两个模式。打开 App 不自动开启麦克风或广播；歌词收音与识曲服务由你逐次确认。投屏中的识曲和 LRCLIB 歌词查询仍分别默认关闭。下载后仍需个人签名，不能直接点击安装。',
  '固定免费入口 https://citrus-13.github.io/cabin-direct-ios/ 可记住你确认的本地地址；地址变化需更新，新会话仍需配对。入口不发现手机、不转发媒体。',
  '投屏增加 H.264/AAC 共用媒体时钟、短缓存及断线恢复；浏览器起始静音，不兼容时回退无声画面。歌词模式不需要广播，也不转发麦克风音轨。真实 iPhone/Tesla 的音画延迟、后台和热稳定性仍待验证。',
  '免费签名账号的 Shazam App Service 权限、实际识曲及手机后台行为尚未核验；没有付费升级。歌词位置为估算，录音版本未核验。受保护视频不支持绕过，不保证可投屏。',
  '',
  'This is an arm64 iOS Release installer input with identity-free ad-hoc entitlement metadata.',
  'It is NOT Apple Ad Hoc distribution, an Apple-signed app, TestFlight or App Store distribution.',
  'No Apple account, certificate, provisioning profile or paid service is included.',
  'It has NOT been validated in a third-party installer or on a real iPhone. Capture, renewal and vehicle acceptance remain pending.',
  'A free signing workflow still requires its own device/account/pairing prerequisites and periodic renewal; no permanent free-signing promise.',
  '',
  'Source: ' + commit,
  'Build: https://github.com/' + repository + '/actions/runs/' + process.env.GITHUB_RUN_ID,
  'Source tests: ' + tests.pass + ' passed, 0 failed, 0 skipped.',
  'Exactly three assets: the IPA, INSTALLER-INPUT.json and SHA256SUMS.txt. Verify the metadata and hashes together.',
  'Earlier releases are preserved. This candidate requires independent maintainer download verification before publication.'
].join('\n');
// Retain the create response ID: a just-created draft may not yet appear in list results.
const created = api('/releases', '--method', 'POST', '-f', 'tag_name=' + tag,
  '-f', 'target_commitish=' + commit, '-F', 'draft=true', '-F', 'prerelease=true',
  '-f', 'make_latest=false', '-f', 'name=Cabin Direct ' + tag + ' — personal signing required', '-f', 'body=' + notes);
requireValue(Number.isSafeInteger(created.id) && created.id > 0 && created.tag_name === tag &&
  created.target_commitish === commit && created.draft === true && created.prerelease === true &&
  Array.isArray(created.assets) && created.assets.length === 0);
for (const name of names) {
  // An absolute upload URL avoids gh's REST-prefix rewriting of custom hosts.
  const uploaded = JSON.parse(run('gh', ['api', '--hostname', 'github.com',
    'https://uploads.github.com/' + apiRoot + '/releases/' + created.id + '/assets?name=' + encodeURIComponent(name), '--method', 'POST',
    '-H', 'Content-Type: application/octet-stream', '--input', path.join(out, name)]));
  requireValue(Number.isSafeInteger(uploaded.id) && uploaded.id > 0 && uploaded.name === name &&
    uploaded.state === 'uploaded' && uploaded.size === files.get(name).size);
}
const draft = api('/releases/' + created.id);
requireValue(draft.id === created.id && draft.tag_name === tag && draft.target_commitish === commit && draft.draft === true &&
  draft.prerelease === true && draft.assets.length === names.length);
for (const name of names) {
  const assets = draft.assets.filter(item => item.name === name), expected = files.get(name);
  requireValue(assets.length === 1 && assets[0].state === 'uploaded' && assets[0].size === expected.size &&
    Number.isSafeInteger(assets[0].id));
  if (assets[0].digest) requireValue(assets[0].digest === 'sha256:' + expected.sha256);
  else {
    const bytes = run('gh', ['api', apiRoot + '/releases/assets/' + assets[0].id, '-H', 'Accept: application/octet-stream'], true);
    requireValue(bytes.length === expected.size && hash(bytes) === expected.sha256);
  }
}
verifyTag();
console.log(JSON.stringify({ tag, release_id: draft.id, source_commit: commit, draft: true, prerelease: true,
  directly_installable: false, maintainer_download_review_required: true, source_tests: tests,
  assets: names.map(name => ({ name, ...files.get(name) })) }, null, 2));
// Deliberately no release-edit/publish step. Parent verifies downloaded bytes first.
