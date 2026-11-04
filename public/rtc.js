/** Browser WebRTC peer. Signaling transports descriptions only, never video frames. */
export class PeerSession extends EventTarget {
  constructor({ roomId, token, role, iceServers = [] }) {
    super();
    this.roomId = roomId;
    this.token = token;
    this.role = role;
    this.iceServers = iceServers;
    this.pc = null;
    this.socket = null;
    this.stream = null;
    this.queuedIce = [];
    this.closed = false;
    this.incoming = Promise.resolve();
    this.statsTimer = null;
    this.previousStats = null;
    this.localDescriptionSent = false;
    this.pendingLocalIce = [];
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  async connect() {
    const url = new URL('/signal', location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    url.search = new URLSearchParams({ room: this.roomId, role: this.role, token: this.token });
    const socket = this.socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error('信令连接超时')); socket.close(); }, 12000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('信令连接失败')); }, { once: true });
      socket.addEventListener('close', () => { clearTimeout(timer); reject(new Error('信令连接被关闭，请确认配对信息')); }, { once: true });
      socket.addEventListener('message', (event) => {
        this.incoming = this.incoming.then(() => this.handleMessage(JSON.parse(event.data)))
          .catch((error) => this.emit('error', error.message));
      });
      socket.addEventListener('close', () => {
        if (!this.closed) { this.dropPeer(); this.emit('state', 'signaling-closed'); }
      });
    });
    this.emit('state', 'waiting');
  }

  send(message) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
      return true;
    }
    return false;
  }

  createPeer({ preserveQueuedIce = false } = {}) {
    const earlyIce = preserveQueuedIce ? this.queuedIce : [];
    this.dropPeer();
    const pc = this.pc = new RTCPeerConnection({ iceServers: this.iceServers, bundlePolicy: 'max-bundle' });
    this.queuedIce = earlyIce;
    this.localDescriptionSent = false;
    this.pendingLocalIce = [];
    if (this.role === 'publisher') {
      for (const kind of ['video', 'audio']) {
        const track = this.stream?.getTracks().find((candidate) => candidate.kind === kind);
        pc.addTransceiver(track || kind, { direction: 'sendonly', streams: this.stream ? [this.stream] : [] });
      }
    }
    pc.addEventListener('icecandidate', ({ candidate }) => {
      if (this.pc !== pc) return;
      const message = { type: 'ice', candidate: candidate?.toJSON() ?? null };
      if (this.localDescriptionSent) this.send(message);
      else this.pendingLocalIce.push(message);
    });
    pc.addEventListener('connectionstatechange', () => { if (this.pc === pc) this.emit('state', pc.connectionState); });
    pc.addEventListener('iceconnectionstatechange', () => { if (this.pc === pc) this.emit('ice-state', pc.iceConnectionState); });
    pc.addEventListener('track', ({ track, streams }) => {
      if (this.pc !== pc) return;
      if (!this.remoteStream) this.remoteStream = new MediaStream();
      if (!this.remoteStream.getTracks().some((item) => item.id === track.id)) this.remoteStream.addTrack(track);
      this.emit('stream', streams[0] || this.remoteStream);
    });
    this.statsTimer = setInterval(() => this.readStats().catch((error) => this.emit('error', error.message)), 1000);
    return pc;
  }

  async handleMessage(message) {
    if (this.closed) return;
    if (message.type === 'peer-ready') {
      this.emit('peer-ready', {});
      if (this.role === 'publisher') {
        const pc = this.createPeer();
        await pc.setLocalDescription(await pc.createOffer());
        this.sendDescription({ type: 'offer', sdp: pc.localDescription.sdp });
      }
    } else if (message.type === 'offer' && this.role === 'viewer') {
      const pc = this.createPeer({ preserveQueuedIce: true });
      await pc.setRemoteDescription({ type: 'offer', sdp: message.sdp });
      await this.flushIce();
      await pc.setLocalDescription(await pc.createAnswer());
      this.sendDescription({ type: 'answer', sdp: pc.localDescription.sdp });
    } else if (message.type === 'answer' && this.role === 'publisher' && this.pc) {
      await this.pc.setRemoteDescription({ type: 'answer', sdp: message.sdp });
      await this.flushIce();
    } else if (message.type === 'ice') {
      if (this.pc?.remoteDescription) await this.pc.addIceCandidate(message.candidate);
      else this.queuedIce.push(message.candidate);
    } else if (message.type === 'peer-left') {
      this.dropPeer(); this.emit('state', 'peer-left');
    } else if (message.type === 'lyrics') {
      this.emit('lyrics', message);
    } else if (message.type === 'media-status') {
      this.emit('media-status', message);
    } else if (message.type === 'error') {
      this.emit('error', message.message || message.error || '信令服务器拒绝了请求');
    }
  }

  sendDescription(description) {
    this.send(description);
    this.localDescriptionSent = true;
    for (const candidate of this.pendingLocalIce) this.send(candidate);
    this.pendingLocalIce = [];
  }

  async flushIce() {
    for (const candidate of this.queuedIce) await this.pc.addIceCandidate(candidate);
    this.queuedIce = [];
  }

  async setStream(stream) {
    this.stream = stream;
    if (!this.pc || this.role !== 'publisher') return;
    for (const transceiver of this.pc.getTransceivers()) {
      const kind = transceiver.receiver.track.kind;
      const track = stream?.getTracks().find((candidate) => candidate.kind === kind) || null;
      await transceiver.sender.replaceTrack(track);
      if (stream && transceiver.sender.setStreams) transceiver.sender.setStreams(stream);
    }
  }

  async readStats() {
    if (!this.pc || this.pc.connectionState === 'closed') return;
    const reports = await this.pc.getStats();
    let media;
    let pair;
    const expected = this.role === 'viewer' ? 'inbound-rtp' : 'outbound-rtp';
    reports.forEach((report) => {
      if (report.type === expected && (report.kind === 'video' || report.mediaType === 'video') && !report.isRemote) media = report;
      if (report.type === 'transport' && report.selectedCandidatePairId) pair = reports.get(report.selectedCandidatePairId);
    });
    if (!pair) reports.forEach((report) => {
      if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.nominated) pair = report;
    });
    const frames = media?.framesDecoded ?? media?.framesEncoded ?? 0;
    const bytes = media?.bytesReceived ?? media?.bytesSent ?? 0;
    const timestamp = media?.timestamp ?? performance.now();
    const elapsed = this.previousStats ? (timestamp - this.previousStats.timestamp) / 1000 : 0;
    const fps = media?.framesPerSecond ?? (elapsed > 0 ? Math.max(0, (frames - this.previousStats.frames) / elapsed) : null);
    const local = pair ? reports.get(pair.localCandidateId) : null;
    const remote = pair ? reports.get(pair.remoteCandidateId) : null;
    const stats = {
      role: this.role, frames, bytes, fps,
      localCandidateType: local?.candidateType || null,
      remoteCandidateType: remote?.candidateType || null,
      protocol: local?.protocol || null,
      viaRelay: Boolean(local?.candidateType === 'relay' || remote?.candidateType === 'relay'),
      roundTripTimeMs: Number.isFinite(pair?.currentRoundTripTime) ? pair.currentRoundTripTime * 1000 : null,
      connectionState: this.pc.connectionState,
    };
    this.previousStats = { timestamp, frames, bytes };
    this.emit('stats', stats);
    return stats;
  }

  dropPeer() {
    clearInterval(this.statsTimer);
    this.statsTimer = null;
    const previous = this.pc;
    this.pc = null;
    previous?.close();
    this.remoteStream = null;
    this.previousStats = null;
    this.queuedIce = [];
    this.pendingLocalIce = [];
    this.localDescriptionSent = false;
  }

  close() {
    this.closed = true;
    this.dropPeer();
    this.socket?.close();
    this.socket = null;
  }
}
