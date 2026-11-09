import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Offline source contracts only: not evidence of real microphone acquisition,
// signed-device Shazam service availability, a match, or synchronization quality.
const source = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const recognizer = source('ios/StandaloneBroadcast/DirectMusicRecognizer.swift');
const runtime = source('ios/StandaloneBroadcast/DirectMusicRuntime.swift');

test('music adapters distinguish default broadcast and explicit microphone input', () => {
  assert.match(runtime, /enum Input \{ case broadcast, microphone \}/);
  assert.match(runtime, /input: Input = \.broadcast/);
  assert.match(runtime, /func append\(_ sample: CMSampleBuffer\) \{\s*guard input == \.broadcast/);
  const ingress = runtime.split('func appendMicrophone(')[1].split('private func updateMicrophoneIngress')[0];
  assert.match(ingress, /guard input == \.microphone, microphoneAdmission\.try\(\)/);
  assert.match(ingress, /value\?\.appendPCM\(buffer\)/);
  assert.doesNotMatch(ingress, /queue\.sync|queue\.async/);
  assert.match(runtime, /guard self\.input != \.microphone \|\| self\.settings\.musicMode != \.manual/);
});

test('microphone callback admits at most one owned capped copy and never retains callback buffer', () => {
  const ingress = recognizer.split('func appendPCM(')[1].split('private static func copyPCM')[0];
  assert.match(ingress, /guard admission\.try\(\)/);
  assert.match(ingress, /guard !stopped, !paused, !disabled, !audioInFlight/);
  assert.match(ingress, /audioGeneration = token/);
  assert.ok(ingress.indexOf('Self.copyPCM(buffer)') < ingress.indexOf('queue.async'));
  const queued = ingress.split('queue.async')[1];
  assert.doesNotMatch(queued, /\bbuffer\b/);
  assert.match(queued, /defer \{ self\.releaseAudio\(token\) \}/);
  assert.match(queued, /self\.isCurrent\(token\)/);
  assert.match(queued, /systemUptime - capturedAt <= Self\.noAudioAfter/);
  assert.match(queued, /processOwned\(owned/);
  const copy = recognizer.split('private static func copyPCM')[1].split('private func releaseAudio')[0];
  for (const constraint of [/rate >= 8_000, rate <= 96_000/, /\(1\.\.\.2\)\.contains\(format\.channelCount\)/,
    /frames > 0, frames <= 24_000, frames <= buffer\.frameCapacity/, /Double\(frames\) \/ rate <= Self\.maxChunkDuration/,
    /source\.count == expectedBuffers/, /byteCount <= 192_000/, /mDataByteSize\) >= byteCount/,
    /copyMemory\(from: input, byteCount: byteCount\)/]) assert.match(copy, constraint);
  assert.match(recognizer, /guard audioGeneration == token else \{ return \}\s*audioInFlight = false; audioGeneration = nil/);
});

test('both inputs share off-callback conversion, audible gate, catalog and genuine observation time', () => {
  const processing = recognizer.split('private func processOwned(')[1].split('private func convert(')[0];
  assert.match(processing, /guard let pcm = convert\(owned\), isCurrent\(token\)/);
  assert.match(processing, /guard isAudible\(pcm\) else \{[\s\S]*clearWindow\(\)/);
  assert.match(processing, /lastActivity = activityAt\s*onAudioActivity\?\(observedAt\)/);
  assert.match(processing, /session\.matchStreamingBuffer\(pcm, at: nil\)/);
  assert.match(recognizer, /observedAt: Date\(\)\.timeIntervalSince1970/);
  assert.match(runtime, /matchedAt: observedAt/);
  assert.match(runtime, /clock\.estimate\(at: now, lastAudioAt: lastAudioAt\)/);
  assert.doesNotMatch(recognizer + runtime, /AVAudioEngine|AVAudioSession|requestRecordPermission|FileManager|\.write\(/);
});

test('only microphone no-match continues with capped cooldown; service errors remain terminal', () => {
  assert.match(runtime, /continuousNoMatch: self\.input == \.microphone/);
  assert.match(recognizer, /continuousNoMatch: Bool = false/);
  assert.match(recognizer, /private static let cooldown = 15\.0/);
  assert.match(recognizer, /private static let maxCooldown = 60\.0/);
  assert.match(recognizer, /min\(Self\.maxCooldown, Self\.cooldown \* pow\(2\.0, Double\(failures - 1\)\)\)/);
  assert.match(recognizer, /if continuousNoMatch \{[\s\S]*status\("no-match"\)[\s\S]*\} else if failures >= Self\.maxFailures \{\s*disable\("no-match"\)/);
  assert.match(recognizer, /if error != nil \{[\s\S]*self\.disable\("unavailable"\)/);
  assert.match(recognizer, /disabled = true; generation &\+= 1/);
  assert.match(runtime, /声学识曲服务不可用[\s\S]*不会付费升级；没有识曲结果/);
});

test('actual PCM copy preserves owned bytes and rejects oversized or unsupported input offline', { timeout: 180_000 }, t => {
  if (process.platform !== 'darwin') return t.skip('Apple audio SDK unavailable; no device evidence inferred');
  const work = mkdtempSync(join(tmpdir(), 'microphone-adapter-'));
  const swift = join(work, 'main.swift');
  // Same-file extension can exercise the exact private copying implementation.
  // No recognizer/session is instantiated and no permission or network is used.
  writeFileSync(swift, recognizer + `
extension DirectMusicRecognizer {
    static func offlineCopyChecks() {
        for common in [AVAudioCommonFormat.pcmFormatFloat32, .pcmFormatInt16, .pcmFormatInt32] {
            for interleaved in [false, true] {
                let format = AVAudioFormat(commonFormat: common, sampleRate: 48000, channels: 2, interleaved: interleaved)!
                let input = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 4800)!
                input.frameLength = 4800
                let original = UnsafeMutableAudioBufferListPointer(input.mutableAudioBufferList)
                for part in original { memset(part.mData!, 0x31, Int(part.mDataByteSize)) }
                let output = copyPCM(input)!
                let copied = UnsafeMutableAudioBufferListPointer(output.mutableAudioBufferList)
                precondition(output.frameLength == 4800 && output.format == format)
                for index in 0..<original.count {
                    precondition(original[index].mData != copied[index].mData)
                    precondition(memcmp(original[index].mData!, copied[index].mData!, Int(copied[index].mDataByteSize)) == 0)
                    memset(original[index].mData!, 0, Int(original[index].mDataByteSize))
                    precondition(copied[index].mData!.load(as: UInt8.self) == 0x31)
                }
            }
        }
        func rejected(rate: Double, channels: AVAudioChannelCount, frames: AVAudioFrameCount) {
            let layout = AVAudioChannelLayout(layoutTag: channels == 3 ? kAudioChannelLayoutTag_MPEG_3_0_A : kAudioChannelLayoutTag_Mono)!
            let format = AVAudioFormat(standardFormatWithSampleRate: rate, channelLayout: layout)
            let input = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: max(frames, 1))!
            input.frameLength = frames
            precondition(copyPCM(input) == nil)
        }
        rejected(rate: 48000, channels: 1, frames: 0)
        rejected(rate: 48000, channels: 1, frames: 12001)
        rejected(rate: 96000, channels: 1, frames: 24001)
        rejected(rate: 192000, channels: 1, frames: 1024)
        rejected(rate: 4000, channels: 1, frames: 100)
        rejected(rate: 48000, channels: 3, frames: 1024)
        print("PASS PCM ownership: 6 formats, 6 rejection cases; no audio capture or recognition")
    }
}
DirectMusicRecognizer.offlineCopyChecks()
`);
  const binary = join(work, 'copy-checks');
  const build = spawnSync('xcrun', ['swiftc', '-swift-version', '5', '-application-extension',
    '-module-cache-path', join(work, 'module-cache'), swift, '-o', binary], { encoding: 'utf8', timeout: 120_000 });
  assert.equal(build.status, 0, build.stderr || build.error?.message);
  const run = spawnSync(binary, [], { encoding: 'utf8', timeout: 15_000 });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /PASS PCM ownership: 6 formats, 6 rejection cases; no audio capture or recognition/);
  t.diagnostic(run.stdout.trim());
});
