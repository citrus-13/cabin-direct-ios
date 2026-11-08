import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../ios/StandaloneWeb/direct.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../ios/StandaloneWeb/index.html', import.meta.url), 'utf8');
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function response(status, body = {}) { return { status, ok: status >= 200 && status < 300, json: async () => body, blob: async () => ({ originalSynthetic: true }) }; }

// Minimal DOM and controllable fetch/timer boundaries. No dependency, browser, network,
// real credential or media capture. These tests do not establish rendering/decoder support.
function viewer({ disconnected = false } = {}) {
  const handlers = new Map(), timers = new Map(), intervals = [], requests = [], nodes = new Map(), storage = new Map();
  let timerID = 0, now = 1_000_000, created = 0;
  if (disconnected) storage.set('cabin-disconnected', '1');
  function element() {
    const events = new Map(), attributes = new Map();
    return { hidden: false, textContent: '', value: '', checked: false, disabled: false, style: {}, dataset: {}, children: [],
      classList: { toggle() {} },
      addEventListener(name, fn) { events.set(name, fn); },
      fire(name) { return events.get(name)?.({ preventDefault() {} }); },
      setAttribute(name, value) { attributes.set(name, value); },
      hasAttribute(name) { return attributes.has(name); },
      removeAttribute(name) { attributes.delete(name); },
      set src(value) { attributes.set('src', value); }, get src() { return attributes.get('src'); },
      replaceChildren(...children) { this.children = children; },
      set innerHTML(_) { throw new Error('Metadata must never use innerHTML'); }
    };
  }
  for (const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
    const node = element(); node.hidden = /\bhidden\b/.test(match[0]); nodes.set(match[1], node);
  }
  const modes = ['mirror', 'split', 'text'].map(mode => { const node = element(); node.dataset.mode = mode; return node; });
  const document = { hidden: false, documentElement: {}, getElementById: id => {
    assert.ok(nodes.has(id), `Script ID ${id} exists in production HTML`); return nodes.get(id);
  }, querySelectorAll: () => modes, createElement: element, addEventListener: (name, fn) => handlers.set(name, fn) };
  const local = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  vm.runInNewContext(source, { document, window: { addEventListener: (name, fn) => handlers.set(name, fn) },
    navigator: { onLine: true }, localStorage: local, sessionStorage: local, AbortController,
    Date: class extends Date { static now() { return now; } },
    URL: { createObjectURL: () => `blob:fixture-${++created}`, revokeObjectURL() {} },
    setTimeout: (fn, ms) => { const id = ++timerID; timers.set(id, { fn, ms }); return id; },
    clearTimeout: id => timers.delete(id), setInterval: fn => { intervals.push(fn); return intervals.length; },
    fetch: (path, options) => { const result = deferred(); requests.push({ path, options, ...result }); return result.promise; }
  });
  return { nodes, requests, storage, modes, document, handlers, interval() { intervals.forEach(fn => fn()); }, get created() { return created; },
    live: (extra = {}) => ({ captureState: 'live', frameUpdatedAt: now / 1000, width: 960, height: 540, lyricUpdatedAt: now / 1000, lyricLines: ['Original demo text'], lyricState: 'ready', source: 'demo', ...extra }),
    tick(ms) { const item = [...timers].find(([, value]) => value.ms === ms); assert.ok(item, `timer ${ms}`); timers.delete(item[0]); item[1].fn(); },
    async disconnect() { nodes.get('disconnect').fire('click'); await flush(); },
    async pair() { nodes.get('pairConsent').checked = true; nodes.get('pairCode').value = '123456'; nodes.get('pairForm').fire('submit'); await flush(); },
    advance(ms) { now += ms; }
  };
}
async function startLive(v, source = 'demo') { v.requests[0].resolve(response(200, v.live({ source }))); await flush(); }

test('viewer uses real production MJPEG transport and conspicuous original DEMO labels', async () => {
  const v = viewer(); await startLive(v);
  assert.equal(v.nodes.get('screen').src, '/stream.mjpeg');
  assert.equal(v.nodes.get('demoBanner').hidden, false);
  assert.match(v.nodes.get('viewerTitle').textContent, /DEMO/);
  assert.match(v.nodes.get('textNote').textContent, /不是实机/);
  assert.equal(v.nodes.get('dimensions').textContent, '960 × 540');
  assert.equal(v.nodes.get('lines').children[0].textContent, 'Original demo text');
  assert.ok(v.requests.every(request => request.options.credentials === 'same-origin'));
  v.modes[1].fire('click'); assert.equal(v.nodes.get('stage').className, 'stage mode-split');
});

