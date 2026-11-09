import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {assertActualBuild} from '../lib/preview-package.mjs';
import {SCREENSHOT_NAMES, validateScreenshotPNG} from '../lib/simulator-store-prep.mjs';

const repo = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const repository = 'citrus-13/cabin-direct-ios', apiRoot = 'repos/' + repository;
const commit = process.env.GITHUB_SHA, runID = process.env.GITHUB_RUN_ID;
function requireValue(value, message) {if (!value) throw new Error(message);}
function run(command, args, encoding = 'utf8', allow404 = false) {
  const result = spawnSync(command, args, {cwd:repo,encoding,timeout:120_000,maxBuffer:64*1024*1024});
  if (allow404 && result.status !== 0 && /HTTP 404/.test(String(result.stderr))) return null;
  requireValue(result.status === 0 && !result.error, 'Evidence operation failed; inspect existing draft/tag before retrying');
  return result.stdout;
}
const api = (suffix, ...args) => JSON.parse(run('gh',['api',apiRoot+suffix,...args]));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
requireValue(process.env.GITHUB_REPOSITORY === repository && process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' &&
  process.env.GITHUB_REF === 'refs/heads/codex/public-build' && /^[a-f0-9]{40}$/.test(commit || '') &&
  /^[0-9]+$/.test(runID || ''), 'Official manual/default-branch context required');
requireValue(run('git',['rev-parse','HEAD']).trim() === commit && !run('git',['status','--porcelain']).trim(), 'Exact clean source required');
const remoteRepo = api('');
requireValue(remoteRepo.private === false && remoteRepo.default_branch === 'codex/public-build', 'Public repository required');
const tag = 'store-prep-' + runID;
const pages = api('/releases?per_page=100','--paginate','--slurp');
requireValue(Array.isArray(pages) && pages.every(Array.isArray) &&
  !pages.flat().some(item => item.tag_name === tag) &&
  run('gh',['api',apiRoot+'/git/ref/tags/'+tag],'utf8',true) === null, 'Existing evidence is never overwritten');
