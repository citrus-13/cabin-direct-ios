import Foundation
import SwiftUI
import UIKit
import DirectCore

/// No capture APIs and no shared-store writes: this is an original foreground sample only.
@MainActor
final class DirectDemoRuntime: ObservableObject {
    @Published private(set) var session: DirectBroadcastSession?
    @Published private(set) var status: DirectRuntimeStatus?
    @Published private(set) var message = ""
    @Published private(set) var running = false
    @Published private(set) var stopping = false
    @Published private(set) var measuredFPS: Double?

    private var server: LocalHTTPServer?
    private var timer: Timer?
    private var sequence: UInt64 = 0
    private var lastFrameAt: Double = 0
    private var listenerPort: UInt16 = 0
    private var configuredAddresses: [DirectInterfaceAddress] = []

    func start(settings: DirectSettings) {
        guard !running, !stopping else { return }
        guard DirectSessionStore.status()?.isCurrent != true else {
            message = "真实系统广播正在运行；请先停止，不能同时启动演示。"; return
        }
        let addresses = DirectNetworkAddresses.current()
        guard !addresses.isEmpty else {
            message = "未找到可用的本地网络接口。请先连接你控制的 Wi-Fi 或热点，再启动原创演示。"; return
        }
        do {
            var clean = try settings.validated()
            clean.lyricMode = .mirror
            let fresh = try DirectBroadcastSession.fresh(settings: clean)
            let value = DirectBroadcastSession(id: fresh.id, token: fresh.token,
                pairingCode: fresh.pairingCode, createdAt: fresh.createdAt,
                expiresAt: min(fresh.expiresAt, fresh.createdAt + 600), settings: clean)
            let service = LocalHTTPServer(configuration: .init(token: value.token,
                pairingCode: value.pairingCode, expiresAt: value.expiresAt,
                allowedIPv6Hosts: addresses.map(\.address)
                    .filter { DirectNetworkAddresses.localIPv6($0) }), assets: try assets())
            server = service; session = value; running = true
            configuredAddresses = addresses
            sequence = 0; lastFrameAt = 0; listenerPort = 0; measuredFPS = nil
            message = "正在启动原创演示的本地服务。不会录制你的屏幕。"
            publish(state: "starting")
            service.start(port: clean.port, onReady: { [weak self] port in
                Task { @MainActor [weak self] in
                    guard let self, self.running, !self.stopping, self.session?.id == value.id else { return }
                    self.listenerPort = port
                    self.message = "原创演示的本地服务正在监听；尚不代表浏览器已配对或已接收。"
                    self.tick()
                }
            }, onFailure: { [weak self] _ in
                Task { @MainActor [weak self] in
                    guard let self, !self.stopping, self.session?.id == value.id else { return }
                    self.stop(reason: "本地演示监听失败；检查本地网络权限和端口是否被其他会话使用。")
                }
            })
            let heartbeat = Timer(timeInterval: 1, repeats: true) { [weak self] _ in
                Task { @MainActor [weak self] in self?.tick() }
            }
            timer = heartbeat
            RunLoop.main.add(heartbeat, forMode: .common)
        } catch {
            if running { stop() }
            message = "原创演示未能启动；请检查设置与此构建的网页资源。"
        }
    }

    func stop(reason: String = "原创演示已停止；临时画面和配对会话已清除。") {
        guard running, !stopping, let session else { return }
        let stoppingID = session.id
        stopping = true
        timer?.invalidate(); timer = nil
        message = "正在停止原创演示，等待本地服务完成清理；暂不接受重新启动。"
        publish(state: "stopping")
        server?.updateFrame(nil)
        server?.updateState(.init(captureState: "stopped", source: "demo", message: "Original demo stopped"))
        if let server {
            server.stop { [weak self] in
                Task { @MainActor [weak self] in
                    self?.completeStop(matching: stoppingID, reason: reason)
                }
            }
        } else {
            completeStop(matching: stoppingID, reason: reason)
        }
    }

    private func completeStop(matching id: String, reason: String) {
        guard stopping, session?.id == id else { return }
        server = nil; session = nil; status = nil
        running = false; stopping = false; configuredAddresses = []
        sequence = 0; lastFrameAt = 0; listenerPort = 0; measuredFPS = nil
        message = reason
    }

