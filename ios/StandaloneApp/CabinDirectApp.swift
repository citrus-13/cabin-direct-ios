import SwiftUI
import ReplayKit
import UIKit

@main
struct CabinDirectApp: App {
    var body: some Scene { WindowGroup { DirectSetupView() } }
}

@MainActor
final class DirectSetupModel: ObservableObject {
    @Published var settings = DirectSettings()
    @Published var session: DirectBroadcastSession?
    @Published var status: DirectRuntimeStatus?
    @Published var message = "连接自己的 Wi-Fi 或热点，然后保存设置。"
    @Published var saved = false
    @Published var stopPending = false
    @Published var measuredFPS: Double?
    private(set) var preparedSettings: DirectSettings?
    private var stoppingSessionID: String?
    private var recoveredUnconfirmedSessionID: String?
    private var previousSample: DirectRuntimeStatus?

    init() {
        if let stored = try? DirectSessionStore.settings() {
            settings = stored; preparedSettings = stored; saved = true
        }
        refresh()
    }

    var active: Bool { status?.isCurrent == true }

    func refresh() {
        let next = DirectSessionStore.status()
        if let next, next.isCurrent, let previousSample,
           next.sessionID == previousSample.sessionID,
           next.updatedAt > previousSample.updatedAt, next.frames >= previousSample.frames {
            measuredFPS = Double(next.frames - previousSample.frames) / (next.updatedAt - previousSample.updatedAt)
        } else if next?.isCurrent != true || next?.sessionID != previousSample?.sessionID {
            measuredFPS = nil
        }
        if next?.updatedAt != previousSample?.updatedAt || next?.sessionID != previousSample?.sessionID {
            previousSample = next
        }
        status = next
        session = DirectSessionStore.session()
        if let stoppingSessionID {
            if next?.sessionID == stoppingSessionID,
               ["stopped", "ended", "error"].contains(next?.state ?? "") {
                stopPending = false; self.stoppingSessionID = nil
                message = next?.message ?? "扩展已报告停止；本次接收服务已结束。"
            } else if let next, next.sessionID != stoppingSessionID {
                stopPending = false; self.stoppingSessionID = nil
                message = "检测到另一广播会话；旧停止请求不会应用于它。"
            } else {
                // A stale heartbeat is not confirmation that the extension actually stopped.
                message = "停止请求待扩展确认。若未响应，请用 iPhone 系统录屏指示器结束广播。"
            }
        } else if let recoveredUnconfirmedSessionID,
                  next == nil || next?.sessionID == recoveredUnconfirmedSessionID,
                  !["stopped", "ended", "error"].contains(next?.state ?? "") {
            message = "已按你的系统检查解除本地界面等待，但扩展停止仍未确认。没有写入停止状态或注销任何会话；如系统仍在广播，请直接从系统结束。"
        } else if let next, next.isCurrent { message = next.message }
        else if let next, ["stopped", "ended", "error"].contains(next.state) {
            message = next.message
        }
        else if next != nil { message = "广播未运行，或心跳已过期。旧地址与配对码不会作为在线凭据显示。" }
    }

    func save() {
        guard !active, !stopPending else { return }
        do {
            let clean = try settings.validated()
            try DirectSessionStore.saveSettings(clean)
            preparedSettings = clean; settings = clean; saved = true
            message = "设置已保存。确认隐私提示后，亲自点系统广播按钮。"
        } catch { saved = false; message = error.localizedDescription }
    }

    func requestStop() {
        guard let status, status.isCurrent, !stopPending else { return }
        do {
            try DirectSessionStore.requestStop(sessionID: status.sessionID)
            stoppingSessionID = status.sessionID; stopPending = true
            message = "停止请求已提交，等待扩展实际停止；目前不能宣称已停止。"
        } catch { message = "停止请求未写入。请使用系统录屏指示器停止广播。" }
    }

    /// User-confirmed local UI recovery only; never writes shared state or invalidates credentials.
    func releasePendingAfterSystemCheck() {
        guard stopPending, !active else { return }
        recoveredUnconfirmedSessionID = stoppingSessionID
        stoppingSessionID = nil; stopPending = false
        message = "已解除本地界面等待；扩展实际停止仍未确认。没有写入停止状态或注销任何会话。"
    }
}

