import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Source contracts are not a substitute for signed-device recognition acceptance.
const source = readFileSync(new URL('../ios/StandaloneBroadcast/DirectMusicRecognizer.swift', import.meta.url), 'utf8');

test('music recognizer uses only caller-owned app-audio PCM and the native global catalog', () => {
  assert.match(source, /final class DirectMusicRecognizer: NSObject, SHSessionDelegate/);
  assert.match(source, /CMSampleBufferCopyPCMDataIntoAudioBufferList\(sample/);
  assert.match(source, /AVAudioPCMBuffer\(pcmFormat: format, frameCapacity:/);
  assert.match(source, /let session = SHSession\(\)/);
  assert.match(source, /session\.matchStreamingBuffer\(pcm, at: nil\)/);
  assert.doesNotMatch(source, /AVAudioSession|AVAudioEngine|SHCustomCatalog\(|URLSession|FileManager|\.write\(|requestRecordPermission/);
});

test('single in-flight admission, bounded copies, owned conversion and real RMS gate precede matching', () => {
  assert.match(source, /guard !stopped, !paused, !disabled, !audioInFlight/);
  assert.match(source, /audioInFlight = true[\s\S]*let token = generation[\s\S]*queue\.async/);
  assert.match(source, /defer \{[\s\S]*audioInFlight = false/);
  assert.match(source, /frames > 0, frames <= 24_000/);
  assert.match(source, /Double\(frames\) \/ rate <= Self\.maxChunkDuration/);
  assert.match(source, /capacity <= 11_100/);
  assert.match(source, /guard isAudible\(pcm\) else \{[\s\S]*clearWindow\(\)[\s\S]*return/);
  assert.match(source, /guard value\.isFinite, abs\(value\) <= 1\.5/);
  assert.match(source, /sqrt\(energy \/ Double\(buffer\.frameLength\)\) >= Self\.minimumRMS/);
  assert.ok(source.indexOf('guard isAudible(pcm)') < source.indexOf('onAudioActivity?(Date()'));
  assert.ok(source.indexOf('onAudioActivity?(Date()') < source.indexOf('let session = SHSession()'));
});

test('recognition windows, retries and no-audio freshness are explicitly bounded', () => {
  for (const [name, value] of [['maxChunkDuration', '0.25'], ['noAudioAfter', '3.0'], ['maxWindowDuration', '12.0'],
    ['maxWindowAudio', '10.0'], ['cooldown', '15.0'], ['maxFailures', '3']]) {
    assert.match(source, new RegExp(`private static let ${name} = ${value.replace('.', '\\.')}`));
  }
  assert.match(source, /func tick\(\)/);
  assert.match(source, /now - max\(self\.lastActivity, self\.waitingSince\) >= Self\.noAudioAfter/);
  assert.match(source, /if failures >= Self\.maxFailures \{\s*disable\("no-match"\)/);
  assert.match(source, /if error != nil \{[\s\S]*self\.disable\("unavailable"\)/);
  assert.doesNotMatch(source, /localizedDescription|print\(error|String\(describing: error/);
});

test('stale session results and paused/stopped audio cannot publish new metadata', () => {
  assert.match(source, /matchingSession === session, isCurrent\(sessionGeneration\)/);
  assert.match(source, /now - windowStarted <= Self\.maxWindowDuration/);
  assert.match(source, /now - lastActivity <= Self\.noAudioAfter/);
  assert.match(source, /generation &\+= 1/);
  assert.match(source, /matchingSession\?\.delegate = nil\s*matchingSession = nil/);
  assert.match(source, /converter\?\.reset\(\); converter = nil; inputFormat = nil; expectedPTS = nil/);
  assert.match(source, /return !stopped && !paused && !disabled && generation == token/);
});

test('recognized metadata and public statuses are bounded, without fabricated track duration', () => {
  assert.match(source, /let position = item\.predictedCurrentMatchOffset/);
  assert.match(source, /observedAt: Date\(\)\.timeIntervalSince1970/);
  assert.match(source, /let identifier = Self\.text\(item\.shazamID\)/);
  assert.match(source, /recognitionID: identifier/);
  assert.doesNotMatch(source, /recognitionID:.*title/);
  assert.match(source, /value\.count <= 2_048/);
  assert.match(source, /prefix\(256\)/);
  const statusLiterals = [...source.matchAll(/(?:status|disable)\("([^"]+)"\)/g)].map(match => match[1]);
  assert.ok(statusLiterals.length >= 6);
  assert.ok(statusLiterals.every(value => ['waiting', 'recognizing', 'unavailable', 'no-audio', 'no-match', 'paused', 'stopped'].includes(value)));
  const track = source.match(/struct DirectRecognizedTrack \{([\s\S]*?)\n\}/)[1];
  assert.doesNotMatch(track, /duration/);
});
