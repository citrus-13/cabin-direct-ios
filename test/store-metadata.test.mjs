import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {auditStoreMetadata} from '../lib/store-metadata.mjs';
const base = JSON.parse(readFileSync(new URL('../docs/store/metadata.zh-Hans.json', import.meta.url), 'utf8'));
const clone = () => structuredClone(base);
const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
test('store draft uses actual UI language, passes limits and preserves external blockers', () => {
  const result = auditStoreMetadata(base, version);
  assert.equal(result.draft_valid, true);
  assert.equal(result.submission_ready, false);
  assert.equal(result.app_store_submitted, false);
  assert.ok(result.declared_blockers.includes('real_replaykit_broadcast'));
  assert.ok(result.declared_blockers.includes('publisher.public_contact_email'));
  assert.ok(result.field_sizes.keywords_utf8_bytes <= 100);
  assert.equal(base.publisher.public_contact_email, null);
  assert.equal(base.age_rating, null);
  const project = readFileSync(new URL('../ios/project.yml', import.meta.url),'utf8');
  assert.equal((project.match(/CFBundleLocalizations: \[zh-Hans\]/g)||[]).length,2);
});
test('store checks Unicode characters separately from keyword UTF-8 bytes', () => {
  const valid = clone(); valid.listing.name = '名'.repeat(30);
  assert.equal(auditStoreMetadata(valid, version).field_sizes.name, 30);
  const longName = clone(); longName.listing.name = '名'.repeat(31);
  assert.throws(() => auditStoreMetadata(longName, version), /name/);
  const longKeywords = clone(); longKeywords.listing.keywords = '词'.repeat(34);
  assert.throws(() => auditStoreMetadata(longKeywords, version), /Keywords/);
});
test('metadata rejects overlong/misleading profiles, unsafe URLs and implicit evidence', () => {
  const mutate = [
    v => {v.version = '9.9.9';}, v => {v.status = 'approved';},
    v => {v.ui_languages.push('en-US');}, v => {v.listing.description = '<b>HTML</b>';},
    v => {v.listing.promotional_text = 'a'.repeat(171);},
    v => {v.submission_urls.support = 'https://user:password@example.com';},
    v => {v.submission_urls.privacy_policy = 'javascript:alert(1)';},
    v => {delete v.evidence.device_installation;},
    v => {v.evidence.simulator_equals_device = true;}
  ];
  for (const change of mutate) {const v = clone(); change(v); assert.throws(() => auditStoreMetadata(v, version));}
});
test('a source declaration cannot certify readiness, even when all evidence is asserted', () => {
  const v = clone();
  for (const key of Object.keys(v.evidence)) v.evidence[key] = true;
  Object.assign(v.publisher, {public_name:'SYNTHETIC TEST',public_contact_email:'test@example.com',review_contact:'SYNTHETIC'});
  Object.assign(v.submission_urls,{support:'https://example.com/support',privacy_policy:'https://example.com/privacy'});
  v.age_rating = 'SYNTHETIC'; v.pricing = 'SYNTHETIC';
  const result = auditStoreMetadata(v, version);
  assert.equal(result.declared_inputs_complete,true);
  assert.equal(result.submission_ready,false);
  assert.equal(result.requires_independent_review,true);
});
test('metadata CLI is read-only and the submission-required mode explicitly blocks', () => {
  const script = new URL('../scripts/check-store-metadata.mjs', import.meta.url);
  const normal = spawnSync(process.execPath,[script.pathname],{encoding:'utf8'});
  assert.equal(normal.status,0,normal.stderr);
  assert.equal(JSON.parse(normal.stdout).submission_ready,false);
  const strict = spawnSync(process.execPath,[script.pathname,'--require-submission-ready'],{encoding:'utf8'});
  assert.equal(strict.status,2);
  assert.equal(JSON.parse(strict.stdout).app_store_submitted,false);
});