    private func tick() {
        guard running, !stopping, let session else { return }
        guard DirectNetworkAddresses.matches(initial: configuredAddresses, current: DirectNetworkAddresses.current()) else {
            stop(reason: "网络接口或地址已变化，原创演示已停止。请确认新的可信 Wi-Fi / 热点，再手动重新启动并重新配对。"); return
        }
        guard DirectSessionStore.status()?.isCurrent != true else {
            stop(reason: "检测到真实系统广播，原创演示已停止。"); return
        }
        guard UIApplication.shared.applicationState == .active else {
            stop(reason: "原创演示仅前台运行；离开 App 后已停止。"); return
        }
        let now = Date().timeIntervalSince1970
        guard now < session.expiresAt else { stop(reason: "原创演示已到 10 分钟上限，请按需重新启动。"); return }
        guard listenerPort > 0 else { publish(state: "starting"); return }
        // Timer jitter or ready callbacks must never produce more than one frame per second.
        guard now - lastFrameAt >= 1 else { publish(state: "broadcasting"); return }
        let next = sequence + 1
        guard let jpeg = originalCard(sequence: next).jpegData(compressionQuality: 0.72) else {
            stop(reason: "原创样例画面编码失败，服务已停止。"); return
        }
        measuredFPS = lastFrameAt > 0 ? 1 / (now - lastFrameAt) : nil
        sequence = next; lastFrameAt = now
        server?.updateFrame(.init(data: jpeg, sequence: sequence, updatedAt: now, width: 960, height: 540))
        server?.updateState(.init(captureState: "live", sequence: sequence, frameUpdatedAt: now,
            width: 960, height: 540, lyricState: "disabled", source: "demo",
            message: "DEMO / original sample / not your phone screen"))
        publish(state: "broadcasting")
    }

    private func publish(state: String) {
        guard let session else { return }
        status = .init(sessionID: session.id, state: state, message: message,
                       addresses: listenerPort > 0 && !stopping ? configuredAddresses.map(\.address) : [],
                       port: listenerPort, frames: sequence, updatedAt: Date().timeIntervalSince1970)
    }

    private func assets() throws -> [String: LocalHTTPAsset] {
        var result: [String: LocalHTTPAsset] = [:]
        for (file, route, type) in [("index.html", "/", "text/html; charset=utf-8"),
                                    ("direct.js", "/direct.js", "text/javascript; charset=utf-8"),
                                    ("direct.css", "/direct.css", "text/css; charset=utf-8")] {
            guard let url = Bundle.main.url(forResource: file, withExtension: nil, subdirectory: "StandaloneWeb") else {
                throw DemoError.message("Bundled receiver unavailable")
            }
            let data = try Data(contentsOf: url)
            guard !data.isEmpty, data.count <= 524_288 else { throw DemoError.message("Invalid bundled receiver") }
            result[route] = LocalHTTPAsset(data: data, contentType: type)
        }
        return result
    }

    private func originalCard(sequence: UInt64) -> UIImage {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1; format.opaque = true
        return UIGraphicsImageRenderer(size: CGSize(width: 960, height: 540), format: format).image { renderer in
            let context = renderer.cgContext
            UIColor(red: 0.035, green: 0.075, blue: 0.11, alpha: 1).setFill()
            context.fill(CGRect(x: 0, y: 0, width: 960, height: 540))
            UIColor(red: 0.09, green: 0.72, blue: 0.66, alpha: 1).setFill()
            context.fill(CGRect(x: 0, y: 0, width: 12, height: 540))
            draw("CABIN DIRECT", at: CGPoint(x: 48, y: 40), size: 22, color: .lightGray)
            draw("DEMO", at: CGPoint(x: 48, y: 95), size: 68, color: .white)
            draw("Original sample — not your phone screen", at: CGPoint(x: 48, y: 185), size: 28, color: .white)
            draw("Local browser transport / 960 × 540 / ≤ 1 fps", at: CGPoint(x: 48, y: 236), size: 23, color: .lightGray)
            draw(String(format: "FRAME %05llu", sequence), at: CGPoint(x: 48, y: 310), size: 40,
                 color: UIColor(red: 0.25, green: 0.92, blue: 0.81, alpha: 1))
            for index in 0..<20 {
                let highlight = index == Int(sequence % 20)
                (highlight ? UIColor.white : UIColor(white: 1, alpha: 0.15)).setFill()
                UIBezierPath(roundedRect: CGRect(x: CGFloat(48 + index * 42), y: 385, width: 32, height: 12),
                             cornerRadius: 6).fill()
            }
            draw("Foreground only · no capture · no vehicle connection", at: CGPoint(x: 48, y: 455), size: 23, color: .lightGray)
        }
    }

    private func draw(_ text: String, at point: CGPoint, size: CGFloat, color: UIColor) {
        (text as NSString).draw(at: point, withAttributes: [
            .font: UIFont.monospacedSystemFont(ofSize: size, weight: .semibold), .foregroundColor: color
        ])
    }
}
