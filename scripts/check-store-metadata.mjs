import fs from 'node:fs';
import { auditStoreMetadata } from '../lib/store-metadata.mjs';
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--require-submission-ready')) throw new Error('Unknown metadata-check argument');
const metadata = JSON.parse(fs.readFileSync(new URL('../docs/store/metadata.zh-Hans.json', import.meta.url), 'utf8'));
const version = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const result = auditStoreMetadata(metadata, version);
const notes = fs.readFileSync(new URL('../docs/store/REVIEW_NOTES.md', import.meta.url), 'utf8')
  .split('## Candidate Notes\n')[1]?.split('\n## Maintainer gate')[0]?.trim();
if (!notes || Buffer.byteLength(notes, 'utf8') > 4000) throw new Error('Reviewer Notes exceed 4000 bytes or are missing');
console.log(JSON.stringify({ ...result, review_notes_utf8_bytes: Buffer.byteLength(notes, 'utf8'),
  note: 'Draft limits and declarations only; no Apple account access, upload or approval.' }, null, 2));
if (args.includes('--require-submission-ready')) process.exitCode = 2;
