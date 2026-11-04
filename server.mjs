import http from 'node:http';
import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isIP } from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';
import { createLyricsProvider } from './lib/lyrics-provider.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp',
};
const MAX_SDP = 128 * 1024;
const MAX_PAYLOAD = 256 * 1024;

const finite = (v, min = 0, max = 86400) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const shortString = (v, max) => typeof v === 'string' && v.length <= max;
const plainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function tokenMatches(supplied, expected) {
  if (typeof supplied !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(supplied) || supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

function normalizeSignal(message, role) {
  if (!plainObject(message)) return null;
  if (message.type === 'offer' || message.type === 'answer') {
    if ((message.type === 'offer' && role !== 'publisher') || (message.type === 'answer' && role !== 'viewer')) return null;
    if (typeof message.sdp !== 'string' || !message.sdp.startsWith('v=0') || Buffer.byteLength(message.sdp) > MAX_SDP) return null;
    return { type: message.type, sdp: message.sdp };
  }
  if (message.type === 'ice') {
    if (!['publisher', 'viewer'].includes(role)) return null;
    const c = message.candidate;
    if (c === null) return { type: 'ice', candidate: null };
    if (!plainObject(c) || !shortString(c.candidate, 8192)) return null;
    if (c.sdpMid != null && !shortString(c.sdpMid, 128)) return null;
    if (c.sdpMLineIndex != null && (!Number.isInteger(c.sdpMLineIndex) || c.sdpMLineIndex < 0 || c.sdpMLineIndex > 255)) return null;
    if (c.usernameFragment != null && !shortString(c.usernameFragment, 256)) return null;
    return { type: 'ice', candidate: {
      candidate: c.candidate, sdpMid: c.sdpMid ?? null,
      sdpMLineIndex: c.sdpMLineIndex ?? null, usernameFragment: c.usernameFragment ?? null,
    } };
  }
  if (message.type === 'lyrics-source' && role === 'publisher' && ['publisher', 'metadata'].includes(message.source)) return { type: 'lyrics-source', source: message.source };
  if (message.type === 'media-status' && role === 'metadata' && ['live', 'stale'].includes(message.state)) return { type: 'media-status', state: message.state, source: 'metadata' };
  if (message.type === 'lyrics' && ['publisher', 'metadata'].includes(role)) {
    const t = message.track;
    if (!plainObject(t) || !shortString(t.title, 256) || !shortString(t.artist, 256)
      || !finite(t.duration) || !finite(t.position) || typeof t.playing !== 'boolean'
      || !finite(t.sentAt, 0, Number.MAX_SAFE_INTEGER) || !Array.isArray(message.lines) || message.lines.length > 400) return null;
    const lines = [];
    for (const line of message.lines) {
      if (!plainObject(line) || !finite(line.time) || !shortString(line.text, 1000)) return null;
      lines.push({ time: line.time, text: line.text });
    }
    const result = { type: 'lyrics', track: {
      title: t.title, artist: t.artist, duration: t.duration, position: t.position, playing: t.playing, sentAt: t.sentAt,
    }, lines };
    if (role === 'metadata') result.provenance = 'tesla-ble';
    else if (['manual', 'local', 'demo'].includes(message.provenance)) result.provenance = message.provenance;
    if (['lrclib', 'lrc', 'demo', 'none'].includes(message.lyricProvider)) result.lyricProvider = message.lyricProvider;
    return result;
  }
  return null;
}

export function validateIceServers(value) {
  if (!Array.isArray(value) || value.length > 10) throw new Error('ICE_SERVERS must be an array with at most 10 servers');
  return value.map((entry) => {
    if (!plainObject(entry)) throw new Error('Invalid ICE server');
    const urls = typeof entry.urls === 'string' ? [entry.urls] : entry.urls;
    if (!Array.isArray(urls) || urls.length === 0 || urls.length > 10
      || urls.some((url) => !shortString(url, 2048) || !/^(stun|stuns|turn|turns):[^\s]+$/.test(url))) throw new Error('Invalid ICE server URLs');
    const result = { urls };
    if (entry.username !== undefined) {
      if (!shortString(entry.username, 1024)) throw new Error('Invalid ICE username');
      result.username = entry.username;
    }
    if (entry.credential !== undefined) {
      if (!shortString(entry.credential, 2048)) throw new Error('Invalid ICE credential');
      result.credential = entry.credential;
    }
    return result;
  });
}

export function createApp(options = {}) {
  const publicDir = resolve(options.publicDir ?? resolve(ROOT, 'public'));
  const now = options.now ?? Date.now;
  const roomTtlMs = options.roomTtlMs ?? 30 * 60 * 1000;
  const maxRooms = options.maxRooms ?? 100;
  const createLimit = options.createLimit ?? 20;
  const iceServers = validateIceServers(options.iceServers ?? []);
  const publicOrigin = options.publicOrigin ? new URL(options.publicOrigin).origin : null;
  const rooms = new Map();
  const rateLimits = new Map();
  const lyricsProvider = options.lyricsProvider ?? createLyricsProvider();

  function hostAllowed(req) {
    try {
      const host = new URL(`http://${req.headers.host}`).hostname;
      return host === 'localhost' || isIP(host.replace(/^\[|\]$/g, '')) !== 0
        || (publicOrigin !== null && host === new URL(publicOrigin).hostname);
    } catch { return false; }
  }

  function headers(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(self), display-capture=(self), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  }
  function json(res, status, value) {
    headers(res);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(value));
  }
  function originAllowed(req) {
    if (!req.headers.origin) return true; // Native iOS clients do not send Origin.
    try {
      const own = `${req.socket.encrypted ? 'https' : 'http'}://${req.headers.host}`;
      const origin = new URL(req.headers.origin).origin;
      return origin === (publicOrigin ?? own);
    } catch { return false; }
  }
  function send(ws, message) {
    if (ws?.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > MAX_PAYLOAD * 4) {
      ws.close(1008, 'Receiver too slow');
      return;
    }
    ws.send(JSON.stringify(message));
  }
  function broadcast(room, message) {
    send(room.peers.publisher, message);
    send(room.peers.viewer, message);
  }
  function freezeLyrics(room, source, state) {
    const latest = room.latestLyrics;
    if (latest) {
      const elapsed = latest.track.playing ? Math.max(0, now() - room.latestLyricsAt) / 1000 : 0;
      const position = latest.track.duration > 0 ? Math.min(latest.track.duration, latest.track.position + elapsed) : latest.track.position + elapsed;
      room.latestLyrics = { ...latest, track: { ...latest.track, position: Math.min(86400, position), playing: false, sentAt: now() } };
      room.latestLyricsAt = now();
      broadcast(room, room.latestLyrics);
    }
    broadcast(room, { type: 'media-status', source, state });
  }
  function sweep() {
    for (const [id, room] of rooms) {
      if (room.lyricsOwner === 'metadata' && room.metadataLive && now() - room.lastMetadataAt > 10_000) {
        room.metadataLive = false;
        freezeLyrics(room, 'metadata', 'stale');
      }
      if (room.expiresAt > now()) continue;
      rooms.delete(id);
      for (const peer of Object.values(room.peers)) peer?.close(4000, 'Room expired');
    }
    for (const [key, state] of rateLimits) if (state.resetAt <= now()) rateLimits.delete(key);
  }
  function allowCreate(req, res) {
    const key = req.socket.remoteAddress;
    const old = rateLimits.get(key);
    const state = old && old.resetAt > now() ? old : { count: 0, resetAt: now() + 60_000 };
    state.count += 1;
    rateLimits.set(key, state);
    if (state.count <= createLimit) return true;
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil((state.resetAt - now()) / 1000))));
    json(res, 429, { error: 'Too many pairing requests. Try again later.' });
    return false;
  }

  const server = http.createServer(async (req, res) => {
    try {
      headers(res);
      if (!hostAllowed(req)) return json(res, 403, { error: 'Host not allowed' });
      const rawPath = (req.url ?? '/').split('?')[0];
      let pathname;
      try { pathname = decodeURIComponent(rawPath); } catch { return json(res, 400, { error: 'Invalid path' }); }
      if (pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').some((part) => part === '..' || part.startsWith('.'))) {
        return json(res, 400, { error: 'Invalid path' });
      }
      if (!originAllowed(req)) return json(res, 403, { error: 'Origin not allowed' });
      if (pathname === '/api/health' && req.method === 'GET') return json(res, 200, { ok: true, mode: 'validation-demo' });
      if (pathname === '/api/config' && req.method === 'GET') return json(res, 200, { iceServers });
      if (pathname === '/api/lyrics' && req.method === 'GET') {
        sweep();
        const url = new URL(req.url, 'http://localhost');
        const room = rooms.get(url.searchParams.get('room'));
        const supplied = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization ?? '')?.[1];
        if (!room || !(tokenMatches(supplied, room.publisherToken) || tokenMatches(supplied, room.metadataToken))) return json(res, 401, { error: 'Publisher or metadata credentials required' });
        const key = `lyrics:${req.socket.remoteAddress}`;
        const old = rateLimits.get(key);
        const limit = old && old.resetAt > now() ? old : { count: 0, resetAt: now() + 60_000 };
        rateLimits.set(key, limit);
        if (++limit.count > 30) { res.setHeader('Retry-After', '60'); return json(res, 429, { error: 'Lyrics lookup limit reached. Try later.' }); }
        try {
          if (url.searchParams.has('q')) return json(res, 200, { results: await lyricsProvider.search(url.searchParams.get('q')) });
          const durationText = url.searchParams.get('duration');
          const metadata = { title: url.searchParams.get('title'), artist: url.searchParams.get('artist'), album: url.searchParams.get('album') || undefined };
          if (durationText !== null) metadata.duration = Number(durationText);
          return json(res, 200, await lyricsProvider.lookup(metadata));
        } catch (error) {
          const status = [400, 413, 429, 502, 503, 504].includes(error.statusCode) ? error.statusCode : 502;
          return json(res, status, { error: status === 400 ? 'Invalid song metadata' : status === 429 ? 'Lyrics provider is rate limited. Try later.' : 'Lyrics provider unavailable. You can still import an LRC file.' });
        }
      }
      if (pathname === '/api/rooms' && req.method === 'POST') {
        if (!allowCreate(req, res)) return;
        sweep();
        if (rooms.size >= maxRooms) return json(res, 503, { error: 'Pairing capacity reached. Wait for an existing session to expire.' });
        if (req.headers['transfer-encoding'] || Number(req.headers['content-length'] ?? 0) > 1024) return json(res, 413, { error: 'Request body too large' });
        req.resume();
        let roomId;
        do { roomId = String(randomInt(100000, 1000000)); } while (rooms.has(roomId));
        const room = {
          roomId, publisherToken: randomBytes(32).toString('base64url'), viewerToken: randomBytes(32).toString('base64url'), metadataToken: randomBytes(32).toString('base64url'),
          expiresAt: now() + roomTtlMs, peers: { publisher: null, viewer: null, metadata: null }, latestLyrics: null,
          lyricsOwner: 'publisher', explicitLyricsOwner: false, latestLyricsAt: now(), lastMetadataAt: 0, metadataLive: false,
        };
        rooms.set(roomId, room);
        return json(res, 201, { roomId, publisherToken: room.publisherToken, viewerToken: room.viewerToken, metadataToken: room.metadataToken, expiresAt: room.expiresAt });
      }
      if (pathname.startsWith('/api/') || pathname === '/signal') return json(res, 404, { error: 'Not found' });
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed' });
      const routed = ['/', '/sender', '/receiver'].includes(pathname) ? '/index.html' : pathname;
      if (!/^\/[a-zA-Z0-9_./-]+$/.test(routed) || !MIME[extname(routed)]) return json(res, 404, { error: 'Not found' });
      const target = resolve(publicDir, `.${routed}`);
      if (!target.startsWith(`${publicDir}${sep}`)) return json(res, 400, { error: 'Invalid path' });
      let data;
      try { data = await readFile(target); } catch { return json(res, 404, { error: 'Not found' }); }
      res.writeHead(200, { 'Content-Type': MIME[extname(target)], 'Content-Length': data.length });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch {
      if (!res.headersSent) json(res, 500, { error: 'Internal server error' });
      else res.end();
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    function reject(status, reason) {
      socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    }
    if (!hostAllowed(req) || !originAllowed(req)) return reject(403, 'Forbidden');
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { return reject(400, 'Bad Request'); }
    if (url.pathname !== '/signal') return reject(404, 'Not Found');
    sweep();
    const room = rooms.get(url.searchParams.get('room'));
    const role = url.searchParams.get('role');
    if (!room || !['publisher', 'viewer', 'metadata'].includes(role) || !tokenMatches(url.searchParams.get('token'), room[`${role}Token`])) return reject(401, 'Unauthorized');
    if (room.peers[role] && room.peers[role].readyState !== WebSocket.CLOSED) return reject(409, 'Conflict');
    wss.handleUpgrade(req, socket, head, (ws) => {
      const otherRole = role === 'publisher' ? 'viewer' : 'publisher';
      room.peers[role] = ws;
      let messages = 0;
      let messageWindow = now();
      ws.on('error', () => {}); // Do not log query strings, SDP, lyrics, or credentials.
      ws.on('message', (data, binary) => {
        if (room.expiresAt <= now()) { sweep(); return; }
        if (now() - messageWindow >= 1000) { messages = 0; messageWindow = now(); }
        if (++messages > 120 || binary) { ws.close(1008, 'Unsupported traffic'); return; }
        let input;
        try { input = JSON.parse(data.toString()); } catch { ws.close(1008, 'Invalid message'); return; }
        const message = normalizeSignal(input, role);
        if (!message) { ws.close(1008, 'Invalid message'); return; }
        if (message.type === 'lyrics-source') {
          if (message.source === 'metadata' && room.peers.metadata?.readyState !== WebSocket.OPEN) return send(ws, { type: 'error', message: 'No metadata bridge connected' });
          room.lyricsOwner = message.source;
          room.explicitLyricsOwner = true;
          room.latestLyrics = null;
          broadcast(room, { type: 'media-status', source: message.source, state: 'selected' });
          return;
        }
        if (message.type === 'media-status') {
          if (room.lyricsOwner !== 'metadata') return;
          if (message.state === 'stale') { room.metadataLive = false; freezeLyrics(room, 'metadata', 'stale'); }
          else broadcast(room, message);
          return;
        }
        if (message.type === 'lyrics') {
          if (room.lyricsOwner !== role) return;
          if (role === 'metadata') {
            // The local bridge observes before a potentially slow lyric lookup. Re-anchor once here.
            const elapsed = message.track.playing ? Math.min(10, Math.max(0, now() - message.track.sentAt) / 1000) : 0;
            const maximum = message.track.duration > 0 ? message.track.duration : 86400;
            message.track = { ...message.track, position: Math.min(maximum, message.track.position + elapsed), sentAt: now() };
          }
          room.latestLyrics = message;
          room.latestLyricsAt = now();
          if (role === 'metadata') { room.lastMetadataAt = now(); room.metadataLive = true; broadcast(room, message); }
          else send(room.peers.viewer, message);
          return;
        }
        send(room.peers[otherRole], message);
      });
      ws.on('close', () => {
        if (room.peers[role] !== ws) return;
        room.peers[role] = null;
        if (role === 'metadata') {
          room.metadataLive = false;
          if (room.lyricsOwner === 'metadata') freezeLyrics(room, 'metadata', 'disconnected');
        } else {
          if (role === 'publisher' && room.lyricsOwner === 'publisher') { room.latestLyrics = null; broadcast(room, { type: 'media-status', source: 'publisher', state: 'disconnected' }); }
          send(room.peers[otherRole], { type: 'peer-left' });
        }
      });
      send(ws, { type: 'connected', role, roomId: room.roomId, expiresAt: room.expiresAt });
      if (role === 'metadata') {
        if (!room.explicitLyricsOwner || room.lyricsOwner === 'metadata') {
          room.lyricsOwner = 'metadata';
          room.metadataLive = false;
          room.latestLyrics = null;
          broadcast(room, { type: 'media-status', source: 'metadata', state: 'connected' });
        }
      } else if (room.peers[otherRole]?.readyState === WebSocket.OPEN) {
        send(ws, { type: 'peer-ready' });
        send(room.peers[otherRole], { type: 'peer-ready' });
      }
      if (role !== 'metadata') send(ws, { type: 'media-status', source: room.lyricsOwner, state: room.lyricsOwner === 'metadata' ? (room.metadataLive ? 'live' : 'stale') : 'selected' });
      if (role === 'viewer' && room.latestLyrics) {
        let latest = room.latestLyrics;
        if (latest.provenance === 'tesla-ble' && latest.track.playing) {
          const elapsed = Math.max(0, now() - room.latestLyricsAt) / 1000;
          latest = { ...latest, track: { ...latest.track, position: Math.min(latest.track.duration || 86400, latest.track.position + elapsed), sentAt: now() } };
        }
        send(ws, latest);
      }
    });
  });
  const sweepTimer = setInterval(sweep, Math.min(1000, Math.max(50, roomTtlMs)));
  sweepTimer.unref();

  return {
    server, sweep,
    async listen(port = 8787, host = '127.0.0.1') {
      await new Promise((resolveListen, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => { server.off('error', reject); resolveListen(); });
      });
      return server.address();
    },
    async close() {
      clearInterval(sweepTimer);
      for (const ws of wss.clients) ws.terminate();
      await new Promise((done) => wss.close(done));
      if (server.listening) await new Promise((done) => server.close(done));
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535');
  const app = createApp({
    iceServers: JSON.parse(process.env.ICE_SERVERS ?? '[]'),
    publicOrigin: process.env.PUBLIC_ORIGIN,
  });
  const host = process.env.HOST ?? '127.0.0.1';
  await app.listen(port, host);
  console.log(`Tesla companion validation demo: http://${host}:${port}`);
  console.log('Media is peer-to-peer; this server relays only signaling and explicitly shared lyric text.');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); process.exit(0); });
}
