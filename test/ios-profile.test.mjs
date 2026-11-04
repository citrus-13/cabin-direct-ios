import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));

test('pure Swift capture profiles, session migration, URLs and reuse (not an iOS build)', (t) => {
  const version = spawnSync('swiftc', ['--version'], { encoding: 'utf8' });
  if (version.error?.code === 'ENOENT') return t.skip('Swift compiler unavailable; no native build inferred');
  assert.equal(version.status, 0, version.stderr);
  // Honor TMPDIR so local runs keep generated executables/cache within their session.
  const temporary = mkdtempSync(join(tmpdir(), 'cabinlink-swift-test-'));
  const main = join(temporary, 'main.swift');
  writeFileSync(main, `import Foundation
func check(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() { fatalError(message) }
}
for profile in CaptureProfile.allCases {
    let expectedFPS: Int32 = profile == .smooth ? 30 : 15
    let expectedLong = profile == .compatible ? 960 : 1280
    let expectedShort = profile == .compatible ? 540 : 720
    check(profile.maxFPS == expectedFPS, "fps")
    check(profile.maxLongEdge == expectedLong, "long edge")
    check(profile.maxShortEdge == expectedShort, "short edge")
    for dimensions in [(2532.0, 1170.0), (1170.0, 2532.0), (1920.0, 1080.0), (1080.0, 1920.0), (100.0, 100.0)] {
        let output = profile.outputSize(width: dimensions.0, height: dimensions.1)!
        check(max(output.width, output.height) <= expectedLong, "long bound")
        check(min(output.width, output.height) <= expectedShort, "short bound")
        check(output.width % 2 == 0 && output.height % 2 == 0, "even dimensions")
        check(Double(output.width) <= dimensions.0 && Double(output.height) <= dimensions.1, "no upscale")
        check(abs(Double(output.width) / Double(output.height) - dimensions.0 / dimensions.1) < 0.02, "aspect preserved")
    }
    check(profile.outputSize(width: .infinity, height: 1080) == nil, "nonfinite rejected")
    check(profile.outputSize(width: 0, height: 1080) == nil, "zero rejected")
}
let base = try SessionConfiguration.validateServer("https://example.test/")
check((try? SessionConfiguration.validateServer("http://10.1.2.3.evil.example")) == nil, "numeric-prefix DNS rejected over HTTP")
check((try? SessionConfiguration.validateServer("http://10.1.2.3")) != nil, "private IPv4 accepted")
check((try? SessionConfiguration.validateServer("http://192.168.1.20:8787")) != nil, "private IPv4 with port accepted")
check((try? SessionConfiguration.validateServer("http://10..1.2.3")) == nil, "empty IPv4 components rejected")
check((try? SessionConfiguration.validateServer("http://10.1.2.3.")) == nil, "trailing empty IPv4 component rejected")
let session = SessionConfiguration(baseURL: base, roomId: "room-test", publisherToken: "publisher-secret",
    viewerToken: "viewer&secret=#", expiresAt: 1800000, iceServers: [], captureProfile: .smooth, receiverLayout: .mirror,
    metadataToken: "metadata-only-secret")
let encoded = try JSONEncoder().encode(session)
let decoded = try JSONDecoder().decode(SessionConfiguration.self, from: encoded)
check(decoded.captureProfile == .smooth && decoded.receiverLayout == .mirror, "roundtrip")
check(decoded.metadataToken == "metadata-only-secret", "metadata credential roundtrip")
let roomResponse = try JSONDecoder().decode(RoomResponse.self, from: encoded)
check(roomResponse.metadataToken == session.metadataToken, "room response retains metadata credential")
var reused = decoded
reused.captureProfile = .compatible
check(reused.metadataToken == session.metadataToken, "reused room retains metadata credential")
var legacy = try JSONSerialization.jsonObject(with: encoded) as! [String: Any]
legacy.removeValue(forKey: "captureProfile")
legacy.removeValue(forKey: "receiverLayout")
legacy.removeValue(forKey: "metadataToken")
let migrated = try JSONDecoder().decode(SessionConfiguration.self, from: JSONSerialization.data(withJSONObject: legacy))
check(migrated.captureProfile == .balanced && migrated.receiverLayout == .split, "legacy defaults")
check(migrated.metadataToken == nil, "legacy session has no metadata credential")
let legacyResponse = try JSONDecoder().decode(RoomResponse.self, from: JSONSerialization.data(withJSONObject: legacy))
check(legacyResponse.metadataToken == nil, "legacy room response has no metadata credential")
legacy["captureProfile"] = "unknown-profile"
legacy["receiverLayout"] = "unknown-layout"
let unknown = try JSONDecoder().decode(SessionConfiguration.self, from: JSONSerialization.data(withJSONObject: legacy))
check(unknown.captureProfile == .balanced && unknown.receiverLayout == .split, "unknown values default safely")
for layout in ReceiverLayout.allCases {
    let url = session.receiverURL(layout: layout)!
    let parts = URLComponents(url: url, resolvingAgainstBaseURL: false)!
    check(parts.queryItems!.contains(URLQueryItem(name: "view", value: layout.rawValue)), "layout query")
    check(parts.queryItems!.contains(URLQueryItem(name: "mode", value: "receiver")), "receiver mode")
    check(!parts.query!.contains("secret") && !url.path.contains("secret"), "secret excluded from request URL")
    var fragment = URLComponents()
    fragment.percentEncodedQuery = parts.percentEncodedFragment
    check(fragment.queryItems!.contains(URLQueryItem(name: "token", value: session.viewerToken)), "fragment roundtrip")
    check(fragment.queryItems!.contains(URLQueryItem(name: "room", value: session.roomId)), "room fragment")
    check(!url.absoluteString.contains(session.publisherToken), "never share publisher token")
    check(!url.absoluteString.contains(session.metadataToken!), "never share metadata token in receiver URLs")
}
check(!session.signalingURL!.absoluteString.contains(session.metadataToken!), "publisher signaling excludes metadata credential")
check(session.receiverURL == session.receiverURL(layout: .mirror), "chosen receiver layout")
check(session.lyricsURL == session.receiverURL(layout: .lyrics), "direct lyrics")
check(session.canReuse(for: base, now: Date(timeIntervalSince1970: 1799)), "room reusable before expiry")
check(!session.canReuse(for: base, now: Date(timeIntervalSince1970: 1800)), "room expires at boundary")
check(!session.canReuse(for: URL(string: "https://other.test")!, now: Date(timeIntervalSince1970: 1)), "never reuse across servers")
check(session.expiresAt == 1800000, "reuse does not renew expiry")
print("Pure Swift capture and session checks passed; iOS frameworks were not compiled.")
`);
  const executable = join(temporary, 'profile-check');
  const compile = spawnSync('swiftc', ['-swift-version', '5', '-module-cache-path', join(temporary, 'module-cache'),
    join(root, 'ios/Shared/SessionConfiguration.swift'), main, '-o', executable], { encoding: 'utf8', timeout: 90_000 });
  assert.equal(compile.status, 0, compile.stderr || compile.error?.message);
  const result = spawnSync(executable, [], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.match(result.stdout, /Pure Swift capture and session checks passed/);
});

test('broadcast uses selected profile for actual frame admission and adaptation, video only', () => {
  const source = readFileSync(join(root, 'ios/Broadcast/ScreenPublisher.swift'), 'utf8');
  assert.match(source, /1\.0 \/ Double\(configuration\.captureProfile\.maxFPS\)/);
  assert.match(source, /configuration\.captureProfile\.outputSize\(width: width, height: height\)/);
  assert.match(source, /fps: self\.configuration\.captureProfile\.maxFPS/);
  assert.match(source, /encoding\.maxFramerate = NSNumber\(value: configuration\.captureProfile\.maxFPS\)/);
  assert.doesNotMatch(source, /audioTrack\(|setCategory\(|overrideOutputAudioPort\(/);
  const handler = readFileSync(join(root, 'ios/Broadcast/SampleHandler.swift'), 'utf8');
  assert.match(handler, /guard sampleBufferType == \.video else/);
});
