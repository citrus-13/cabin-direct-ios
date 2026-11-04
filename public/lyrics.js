/** Pure LRC parsing and timeline helpers. No music-provider or vehicle connection. */
export function parseLrc(input) {
  const text = String(input ?? '').replace(/^\uFEFF/, '');
  const metadata = {};
  let offset = 0;
  const rows = [];
  for (const raw of text.split(/\r?\n/)) {
    const meta = raw.match(/^\[(ti|ar|al|by|offset):([^\]]*)\]\s*$/i);
    if (meta) {
      const key = meta[1].toLowerCase();
      if (key === 'offset') offset = Number(meta[2]) || 0;
      else metadata[key] = meta[2].trim();
      continue;
    }
    const tags = [...raw.matchAll(/\[(\d{1,3}):([0-5]\d)(?:[.:](\d{1,3}))?\]/g)];
    if (!tags.length) continue;
    const words = raw.replace(/\[(\d{1,3}):([0-5]\d)(?:[.:](\d{1,3}))?\]/g, '').trim();
    if (!words) continue;
    for (const tag of tags) {
      const fraction = tag[3] ? Number(`0.${tag[3]}`) : 0;
      rows.push({ time: Number(tag[1]) * 60 + Number(tag[2]) + fraction, text: words });
    }
  }
  // LRC offset advances the displayed lyrics: a positive offset moves timestamps earlier.
  const lines = rows.map((row) => ({ ...row, time: Math.max(0, row.time - offset / 1000) }))
    .sort((a, b) => a.time - b.time);
  return { lines, metadata };
}

export function lineAt(lines, position) {
  if (!Array.isArray(lines) || !Number.isFinite(position)) return -1;
  let low = 0;
  let high = lines.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (lines[middle].time <= position) { found = middle; low = middle + 1; }
    else high = middle - 1;
  }
  return found;
}

export function playbackPosition(track, receivedAt, now = Date.now()) {
  if (!track) return 0;
  const elapsed = track.playing ? Math.max(0, now - receivedAt) / 1000 : 0;
  const position = Math.max(0, Number(track.position) || 0) + elapsed;
  const duration = Number(track.duration);
  return duration > 0 ? Math.min(position, duration) : position;
}

export function freezePlayback(snapshot, now = Date.now()) {
  if (!snapshot) return null;
  return { ...snapshot, receivedAt: now,
    track: { ...snapshot.track, position: playbackPosition(snapshot.track, snapshot.receivedAt, now), playing: false, sentAt: now },
  };
}

export const DEMO_LYRICS = Object.freeze([
  { time: 0, text: '一束光，落在出发的地方' },
  { time: 6, text: '让眼前的字，跟上此刻的时光' },
  { time: 12, text: '画面穿过空气，抵达另一扇窗' },
  { time: 18, text: '把每一次连接，写成真实的回响' },
  { time: 24, text: '不用猜测，看看数字怎样增长' },
  { time: 30, text: '这一段旅程，从验证开始启航' },
  { time: 36, text: '这是原创演示文字，没有连接音乐账号' },
  { time: 42, text: '下一首，等待你的本地音频与歌词' },
]);
