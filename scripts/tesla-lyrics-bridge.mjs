#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, readFile, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, relative, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isIP } from 'node:net';
import WebSocket from 'ws';
import { normalizeTeslaMedia } from '../lib/tesla-media.mjs';
import { createLyricsProvider } from '../lib/lyrics-provider.mjs';

const execute = promisify(execFile);
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HELP = `Read-only Tesla BLE media bridge (optional; no pairing or installation).
Required: --origin URL --room 123456 --token-file /absolute/private/token
          --tesla-control /absolute/trusted/tesla-control --vin VIN
          --key-file /absolute/private/key.pem --time-unit ms|s
Optional: --interval 3000 (minimum 2000 ms) --online-lyrics
Requires an already-installed official Tesla CLI and an already-approved vehicle key.
Without --online-lyrics, only media metadata is sent; no lyric service is contacted.
See docs/TESLA_BLE.md before using. Do not run against a vehicle without authorization.`;

function privateHost(host) {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h === '::1') return true;
  if (isIP(h) === 4) {
    const [a, b] = h.split('.').map(Number);
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return isIP(h) === 6 && /^(fc|fd)/.test(h);
}
export function validateOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new TypeError('Invalid bridge origin'); }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash
    || !['http:', 'https:'].includes(url.protocol) || (url.protocol === 'http:' && !privateHost(url.hostname))) {
    throw new TypeError('Origin must be HTTPS or HTTP loopback/private IP, without credentials, path, query or fragment');
  }
  return url.origin;
}
export function parseBridgeArgs(args, repo = REPO) {
  const options = { interval: 3000, onlineLyrics: false };
  const values = new Map([['--origin', 'origin'], ['--room', 'room'], ['--token-file', 'tokenFile'],
    ['--tesla-control', 'teslaControl'], ['--vin', 'vin'], ['--key-file', 'keyFile'], ['--time-unit', 'timeUnit'], ['--interval', 'interval']]);
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--help') return { help: true };
    if (seen.has(flag)) throw new TypeError('Duplicate bridge option');
    seen.add(flag);
    if (flag === '--online-lyrics') { options.onlineLyrics = true; continue; }
    if (!values.has(flag) || !args[i + 1] || args[i + 1].startsWith('--')) throw new TypeError('Unknown or missing bridge option; use --help');
    options[values.get(flag)] = args[++i];
  }
  options.origin = validateOrigin(options.origin);
  if (!/^\d{6}$/.test(options.room ?? '')) throw new TypeError('Room must be six digits');
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(options.vin ?? '')) throw new TypeError('A valid 17-character VIN is required');
  if (!['ms', 's'].includes(options.timeUnit)) throw new TypeError('--time-unit ms|s must be explicitly confirmed');
  options.interval = Number(options.interval);
  if (!Number.isInteger(options.interval) || options.interval < 2000 || options.interval > 60000) throw new TypeError('Interval must be 2000–60000 milliseconds');
  for (const key of ['tokenFile', 'keyFile', 'teslaControl']) {
    if (typeof options[key] !== 'string' || !isAbsolute(options[key])) throw new TypeError('Credential and CLI file paths must be absolute');
    options[key] = resolve(options[key]);
    if (key !== 'teslaControl' && inside(repo, options[key])) throw new TypeError('Credential files must be outside the repository');
  }
  return options;
}
function inside(root, file) {
  const rel = relative(root, file);
  return rel === '' || (!rel.startsWith('..' + '/') && rel !== '..' && !isAbsolute(rel));
}
export function teslaStateArgs(options, category) {
  if (!['media', 'media-detail'].includes(category)) throw new TypeError('Only media state reads are allowed');
  return ['-ble', '-vin', options.vin, '-key-file', options.keyFile, '-disable-session-cache',
    '-connect-timeout', '8s', '-command-timeout', '5s', 'state', category];
}
export function freezeTrack(track, now = Date.now()) {
  return track ? { ...track, position: track.position, playing: false, sentAt: now } : null;
}
export function terminalSignalFailure({ code, httpStatus } = {}) {
  return [4000, 1008, 4001, 4003].includes(code) || [401, 403].includes(httpStatus);
}
export function createMediaMessage(track, lines, onlineLyrics = false) {
  return { type: 'lyrics', track, lines, provenance: 'tesla-ble', lyricProvider: onlineLyrics && lines.length > 0 ? 'lrclib' : 'none' };
}
export async function preflightBridge(options) {
  let binary;
  try { binary = await realpath(options.teslaControl); await access(binary, constants.X_OK); }
  catch { throw new Error('Trusted tesla-control executable is missing or not executable. Install/setup manually; this bridge never installs Go or the CLI.'); }
  if (!(await stat(binary)).isFile()) throw new Error('Tesla CLI must be a trusted executable file');
  const repo = await realpath(REPO);
  for (const name of ['tokenFile', 'keyFile']) {
    let path;
    try { path = await realpath(options[name]); } catch { throw new Error('Required external credential file is unavailable'); }
    if (inside(repo, path)) throw new Error('Credential symlinks must resolve outside the repository');
    const info = await stat(path);
    if (!info.isFile() || info.size > 16384 || (info.mode & 0o077) !== 0) throw new Error('Credential files must be private regular files (chmod 600), at most 16 KiB');
    options[name] = path;
  }
  options.teslaControl = binary;
  const token = (await readFile(options.tokenFile, 'utf8')).trim();
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new Error('Invalid metadata token file');
  return token;
}