struct DirectSetupView: View {
    @StateObject private var model = DirectSetupModel()
    @StateObject private var demo = DirectDemoRuntime()
    @Environment(\.scenePhase) private var scenePhase
    @State private var acknowledged = false
    @State private var copied = ""
    @State private var confirmPendingRecovery = false
    private let timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    private var displayedStatus: DirectRuntimeStatus? { demo.running ? demo.status : model.status }
    private var displayedSession: DirectBroadcastSession? { demo.running ? demo.session : model.session }
    private var settingsLocked: Bool { model.active || demo.running || model.stopPending }
    private var currentStatus: DirectRuntimeStatus? {
        guard let value = displayedStatus, value.isCurrent else { return nil }
        return value
    }
    private var pairRemaining: Int {
        guard let status = currentStatus, status.port > 0,
              let session = displayedSession, session.id == status.sessionID else { return 0 }
        return max(0, Int(ceil(min(session.createdAt + 120, session.expiresAt) - Date().timeIntervalSince1970)))
    }
    private var receiverURLs: [String] {
        guard let status = currentStatus, status.port > 0,
              displayedSession?.id == status.sessionID else { return [] }
        return DirectNetworkAddresses.urls(addresses: status.addresses, port: status.port)
    }

    var body: some View {
        TabView {
            NavigationStack { connectView.navigationTitle("Cabin Direct") }
                .tabItem { Label("连接", systemImage: "wifi") }
            NavigationStack { shareView.navigationTitle("共享屏幕") }
                .tabItem { Label("共享", systemImage: "rectangle.on.rectangle") }
            NavigationStack { helpView.navigationTitle("帮助与隐私") }
                .tabItem { Label("帮助", systemImage: "questionmark.circle") }
        }
        .tint(.teal)
        .onReceive(timer) { _ in
            model.refresh()
            if model.active, demo.running { demo.stop(reason: "检测到真实系统广播，原创演示已停止。") }
        }
        .onChange(of: scenePhase) { phase in
            if phase != .active { demo.stop(reason: "演示仅在前台运行；离开 App 后已停止。") }
            if phase == .active { model.refresh() }
            // Never stop the real ReplayKit extension merely because this app backgrounds.
        }
        .onChange(of: model.settings) { _ in
            if !settingsLocked, model.settings != model.preparedSettings { model.saved = false }
        }
        .confirmationDialog("仅解除本地界面等待，不确认广播已经停止", isPresented: $confirmPendingRecovery,
                            titleVisibility: .visible) {
            Button("我已在系统中检查，解除界面等待") { model.releasePendingAfterSystemCheck() }
            Button("取消", role: .cancel) {}
        } message: {
            Text("请先在 iPhone 系统录屏指示器 / 控制中心检查并结束广播。此操作不会发送新的停止请求，不会写入已停止状态，也不会注销旧凭据；扩展停止结果仍未确认。")
        }
    }

