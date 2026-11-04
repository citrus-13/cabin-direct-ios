import Foundation
import AVFoundation
import ReplayKit
import ImageIO
import WebRTC

/// Owns the transport inside the broadcast extension. The host app can be backgrounded.
/// This does not create an audio track or change AVAudioSession's category/route.
final class ScreenPublisher: NSObject {
    private static let factory: RTCPeerConnectionFactory = {
        RTCInitializeSSL()
        let encoder = RTCDefaultVideoEncoderFactory()
        if let h264 = encoder.supportedCodecs().first(where: { $0.name.uppercased() == "H264" }) {
            encoder.preferredCodec = h264
        }
        return RTCPeerConnectionFactory(encoderFactory: encoder, decoderFactory: RTCDefaultVideoDecoderFactory())
    }()

    private let configuration: SessionConfiguration
    private let onFatalError: (String) -> Void
    private let queue = DispatchQueue(label: "cabinlink.broadcast.transport")
    private let frameLock = NSLock()
    private var framePending = false
    private var lastAcceptedPTS = -Double.infinity
    private var running = false
    private var paused = false
    private var socket: URLSessionWebSocketTask?
    private var urlSession: URLSession?
    private var generation = 0
    private var failures = 0
    private var peer: RTCPeerConnection?
    private var source: RTCVideoSource?
    private var capturer: RTCVideoCapturer?
    private var track: RTCVideoTrack?
    private var remoteDescriptionSet = false
    private var pendingICE: [RTCIceCandidate] = []
    private var localDescriptionSent = false
    private var pendingLocalICE: [[String: Any]] = []
    private var heartbeat: DispatchSourceTimer?
    private var statusMessage = "正在连接配对服务…"
    private var tickCount = 0
    private var adaptedWidth: Int32 = 0
    private var adaptedHeight: Int32 = 0

    init(configuration: SessionConfiguration, onFatalError: @escaping (String) -> Void) {
        self.configuration = configuration
        self.onFatalError = onFatalError
        super.init()
    }

    func start() {
        queue.async { [weak self] in
            guard let self, !self.running else { return }
            self.running = true
            self.connect()
            let timer = DispatchSource.makeTimerSource(queue: self.queue)
            timer.schedule(deadline: .now(), repeating: 2)
            timer.setEventHandler { [weak self] in self?.tick() }
            self.heartbeat = timer
            timer.resume()
        }
    }

    func stop() {
        queue.async { self.stopOnQueue() }
    }

    func setPaused(_ value: Bool) {
        queue.async { [weak self] in
            guard let self else { return }
            self.paused = value
            self.track?.isEnabled = !value
            self.statusMessage = value ? "系统已暂停屏幕广播。" : "系统已恢复屏幕广播。"
        }
    }