test('disconnect clears content, aborts pending state, and ignores late state JSON', async () => {
  const v = viewer(); await startLive(v);
  v.tick(1000); const pendingState = v.requests.at(-1), json = deferred();
  pendingState.resolve({ ...response(200), json: () => json.promise }); await flush();
  await v.disconnect();
  const logout = v.requests.at(-1);
  assert.equal(logout.path, '/api/unpair'); assert.equal(logout.options.method, 'POST');
  assert.equal(logout.options.body, undefined);
  json.resolve(v.live()); await flush();
  assert.equal(v.nodes.get('viewer').hidden, true); assert.equal(v.nodes.get('screen').hidden, true);
  assert.equal(v.nodes.get('screen').src, undefined); assert.equal(v.nodes.get('lines').children.length, 0);
  assert.equal(v.nodes.get('dimensions').textContent, '');
  const count = v.requests.length;
  v.handlers.get('online')(); v.handlers.get('visibilitychange')(); v.nodes.get('screen').fire('error'); await flush();
  assert.equal(v.requests.length, count, 'No event reopens polling after disconnect');
  logout.resolve(response(204)); await flush();
  assert.equal(v.storage.get('cabin-disconnected'), '1');
});

test('late snapshot blob cannot restore a disconnected screen', async () => {
  const v = viewer(); await startLive(v);
  v.nodes.get('screen').fire('error'); await flush();
  const frame = v.requests.at(-1), blob = deferred();
  assert.equal(frame.path, '/frame.jpg');
  frame.resolve({ ...response(200), blob: () => blob.promise }); await flush();
  await v.disconnect(); blob.resolve({ originalSynthetic: true }); await flush();
  assert.equal(v.created, 0); assert.equal(v.nodes.get('screen').src, undefined);
  assert.equal(v.nodes.get('viewer').hidden, true);
});

test('late fetch headers are aborted and ignored, explicit pairing alone resumes', async () => {
  const v = viewer(); await startLive(v); v.tick(1000);
  const old = v.requests.at(-1);
  await v.disconnect(); assert.equal(old.options.signal.aborted, true);
  v.requests.at(-1).resolve(response(204)); await flush();
  await v.pair(); assert.equal(v.requests.at(-1).path, '/api/pair');
  v.requests.at(-1).resolve(response(200, { paired: true })); await flush();
  const newState = v.requests.at(-1); assert.equal(newState.path, '/api/state');
  old.resolve(response(200, v.live())); await flush();
  assert.equal(v.nodes.get('screen').src, undefined, 'Old epoch cannot display imagery in new pairing');
  newState.resolve(response(200, v.live({ source: 'visible-screen' }))); await flush();
  assert.equal(v.nodes.get('screen').src, '/stream.mjpeg'); assert.equal(v.nodes.get('demoBanner').hidden, true);
  assert.equal(v.nodes.get('textHeading').textContent, '可见文字识别');
  assert.equal(v.storage.has('cabin-disconnected'), false);
});

test('persisted explicit disconnect suppresses cookie auto-login on reload', async () => {
  const v = viewer({ disconnected: true }); await flush();
  assert.equal(v.requests.length, 0);
  v.handlers.get('online')(); v.handlers.get('visibilitychange')(); await flush();
  assert.equal(v.requests.length, 0);
  await v.pair(); assert.equal(v.requests[0].path, '/api/pair');
});

test('pause and stale state clear images/text; snapshot fallback remains live transport', async () => {
  const v = viewer(); await startLive(v); v.tick(3000); await flush();
  assert.equal(v.requests.at(-1).path, '/frame.jpg');
  v.requests.at(-1).resolve(response(200)); await flush();
  assert.match(v.nodes.get('streamMode').textContent, /单帧刷新/); assert.equal(v.created, 1);
  v.tick(1000); v.requests.at(-1).resolve(response(200, v.live({ captureState: 'paused' }))); await flush();
  assert.equal(v.nodes.get('screen').hidden, true); assert.equal(v.nodes.get('lines').children.length, 0);
  v.tick(1000); v.requests.at(-1).resolve(response(200, v.live({ frameUpdatedAt: 0 }))); await flush();
  assert.equal(v.nodes.get('screen').src, undefined); assert.equal(v.nodes.get('dimensions').textContent, '');
});

