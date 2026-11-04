import { PeerSession } from './rtc.js';
import { DEMO_LYRICS, parseLrc, lineAt, playbackPosition, freezePlayback } from './lyrics.js';

const $ = (id) => document.getElementById(id);
const write = (id, value) => { const element = $(id); if (element) element.textContent = String(value); };
const listen = (id, name, handler) => $(id)?.addEventListener(name, handler);
const query = new URLSearchParams(location.search);
const fragment = new URLSearchParams(location.hash.slice(1));
let mode = query.get('mode') === 'receiver' || location.pathname === '/receiver' ? 'receiver' : 'sender';
let session = null;
let room = null;
let stream = null;
let demoTimer = null;
let demoStart = 0;
let source = 'none';
let mediaUrl = null;
let lyricLines = DEMO_LYRICS.map((line) => ({ ...line }));
let localTitle = '连接的回响';
let localArtist = '原创演示 · 非车辆数据';
let remoteLyrics = null;
let connectedState = 'idle';
let lastStats = null;
let eventCount = 0;
let openedReceiverUrl = null;
let iceServers = [];
let stoppedTrack = null;
let connectionRequest = 0;
let sourceRequest = 0;
let manualSnapshot = null;
let metadataSnapshot = null;
let metadataActive = false;
let lyricsRequest = 0;
let lyricProvider = 'demo';
let displayPreferences = { view: 'split', size: 28, offset: 0, theme: 'light' };
try {
  const saved = JSON.parse(localStorage.getItem('cabin.display.v1') || '{}');
  if (['split', 'mirror', 'lyrics'].includes(saved.view)) displayPreferences.view = saved.view;
  if (Number.isFinite(saved.size) && saved.size >= 18 && saved.size <= 56) displayPreferences.size = saved.size;
  if (Number.isFinite(saved.offset) && Math.abs(saved.offset) <= 15) displayPreferences.offset = saved.offset;
  if (['light', 'dark'].includes(saved.theme)) displayPreferences.theme = saved.theme;
} catch { /* Private-mode storage is optional. */ }
if (['split', 'mirror', 'lyrics'].includes(query.get('view'))) displayPreferences.view = query.get('view');

