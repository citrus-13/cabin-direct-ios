import test from 'node:test';
import assert from 'node:assert/strict';
import { PeerSession } from '../public/rtc.js';

class FakePeer extends EventTarget {
  constructor() { super(); this.appliedIce = []; this.connectionState = 'new'; }
  async setRemoteDescription(description) { this.remoteDescription = description; }
  async createAnswer() { return { type: 'answer', sdp: 'test-answer' }; }
  async setLocalDescription(description) {
    this.localDescription = description;
    const event = new Event('icecandidate');
    event.candidate = { toJSON: () => ({ candidate: 'local-candidate' }) };
    this.dispatchEvent(event);
  }
  async addIceCandidate(candidate) { this.appliedIce.push(candidate); }
  close() { this.connectionState = 'closed'; this.dispatchEvent(new Event('connectionstatechange')); }
}

test('ICE arriving before an offer survives peer creation and answer precedes outgoing ICE', async (t) => {
  const previous = globalThis.RTCPeerConnection;
  globalThis.RTCPeerConnection = FakePeer;
  const session = new PeerSession({ role: 'viewer', roomId: '123456', token: 'test' });
  const sent = [];
  session.send = (message) => { sent.push(message); return true; };
  t.after(() => { session.close(); globalThis.RTCPeerConnection = previous; });
  await session.handleMessage({ type: 'ice', candidate: { candidate: 'early-candidate' } });
  await session.handleMessage({ type: 'offer', sdp: 'test-offer' });
  assert.deepEqual(session.pc.appliedIce, [{ candidate: 'early-candidate' }]);
  assert.deepEqual(sent.map(({ type }) => type), ['answer', 'ice']);
});

test('old peer close events cannot overwrite a new connection status', () => {
  const previous = globalThis.RTCPeerConnection;
  globalThis.RTCPeerConnection = FakePeer;
  const session = new PeerSession({ role: 'viewer', roomId: '123456', token: 'test' });
  const states = [];
  session.addEventListener('state', ({ detail }) => states.push(detail));
  try {
    const old = session.createPeer();
    session.createPeer();
    old.dispatchEvent(new Event('connectionstatechange'));
    assert.deepEqual(states, []);
  } finally { session.close(); globalThis.RTCPeerConnection = previous; }
});
