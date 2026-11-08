import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

// Local synthetic input only: this server never opens a network client, captures
// media, calls Shazam/LRCLIB, or changes the production receiver source assets.
export const FIXTURE_BANNER = 'SIMULATED INPUT / 非 iPhone、Shazam 或实车验证';
export const SCENARIOS = Object.freeze([
  'waiting', 'recognizing', 'matched', 'loading', 'lyrics', 'no-lyrics',
  'no-match', 'no-audio', 'unavailable', 'manual', 'paused', 'stale',
  'expired', 'hostile-text', 'long-text'
]);
const COOKIE = 'cabin_fixture=synthetic-local-only';
const MAX_BODY = 4096;
const SYNTHETIC_MESSAGE = '合成测试输入；未调用 iPhone、ShazamKit 或 LRCLIB，非实车验证。';
const ORIGINAL_LINES = Object.freeze([
  '窗边的小灯画一圈暖光',
  '纸上的小船静静等天亮',
  '我们把今天折成一颗星',
  '留给明天慢慢欣赏'
]);
const CONTROL_SCRIPT = `(() => {
  'use strict';
  const form = document.getElementById('fixtureForm');
  const output = document.getElementById('fixtureResult');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = document.getElementById('fixtureApply');
    button.disabled = true;
    try {
      const response = await fetch('/__fixture/scenario', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(new FormData(form)).toString()
      });
      if (!response.ok) throw new Error('fixture control rejected');
      const result = await response.json();
      output.textContent = '已应用合成场景：' + result.scenario + '（接收端下次轮询生效；过期后需重新配对）';
    } catch (_) { output.textContent = '合成场景切换失败；未修改接收端。'; }
    finally { button.disabled = false; }
  });
})();
`;

function fixtureMarkup() {
  return `<section id="fixtureBanner" aria-label="合成输入验证工具" style="position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#a0001b;color:#fff;border:5px solid #ffe600;padding:10px 16px;box-sizing:border-box;font:16px/1.4 system-ui;max-height:42vh;overflow:auto">
<strong style="display:block;color:#ffe600;font-size:20px">${FIXTURE_BANNER}</strong>
<p style="margin:4px 0">仅验证原版网页接收端；不证明识曲、歌词服务、手机或车辆可用。合成配对码：123456。所有歌词均为原创测试文字。</p>
<form id="fixtureForm" method="post" action="/__fixture/scenario" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><label for="fixtureScenario">合成场景</label><select id="fixtureScenario" name="scenario" style="background:#fff;color:#111;font:inherit">${SCENARIOS.map(name => `<option value="${name}">${name}</option>`).join('')}</select><button id="fixtureApply" type="submit" style="background:#ffe600;color:#111;font:inherit">应用（不重载接收端）</button><output id="fixtureResult" role="status">当前：waiting · 显示来源标签也是模拟输入</output></form>
</section><div aria-hidden="true" style="height:180px"></div><script src="/__fixture/control.js" defer></script>`;
}