function applyDisplayPreferences() {
  document.body.dataset.view = displayPreferences.view;
  document.querySelectorAll('[data-view]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.view === displayPreferences.view)));
  const card = document.querySelector('.lyric-card');
  if (card) { card.dataset.theme = displayPreferences.theme; card.style.setProperty('--lyric-size', `${displayPreferences.size}px`); }
  if ($('lyric-size')) $('lyric-size').value = displayPreferences.size;
  if ($('lyric-offset')) $('lyric-offset').value = displayPreferences.offset;
  if ($('lyric-theme')) $('lyric-theme').value = displayPreferences.theme;
  try { localStorage.setItem('cabin.display.v1', JSON.stringify(displayPreferences)); } catch { /* Optional. */ }
}

function selectPublisherLyrics() {
  metadataActive = false;
  metadataSnapshot = null;
  session?.send({ type: 'lyrics-source', source: 'publisher' });
}

function manualInputs() {
  const title = $('song-title').value.trim();
  const artist = $('song-artist').value.trim();
  const album = $('song-album').value.trim();
  const duration = Number($('song-duration').value);
  const position = Number($('song-position').value);
  if (!title || !artist || title.length > 256 || artist.length > 256 || album.length > 256
    || !Number.isFinite(duration) || duration < 0 || duration > 3600 || !Number.isFinite(position) || position < 0 || position > 86400) throw new Error('请填写歌曲名、歌手和有效的秒数。');
  return { title, artist, album, duration, position: duration ? Math.min(position, duration) : position };
}

function activateManual(metadata, playing = true) {
  const previous = manualSnapshot?.track;
  if ((previous && (previous.title !== metadata.title || previous.artist !== metadata.artist)) || (!previous && lyricProvider !== 'lrc')) { lyricLines = []; lyricProvider = 'none'; }
  selectPublisherLyrics();
  const now = Date.now();
  manualSnapshot = { track: { title: metadata.title, artist: metadata.artist, duration: metadata.duration || 0, position: metadata.position || 0, playing, sentAt: now }, receivedAt: now };
  write('source-label', '手动歌曲同步 · 音乐仍在原 App 播放');
  sendLyrics();
}

async function queryLyrics({ search = false, metadata } = {}) {
  let request = lyricsRequest;
  try {
    if (!$('allow-online-lyrics').checked) throw new Error('请先允许向 LRCLIB 查询歌曲信息，或改用 LRC 导入。');
    if (!room || !session) throw new Error('请先创建连接，再查询歌词。');
    const song = metadata || manualInputs();
    request = ++lyricsRequest;
    write('lyrics-result-status', search ? '正在搜索候选曲目…' : '正在匹配同步歌词…');
    const params = new URLSearchParams({ room: room.roomId });
    if (search) params.set('q', `${song.title} ${song.artist}`.trim());
    else {
      params.set('title', song.title); params.set('artist', song.artist);
      if (song.album) params.set('album', song.album);
      if (song.duration > 0) params.set('duration', song.duration);
    }
    const response = await fetch(`/api/lyrics?${params}`, { headers: { Authorization: `Bearer ${room.publisherToken}` }, signal: AbortSignal.timeout(12000) });
    const result = await response.json();
    if (request !== lyricsRequest || !$('allow-online-lyrics').checked) return;
    if (!response.ok) throw new Error(result.error || '歌词查询暂不可用');
    const results = $('lyric-results'); results.replaceChildren();
    if (search) {
      for (const candidate of result.results || []) {
        const button = document.createElement('button');
        button.textContent = `${candidate.track.title} · ${candidate.track.artist} · ${candidate.track.album || '专辑未知'}${candidate.hasSyncedLyrics ? ' · 有同步歌词' : ''}`;
        button.addEventListener('click', () => {
          $('song-title').value = candidate.track.title; $('song-artist').value = candidate.track.artist;
          $('song-album').value = candidate.track.album || ''; $('song-duration').value = candidate.track.duration || 0;
          queryLyrics({ metadata: { ...candidate.track, position: Number($('song-position').value) || 0 } });
        });
        results.append(button);
      }
      write('lyrics-result-status', result.results?.length ? '请选择正确的版本，再匹配歌词。' : '没有找到候选。可以导入自己的 LRC。');
      return;
    }
    const previous = manualSnapshot?.track;
    const position = previous && previous.title === song.title && previous.artist === song.artist ? playbackPosition(previous, manualSnapshot.receivedAt) : song.position || 0;
    activateManual({ ...song, duration: song.duration || result.track?.duration || 0, position }, previous?.playing ?? true);
    lyricLines = result.lines || [];
    lyricProvider = result.status === 'synced' ? 'lrclib' : 'none';
    const states = { synced: `已匹配 ${lyricLines.length} 行同步歌词。`, plain: '找到纯文本，但没有时间轴；请导入 LRC 后再同步。', instrumental: '该曲目被标记为纯音乐。', 'not-found': '没有精确匹配到歌词。请搜索候选曲目或导入 LRC。' };
    write('lyrics-result-status', states[result.status] || '查询结束');
    sendLyrics();
  } catch (error) { if (request === lyricsRequest) write('lyrics-result-status', error.name === 'TimeoutError' ? '歌词查询超时，可稍后重试或导入 LRC。' : error.message); }
}

function note(message, severity = 'info') {
  write('status-detail', message);
  const log = $('event-log');
  if (log) {
    const item = document.createElement('li');
    item.dataset.level = severity;
    item.textContent = `${new Date().toLocaleTimeString('zh-CN', { hour12: false })}  ${message}`;
    log.prepend(item);
    while (log.children.length > 7) log.lastElementChild.remove();
  }
  eventCount += 1;
}

function setState(state) {
  connectedState = state;
  const names = {
    idle: '尚未连接', waiting: '等待另一端', connecting: '正在建立连接', connected: '已建立 WebRTC 连接',
    disconnected: '连接暂时中断', failed: 'WebRTC 连接失败', closed: '连接已关闭',
    'peer-left': '另一端已离开', 'signaling-closed': '信令已断开',
  };
  write('connection-status', names[state] || state);
  if ($('connection-status')) $('connection-status').dataset.state = state;
}

function setMode(next) {
  if (next !== mode) {
    connectionRequest += 1;
    session?.close(); session = null; setState('idle'); lastStats = null;
    remoteLyrics = null;
    if ($('receiver-video')) $('receiver-video').srcObject = null;
    if (next === 'receiver') stopSource();
  }
  mode = next;
  document.body.dataset.mode = mode;
  if ($('sender-video')) $('sender-video').hidden = mode !== 'sender';
  if ($('receiver-video')) { $('receiver-video').hidden = mode !== 'receiver'; $('receiver-video').muted = true; }
  document.querySelectorAll('[data-panel]').forEach((panel) => { panel.hidden = panel.dataset.panel !== mode; });
  document.querySelectorAll('[data-mode]').forEach((button) => {
    const active = button.dataset.mode === mode;
    button.setAttribute('aria-pressed', String(active));
    button.classList.toggle('active', active);
  });
  write('mode-label', mode === 'sender' ? '发送端 · 电脑验证' : '接收端 · 车机网页');
}

function freezeReceiver() {
  if (connectedState !== 'peer-left' || remoteLyrics?.provenance !== 'tesla-ble') remoteLyrics = freezePlayback(remoteLyrics);
  if ($('receiver-video')) $('receiver-video').srcObject = null;
  if (mode === 'receiver') write('source-label', remoteLyrics?.provenance === 'tesla-ble' && connectedState === 'peer-left' ? '投屏发送端已离开 · BLE 歌词独立运行' : '连接已中断 · 歌词已暂停');
}

function showStats(stats) {
  lastStats = stats;
  write('fps-value', stats.fps == null ? '—' : stats.fps.toFixed(1));
  write('frames-value', stats.frames.toLocaleString());
  write('bytes-value', `${(stats.bytes / 1024 / 1024).toFixed(2)} MB`);
  const types = [stats.localCandidateType, stats.remoteCandidateType].filter(Boolean).join(' ↔ ');
  write('route-value', types ? `${stats.viaRelay ? 'TURN 中继' : '直连'} · ${types}` : '等待 ICE 路径');
  write('rtt-value', stats.roundTripTimeMs == null ? '—' : `${stats.roundTripTimeMs.toFixed(1)} ms`);
}

async function configureSession(credentials, role) {
  session?.close();
  lastStats = null;
  remoteLyrics = null;
  metadataSnapshot = null;
  metadataActive = false;
  if ($('receiver-video')) $('receiver-video').srcObject = null;
  if (role === 'viewer') write('source-label', '等待新房间的内容');
  const next = session = new PeerSession({ roomId: credentials.roomId, token: credentials.token, role, iceServers });
  let peerReady = false;
  next.addEventListener('state', ({ detail }) => {
    if (next !== session) return;
    setState(detail);
    if (['peer-left', 'signaling-closed', 'closed'].includes(detail)) peerReady = false;
    if (detail === 'connected') note('媒体通道已建立。帧数与流量来自浏览器实时统计。');
    if (['failed', 'peer-left', 'signaling-closed', 'closed'].includes(detail)) freezeReceiver();
    if (detail === 'failed') note('本次 ICE 连接失败：检查两端网络、浏览器能力或配置 TURN 后重试。', 'warning');
    if (detail === 'signaling-closed') note('信令已断开，接收内容已暂停。请重新加入房间。', 'warning');
    if (detail === 'peer-left') {
      note('另一端已断开；保持页面打开，重新加入后会重新协商。', 'warning');
    }
  });
  next.addEventListener('stats', ({ detail }) => { if (next === session) showStats(detail); });
  next.addEventListener('error', ({ detail }) => { if (next === session) note(detail, 'error'); });
  next.addEventListener('peer-ready', () => { if (next !== session) return; peerReady = true; note('配对成功，正在交换 WebRTC 连接参数。'); sendLyrics(); });
  next.addEventListener('stream', async ({ detail }) => {
    if (next !== session) return;
    const video = $('receiver-video');
    if (!video) return;
    video.hidden = false;
    video.muted = true;
    video.srcObject = detail;
    try { await video.play(); }
    catch { if (next === session) note('浏览器阻止了自动播放，请点击画面上的播放键。', 'warning'); }
  });
  next.addEventListener('lyrics', ({ detail }) => {
    if (next !== session) return;
    const snapshot = { ...detail, receivedAt: Date.now() };
    if (mode === 'receiver') remoteLyrics = snapshot;
    else if (detail.provenance === 'tesla-ble') metadataSnapshot = snapshot;
    if (detail.provenance === 'tesla-ble') write('source-label', '本地 Tesla BLE 歌曲桥接 · 与投屏独立');
    else if (mode === 'receiver') write('source-label', detail.provenance === 'manual' ? '手动歌曲同步 · 非自动识别' : '远端演示 / 本地媒体');
  });
  next.addEventListener('media-status', ({ detail }) => {
    if (next !== session) return;
    metadataActive = detail.source === 'metadata';
    if (detail.state === 'connected' || detail.state === 'selected') {
      if (mode === 'receiver') remoteLyrics = null;
      if (metadataActive) metadataSnapshot = null;
    }
    if (['stale', 'disconnected'].includes(detail.state)) {
      if (mode === 'receiver') remoteLyrics = freezePlayback(remoteLyrics);
      metadataSnapshot = freezePlayback(metadataSnapshot);
      if (metadataActive) write('source-label', 'BLE 歌曲信息已中断 · 歌词暂停，等待恢复');
    }
  });
  if (role === 'publisher') await next.setStream(stream);
  if (next !== session) return;
  await next.connect();
}

async function createRoom() {
  const request = ++connectionRequest;
  try {
    const response = await fetch('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const result = await response.json();
    if (request !== connectionRequest || mode !== 'sender') return;
    if (!response.ok) throw new Error(result.error || '无法创建配对房间');
    room = result;
    if ($('metadata-token')) $('metadata-token').value = result.metadataToken || '';
    write('room-code', result.roomId);
    const receiverUrl = new URL('/receiver', location.href);
    receiverUrl.searchParams.set('mode', 'receiver');
    receiverUrl.searchParams.set('view', displayPreferences.view);
    receiverUrl.hash = new URLSearchParams({ room: result.roomId, token: result.viewerToken });
    openedReceiverUrl = receiverUrl.href;
    if ($('receiver-link')) $('receiver-link').value = openedReceiverUrl;
    await configureSession({ roomId: result.roomId, token: result.publisherToken }, 'publisher');
    if (request !== connectionRequest || mode !== 'sender') return;
    note('房间已创建。打开接收页面后，选择演示画面或共享屏幕。');
  } catch (error) { if (request === connectionRequest) note(error.message, 'error'); }
}

async function joinRoom() {
  const roomId = ($('room-input')?.value || fragment.get('room') || '').trim();
  const token = ($('token-input')?.value || fragment.get('token') || '').trim();
  if (!roomId || !token) { note('请填写房间号与接收令牌，或使用发送端生成的完整链接。', 'warning'); return; }
  const request = ++connectionRequest;
  try {
    await configureSession({ roomId, token }, 'viewer');
    if (request !== connectionRequest || mode !== 'receiver') return;
    write('room-code', roomId);
    note('已加入房间，等待发送端提供画面。');
  } catch (error) { if (request === connectionRequest) note(error.message, 'error'); }
}

async function useStream(nextStream, kind, label) {
  const previous = stream;
  stream = nextStream;
  source = kind;
  stoppedTrack = null;
  await session?.setStream(stream);
  if ($('sender-video')) {
    $('sender-video').srcObject = stream;
    $('sender-video').muted = true;
    $('sender-video').play().catch(() => {});
  }
  previous?.getTracks().forEach((track) => track.stop());
  write('source-label', label);
}

function stopDemoTimer() { clearInterval(demoTimer); demoTimer = null; }

async function startDemo() {
  if (!window.RTCPeerConnection || !HTMLCanvasElement.prototype.captureStream) {
    note('此浏览器缺少 WebRTC 或 Canvas 采集能力，无法运行动态画面验证。', 'error'); return;
  }
  sourceRequest += 1;
  lyricsRequest += 1; selectPublisherLyrics(); manualSnapshot = null; lyricProvider = 'demo';
  stopDemoTimer();
  $('local-media')?.pause();
  const canvas = $('demo-canvas') || document.createElement('canvas');
  canvas.width = 960; canvas.height = 540;
  const context = canvas.getContext('2d');
  demoStart = performance.now();
  localTitle = '连接的回响'; localArtist = '原创演示 · 非车辆数据';
  lyricLines = DEMO_LYRICS.map((line) => ({ ...line }));
  const paint = () => {
    const t = (performance.now() - demoStart) / 1000;
    context.fillStyle = '#0a1219'; context.fillRect(0, 0, 960, 540);
    const glow = context.createRadialGradient(680, 160, 20, 680, 160, 400);
    glow.addColorStop(0, '#285b55'); glow.addColorStop(1, '#0a1219');
    context.fillStyle = glow; context.fillRect(0, 0, 960, 540);
    context.strokeStyle = '#24433e'; context.lineWidth = 1;
    for (let x = 0; x < 960; x += 60) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, 540); context.stroke(); }
    for (let y = 0; y < 540; y += 60) { context.beginPath(); context.moveTo(0, y); context.lineTo(960, y); context.stroke(); }
    context.strokeStyle = '#8ae6b4'; context.lineWidth = 3;
    context.beginPath();
    for (let x = 0; x < 960; x += 3) {
      const y = 365 + Math.sin(x / 95 + t * 1.5) * 30 + Math.cos(x / 160 - t) * 20;
      if (x === 0) context.moveTo(x, y); else context.lineTo(x, y);
    }
    context.stroke();
    const dotX = (t * 70) % 920 + 20;
    context.fillStyle = '#d8ff9b'; context.beginPath(); context.arc(dotX, 365 + Math.sin(dotX / 95 + t * 1.5) * 30 + Math.cos(dotX / 160 - t) * 20, 8, 0, Math.PI * 2); context.fill();
    context.fillStyle = '#a4c5b8'; context.font = '18px system-ui'; context.fillText('LIVE CONNECTION TEST / 原创动态测试画面', 54, 70);
    context.fillStyle = '#f4f9f5'; context.font = 'bold 58px system-ui'; context.fillText('连接，正在发生。', 54, 175);
    context.fillStyle = '#b4c9c1'; context.font = '23px system-ui'; context.fillText('这不是录屏实测，也没有连接你的车辆。', 56, 225);
    context.fillStyle = '#f0fadf'; context.font = '36px monospace'; context.fillText(`${t.toFixed(1).padStart(6, '0')} s`, 56, 468);
    context.font = '16px system-ui'; context.fillStyle = '#94aaa1'; context.fillText(new Date().toLocaleTimeString('zh-CN', { hour12: false }), 745, 469);
  };
  paint(); demoTimer = setInterval(paint, 1000 / 15);
  await useStream(canvas.captureStream(15), 'demo', '原创动态画面 · 目标 15 FPS');
  sendLyrics();
  note('演示源已启动：画面通过真实 WebRTC 传输，歌词通过信令同步。');
}