    private var connectView: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 10) {
                    Image(systemName: "display.2").font(.largeTitle).foregroundStyle(.teal)
                    Text("停车时，让可见画面多一块屏幕。")
                        .font(.title2.bold())
                    Text("iPhone 本地服务 → 同网络浏览器。接收端不需要安装 App，声音仍由原播放器和你原来的音频连接播放。")
                        .foregroundStyle(.secondary)
                }.padding(.vertical, 8)
                validationNotice
            }
            Section("1 · 使用你信任的网络") {
                Label("手机和接收浏览器必须在实际互通的局域网", systemImage: "wifi")
                Text("仅使用自己控制的 Wi-Fi / 热点。公共 Wi-Fi、访客隔离、VPN 路由或车机浏览器策略可能阻止连接；不会猜测热点网关。")
                    .font(.footnote).foregroundStyle(.secondary)
                Label("本地 HTTP 未加密", systemImage: "lock.open")
                    .foregroundStyle(.orange)
                Text("配对码限制访问，但不能代替 HTTPS。不要在不信任的网络广播私人内容，不要做端口转发或开放公网访问。")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            Section("2 · 先试原创样例，无需录屏") {
                Text("这不是手机画面：发送 App 自绘的 960 × 540 原创演示卡片，每秒最多一帧。可验证真实浏览器配对、接收与刷新，不证明 iPhone 录屏或 Tesla 硬件已通过。")
                    .font(.footnote).foregroundStyle(.secondary)
                if demo.running {
                    Button(demo.stopping ? "正在清理原创演示…" : "停止原创演示", role: .destructive) { demo.stop() }
                        .disabled(demo.stopping)
                    Text(demo.message).font(.footnote)
                    Text("仅前台 · 最多 10 分钟 · 切到其他 App 即停止")
                        .font(.caption).foregroundStyle(.secondary)
                } else {
                    Button { demo.start(settings: model.settings) } label: {
                        Label("启动原创样例演示", systemImage: "play.rectangle.fill")
                    }.disabled(model.active || model.stopPending)
                    if !demo.message.isEmpty { Text(demo.message).font(.footnote) }
                }
            }
            connectionSection
            diagnosticsLink
        }
    }

    private var shareView: some View {
        List {
            Section { validationNotice }
            Section("1 · 选择可见内容处理") {
                Picker("处理方式", selection: $model.settings.lyricMode) {
                    Text("只传画面").tag(DirectLyricMode.mirror)
                    Text("画面 + 设备端文字识别").tag(DirectLyricMode.visibleText)
                }
                Text("默认仅共享可见画面。不读取音乐账号、后台播放列表或车辆数据，不向歌词网站查询。文字识别是可选功能，只识别屏幕上已显示的文字，可能错误或延迟；不是逐字同步歌词服务。")
                    .font(.footnote).foregroundStyle(.secondary)
                if model.settings.lyricMode == .visibleText {
                    DirectRegionPreview(x: model.settings.regionX, y: model.settings.regionY,
                                        width: model.settings.regionWidth, height: model.settings.regionHeight)
                        .frame(height: 170)
                        .accessibilityLabel("文字识别区域示意图，非实际屏幕预览")
                    Text("识别区域（按显示方向，左上角为原点）")
                        .font(.caption).foregroundStyle(.secondary)
                    regionSlider("左侧", value: $model.settings.regionX,
                                 maximum: max(0, 1 - model.settings.regionWidth))
                    regionSlider("顶部", value: $model.settings.regionY,
                                 maximum: max(0, 1 - model.settings.regionHeight))
                    regionSlider("宽度", value: $model.settings.regionWidth, minimum: 0.05,
                                 maximum: 1 - model.settings.regionX)
                    regionSlider("高度", value: $model.settings.regionHeight, minimum: 0.05,
                                 maximum: 1 - model.settings.regionY)
                }
                Stepper("本地端口：\(Int(model.settings.port))", value: $model.settings.port, in: 1024...65535)
                Button("保存共享设置") { model.save() }
                if model.saved { Label("已保存", systemImage: "checkmark.circle").foregroundStyle(.teal) }
            }.disabled(settingsLocked)
            Section("2 · 亲自启动 iOS 系统广播") {
                Toggle("我已停车，并了解屏幕与通知可能被看到", isOn: $acknowledged)
                    .disabled(model.active || demo.running)
                Text("建议先开专注模式，关闭敏感通知并隐藏不想共享的内容。此确认不会启动录屏；只有你点下方系统按钮并在 iOS 面板确认，才会开始广播。")
                    .font(.footnote).foregroundStyle(.secondary)
                if model.saved && acknowledged && !model.active && !demo.running && !model.stopPending {
                    HStack {
                        DirectBroadcastPicker().frame(width: 60, height: 60)
                        Text("点系统录屏图标\n选择 Cabin Direct 并确认开始")
                            .font(.footnote).foregroundStyle(.secondary)
                    }.accessibilityElement(children: .contain)
                } else {
                    Label(model.active ? "系统广播已启动，状态见下方" : (demo.running ? "先停止原创演示，再启动系统广播" : "保存设置并确认隐私提示后显示系统按钮"),
                          systemImage: "record.circle")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Text(model.message).font(.footnote)
                if model.active {
                    Button(model.stopPending ? "停止请求待确认…" : "停止本次系统广播", role: .destructive) {
                        model.requestStop()
                    }.disabled(model.stopPending)
                }
                if model.stopPending {
                    Text("若长时间未确认，使用 iPhone 顶部系统录屏指示器结束。心跳超时不会被当作停止成功。")
                        .font(.caption).foregroundStyle(.orange)
                    if !model.active {
                        Button("我已在系统中检查，解除界面等待") { confirmPendingRecovery = true }
                            .font(.footnote)
                    }
                }
            }
            connectionSection
        }
    }

    private var connectionSection: some View {
        Section("当前会话 · 浏览器接收") {
            HStack {
                Label(statusTitle, systemImage: statusSymbol)
                    .foregroundStyle(currentStatus == nil ? Color.secondary : Color.teal)
                Spacer()
                if demo.running { Text("原创 DEMO").font(.caption.bold()).foregroundStyle(.orange) }
            }
            if let status = currentStatus {
                if receiverURLs.isEmpty {
                    Text(status.port == 0 ? "监听器尚未就绪，暂不显示配对凭据。" : "没有可用的局域网地址。检查 Wi-Fi、热点与本地网络权限；不会猜测网关或显示旧会话地址。")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                ForEach(receiverURLs, id: \.self) { address in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(address).font(.system(.body, design: .monospaced)).textSelection(.enabled)
                        Button { copy(address, label: "地址已复制；其中不包含配对凭据。") } label: {
                            Label("复制此局域网地址", systemImage: "doc.on.doc")
                        }.font(.footnote)
                    }
                }
                if pairRemaining > 0, let session = displayedSession {
                    Text(session.pairingCode)
                        .font(.system(size: 36, weight: .bold, design: .monospaced))
                        .accessibilityLabel("配对码 \(session.pairingCode.map(String.init).joined(separator: " "))")
                    Button("明确复制本次配对码") { copy(session.pairingCode, label: "配对码已复制；请勿发给不信任的人。") }
                    Text("在浏览器输入上方地址，再单独输入此码。剩余 \(pairRemaining) 秒，最多 5 次错误尝试；地址不携带密钥或配对码。")
                        .font(.footnote).foregroundStyle(.secondary)
                } else if status.port > 0 {
                    Text("初次配对窗口已结束，或凭据与当前会话不匹配。已配对浏览器可继续；新浏览器需停止并重新启动一次会话。")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Text("已生成 \(status.frames) 帧 · 本地端口 \(Int(status.port))。帧数和监听状态都不代表浏览器已接收，更不代表实车验收。")
                    .font(.caption).foregroundStyle(.secondary)
            } else {
                Text("没有确认在线的会话。不显示旧配对码或旧连接地址。")
                    .font(.footnote).foregroundStyle(.secondary)
                if let status = displayedStatus, ["stopped", "ended", "error", "stopping"].contains(status.state) {
                    Text(status.message).font(.footnote).foregroundStyle(.secondary)
                }
            }
            if !copied.isEmpty { Text(copied).font(.caption).foregroundStyle(.secondary) }
        }
    }

    private var helpView: some View {
        List {
            Section { validationNotice }
            Section("一步步连接") {
                Text("1. 停车并将手机和接收浏览器接入你控制的网络。允许 iOS 的本地网络访问。")
                Text("2. 可以先在“连接”试原创样例；真实共享请到“共享”保存设置、确认提示，再手动操作系统广播。")
                Text("3. 返回本 App 读取当次局域网地址和 120 秒配对码。在接收浏览器输入地址，再输入配对码。")
                Text("4. 真实广播开始后打开想显示的内容并保持亮屏。主 App 离开前台不会替你停止系统广播；原创演示则会停止。网络接口或地址变化会结束当前会话，需手动重新启动并重新配对。")
            }.font(.footnote)
            Section("隐私与数据") {
                Text("广播可包含屏幕上的消息、账号信息和通知。建议启用专注模式；App 无法保证系统或第三方 App 会隐藏所有敏感内容。")
                Text("画面和可选识别文字仅由手机临时保留最新结果，经过本地 HTTP 传给已配对浏览器；本功能不提供云中继、账号登录、云端 OCR 或网络歌词查询。未配对仍可能打开空的接收页面，不能读取画面。")
                Text("本地 HTTP 不加密。局域网的其他参与者可能观察流量；配对不能消除此风险。配对码只在你明确点复制时写入本机剪贴板，设置 120 秒过期且不参与通用剪贴板；剪贴板最终由 iOS 管理。")
                Text("此版本不录制或转发麦克风、播放器音轨。继续使用原播放器与原有蓝牙 / 其他音频路径，声音能否正常播放须单独测试。")
            }.font(.footnote)
            Section("兼容边界") {
                Text("只能尝试应用允许录制的可见画面。不同音乐 App、版本、方向和歌词布局需逐项测试，不能保证“所有 App 都可用”。文字识别不读取后台音乐信息，也不保证高亮行或逐字时序正确。")
                Text("DRM / 受保护视频可能黑屏或拒绝录制；本 App 不绕过限制。锁屏、广播暂停、系统终止、温度或内存压力可能中断共享，不承诺锁屏持续运行。")
                Text("暂停或画面过期时接收端应清空旧画面。心跳在线仅表示扩展最近报告状态；没有帧不等于接收成功，也没有独立的车机连接证明。")
                Text("Tesla 固件可能阻止本地 HTTP 或 MJPEG；网络互通、车机显示、真实设备电量与稳定性仍需停车实测。")
                Text("开发构建不等于已上架。安装、签名能力、App Group 与 ReplayKit 扩展仍需真实 iPhone 验证；本界面不会要求或代你操作 Apple 账号。")
            }.font(.footnote)
            Section("遇到问题") {
                Text("没有地址：确认 Wi-Fi / 热点、检查路由隔离以及 iOS 设置中的本地网络权限。没有帧：确认系统正在广播并打开允许录制的画面。")
                Text("配对过期：停止旧会话后重新开始，勿重复猜码。停止待确认：直接使用 iOS 录屏指示器结束，不能仅凭 App 显示或心跳过期推断停止。")
            }.font(.footnote)
            diagnosticsLink
        }
    }

    private var validationNotice: some View {
        Label {
            Text("开发验证版 · 未完成真实 iPhone 安装 / 录屏验证，也未通过 Tesla 实车验收。请仅在停车时使用。")
                .font(.footnote)
        } icon: { Image(systemName: "exclamationmark.shield") }
            .foregroundStyle(.orange)
    }

    private var diagnosticsLink: some View {
        Section("诊断") {
            NavigationLink("查看脱敏运行状态") {
                DirectDiagnosticsView(status: displayedStatus, demo: demo.running,
                                      fps: demo.running ? demo.measuredFPS : model.measuredFPS,
                                      stopPending: model.stopPending)
            }
        }
    }

    private var statusTitle: String {
        guard let status = displayedStatus else { return "未启动" }
        if status.state == "stopping" { return "正在停止，等待本地服务清理" }
        if ["stopped", "ended"].contains(status.state) { return "扩展已报告停止" }
        if status.state == "error" { return "扩展报告错误 / 服务已停止" }
        guard status.isCurrent else { return "离线 / 心跳过期（未确认停止）" }
        switch status.state {
        case "starting": return "正在启动本地监听"
        case "waiting": return "监听中，等待首帧"
        case "paused": return "系统广播已暂停"
        case "stale": return "服务在线，画面已过期"
        case "broadcasting": return demo.running ? "原创演示正在生成画面" : "系统广播正在生成画面"
        default: return "状态待确认"
        }
    }
    private var statusSymbol: String {
        if currentStatus?.state == "paused" { return "pause.circle" }
        if currentStatus?.state == "stale" { return "clock.badge.exclamationmark" }
        return currentStatus == nil ? "circle" : "dot.radiowaves.left.and.right"
    }
    private func copy(_ value: String, label: String) {
        UIPasteboard.general.setItems([["public.utf8-plain-text": value]],
                                     options: [.localOnly: true, .expirationDate: Date().addingTimeInterval(120)])
        copied = label
    }
    private func regionSlider(_ title: String, value: Binding<Double>, minimum: Double = 0,
                              maximum: Double) -> some View {
        VStack(alignment: .leading) {
            Text("\(title)：\(Int(value.wrappedValue * 100))%").font(.caption)
            Slider(value: value, in: minimum...max(minimum + 0.001, maximum))
                .accessibilityLabel(title)
        }
    }
}

private struct DirectRegionPreview: View {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .topLeading) {
                RoundedRectangle(cornerRadius: 16).fill(Color.secondary.opacity(0.12))
                VStack(spacing: 6) {
                    Image(systemName: "text.viewfinder").font(.title2)
                    Text("识别范围示意 · 非屏幕预览").font(.caption)
                }.frame(maxWidth: .infinity, maxHeight: .infinity).foregroundStyle(.secondary)
                RoundedRectangle(cornerRadius: 8).stroke(Color.teal, style: StrokeStyle(lineWidth: 2, dash: [6]))
                    .background(Color.teal.opacity(0.12))
                    .frame(width: proxy.size.width * CGFloat(width), height: proxy.size.height * CGFloat(height))
                    .offset(x: proxy.size.width * CGFloat(x), y: proxy.size.height * CGFloat(y))
            }
        }
    }
}