    /// Admit at most one outstanding frame. Never queue full-resolution screen buffers.
    func append(_ sample: CMSampleBuffer) {
        let pts = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sample))
        guard pts.isFinite else { return }
        frameLock.lock()
        let enoughTime = pts < lastAcceptedPTS || pts - lastAcceptedPTS >= 1.0 / Double(configuration.captureProfile.maxFPS)
        guard !framePending, enoughTime else { frameLock.unlock(); return }
        framePending = true
        lastAcceptedPTS = pts
        frameLock.unlock()
        queue.async { [weak self] in
            guard let self else { return }
            defer {
                self.frameLock.lock()
                self.framePending = false
                self.frameLock.unlock()
            }
            guard self.running, !self.paused, let source = self.source,
                  let capturer = self.capturer,
                  let pixels = CMSampleBufferGetImageBuffer(sample) else { return }
            let width = Double(CVPixelBufferGetWidth(pixels))
            let height = Double(CVPixelBufferGetHeight(pixels))
            guard let size = self.configuration.captureProfile.outputSize(width: width, height: height) else { return }
            let outputWidth = size.width
            let outputHeight = size.height
            if outputWidth != self.adaptedWidth || outputHeight != self.adaptedHeight {
                source.adaptOutputFormat(toWidth: outputWidth, height: outputHeight,
                                         fps: self.configuration.captureProfile.maxFPS)
                self.adaptedWidth = outputWidth
                self.adaptedHeight = outputHeight
            }
            let attachment = CMGetAttachment(sample, key: RPVideoSampleOrientationKey as CFString,
                                             attachmentModeOut: nil) as? NSNumber
            let orientation = CGImagePropertyOrientation(rawValue: attachment?.uint32Value ?? 1) ?? .up
            let rotation: RTCVideoRotation
            switch orientation {
            case .right, .rightMirrored: rotation = ._90
            case .down, .downMirrored: rotation = ._180
            case .left, .leftMirrored: rotation = ._270
            default: rotation = ._0
            }
            let frame = RTCVideoFrame(buffer: RTCCVPixelBuffer(pixelBuffer: pixels), rotation: rotation,
                                      timeStampNs: Int64(pts * 1_000_000_000))
            source.capturer(capturer, didCapture: frame)
        }
    }

    private func connect() {
        guard running, !configuration.isExpired, let url = configuration.signalingURL else {
            fail("会话已过期。停止广播后回主 App 重新配对。")
            return
        }
        generation += 1
        let current = generation
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 15
        config.waitsForConnectivity = false
        let session = URLSession(configuration: config)
        urlSession = session
        let task = session.webSocketTask(with: url)
        task.maximumMessageSize = 262_144
        socket = task
        task.resume()
        statusMessage = "连接中，等待接收网页…"
        receive(task: task, generation: current)
    }

    private func receive(task: URLSessionWebSocketTask, generation current: Int) {
        task.receive { [weak self, weak task] result in
            guard let self, let task else { return }
            self.queue.async {
                guard self.running, self.generation == current, self.socket === task else { return }
                switch result {
                case .success(let message):
                    let data: Data?
                    switch message {
                    case .data(let received): data = received
                    case .string(let received): data = received.data(using: .utf8)
                    @unknown default: data = nil
                    }
                    if let data, let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                        self.handle(object)
                    }
                    if self.running, self.socket === task { self.receive(task: task, generation: current) }
                case .failure:
                    self.connectionLost(generation: current)
                }
            }
        }
    }

    private func handle(_ object: [String: Any]) {
        switch object["type"] as? String {
        case "connected":
            statusMessage = "配对服务已连接，等待接收网页。"
        case "peer-ready":
            failures = 0
            createOffer()
        case "peer-left":
            closePeer()
            statusMessage = "接收端已离开，等待重新连接。"
        case "answer":
            guard let sdp = object["sdp"] as? String, sdp.utf8.count <= 131_072,
                  let peer else { return }
            peer.setRemoteDescription(RTCSessionDescription(type: .answer, sdp: sdp)) { [weak self, weak peer] error in
                guard let self, let peer else { return }
                self.queue.async {
                    guard self.peer === peer else { return }
                    guard error == nil else { self.fail("接收端视频协商失败。请检查浏览器支持。") ; return }
                    self.remoteDescriptionSet = true
                    self.pendingICE.forEach { peer.add($0, completionHandler: { _ in }) }
                    self.pendingICE.removeAll()
                }
            }
        case "ice":
            guard let value = object["candidate"] as? [String: Any],
                  let sdp = value["candidate"] as? String, !sdp.isEmpty, sdp.utf8.count <= 8192,
                  let line = value["sdpMLineIndex"] as? NSNumber else { return }
            let candidate = RTCIceCandidate(sdp: sdp, sdpMLineIndex: line.int32Value,
                                           sdpMid: value["sdpMid"] as? String)
            if remoteDescriptionSet { peer?.add(candidate, completionHandler: { _ in }) }
            else if pendingICE.count < 128 { pendingICE.append(candidate) }
        case "error":
            fail("配对服务拒绝了会话。请停止广播并重新创建会话。")
        default: break
        }
    }

    private func createOffer() {
        closePeer()
        let config = RTCConfiguration()
        config.sdpSemantics = .unifiedPlan
        config.continualGatheringPolicy = .gatherContinually
        config.iceServers = configuration.iceServers.map {
            RTCIceServer(urlStrings: $0.urls, username: $0.username ?? "", credential: $0.credential ?? "")
        }
        let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        guard let peer = Self.factory.peerConnection(with: config, constraints: constraints, delegate: self) else {
            fail("无法初始化 WebRTC。")
            return
        }
        self.peer = peer
        let source = Self.factory.videoSource(forScreenCast: true)
        self.source = source
        capturer = RTCVideoCapturer(delegate: source)
        let track = Self.factory.videoTrack(with: source, trackId: "screen-video")
        track.isEnabled = !paused
        self.track = track
        if let sender = peer.add(track, streamIds: ["screen-stream"]) {
            let parameters = sender.parameters
            for encoding in parameters.encodings {
                encoding.maxBitrateBps = NSNumber(value: configuration.captureProfile.maxBitrateBps)
                encoding.maxFramerate = NSNumber(value: configuration.captureProfile.maxFPS)
            }
            sender.parameters = parameters
        }
        statusMessage = "正在建立 WebRTC 视频连接…"
        let offerConstraints = RTCMediaConstraints(mandatoryConstraints: ["OfferToReceiveAudio": "false", "OfferToReceiveVideo": "false"], optionalConstraints: nil)
        peer.offer(for: offerConstraints) { [weak self, weak peer] description, error in
            guard let self, let peer else { return }
            self.queue.async {
                guard self.peer === peer else { return }
                guard let description, error == nil else { self.fail("无法生成视频协商信息。") ; return }
                peer.setLocalDescription(description) { [weak self, weak peer] error in
                    guard let self, let peer else { return }
                    self.queue.async {
                        guard self.peer === peer else { return }
                        guard error == nil else { self.fail("无法开始视频协商。") ; return }
                        self.send(["type": "offer", "sdp": description.sdp])
                        self.localDescriptionSent = true
                        self.pendingLocalICE.forEach { self.send($0) }
                        self.pendingLocalICE.removeAll()
                    }
                }
            }
        }
    }

    private func send(_ object: [String: Any]) {
        guard running, let socket, let data = try? JSONSerialization.data(withJSONObject: object),
              let text = String(data: data, encoding: .utf8) else { return }
        let current = generation
        socket.send(.string(text)) { [weak self] error in
            guard let self, error != nil else { return }
            self.queue.async { self.connectionLost(generation: current) }
        }
    }

    private func tick() {
        guard running else { return }
        guard !configuration.isExpired else { fail("配对会话已过期，请停止广播并重新配对。") ; return }
        SharedSession.setStatus("\(statusMessage) \(configuration.captureProfile.title)：\(configuration.captureProfile.summary)。仅视频，音频路由不变。", active: true)
        tickCount += 1
        if tickCount % 10 == 0 {
            let current = generation
            socket?.sendPing { [weak self] error in
                guard let self, error != nil else { return }
                self.queue.async { self.connectionLost(generation: current) }
            }
        }
    }

    private func connectionLost(generation current: Int) {
        guard running, current == generation else { return }
        generation += 1
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        urlSession?.invalidateAndCancel()
        urlSession = nil
        closePeer()
        failures += 1
        guard failures <= 3 else { fail("连接多次中断。请检查网络并重新开启广播。") ; return }
        statusMessage = "连接中断，正在重连（\(failures)/3）…"
        let expected = generation
        queue.asyncAfter(deadline: .now() + Double(failures * 2)) { [weak self] in
            guard let self, self.running, self.generation == expected else { return }
            self.connect()
        }
    }

    private func closePeer() {
        peer?.delegate = nil
        peer?.close()
        peer = nil
        source = nil
        capturer = nil
        track = nil
        remoteDescriptionSet = false
        pendingICE.removeAll()
        localDescriptionSent = false
        pendingLocalICE.removeAll()
        adaptedWidth = 0
        adaptedHeight = 0
    }

    private func stopOnQueue() {
        running = false
        generation += 1
        heartbeat?.cancel()
        heartbeat = nil
        socket?.cancel(with: .normalClosure, reason: nil)
        socket = nil
        urlSession?.invalidateAndCancel()
        urlSession = nil
        closePeer()
    }

    private func fail(_ message: String) {
        guard running else { return }
        stopOnQueue()
        onFatalError(message)
    }
}

extension ScreenPublisher: RTCPeerConnectionDelegate {
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
    func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {}

    func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {
        queue.async { [weak self, weak peerConnection] in
            guard let self, let peerConnection, self.peer === peerConnection else { return }
            let message: [String: Any] = ["type": "ice", "candidate": [
                "candidate": candidate.sdp,
                "sdpMid": candidate.sdpMid as Any? ?? NSNull(),
                "sdpMLineIndex": candidate.sdpMLineIndex
            ]]
            if self.localDescriptionSent { self.send(message) }
            else if self.pendingLocalICE.count < 128 { self.pendingLocalICE.append(message) }
        }
    }

    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {
        queue.async { [weak self, weak peerConnection] in
            guard let self, let peerConnection, self.peer === peerConnection else { return }
            switch newState {
            case .connected, .completed:
                self.failures = 0
                self.statusMessage = "WebRTC 已连接。请在接收网页查看实际帧率与连接类型。"
            case .failed:
                self.statusMessage = "视频链路失败。接收网页刷新可重新协商；热点或 NAT 可能阻止直连。"
            case .disconnected:
                self.statusMessage = "视频连接暂时中断，等待网络恢复。"
            default: break
            }
        }
    }
}