async function shareScreen() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    note('此浏览器不支持整屏采集。iPhone 需要原生 App，Safari 网页不能代替原生屏幕广播。', 'warning'); return;
  }
  const request = ++sourceRequest;
  try {
    const next = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 }, width: { ideal: 1280 } }, audio: true });
    if (request !== sourceRequest || mode !== 'sender') { next.getTracks().forEach((track) => track.stop()); return; }
    stopDemoTimer(); $('local-media')?.pause();
    await useStream(next, 'screen', '系统共享画面 · 是否含声音取决于所选来源');
    next.getVideoTracks()[0]?.addEventListener('ended', () => { if (stream === next) stopSource(); });
    note('系统共享已开始。浏览器提供的内容可能不包含音频。');
  } catch (error) { note(error.name === 'NotAllowedError' ? '你取消了共享，或浏览器没有获得屏幕采集权限。' : error.message, 'warning'); }
}

async function stopSource() {
  sourceRequest += 1;
  const lastTrack = currentTrack();
  stopDemoTimer();
  const previous = stream;
  stream = null; source = 'none';
  stoppedTrack = { ...lastTrack, playing: false, sentAt: Date.now() };
  previous?.getTracks().forEach((track) => track.stop());
  $('local-media')?.pause();
  if ($('sender-video')) $('sender-video').srcObject = null;
  write('source-label', '未发送画面');
  try { await session?.setStream(null); }
  catch { note('采集已停止；原媒体连接已不可用。', 'warning'); }
  sendLyrics();
}

