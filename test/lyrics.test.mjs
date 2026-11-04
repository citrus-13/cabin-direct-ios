import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLrc, lineAt, playbackPosition, freezePlayback } from '../public/lyrics.js';

test('LRC handles BOM, metadata, repeated timestamps and nonordered lines', () => {
  const parsed = parseLrc('\uFEFF[ti:原创测试]\n[ar:演示]\n[00:10.20]后一句\n[00:01.5][00:05.500]同一句\n无时间戳');
  assert.deepEqual(parsed.metadata, { ti: '原创测试', ar: '演示' });
  assert.deepEqual(parsed.lines, [{ time: 1.5, text: '同一句' }, { time: 5.5, text: '同一句' }, { time: 10.2, text: '后一句' }]);
});

test('LRC offset advances time and malformed seconds do not become lines', () => {
  const { lines } = parseLrc('[offset:500]\n[00:00.20]开头\n[00:02.0]接下来\n[00:99.00]无效');
  assert.deepEqual(lines, [{ time: 0, text: '开头' }, { time: 1.5, text: '接下来' }]);
});

test('timeline handles seeking, exact boundaries and empty lists', () => {
  const lines = [{ time: 2, text: 'A' }, { time: 5, text: 'B' }];
  assert.equal(lineAt(lines, 1), -1);
  assert.equal(lineAt(lines, 2), 0);
  assert.equal(lineAt(lines, 100), 1);
  assert.equal(lineAt(lines, 3), 0);
  assert.equal(lineAt([], 3), -1);
});

test('playback uses receiver elapsed time, honors pause and clamps duration', () => {
  assert.equal(playbackPosition({ position: 10, duration: 60, playing: true }, 1000, 2500), 11.5);
  assert.equal(playbackPosition({ position: 10, duration: 60, playing: false }, 1000, 2500), 10);
  assert.equal(playbackPosition({ position: 59, duration: 60, playing: true }, 1000, 4000), 60);
  assert.equal(playbackPosition({ position: -10, duration: 60, playing: false }, 1000, 4000), 0);
});

test('disconnect freezes an active lyric at its current position without mutating the previous snapshot', () => {
  const snapshot = { track: { position: 10, duration: 60, playing: true }, lines: [], receivedAt: 1000 };
  const frozen = freezePlayback(snapshot, 3500);
  assert.equal(frozen.track.position, 12.5);
  assert.equal(frozen.track.playing, false);
  assert.equal(playbackPosition(frozen.track, frozen.receivedAt, 9000), 12.5);
  assert.equal(snapshot.track.playing, true);
  assert.equal(freezePlayback(null), null);
});
