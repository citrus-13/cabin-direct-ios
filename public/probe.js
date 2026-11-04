const byId = (id) => document.getElementById(id);
let peerA, peerB, stream, drawTimer, stopTimer, statsTimer;
let running = false;
let decoded = 0;
let codec = '—';
let initialCaps = {};
function report(outcome) {
  const data = { ...initialCaps, result: outcome, framesDecoded: decoded, negotiatedCodec: codec, testScope: 'same-page loopback; not iPhone/Tesla cross-device acceptance' };
  byId('probe-report').textContent = JSON.stringify(data, null, 2);
}
function cleanup() {
  clearInterval(drawTimer); clearInterval(statsTimer); clearTimeout(stopTimer);
  peerA?.close(); peerB?.close();
  stream?.getTracks().forEach((track) => track.stop());
  peerA = peerB = stream = null;
  running = false;
  byId('run-probe').disabled = false;
}
function stop(outcome = 'stopped') {
  cleanup();
  report(outcome);
  byId('probe-status').textContent = outcome === 'passed' ? '本机视频回环通过 · 跨设备仍待测' : outcome === 'failed' ? '本次未通过，请保留检测结果' : outcome === 'unsupported' ? '缺少此项检测需要的浏览器能力' : '检测已停止';
}
async function run() {
  cleanup(); decoded = 0; codec = '—';
  initialCaps = {
    timestamp: new Date().toISOString(),
    browser: navigator.userAgent,
    secureContext: window.isSecureContext,
    peerConnection: typeof RTCPeerConnection !== 'undefined',
    canvasCapture: typeof HTMLCanvasElement.prototype.captureStream === 'function',
    screenCapture: Boolean(navigator.mediaDevices?.getDisplayMedia),
    declaredVideoCodecs: typeof RTCRtpReceiver !== 'undefined' ? (RTCRtpReceiver.getCapabilities?.('video')?.codecs || []).map((c) => c.mimeType).filter((v, i, a) => a.indexOf(v) === i) : [],
  };
  report('checking');
  if (!initialCaps.peerConnection || !initialCaps.canvasCapture) { stop('unsupported'); return; }
  running = true; byId('run-probe').disabled = true; byId('probe-status').textContent = '正在进行本机回环检测…';
  try {
    const canvas = byId('probe-canvas');
    const context = canvas.getContext('2d');
    let frame = 0;
    const paint = () => {
      context.fillStyle = '#1b2a21'; context.fillRect(0, 0, 640, 360);
      context.fillStyle = '#c3e69a'; context.font = '30px system-ui'; context.fillText('Cabin / Browser probe', 35, 70);
      context.font = '24px monospace'; context.fillText(`FRAME ${String(frame++).padStart(5, '0')}`, 35, 120);
      context.fillRect((frame * 8) % 580, 220, 60, 60);
    };
    paint(); drawTimer = setInterval(paint, 1000 / 15);
    stream = canvas.captureStream(15);
    const a = peerA = new RTCPeerConnection({ iceServers: [] });
    const b = peerB = new RTCPeerConnection({ iceServers: [] });
    const pendingA = [], pendingB = [];
    a.onicecandidate = ({ candidate }) => { if (b.remoteDescription) b.addIceCandidate(candidate).catch(() => {}); else pendingB.push(candidate); };
    b.onicecandidate = ({ candidate }) => { if (a.remoteDescription) a.addIceCandidate(candidate).catch(() => {}); else pendingA.push(candidate); };
    b.ontrack = ({ streams, track }) => { byId('probe-video').srcObject = streams[0] || new MediaStream([track]); byId('probe-video').play().catch(() => {}); };
    a.addTrack(stream.getVideoTracks()[0], stream);
    // Prefer H.264 when advertised, because the native iOS sender uses this codec.
    const capabilities = RTCRtpSender.getCapabilities?.('video')?.codecs || [];
    const h264 = capabilities.filter((c) => c.mimeType.toLowerCase() === 'video/h264');
    if (h264.length && a.getTransceivers()[0]?.setCodecPreferences) a.getTransceivers()[0].setCodecPreferences([...h264, ...capabilities.filter((c) => c.mimeType.toLowerCase() !== 'video/h264')]);
    await a.setLocalDescription(await a.createOffer());
    await b.setRemoteDescription(a.localDescription);
    for (const candidate of pendingB) await b.addIceCandidate(candidate);
    await b.setLocalDescription(await b.createAnswer());
    await a.setRemoteDescription(b.localDescription);
    for (const candidate of pendingA) await a.addIceCandidate(candidate);
    statsTimer = setInterval(async () => {
      if (!running || peerB !== b) return;
      try {
        const stats = await b.getStats();
        if (!running || peerB !== b) return;
        stats.forEach((s) => { if (s.type === 'inbound-rtp' && s.kind === 'video') { decoded = s.framesDecoded || 0; codec = stats.get(s.codecId)?.mimeType || 'unknown'; } });
        byId('probe-frames').textContent = `${decoded} 帧`;
        byId('probe-codec').textContent = codec;
        report('checking');
      } catch { /* Closing a peer can invalidate an in-flight stats read. */ }
    }, 500);
    stopTimer = setTimeout(() => stop(decoded >= 10 ? 'passed' : 'failed'), 8000);
  } catch (error) {
    initialCaps.error = error.message;
    stop('failed');
  }
}
byId('run-probe').addEventListener('click', run);
byId('stop-probe').addEventListener('click', () => stop());
byId('copy-report').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(byId('probe-report').textContent); byId('copy-report').textContent = '已复制'; }
  catch { byId('copy-report').textContent = '请手动选中并复制右侧结果'; }
});
window.addEventListener('beforeunload', cleanup);
