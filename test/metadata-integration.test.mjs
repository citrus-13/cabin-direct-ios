import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createApp } from '../server.mjs';
import { playbackPosition } from '../public/lyrics.js';

const WAIT_MS = 2000;
const roles = ['publisher', 'viewer', 'metadata'];
const unexpectedLookup = async () => { throw new Error('Unexpected provider call in socket-only test'); };

async function fixture(t, options = {}) {
  const app = createApp({ lyricsProvider: { lookup: unexpectedLookup, search: unexpectedLookup }, ...options });
  const address = await app.listen(0);
  const base = `http://127.0.0.1:${address.port}`;
  t.after(() => app.close());
  return { app, base, async room() {
    const response = await fetch(`${base}/api/rooms`, { method: 'POST', signal: AbortSignal.timeout(WAIT_MS) });
    assert.equal(response.status, 201);
    return response.json();
  } };
}

function boundedEvent(emitter, event) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      emitter.off(event, done);
      reject(new Error(`Timed out waiting for ${event}`));
    }, WAIT_MS);
    function done(...args) { clearTimeout(timer); resolve(args); }
    emitter.once(event, done);
  });
}

function client(base, room, role, token = room[`${role}Token`]) {
  const params = new URLSearchParams({ room: room.roomId, role, token });
  const ws = new WebSocket(`${base.replace('http:', 'ws:')}/signal?${params}`);
  const queue = [];
  const history = [];
  const pending = [];
  ws.on('error', () => {});
  ws.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    history.push(message);
    const index = pending.findIndex((item) => item.matches(message));
    if (index < 0) { queue.push(message); return; }
    const [item] = pending.splice(index, 1);
    clearTimeout(item.timer);
    item.resolve(message);
  });
  ws.on('close', () => {
    for (const item of pending.splice(0)) {
      clearTimeout(item.timer);
      item.reject(new Error('Socket closed before expected message'));
    }
  });
  return { ws, history,
    message(type, predicate = () => true) {
      const matches = (message) => message.type === type && predicate(message);
      const index = queue.findIndex(matches);
      if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const item = { matches, resolve, reject, timer: setTimeout(() => {
          pending.splice(pending.indexOf(item), 1);
          reject(new Error(`Timed out waiting for ${type}`));
        }, WAIT_MS) };
        pending.push(item);
      });
    },
    send(value) { ws.send(JSON.stringify(value)); },
    async barrier() {
      const pong = boundedEvent(ws, 'pong');
      ws.ping();
      await pong;
    },
    async close() {
      const closed = boundedEvent(ws, 'close');
      ws.close();
      return closed;
    },
  };
}

async function connect(f, room, role) {
  const socket = client(f.base, room, role);
  assert.equal((await socket.message('connected')).role, role);
  return socket;
}

async function rejected(base, room, role, token) {
  const socket = client(base, room, role, token);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.ws.terminate(); reject(new Error('Upgrade rejection timed out')); }, WAIT_MS);
    socket.ws.once('unexpected-response', (request, response) => {
      clearTimeout(timer);
      response.resume();
      request.destroy();
      resolve(response.statusCode);
    });
    socket.ws.once('open', () => {
      clearTimeout(timer);
      socket.ws.terminate();
      reject(new Error('Unauthorized socket unexpectedly accepted'));
    });
  });
}

function lyrics(now, overrides = {}) {
  return { type: 'lyrics', track: { title: 'Local fixture', artist: 'Test artist', duration: 120,
    position: 10, playing: true, sentAt: now, ...overrides }, lines: [{ time: 0, text: 'Original fixture line' }], lyricProvider: 'lrc' };
}

test('metadata tokens are distinct and cannot substitute for another role or room', { timeout: 10000 }, async (t) => {
  const f = await fixture(t);
  const room = await f.room();
  const other = await f.room();
  assert.equal(new Set(roles.map((role) => room[`${role}Token`])).size, 3);
  for (const role of roles) {
    assert.match(room[`${role}Token`], /^[A-Za-z0-9_-]{43}$/);
    for (const wrongRole of roles.filter((candidate) => candidate !== role)) {
      assert.equal(await rejected(f.base, room, role, room[`${wrongRole}Token`]), 401);
    }
    assert.equal(await rejected(f.base, room, role, other[`${role}Token`]), 401);
  }
  for (const role of roles) await connect(f, room, role);
});

