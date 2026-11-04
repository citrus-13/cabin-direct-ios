import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import WebSocket from 'ws';
import { createApp, validateIceServers } from '../server.mjs';

async function fixture(t, options = {}) {
  const publicDir = await mkdtemp(join(tmpdir(), 'tesla-demo-test-'));
  await writeFile(join(publicDir, 'index.html'), '<!doctype html><title>Fixture</title>');
  await writeFile(join(publicDir, 'fixture.js'), 'export const ok = true;');
  const app = createApp({ publicDir, ...options });
  const address = await app.listen(0);
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => { await app.close(); await rm(publicDir, { recursive: true, force: true }); });
  return { app, base, async room() {
    const response = await fetch(`${base}/api/rooms`, { method: 'POST' });
    assert.equal(response.status, 201);
    return response.json();
  } };
}

function client(base, room, role, overrides = {}) {
  const token = overrides.token ?? room[`${role}Token`];
  const url = `${base.replace('http:', 'ws:')}/signal?room=${room.roomId}&role=${role}&token=${encodeURIComponent(token)}`;
  const ws = new WebSocket(url, overrides.origin ? { origin: overrides.origin } : undefined);
  const queued = [];
  const waiting = [];
  ws.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    const index = waiting.findIndex((waiter) => waiter.type === message.type);
    if (index >= 0) {
      const [waiter] = waiting.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    } else queued.push(message);
  });
  ws.on('error', () => {});
  return {
    ws,
    message(type) {
      const index = queued.findIndex((message) => message.type === type);
      if (index >= 0) return Promise.resolve(queued.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { type, resolve, timer: setTimeout(() => {
          const i = waiting.indexOf(waiter);
          if (i >= 0) waiting.splice(i, 1);
          reject(new Error(`Timed out waiting for ${type}`));
        }, 1500) };
        waiting.push(waiter);
      });
    },
    send(value) { ws.send(JSON.stringify(value)); },
  };
}

function rejection(base, room, role, overrides) {
  const c = client(base, room, role, overrides);
  return new Promise((resolve, reject) => {
    c.ws.once('unexpected-response', (request, response) => {
      const status = response.statusCode;
      response.resume();
      request.destroy();
      resolve(status);
    });
    c.ws.once('open', () => { c.ws.terminate(); reject(new Error('Unexpected accepted socket')); });
  });
}

test('serves secure static routes and default local-only ICE configuration', async (t) => {
  const { base } = await fixture(t);
  for (const path of ['/', '/sender', '/receiver']) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Fixture/);
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  }
  assert.deepEqual(await (await fetch(`${base}/api/config`)).json(), { iceServers: [] });
  assert.equal((await (await fetch(`${base}/api/health`)).json()).ok, true);
  assert.equal((await fetch(`${base}/server.mjs`)).status, 404);
  assert.equal((await fetch(`${base}/fixture.js`)).headers.get('content-type'), 'text/javascript; charset=utf-8');
});

