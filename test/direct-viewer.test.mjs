import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../ios/StandaloneWeb/direct.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../ios/StandaloneWeb/index.html', import.meta.url), 'utf8');
const flush = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const bytes = value => value instanceof Uint8Array ? value : new TextEncoder().encode(JSON.stringify(value));
function delayedBody(promise) {
  let read = false;
  return {getReader: () => ({read: async () => read ? {done: true} : (read = true, {done: false, value: bytes(await promise)}), cancel: async () => {}, releaseLock() {}})};
}
function response(status, body = {}) { return { status, ok: status >= 200 && status < 300, body: status === 204 ? null : delayedBody(Promise.resolve(body)) }; }

// Minimal DOM and controllable fetch/timer boundaries. No dependency, browser, network,
// real credential or media capture. These tests do not establish rendering/decoder support.
function viewer({ disconnected = false, mse = false, mseSupported = true, autoAppend = true } = {}) {
  const handlers = new Map(), timers = new Map(), intervals = [], requests = [], nodes = new Map(), storage = new Map();
  let timerID = 0, now = 1_000_000, created = 0;
  if (disconnected) storage.set('cabin-disconnected', '1');
  function element() {
    const events = new Map(), attributes = new Map();
    return { hidden: false, textContent: '', value: '', checked: false, disabled: false, style: {}, dataset: {}, children: [],
      classList: { toggle() {} },
      addEventListener(name, fn) { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(fn); },
      removeEventListener(name, fn) { events.get(name)?.delete(fn); },
      fire(name) { for (const fn of [...(events.get(name) || [])]) fn({ preventDefault() {} }); },
      setAttribute(name, value) { attributes.set(name, value); },
      hasAttribute(name) { return attributes.has(name); },
      removeAttribute(name) { attributes.delete(name); },
      set src(value) { attributes.set('src', value); }, get src() { return attributes.get('src'); },
      replaceChildren(...children) { this.children = children; },
      currentTime: 0, muted: true, buffered: {length: 0}, plays: 0, pauses: 0,
      play() { this.plays++; return this.playPromise || (this.playDenied ? Promise.reject(new Error('autoplay')) : Promise.resolve()); },
      pause() { this.pauses++; }, load() {},
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
  const mediaSources = [], appends = [], mediaConstruction = {failConstructor: false, failURL: false, attempts: 0, urlAttempts: 0};
  class FakeMediaSource {
    static isTypeSupported() { return mseSupported; }
    constructor() {
      mediaConstruction.attempts++;
      if (mediaConstruction.failConstructor) throw new Error('MediaSource construction failed');
      Object.assign(this, element()); this.readyState = 'closed'; mediaSources.push(this);
    }
    addSourceBuffer(mime) {
      const buffer = element(); buffer.mime = mime; buffer.updating = false;
      buffer.appendBuffer = value => { assert.equal(buffer.updating, false); buffer.updating = true; appends.push(value); if (autoAppend) Promise.resolve().then(() => { buffer.updating = false; buffer.fire('updateend'); }); };
      buffer.remove = () => { assert.equal(buffer.updating, false); buffer.updating = true; Promise.resolve().then(() => { buffer.updating = false; buffer.fire('updateend'); }); };
      buffer.abort = () => { buffer.updating = false; buffer.fire('abort'); };
      this.buffer = buffer; return buffer;
    }
  }
  vm.runInNewContext(source, { document, window: { addEventListener: (name, fn) => handlers.set(name, fn), ...(mse ? {MediaSource: FakeMediaSource} : {}) },
    navigator: { onLine: true }, localStorage: local, sessionStorage: local, AbortController, TextDecoder, Blob, Uint8Array,
    Date: class extends Date { static now() { return now; } },
    URL: { createObjectURL: () => {
      mediaConstruction.urlAttempts++;
      if (mediaConstruction.failURL) throw new Error('Object URL creation failed');
      return `blob:fixture-${++created}`;
    }, revokeObjectURL() {} },
    setTimeout: (fn, ms) => { const id = ++timerID; timers.set(id, { fn, ms }); return id; },
    clearTimeout: id => timers.delete(id), setInterval: fn => { intervals.push(fn); return intervals.length; },
    fetch: (path, options) => { const result = deferred(); requests.push({ path, options, ...result }); return result.promise; }
  });
  return { nodes, requests, storage, modes, document, handlers, mediaSources, appends, mediaConstruction,
    async openMedia() { const item = mediaSources.at(-1); assert.ok(item); item.readyState = 'open'; item.fire('sourceopen'); await flush(); },
    interval() { intervals.forEach(fn => fn()); }, get created() { return created; },
    live: (extra = {}) => ({ captureState: 'live', frameUpdatedAt: now / 1000, width: 960, height: 540, lyricUpdatedAt: now / 1000, lyricLines: ['Original demo text'], lyricState: 'ready', source: 'demo', ...extra }),
    tick(ms) { const item = [...timers].find(([, value]) => value.ms === ms); assert.ok(item, `timer ${ms}`); timers.delete(item[0]); item[1].fn(); },
    async disconnect() { nodes.get('disconnect').fire('click'); await flush(); },
    async pair() { nodes.get('pairConsent').checked = true; nodes.get('pairCode').value = '123456'; nodes.get('pairForm').fire('submit'); await flush(); },
    advance(ms) { now += ms; }
  };
}
async function startLive(v, source = 'demo') { v.requests[0].resolve(response(200, v.live({ source }))); await flush(); }
const mediaID = 'c601671f-573e-4cb7-9089-e154a593fcdf';
const mediaDescriptor = (extra = {}) => ({generation: mediaID, mime: 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"', hasAudio: true, updatedAt: 1000, ...extra});
const mediaIndex = (fragments = [{sequence: 0, start: 0, duration: 0.25, independent: true}], extra = {}) => ({...mediaDescriptor(), fragments, ...extra});
const mediaBytes = () => new Uint8Array(32).fill(1);
async function beginMedia(v) {
  v.requests[0].resolve(response(200, v.live({source: 'visible-screen', frameUpdatedAt: 0, width: 0, media: mediaDescriptor()}))); await flush();
  await v.openMedia();
  assert.equal(v.requests.at(-1).path, '/media/index');
  v.requests.at(-1).resolve(response(200, mediaIndex())); await flush();
  assert.equal(v.requests.at(-1).path, `/media/${mediaID}/init.mp4`);
  v.requests.at(-1).resolve(response(200, mediaBytes())); await flush();
}
async function finishMedia(v) {
  assert.equal(v.requests.at(-1).path, `/media/${mediaID}/0.m4s`);
  v.requests.at(-1).resolve(response(200, mediaBytes())); await flush();
}

test('state body timeout covers stalled reads, releases polling and ignores late bytes', async () => {
  const v = viewer(), stalled = deferred();
  v.requests[0].resolve({...response(200), body: delayedBody(stalled.promise)}); await flush();
  v.tick(2500); await flush();
  assert.equal(v.requests[0].options.signal.aborted, true);
  v.tick(2000); assert.equal(v.requests.length, 2);
  stalled.resolve(v.live()); await flush();
  assert.equal(v.nodes.get('screen').src, undefined);
  v.requests.at(-1).resolve(response(200, v.live())); await flush();
  assert.equal(v.nodes.get('screen').src, '/stream.mjpeg');
});

test('state and snapshot readers reject oversized bodies before rendering', async () => {
  const v = viewer(); v.requests[0].resolve(response(200, new Uint8Array(65537))); await flush();
  assert.equal(v.requests[0].options.signal.aborted, true); assert.equal(v.nodes.get('screen').src, undefined);
  const image = viewer(); await startLive(image); image.nodes.get('screen').fire('error'); await flush();
  image.requests.at(-1).resolve(response(200, new Uint8Array(1048577))); await flush();
  assert.equal(image.created, 0); assert.equal(image.nodes.get('screen').src, undefined);
});

test('MSE uses one muxed buffer, authenticated finite requests and explicit sound activation', async () => {
  const v = viewer({mse: true}); await beginMedia(v); await finishMedia(v);
  assert.equal(v.mediaSources.length, 1); assert.equal(v.appends.length, 2);
  assert.match(v.mediaSources[0].buffer.mime, /avc1.*mp4a/);
  assert.equal(v.nodes.get('video').hidden, false); assert.equal(v.nodes.get('video').muted, true);
  assert.equal(v.nodes.get('screen').src, undefined); assert.equal(v.nodes.get('soundButton').hidden, false);
  v.nodes.get('soundButton').fire('click'); await flush();
  assert.equal(v.nodes.get('video').muted, false); assert.equal(v.nodes.get('soundButton').hidden, true);
  assert.ok(v.requests.every(item => item.options.credentials === 'same-origin' && item.path.startsWith('/')));
  assert.ok(v.requests.every(item => !item.path.includes('?') && !item.path.includes('token')));
  assert.ok(v.requests.every(item => !['/frame.jpg', '/stream.mjpeg'].includes(item.path)));
});

test('MSE append operations are serialized and initial fragment waits for initialization updateend', async () => {
  const v = viewer({mse: true, autoAppend: false}); await beginMedia(v);
  assert.equal(v.appends.length, 1); assert.match(v.requests.at(-1).path, /init\.mp4$/);
  const buffer = v.mediaSources[0].buffer; buffer.updating = false; buffer.fire('updateend'); await flush();
  await finishMedia(v);
  assert.equal(v.appends.length, 2); assert.equal(buffer.updating, true);
  buffer.updating = false; buffer.fire('updateend'); await flush();
  assert.equal(v.nodes.get('video').hidden, false);
});

test('MSE unsupported and decoder errors fall back to picture only; denied autoplay never auto-unmutes', async () => {
  const unsupported = viewer({mse: true, mseSupported: false});
  unsupported.requests[0].resolve(response(200, unsupported.live({media: mediaDescriptor()}))); await flush();
  assert.equal(unsupported.nodes.get('screen').src, '/stream.mjpeg');
  assert.match(unsupported.nodes.get('mediaNote').textContent, /无声音/); assert.equal(unsupported.requests.length, 1);
  const v = viewer({mse: true}); v.nodes.get('video').playDenied = true;
  await beginMedia(v); await finishMedia(v);
  assert.equal(v.nodes.get('video').muted, true); assert.equal(v.nodes.get('soundButton').hidden, false);
  v.nodes.get('soundButton').fire('click'); await flush(); assert.equal(v.nodes.get('video').muted, true);
  v.nodes.get('video').playDenied = false; v.nodes.get('video').fire('error'); await flush();
  assert.equal(v.nodes.get('video').src, undefined); assert.equal(v.nodes.get('screen').src, '/stream.mjpeg');
  assert.match(v.nodes.get('mediaNote').textContent, /无声音/);
});

test('MSE stops on pause, hidden page, disconnect, stale state, offline and lyrics transition', async () => {
  for (const action of ['paused', 'hidden', 'disconnect', 'stale', 'offline', 'lyrics']) {
    const v = viewer({mse: true}); await beginMedia(v); await finishMedia(v);
    if (action === 'hidden') { v.document.hidden = true; v.handlers.get('visibilitychange')(); }
    else if (action === 'disconnect') await v.disconnect();
    else if (action === 'offline') v.handlers.get('offline')();
    else if (action === 'stale') { v.advance(4500); v.interval(); }
    else { v.tick(1000); v.requests.at(-1).resolve(response(200, action === 'lyrics' ? microphoneState() : v.live({captureState: 'paused', media: mediaDescriptor()}))); }
    await flush();
    assert.equal(v.nodes.get('video').src, undefined, action); assert.equal(v.nodes.get('video').muted, true, action);
    assert.equal(v.nodes.get('soundButton').hidden, true, action);
    const count = v.requests.length; v.mediaSources[0].fire('sourceopen'); v.nodes.get('video').fire('error'); await flush();
    assert.equal(v.requests.length, count, action);
  }
});

test('MSE late initialization bytes cannot revive media after source switches to lyrics', async () => {
  const v = viewer({mse: true});
  v.requests[0].resolve(response(200, v.live({media: mediaDescriptor()}))); await flush(); await v.openMedia();
  v.requests.at(-1).resolve(response(200, mediaIndex())); await flush();
  const request = v.requests.at(-1), delayed = deferred(); request.resolve({...response(200), body: delayedBody(delayed.promise)}); await flush();
  v.tick(1000); v.requests.at(-1).resolve(response(200, microphoneState({media: mediaDescriptor()}))); await flush();
  assert.equal(request.options.signal.aborted, true);
  delayed.resolve(mediaBytes()); await flush();
  assert.equal(v.appends.length, 0); assert.equal(v.nodes.get('video').src, undefined);
  assert.equal(v.nodes.get('musicPanel').hidden, false); assert.equal(v.nodes.get('stage').hidden, true);
});

test('MSE slow client resynchronizes from a fresh keyframe instead of appending a missing dependency', async () => {
  const v = viewer({mse: true}); await beginMedia(v); await finishMedia(v);
  v.tick(180);
  v.requests.at(-1).resolve(response(200, mediaIndex([{sequence: 12, start: 3, duration: 0.25, independent: true}]))); await flush();
  assert.equal(v.mediaSources.length, 2); assert.equal(v.appends.length, 2);
  await v.openMedia(); v.requests.at(-1).resolve(response(200, mediaIndex([{sequence: 12, start: 3, duration: 0.25, independent: true}]))); await flush();
  assert.match(v.requests.at(-1).path, /init\.mp4$/);
  v.requests.at(-1).resolve(response(200, mediaBytes())); await flush();
  assert.match(v.requests.at(-1).path, /12\.m4s$/);
});

test('MSE generation reset retains explicit sound consent only inside current authorized session', async () => {
  const v = viewer({mse: true}); await beginMedia(v); await finishMedia(v);
  v.nodes.get('soundButton').fire('click'); await flush();
  v.tick(1000); v.requests.at(-1).resolve(response(200, v.live({media: mediaDescriptor({generation: 'c601671f-573e-4cb7-9089-e154a593fcdd'})}))); await flush();
  assert.equal(v.mediaSources.length, 2); assert.equal(v.nodes.get('video').muted, false);
  await v.openMedia(); v.requests.at(-1).resolve(response(401)); await flush();
  assert.equal(v.nodes.get('video').src, undefined); assert.equal(v.nodes.get('viewer').hidden, true);
  assert.equal(v.nodes.get('video').muted, true);
});

test('MSE seeks bounded live backlog near 0.4s behind shared A/V buffer edge', async () => {
  const v = viewer({mse: true}); await beginMedia(v);
  v.nodes.get('video').buffered = {length: 1, start: () => 0, end: () => 3};
  await finishMedia(v);
  assert.equal(v.nodes.get('video').currentTime, 2.6);
});

test('pending play promise does not block fragment fetching and stale decode falls back despite fresh state', async () => {
  for (const pendingPlay of [true, false]) {
    const v = viewer({mse: true});
    if (pendingPlay) v.nodes.get('video').playPromise = new Promise(() => {});
    await beginMedia(v); await finishMedia(v);
    v.tick(180); assert.equal(v.requests.at(-1).path, '/media/index');
    v.requests.at(-1).resolve(response(200, mediaIndex())); await flush();
    assert.equal(v.nodes.get('video').plays, 1, 'No repeated autoplay attempts per fragment');
    v.advance(4500); v.tick(1000);
    v.requests.at(-1).resolve(response(200, v.live({media: mediaDescriptor({updatedAt: 1004.5})}))); await flush();
    v.interval(); await flush();
    assert.equal(v.nodes.get('video').src, undefined); assert.equal(v.nodes.get('screen').src, '/stream.mjpeg');
    assert.match(v.nodes.get('mediaNote').textContent, /无声音/);
  }
});

test('autoplay refusal waits for explicit gesture, without repeated play attempts or false decode failure', async () => {
  const v = viewer({mse: true}); v.nodes.get('video').playDenied = true;
  await beginMedia(v); await finishMedia(v);
  v.advance(4500); v.tick(1000); v.requests.at(-1).resolve(response(200, v.live({media: mediaDescriptor({updatedAt: 1004.5})}))); await flush();
  v.interval(); assert.ok(v.nodes.get('video').src); assert.equal(v.nodes.get('video').plays, 1);
  assert.equal(v.nodes.get('video').muted, true); assert.equal(v.nodes.get('soundButton').hidden, false);
});

test('temporary media transport failure uses bounded cooldown then recovers the same generation', async () => {
  for (const failure of ['timeout', 'capacity']) {
    const v = viewer({mse: true});
    v.requests[0].resolve(response(200, v.live({media: mediaDescriptor()}))); await flush(); await v.openMedia();
    if (failure === 'capacity') v.requests.at(-1).resolve(response(429)); else v.tick(2500);
    await flush();
    assert.equal(v.nodes.get('screen').src, '/stream.mjpeg');
    v.tick(1000); v.requests.at(-1).resolve(response(200, v.live({media: mediaDescriptor()}))); await flush();
    assert.equal(v.mediaSources.length, 1, 'Cooldown prevents immediate retry');
    v.advance(2100); v.tick(1000); v.requests.at(-1).resolve(response(200, v.live({media: mediaDescriptor({updatedAt: 1002.1})}))); await flush();
    assert.equal(v.mediaSources.length, 2); await v.openMedia();
    v.requests.at(-1).resolve(response(200, mediaIndex())); await flush();
    v.requests.at(-1).resolve(response(200, mediaBytes())); await flush(); await finishMedia(v);
    assert.equal(v.nodes.get('video').hidden, false);
  }
});

test('temporary media backoff caps at eight seconds without permanently disabling a recovered generation', async () => {
  const v = viewer({mse: true}); let elapsed = 0;
  v.requests[0].resolve(response(200, v.live({media: mediaDescriptor()}))); await flush(); await v.openMedia();
  for (const [attempt, cooldown] of [2000, 4000, 8000, 8000].entries()) {
    v.requests.at(-1).resolve(response(503)); await flush();
    v.advance(cooldown - 1); elapsed += cooldown - 1;
    v.tick(1000); v.requests.at(-1).resolve(response(200, v.live({media: mediaDescriptor({updatedAt: 1000 + elapsed / 1000})}))); await flush();
    assert.equal(v.mediaSources.length, attempt + 1);
    v.advance(1); elapsed++;
    v.tick(1000); v.requests.at(-1).resolve(response(200, v.live({media: mediaDescriptor({updatedAt: 1000 + elapsed / 1000})}))); await flush();
    assert.equal(v.mediaSources.length, attempt + 2); await v.openMedia();
  }
  v.requests.at(-1).resolve(response(200, mediaIndex(undefined, {updatedAt: 1000 + elapsed / 1000}))); await flush();
  v.requests.at(-1).resolve(response(200, mediaBytes())); await flush(); await finishMedia(v);
  assert.equal(v.nodes.get('video').hidden, false);
});

test('expired transport retry followed by MediaSource or object URL failure enters hard fallback without recursion', async () => {
  for (const failure of ['failConstructor', 'failURL']) {
    const v = viewer({mse: true});
    v.requests[0].resolve(response(200, v.live({media: mediaDescriptor()}))); await flush(); await v.openMedia();
    v.requests.at(-1).resolve(response(429)); await flush();
    v.mediaConstruction[failure] = true;
    v.advance(2100); v.tick(1000);
    v.requests.at(-1).resolve(response(200, v.live({media: mediaDescriptor({updatedAt: 1002.1})}))); await flush();
    assert.equal(v.mediaConstruction.attempts, 2, 'Exactly one constructor attempt at the retry deadline');
    assert.equal(v.mediaConstruction.urlAttempts, failure === 'failConstructor' ? 1 : 2);
    assert.equal(v.nodes.get('video').src, undefined);
    assert.equal(v.nodes.get('screen').src, '/stream.mjpeg');
    assert.equal(v.nodes.get('mediaNote').hidden, false);
    assert.match(v.nodes.get('mediaNote').textContent, /兼容画面，无声音/);
    v.advance(1000); v.tick(1000);
    v.requests.at(-1).resolve(response(200, v.live({media: mediaDescriptor({updatedAt: 1003.1})}))); await flush();
    assert.equal(v.mediaConstruction.attempts, 2, 'Same-generation polling does not retry a hard construction failure');
  }
});

test('receiver hides technical caption but retains consent, safety warnings and collapsed help', () => {
  assert.match(html, /<div class="screen-caption" hidden aria-hidden="true"><span id="streamMode">/);
  assert.match(html, /id="dimensions"/);
  const consent = html.match(/<input id="pairConsent"[^>]*>/)?.[0];
  assert.ok(consent);
  assert.match(consent, /\brequired\b/);
  assert.doesNotMatch(consent, /\bchecked\b/);
  const footer = html.slice(html.indexOf('<footer>'));
  const visibleWarnings = footer.slice(0, footer.indexOf('<details'));
  assert.match(visibleWarnings, /仅停车时使用/);
  assert.match(visibleWarnings, /HTTP 未加密.*可信热点或 Wi-Fi/);
  const help = footer.match(/<details[^>]*>/)?.[0];
  assert.ok(help);
  assert.doesNotMatch(help, /\bopen\b/);
  assert.match(footer, /<summary>使用说明<\/summary>/);
  assert.match(footer, /歌词来自 LRCLIB/);
  assert.match(footer, /不保证录音版本匹配或播放同步/);
});

test('receiver HTML describes foreground Tesla BLE lyrics, not the retired microphone route', () => {
  assert.match(html, /<title>Cabin Direct · 歌词与投屏<\/title>/);
  assert.match(html, /aria-label="Cabin Direct 歌词与投屏首页"/);
  assert.match(html, /<small>歌词与画面，连接你的 iPhone。<\/small>/);
  assert.match(html, /id="musicPanel"[^>]*aria-label="歌曲信息与歌词"/);
  const footer = html.slice(html.indexOf('<footer>'));
  for (const disclosure of ['Tesla BLE（蓝牙）', '曲目与播放进度', 'Monitor 配对',
    '发出请求不代表配对成功', '不控制车辆', '不使用麦克风或屏幕广播',
    '保持 Cabin 在手机前台', '进入后台会停止歌词会话', '手机热点', '同一 Wi-Fi',
    '歌词来自 LRCLIB，获取需要联网', '不保证录音版本匹配或播放同步', '仍需实车验证']) {
    assert.ok(footer.includes(disclosure), `Missing receiver disclosure: ${disclosure}`);
  }
  assert.doesNotMatch(html, /iPhone 麦克风识别|通过.*麦克风识别车内|独立音乐识别与歌词|锁屏持续|完美同步/);
});

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

test('live receiver shows curated guidance, never raw diagnostic messages or DEMO provenance', async () => {
  const v = viewer();
  const diagnostic = 'INTERNAL raw audio_count=99 frame_age=3 <script>diagnostic</script>';
  v.requests[0].resolve(response(200, v.live({ source: 'visible-screen', message: diagnostic }))); await flush();
  assert.equal(v.nodes.get('demoBanner').hidden, true);
  assert.equal(v.nodes.get('viewerTitle').textContent, '本地屏幕共享');
  assert.equal(v.nodes.get('captureNote').textContent, '正在接收手机画面。');
  assert.equal(v.nodes.get('textNote').textContent, '屏幕文字，非同步歌词。');
  for (const [captureState, expected] of [['paused', '请在 iPhone 恢复共享。'], ['ended', '请在 iPhone 开始共享。']]) {
    v.tick(1000);
    v.requests.at(-1).resolve(response(200, v.live({ source: 'visible-screen', captureState, message: diagnostic }))); await flush();
    assert.equal(v.nodes.get('captureNote').textContent, expected);
  }
  assert.ok([...v.nodes.values()].every(node => !node.textContent.includes(diagnostic)));
});

test('receiver errors preserve actionable capacity guidance without exposing technical exceptions', async () => {
  const offline = viewer();
  offline.requests[0].reject(new Error('INTERNAL TypeError: fetch failed with diagnostic fields')); await flush();
  assert.equal(offline.nodes.get('captureNote').textContent, '请检查 iPhone 与本页是否连接到同一热点或 Wi-Fi。');
  const full = viewer();
  full.requests[0].resolve(response(429)); await flush();
  assert.equal(full.nodes.get('captureNote').textContent, '连接数量已达上限，请关闭其他接收页面。');
});

test('disconnect clears content, aborts pending state, and ignores late state JSON', async () => {
  const v = viewer(); await startLive(v);
  v.tick(1000); const pendingState = v.requests.at(-1), json = deferred();
  pendingState.resolve({ ...response(200), body: delayedBody(json.promise) }); await flush();
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
  frame.resolve({ ...response(200), body: delayedBody(blob.promise) }); await flush();
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
const microphoneState = (extra = {}) => ({ source: 'microphone-lyrics', captureState: 'waiting', frameUpdatedAt: 0, width: 0, height: 0, lyricState: 'disabled', lyricLines: [], music: music(), ...extra });
const teslaState = (extra = {}) => microphoneState({ source: 'tesla-ble-lyrics', music: music({ source: 'tesla-ble' }), ...extra });

test('Tesla BLE lyrics display vehicle provenance and never start image or media playback', async () => {
  const v = viewer({mse: true});
  v.requests[0].resolve(response(200, teslaState({captureState: 'live', width: 960, height: 540,
    frameUpdatedAt: 1000, media: mediaDescriptor()}))); await flush();
  assert.equal(v.nodes.get('stage').hidden, true); assert.equal(v.nodes.get('screenModes').hidden, true);
  assert.equal(v.nodes.get('musicPanel').hidden, false);
  assert.equal(v.nodes.get('musicTitle').textContent, 'Track'); assert.equal(v.nodes.get('musicArtist').textContent, 'Artist');
  assert.equal(v.nodes.get('musicSource').textContent, 'Tesla蓝牙');
  assert.equal(v.nodes.get('musicPosition').textContent, '约 1:12');
  assert.equal(v.nodes.get('musicLines').children[0].textContent, 'Music lyric');
  assert.match(v.nodes.get('musicNote').textContent, /LRCLIB.*车辆进度.*估算.*漂移.*不保证歌词版本/);
  assert.match(v.nodes.get('captureNote').textContent, /蓝牙.*Tesla.*播放进度.*不共享屏幕/);
  v.nodes.get('screen').fire('error'); v.nodes.get('video').fire('error'); v.modes[0].fire('click');
  v.nodes.get('soundButton').fire('click'); v.interval(); await flush();
  assert.equal(v.nodes.get('screen').src, undefined); assert.equal(v.nodes.get('video').src, undefined);
  assert.equal(v.mediaConstruction.attempts, 0); assert.equal(v.created, 0);
  assert.ok(v.requests.every(item => item.path === '/api/state'));
});

test('Tesla BLE observation expires after six seconds even with fresh server heartbeats', async () => {
  const v = viewer(); v.requests[0].resolve(response(200, teslaState())); await flush();
  v.advance(6000); v.tick(1000);
  v.requests.at(-1).resolve(response(200, teslaState({music: music({source: 'tesla-ble', updatedAt: 1006})}))); await flush();
  assert.equal(v.nodes.get('musicPanel').hidden, false, 'exactly six seconds remains valid');
  v.advance(1); v.interval();
  assert.equal(v.nodes.get('musicPanel').hidden, true, 'independent watchdog uses observation time');
  assert.equal(v.nodes.get('musicTitle').textContent, ''); assert.equal(v.nodes.get('musicLines').children.length, 0);
  v.tick(1000);
  v.requests.at(-1).resolve(response(200, teslaState({music: music({source: 'tesla-ble', updatedAt: 1006.001})}))); await flush();
  assert.equal(v.nodes.get('musicPanel').hidden, true, 'fresh heartbeat never renews an old vehicle observation');
  v.tick(1000);
  v.requests.at(-1).resolve(response(200, teslaState({music: music({source: 'tesla-ble', updatedAt: 1006.001, matchedAt: 1006.001})}))); await flush();
  assert.equal(v.nodes.get('musicPanel').hidden, false);
});

test('Tesla BLE waiting uses curated vehicle guidance without microphone or arbitrary diagnostics', async () => {
  const v = viewer();
  v.requests[0].resolve(response(200, teslaState({music: music({source: 'tesla-ble', status: 'waiting',
    matchedAt: 0, message: 'PRIVATE vehicle diagnostics VIN', title: 'PRIVATE old title'})}))); await flush();
  assert.equal(v.nodes.get('musicTitle').textContent, '等待车辆播放信息');
  assert.match(v.nodes.get('musicMessage').textContent, /Tesla.*Cabin.*前台.*车辆蓝牙/);
  assert.equal(v.nodes.get('musicArtist').textContent, ''); assert.equal(v.nodes.get('musicLines').children.length, 0);
  for (const node of v.nodes.values()) assert.doesNotMatch(node.textContent, /麦克风|周围音乐|扬声器|PRIVATE|VIN/);
  assert.ok(v.requests.every(item => item.path === '/api/state'));
});

test('Tesla BLE unknown providers and acoustic states are rejected without starting visual capture', async () => {
  for (const update of [
    {source: 'other'}, {source: 'tesla-ble-extra'}, {source: 'TESLA-BLE'}, {source: 'shazam'}, {source: 'manual'},
    {status: 'recognizing'}, {status: 'unavailable'}, {status: 'unknown'}, {matchedAt: 1001}, {matchedAt: null}
  ]) {
    const v = viewer({mse: true});
    v.requests[0].resolve(response(200, teslaState({captureState: 'live', width: 960, frameUpdatedAt: 1000,
      media: mediaDescriptor(), music: music({source: 'tesla-ble', ...update})}))); await flush();
    assert.equal(v.nodes.get('musicPanel').hidden, true, JSON.stringify(update));
    assert.equal(v.nodes.get('screen').src, undefined); assert.equal(v.nodes.get('video').src, undefined);
    assert.equal(v.mediaConstruction.attempts, 0); assert.ok(v.requests.every(item => item.path === '/api/state'));
  }
});

test('Tesla BLE missing timing hides lines while repeated paused observations preserve frozen lyrics', async () => {
  const v = viewer(); v.requests[0].resolve(response(200, teslaState())); await flush();
  v.advance(2000); v.tick(1000);
  v.requests.at(-1).resolve(response(200, teslaState({music: music({source: 'tesla-ble', updatedAt: 1002, matchedAt: 1002})}))); await flush();
  assert.equal(v.nodes.get('musicPosition').textContent, '约 1:12');
  assert.equal(v.nodes.get('musicLines').children[0].textContent, 'Music lyric');
  for (const update of [{status: 'matched', position: null}, {status: 'matched'}, {position: null}]) {
    v.tick(1000);
    v.requests.at(-1).resolve(response(200, teslaState({music: music({source: 'tesla-ble', updatedAt: 1002, matchedAt: 1002, ...update})}))); await flush();
    assert.equal(v.nodes.get('musicTitle').textContent, 'Track');
    assert.equal(v.nodes.get('musicLines').children.length, 0, JSON.stringify(update));
  }
});

test('Tesla BLE transition aborts old media bytes and later screen mode still works', async () => {
  const v = viewer({mse: true});
  v.requests[0].resolve(response(200, v.live({media: mediaDescriptor()}))); await flush(); await v.openMedia();
  v.requests.at(-1).resolve(response(200, mediaIndex())); await flush();
  const oldInit = v.requests.at(-1), delayed = deferred();
  oldInit.resolve({...response(200), body: delayedBody(delayed.promise)}); await flush();
  v.tick(1000); v.requests.at(-1).resolve(response(200, teslaState({media: mediaDescriptor()}))); await flush();
  assert.equal(oldInit.options.signal.aborted, true);
  delayed.resolve(mediaBytes()); await flush();
  assert.equal(v.appends.length, 0); assert.equal(v.nodes.get('video').src, undefined);
  assert.equal(v.nodes.get('stage').hidden, true);
  v.tick(1000); v.requests.at(-1).resolve(response(200, v.live({source: 'visible-screen'}))); await flush();
  assert.equal(v.nodes.get('stage').hidden, false); assert.equal(v.nodes.get('screenModes').hidden, false);
  assert.equal(v.nodes.get('screen').src, '/stream.mjpeg');
});

test('explicit microphone lyrics hides screen UI and never requests frames even with erroneous live fields', async () => {
  const v = viewer();
  v.requests[0].resolve(response(200, microphoneState({ captureState: 'live', width: 960, height: 540, frameUpdatedAt: 1000 }))); await flush();
  assert.equal(v.nodes.get('stage').hidden, true);
  assert.equal(v.nodes.get('screenModes').hidden, true);
  assert.equal(v.nodes.get('screen').src, undefined);
  assert.equal(v.nodes.get('viewerTitle').textContent, '音乐与歌词');
  assert.equal(v.nodes.get('musicPanel').hidden, false);
  assert.equal(v.nodes.get('musicLines').children[0].textContent, 'Music lyric');
  assert.match(v.nodes.get('captureNote').textContent, /麦克风.*不共享屏幕.*不读取其他应用/);
  v.nodes.get('screen').fire('error'); v.nodes.get('screen').fire('load'); v.modes[0].fire('click');
  v.advance(4500); v.interval();
  assert.equal(v.nodes.get('musicPanel').hidden, true, 'Music heartbeat freshness still expires');
  assert.equal(v.nodes.get('stage').hidden, true);
  v.tick(1000); v.requests.at(-1).resolve(response(200, microphoneState({ music: music({ updatedAt: 1004.5 }) }))); await flush();
  assert.equal(v.nodes.get('musicPanel').hidden, false);
  assert.ok(v.requests.every(item => item.path === '/api/state'));
});

test('only exact microphone source selects lyrics UI; returning to screen restores screen controls', async () => {
  for (const source of ['lyrics', 'microphone-lyrics-extra', 'MICROPHONE-LYRICS', undefined]) {
    const v = viewer(); v.requests[0].resolve(response(200, v.live({ source }))); await flush();
    assert.equal(v.nodes.get('stage').hidden, false);
    assert.equal(v.nodes.get('screenModes').hidden, false);
    assert.equal(v.nodes.get('screen').src, '/stream.mjpeg');
  }
  const v = viewer(); v.requests[0].resolve(response(200, microphoneState())); await flush();
  v.tick(1000); v.requests.at(-1).resolve(response(200, v.live({ source: 'visible-screen' }))); await flush();
  assert.equal(v.nodes.get('stage').hidden, false); assert.equal(v.nodes.get('screenModes').hidden, false);
  assert.equal(v.nodes.get('screen').src, '/stream.mjpeg');
});

test('screen-to-lyrics transition invalidates pending snapshot headers and blobs, including a later screen return', async () => {
  for (const delayed of ['headers', 'blob']) {
    const v = viewer(); await startLive(v); v.nodes.get('screen').fire('error'); await flush();
    const oldFrame = v.requests.at(-1), blob = deferred();
    assert.equal(oldFrame.path, '/frame.jpg');
    if (delayed === 'blob') { oldFrame.resolve({ ...response(200), body: delayedBody(blob.promise) }); await flush(); }
    v.tick(1000); v.requests.at(-1).resolve(response(200, microphoneState())); await flush();
    const requestCount = v.requests.length;
    v.nodes.get('screen').fire('error'); v.advance(4500); v.interval();
    assert.equal(v.requests.length, requestCount, 'Stale image events do not request another snapshot');
    assert.equal(v.nodes.get('screen').src, undefined);
    v.tick(1000); v.requests.at(-1).resolve(response(200, v.live({ source: 'visible-screen' }))); await flush();
    if (delayed === 'headers') oldFrame.resolve(response(200)); else blob.resolve({ staleScreen: true });
    await flush();
    assert.equal(v.created, 0, 'Old snapshot never obtains an object URL');
    assert.equal(v.nodes.get('screen').src, '/stream.mjpeg');
  }
});

test('microphone waiting and unavailable guidance is acoustic and curated; disconnect clears lyrics', async () => {
  const v = viewer(); v.requests[0].resolve(response(200, microphoneState({ music: music({ status: 'waiting' }) }))); await flush();
  assert.equal(v.nodes.get('musicTitle').textContent, '等待周围音乐');
  assert.match(v.nodes.get('musicMessage').textContent, /车内音响或扬声器/);
  v.tick(1000); v.requests.at(-1).resolve(response(200, microphoneState({ music: music({ status: 'unavailable', message: 'secret diagnostic' }) }))); await flush();
  assert.match(v.nodes.get('musicMessage').textContent, /麦克风权限和网络连接/);
  assert.doesNotMatch(v.nodes.get('musicMessage').textContent, /secret/);
  await v.disconnect();
  assert.equal(v.nodes.get('musicPanel').hidden, true); assert.equal(v.nodes.get('screen').src, undefined);
  assert.equal(v.requests.at(-1).path, '/api/unpair');
  assert.ok(v.requests.every(item => !['/frame.jpg', '/stream.mjpeg'].includes(item.path)));
});

test('microphone lyrics retain hidden/offline/auth failure and recognition TTL clearing', async () => {
  for (const stop of ['hidden', 'offline', 'unauthorized', 'expired', 'fetch-error', 'recognition-expired']) {
    const v = viewer(); v.requests[0].resolve(response(200, microphoneState())); await flush();
    if (stop === 'hidden') { v.document.hidden = true; v.handlers.get('visibilitychange')(); }
    else if (stop === 'offline') v.handlers.get('offline')();
    else {
      if (stop === 'recognition-expired') v.advance(31000);
      v.tick(1000);
      if (stop === 'fetch-error') v.requests.at(-1).reject(new Error('lost'));
      else if (stop === 'recognition-expired') v.requests.at(-1).resolve(response(200, microphoneState({ music: music({ updatedAt: 1031 }) })));
      else v.requests.at(-1).resolve(response(stop === 'expired' ? 410 : 401));
    }
    await flush();
    assert.equal(v.nodes.get('musicPanel').hidden, true, stop);
    assert.equal(v.nodes.get('musicLines').children.length, 0, stop);
    assert.equal(v.nodes.get('screen').src, undefined, stop);
    assert.ok(v.requests.every(item => item.path === '/api/state'), stop);
  }
});

test('music is a separate opt-in panel: fresh audio survives stale video, never becomes OCR', async () => {
  const v = viewer();
  v.requests[0].resolve(response(200, v.live({ frameUpdatedAt: 0, music: music() }))); await flush();
  assert.equal(v.nodes.get('screen').hidden, true);
  assert.equal(v.nodes.get('lines').children.length, 0);
  assert.equal(v.nodes.get('musicPanel').hidden, false);
  assert.equal(v.nodes.get('musicTitle').textContent, 'Track');
  assert.equal(v.nodes.get('musicArtist').textContent, 'Artist');
  assert.equal(v.nodes.get('musicSource').textContent, '自动识曲');
  assert.equal(v.nodes.get('musicPosition').textContent, '约 1:12');
  assert.equal(v.nodes.get('musicLines').children[0].textContent, 'Music lyric');
  assert.match(v.nodes.get('musicNote').textContent, /LRCLIB.*估算显示.*可能不同步/);
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
  assert.equal(v.nodes.get('musicMessage').textContent, '');
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
  assert.equal(v.nodes.get('musicSource').textContent, '手动选曲');
  v.tick(1000); v.requests.at(-1).resolve(response(200, v.live({ music: music({ status: 'no-lyrics' }) }))); await flush();
  assert.equal(v.nodes.get('musicTitle').textContent, 'Track');
  assert.equal(v.nodes.get('musicLines').children.length, 0);
  assert.match(v.nodes.get('musicNote').textContent, /LRCLIB 暂无匹配歌词/);
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
  assert.equal(v.nodes.get('musicMessage').textContent, '请在 iPhone 检查识曲设置，或手动选曲。');
});

test('music states expose only short curated actions rather than arbitrary service messages', async () => {
  for (const [status, message] of [
    ['waiting', '请在手机播放音乐，并开启识曲。'], ['recognizing', '请保持音乐播放。'],
    ['matched', ''], ['loading', ''], ['lyrics', ''], ['no-lyrics', '']
  ]) {
    const v = viewer();
    v.requests[0].resolve(response(200, v.live({ source: 'visible-screen', music: music({ status, message: 'INTERNAL diagnostics should not render' }) }))); await flush();
    assert.equal(v.nodes.get('musicPanel').hidden, false, status);
    assert.equal(v.nodes.get('musicMessage').textContent, message, status);
    assert.ok([...v.nodes.values()].every(node => !node.textContent.includes('INTERNAL')), status);
  }
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