async function loadMedia(file) {
  if (!file) return;
  if (!/^(audio|video)\//.test(file.type)) { note('请选择浏览器支持的音频或视频文件。', 'warning'); return; }
  lyricsRequest += 1; selectPublisherLyrics(); manualSnapshot = null; lyricProvider = 'none';
  const media = $('local-media');
  if (!media) return;
  await stopSource();
  if (mediaUrl) URL.revokeObjectURL(mediaUrl);
  mediaUrl = URL.createObjectURL(file);
  media.src = mediaUrl;
  localTitle = file.name.replace(/\.[^.]+$/, '');
  localArtist = '本地文件 · 未上传';
  lyricLines = [];
  source = 'local';
  media.hidden = false;
  media.load();
  write('source-label', '本地媒体 · 文件仅在此浏览器读取');
  note('本地文件已载入。点击播放；歌词请另行导入 LRC 文件。');
}

async function playLocal() {
  const media = $('local-media');
  if (!media?.src) { note('请先选择本地音频或视频。', 'warning'); return; }
  try {
    // Stop a previous desktop capture even if this browser cannot capture the local player.
    await stopSource();
    source = 'local';
    write('source-label', '本地播放 · 正在检查媒体采集能力');
    await media.play();
    const capture = media.captureStream || media.mozCaptureStream;
    if (capture) {
      const next = capture.call(media);
      if (next.getTracks().length) await useStream(next, 'local', '本地媒体 · WebRTC 发送');
      else { write('source-label', '仅本地播放 · 未发送音视频'); note('浏览器尚未生成可传输的媒体轨道；可继续本地播放。', 'warning'); }
    } else { write('source-label', '仅本地播放 · 未发送音视频'); note('当前浏览器不支持从本地播放器采集轨道，暂时仅本地播放；歌词仍可同步。', 'warning'); }
    sendLyrics();
  } catch (error) { note(`无法播放该文件：${error.message}`, 'warning'); }
}

function currentTrack() {
  const external = metadataActive ? metadataSnapshot : manualSnapshot;
  if (external) return { ...external.track, position: playbackPosition(external.track, external.receivedAt), sentAt: Date.now() };
  if (source === 'none' && stoppedTrack) return { ...stoppedTrack, sentAt: Date.now() };
  if (source === 'demo') {
    return { title: localTitle, artist: localArtist, duration: 48, position: ((performance.now() - demoStart) / 1000) % 48, playing: true, sentAt: Date.now() };
  }
  const media = $('local-media');
  return { title: localTitle, artist: localArtist, duration: Number.isFinite(media?.duration) ? media.duration : 0, position: media?.currentTime || 0, playing: source === 'local' && Boolean(media && !media.paused && !media.ended), sentAt: Date.now() };
}

function sendLyrics() {
  if (mode === 'sender' && session && !metadataActive) session.send({ type: 'lyrics', track: currentTrack(), lines: lyricLines, provenance: manualSnapshot ? 'manual' : source === 'demo' ? 'demo' : 'local', lyricProvider });
}

function renderLyrics() {
  let received = mode === 'receiver' ? remoteLyrics : metadataActive ? metadataSnapshot : { track: currentTrack(), lines: lyricLines, receivedAt: Date.now(), lyricProvider, provenance: manualSnapshot ? 'manual' : source };
  if (received?.provenance === 'tesla-ble' && received.track.playing && Date.now() - received.receivedAt > 10_000) {
    received = freezePlayback(received, received.receivedAt + 10_000);
    if (mode === 'receiver') remoteLyrics = received; else metadataSnapshot = received;
    write('source-label', 'BLE 歌曲信息过期 · 歌词已暂停');
  }
  if (!received) {
    write('lyrics-title', '等待歌曲信息'); write('lyrics-artist', '歌词同步测试');
    write('lyrics-provenance', '等待同步');
    if ($('lyrics-attribution')) $('lyrics-attribution').hidden = true;
    if ($('lyric-progress')) $('lyric-progress').value = 0;
    write('lyric-current', '连接发送端后，歌词会出现在这里'); write('lyric-next', ''); return;
  }
  const position = Math.max(0, playbackPosition(received.track, received.receivedAt) + displayPreferences.offset);
  const index = lineAt(received.lines, position);
  write('lyrics-title', received.track.title || '未命名音频');
  write('lyrics-artist', received.track.artist || '本地文件');
  write('lyric-current', received.lines[index]?.text || (received.lines.length ? '等待第一句…' : '尚未导入同步歌词'));
  write('lyric-next', received.lines[index + 1]?.text || '');
  const labels = { 'tesla-ble': 'TESLA BLE', manual: '手动同步', demo: '原创演示', local: '本地文件' };
  write('lyrics-provenance', labels[received.provenance] || 'LYRICS');
  if ($('lyrics-attribution')) $('lyrics-attribution').hidden = received.lyricProvider !== 'lrclib';
  const progress = $('lyric-progress');
  if (progress) {
    const percentage = received.track.duration > 0 ? Math.min(100, position / received.track.duration * 100) : 0;
    if (progress.tagName === 'PROGRESS') { progress.max = 100; progress.value = percentage; }
    else progress.style.width = `${percentage}%`;
  }
}

listen('create-room', 'click', createRoom);
listen('join-room', 'click', joinRoom);
listen('start-demo', 'click', () => startDemo().catch((error) => note(error.message, 'error')));
listen('share-screen', 'click', shareScreen);
listen('stop-stream', 'click', () => stopSource().then(() => note('画面已停止；手动或 BLE 歌词独立运行，配对房间仍保留。')));
listen('media-file', 'change', (event) => loadMedia(event.target.files?.[0]));
listen('local-play', 'click', playLocal);
listen('local-pause', 'click', () => { $('local-media')?.pause(); sendLyrics(); });
listen('enable-audio', 'click', async () => {
  const video = $('receiver-video');
  if (!video?.srcObject) { note('还没有接收到媒体流。', 'warning'); return; }
  try {
    video.muted = false;
    await video.play();
    note('接收端声音已开启；只有发送源包含音频轨道时才会有声音。');
  } catch { video.muted = true; note('声音播放未获允许，请使用播放器控制栏重试。', 'warning'); }
});
listen('local-media', 'seeked', sendLyrics);
listen('local-media', 'pause', sendLyrics);
listen('local-media', 'playing', sendLyrics);
listen('lyrics-file', 'change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > 256 * 1024) { note('LRC 文件请小于 256 KB。', 'warning'); return; }
  const parsed = parseLrc(await file.text());
  if (!parsed.lines.length) { note('没有找到有效的 LRC 时间戳，请使用 [00:12.34] 歌词格式。', 'warning'); return; }
  if (parsed.lines.length > 400 || parsed.lines.some((line) => line.text.length > 1000 || line.time > 86400)) {
    note('此歌词文件超过验证版限制：最多 400 行，每行 1000 字，时间不超过 24 小时。', 'warning'); return;
  }
  if ((parsed.metadata.ti?.length || 0) > 256 || (parsed.metadata.ar?.length || 0) > 256) {
    note('歌曲名或歌手信息过长，请缩短到 256 字以内。', 'warning'); return;
  }
  if (new TextEncoder().encode(JSON.stringify(parsed.lines)).byteLength > 220 * 1024) {
    note('歌词文字总量过大，请减少到 220 KB 以内再导入。', 'warning'); return;
  }
  lyricLines = parsed.lines;
  lyricsRequest += 1; selectPublisherLyrics(); lyricProvider = 'lrc';
  if (parsed.metadata.ti) localTitle = parsed.metadata.ti;
  if (parsed.metadata.ar) localArtist = parsed.metadata.ar;
  if (parsed.metadata.ti && $('song-title')) $('song-title').value = parsed.metadata.ti;
  if (parsed.metadata.ar && $('song-artist')) $('song-artist').value = parsed.metadata.ar;
  if (manualSnapshot) {
    if (parsed.metadata.ti) manualSnapshot.track.title = parsed.metadata.ti;
    if (parsed.metadata.ar) manualSnapshot.track.artist = parsed.metadata.ar;
  }
  sendLyrics(); note(`已读取 ${lyricLines.length} 行同步歌词；歌词文字会发送给配对的接收端。`);
});
listen('copy-link', 'click', async () => {
  if (!openedReceiverUrl) { note('请先创建房间。', 'warning'); return; }
  try { await navigator.clipboard.writeText(openedReceiverUrl); note('接收链接已复制。链接包含接收权限，请仅分享给自己的设备。'); }
  catch { $('receiver-link')?.select(); note('请手动复制已选中的接收链接。'); }
});
listen('open-receiver', 'click', () => {
  if (!openedReceiverUrl) { note('请先创建房间。', 'warning'); return; }
  window.open(openedReceiverUrl, '_blank', 'noopener');
});
document.querySelectorAll('[data-mode]').forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode)));
document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => { displayPreferences.view = button.dataset.view; applyDisplayPreferences(); }));
listen('lyric-size', 'input', (event) => { displayPreferences.size = Math.min(56, Math.max(18, Number(event.target.value) || 28)); applyDisplayPreferences(); });
listen('lyric-offset', 'input', (event) => { displayPreferences.offset = Math.min(15, Math.max(-15, Number(event.target.value) || 0)); applyDisplayPreferences(); });
listen('lyric-theme', 'change', (event) => { displayPreferences.theme = event.target.value === 'dark' ? 'dark' : 'light'; applyDisplayPreferences(); });
listen('fullscreen-view', 'click', async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.querySelector('.main-stage').requestFullscreen(); }
  catch { note('此浏览器不允许网页全屏；仍可使用歌词或投屏布局。', 'warning'); }
});
listen('show-metadata-token', 'click', () => { const input = $('metadata-token'); input.type = input.type === 'password' ? 'text' : 'password'; });
listen('allow-online-lyrics', 'change', (event) => {
  lyricsRequest += 1;
  $('lookup-lyrics').disabled = !event.target.checked; $('search-lyrics').disabled = !event.target.checked;
  write('lyrics-result-status', event.target.checked ? '点击匹配或搜索时才会发送歌曲信息；没有自动订阅。' : '在线查询已关闭，可以继续导入 LRC。');
});
listen('lookup-lyrics', 'click', () => queryLyrics());
listen('search-lyrics', 'click', () => queryLyrics({ search: true }));
listen('manual-sync', 'click', () => {
  try { lyricsRequest += 1; activateManual(manualInputs()); note('手动歌词时间轴已开始；音乐播放由原 App 控制。'); }
  catch (error) { note(error.message, 'warning'); }
});
listen('manual-pause', 'click', () => {
  if (!manualSnapshot || metadataActive) { note('请先启用手动同步；BLE 模式请在音乐 App 中暂停。', 'warning'); return; }
  manualSnapshot = freezePlayback(manualSnapshot);
  $('song-position').value = manualSnapshot.track.position.toFixed(1);
  sendLyrics(); note('手动歌词已暂停；原音乐 App 不受影响。');
});
listen('select-ble-source', 'click', () => { if (!session || !room) return note('请先创建连接。', 'warning'); session.send({ type: 'lyrics-source', source: 'metadata' }); });