/** Sequential finite state reads; no shell, pairing, wake command, controls or Fleet fallback. */
export async function readMedia(options, { exec = execute, now = Date.now } = {}) {
  const outputs = [];
  // Do not inherit TESLA_* credentials, cache locations or verbose debug logging.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('TESLA_')));
  for (const category of ['media', 'media-detail']) {
    const { stdout } = await exec(options.teslaControl, teslaStateArgs(options, category), {
      timeout: 15000, maxBuffer: 128 * 1024, encoding: 'utf8', windowsHide: true, env,
    });
    outputs.push(JSON.parse(stdout));
  }
  return normalizeTeslaMedia(outputs[0], outputs[1], { timeUnit: options.timeUnit, observedAt: now() });
}

export async function runBridge(options) {
  const token = await preflightBridge(options);
  const provider = options.onlineLyrics ? createLyricsProvider() : null;
  const endpoint = new URL('/signal', options.origin);
  endpoint.protocol = endpoint.protocol === 'https:' ? 'wss:' : 'ws:';
  endpoint.search = new URLSearchParams({ room: options.room, role: 'metadata', token }).toString();
  let socket;
  let stopped = false;
  let reconnectTimer;
  let pollTimer;
  let reconnectDelay = 1000;
  let lastTrack = null;
  let lines = [];
  let identity = null;
  let polling = false;
  let stale = true;
  const send = (message) => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); };
  function markStale() {
    if (!stale && lastTrack) {
      lastTrack = freezeTrack(lastTrack);
      send(createMediaMessage(lastTrack, lines, options.onlineLyrics));
    }
    if (!stale) send({ type: 'media-status', state: 'stale' });
    stale = true;
  }
  async function poll() {
    if (stopped || polling || socket?.readyState !== WebSocket.OPEN) return;
    polling = true;
    const activeSocket = socket;
    try {
      const track = await readMedia(options);
      if (stopped || activeSocket !== socket || socket.readyState !== WebSocket.OPEN) return;
      const nextIdentity = JSON.stringify([track.title, track.artist, track.duration]);
      if (identity !== nextIdentity) {
        identity = nextIdentity;
        lines = [];
        // Publish the new identity immediately; never show the previous song's lyrics.
        send(createMediaMessage(track, lines, options.onlineLyrics));
        if (provider) {
          try { lines = (await provider.lookup(track)).lines; }
          catch { console.error('Online lyrics unavailable; continuing with observed media only.'); }
        }
      }
      if (stopped || activeSocket !== socket || socket.readyState !== WebSocket.OPEN) return;
      // Keep the observation anchor; a slow lyrics lookup must not pretend it was sampled later.
      lastTrack = track;
      stale = false;
      send(createMediaMessage(track, lines, options.onlineLyrics));
      send({ type: 'media-status', state: 'live' });
    } catch {
      markStale();
      // No VIN, track names, credentials, subprocess output or URL is logged.
      console.error('BLE media read unavailable; timeline frozen. Check proximity, approved key, and time-unit configuration.');
      send({ type: 'media-status', state: 'stale' });
    } finally {
      polling = false;
      if (!stopped && socket?.readyState === WebSocket.OPEN) pollTimer = setTimeout(poll, options.interval);
    }
  }
  function connect() {
    if (stopped) return;
    socket = new WebSocket(endpoint, { handshakeTimeout: 10000, maxPayload: 256 * 1024, followRedirects: false });
    socket.on('open', () => {
      reconnectDelay = 1000;
      send({ type: 'media-status', state: 'stale' });
      void poll();
    });
    socket.on('error', () => {});
    socket.on('unexpected-response', (request, response) => {
      response.resume();
      if (terminalSignalFailure({ httpStatus: response.statusCode })) {
        console.error('Metadata authorization rejected or room expired; bridge stopped. Check room and token locally.');
        stop();
      }
      // Registering this handler transfers responsibility for failed handshakes to us.
      // Destroy every rejected request, including transient server/duplicate-peer errors.
      request.destroy();
    });
    socket.on('close', (code) => {
      clearTimeout(pollTimer);
      markStale();
      if (stopped) return;
      if (terminalSignalFailure({ code })) {
        console.error('Metadata authorization rejected or room expired; bridge stopped. Check room and token locally.');
        stop();
        return;
      }
      console.error('Signal connection unavailable; timeline frozen, reconnecting with bounded backoff.');
      reconnectTimer = setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(30000, reconnectDelay * 2);
    });
  }
  function stop() {
    if (stopped) return;
    markStale();
    stopped = true;
    clearTimeout(pollTimer);
    clearTimeout(reconnectTimer);
    socket?.close();
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  console.log(options.onlineLyrics ? 'BLE reader starting. Online LRCLIB metadata lookup explicitly enabled.' : 'BLE reader starting. Online lyrics disabled; metadata only.');
  connect();
  return { stop };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const options = parseBridgeArgs(process.argv.slice(2));
    if (options.help) console.log(HELP);
    else await runBridge(options);
  } catch (error) {
    // All surfaced startup messages are authored here, never subprocess stderr.
    console.error(error instanceof TypeError || /^Trusted |^Required |^Credential |^Invalid metadata|^Tesla CLI/.test(error.message)
      ? error.message : 'Bridge could not start; inspect local credential permissions and CLI setup.');
    process.exitCode = 1;
  }
}