function stateFor(scenario, now) {
  const timestamp = now() / 1000;
  const music = { source: 'shazam', status: 'waiting', title: '', artist: '',
    lines: [], position: 0, updatedAt: timestamp, matchedAt: 0,
    message: SYNTHETIC_MESSAGE };
  const state = { source: 'demo', captureState: 'broadcasting',
    frameUpdatedAt: 0, width: 0, height: 0, lyricUpdatedAt: 0,
    lyricState: 'disabled', lyricLines: [], music,
    message: `${FIXTURE_BANNER}；音频面板合成输入，无视频或屏幕捕获。` };
  if (['matched', 'loading', 'lyrics', 'no-lyrics', 'manual', 'stale', 'hostile-text', 'long-text'].includes(scenario)) {
    Object.assign(music, { status: scenario === 'matched' || scenario === 'loading' || scenario === 'no-lyrics' ? scenario : 'lyrics',
      title: '窗边的小灯（原创合成测试曲）', artist: 'Cabin Synthetic Fixture / 非真实艺人',
      matchedAt: timestamp, position: 72 });
  }
  if (['lyrics', 'manual', 'stale'].includes(scenario)) music.lines = [...ORIGINAL_LINES];
  if (scenario === 'recognizing') music.status = 'recognizing';
  if (scenario === 'matched') music.message += ' 未启用歌词查询同意；无歌词返回。';
  if (scenario === 'loading') music.message += ' 仅模拟歌词查询中，未发出网络请求。';
  if (scenario === 'no-lyrics') music.message += ' 仅模拟无歌词结果。';
  if (scenario === 'no-match') music.message += ' 模拟没有识别结果（no-match 映射 waiting）。';
  if (scenario === 'no-audio') music.message += ' 模拟没有应用音频（no-audio 映射 waiting）。';
  if (scenario === 'unavailable') { music.status = 'unavailable'; music.message += ' 模拟服务不可用；标题和歌词已清除。'; }
  if (scenario === 'manual') { music.source = 'manual'; music.message += ' 模拟手动选曲。'; }
  if (scenario === 'paused') { state.captureState = 'paused'; music.message += ' 模拟暂停；标题和歌词已清除。'; }
  if (scenario === 'stale') { music.updatedAt -= 60; music.matchedAt -= 60; music.message += ' 模拟过期状态，接收端应隐藏旧内容。'; }
  if (scenario === 'hostile-text') {
    music.title = '<img src=x onerror="globalThis.fixtureInjection=true">';
    music.artist = '<script>globalThis.fixtureInjection=true</script>';
    music.lines = ['<svg onload="globalThis.fixtureInjection=true">', '<a href="javascript:alert(1)">仅应显示为文字</a>'];
  }
  if (scenario === 'long-text') {
    music.title = '原创合成测试长标题'.repeat(60);
    music.artist = '非真实艺人'.repeat(80);
    music.lines = Array.from({ length: 40 }, (_, index) => `原创测试行 ${index + 1}：${'只验证文字边界'.repeat(50)}`);
    music.message += ' 输入超出200字和24行，接收端应截断。';
  }
  return state;
}

function bodyObject(request, expectedType) {
  return new Promise((resolve, reject) => {
    let bytes = 0, chunks = [], rejected = false;
    const fail = status => { if (!rejected) { rejected = true; chunks = []; reject(Object.assign(new Error('Invalid fixture body'), { status })); } };
    const length = request.headers['content-length'];
    if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > MAX_BODY)) fail(413);
    request.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > MAX_BODY) fail(413);
      if (!rejected) chunks.push(chunk);
    });
    request.on('error', () => fail(400));
    request.on('end', () => {
      if (rejected) return;
      const type = (request.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        let result;
        if (type === 'application/json') result = JSON.parse(raw);
        else if (expectedType === 'control' && type === 'application/x-www-form-urlencoded') {
          const fields = [...new URLSearchParams(raw)];
          if (fields.length !== 1 || fields[0][0] !== 'scenario') throw new Error('Invalid form');
          result = Object.fromEntries(fields);
        } else { fail(415); return; }
        if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Invalid object');
        resolve(result);
      } catch (_) { fail(400); }
    });
  });
}

