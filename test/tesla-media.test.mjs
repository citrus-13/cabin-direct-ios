import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTeslaMedia } from '../lib/tesla-media.mjs';
import { parseBridgeArgs, validateOrigin, teslaStateArgs, readMedia, freezeTrack, terminalSignalFailure, createMediaMessage } from '../scripts/tesla-lyrics-bridge.mjs';

const media = { mediaState: { nowPlayingTitle: 'Synthetic Song', nowPlayingArtist: 'Test Artist', mediaPlaybackStatus: 'Playing' } };
const detail = { mediaDetailState: { nowPlayingDuration: 120000, nowPlayingElapsed: 25000 } };
const options = { timeUnit: 'ms', observedAt: 1700000000000 };
const args = ['--origin', 'http://127.0.0.1:8787', '--room', '123456', '--token-file', '/private/test/token',
  '--tesla-control', '/private/test/tesla-control', '--vin', '5YJ3E1EA0JF000001', '--key-file', '/private/test/key', '--time-unit', 'ms'];

test('official protojson VehicleData wrappers normalize with explicit units and synthetic anchor', () => {
  assert.deepEqual(normalizeTeslaMedia(media, detail, options), {
    title: 'Synthetic Song', artist: 'Test Artist', duration: 120, position: 25, playing: true, sentAt: options.observedAt,
  });
  assert.equal(normalizeTeslaMedia({ vehicleData: media }, { vehicleData: detail }, options).position, 25);
});
test('snake_case optional wrappers, numeric enums and seconds', () => {
  const state = { media_state: { optional_now_playing_title: { now_playing_title: 'Title' },
    now_playing_artist: 'Artist', media_playback_status: 2 } };
  const extra = { media_detail_state: { now_playing_duration: '120', now_playing_elapsed: 0 } };
  assert.equal(normalizeTeslaMedia(state, extra, { ...options, timeUnit: 's' }).playing, false);
  for (const status of [0, 'Stopped', 'Paused']) {
    assert.equal(normalizeTeslaMedia({ ...media.mediaState, mediaPlaybackStatus: status }, detail, options).playing, false);
  }
});
test('missing fields and undocumented time units never become fake defaults', () => {
  assert.throws(() => normalizeTeslaMedia(media, detail), /unit/);
  for (const name of ['nowPlayingTitle', 'nowPlayingArtist', 'mediaPlaybackStatus']) {
    const state = { ...media.mediaState }; delete state[name];
    assert.throws(() => normalizeTeslaMedia(state, detail, options));
  }
  for (const name of ['nowPlayingDuration', 'nowPlayingElapsed']) {
    const state = { ...detail.mediaDetailState }; delete state[name];
    assert.throws(() => normalizeTeslaMedia(media, state, options));
  }
  assert.throws(() => normalizeTeslaMedia({}, {}, options));
});
test('reject invalid playback states, excessive strings, impossible and unbounded times', () => {
  for (const value of [null, false, 'Unknown', 3, -1]) assert.throws(() => normalizeTeslaMedia({ ...media.mediaState, mediaPlaybackStatus: value }, detail, options));
  assert.throws(() => normalizeTeslaMedia({ ...media.mediaState, nowPlayingTitle: 'x'.repeat(257) }, detail, options));
  for (const value of [-1, null, '', false, 120001, Infinity, '1e5']) {
    assert.throws(() => normalizeTeslaMedia(media, { ...detail.mediaDetailState, nowPlayingElapsed: value }, options));
  }
  assert.throws(() => normalizeTeslaMedia(media, { nowPlayingDuration: 86401000, nowPlayingElapsed: 0 }, options));
});
test('CLI defaults opt out of online lyrics and strictly validates origin and arguments', () => {
  const result = parseBridgeArgs(args);
  assert.equal(result.onlineLyrics, false);
  assert.equal(result.interval, 3000);
  assert.equal(parseBridgeArgs([...args, '--online-lyrics']).onlineLyrics, true);
  for (const url of ['http://evil.test', 'https://u:p@example.com', 'https://example.com/path', 'https://example.com/?q=x', 'https://example.com/#x', 'file:///tmp']) {
    assert.throws(() => validateOrigin(url));
  }
  for (const url of ['http://localhost:8787', 'http://192.168.1.2:8787', 'http://10.0.0.1', 'http://172.16.0.1', 'http://[::1]', 'https://example.com']) {
    assert.equal(validateOrigin(url), new URL(url).origin);
  }
  assert.throws(() => parseBridgeArgs(args.slice(0, -2)), /time-unit/);
  assert.throws(() => parseBridgeArgs([...args, '--interval', '1999']));
  assert.throws(() => parseBridgeArgs([...args, '--unknown']));
  assert.throws(() => parseBridgeArgs(args.map(x => x === '/private/test/token' ? '/repo/token' : x), '/repo'));
  assert.throws(() => parseBridgeArgs(args.map(x => x === '/private/test/key' ? 'relative-key' : x)));
});
test('state invocation allowlists only the two media reads and never a shell or control command', async () => {
  const parsed = parseBridgeArgs(args);
  assert.throws(() => teslaStateArgs(parsed, 'wake'));
  const calls = [];
  const result = await readMedia(parsed, { now: () => options.observedAt, exec: async (binary, argv, config) => {
    calls.push(argv.at(-1));
    assert.equal(binary, '/private/test/tesla-control');
    assert.equal(argv.at(-2), 'state');
    assert.equal(argv[0], '-ble');
    assert.equal(config.timeout, 15000);
    assert.equal(config.maxBuffer, 128 * 1024);
    assert.equal(config.shell, undefined);
    assert.ok(!Object.keys(config.env).some(key => key.startsWith('TESLA_')));
    return { stdout: JSON.stringify(argv.at(-1) === 'media' ? media : detail) };
  } });
  assert.deepEqual(calls, ['media', 'media-detail']);
  assert.equal(result.position, 25);
  assert.deepEqual(freezeTrack(result, options.observedAt + 5000), { ...result, playing: false, sentAt: options.observedAt + 5000 });
});
test('expired room and authorization failures are terminal, transient network failures are retryable', () => {
  for (const code of [4000, 1008, 4001, 4003]) assert.equal(terminalSignalFailure({ code }), true);
  for (const httpStatus of [401, 403]) assert.equal(terminalSignalFailure({ httpStatus }), true);
  for (const code of [1000, 1006, 1011, 1012, 1013]) assert.equal(terminalSignalFailure({ code }), false);
  for (const httpStatus of [409, 429, 500, 502, 503]) assert.equal(terminalSignalFailure({ httpStatus }), false);
});
test('lyric provider labeling requires opt-in and loaded lines; observation timestamp is preserved', () => {
  const track = normalizeTeslaMedia(media, detail, options);
  const lines = [{ time: 0, text: 'Synthetic fixture' }];
  assert.equal(createMediaMessage(track, [], true).lyricProvider, 'none');
  assert.equal(createMediaMessage(track, lines, false).lyricProvider, 'none');
  const message = createMediaMessage(track, lines, true);
  assert.equal(message.lyricProvider, 'lrclib');
  assert.equal(message.provenance, 'tesla-ble');
  assert.equal(message.track.sentAt, options.observedAt);
});
