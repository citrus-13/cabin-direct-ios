import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createMusicFixtureServer, FIXTURE_BANNER, SCENARIOS } from '../scripts/serve-music-fixtures.mjs';

async function setup(t) {
  const fixture = createMusicFixtureServer({ now: () => 1_000_000 });
  const address = await fixture.listen();
  t.after(() => fixture.close());
  const get = (path, headers = {}) => fetch(address.origin + path, { headers });
  const post = (path, body, headers = {}) => fetch(address.origin + path, {
    method: 'POST', headers: { Origin: address.origin, 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const pair = async () => {
    const result = await post('/api/pair', { code: '123456' });
    assert.equal(result.status, 200);
    return result.headers.get('set-cookie').split(';')[0];
  };
  return { fixture, address, get, post, pair };
}

function rawRequest(origin, path, headers, method = 'GET') {
  return new Promise((resolve, reject) => {
    const request = http.request(origin + path, { headers, method }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() }));
    });
    request.on('error', reject);
    request.end();
  });
}

test('factory binds only random-port IPv4 loopback and serves byte-exact native source assets', async t => {
  const { fixture, address, get } = await setup(t);
  assert.equal(address.address, '127.0.0.1');
  assert.ok(address.port > 0);
  assert.equal(address.origin, `http://127.0.0.1:${address.port}`);
  for (const name of ['direct.js', 'direct.css', 'index.html']) {
    const source = readFileSync(new URL(`../ios/StandaloneWeb/${name}`, import.meta.url));
    assert.deepEqual(fixture.sourceAssets[name], { bytes: source.length, sha256: createHash('sha256').update(source).digest('hex') });
    if (name !== 'index.html') assert.deepEqual(Buffer.from(await (await get(`/${name}`)).arrayBuffer()), source);
  }
  const response = await get('/');
  const html = await response.text();
  assert.ok(html.includes(FIXTURE_BANNER));
  assert.match(html, /position:fixed/);
  assert.match(html, /id="fixtureForm" method="post"/);
  assert.match(html, /原创测试文字/);
  assert.match(html, /合成配对码：123456/);
  assert.equal(html.split('id="fixtureBanner"').length, 2);
  const original = readFileSync(new URL('../ios/StandaloneWeb/index.html', import.meta.url), 'utf8');
  const insertedEnd = html.indexOf('<script src="/__fixture/control.js" defer></script>') + '<script src="/__fixture/control.js" defer></script>'.length;
  assert.equal(html.slice(0, html.indexOf('<body>') + 6) + html.slice(insertedEnd), original, 'Only fixture markup is prepended inside body');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  const control = await (await get('/__fixture/control.js')).text();
  assert.match(control, /addEventListener\('submit'/);
  assert.match(control, /event.preventDefault\(\)/);
  assert.doesNotMatch(control, /location\s*=|innerHTML|\.reload\(/);
});

test('synthetic pairing is mandatory, wrong codes fail and unpair clears dummy credentials', async t => {
  const { get, post } = await setup(t);
  for (const path of ['/api/state', '/frame.jpg', '/stream.mjpeg']) assert.equal((await get(path)).status, 401);
  assert.equal((await post('/api/pair', { code: '000000' })).status, 403);
  assert.equal((await post('/api/pair', { code: 123456 })).status, 400);
  assert.equal((await post('/api/pair', { code: '123456', other: true })).status, 400);
  const paired = await post('/api/pair', { code: '123456' });
  const setCookie = paired.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  const headers = { Cookie: setCookie.split(';')[0] };
  assert.equal((await get('/api/state', headers)).status, 200);
  assert.equal((await post('/api/unpair', { unexpected: true }, headers)).status, 400);
  for (const path of ['/frame.jpg', '/stream.mjpeg']) {
    const response = await get(path, headers);
    assert.equal(response.status, 204);
    assert.equal(await response.text(), '');
  }
  const unpair = await post('/api/unpair', undefined, headers);
  assert.equal(unpair.status, 204);
  assert.match(unpair.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await get('/api/state', headers)).status, 401);
});

test('all allowlisted scenarios stay synthetic and audio-only; transitions need no receiver reload', async t => {
  const { get, post, pair } = await setup(t);
  const Cookie = await pair();
  for (const scenario of SCENARIOS) {
    const applied = await post('/__fixture/scenario', { scenario });
    assert.equal(applied.status, 200, scenario);
    const response = await get('/api/state', { Cookie });
    if (scenario === 'expired') { assert.equal(response.status, 410); continue; }
    assert.equal(response.status, 200, scenario);
    const state = await response.json();
    assert.equal(state.source, 'demo');
    assert.equal(state.frameUpdatedAt, 0);
    assert.equal(state.width, 0);
    assert.equal(state.height, 0);
    assert.deepEqual(state.lyricLines, []);
    assert.ok(state.message.includes(FIXTURE_BANNER));
    assert.match(state.music.message, /合成测试输入/);
    assert.equal(state.music.updatedAt, scenario === 'stale' ? 940 : 1000);
    if (['waiting', 'no-match', 'no-audio'].includes(scenario)) assert.equal(state.music.status, 'waiting');
    if (['matched', 'loading', 'no-lyrics', 'recognizing', 'unavailable'].includes(scenario)) assert.equal(state.music.status, scenario);
    if (['matched', 'loading', 'no-lyrics'].includes(scenario)) assert.deepEqual(state.music.lines, []);
    if (scenario === 'manual') assert.equal(state.music.source, 'manual');
    if (scenario === 'paused') assert.equal(state.captureState, 'paused');
    if (['paused', 'unavailable'].includes(scenario)) { assert.equal(state.music.title, ''); assert.equal(state.music.artist, ''); assert.deepEqual(state.music.lines, []); }
    if (scenario === 'lyrics') assert.deepEqual(state.music.lines, ['窗边的小灯画一圈暖光', '纸上的小船静静等天亮', '我们把今天折成一颗星', '留给明天慢慢欣赏']);
    if (scenario === 'hostile-text') { assert.match(state.music.title, /<img/); assert.match(state.music.lines[0], /<svg/); }
    if (scenario === 'long-text') { assert.ok(state.music.title.length > 200); assert.ok(state.music.lines.length > 24); assert.ok(state.music.lines[0].length > 200); }
  }
  const status = await (await get('/__fixture/status')).json();
  assert.equal(status.counts.scenarioChanges, SCENARIOS.length);
  assert.equal(status.simulated, true);
  assert.doesNotMatch(JSON.stringify(status), /123456|cabin_fixture|synthetic-local-only/);
  await post('/__fixture/scenario', { scenario: 'expired' });
  assert.equal((await post('/api/pair', { code: '123456' })).status, 410);
});

test('exact Host and Origin checks reject cross-origin, malformed and unsupported actions', async t => {
  const { address, get, post } = await setup(t);
  for (const Origin of ['http://evil.test', 'null', address.origin + '.evil.test', 'http://localhost:' + address.port]) {
    assert.equal((await post('/__fixture/scenario', { scenario: 'lyrics' }, { Origin })).status, 403);
    assert.equal((await post('/api/pair', { code: '123456' }, { Origin })).status, 403);
    assert.equal((await post('/api/unpair', undefined, { Origin })).status, 403);
  }
  assert.equal((await fetch(address.origin + '/__fixture/scenario', { method: 'POST' })).status, 403);
  for (const Host of ['evil.test', 'localhost:' + address.port, '127.0.0.1', '127.0.0.1:' + address.port + '.evil']) {
    assert.equal((await rawRequest(address.origin, '/', { Host })).status, 403);
  }
  assert.equal((await rawRequest(address.origin, '/', ['Host', `127.0.0.1:${address.port}`, 'Host', `127.0.0.1:${address.port}`])).status, 403);
  assert.equal((await get('/__fixture/scenario')).status, 405);
  assert.equal((await post('/__fixture/status', {})).status, 405);
  assert.equal((await post('/__fixture/scenario', { scenario: 'not-allowed' })).status, 400);
  assert.equal((await post('/__fixture/scenario', { scenario: 'lyrics', extra: true })).status, 400);
  assert.equal((await post('/__fixture/scenario', { scenario: 'lyrics', oversized: 'x'.repeat(4096) })).status, 413);
  const malformed = await fetch(address.origin + '/__fixture/scenario', { method: 'POST', headers: { Origin: address.origin, 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400);
  const unsupported = await fetch(address.origin + '/__fixture/scenario', { method: 'POST', headers: { Origin: address.origin, 'Content-Type': 'text/plain' }, body: 'scenario=lyrics' });
  assert.equal(unsupported.status, 415);
  const form = await fetch(address.origin + '/__fixture/scenario', { method: 'POST', headers: { Origin: address.origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'scenario=lyrics' });
  assert.equal(form.status, 200);
});

test('only exact routes are served; traversal, query and source paths never disclose files', async t => {
  const { address } = await setup(t);
  for (const path of ['/package.json', '/server.mjs', '/ios/StandaloneWeb/direct.js', '/..%2fpackage.json', '/%2e%2e/package.json', '/direct.js?path=package.json', '/__fixture/unknown', '//direct.js']) {
    const result = await rawRequest(address.origin, path, {});
    assert.equal(result.status, 404, path);
    assert.doesNotMatch(result.body, /tesla-companion-demo|dependencies|import |node:http/);
  }
});

test('CLI rejects bind overrides and prints metadata then shuts down on SIGTERM', { timeout: 5000 }, async t => {
  const script = new URL('../scripts/serve-music-fixtures.mjs', import.meta.url);
  const rejected = spawn(process.execPath, [script.pathname, '--host', '0.0.0.0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal((await once(rejected, 'exit'))[0], 1);
  const child = spawn(process.execPath, [script.pathname], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill('SIGTERM'); });
  let text = '';
  const line = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.stdout.on('data', chunk => { text += chunk; if (text.includes('\n')) resolve(text.split('\n')[0]); });
    child.once('exit', () => { if (!text.includes('\n')) reject(new Error('CLI exited without metadata')); });
  });
  const metadata = JSON.parse(line);
  assert.equal(metadata.address, '127.0.0.1');
  assert.equal(metadata.simulated, true);
  assert.equal(metadata.banner, FIXTURE_BANNER);
  assert.equal(Object.keys(metadata.sourceAssets).length, 3);
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  assert.equal((await exited)[0], 0);
});