test('metadata cannot publish offers, answers, ICE, invalid media status or source selection', { timeout: 10000 }, async (t) => {
  const f = await fixture(t);
  for (const message of [
    { type: 'offer', sdp: 'v=0\r\ns=forbidden' },
    { type: 'answer', sdp: 'v=0\r\ns=forbidden' },
    { type: 'ice', candidate: null },
    { type: 'media-status', state: 'selected' },
    { type: 'media-status', state: 'unknown' },
    { type: 'lyrics-source', source: 'publisher' },
  ]) {
    const room = await f.room();
    const metadata = await connect(f, room, 'metadata');
    const closed = boundedEvent(metadata.ws, 'close');
    metadata.send(message);
    assert.equal((await closed)[0], 1008, JSON.stringify(message));
  }
});

test('metadata and video coexist while video offer, answer and ICE retain their proper peers', { timeout: 10000 }, async (t) => {
  let clock = 1_000_000;
  const f = await fixture(t, { now: () => clock });
  const room = await f.room();
  const viewer = await connect(f, room, 'viewer');
  const publisher = await connect(f, room, 'publisher');
  await Promise.all([viewer.message('peer-ready'), publisher.message('peer-ready')]);
  const metadata = await connect(f, room, 'metadata');
  publisher.send({ type: 'offer', sdp: 'v=0\r\ns=video' });
  assert.equal((await viewer.message('offer')).sdp, 'v=0\r\ns=video');
  viewer.send({ type: 'answer', sdp: 'v=0\r\ns=viewer' });
  assert.equal((await publisher.message('answer')).sdp, 'v=0\r\ns=viewer');
  publisher.send({ type: 'ice', candidate: null });
  assert.equal((await viewer.message('ice')).candidate, null);
  metadata.send(lyrics(clock));
  const [displayed, senderStatus] = await Promise.all([viewer.message('lyrics'), publisher.message('lyrics')]);
  assert.equal(displayed.provenance, 'tesla-ble');
  assert.deepEqual(displayed, senderStatus);
  await metadata.barrier();
  assert.equal(metadata.history.some((message) => ['offer', 'answer', 'ice', 'peer-ready'].includes(message.type)), false);
});

test('metadata-only lyrics work and replay to a late viewer without a video publisher', { timeout: 10000 }, async (t) => {
  const clock = 2_000_000;
  const f = await fixture(t, { now: () => clock });
  const room = await f.room();
  const metadata = await connect(f, room, 'metadata');
  metadata.send(lyrics(clock, { playing: false, position: 32 }));
  await metadata.barrier();
  const viewer = await connect(f, room, 'viewer');
  const replay = await viewer.message('lyrics');
  assert.equal(replay.track.position, 32);
  assert.equal(replay.track.playing, false);
  assert.equal(replay.provenance, 'tesla-ble');
  assert.equal(viewer.history.some((message) => message.type === 'peer-ready'), false);
});

test('metadata disconnect and explicit/timed staleness freeze playback with fake time', { timeout: 10000 }, async (t) => {
  for (const mode of ['disconnect', 'explicit-stale', 'timeout-stale']) {
    let clock = 3_000_000;
    const f = await fixture(t, { now: () => clock });
    const room = await f.room();
    const metadata = await connect(f, room, 'metadata');
    const viewer = await connect(f, room, 'viewer');
    metadata.send(lyrics(clock));
    await viewer.message('lyrics');
    const delta = mode === 'timeout-stale' ? 10_001 : 3000;
    clock += delta;
    if (mode === 'disconnect') await metadata.close();
    else if (mode === 'explicit-stale') metadata.send({ type: 'media-status', state: 'stale' });
    else f.app.sweep();
    const frozen = await viewer.message('lyrics');
    assert.equal(frozen.track.playing, false, mode);
    assert.equal(frozen.track.position, 10 + delta / 1000, mode);
    assert.equal(frozen.track.sentAt, clock, mode);
    assert.equal(playbackPosition(frozen.track, clock, clock + 5000), frozen.track.position, mode);
    await viewer.message('media-status', (message) => message.state === (mode === 'disconnect' ? 'disconnected' : 'stale'));
  }
});

