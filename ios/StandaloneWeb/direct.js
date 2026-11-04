(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const screen = $('screen');
  let paired = false, failures = 0, streamActive = false, snapshotMode = false;
  let objectURL = null, pollTimer = null, lastLiveAt = 0, snapshotBusy = false, generation = 0, streamWatchdog = null;
  function status(text, live = false) { $('status').textContent = text; $('statusDot').classList.toggle('live', live); }
  function clearImage(title = '等待手机画面', message = '请保持广播运行。暂停或断开后，画面会自动隐藏。') {
    generation++; clearTimeout(streamWatchdog); screen.hidden = true; screen.removeAttribute('src'); streamActive = false;
    if (objectURL) { URL.revokeObjectURL(objectURL); objectURL = null; }
    $('empty').hidden = false; $('emptyTitle').textContent = title; $('emptyMessage').textContent = message;
    $('lines').replaceChildren(); $('textEmpty').hidden = false; $('dimensions').textContent = '';
  }
  async function request(path, options = {}) {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 2500);
    try { return await fetch(path, {cache: 'no-store', credentials: 'same-origin', ...options, signal: controller.signal}); }
    finally { clearTimeout(timeout); }
  }
  function showPaired() { paired = true; failures = 0; $('pairPanel').hidden = true; $('viewer').hidden = false; }
  function lostPairing() {
    paired = false; clearImage('配对已结束', '请在手机上重新启动广播并获取新的配对码。');
    $('pairPanel').hidden = false; $('viewer').hidden = true; status('需要配对');
  }
  async function snapshot() {
    if (snapshotBusy) return;
    snapshotBusy = true; const version = generation;
    try {
      const response = await request('/frame.jpg');
      if (!paired || generation !== version) return;
      if (response.status === 401 || response.status === 410) { lostPairing(); return; }
      if (response.status === 204) { clearImage(); return; }
      if (!response.ok) throw new Error('snapshot');
      const blob = await response.blob();
      if (generation !== version || !paired) return;
      if (objectURL) URL.revokeObjectURL(objectURL);
      objectURL = URL.createObjectURL(blob); screen.src = objectURL; screen.hidden = false; $('empty').hidden = true;
      $('streamMode').textContent = 'LOCAL SNAPSHOT';
    } catch (_) { if (generation === version) clearImage('连接暂时中断', '正在等待新画面，不显示旧内容。'); }
    finally { snapshotBusy = false; }
  }
  function displayFrame() {
    if (snapshotMode) { void snapshot(); return; }
    if (!streamActive) {
      streamActive = true; screen.src = '/stream.mjpeg'; screen.hidden = false; $('empty').hidden = true;
      $('streamMode').textContent = 'LOCAL LIVE SCREEN';
      streamWatchdog = setTimeout(() => { if (streamActive && paired) { snapshotMode = true; clearImage('切换兼容显示', '此浏览器使用单帧显示。'); void snapshot(); } }, 3000);
    }
  }
  screen.addEventListener('load', () => clearTimeout(streamWatchdog));
  screen.addEventListener('error', () => {
    if (!paired || !screen.hasAttribute('src')) return;
    if (!snapshotMode) { snapshotMode = true; clearImage('切换兼容显示', '此浏览器使用单帧显示。'); void snapshot(); }
    else clearImage('等待新画面', '无法读取画面，请检查手机广播。');
  });
  async function poll() {
    clearTimeout(pollTimer);
    if (document.hidden) { schedule(3000); return; }
    if (!navigator.onLine) { disconnected(); schedule(5000); return; }
    try {
      const response = await request('/api/state');
      if (response.status === 401 || response.status === 410) { if (paired) lostPairing(); schedule(3000); return; }
      if (!response.ok) throw new Error('state');
      const state = await response.json(); showPaired(); failures = 0;
      const age = Date.now() / 1000 - Number(state.frameUpdatedAt);
      const live = ['live', 'broadcasting', 'running', 'capturing'].includes(state.captureState) && age >= -2 && age <= 4 && state.width > 0;
      $('captureNote').textContent = state.message || (live ? '画面来自当前 iPhone 屏幕广播' : '广播没有可用的新画面');
      if (!live) {
        const paused = state.captureState === 'paused';
        clearImage(paused ? '广播已暂停' : '等待新画面', '旧画面与文字已隐藏，请在 iPhone 上检查屏幕广播。');
        status(paused ? '已暂停' : '等待画面');
      } else {
        lastLiveAt = Date.now(); status('本地连接', true); displayFrame();
        $('dimensions').textContent = `${state.width} × ${state.height}`;
        const textFresh = Date.now() / 1000 - Number(state.lyricUpdatedAt) <= 4 && Number(state.lyricUpdatedAt) <= Date.now() / 1000 + 2;
        const lines = textFresh && Array.isArray(state.lyricLines) ? state.lyricLines.slice(0, 24) : [];
        const vehicle = state.source === 'tesla-ble';
        document.querySelector('.text-pane .eyebrow').textContent = vehicle ? '车辆歌曲信息 + 可选网络歌词' : '可见文字识别';
        document.querySelector('.text-pane .text-note').textContent = vehicle ? '歌词来源与时间匹配需实机验证；不代表源应用当前高亮行。' : '从共享画面识别；不代表当前高亮歌词。';
        $('lines').replaceChildren(...lines.map(line => { const node = document.createElement('p'); node.textContent = String(line).slice(0, 200); return node; }));
        $('textEmpty').hidden = lines.length > 0;
        $('textEmpty').textContent = state.lyricState === 'disabled' ? '文字识别未开启' : '当前没有可见文字';
      }
      schedule(1000);
    } catch (_) { failures++; disconnected(); schedule(Math.min(1000 * 2 ** failures, 10000)); }
  }
  function disconnected() { clearImage('连接已断开', '旧画面与文字已隐藏。请确认手机与车机仍处于同一可信网络。'); status('正在等待连接'); }
  function schedule(ms) { clearTimeout(pollTimer); pollTimer = setTimeout(poll, ms); }
  $('pairForm').addEventListener('submit', async event => {
    event.preventDefault(); if (!$('pairConsent').checked || !/^[0-9]{6}$/.test($('pairCode').value)) return;
    $('pairButton').disabled = true; $('pairError').textContent = '';
    try {
      const response = await request('/api/pair', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({code: $('pairCode').value})});
      if (!response.ok) throw new Error(response.status === 429 ? '错误次数已达上限，请在手机上重新开始广播。' : response.status === 410 ? '配对码已过期，请在手机上重新开始广播。' : '配对未成功，请检查手机上的六位码。');
      $('pairCode').value = ''; snapshotMode = false; showPaired(); void poll();
    } catch (error) { $('pairError').textContent = error.name === 'AbortError' ? '连接超时，请检查同一热点或 Wi-Fi。' : error.message; }
    finally { $('pairButton').disabled = false; }
  });
  document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {
    $('stage').className = `stage mode-${button.dataset.mode}`;
    document.querySelectorAll('[data-mode]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  }));
  $('fontSize').addEventListener('change', () => {
    $('lines').style.fontSize = `${Number($('fontSize').value)}px`;
    try { localStorage.setItem('cabin-font-size', $('fontSize').value); } catch (_) {}
  });
  try { const value = localStorage.getItem('cabin-font-size'); if (['32', '42', '56'].includes(value)) { $('fontSize').value = value; $('lines').style.fontSize = `${value}px`; } } catch (_) {}
  $('fullscreen').addEventListener('click', async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen(); else $('captureNote').textContent = '此浏览器不支持全屏，请使用车机浏览器的显示设置。'; }
    catch (_) { $('captureNote').textContent = '浏览器未允许全屏，可继续使用当前显示。'; }
  });
  window.addEventListener('offline', disconnected);
  window.addEventListener('online', () => schedule(0));
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearImage('页面已隐藏'); else schedule(0); });
  setInterval(() => { if (paired && lastLiveAt && Date.now() - lastLiveAt > 4000) clearImage('画面已过期', '旧画面与文字已隐藏，正在等待新状态。'); }, 500);
  void poll();
})();
