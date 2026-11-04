import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validatePreviewTag } from '../lib/preview-package.mjs';

const repoPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repository = 'citrus-13/cabin-direct-ios';
const endpoint = 'repos/' + repository;
const version = JSON.parse(fs.readFileSync(path.join(repoPath, 'package.json'), 'utf8')).version;
const tag = validatePreviewTag(process.env.CABIN_PREVIEW_TAG, version);
const commit = process.env.GITHUB_SHA;
function requireValue(value, message) { if (!value) throw new Error(message); }
function gh(args, allowNotFound = false, binary = false) {
  const result = spawnSync('gh', args, { cwd: repoPath, encoding: binary ? null : 'utf8',
    timeout: 120_000, maxBuffer: binary ? 64 * 1024 * 1024 : 4 * 1024 * 1024 });
  if (allowNotFound && result.status !== 0 && /HTTP 404/.test(String(result.stderr || ''))) return null;
  requireValue(result.status === 0 && !result.error, 'GitHub release operation failed; inspect existing state before retrying');
  return result.stdout;
}
const api = (route, ...args) => JSON.parse(gh(['api', endpoint + route, ...args]));
const releases = () => {
  const pages = api('/releases?per_page=100', '--paginate', '--slurp');
  requireValue(Array.isArray(pages) && pages.every(Array.isArray), 'Invalid draft-inclusive release listing');
  return pages.flat().filter(item => item.tag_name === tag);
};
function verifyTag() {
  const ref = api('/git/ref/tags/' + tag);
  requireValue(ref.ref === 'refs/tags/' + tag && ref.object?.type === 'commit' && ref.object.sha === commit,
    'Preview tag is not pinned to the verified source commit');
}
requireValue(process.env.GITHUB_REPOSITORY === repository && process.env.GITHUB_REF === 'refs/heads/codex/public-build' &&
  process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' && /^[a-f0-9]{40}$/.test(commit || ''), 'Unauthorized publication context');
const currentRepo = api('');
requireValue(currentRepo.private === false && currentRepo.default_branch === 'codex/public-build', 'Public default-branch repository required');
requireValue(releases().length === 0 &&
  gh(['api', endpoint + '/git/ref/tags/' + tag], true) === null, 'Tag/release already exists; never overwrite or clobber');
const out = process.env.CABIN_PREVIEW_OUT_DIR;
requireValue(typeof out === 'string' && path.isAbsolute(out), 'Explicit preview output required');
const names = ['CabinDirect-' + tag + '-unsigned.ipa', 'BUILD-INFO.json', 'SHA256SUMS.txt'];
const info = JSON.parse(fs.readFileSync(path.join(out, 'BUILD-INFO.json'), 'utf8'));
requireValue(info.kind === 'unsigned-developer-preview' && info.source_commit === commit &&
  info.tag === tag && info.configuration === 'Release' && info.full_iOS_build === true &&
  info.requires_personal_signing === true && info.signing_performed === false &&
  info.device_test === false && info.vehicle_acceptance === false && info.app_store_approved === false,
  'Preview metadata does not match publication context');
const files = new Map();
for (const name of names) {
  const file = path.join(out, name), stat = fs.lstatSync(file);
  requireValue(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= 64 * 1024 * 1024, 'Expected bounded regular asset');
  const bytes = fs.readFileSync(file);
  files.set(name, { size: bytes.length, sha: crypto.createHash('sha256').update(bytes).digest('hex') });
}
const checksumLines = fs.readFileSync(path.join(out, 'SHA256SUMS.txt'), 'utf8').trim().split('\n');
requireValue(checksumLines.length === 2, 'Expected checksums for exactly two release files');
for (const [index, name] of names.slice(0, 2).entries()) {
  requireValue(checksumLines[index] === files.get(name).sha + '  ' + name, 'Release checksum mismatch');
}
// Create-only reference: a concurrent/pre-existing tag fails instead of being moved.
api('/git/refs', '--method', 'POST', '-f', 'ref=refs/tags/' + tag, '-f', 'sha=' + commit);
verifyTag();
gh(['release', 'create', tag, ...names.map(name => path.join(out, name)), '--repo', repository,
  '--verify-tag', '--draft', '--prerelease', '--latest=false', '--target', commit,
  '--title', 'Cabin Direct ' + tag + ' — unsigned developer preview',
  '--notes-file', path.join(repoPath, 'docs/RELEASE_NOTES_PREVIEW.md')]);
const matches = releases();
requireValue(matches.length === 1 && Number.isSafeInteger(matches[0].id), 'Expected one authenticated draft');
const releaseID = matches[0].id;
function verifyRelease(release, draft) {
  requireValue(release.id === releaseID && release.tag_name === tag && release.target_commitish === commit &&
    release.draft === draft && release.prerelease === true && Array.isArray(release.assets) &&
    release.assets.length === names.length, 'Release metadata/assets do not match verified preview');
  for (const name of names) {
    const candidates = release.assets.filter(item => item.name === name);
    requireValue(candidates.length === 1, 'Unexpected release asset names');
    const asset = candidates[0], expected = files.get(name);
    requireValue(asset.state === 'uploaded' && asset.size === expected.size && Number.isSafeInteger(asset.id), 'Draft asset verification failed');
    if (typeof asset.digest === 'string' && asset.digest.length > 0) {
      requireValue(asset.digest === 'sha256:' + expected.sha, 'Remote asset digest mismatch');
    } else {
      const bytes = gh(['api', endpoint + '/releases/assets/' + asset.id, '-H', 'Accept: application/octet-stream'], false, true);
      requireValue(Buffer.isBuffer(bytes) && bytes.length === expected.size &&
        crypto.createHash('sha256').update(bytes).digest('hex') === expected.sha, 'Downloaded asset digest mismatch');
    }
  }
}
verifyRelease(api('/releases/' + releaseID), true);
verifyTag();
const beforePublish = api('');
requireValue(beforePublish.private === false && beforePublish.default_branch === 'codex/public-build', 'Repository state changed before publication');
gh(['release', 'edit', tag, '--repo', repository, '--draft=false', '--prerelease', '--latest=false']);
const published = api('/releases/' + releaseID);
verifyRelease(published, false);
verifyTag();
requireValue(published.html_url === 'https://github.com/' + repository + '/releases/tag/' + tag, 'Unexpected release URL');
console.log(published.html_url);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
  '## Published unsigned developer preview\n\n' + published.html_url + '\n\nSource: ' + info.source_commit +
  '\n\nRequires personal signing. No iPhone/vehicle acceptance or App Store approval.\n');
