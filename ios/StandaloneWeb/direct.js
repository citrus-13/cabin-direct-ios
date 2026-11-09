(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const screen = $('screen');
  let paired = false, failures = 0, streamActive = false, snapshotMode = false;
  let objectURL = null, pollTimer = null, lastLiveAt = 0, snapshotBusy = null, generation = 0, streamWatchdog = null;
  let enabled = true, epoch = 0, pollBusy = null, loggingOut = false;
  let musicFreshness = null, lyricsOnly = false;
  const pending = new Set();
  try { enabled = sessionStorage.getItem('cabin-disconnected') !== '1'; } catch (_) {}
  const current = version => enabled && epoch === version;
  function status(text, live = false) { $('status').textContent = text; $('statusDot').classList.toggle('live', live); }
  function clearImage(title = '等待手机画面', message = '请保持广播或演示运行。暂停或断开后，画面会自动隐藏。') {
    generation++; clearTimeout(streamWatchdog); screen.hidden = true; screen.removeAttribute('src'); streamActive = false;
    if (objectURL) { URL.revokeObjectURL(objectURL); objectURL = null; }
    $('empty').hidden = false; $('emptyTitle').textContent = title; $('emptyMessage').textContent = message;
    $('lines').replaceChildren(); $('textEmpty').hidden = false; $('dimensions').textContent = '';
    $('streamMode').textContent = '无新画面';
  }
  function clearMusic() {
    musicFreshness = null; $('musicPanel').hidden = true;
    for (const id of ['musicTitle', 'musicArtist', 'musicSource', 'musicPosition', 'musicNote', 'musicMessage']) $(id).textContent = '';
    $('musicLines').replaceChildren();
  }
  function musicIsFresh(music) {
    const now = Date.now() / 1000;
    const recent = value => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= now;
    if (!recent(music.updatedAt) || now - music.updatedAt > 4) return false;
    return !['matched', 'loading', 'lyrics', 'no-lyrics'].includes(music.status) ||
      (recent(music.matchedAt) && now - music.matchedAt <= (music.source === 'manual' ? 600 : 30));
  }
  function displayMusic(state) {
    const music = state.music;
    clearMusic();
    if (!music || !['shazam', 'manual'].includes(music.source) ||
        !['waiting', 'recognizing', 'matched', 'loading', 'lyrics', 'no-lyrics', 'unavailable'].includes(music.status) ||
        ['paused', 'ended', 'stopped', 'error'].includes(state.captureState) || !musicIsFresh(music)) return;
    musicFreshness = { status: music.status, source: music.source, updatedAt: music.updatedAt, matchedAt: music.matchedAt };
    const text = value => typeof value === 'string' ? value.slice(0, 200) : '';
    const hasTrack = ['matched', 'loading', 'lyrics', 'no-lyrics'].includes(music.status);
    $('musicPanel').hidden = false;
    $('musicSource').textContent = music.source === 'manual' ? '手动选曲' : '自动识曲';
    $('musicTitle').textContent = hasTrack ? text(music.title) : music.status === 'unavailable' ? '识曲服务不可用' : music.status === 'recognizing' ? '正在识别音乐' : lyricsOnly ? '等待周围音乐' : '等待应用音频';
    $('musicArtist').textContent = hasTrack ? text(music.artist) : '';
    if (hasTrack && typeof music.position === 'number' && Number.isFinite(music.position) && music.position >= 0 && music.position <= 86400) {
      const seconds = Math.floor(music.position);
      $('musicPosition').textContent = `约 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    }
    const lines = music.status === 'lyrics' && Array.isArray(music.lines) ? music.lines.slice(0, 24).filter(line => typeof line === 'string') : [];
    $('musicLines').replaceChildren(...lines.map(line => { const node = document.createElement('p'); node.textContent = text(line); return node; }));
    $('musicNote').textContent = music.status === 'no-lyrics' ? 'LRCLIB 暂无匹配歌词。' :
      music.status === 'loading' ? '正在获取 LRCLIB 歌词。' : music.status === 'lyrics' ? '歌词：LRCLIB · 估算显示，可能不同步。' : '';
    $('musicMessage').textContent = music.status === 'unavailable' ? (lyricsOnly ? '请在 iPhone 检查麦克风权限和网络连接。' : '请在 iPhone 检查识曲设置，或手动选曲。') :
      music.status === 'waiting' ? (lyricsOnly ? '请让 iPhone 听到车内音响或扬声器播放的音乐。' : '请在手机播放音乐，并开启识曲。') : music.status === 'recognizing' ? '请保持音乐播放。' : '';
  }
  async function request(path, options = {}) {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 2500);
    pending.add(controller);
    try { return await fetch(path, {cache: 'no-store', credentials: 'same-origin', ...options, signal: controller.signal}); }
    finally { clearTimeout(timeout); pending.delete(controller); }
  }
  function showPaired() { paired = true; failures = 0; $('pairPanel').hidden = true; $('viewer').hidden = false; }
  function halt() {
    enabled = false; paired = false; epoch++; clearTimeout(pollTimer);
    for (const controller of pending) controller.abort();
    pollBusy = null; snapshotBusy = null; lastLiveAt = 0;
    clearImage(); clearMusic(); $('pairPanel').hidden = false; $('viewer').hidden = true;
    $('demoBanner').hidden = true; $('captureNote').textContent = '未连接';
  }
  function lostPairing() {
    halt(); status('需要重新配对');
    $('pairError').textContent = '会话已结束。请在手机上重新开始会话，获取新的配对码。';
  }
  async function disconnect() {
    halt(); loggingOut = true; $('pairButton').disabled = true; $('pairCode').value = '';
    $('pairConsent').checked = false; status('本页已断开');
    try { sessionStorage.setItem('cabin-disconnected', '1'); } catch (_) {}
    $('pairError').textContent = '本页已断开，手机来源继续运行。同一浏览器的其他标签页可能需要重新配对。';
    try {
      const response = await request('/api/unpair', {method: 'POST'});
      if (!response.ok) throw new Error('unpair');
    } catch (_) {
      $('pairError').textContent = '本页已停止接收；无法确认浏览器配对凭据已清除。可关闭本页，或在手机结束会话。';
    } finally { loggingOut = false; $('pairButton').disabled = false; }
  }
  async function snapshot() {
    if (snapshotBusy || !enabled || !paired || lyricsOnly) return;
    const ticket = {}; snapshotBusy = ticket;
    const version = generation, session = epoch;
    try {
      const response = await request('/frame.jpg');
      if (!current(session) || !paired || lyricsOnly || generation !== version) return;
      if (response.status === 401 || response.status === 410) { lostPairing(); return; }
      if (response.status === 204) { clearImage(); return; }
      if (!response.ok) throw new Error('snapshot');
      const blob = await response.blob();
      if (!current(session) || generation !== version || !paired || lyricsOnly) return;
      if (objectURL) URL.revokeObjectURL(objectURL);
      objectURL = URL.createObjectURL(blob); screen.src = objectURL; screen.hidden = false; $('empty').hidden = true;
      $('streamMode').textContent = '兼容模式 · 单帧刷新';
    } catch (_) { if (current(session) && generation === version) clearImage('连接暂时中断', '正在等待新画面，不显示旧内容。'); }
    finally { if (snapshotBusy === ticket) snapshotBusy = null; }
  }
  function displayFrame() {
    if (lyricsOnly) return;
    if (snapshotMode) { void snapshot(); return; }
    if (!streamActive) {
      streamActive = true; screen.src = '/stream.mjpeg'; screen.hidden = false; $('empty').hidden = true;
      $('streamMode').textContent = 'MJPEG · 正在接收';
      const session = epoch, version = generation;
      streamWatchdog = setTimeout(() => { if (current(session) && generation === version && streamActive && paired) { snapshotMode = true; clearImage('切换兼容显示', '此浏览器使用单帧显示。'); void snapshot(); } }, 3000);
    }
  }
  screen.addEventListener('load', () => clearTimeout(streamWatchdog));
  screen.addEventListener('error', () => {
    if (!enabled || !paired || lyricsOnly || !screen.hasAttribute('src')) return;
    if (!snapshotMode) { snapshotMode = true; clearImage('切换兼容显示', '此浏览器使用单帧显示。'); void snapshot(); }
    else clearImage('等待新画面', '无法读取画面，请检查手机广播。');
  });
  async function poll() {
    clearTimeout(pollTimer);
    if (!enabled || pollBusy) return;
    if (document.hidden) { schedule(3000); return; }
    if (!navigator.onLine) { disconnected(); schedule(5000); return; }
    const session = epoch, ticket = {}; pollBusy = ticket;
    try {
      const response = await request('/api/state');
      if (!current(session)) return;
      if (response.status === 401 || response.status === 410) { if (paired) lostPairing(); else { enabled = false; status('等待配对'); } return; }
      if (!response.ok) throw new Error(response.status === 429 ? '连接数量已达上限，请关闭其他接收页面。' : '无法读取手机状态。');
      const state = await response.json();
      if (!current(session)) return;
      if (document.hidden || !navigator.onLine) { clearImage('等待接收页面恢复'); clearMusic(); schedule(3000); return; }
      showPaired(); failures = 0;
      const nextLyricsOnly = state.source === 'microphone-lyrics';
      if (nextLyricsOnly !== lyricsOnly) {
        clearImage(); lastLiveAt = 0; snapshotMode = false;
      }
      lyricsOnly = nextLyricsOnly;
      $('stage').hidden = lyricsOnly; $('screenModes').hidden = lyricsOnly;
      const demo = state.source === 'demo';
      $('demoBanner').hidden = !demo;
      $('viewerTitle').textContent = lyricsOnly ? '音乐与歌词' : demo ? 'DEMO · 原创演示' : '本地屏幕共享';
      screen.alt = demo ? 'DEMO 原创合成演示画面，非真实手机屏幕' : 'iPhone 共享屏幕';
      const age = Date.now() / 1000 - Number(state.frameUpdatedAt);
      const live = ['live', 'broadcasting', 'running', 'capturing'].includes(state.captureState) && age >= -2 && age <= 4 && state.width > 0;
      displayMusic(state);
      if (lyricsOnly) {
        clearImage(); lastLiveAt = 0;
        $('captureNote').textContent = '通过 iPhone 麦克风识别周围音乐；不共享屏幕，不读取其他应用的播放信息。';
        status(musicFreshness ? '歌词模式 · 本地连接' : '歌词模式 · 等待音乐状态', true);
        schedule(1000); return;
      }
      $('captureNote').textContent = demo ? '原创合成演示，非手机画面。' : live ? '正在接收手机画面。' :
        state.captureState === 'paused' ? '请在 iPhone 恢复共享。' : '请在 iPhone 开始共享。';
      if (!live) {
        const paused = state.captureState === 'paused';
        clearImage(paused ? '来源已暂停' : '等待新画面', '旧画面与文字已隐藏，请在 iPhone 上检查广播或演示。');
        status(paused ? '已暂停' : '等待画面');
      } else {
        lastLiveAt = Date.now(); status(demo ? 'DEMO · 本地连接' : '本地连接', true); displayFrame();
        $('dimensions').textContent = `${state.width} × ${state.height}`;
        const textFresh = Date.now() / 1000 - Number(state.lyricUpdatedAt) <= 4 && Number(state.lyricUpdatedAt) <= Date.now() / 1000 + 2;
        const lines = textFresh && Array.isArray(state.lyricLines) ? state.lyricLines.slice(0, 24) : [];
        $('textHeading').textContent = demo ? 'DEMO · 原创示例文字' : '可见文字识别';
        $('textNote').textContent = demo ? '合成示例，不是实机识别结果。' : '屏幕文字，非同步歌词。';
        $('lines').replaceChildren(...lines.map(line => { const node = document.createElement('p'); node.textContent = String(line).slice(0, 200); return node; }));
        $('textEmpty').hidden = lines.length > 0;
        $('textEmpty').textContent = state.lyricState === 'disabled' ? '文字识别未开启' : '当前没有可见文字';
      }
      schedule(1000);
    } catch (error) { if (current(session)) { failures++; disconnected(); $('captureNote').textContent = error.message === '连接数量已达上限，请关闭其他接收页面。' ? error.message : '请检查 iPhone 与本页是否连接到同一热点或 Wi-Fi。'; schedule(Math.min(1000 * 2 ** failures, 10000)); } }
    finally { if (pollBusy === ticket) pollBusy = null; }
  }
  function disconnected() { if (!enabled) return; clearImage('连接已断开', '旧画面与文字已隐藏。确认手机与接收页面处于同一可信热点或 Wi-Fi，且来源仍运行。'); clearMusic(); status('连接中断 · 正在重试'); }
  function schedule(ms) { clearTimeout(pollTimer); if (enabled) pollTimer = setTimeout(poll, ms); }
  $('disconnect').addEventListener('click', () => { void disconnect(); });
  $('pairForm').addEventListener('submit', async event => {
    event.preventDefault(); if (loggingOut || $('pairButton').disabled || !$('pairConsent').checked || !/^[0-9]{6}$/.test($('pairCode').value)) return;
    enabled = true; const session = ++epoch;
    clearTimeout(pollTimer); pollBusy = null;
    for (const controller of pending) controller.abort();
    $('pairButton').disabled = true; $('pairError').textContent = '';
    try {
      const response = await request('/api/pair', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({code: $('pairCode').value})});
      if (!current(session)) return;
      if (!response.ok) throw new Error(response.status === 429 ? '错误次数已达上限，请在手机上重新开始会话。' : response.status === 410 ? '配对码已过期，请在手机上重新开始会话。' : '配对未成功，请检查手机上的六位码。');
      try { sessionStorage.removeItem('cabin-disconnected'); } catch (_) {}
      $('pairCode').value = ''; snapshotMode = false; showPaired(); void poll();
    } catch (error) { if (current(session)) { enabled = false; $('pairError').textContent = error.name === 'AbortError' ? '连接超时，请检查同一热点或 Wi-Fi。' : error.message; } }
    finally { if (epoch === session) $('pairButton').disabled = false; }
  });
  document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {
    if (lyricsOnly) return;
    $('stage').className = `stage mode-${button.dataset.mode}`;
    document.querySelectorAll('[data-mode]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  }));
  $('fontSize').addEventListener('change', () => {
    $('lines').style.fontSize = `${Number($('fontSize').value)}px`;
    $('musicLines').style.fontSize = `${Number($('fontSize').value)}px`;
    try { localStorage.setItem('cabin-font-size', $('fontSize').value); } catch (_) {}
  });
  try { const value = localStorage.getItem('cabin-font-size'); if (['32', '42', '56'].includes(value)) { $('fontSize').value = value; $('lines').style.fontSize = `${value}px`; $('musicLines').style.fontSize = `${value}px`; } } catch (_) {}
  $('fullscreen').addEventListener('click', async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen(); else $('captureNote').textContent = '此浏览器不支持全屏，请使用车机浏览器的显示设置。'; }
    catch (_) { $('captureNote').textContent = '浏览器未允许全屏，可继续使用当前显示。'; }
  });
  window.addEventListener('offline', disconnected);
  window.addEventListener('online', () => schedule(0));
  document.addEventListener('visibilitychange', () => { if (!enabled) return; if (document.hidden) { clearImage('页面已隐藏'); clearMusic(); } else schedule(0); });
  setInterval(() => {
    if (enabled && paired && !lyricsOnly && lastLiveAt && Date.now() - lastLiveAt > 4000) clearImage('画面已过期', '旧画面与文字已隐藏，正在等待新状态。');
    if (musicFreshness && !musicIsFresh(musicFreshness)) clearMusic();
  }, 500);
  if (enabled) void poll(); else status('本页已断开 · 等待手动配对');
})();