const build = JSON.parse(fs.readFileSync(path.join(process.env.CABIN_IOS_WORK_DIR,'ios-build-report.json'),'utf8'));
assertActualBuild(build,{commit,configuration:'Release'});
const tap = fs.readFileSync(process.env.CABIN_STORE_TEST_LOG,'utf8');
requireValue(Buffer.byteLength(tap) < 2*1024*1024, 'Bounded test evidence required');
const totals = {};
for (const name of ['tests','pass','fail','skipped','cancelled']) {
  const matches = tap.split(/\r?\n/).filter(line => line.startsWith('# '+name+' '));
  requireValue(matches.length === 1 && /^# [a-z]+ [0-9]+$/.test(matches[0]), 'Ambiguous source test evidence');
  totals[name] = Number(matches[0].split(' ').at(-1));
}
requireValue(totals.tests > 0 && totals.tests === totals.pass && totals.fail === 0 && totals.skipped === 0 && totals.cancelled === 0,
  'All source tests must pass without skips');
const out = process.env.CABIN_SIM_OUT_DIR, staging = process.env.CABIN_SIM_RELEASE_DIR;
for (const directory of [out, staging]) requireValue(typeof directory === 'string' && path.isAbsolute(directory) &&
  directory === path.join(fs.realpathSync(process.env.RUNNER_TEMP),path.basename(directory)) &&
  directory !== fs.realpathSync(process.env.RUNNER_TEMP), 'Dedicated runner-temporary directory required');
requireValue(staging === path.join(fs.realpathSync(process.env.RUNNER_TEMP),'cabin-store-release') &&
  staging !== out && !fs.existsSync(staging), 'Release staging must be new and empty');
const names = [...SCREENSHOT_NAMES.map(name => name+'.png'),'simulator-report.json'].sort();
requireValue(JSON.stringify(fs.readdirSync(out).sort()) === JSON.stringify(names), 'Only curated simulator evidence may be packaged');
for (const name of names) {
  const stat = fs.lstatSync(path.join(out,name));
  requireValue(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= 20*1024*1024, 'Bounded regular evidence required');
}
const report = JSON.parse(fs.readFileSync(path.join(out,'simulator-report.json'),'utf8'));
function exactKeys(value, keys) {
  requireValue(value && typeof value === 'object' && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify(keys.toSorted()), 'Unexpected report fields; refuse private/raw metadata');
}
exactKeys(report,['schema_version','evidence_kind','kind','state','passed','source_commit','workflow_url','configuration',
  'simulator_only','physical_iphone_test','vehicle_test','capture_test','personal_signing','distribution_signing',
  'simulator_adhoc_signing','app_store_approved','simulator','tests','screenshots','owned_simulator_deleted','phases']);
requireValue(report.schema_version === 1,'Unsupported simulator evidence schema');
exactKeys(report.simulator,['model','runtime','os_version']);
requireValue(['iPhone 17 Pro Max','iPhone 18 Pro Max'].includes(report.simulator.model) &&
  /^com\.apple\.CoreSimulator\.SimRuntime\.iOS-[0-9-]+$/.test(report.simulator.runtime) &&
  /^[0-9]+(\.[0-9]+){0,2}$/.test(report.simulator.os_version),'Unexpected simulator metadata');
exactKeys(report.tests,['tests','passed','failed','skipped','expected_failures']);
requireValue(Array.isArray(report.phases) && report.phases.length > 0 && report.phases.length <= 40,'Bounded phase metadata required');
for(const phase of report.phases) {
  exactKeys(phase,['name','passed','exit_code','timed_out']);
  requireValue(typeof phase.name === 'string' && /^[a-z0-9-]{1,100}$/.test(phase.name) &&
    phase.passed === true && phase.exit_code === 0 && phase.timed_out === false,'Only successful bounded phase metadata accepted');
}
requireValue(report.evidence_kind === 'actual' && report.kind === 'simulator-store-preparation' && report.passed === true &&
  report.state === 'simulator_ui_tests_complete' && report.source_commit === commit && report.configuration === 'Release' &&
  report.workflow_url === 'https://github.com/'+repository+'/actions/runs/'+runID && report.simulator_only === true &&
  report.owned_simulator_deleted === true && report.simulator_adhoc_signing === true, 'Actual simulator result required');
for (const key of ['physical_iphone_test','vehicle_test','capture_test','app_store_approved','personal_signing','distribution_signing'])
  requireValue(report[key] === false,'Simulator evidence cannot claim hardware/capture/distribution success');
requireValue(report.tests?.tests === 4 && report.tests.passed === 4 && report.tests.failed === 0 &&
  report.tests.skipped === 0 && report.tests.expected_failures === 0 && report.screenshots?.length === SCREENSHOT_NAMES.length,
  'Complete real UI tests/screenshots required');
for (const name of SCREENSHOT_NAMES) {
  const images = report.screenshots.filter(item => item.name === name && item.file === name+'.png');
  requireValue(images.length === 1,'Expected unique screenshot');
  exactKeys(images[0],['name','file','sha256','width','height','has_alpha','lossless_opaque_alpha_normalized']);
  requireValue(typeof images[0].lossless_opaque_alpha_normalized === 'boolean','Explicit screenshot encoding provenance required');
  const bytes = fs.readFileSync(path.join(out,name+'.png')), decoded = validateScreenshotPNG(bytes);
  requireValue(images[0].sha256 === sha(bytes) && images[0].width === decoded.width &&
    images[0].height === decoded.height && images[0].has_alpha === false,'Screenshot verification failed');
}
fs.mkdirSync(staging);
const zipName = 'CabinDirect-'+tag+'-simulator-evidence.zip';
run('/usr/bin/ditto',['-c','-k','--norsrc','--noextattr',out,path.join(staging,zipName)]);
const archiveNames = run('/usr/bin/unzip',['-Z1',path.join(staging,zipName)]).trim().split('\n').sort();
requireValue(JSON.stringify(archiveNames) === JSON.stringify(names),'Unexpected archive layout');
requireValue(fs.statSync(path.join(staging,zipName)).size < 64*1024*1024,'Evidence archive too large');
fs.copyFileSync(path.join(out,'simulator-report.json'),path.join(staging,'simulator-report.json'),fs.constants.COPYFILE_EXCL);
const assetNames = [zipName,'simulator-report.json','SHA256SUMS.txt'];
const hashes = new Map(assetNames.slice(0,2).map(name => [name,sha(fs.readFileSync(path.join(staging,name)))]));
fs.writeFileSync(path.join(staging,'SHA256SUMS.txt'),[...hashes].map(([name,digest])=>digest+'  '+name).join('\n')+'\n',{flag:'wx'});
hashes.set('SHA256SUMS.txt',sha(fs.readFileSync(path.join(staging,'SHA256SUMS.txt'))));
api('/git/refs','--method','POST','-f','ref=refs/tags/'+tag,'-f','sha='+commit);
const ref = api('/git/ref/tags/'+tag);
requireValue(ref.ref === 'refs/tags/'+tag && ref.object?.type === 'commit' && ref.object.sha === commit,'Exact evidence tag required');
run('gh',['release','create',tag,...assetNames.map(name=>path.join(staging,name)),'--repo',repository,
  '--verify-tag','--draft','--prerelease','--latest=false','--target',commit,'--title','Cabin Direct simulator store-preparation evidence',
  '--notes','Simulator-only developer evidence; not physical iPhone, ReplayKit capture, vehicle acceptance or an installable app. Awaiting maintainer visual review; do not submit to App Store.']);
const drafts = api('/releases?per_page=100','--paginate','--slurp').flat().filter(item=>item.tag_name===tag);
requireValue(drafts.length===1 && Number.isSafeInteger(drafts[0].id),'One authenticated draft required');
const draft = api('/releases/'+drafts[0].id);
requireValue(draft.id===drafts[0].id && draft.tag_name===tag && draft.draft===true && draft.prerelease===true && draft.target_commitish===commit &&
  draft.assets.length===assetNames.length,'Draft integrity failed');
for(const name of assetNames) {
  const asset = draft.assets.find(item=>item.name===name), file=path.join(staging,name);
  requireValue(asset?.state==='uploaded' && asset.size===fs.statSync(file).size,'Uploaded draft asset missing');
  if(asset.digest) requireValue(asset.digest==='sha256:'+hashes.get(name),'Remote draft digest mismatch');
  else {
    const bytes=run('gh',['api',apiRoot+'/releases/assets/'+asset.id,'-H','Accept: application/octet-stream'],null);
    requireValue(bytes.length===asset.size && sha(bytes)===hashes.get(name),'Downloaded draft digest mismatch');
  }
}
const receipt={tag,release_id:draft.id,source_commit:commit,draft:true,prerelease:true,simulator_only:true,
  assets:assetNames.map(name=>({name,sha256:hashes.get(name)})),source_tests:totals,
  maintainer_visual_review_required:true,app_store_submitted:false};
console.log(JSON.stringify(receipt,null,2));
if(process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
  '## Simulator evidence preserved as draft\n\nTag: '+tag+'\n\nSource: '+commit+
  '\n\nRequires maintainer download/visual review. Not hardware/capture/vehicle acceptance; no App Store submission.\n');