const diagnostics = Object.freeze({
  getState: () => Object.freeze({ mode, source, connectionState: connectedState, roomId: room?.roomId || $('room-input')?.value || null,
    stats: lastStats ? Object.freeze({ ...lastStats }) : null, eventCount, lyricCount: (mode === 'receiver' ? remoteLyrics?.lines : metadataActive ? metadataSnapshot?.lines : lyricLines)?.length || 0,
    view: displayPreferences.view, metadataActive, manualSync: Boolean(manualSnapshot), lyricProvider,
    capabilities: Object.freeze({ webRTC: Boolean(window.RTCPeerConnection), canvasCapture: Boolean(HTMLCanvasElement.prototype.captureStream), screenCapture: Boolean(navigator.mediaDevices?.getDisplayMedia), secureContext: window.isSecureContext }),
  }),
});
Object.defineProperty(window, '__demoDiagnostics', { value: diagnostics, writable: false, configurable: false });

window.addEventListener('beforeunload', () => { session?.close(); stream?.getTracks().forEach((track) => track.stop()); stopDemoTimer(); if (mediaUrl) URL.revokeObjectURL(mediaUrl); });

async function init() {
  applyDisplayPreferences();
  setMode(mode); setState('idle');
  if ($('room-input')) $('room-input').value = fragment.get('room') || '';
  if ($('token-input')) $('token-input').value = fragment.get('token') || '';
  try {
    const response = await fetch('/api/config');
    if (response.ok) { const config = await response.json(); iceServers = config.iceServers || []; }
  } catch { note('未读取到连接配置，将只尝试本地直连。', 'warning'); }
  if (!window.RTCPeerConnection) note('当前浏览器不支持 WebRTC，只能查看界面与歌词。', 'warning');
  else note(iceServers.length ? '连接配置已载入；实际传输路径以 ICE 统计为准。' : '验证模式：未配置外部 STUN/TURN，仅尝试本地候选连接。');
  setInterval(sendLyrics, 500);
  setInterval(renderLyrics, 100);
  renderLyrics();
  if (mode === 'receiver' && fragment.get('room') && fragment.get('token')) await joinRoom();
}

init();
