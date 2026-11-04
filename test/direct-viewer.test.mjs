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
  const handlers = new Map(), timers = new Map(), requests = [], nodes = new Map(), storage = new Map();
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
      replaceChildren(...children) { this.children = children; }
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
    clearTimeout: id => timers.delete(id), setInterval: () => 0,
    fetch: (path, options) => { const result = deferred(); requests.push({ path, options, ...result }); return result.promise; }
  });
  return { nodes, requests, storage, modes, document, handlers, get created() { return created; },
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
