import test from 'node:test';
import assert from 'node:assert/strict';
import { createLyricsProvider } from '../lib/lyrics-provider.mjs';

const metadata = { title: 'Synthetic Song', artist: 'Test Artist', album: 'Fixtures', duration: 120 };
const item = (extra = {}) => ({ id: 1, trackName: metadata.title, artistName: metadata.artist, albumName: metadata.album,
  duration: 120, syncedLyrics: '[00:00.00]Synthetic line\n[00:03.00]Second fixture line', ...extra });
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers });

test('lookup uses only exact get endpoint and authored User-Agent; normalizes synchronized lyrics', async () => {
  const provider = createLyricsProvider({ fetchImpl: async (url, options) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://lrclib.net');
    assert.equal(parsed.pathname, '/api/get');
    assert.equal(parsed.searchParams.get('track_name'), metadata.title);
    assert.equal(parsed.searchParams.get('artist_name'), metadata.artist);
    assert.equal(parsed.searchParams.get('duration'), '120');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers['User-Agent'], 'CabinDirect/0.3 (optional user-initiated lyrics lookup)');
    assert.doesNotMatch(options.headers['User-Agent'], /https?:|github\.com|@/);
    return json(item());
  } });
  const result = await provider.lookup(metadata);
  assert.equal(result.status, 'synced');
  assert.deepEqual(result.lines, [{ time: 0, text: 'Synthetic line' }, { time: 3, text: 'Second fixture line' }]);
  assert.deepEqual(result.track, metadata);
  assert.equal(result.attribution.url, 'https://lrclib.net');
});
test('plain, instrumental, not-found states remain distinct and do not manufacture timings', async () => {
  for (const [payload, code, expected] of [[item({ syncedLyrics: null, plainLyrics: 'Only a fixture' }), 200, 'plain'],
    [item({ instrumental: true }), 200, 'instrumental'], [null, 404, 'not-found']]) {
    const provider = createLyricsProvider({ fetchImpl: async () => json(payload, code) });
    const result = await provider.lookup(metadata);
    assert.equal(result.status, expected);
    assert.deepEqual(result.lines, []);
  }
});
test('validation rejects malformed and excessive input without outbound traffic', async () => {
  let calls = 0;
  const provider = createLyricsProvider({ fetchImpl: async () => { calls++; return json(item()); } });
  for (const extra of [{ title: '' }, { title: 'x'.repeat(257) }, { artist: 'a\n' }, { duration: 3601 }, { duration: NaN }, { duration: '120' }]) {
    await assert.rejects(provider.lookup({ ...metadata, ...extra }), { statusCode: 400 });
  }
  await assert.rejects(provider.search(''), { statusCode: 400 });
  assert.equal(calls, 0);
});
test('inflight deduplication, cloned cache results, TTL and bounded eviction', async () => {
  let calls = 0;
  let clock = 0;
  const provider = createLyricsProvider({ now: () => clock, maxCacheEntries: 2, cacheTtlMs: 20,
    fetchImpl: async () => { calls++; await new Promise(resolve => setTimeout(resolve, 2)); return json(item()); } });
  const results = await Promise.all([provider.lookup(metadata), provider.lookup(metadata)]);
  assert.equal(calls, 1);
  results[0].lines[0].text = 'mutated';
  assert.equal((await provider.lookup(metadata)).lines[0].text, 'Synthetic line');
  for (const title of ['B', 'C']) await provider.lookup({ ...metadata, title });
  await provider.lookup(metadata);
  assert.equal(calls, 4);
  clock = 21;
  await provider.lookup(metadata);
  assert.equal(calls, 5);
});
test('404 is cached, failures are not cached and no automatic retry occurs', async () => {
  let calls = 0;
  const provider = createLyricsProvider({ fetchImpl: async () => { calls++; return json({}, 404); } });
  await provider.lookup(metadata); await provider.lookup(metadata);
  assert.equal(calls, 1);
  const failure = createLyricsProvider({ fetchImpl: async () => { calls++; return json({}, 503); } });
  await assert.rejects(failure.lookup(metadata), { statusCode: 502 });
  assert.equal(calls, 2);
});
test('429 Retry-After numeric and HTTP date cooldown blocks new requests without retry', async () => {
  for (const retryAfter of ['10', new Date(20000).toUTCString()]) {
    let clock = 1000;
    let calls = 0;
    const provider = createLyricsProvider({ now: () => clock, fetchImpl: async () => {
      calls++; return calls === 1 ? json({}, 429, { 'Retry-After': retryAfter }) : json(item());
    } });
    await assert.rejects(provider.lookup(metadata), { statusCode: 429 });
    await assert.rejects(provider.search('another'), { statusCode: 429 });
    assert.equal(calls, 1);
    clock = 21000;
    await provider.lookup(metadata);
    assert.equal(calls, 2);
  }
});
test('network error and abort timeout have safe typed errors', async () => {
  const provider = createLyricsProvider({ fetchImpl: async () => { throw new Error('private upstream detail'); } });
  await assert.rejects(provider.lookup(metadata), error => error.statusCode === 502 && !error.message.includes('private'));
  const timeout = createLyricsProvider({ timeoutMs: 5, fetchImpl: async (_, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('abort')), { once: true });
  }) });
  await assert.rejects(timeout.lookup(metadata), { statusCode: 504 });
});
test('body, line count, text length, timestamp and normalized byte limits', async () => {
  for (const syncedLyrics of [Array.from({ length: 401 }, (_, i) => `[00:01]row${i}`).join('\n'),
    `[00:01]${'x'.repeat(1001)}`, `[00:01]${'x'.repeat(221 * 1024)}`,
    '[offset:-999999999]\n[00:01]Beyond one day',
    Array.from({ length: 300 }, () => `[00:01]${'字'.repeat(300)}`).join('\n')]) {
    const provider = createLyricsProvider({ fetchImpl: async () => json(item({ syncedLyrics })) });
    await assert.rejects(provider.lookup(metadata), { statusCode: 502 });
  }
  const enormous = createLyricsProvider({ fetchImpl: async () => new Response('x'.repeat(257 * 1024)) });
  await assert.rejects(enormous.lookup(metadata), { statusCode: 502 });
  const malformed = createLyricsProvider({ fetchImpl: async () => json(item({ artistName: null })) });
  await assert.rejects(malformed.lookup(metadata), { statusCode: 502 });
});
test('search returns at most ten safe candidates and never chooses a candidate', async () => {
  const provider = createLyricsProvider({ fetchImpl: async url => {
    assert.equal(new URL(url).pathname, '/api/search');
    return json([item({ trackName: '' }), ...Array.from({ length: 15 }, (_, id) => item({ id }))]);
  } });
  const result = await provider.search('Synthetic');
  assert.equal(result.length, 10);
  assert.equal(result[0].hasSyncedLyrics, true);
  assert.equal(result[0].track.title, metadata.title);
  assert.equal(Object.hasOwn(result[0], 'syncedLyrics'), false);
});