test('delayed BLE observation is compensated once, then freeze and replay retain that position', { timeout: 10000 }, async (t) => {
  let clock = 4_000_000;
  const f = await fixture(t, { now: () => clock });
  const room = await f.room();
  const metadata = await connect(f, room, 'metadata');
  const viewer = await connect(f, room, 'viewer');
  metadata.send(lyrics(clock - 4500));
  const anchored = await viewer.message('lyrics');
  assert.equal(anchored.track.position, 14.5);
  assert.equal(anchored.track.sentAt, clock);
  assert.equal(playbackPosition(anchored.track, clock, clock + 2000), 16.5);
  clock += 2000;
  await metadata.close();
  const frozen = await viewer.message('lyrics');
  assert.equal(frozen.track.position, 16.5);
  await viewer.close();
  clock += 5000;
  const laterViewer = await connect(f, room, 'viewer');
  const replay = await laterViewer.message('lyrics');
  assert.equal(replay.track.position, 16.5);
  assert.equal(replay.track.playing, false);
  assert.equal(playbackPosition(replay.track, clock, clock + 5000), 16.5);
});

test('late live viewer receives a fresh BLE anchor without mutating the stored observation', { timeout: 10000 }, async (t) => {
  let clock = 4_500_000;
  const f = await fixture(t, { now: () => clock });
  const room = await f.room();
  const metadata = await connect(f, room, 'metadata');
  metadata.send(lyrics(clock));
  await metadata.barrier();
  clock += 4000;
  const viewer = await connect(f, room, 'viewer');
  const replay = await viewer.message('lyrics');
  assert.equal(replay.track.position, 14);
  assert.equal(replay.track.sentAt, clock);
  clock += 2000;
  await metadata.close();
  assert.equal((await viewer.message('lyrics')).track.position, 16);
});

test('explicit publisher lyric ownership survives metadata reconnect and ignores BLE overwrite', { timeout: 10000 }, async (t) => {
  const clock = 5_000_000;
  const f = await fixture(t, { now: () => clock });
  const room = await f.room();
  const metadata = await connect(f, room, 'metadata');
  const publisher = await connect(f, room, 'publisher');
  const viewer = await connect(f, room, 'viewer');
  publisher.send({ type: 'lyrics-source', source: 'publisher' });
  await publisher.message('media-status', (message) => message.source === 'publisher' && message.state === 'selected');
  publisher.send({ ...lyrics(clock, { title: 'Explicit manual track' }), provenance: 'manual' });
  assert.equal((await viewer.message('lyrics')).track.title, 'Explicit manual track');
  await metadata.close();
  const replacement = await connect(f, room, 'metadata');
  replacement.send(lyrics(clock, { title: 'Must not replace manual track' }));
  await replacement.barrier();
  publisher.send({ type: 'offer', sdp: 'v=0\r\ns=barrier' });
  await viewer.message('offer');
  assert.equal(viewer.history.filter((message) => message.type === 'lyrics').length, 1);
  await viewer.close();
  const replayViewer = await connect(f, room, 'viewer');
  const replay = await replayViewer.message('lyrics');
  assert.equal(replay.track.title, 'Explicit manual track');
  assert.equal(replay.provenance, 'manual');
  assert.equal((await replayViewer.message('media-status')).source, 'publisher');
});

