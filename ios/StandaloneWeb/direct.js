(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const screen = $('screen');
  const video = $('video');
  let paired = false, failures = 0, streamActive = false, snapshotMode = false;
  let objectURL = null, pollTimer = null, lastLiveAt = 0, snapshotBusy = null, generation = 0, streamWatchdog = null;
  let enabled = true, epoch = 0, pollBusy = null, loggingOut = false;
  let musicFreshness = null, lyricsOnly = false, lyricIdentity = null;
  let lyricTrack = null, lyricActive = -1, lyricFollowing = true, lyricLayoutVersion = 0;
  let media = null, failedMedia = '', mediaRetryAt = Infinity, mediaRetryCount = 0, soundConsent = false;
  const mediaRequests = new Set();
  const pending = new Set();
  try { enabled = sessionStorage.getItem('cabin-disconnected') !== '1'; } catch (_) {}
  const current = version => enabled && epoch === version;
  function status(text, live = false) { $('status').textContent = text; $('statusDot').classList.toggle('live', live); }
  function clearImage(title = '等待手机画面', message = '请保持广播或演示运行。暂停或断开后，画面会自动隐藏。') {
    stopMedia();
    generation++; clearTimeout(streamWatchdog); screen.hidden = true; screen.removeAttribute('src'); streamActive = false;
    if (objectURL) { URL.revokeObjectURL(objectURL); objectURL = null; }
    $('empty').hidden = false; $('emptyTitle').textContent = title; $('emptyMessage').textContent = message;
    $('lines').replaceChildren(); $('textEmpty').hidden = false; $('dimensions').textContent = '';
    $('streamMode').textContent = '无新画面';
  }
  function clearMusic() {
    musicFreshness = null; $('musicPanel').hidden = true;
    lyricIdentity = null; $('lyricsEmpty').hidden = !lyricsOnly;
    lyricTrack = null; lyricActive = -1; lyricFollowing = true; lyricLayoutVersion++;
    $('lyricFollow').hidden = true; $('lyricViewport').scrollTop = 0;
    for (const id of ['musicTitle', 'musicArtist', 'musicSource', 'musicPosition', 'musicNote', 'musicMessage']) $(id).textContent = '';
    $('musicLines').replaceChildren();
    $('lyricSync').textContent = '等待歌词';
  }
  function currentLyric() {
    return Array.from($('musicLines').children).find(node => node.getAttribute('aria-current') === 'true');
  }
  function followLyric(smooth = true) {
    if (!lyricsOnly || !lyricFollowing || !musicFreshness || !musicIsFresh(musicFreshness)) return;
    const viewport = $('lyricViewport'), node = currentLyric();
    if (!node || !viewport.clientHeight || !node.getBoundingClientRect || !viewport.getBoundingClientRect) return;
    const rect = node.getBoundingClientRect(), bounds = viewport.getBoundingClientRect();
    // Scroll only this bounded region; never move browser focus or the outer page.
    const target = Math.max(0, Math.min(viewport.scrollHeight - viewport.clientHeight,
      viewport.scrollTop + rect.top - bounds.top - Math.max(20, (viewport.clientHeight - rect.height) * .38)));
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (typeof viewport.scrollTo === 'function') viewport.scrollTo({top: target, behavior: smooth && !reduced ? 'smooth' : 'auto'});
    else viewport.scrollTop = target;
  }
  function layoutLyrics({changedTrack, anchor} = {}) {
    const version = ++lyricLayoutVersion;
    const apply = () => {
      if (version !== lyricLayoutVersion || !lyricsOnly || !musicFreshness || !musicIsFresh(musicFreshness)) return;
      const viewport = $('lyricViewport');
      if (changedTrack) viewport.scrollTop = 0;
      else if (anchor) {
        const matches = Array.from($('musicLines').children).filter(node => node.textContent === anchor.text);
        // Text is a visual anchor only, never evidence of which line is current.
        // Ambiguous repeated lines fall back without guessing an anchor.
        if (matches.length === 1 && matches[0].getBoundingClientRect) {
          viewport.scrollTop += matches[0].getBoundingClientRect().top - anchor.top;
        }
      }
      followLyric(!changedTrack);
    };
    if (window.requestAnimationFrame) window.requestAnimationFrame(apply); else apply();
  }
  function pauseLyricFollow() {
    if (!lyricsOnly || !musicFreshness || !currentLyric()) return;
    lyricLayoutVersion++;
    lyricFollowing = false; $('lyricFollow').hidden = false;
    // Cancel any in-flight smooth scroll before the user's gesture takes over.
    const viewport = $('lyricViewport');
    if (typeof viewport.scrollTo === 'function') viewport.scrollTo({top: viewport.scrollTop, behavior: 'auto'});
  }
  function musicIsFresh(music) {
    const now = Date.now() / 1000;
    const recent = value => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= now;
    if (!recent(music.updatedAt) || now - music.updatedAt > 4) return false;
    return !['matched', 'loading', 'lyrics', 'no-lyrics'].includes(music.status) ||
      (recent(music.matchedAt) && now - music.matchedAt <= (music.source === 'tesla-ble' ? 6 : music.source === 'manual' ? 600 : 30));
  }
  function displayMusic(state, modeChanged = false) {
    const music = state.music;
    if (!music || !['shazam', 'manual', 'tesla-ble'].includes(music.source) ||
        (state.source === 'tesla-ble-lyrics' && music.source !== 'tesla-ble') ||
        (music.source === 'tesla-ble' && !['waiting', 'matched', 'loading', 'lyrics', 'no-lyrics'].includes(music.status)) ||
        !['waiting', 'recognizing', 'matched', 'loading', 'lyrics', 'no-lyrics', 'unavailable'].includes(music.status) ||
        ['paused', 'ended', 'stopped', 'error'].includes(state.captureState) || !musicIsFresh(music)) { clearMusic(); return; }
    musicFreshness = { status: music.status, source: music.source, updatedAt: music.updatedAt, matchedAt: music.matchedAt };
    const text = value => typeof value === 'string' ? value.slice(0, 200) : '';
    const hasTrack = ['matched', 'loading', 'lyrics', 'no-lyrics'].includes(music.status);
    const tesla = music.source === 'tesla-ble';
    $('musicPanel').hidden = false;
    $('lyricsEmpty').hidden = true;
    $('musicSource').textContent = tesla ? 'Tesla蓝牙' : music.source === 'manual' ? '手动选曲' : '自动识曲';
    $('musicTitle').textContent = hasTrack ? text(music.title) : tesla ? '等待车辆播放信息' : music.status === 'unavailable' ? '识曲服务不可用' : music.status === 'recognizing' ? '正在识别音乐' : lyricsOnly ? '等待周围音乐' : '等待应用音频';
    $('musicArtist').textContent = hasTrack ? text(music.artist) : '';
    const validPosition = typeof music.position === 'number' && Number.isFinite(music.position) && music.position >= 0 && music.position <= 86400;
    $('musicPosition').textContent = '';
    if (hasTrack && validPosition) {
      const seconds = Math.floor(music.position);
      $('musicPosition').textContent = `约 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    }
    const rawLines = music.status === 'lyrics' && (!tesla || validPosition) && Array.isArray(music.lines) ? music.lines : [];
    // Indices refer to the original array, never to the filtered display array.
    const active = Number.isInteger(music.activeLineIndex) && music.activeLineIndex >= 0 &&
      music.activeLineIndex < rawLines.length && music.activeLineIndex < 24 &&
      typeof rawLines[music.activeLineIndex] === 'string' && rawLines[music.activeLineIndex].trim() !== '' ? music.activeLineIndex : -1;
    const lines = rawLines.slice(0, 24).map((line, index) => ({line, index})).filter(item => typeof item.line === 'string');
    const track = JSON.stringify([music.source, text(music.title), text(music.artist)]);
    const changedTrack = track !== lyricTrack;
    const identity = JSON.stringify([track, lines]);
    const changedLines = identity !== lyricIdentity, changedActive = active !== lyricActive;
    const viewport = $('lyricViewport');
    const previousNodes = Array.from($('musicLines').children);
    const previousAnchor = lyricFollowing ? currentLyric() : previousNodes.find(node =>
      node.getBoundingClientRect && viewport.getBoundingClientRect && node.getBoundingClientRect().bottom > viewport.getBoundingClientRect().top);
    const anchor = !changedTrack && previousAnchor?.getBoundingClientRect ?
      {text: previousAnchor.textContent, top: previousAnchor.getBoundingClientRect().top} : null;
    if (identity !== lyricIdentity) {
      $('musicLines').replaceChildren(...lines.map(({line, index}) => {
        const node = document.createElement('p'); node.textContent = text(line);
        node.className = index === active ? 'lyric-line is-current' : 'lyric-line';
        if (index === active) node.setAttribute('aria-current', 'true');
        return node;
      }));
      lyricIdentity = identity;
    } else if (changedActive) {
      Array.from($('musicLines').children).forEach((node, index) => {
        const isCurrent = lines[index].index === active;
        node.className = isCurrent ? 'lyric-line is-current' : 'lyric-line';
        if (isCurrent) node.setAttribute('aria-current', 'true'); else node.removeAttribute('aria-current');
      });
    }
    lyricTrack = track; lyricActive = active;
    if (changedTrack) lyricFollowing = true;
    $('lyricFollow').hidden = lyricFollowing || active < 0;
    if (active < 0) lyricLayoutVersion++;
    else if (changedTrack || changedLines || changedActive || modeChanged) layoutLyrics({changedTrack, anchor: changedLines ? anchor : null});
    $('lyricSync').textContent = active >= 0 ? '当前句 · 估算位置' : lines.length ? '尚无当前句位置' : '等待歌词';
    $('musicNote').textContent = music.status === 'no-lyrics' ? 'LRCLIB 暂无匹配歌词。' :
      music.status === 'loading' ? '正在获取 LRCLIB 歌词。' : music.status === 'lyrics' ?
        (tesla ? '歌词：LRCLIB · 车辆进度采样间短暂估算，可能漂移；不保证歌词版本一致。' : '歌词：LRCLIB · 估算显示，可能不同步。') : '';
    $('musicMessage').textContent = tesla ?
      (music.status === 'waiting' ? '请在 Tesla 播放歌曲，并保持 iPhone 上的 Cabin 在前台与车辆蓝牙连接。' :
        !validPosition && hasTrack ? '已读取车辆曲目，等待播放进度；暂不显示歌词。' :
        music.status === 'matched' ? '已读取车辆曲目；播放状态或进度缺失时不滚动歌词。' : '') :
      music.status === 'unavailable' ? (lyricsOnly ? '请在 iPhone 检查麦克风权限和网络连接。' : '请在 iPhone 检查识曲设置，或手动选曲。') :
      music.status === 'waiting' ? (lyricsOnly ? '请让 iPhone 听到车内音响或扬声器播放的音乐。' : '请在手机播放音乐，并开启识曲。') : music.status === 'recognizing' ? '请保持音乐播放。' : '';
  }
  async function request(path, options = {}, kind = 'none', maxBytes = 65536) {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 2500);
    pending.add(controller);
    if (path.startsWith('/media/')) mediaRequests.add(controller);
    const aborted = new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(Object.assign(new Error('timeout or cancelled'), {name: 'AbortError'})), {once: true}));
    try {
      return await Promise.race([aborted, (async () => {
        const response = await fetch(path, {cache: 'no-store', credentials: 'same-origin', ...options, signal: controller.signal});
        const chunks = []; let size = 0;
        if (response.body) {
          const reader = response.body.getReader();
          try {
            for (;;) {
              const item = await Promise.race([reader.read(), aborted]);
              if (item.done) break;
              size += item.value.byteLength;
              if (size > maxBytes) { controller.abort(); throw new Error('response too large'); }
              chunks.push(item.value);
            }
          } finally {
            if (controller.signal.aborted) void reader.cancel().catch(() => {});
            try { reader.releaseLock(); } catch (_) {}
          }
        }
        const bytes = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        let data = bytes;
        if (response.ok && response.status !== 204 && kind === 'json') data = JSON.parse(new TextDecoder().decode(bytes));
        else if (kind === 'blob') data = new Blob([bytes], {type: 'image/jpeg'});
        return {ok: response.ok, status: response.status, data};
      })()]);
    } finally { clearTimeout(timeout); pending.delete(controller); mediaRequests.delete(controller); }
  }
  function showPaired() { paired = true; failures = 0; $('pairPanel').hidden = true; $('viewer').hidden = false; }
  function halt() {
    soundConsent = false; failedMedia = ''; mediaRetryCount = 0; mediaRetryAt = Infinity;
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
      const response = await request('/frame.jpg', {}, 'blob', 1048576);
      if (!current(session) || !paired || lyricsOnly || generation !== version) return;
      if (response.status === 401 || response.status === 410) { lostPairing(); return; }
      if (response.status === 204) { clearImage(); return; }
      if (!response.ok) throw new Error('snapshot');
      const blob = response.data;
      if (!current(session) || generation !== version || !paired || lyricsOnly) return;
      if (objectURL) URL.revokeObjectURL(objectURL);
      objectURL = URL.createObjectURL(blob); screen.src = objectURL; screen.hidden = false; $('empty').hidden = true;
      $('streamMode').textContent = '兼容模式 · 单帧刷新';
    } catch (_) { if (current(session) && generation === version) clearImage('连接暂时中断', '正在等待新画面，不显示旧内容。'); }
    finally { if (snapshotBusy === ticket) snapshotBusy = null; }
  }
  function validMedia(value) {
    const time = Date.now() / 1000;
    return value && typeof value.generation === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value.generation) &&
      typeof value.hasAudio === 'boolean' && typeof value.mime === 'string' &&
      (value.hasAudio ? /^video\/mp4; codecs="avc1\.[a-f0-9]{6}, ?mp4a\.40\.2"$/i : /^video\/mp4; codecs="avc1\.[a-f0-9]{6}"$/i).test(value.mime) &&
      Number.isFinite(value.updatedAt) && value.updatedAt > 0 && value.updatedAt <= time + 1 && time - value.updatedAt <= 4;
  }
  function activeMedia(player) { return media === player && current(player.epoch) && paired && !lyricsOnly && !document.hidden; }
  function stopMedia() {
    const old = media; media = null;
    for (const controller of mediaRequests) controller.abort();
    if (old) {
      clearTimeout(old.timer); clearTimeout(old.openTimer);
      try { old.buffer?.abort(); } catch (_) {}
      try { video.pause(); } catch (_) {}
      video.removeAttribute('src');
      try { video.load(); } catch (_) {}
      URL.revokeObjectURL(old.url);
    }
    video.hidden = true; video.muted = true;
    $('soundButton').hidden = true; $('mediaNote').hidden = true;
  }
  function mediaFallback(player, temporary = false) {
    if (!activeMedia(player)) return;
    failedMedia = player.generation;
    mediaRetryAt = temporary ? Date.now() + 2000 * 2 ** mediaRetryCount : Infinity;
    if (temporary) mediaRetryCount = Math.min(2, mediaRetryCount + 1);
    stopMedia();
    $('mediaNote').hidden = false; $('mediaNote').textContent = '兼容画面，无声音。声音请继续使用原播放器。';
    displayFrame();
  }
  function displayVisual(descriptor) {
    if (lyricsOnly) { stopMedia(); return; }
    if (descriptor?.generation !== failedMedia && failedMedia) { failedMedia = ''; mediaRetryCount = 0; mediaRetryAt = Infinity; }
    if (failedMedia === descriptor?.generation && Date.now() >= mediaRetryAt) failedMedia = '';
    let supported = false;
    try { supported = validMedia(descriptor) && typeof window.MediaSource === 'function' && window.MediaSource.isTypeSupported(descriptor.mime); } catch (_) {}
    if (!supported || failedMedia === descriptor?.generation) {
      stopMedia();
      $('mediaNote').hidden = false; $('mediaNote').textContent = '兼容画面，无声音。声音请继续使用原播放器。';
      displayFrame(); return;
    }
    if (media?.generation === descriptor.generation) return;
    clearImage();
    let source, url;
    try { source = new window.MediaSource(); url = URL.createObjectURL(source); }
    catch (_) {
      failedMedia = descriptor.generation; mediaRetryAt = Infinity;
      $('mediaNote').hidden = false; $('mediaNote').textContent = '兼容画面，无声音。声音请继续使用原播放器。';
      displayFrame(); return;
    }
    const player = {generation: descriptor.generation, descriptor, epoch, source, url, buffer: null,
      initialized: false, next: null, timer: null, openTimer: null, busy: false, firstAppend: true, soundEnabled: false,
      hasFragments: false, playAttempted: false, playPending: false, waitingGesture: false,
      lastProgressAt: Date.now(), lastVideoTime: 0, lastDecodedFrames: 0};
    media = player; video.muted = !(soundConsent && descriptor.hasAudio); video.src = player.url;
    $('soundButton').textContent = '启用声音';
    $('mediaNote').hidden = false; $('mediaNote').textContent = '正在连接同步画面…';
    player.openTimer = setTimeout(() => mediaFallback(player), 3500);
    source.addEventListener('sourceopen', () => {
      if (!activeMedia(player) || player.buffer) return;
      clearTimeout(player.openTimer);
      try {
        player.buffer = source.addSourceBuffer(descriptor.mime); player.buffer.mode = 'segments';
        player.buffer.addEventListener('error', () => mediaFallback(player));
        void mediaStep(player);
      } catch (_) { mediaFallback(player); }
    });
    source.addEventListener('sourceclose', () => mediaFallback(player));
  }
  async function mediaAppend(player, bytes) {
    if (!activeMedia(player)) throw new Error('cancelled');
    const buffer = player.buffer;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error('append timeout')); }, 2500);
      const done = () => { cleanup(); activeMedia(player) ? resolve() : reject(new Error('cancelled')); };
      const fail = () => { cleanup(); reject(new Error('append failed')); };
      function cleanup() { clearTimeout(timer); buffer.removeEventListener('updateend', done); buffer.removeEventListener('error', fail); buffer.removeEventListener('abort', fail); }
      buffer.addEventListener('updateend', done); buffer.addEventListener('error', fail); buffer.addEventListener('abort', fail);
      try { buffer.appendBuffer(bytes); } catch (error) { cleanup(); reject(error); }
    });
  }
  async function trimMedia(player) {
    const buffer = player.buffer, ranges = video.buffered;
    if (!ranges.length) return;
    const end = ranges.end(ranges.length - 1), beginning = ranges.start(0);
    if (player.firstAppend || end - video.currentTime > 1 || video.currentTime < beginning) {
      video.currentTime = Math.max(beginning, end - 0.4); player.firstAppend = false;
      player.lastVideoTime = video.currentTime;
    }
    video.playbackRate = end - video.currentTime > 0.65 ? 1.05 : 1;
    if (video.currentTime - beginning <= 2) return;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error('trim timeout')); }, 2500);
      const done = () => { cleanup(); resolve(); }, fail = () => { cleanup(); reject(new Error('trim failed')); };
      function cleanup() { clearTimeout(timer); buffer.removeEventListener('updateend', done); buffer.removeEventListener('error', fail); buffer.removeEventListener('abort', fail); }
      buffer.addEventListener('updateend', done); buffer.addEventListener('error', fail); buffer.addEventListener('abort', fail);
      try { buffer.remove(0, video.currentTime - 1); } catch (error) { cleanup(); reject(error); }
    });
  }
  async function mediaStep(player) {
    if (!activeMedia(player) || player.busy) return;
    player.busy = true; let delay = 180;
    try {
      const response = await request('/media/index', {}, 'json', 32768);
      if (!activeMedia(player)) return;
      if (response.status === 401 || response.status === 410) { lostPairing(); return; }
      if (response.status === 204) { clearImage('等待新画面'); return; }
      if (!response.ok) throw Object.assign(new Error('media index'), {temporary: response.status === 429 || response.status >= 500});
      const index = response.data;
      if (!validMedia(index) || index.generation !== player.generation) { stopMedia(); return; }
      if (index.mime !== player.descriptor.mime || index.hasAudio !== player.descriptor.hasAudio || !Array.isArray(index.fragments) || !index.fragments.length || index.fragments.length > 60) throw new Error('invalid index');
      let prior = null;
      for (const item of index.fragments) {
        if (!Number.isSafeInteger(item.sequence) || item.sequence < 0 || !Number.isFinite(item.start) || item.start < 0 || item.start > 86400 ||
            !Number.isFinite(item.duration) || item.duration <= 0 || item.duration > 2 || typeof item.independent !== 'boolean' ||
            (prior && (item.sequence !== prior.sequence + 1 || Math.abs(item.start - prior.start - prior.duration) > 0.1))) throw new Error('invalid fragment');
        prior = item;
      }
      if (!index.fragments[0].independent) throw new Error('missing random access');
      const last = index.fragments[index.fragments.length - 1], edge = last.start + last.duration;
      if (edge - index.fragments[0].start > 3.01) throw new Error('oversize timeline');
      let selected = index.fragments.find(item => item.sequence === player.next);
      if (player.next !== null && (!selected && player.next <= last.sequence || selected && edge - selected.start > 2)) {
        stopMedia(); displayVisual(player.descriptor); return;
      }
      if (player.next === null) {
        selected = [...index.fragments].reverse().find(item => item.independent && item.start <= edge - 0.4) || index.fragments.find(item => item.independent);
        if (!selected || edge - selected.start > 2) throw new Error('no recent keyframe');
        player.next = selected.sequence;
      }
      if (!selected) return;
      const base = '/media/' + player.generation + '/';
      if (!player.initialized) {
        const init = await request(base + 'init.mp4', {}, 'bytes', 65536);
        if (!activeMedia(player)) return;
        if (init.status === 401 || init.status === 410) { lostPairing(); return; }
        if (init.status === 409 || init.status === 204) { stopMedia(); return; }
        if (!init.ok || init.data.byteLength < 8) throw Object.assign(new Error('media initialization'), {temporary: init.status === 429 || init.status >= 500});
        await mediaAppend(player, init.data); player.initialized = true;
      }
      const fragment = await request(base + selected.sequence + '.m4s', {}, 'bytes', 1048576);
      if (!activeMedia(player)) return;
      if (fragment.status === 401 || fragment.status === 410) { lostPairing(); return; }
      if (fragment.status === 409 || fragment.status === 204) { stopMedia(); return; }
      if (!fragment.ok || fragment.data.byteLength < 8) throw Object.assign(new Error('media fragment'), {temporary: fragment.status === 429 || fragment.status >= 500});
      await mediaAppend(player, fragment.data);
      if (!activeMedia(player)) return;
      player.next = selected.sequence + 1;
      if (!player.hasFragments) { player.hasFragments = true; player.lastProgressAt = Date.now(); }
      await trimMedia(player);
      if (!activeMedia(player)) return;
      video.hidden = false; screen.hidden = true; $('empty').hidden = true;
      $('soundButton').hidden = !player.waitingGesture && (!player.descriptor.hasAudio || player.soundEnabled);
      $('mediaNote').hidden = false;
      $('mediaNote').textContent = player.descriptor.hasAudio ? (player.soundEnabled ? '同步画面与声音' : '同步画面已连接，点「启用声音」播放声音。') : '同步画面，无可用音轨。';
      tryMediaPlay(player);
      delay = selected.sequence < last.sequence ? 0 : 180;
    } catch (error) { if (activeMedia(player)) mediaFallback(player, error.temporary || error.name === 'AbortError' || error.name === 'TypeError'); }
    finally { player.busy = false; if (activeMedia(player)) player.timer = setTimeout(() => { void mediaStep(player); }, delay); }
  }
  function tryMediaPlay(player, gesture = false) {
    if (!activeMedia(player) || !gesture && player.playAttempted) return;
    player.playAttempted = true; player.playPending = true; player.waitingGesture = false;
    if (gesture) { soundConsent = player.descriptor.hasAudio; video.muted = !soundConsent; player.lastProgressAt = Date.now(); }
    // Never await play(): some browsers leave this promise pending while decode stalls.
    let attempt;
    try { attempt = video.play(); } catch (error) { attempt = Promise.reject(error); }
    Promise.resolve(attempt).then(() => {
      if (!activeMedia(player)) return;
      player.playPending = false; player.soundEnabled = player.descriptor.hasAudio && !video.muted;
      $('soundButton').hidden = player.soundEnabled || !player.descriptor.hasAudio;
      if (player.soundEnabled) $('mediaNote').textContent = '同步画面与声音';
    }, () => {
      if (!activeMedia(player)) return;
      player.playPending = false; player.waitingGesture = true; player.soundEnabled = false;
      video.muted = true; $('soundButton').hidden = false; $('soundButton').textContent = '点此播放';
    });
  }
  function mediaPlaybackWatchdog() {
    const player = media;
    if (!player || !activeMedia(player) || !player.hasFragments || player.waitingGesture) return;
    let decoded = 0;
    try { decoded = video.getVideoPlaybackQuality?.().totalVideoFrames || video.webkitDecodedFrameCount || 0; } catch (_) {}
    // A seek performed by backlog trimming is not decoder/playback progress.
    if (decoded > player.lastDecodedFrames || !video.paused && !video.seeking && video.currentTime > player.lastVideoTime && video.currentTime - player.lastVideoTime < 0.8) {
      player.lastProgressAt = Date.now();
    }
    player.lastDecodedFrames = decoded; player.lastVideoTime = video.currentTime;
    if (Date.now() - player.lastProgressAt > 4000) mediaFallback(player);
  }
  video.addEventListener('error', () => { if (media) mediaFallback(media); });
  $('soundButton').addEventListener('click', () => {
    const player = media;
    if (!player || !activeMedia(player)) return;
    tryMediaPlay(player, true);
  });
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
      const response = await request('/api/state', {}, 'json');
      if (!current(session)) return;
      if (response.status === 401 || response.status === 410) { if (paired) lostPairing(); else { enabled = false; status('等待配对'); } return; }
      if (!response.ok) throw new Error(response.status === 429 ? '连接数量已达上限，请关闭其他接收页面。' : '无法读取手机状态。');
      const state = response.data;
      if (!current(session)) return;
      if (document.hidden || !navigator.onLine) { clearImage('等待接收页面恢复'); clearMusic(); schedule(3000); return; }
      showPaired(); failures = 0;
      const teslaLyrics = state.source === 'tesla-ble-lyrics';
      const nextLyricsOnly = state.source === 'microphone-lyrics' || teslaLyrics;
      const modeChanged = nextLyricsOnly !== lyricsOnly;
      if (modeChanged) {
        clearImage(); lastLiveAt = 0; snapshotMode = false;
      }
      lyricsOnly = nextLyricsOnly;
      $('viewer').classList.toggle('lyrics-only', lyricsOnly);
      $('stage').hidden = lyricsOnly; $('screenModes').hidden = lyricsOnly;
      $('fontSize').parentElement.hidden = lyricsOnly;
      if (!lyricsOnly) $('lyricsEmpty').hidden = true;
      const demo = state.source === 'demo';
      $('demoBanner').hidden = !demo;
      $('viewerTitle').textContent = lyricsOnly ? '音乐与歌词' : demo ? 'DEMO · 原创演示' : '本地屏幕共享';
      screen.alt = demo ? 'DEMO 原创合成演示画面，非真实手机屏幕' : 'iPhone 共享屏幕';
      const age = Date.now() / 1000 - Number(state.frameUpdatedAt);
      const live = ['live', 'broadcasting', 'running', 'capturing'].includes(state.captureState) &&
        ((age >= -2 && age <= 4 && state.width > 0) || validMedia(state.media));
      displayMusic(state, modeChanged);
      if (lyricsOnly) {
        clearImage(); lastLiveAt = 0;
        $('captureNote').textContent = teslaLyrics ? '通过蓝牙读取 Tesla 曲目与播放进度；不共享屏幕，仅在手机前台运行。' :
          '通过 iPhone 麦克风识别周围音乐；不共享屏幕，不读取其他应用的播放信息。';
        status(musicFreshness ? '歌词模式 · 本地连接' : teslaLyrics ? '歌词模式 · 等待车辆播放信息' : '歌词模式 · 等待音乐状态', true);
        schedule(1000); return;
      }
      $('captureNote').textContent = demo ? '原创合成演示，非手机画面。' : live ? '正在接收手机画面。' :
        state.captureState === 'paused' ? '请在 iPhone 恢复共享。' : '请在 iPhone 开始共享。';
      if (!live) {
        const paused = state.captureState === 'paused';
        clearImage(paused ? '来源已暂停' : '等待新画面', '旧画面与文字已隐藏，请在 iPhone 上检查广播或演示。');
        status(paused ? '已暂停' : '等待画面');
      } else {
        lastLiveAt = Date.now(); status(demo ? 'DEMO · 本地连接' : '本地连接', true); displayVisual(state.media);
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
  for (const type of ['wheel', 'pointerdown', 'touchstart']) $('lyricViewport').addEventListener(type, pauseLyricFollow, {passive: true});
  $('lyricViewport').addEventListener('keydown', event => {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) pauseLyricFollow();
  });
  $('lyricFollow').addEventListener('click', () => {
    lyricFollowing = true; $('lyricFollow').hidden = true; followLyric();
  });
  window.addEventListener('resize', () => { if (lyricFollowing) layoutLyrics(); });
  $('pairForm').addEventListener('submit', async event => {
    event.preventDefault(); if (loggingOut || $('pairButton').disabled || !$('pairConsent').checked || !/^[0-9]{6}$/.test($('pairCode').value)) return;
    soundConsent = false; failedMedia = ''; mediaRetryCount = 0; mediaRetryAt = Infinity;
    clearImage(); clearMusic();
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
    mediaPlaybackWatchdog();
    if (enabled && paired && !lyricsOnly && lastLiveAt && Date.now() - lastLiveAt > 4000) clearImage('画面已过期', '旧画面与文字已隐藏，正在等待新状态。');
    if (musicFreshness && !musicIsFresh(musicFreshness)) {
      clearMusic();
      if (lyricsOnly) status('歌词已过期 · 等待新状态');
    }
  }, 500);
  if (enabled) void poll(); else status('本页已断开 · 等待手动配对');
})();
