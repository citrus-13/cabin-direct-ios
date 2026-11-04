import SwiftUI
import ReplayKit
import UIKit

@main
struct TeslaCompanionApp: App {
    var body: some Scene { WindowGroup { SenderView() } }
}

@MainActor
final class SenderModel: ObservableObject {
    @Published var server = ""
    @Published var session: SessionConfiguration?
    @Published var working = false
    @Published var message = "先连接你自己的验证服务器。"
    @Published var broadcastActive = false
    @Published var captureProfile: CaptureProfile = .balanced {
        didSet { UserDefaults.standard.set(captureProfile.rawValue, forKey: "captureProfile") }
    }
    @Published var receiverLayout: ReceiverLayout = .split {
        didSet { UserDefaults.standard.set(receiverLayout.rawValue, forKey: "receiverLayout") }
    }

    var settingsNeedApplying: Bool {
        guard let session else { return true }
        return captureProfile != session.captureProfile || receiverLayout != session.receiverLayout ||
            (try? SessionConfiguration.validateServer(server)) != session.baseURL
    }

    init() {
        let preferredProfile = UserDefaults.standard.string(forKey: "captureProfile")
            .flatMap { CaptureProfile(rawValue: $0) }
        let preferredLayout = UserDefaults.standard.string(forKey: "receiverLayout")
            .flatMap { ReceiverLayout(rawValue: $0) }
        if let saved = try? SharedSession.load() {
            server = saved.baseURL.absoluteString
            if !saved.isExpired {
                session = saved
                message = "已恢复未到期会话。可以复用接收链接；复用不会延长到期时间。"
            }
            captureProfile = preferredProfile ?? saved.captureProfile
            receiverLayout = preferredLayout ?? saved.receiverLayout
        } else {
            captureProfile = preferredProfile ?? .balanced
            receiverLayout = preferredLayout ?? .split
        }
        refreshStatus()
    }

    func refreshStatus() {
        let status = SharedSession.status()
        broadcastActive = status?.isActive == true
        if let status, Date().timeIntervalSince1970 - status.updatedAt < 8 { message = status.message }
        if session?.isExpired == true { message = "会话已到期，请先停止系统广播，再创建新会话。" }
    }

    func createRoom(forceNew: Bool = false) async {
        refreshStatus()
        guard !working, !broadcastActive else { return }
        working = true
        defer { working = false }
        do {
            let base = try SessionConfiguration.validateServer(server)
            // Keep the same credentials and original server expiry. Reusing does not renew the TTL.
            if !forceNew, var existing = session, existing.canReuse(for: base) {
                existing.captureProfile = captureProfile
                existing.receiverLayout = receiverLayout
                try SharedSession.save(existing)
                session = existing
                message = "设置已应用，复用原会话（不延长到期时间）。重新打开接收链接以应用布局。"
                return
            }
            var request = URLRequest(url: base.appendingPathComponent("api/rooms"))
            request.httpMethod = "POST"
            request.timeoutInterval = 15
            let (roomData, roomResult) = try await URLSession.shared.data(for: request)
            guard let response = roomResult as? HTTPURLResponse, response.statusCode == 201 || response.statusCode == 200 else {
                throw DemoError.message("无法创建会话。请检查服务器状态或稍后重试。")
            }
            let room = try JSONDecoder().decode(RoomResponse.self, from: roomData)
            let (configurationData, configurationResult) = try await URLSession.shared.data(from: base.appendingPathComponent("api/config"))
            guard (configurationResult as? HTTPURLResponse)?.statusCode == 200 else {
                throw DemoError.message("无法读取连接配置。")
            }
            let configuration = try JSONDecoder().decode(ServerConfiguration.self, from: configurationData)
            let newSession = SessionConfiguration(baseURL: base, roomId: room.roomId,
                publisherToken: room.publisherToken, viewerToken: room.viewerToken,
                expiresAt: room.expiresAt, iceServers: configuration.iceServers,
                captureProfile: captureProfile, receiverLayout: receiverLayout,
                metadataToken: room.metadataToken)
            try SharedSession.save(newSession)
            session = newSession
            message = "会话已创建。\(captureProfile.title)：\(captureProfile.summary)。在接收端打开链接，再点系统广播按钮。"
        } catch let error as DemoError {
            message = error.localizedDescription
        } catch {
            // URLSession errors can contain a URL; do not surface or log credentials.
            message = "连接失败。确认同一网络、服务器监听地址、HTTPS 证书以及本地网络权限。"
        }
    }
}