test('failed unpair stays locally disconnected and explains credential deletion uncertainty', async () => {
  const v = viewer(); await startLive(v); await v.disconnect();
  v.requests.at(-1).reject(new Error('offline')); await flush();
  assert.match(v.nodes.get('pairError').textContent, /无法确认/);
  assert.equal(v.nodes.get('viewer').hidden, true); assert.equal(v.nodes.get('pairButton').disabled, false);
  assert.equal(v.storage.get('cabin-disconnected'), '1');
});

test('explicit pairing supersedes the initial pending cookie check without polling deadlock', async () => {
  const v = viewer(), initial = v.requests[0];
  await v.pair(); assert.equal(initial.options.signal.aborted, true);
  v.requests.at(-1).resolve(response(200)); await flush();
  assert.equal(v.requests.at(-1).path, '/api/state');
  v.requests.at(-1).resolve(response(200, v.live())); await flush();
  initial.resolve(response(401)); await flush();
  assert.equal(v.nodes.get('viewer').hidden, false); assert.equal(v.nodes.get('screen').src, '/stream.mjpeg');
  v.tick(1000); assert.equal(v.requests.at(-1).path, '/api/state');
});

const music = (extra = {}) => ({ status: 'lyrics', title: 'Track', artist: 'Artist', lines: ['Music lyric'], updatedAt: 1000, matchedAt: 1000, position: 72.9, source: 'shazam', message: '', ...extra });

test('music is a separate opt-in panel: fresh audio survives stale video, never becomes OCR', async () => {
  const v = viewer();
  v.requests[0].resolve(response(200, v.live({ frameUpdatedAt: 0, music: music() }))); await flush();
  assert.equal(v.nodes.get('screen').hidden, true);
  assert.equal(v.nodes.get('lines').children.length, 0);
  assert.equal(v.nodes.get('musicPanel').hidden, false);
  assert.equal(v.nodes.get('musicTitle').textContent, 'Track');
  assert.equal(v.nodes.get('musicArtist').textContent, 'Artist');
  assert.equal(v.nodes.get('musicSource').textContent, 'ShazamKit识曲 · 进度估算');
  assert.equal(v.nodes.get('musicPosition').textContent, '估算进度 1:12');
  assert.equal(v.nodes.get('musicLines').children[0].textContent, 'Music lyric');
  assert.match(v.nodes.get('musicNote').textContent, /LRCLIB.*不保证与播放同步/);
  assert.ok(v.requests.every(item => item.path.startsWith('/')), 'No external metadata or lyric requests');
  // Video watchdog must not wipe a refreshed audio-only state.
  v.advance(4500); v.tick(1000);
  v.requests.at(-1).resolve(response(200, v.live({ frameUpdatedAt: 0, music: music({ updatedAt: 1004.5 }) }))); await flush();
  v.interval(); assert.equal(v.nodes.get('musicPanel').hidden, false);
});

test('music metadata and LRCLIB text are textContent-only and bounded', async () => {
  const v = viewer(), injection = '<img src=x onerror=alert(1)>';
  v.requests[0].resolve(response(200, v.live({ music: music({ title: injection, artist: injection, message: injection,
    lines: [injection, 'x'.repeat(300), ...Array(30).fill('line')] }) }))); await flush();
  assert.equal(v.nodes.get('musicTitle').textContent, injection);
  assert.equal(v.nodes.get('musicArtist').textContent, injection);
  assert.equal(v.nodes.get('musicMessage').textContent, injection);
  assert.equal(v.nodes.get('musicLines').children[0].textContent, injection);
  assert.equal(v.nodes.get('musicLines').children[1].textContent.length, 200);
  assert.equal(v.nodes.get('musicLines').children.length, 24);
  assert.equal(v.requests.length, 1);
});

