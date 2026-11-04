import { parseLrc } from '../public/lyrics.js';

const API = 'https://lrclib.net/api';
const ATTRIBUTION = Object.freeze({ name: 'LRCLIB', url: 'https://lrclib.net' });
const MAX_BODY = 256 * 1024;
export class LyricsProviderError extends Error {
  constructor(message, statusCode = 502) { super(message); this.name = 'LyricsProviderError'; this.statusCode = statusCode; }
}
const fail = (message, code) => { throw new LyricsProviderError(message, code); };
function string(value, required = false) {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || value.length > 256 || (required && !value.trim()) || /[\u0000-\u001f\u007f]/.test(value)) fail('Invalid track metadata', 400);
  return value.trim();
}
function track(input) {
  const result = { title: string(input?.title, true), artist: string(input?.artist, true), album: string(input?.album) };
  if (input?.duration != null) {
    if (typeof input.duration !== 'number' || !Number.isFinite(input.duration) || input.duration < 0 || input.duration > 3600) fail('Invalid duration', 400);
    result.duration = input.duration;
  }
  return result;
}
function normalize(item, fallback) {
  let metadata = fallback;
  if (item) {
    try { metadata = track({ title: item.trackName, artist: item.artistName, album: item.albumName, duration: item.duration }); }
    catch { fail('Invalid provider track metadata'); }
  }
  const result = { status: 'not-found', track: metadata, lines: [], attribution: ATTRIBUTION };
  if (!item) return result;
  if (item.instrumental === true) return { ...result, status: 'instrumental' };
  for (const field of ['plainLyrics', 'syncedLyrics']) {
    if (item[field] != null && (typeof item[field] !== 'string' || Buffer.byteLength(item[field]) > 220 * 1024)) fail('Provider lyrics exceed safe limits');
  }
  if (item.syncedLyrics) {
    const lines = parseLrc(item.syncedLyrics).lines;
    if (lines.length > 400 || lines.some(({ time, text }) => !Number.isFinite(time) || time < 0 || time > 86400 || text.length > 1000)
      || Buffer.byteLength(JSON.stringify(lines)) > 220 * 1024) fail('Provider lyrics exceed safe limits');
    if (lines.length) return { ...result, status: 'synced', lines };
  }
  if (item.plainLyrics) return { ...result, status: 'plain', plainLyrics: item.plainLyrics };
  return result;
}
async function readBounded(response) {
  if (Number(response.headers.get('content-length')) > MAX_BODY) fail('Provider response exceeds safe limits');
  if (!response.body) fail('Provider returned an empty response');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) { await reader.cancel(); fail('Provider response exceeds safe limits'); }
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    if (error instanceof LyricsProviderError) throw error;
    fail('Invalid provider response');
  } finally { reader.releaseLock(); }
}

/** Opt-in outbound metadata lookup. Fixed host; no credentials, redirects, retries or disk cache. */
export function createLyricsProvider({ fetchImpl = fetch, now = Date.now, timeoutMs = 8000, cacheTtlMs = 3600000, maxCacheEntries = 100 } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000 || !Number.isFinite(cacheTtlMs) || cacheTtlMs < 0
    || !Number.isInteger(maxCacheEntries) || maxCacheEntries < 1 || maxCacheEntries > 100) throw new TypeError('Invalid provider limits');
  const cache = new Map();
  const pending = new Map();
  let cooldownUntil = 0;
  async function request(path, params, mapper) {
    const url = `${API}/${path}?${new URLSearchParams(params)}`;
    const existing = cache.get(url);
    if (existing && existing.expires > now()) return structuredClone(existing.value);
    cache.delete(url);
    if (pending.has(url)) return structuredClone(await pending.get(url));
    if (now() < cooldownUntil) fail('Lyrics provider is cooling down; try later', 429);
    // Bound simultaneous unique work as well as completed-cache memory.
    if (pending.size >= 10) fail('Too many lyric requests', 503);
    const task = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, { signal: controller.signal, redirect: 'error', headers: {
          Accept: 'application/json', 'User-Agent': 'CabinDirect/0.3 (optional user-initiated lyrics lookup)',
        } });
        if (response.status === 429) {
          const raw = response.headers.get('retry-after');
          const seconds = raw && /^\d+(\.\d+)?$/.test(raw.trim()) ? Number(raw) : NaN;
          const until = Number.isFinite(seconds) ? now() + seconds * 1000 : Date.parse(raw || '');
          // Caller-triggered future requests also wait a small jitter, avoiding a synchronized retry wave.
          cooldownUntil = Math.max(cooldownUntil, (Number.isFinite(until) ? Math.max(now() + 1000, until) : now() + 60000) + 250 + Math.random() * 250);
          await response.body?.cancel();
          fail('Lyrics provider is cooling down; try later', 429);
        }
        let value;
        if (response.status === 404) { await response.body?.cancel(); value = mapper(null); }
        else {
          if (!response.ok) { await response.body?.cancel(); fail('Lyrics provider is unavailable', 502); }
          value = mapper(await readBounded(response));
        }
        cache.set(url, { value, expires: now() + cacheTtlMs });
        while (cache.size > maxCacheEntries) cache.delete(cache.keys().next().value);
        return value;
      } catch (error) {
        if (controller.signal.aborted) fail('Lyrics provider timed out', 504);
        if (error instanceof LyricsProviderError) throw error;
        fail('Lyrics provider request failed', 502);
      } finally { clearTimeout(timer); }
    })();
    pending.set(url, task);
    try { return structuredClone(await task); } finally { pending.delete(url); }
  }
  return {
    async lookup(input) {
      const metadata = track(input);
      const params = { track_name: metadata.title, artist_name: metadata.artist };
      if (metadata.album) params.album_name = metadata.album;
      if (metadata.duration > 0) params.duration = String(metadata.duration);
      return request('get', params, (item) => normalize(item, metadata));
    },
    async search(query) {
      const q = string(query, true);
      return request('search', { q }, (items) => {
        if (items == null) return [];
        if (!Array.isArray(items)) fail('Invalid provider search response');
        const results = [];
        for (const item of items) {
          if (results.length === 10) break;
          try {
            const metadata = track({ title: item?.trackName, artist: item?.artistName, album: item?.albumName, duration: item?.duration });
            if (!Number.isSafeInteger(item.id) || item.id < 0) continue;
            results.push({ id: item.id, track: metadata, instrumental: item.instrumental === true,
              hasSyncedLyrics: typeof item.syncedLyrics === 'string' && Boolean(item.syncedLyrics), attribution: ATTRIBUTION });
          } catch { /* Invalid candidates are not displayable or selectable. */ }
        }
        return results;
      });
    },
  };
}