async function lookup(f, room, token, params = {}, extra = {}) {
  const query = new URLSearchParams({ room: room.roomId, ...params });
  return fetch(`${f.base}/api/lyrics?${query}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(WAIT_MS), ...extra,
  });
}

test('lyric API accepts only publisher/metadata header credentials, never viewer or cross-room credentials', { timeout: 10000 }, async (t) => {
  const calls = [];
  const provider = {
    async lookup(metadata) { calls.push(metadata); return { status: 'not-found', lines: [] }; },
    async search(q) { calls.push(q); return [{ id: 7 }]; },
  };
  const f = await fixture(t, { lyricsProvider: provider });
  const room = await f.room();
  const other = await f.room();
  for (const token of [undefined, room.viewerToken, other.publisherToken, other.metadataToken, 'invalid']) {
    assert.equal((await lookup(f, room, token, { q: 'song' })).status, 401);
  }
  assert.equal((await lookup(f, room, undefined, { q: 'song', token: room.metadataToken })).status, 401);
  assert.equal(calls.length, 0);
  const response = await lookup(f, room, room.metadataToken, { title: 'Song', artist: 'Artist', album: 'Album', duration: '123.5' });
  assert.equal(response.status, 200);
  assert.deepEqual(calls[0], { title: 'Song', artist: 'Artist', album: 'Album', duration: 123.5 });
  const search = await lookup(f, room, room.publisherToken, { q: 'Track search' });
  assert.equal(search.status, 200);
  assert.deepEqual(await search.json(), { results: [{ id: 7 }] });
  assert.equal(calls[1], 'Track search');
  assert.equal((await lookup(f, room, room.metadataToken, { q: 'cross-site' }, {
    headers: { Authorization: `Bearer ${room.metadataToken}`, Origin: 'https://untrusted.test' },
  })).status, 403);
  assert.equal(calls.length, 2);
});

test('lyric API maps injected validation/provider errors without exposing error details', { timeout: 10000 }, async (t) => {
  const provider = {
    async lookup(metadata) {
      if (!metadata.title || !metadata.artist || !Number.isFinite(metadata.duration)) {
        throw Object.assign(new Error('sensitive validation internals'), { statusCode: 400 });
      }
      return { status: 'not-found', lines: [] };
    },
    async search(q) { throw Object.assign(new Error('sensitive upstream endpoint/token'), { statusCode: Number(q) }); },
  };
  const f = await fixture(t, { lyricsProvider: provider });
  const room = await f.room();
  for (const params of [{}, { title: 'Song', artist: 'Artist', duration: 'NaN' }]) {
    const response = await lookup(f, room, room.metadataToken, params);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Invalid song metadata' });
  }
  for (const status of [400, 413, 429, 502, 503, 504, 418]) {
    const response = await lookup(f, room, room.publisherToken, { q: String(status) });
    assert.equal(response.status, status === 418 ? 502 : status);
    assert.doesNotMatch(await response.text(), /sensitive|endpoint|token/);
  }
});

test('lyric API enforces shared lookup rate limits and resets them using injected time', { timeout: 10000 }, async (t) => {
  let clock = 6_000_000;
  let calls = 0;
  const provider = { async search() { calls += 1; return []; }, lookup: unexpectedLookup };
  const f = await fixture(t, { now: () => clock, lyricsProvider: provider });
  const room = await f.room();
  for (let index = 0; index < 30; index += 1) {
    const token = index % 2 ? room.metadataToken : room.publisherToken;
    assert.equal((await lookup(f, room, token, { q: `query-${index}` })).status, 200);
  }
  const limited = await lookup(f, room, room.metadataToken, { q: 'limited' });
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
  assert.equal(calls, 30);
  clock += 60_001;
  assert.equal((await lookup(f, room, room.publisherToken, { q: 'after-reset' })).status, 200);
  assert.equal(calls, 31);
});

test('room expiry closes metadata as well as video peers and rejects all expired credentials', { timeout: 10000 }, async (t) => {
  let clock = 7_000_000;
  const f = await fixture(t, { now: () => clock, roomTtlMs: 1000 });
  const room = await f.room();
  const sockets = [];
  for (const role of roles) sockets.push(await connect(f, room, role));
  const closed = sockets.map((socket) => boundedEvent(socket.ws, 'close'));
  clock += 1000;
  f.app.sweep();
  assert.deepEqual((await Promise.all(closed)).map(([code]) => code), [4000, 4000, 4000]);
  for (const role of roles) assert.equal(await rejected(f.base, room, role, room[`${role}Token`]), 401);
  assert.equal((await lookup(f, room, room.metadataToken, { q: 'expired' })).status, 401);
});