private struct DirectDiagnosticsView: View {
    let status: DirectRuntimeStatus?
    let demo: Bool
    let fps: Double?
    let stopPending: Bool
    @State private var copied = false

    private var diagnosticText: String {
        let age = status.map { max(0, Date().timeIntervalSince1970 - $0.updatedAt) }
        let safeStates = ["starting", "waiting", "broadcasting", "paused", "stale", "stopped", "ended", "error"]
        let state = status.map { safeStates.contains($0.state) ? $0.state : "unknown" } ?? "none"
        return """
        Cabin Direct — redacted diagnostics
        Mode: \(demo ? "original-foreground-demo" : "system-broadcast")
        Reported state: \(state)
        Fresh heartbeat: \(status?.isCurrent == true ? "yes" : "no")
        Heartbeat age seconds: \(age.map { String(format: "%.1f", $0) } ?? "unavailable")
        Reported listener port: \(status.map { String(Int($0.port)) } ?? "unavailable")
        Listener ready: \(status.map { $0.isCurrent && $0.port > 0 ? "yes" : "not confirmed" } ?? "not confirmed")
        Interface address count: \(status?.addresses.count ?? 0)
        Encoded frames: \(status.map { String($0.frames) } ?? "0")
        Sampled FPS: \(fps.map { String(format: "%.1f", $0) } ?? "unavailable")
        Stop confirmation pending: \(stopPending ? "yes" : "no")
        Browser reception / vehicle validation: unverified
        Tokens, pairing codes, session identifiers, addresses and screen text: omitted
        """
    }
    var body: some View {
        List {
            Section {
                Text(diagnosticText).font(.system(.footnote, design: .monospaced)).textSelection(.enabled)
                Button(copied ? "已复制脱敏诊断" : "复制脱敏诊断") {
                    UIPasteboard.general.setItems([["public.utf8-plain-text": diagnosticText]],
                                                 options: [.localOnly: true, .expirationDate: Date().addingTimeInterval(300)])
                    copied = true
                }
            }
            Section {
                Text("这里只显示扩展或演示运行时实际报告的数据。端口为 0 表示尚未报告就绪；FPS 是采样间帧差的估计值，不是车机接收速度。旧心跳不会确认为在线或已停止。诊断不包含配对凭据、地址、会话标识或识别文字；不会自动上传。")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }.navigationTitle("脱敏诊断")
    }
}

struct DirectBroadcastPicker: UIViewRepresentable {
    func makeUIView(context: Context) -> RPSystemBroadcastPickerView {
        let view = RPSystemBroadcastPickerView(frame: .zero)
        view.preferredExtension = Bundle.main.object(forInfoDictionaryKey: "TCBroadcastExtensionIdentifier") as? String
        view.showsMicrophoneButton = false
        view.accessibilityLabel = "打开 Cabin Direct 系统广播面板"
        return view
    }
    func updateUIView(_ view: RPSystemBroadcastPickerView, context: Context) {}
}