test('music stops displaying on pause, ended, error, missing state, stale or invalid dates/source', async () => {
  for (const update of [
    { captureState: 'paused' }, { captureState: 'ended' }, { captureState: 'stopped' }, { captureState: 'error' }, { music: undefined },
    { music: music({ updatedAt: 995 }) }, { music: music({ updatedAt: 1001 }) }, { music: music({ updatedAt: NaN }) },
    { music: music({ matchedAt: 969 }) }, { music: music({ matchedAt: 1001 }) }, { music: music({ matchedAt: Infinity }) },
    { music: music({ source: 'other' }) }, { music: music({ status: 'unknown' }) }, { music: music({ status: 'stale' }) }
  ]) {
    const v = viewer(); v.requests[0].resolve(response(200, v.live({ music: music() }))); await flush();
    assert.equal(v.nodes.get('musicPanel').hidden, false);
    v.tick(1000); v.requests.at(-1).resolve(response(200, v.live({ music: music(), ...update }))); await flush();
    assert.equal(v.nodes.get('musicPanel').hidden, true, JSON.stringify(update));
    assert.equal(v.nodes.get('musicTitle').textContent, '');
    assert.equal(v.nodes.get('musicArtist').textContent, '');
    assert.equal(v.nodes.get('musicLines').children.length, 0);
  }
});

test('manual music has separate provenance and match TTL, no-match clears old lyrics', async () => {
  const v = viewer();
  v.requests[0].resolve(response(200, v.live({ music: music({ source: 'manual', matchedAt: 401 }) }))); await flush();
  assert.equal(v.nodes.get('musicPanel').hidden, false);
  assert.equal(v.nodes.get('musicSource').textContent, '手动选曲 · 进度估算');
  v.tick(1000); v.requests.at(-1).resolve(response(200, v.live({ music: music({ status: 'no-lyrics' }) }))); await flush();
  assert.equal(v.nodes.get('musicTitle').textContent, 'Track');
  assert.equal(v.nodes.get('musicLines').children.length, 0);
  assert.match(v.nodes.get('musicNote').textContent, /LRCLIB 未匹配到歌词/);
  v.tick(1000); v.requests.at(-1).resolve(response(200, v.live({ music: music({ source: 'manual', matchedAt: 399 }) }))); await flush();
  assert.equal(v.nodes.get('musicPanel').hidden, true);
});

test('unavailable music shows bounded guidance without retaining an old track', async () => {
  const v = viewer();
  v.requests[0].resolve(response(200, v.live({ music: music() }))); await flush();
  v.tick(1000);
  v.requests.at(-1).resolve(response(200, v.live({ music: music({ status: 'unavailable', message: '服务未授权；不会付费升级。' }) })));
  await flush();
  assert.equal(v.nodes.get('musicPanel').hidden, false);
  assert.equal(v.nodes.get('musicTitle').textContent, '识曲服务不可用');
  assert.equal(v.nodes.get('musicArtist').textContent, '');
  assert.equal(v.nodes.get('musicLines').children.length, 0);
  assert.match(v.nodes.get('musicMessage').textContent, /不会付费升级/);
});

test('music has an independent stale watchdog and clears on hidden, offline, disconnect and lost auth', async () => {
  for (const stop of ['watchdog', 'hidden', 'offline', 'disconnect', 'unauthorized', 'expired', 'fetch-error']) {
    const v = viewer(); v.requests[0].resolve(response(200, v.live({ music: music() }))); await flush();
    if (stop === 'watchdog') { v.advance(4001); v.interval(); }
    if (stop === 'hidden') { v.document.hidden = true; v.handlers.get('visibilitychange')(); }
    if (stop === 'offline') v.handlers.get('offline')();
    if (stop === 'disconnect') await v.disconnect();
    if (['unauthorized', 'expired', 'fetch-error'].includes(stop)) {
      v.tick(1000);
      if (stop === 'fetch-error') v.requests.at(-1).reject(new Error('lost'));
      else v.requests.at(-1).resolve(response(stop === 'expired' ? 410 : 401));
    }
    await flush();
    assert.equal(v.nodes.get('musicPanel').hidden, true, stop);
    assert.equal(v.nodes.get('musicTitle').textContent, '', stop);
    assert.equal(v.nodes.get('musicLines').children.length, 0, stop);
  }
});