test('creates strong separate role tokens and expiry without reflecting them elsewhere', async (t) => {
  const f = await fixture(t);
  const room = await f.room();
  assert.match(room.roomId, /^\d{6}$/);
  assert.match(room.publisherToken, /^[A-Za-z0-9_-]{43}$/);
  assert.match(room.viewerToken, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(room.publisherToken, room.viewerToken);
  assert.ok(room.expiresAt > Date.now());
  assert.equal((await fetch(`${f.base}/api/rooms/${room.roomId}`)).status, 404);
});

test('authenticates roles and rejects missing, wrong, swapped and Unicode tokens', async (t) => {
  const f = await fixture(t);
  const room = await f.room();
  assert.equal(await rejection(f.base, room, 'viewer', { token: 'wrong' }), 401);
  assert.equal(await rejection(f.base, room, 'viewer', { token: room.publisherToken }), 401);
  assert.equal(await rejection(f.base, room, 'publisher', { token: '好'.repeat(43) }), 401);
  assert.equal(await rejection(f.base, room, 'owner', { token: room.publisherToken }), 401);
  assert.equal((await fetch(`${f.base}/api/health`)).status, 200);
});

test('permits native clients without Origin and rejects cross-site HTTP and WebSocket requests', async (t) => {
  const f = await fixture(t);
  const room = await f.room();
  const native = client(f.base, room, 'publisher');
  assert.equal((await native.message('connected')).role, 'publisher');
  assert.equal(await rejection(f.base, room, 'viewer', { origin: 'https://untrusted.example' }), 403);
  const response = await fetch(`${f.base}/api/rooms`, { method: 'POST', headers: { Origin: 'https://untrusted.example' } });
  assert.equal(response.status, 403);
  const sameOrigin = client(f.base, room, 'viewer', { origin: f.base });
  await sameOrigin.message('connected');
});

test('relay works in both directions when viewer connects first; server cannot be impersonated', async (t) => {
  const f = await fixture(t);
  const room = await f.room();
  const viewer = client(f.base, room, 'viewer');
  await viewer.message('connected');
  const publisher = client(f.base, room, 'publisher');
  await Promise.all([viewer.message('peer-ready'), publisher.message('peer-ready')]);
  publisher.send({ type: 'offer', sdp: 'v=0\r\ns=demo', ignored: room.publisherToken });
  assert.deepEqual(await viewer.message('offer'), { type: 'offer', sdp: 'v=0\r\ns=demo' });
  viewer.send({ type: 'answer', sdp: 'v=0\r\ns=answer' });
  assert.equal((await publisher.message('answer')).sdp, 'v=0\r\ns=answer');
  viewer.send({ type: 'ice', candidate: null });
  assert.deepEqual(await publisher.message('ice'), { type: 'ice', candidate: null });
  publisher.send({ type: 'ice', candidate: { candidate: 'candidate:local', sdpMid: '0', sdpMLineIndex: 0 } });
  assert.equal((await viewer.message('ice')).candidate.candidate, 'candidate:local');
  const closed = once(viewer.ws, 'close');
  viewer.send({ type: 'peer-ready' });
  assert.equal((await closed)[0], 1008);
  await publisher.message('peer-left');
});

test('only the matching peer receives signals; duplicate role cannot replace the owner', async (t) => {
  const f = await fixture(t);
  const room = await f.room();
  const publisher = client(f.base, room, 'publisher');
  await publisher.message('connected');
  assert.equal(await rejection(f.base, room, 'publisher', {}), 409);
  const viewer = client(f.base, room, 'viewer');
  await viewer.message('connected');
  const closed = once(publisher.ws, 'close');
  publisher.ws.close();
  await closed;
  await viewer.message('peer-left');
  const replacement = client(f.base, room, 'publisher');
  await replacement.message('peer-ready');
});

test('a viewer cannot publish an offer, lyrics or arbitrary video payload', async (t) => {
  const f = await fixture(t);
  for (const message of [{ type: 'offer', sdp: 'v=0' }, { type: 'lyrics', lines: [] }, { type: 'video', data: 'frame' }]) {
    const room = await f.room();
    const viewer = client(f.base, room, 'viewer');
    await viewer.message('connected');
    const closed = once(viewer.ws, 'close');
    viewer.send(message);
    assert.equal((await closed)[0], 1008);
  }
});

test('lyrics are validated, forwarded and replayed to a late viewer without HTML execution', async (t) => {
  const f = await fixture(t);
  const room = await f.room();
  const publisher = client(f.base, room, 'publisher');
  await publisher.message('connected');
  const message = { type: 'lyrics', track: { title: '测试', artist: '演示', duration: 120, position: 1, playing: true, sentAt: Date.now() }, lines: [{ time: 0, text: '<script>not executable data</script>' }] };
  publisher.send(message);
  const viewer = client(f.base, room, 'viewer');
  assert.deepEqual(await viewer.message('lyrics'), message);
  const closed = once(publisher.ws, 'close');
  publisher.send({ ...message, track: { ...message.track, position: '1' } });
  assert.equal((await closed)[0], 1008);
});

test('expires rooms and closes both peers, then rejects stale credentials', async (t) => {
  let clock = Date.now();
  const f = await fixture(t, { now: () => clock, roomTtlMs: 1000 });
  const room = await f.room();
  const publisher = client(f.base, room, 'publisher');
  const viewer = client(f.base, room, 'viewer');
  await Promise.all([publisher.message('connected'), viewer.message('connected')]);
  const closed = [once(publisher.ws, 'close'), once(viewer.ws, 'close')];
  clock += 1001;
  f.app.sweep();
  assert.deepEqual((await Promise.all(closed)).map((result) => result[0]), [4000, 4000]);
  assert.equal(await rejection(f.base, room, 'publisher', {}), 401);
});

test('bounds room creation, expires capacity and rate-limits attempts', async (t) => {
  let clock = Date.now();
  const f = await fixture(t, { now: () => clock, maxRooms: 1, createLimit: 3, roomTtlMs: 1000 });
  await f.room();
  assert.equal((await fetch(`${f.base}/api/rooms`, { method: 'POST' })).status, 503);
  clock += 1001;
  await f.room();
  const limited = await fetch(`${f.base}/api/rooms`, { method: 'POST' });
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
});

test('rejects oversized SDP and binary media instead of relaying it', async (t) => {
  const f = await fixture(t);
  for (const data of [JSON.stringify({ type: 'offer', sdp: 'v=0' + 'x'.repeat(128 * 1024) }), Buffer.from([1, 2, 3])]) {
    const room = await f.room();
    const publisher = client(f.base, room, 'publisher');
    await publisher.message('connected');
    const closed = once(publisher.ws, 'close');
    publisher.ws.send(data);
    assert.equal((await closed)[0], 1008);
  }
});

test('rejects traversal and DNS-rebinding Host headers', async (t) => {
  const f = await fixture(t);
  function request(path, headers = {}) {
    return new Promise((resolveRequest, reject) => {
      const req = http.request(`${f.base}/`, { path, headers }, (res) => { res.resume(); resolveRequest(res.statusCode); });
      req.on('error', reject); req.end();
    });
  }
  assert.equal(await request('/%2e%2e/package.json'), 400);
  assert.equal(await request('/%5c..%5cpackage.json'), 400);
  assert.equal(await request('/.git/config'), 400);
  assert.equal(await request('/', { Host: 'rebinding.attacker.example' }), 403);
});

test('ICE configuration is explicit and validates URLs without any automatic provider', () => {
  assert.deepEqual(validateIceServers([]), []);
  assert.deepEqual(validateIceServers([{ urls: 'stun:stun.example:3478' }]), [{ urls: ['stun:stun.example:3478'] }]);
  assert.throws(() => validateIceServers([{ urls: 'https://not-an-ice-service.example' }]));
  assert.throws(() => validateIceServers({ urls: [] }));
});