export function createMusicFixtureServer({ now = Date.now } = {}) {
  const assets = new Map(['index.html', 'direct.js', 'direct.css'].map(name => [name,
    readFileSync(new URL(`../ios/StandaloneWeb/${name}`, import.meta.url))]));
  const sourceAssets = Object.fromEntries([...assets].map(([name, bytes]) => [name,
    { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }]));
  const html = assets.get('index.html').toString('utf8').replace('<body>', `<body>${fixtureMarkup()}`);
  let origin, scenario = 'waiting', authenticated = false;
  const counts = { requests: 0, stateReads: 0, pairs: 0, unpairs: 0, scenarioChanges: 0 };
  const server = http.createServer(async (request, response) => {
    counts.requests++;
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const send = (status, value, type = 'application/json; charset=utf-8') => {
      response.statusCode = status;
      if (status === 204) { response.end(); return; }
      response.setHeader('Content-Type', type);
      response.end(typeof value === 'object' && !Buffer.isBuffer(value) ? JSON.stringify(value) : value);
    };
    const hostCount = request.rawHeaders.filter((value, index) => index % 2 === 0 && value.toLowerCase() === 'host').length;
    if (!origin || hostCount !== 1 || request.headers.host !== origin.slice('http://'.length)) {
      send(403, { error: 'Loopback Host required' }); return;
    }
    const route = request.url;
    const reads = new Set(['/', '/index.html', '/direct.js', '/direct.css', '/__fixture/control.js', '/__fixture/status', '/api/state', '/frame.jpg', '/stream.mjpeg']);
    const writes = new Set(['/api/pair', '/api/unpair', '/__fixture/scenario']);
    if (!reads.has(route) && !writes.has(route)) { send(404, { error: 'Unknown fixture path' }); return; }
    if (request.method !== (writes.has(route) ? 'POST' : 'GET')) { send(405, { error: 'Method not allowed' }); return; }
    if (writes.has(route) && request.headers.origin !== origin) { send(403, { error: 'Exact local Origin required' }); return; }
    const hasCookie = authenticated && (request.headers.cookie || '').split(';').some(value => value.trim() === COOKIE);
    try {
      if (route === '/' || route === '/index.html') { send(200, html, 'text/html; charset=utf-8'); return; }
      if (route === '/direct.js' || route === '/direct.css') {
        send(200, assets.get(route.slice(1)), route.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8'); return;
      }
      if (route === '/__fixture/control.js') { send(200, CONTROL_SCRIPT, 'text/javascript; charset=utf-8'); return; }
      if (route === '/__fixture/status') { send(200, { simulated: true, scenario, counts: { ...counts } }); return; }
      if (route === '/api/pair') {
        const body = await bodyObject(request, 'pair');
        if (Object.keys(body).length !== 1 || typeof body.code !== 'string') { send(400, { error: 'Invalid fixture pairing action' }); return; }
        if (body.code !== '123456') { send(403, { error: 'Wrong synthetic code' }); return; }
        if (scenario === 'expired') { send(410, { error: 'Synthetic session expired' }); return; }
        authenticated = true; counts.pairs++;
        response.setHeader('Set-Cookie', `${COOKIE}; Path=/; HttpOnly; SameSite=Strict`);
        send(200, { paired: true, simulated: true }); return;
      }
      if (route === '/api/unpair') {
        if (request.headers['transfer-encoding'] || Number(request.headers['content-length'] || 0) !== 0) { send(400, { error: 'Unpair accepts no body' }); return; }
        authenticated = false; counts.unpairs++;
        response.setHeader('Set-Cookie', 'cabin_fixture=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict');
        send(204); return;
      }
      if (route === '/__fixture/scenario') {
        const body = await bodyObject(request, 'control');
        if (Object.keys(body).length !== 1 || !SCENARIOS.includes(body.scenario)) { send(400, { error: 'Unknown synthetic scenario' }); return; }
        scenario = body.scenario; counts.scenarioChanges++;
        send(200, { simulated: true, scenario }); return;
      }
      if (!hasCookie) { send(401, { error: 'Synthetic pairing required' }); return; }
      if (route === '/api/state') {
        counts.stateReads++;
        if (scenario === 'expired') { send(410, { error: 'Synthetic session expired' }); return; }
        send(200, stateFor(scenario, now)); return;
      }
      send(204); // No images, dummy streams, or fabricated capture frames.
    } catch (error) { send(error.status || 500, { error: 'Fixture request rejected' }); }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.keepAliveTimeout = 1000;
  return {
    sourceAssets,
    async listen() {
      if (!origin) {
        await new Promise((resolve, reject) => {
          server.once('error', reject);
          server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
        });
        origin = `http://127.0.0.1:${server.address().port}`;
      }
      return { origin, address: '127.0.0.1', port: server.address().port };
    },
    async close() {
      if (!server.listening) return;
      await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
        server.closeIdleConnections();
        server.closeAllConnections();
      });
    }
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 2) {
    process.stderr.write('No arguments accepted: loopback-only random-port synthetic fixture server.\n');
    process.exitCode = 1;
  } else {
    const fixture = createMusicFixtureServer();
    const address = await fixture.listen();
    const shutdown = async () => { await fixture.close(); process.exitCode = 0; };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
    // Announce readiness only after shutdown handlers are installed. A caller
    // may immediately stop the fixture as soon as it receives this first line.
    process.stdout.write(`${JSON.stringify({ ...address, simulated: true, banner: FIXTURE_BANNER, sourceAssets: fixture.sourceAssets })}\n`);
  }
}