struct SenderView: View {
    @StateObject private var model = SenderModel()
    @State private var confirmNewSession = false
    private let timer = Timer.publish(every: 2, on: .main, in: .common).autoconnect()

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Label("Cabin Link · 验证版", systemImage: "rectangle.inset.filled.and.person.filled")
                        .font(.headline)
                    Text("向浏览器发送手机画面。尚未完成 Xcode 编译与真车验收。")
                        .foregroundStyle(.secondary)
                }
                Section("1 · 连接服务") {
                    TextField("https://你的服务域名", text: $model.server)
                        .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                        .disabled(model.working || model.broadcastActive)
                    Picker("画质预设", selection: $model.captureProfile) {
                        ForEach(CaptureProfile.allCases) { profile in Text(profile.title).tag(profile) }
                    }.pickerStyle(.segmented).disabled(model.working || model.broadcastActive)
                    Text(model.captureProfile.summary + "。这是上限，实际帧率取决于设备与网络。流畅档增加耗电与流量。")
                        .font(.caption).foregroundStyle(.secondary)
                    Picker("接收端布局", selection: $model.receiverLayout) {
                        ForEach(ReceiverLayout.allCases) { layout in Text(layout.title).tag(layout) }
                    }.disabled(model.working || model.broadcastActive)
                    Button(model.working ? "正在准备…" : "应用设置并准备会话") {
                        Task { await model.createRoom() }
                    }.disabled(model.working || model.broadcastActive)
                    Text("同一服务器的未到期会话会复用；默认有效期 30 分钟，以服务端到期时间为准。改画质请先停止系统广播，再应用设置并重新开始。")
                        .font(.caption).foregroundStyle(.secondary)
                    if model.session != nil {
                        Button("服务重启或链接失效？创建新会话") { confirmNewSession = true }
                            .disabled(model.working || model.broadcastActive)
                    }
                    Text("局域网测试例如 http://192.168.1.20:8787，请换成 Mac 的实际局域网 IP。不要填写 localhost。")
                        .font(.caption).foregroundStyle(.secondary)
                }
                if let session = model.session, let receiver = session.receiverURL {
                    Section("2 · 打开接收网页") {
                        LabeledContent("会话", value: session.roomId)
                        LabeledContent("当前画质", value: session.captureProfile.summary)
                        Text("到期：\(Date(timeIntervalSince1970: session.expiresAt / 1000).formatted(date: .omitted, time: .shortened))")
                            .font(.caption).foregroundStyle(.secondary)
                        Text("接收链接包含观看凭据，只分享给自己的接收设备。")
                            .font(.caption).foregroundStyle(.secondary)
                        ShareLink("分享接收链接", item: receiver)
                        Button("复制接收链接") { UIPasteboard.general.url = receiver }
                        if let lyrics = session.lyricsURL {
                            ShareLink("分享歌词直达链接", item: lyrics)
                            Button("复制歌词直达链接") { UIPasteboard.general.url = lyrics }
                        }
                        Text("歌词直达链接使用同一会话；本版 iOS 发送端不会读取其他音乐 App 的歌曲或歌词，歌词数据需另行提供。")
                            .font(.caption).foregroundStyle(.secondary)
                        DisclosureGroup("高级 · 本地 BLE 元数据桥接") {
                            Text("此凭据仅允许发布本会话的歌曲/歌词元数据并查询歌词，不能发布屏幕视频，也不是车辆钥匙。只粘贴到你信任的本地桥接程序；不要发给观看者或公开。接收链接不包含它。")
                                .font(.caption).foregroundStyle(.secondary)
                            if let metadataToken = session.metadataToken {
                                Button("复制仅元数据凭据") {
                                    guard !session.isExpired else { return }
                                    let expires = min(Date().addingTimeInterval(120), Date(timeIntervalSince1970: session.expiresAt / 1000))
                                    UIPasteboard.general.setItems([["public.utf8-plain-text": metadataToken]],
                                        options: [.localOnly: true, .expirationDate: expires])
                                    model.message = "仅元数据凭据已复制到本机剪贴板，最多保留 2 分钟；未自动分享。"
                                }.disabled(session.isExpired || model.working)
                                Text("复制仅限本机剪贴板，最多保留 2 分钟，不自动通过通用剪贴板同步。")
                                    .font(.caption).foregroundStyle(.secondary)
                            } else {
                                Text("旧会话没有元数据凭据。需要桥接时，请先停止广播并显式创建新会话。")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        if model.settingsNeedApplying {
                            Text("新设置尚未应用；上方链接仍使用当前会话设置。请先点“应用设置并准备会话”。")
                                .foregroundStyle(.orange)
                        }
                    }
                    Section("3 · 开启系统屏幕广播") {
                        BroadcastPicker().frame(width: 54, height: 54)
                            .disabled(session.isExpired || model.working || model.settingsNeedApplying)
                        Text("点圆形按钮，在系统面板选择 Cabin Link Screen 并开始广播。结束时从系统录屏入口停止。")
                        Text("此版本只传画面。音乐继续走普通蓝牙；请先在停车状态测试普通页面。")
                            .font(.caption).foregroundStyle(.secondary)
                        Text("画面随手机方向旋转并等比例完整显示；黑边是为保留全部内容，不会强制铺满或裁切。请在手机端控制内容，接收网页不提供反向触控。")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                Section("状态") { Text(model.message).accessibilityIdentifier("broadcast-status") }
                Section("验证范围") {
                    Text("iOS 16–26 的 ReplayKit 路径为本版目标；iOS 27 的新采集接口尚未接入验证。热点直连、锁屏恢复、受保护内容和车机解码不能由桌面测试保证。")
                        .font(.caption).foregroundStyle(.secondary)
                    NavigationLink("开源组件许可") {
                        let notices = Bundle.main.url(forResource: "ThirdPartyNotices", withExtension: "txt")
                            .flatMap { try? String(contentsOf: $0, encoding: .utf8) }
                        ScrollView {
                            Text(notices ?? "请查看源码中的 ThirdPartyNotices.txt。")
                                .font(.caption.monospaced()).padding().textSelection(.enabled)
                        }.navigationTitle("组件许可")
                    }
                }
            }.navigationTitle("手机投屏")
        }.onReceive(timer) { _ in model.refreshStatus() }
            .confirmationDialog("创建新会话后需重新分享新链接。旧会话不会被撤销，仍按原时间到期。", isPresented: $confirmNewSession, titleVisibility: .visible) {
                Button("创建新会话") { Task { await model.createRoom(forceNew: true) } }
                Button("取消", role: .cancel) {}
            }
    }
}

struct BroadcastPicker: UIViewRepresentable {
    func makeUIView(context: Context) -> RPSystemBroadcastPickerView {
        let view = RPSystemBroadcastPickerView(frame: CGRect(x: 0, y: 0, width: 54, height: 54))
        view.preferredExtension = Bundle.main.object(forInfoDictionaryKey: "TCBroadcastExtensionIdentifier") as? String
        view.showsMicrophoneButton = false
        return view
    }
    func updateUIView(_ uiView: RPSystemBroadcastPickerView, context: Context) {}
}
