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
    @Published private(set) var observedAddresses: [DirectInterfaceAddress] = []
    private let addressProvider: () -> [DirectInterfaceAddress]
    private(set) var preparedSettings: DirectSettings?
    private var stoppingSessionID: String?
    private var recoveredUnconfirmedSessionID: String?
    private var previousSample: DirectRuntimeStatus?

    init(addressProvider: @escaping () -> [DirectInterfaceAddress] = { DirectNetworkAddresses.current() }) {
        self.addressProvider = addressProvider
        if let stored = try? DirectSessionStore.settings() {
            settings = stored; preparedSettings = stored; saved = true
        }
        refresh()
    }

    var active: Bool { status?.isCurrent == true }

    func refresh() {
        // Passive interface enumeration only. Publish changes, not every timer
        // tick; never retain yesterday's URL as today's bookmark preview.
        let observed = DirectNetworkAddresses.prioritized(addressProvider())
        if observed != observedAddresses { observedAddresses = observed }
        let next = DirectSessionStore.status()
        if let next, next.isCurrent, let previousSample,
           next.sessionID == previousSample.sessionID,
           next.updatedAt > previousSample.updatedAt, next.frames >= previousSample.frames {
            measuredFPS = Double(next.frames - previousSample.frames) / (next.updatedAt - previousSample.updatedAt)
        } else if next?.isCurrent != true || next?.sessionID != previousSample?.sessionID {
            if measuredFPS != nil { measuredFPS = nil }
        }
        if next?.updatedAt != previousSample?.updatedAt || next?.sessionID != previousSample?.sessionID {
            previousSample = next
        }
        // Avoid invalidating an idle UI for nil -> nil. Preserve every nonnil
        // refresh so countdowns and time-based heartbeat expiry still redraw.
        if next != nil || status != nil { status = next }
        let nextSession = DirectSessionStore.session()
        if nextSession != nil || session != nil { session = nextSession }
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
    @Environment(\.scenePhase) private var scenePhase
    @State private var selectedTab = 0
    @State private var acknowledged = false
    @State private var showBroadcast = false
    @State private var copied = ""
    @State private var actionNotice: String?
    @State private var confirmPendingRecovery = false
    @State private var appearanceChoice: DirectAppearanceChoice = .system
    @ScaledMetric(relativeTo: .body) private var regionPreviewHeight: CGFloat = 170
    private let timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    private var settingsLocked: Bool { model.active || model.stopPending }
    private var currentStatus: DirectRuntimeStatus? {
        guard let value = model.status, value.isCurrent else { return nil }
        return value
    }
    private var pairRemaining: Int {
        guard addressPresentation.state == .listening,
              let status = currentStatus, status.port > 0,
              let session = model.session, session.id == status.sessionID else { return 0 }
        return max(0, Int(ceil(min(session.createdAt + 120, session.expiresAt) - Date().timeIntervalSince1970)))
    }
    private var addressPresentation: DirectAddressPresentation {
        DirectAddressPresentation.resolve(status: model.status, sessionID: model.session?.id,
            stopPending: model.stopPending, observed: model.observedAddresses, configuredPort: model.settings.port)
    }
    private var receiverURLs: [String] { addressPresentation.urls }

    var body: some View {
        TabView(selection: $selectedTab) {
            NavigationStack { shareView.navigationTitle("Cabin") }
                .tabItem { Label("投屏", systemImage: "rectangle.on.rectangle").accessibilityIdentifier("tab.share") }
                .tag(0)
            NavigationStack { settingsView.navigationTitle("设置") }
                .tabItem { Label("设置", systemImage: "gearshape").accessibilityIdentifier("tab.settings") }
                .tag(1)
        }
        .tint(.teal)
        .preferredColorScheme(appearanceChoice.colorScheme)
        .sheet(isPresented: $showBroadcast) { broadcastSheet }
        .onOpenURL { url in
            guard !settingsLocked, let track = DirectTrackImport.parse(url) else {
                actionNotice = "请先停止投屏，再导入完整的歌名和歌手。"; return
            }
            model.settings.musicMode = .manual
            model.settings.musicTitle = track.title
            model.settings.musicArtist = track.artist
            model.settings.musicPosition = track.position
            // An imported URL fills a draft; it never grants network or capture consent.
            model.settings.networkLyricsAllowed = false
            model.saved = false
            selectedTab = 1
            actionNotice = "曲目已填好。你可以选择是否获取歌词。"
        }
        .onReceive(timer) { _ in
            // Freshness, session matching and expiry remain internal gates, not UI diagnostics.
            model.refresh()
            if model.active { showBroadcast = false }
        }
        .onChange(of: scenePhase) { phase in
            if phase == .active { model.refresh() }
            // Never stop the real ReplayKit extension merely because this app backgrounds.
        }
        .onChange(of: model.settings) { _ in
            if !settingsLocked, model.settings != model.preparedSettings { model.saved = false }
        }
        .onChange(of: receiverURLs) { _ in copied = "" }
        .confirmationDialog("已经在系统里停止投屏了吗？", isPresented: $confirmPendingRecovery,
                            titleVisibility: .visible) {
            Button("已检查，返回操作") { model.releasePendingAfterSystemCheck() }
            Button("取消", role: .cancel) {}
        } message: {
            Text("请先点 iPhone 顶部的录屏标记结束广播。这里仅恢复按钮，不会替你停止系统录屏。")
        }
    }

    private var shareView: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 14) {
                    Image(systemName: "display.2").font(.system(size: 42)).foregroundStyle(.teal)
                    Text("手机画面，直接上大屏")
                        .font(.title2.bold()).accessibilityAddTraits(.isHeader)
                        .accessibilityIdentifier("share.headline")
                    Text("车机连接这台手机的热点，或与手机连接同一 Wi-Fi。停车后使用。")
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("share.network-guidance")
                    Label(statusTitle, systemImage: statusSymbol)
                        .foregroundStyle(currentStatus == nil ? Color.secondary : Color.teal)
                        .accessibilityIdentifier("session.status")
                }.padding(.vertical, 12)
                if settingsLocked {
                    Button(model.stopPending ? "正在停止…" : "停止投屏", role: .destructive) {
                        model.requestStop()
                        actionNotice = model.stopPending ? nil : "请点 iPhone 顶部的录屏标记停止投屏。"
                    }
                        .disabled(model.stopPending)
                        .accessibilityIdentifier("action.broadcast.stop")
                    if model.stopPending {
                        Text("若没有停止，请点 iPhone 顶部的录屏标记结束广播。")
                            .font(.footnote).foregroundStyle(.secondary)
                        if !model.active {
                            Button("我已在系统中停止") { confirmPendingRecovery = true }
                                .accessibilityIdentifier("action.stop-recovery")
                        }
                    }
                } else {
                    Button { prepareBroadcast() } label: {
                        Label("开始投屏", systemImage: "play.fill")
                            .font(.headline).frame(maxWidth: .infinity, minHeight: 34)
                    }
                    .buttonStyle(.borderedProminent)
                    .accessibilityIdentifier("action.broadcast.prepare")
                    .accessibilityHint("打开共享确认，仍需你在 iOS 系统面板开始广播")
                }
                if let actionNotice { Text(actionNotice).font(.footnote).foregroundStyle(.secondary) }
            }
            connectionSection
            Section {
                DisclosureGroup("如何连接") {
                    Text("手机开热点：先让车机连接这台 iPhone 的个人热点，再开始投屏。")
                    Text("家里 Wi-Fi 或另一台设备的热点：手机和车机连接同一个网络，再开始投屏。")
                    Text("可先将首页地址存为车机书签；开始投屏后才能打开。换网络后地址可能变化，请核对首页。")
                    Text("网络切换后重新开始投屏；不需要 Mac 中转。")
                    Text("若车机打不开地址，可尝试其他地址，并确认允许 Cabin 访问本地网络。访客网络可能不允许设备互连。")
                }
                .font(.footnote).foregroundStyle(.secondary)
                .accessibilityIdentifier("network.connection-help")
            }
            if model.status?.state == "error" {
                Section {
                    Text("投屏已中断。确认车机仍连接热点或同一 Wi-Fi，然后重新开始投屏。")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
        }
        .accessibilityIdentifier("screen.share")
    }

    private func prepareBroadcast() {
        guard !settingsLocked else { return }
        guard !DirectNetworkAddresses.current().isEmpty else {
            actionNotice = "暂未找到可用连接地址。请确认车机已连接这台手机的热点，或手机与车机已连接同一 Wi-Fi，再重试。"
            return
        }
        model.save()
        guard model.saved else {
            actionNotice = model.settings.musicMode == .manual
                ? "请先在设置里填写歌名和歌手。" : "暂时无法保存设置，请稍后重试。"
            return
        }
        actionNotice = nil
        acknowledged = false
        showBroadcast = true
    }

    private var broadcastSheet: some View {
        NavigationStack {
            List {
                Section {
                    Text("开始共享屏幕").font(.title2.bold()).accessibilityAddTraits(.isHeader)
                    Text("画面和通知会显示在已配对的设备上，建议先开启专注模式。")
                    Label("只使用可信网络；本地 HTTP 未加密。", systemImage: "lock.open")
                        .font(.footnote).foregroundStyle(.secondary)
                        .accessibilityIdentifier("network.http-warning")
                    Toggle("我已停车，并同意共享屏幕", isOn: $acknowledged)
                        .disabled(model.active)
                        .accessibilityIdentifier("consent.screen-sharing")
                }
                Section {
                    if model.saved && acknowledged && !model.active && !model.stopPending {
                        HStack(spacing: 16) {
                            DirectBroadcastPicker().frame(width: 60, height: 60)
                            Text("点录屏按钮，再在系统弹窗中选择“开始广播”。")
                                .font(.callout)
                        }.accessibilityElement(children: .contain)
                    } else {
                        Text("确认后显示系统录屏按钮。").foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle("投屏")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("取消") { showBroadcast = false } } }
        }
    }

    private var settingsView: some View {
        List {
            Section {
                Picker("识曲方式", selection: $model.settings.musicMode) {
                    Text("关闭").tag(DirectMusicMode.off)
                    Text("自动识曲").tag(DirectMusicMode.appAudio)
                    Text("手动选曲").tag(DirectMusicMode.manual)
                }
                .accessibilityIdentifier("setting.music-mode")
                .accessibilityLabel("识曲方式")
                .accessibilityValue(model.settings.musicMode == .off ? "关闭" :
                    model.settings.musicMode == .appAudio ? "自动识曲" : "手动选曲")
                if model.settings.musicMode == .appAudio {
                    Text("投屏时将音频声纹交给 Apple / Shazam 识曲，不使用麦克风。部分播放器可能无法提供音频。")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                if model.settings.musicMode == .manual {
                    TextField("歌名", text: $model.settings.musicTitle).accessibilityIdentifier("setting.music-title")
                    TextField("歌手", text: $model.settings.musicArtist).accessibilityIdentifier("setting.music-artist")
                    Stepper("开始时已播放 \(Int(model.settings.musicPosition)) 秒",
                            value: $model.settings.musicPosition, in: 0...86_400, step: 1)
                    Text("切歌后更新曲目；歌词时间可能有偏差。")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                if model.settings.musicMode != .off {
                    Toggle("获取歌词", isOn: $model.settings.networkLyricsAllowed)
                        .accessibilityIdentifier("consent.network-lyrics")
                    Text("开启后将歌名和歌手发送至 LRCLIB，歌词显示给已配对设备。只用于你有权使用的内容。")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            } header: { Text("音乐") } footer: { Text("修改会在下次开始投屏时使用。") }
            .disabled(settingsLocked)

            Section("画面") {
                Toggle("提取屏幕文字", isOn: Binding(
                    get: { model.settings.lyricMode == .visibleText },
                    set: { model.settings.lyricMode = $0 ? .visibleText : .mirror }))
                    .accessibilityIdentifier("setting.visible-text")
                    .accessibilityHint("在手机上识别画面中已有的文字，不查询网络")
                if model.settings.lyricMode == .visibleText {
                    NavigationLink { regionView } label: { Text("调整文字区域") }
                        .accessibilityIdentifier("setting.region.open")
                }
            }.disabled(settingsLocked)

            Section {
                NavigationLink { DirectPrivacyStatementView() } label: {
                    Label("隐私说明", systemImage: "hand.raised")
                }.accessibilityIdentifier("help.privacy")
                NavigationLink { DirectSupportAboutView(appearanceChoice: $appearanceChoice) } label: {
                    Label("关于 Cabin", systemImage: "info.circle")
                }.accessibilityIdentifier("help.support")
            }
            if settingsLocked {
                Section { Text("停止投屏后可以修改设置。").font(.footnote).foregroundStyle(.secondary) }
            }
            if let actionNotice {
                Section { Text(actionNotice).font(.footnote).foregroundStyle(.secondary) }
            }
        }
        .accessibilityIdentifier("screen.settings")
    }

    private var regionView: some View {
        List {
            Section {
                DirectRegionPreview(x: model.settings.regionX, y: model.settings.regionY,
                                    width: model.settings.regionWidth, height: model.settings.regionHeight)
                    .frame(height: regionPreviewHeight)
                    .accessibilityElement(children: .ignore)
                    .accessibilityAddTraits(.isImage)
                    .accessibilityLabel("文字识别区域示意图，非实际屏幕预览")
                    .accessibilityIdentifier("setting.region.preview")
                    .accessibilityValue("左侧 \(Int(model.settings.regionX * 100))%，顶部 \(Int(model.settings.regionY * 100))%，宽度 \(Int(model.settings.regionWidth * 100))%，高度 \(Int(model.settings.regionHeight * 100))%")
                regionSlider("左侧", identifier: "setting.region.x", value: $model.settings.regionX,
                             maximum: max(0, 1 - model.settings.regionWidth))
                regionSlider("顶部", identifier: "setting.region.y", value: $model.settings.regionY,
                             maximum: max(0, 1 - model.settings.regionHeight))
                regionSlider("宽度", identifier: "setting.region.width", value: $model.settings.regionWidth, minimum: 0.05,
                             maximum: 1 - model.settings.regionX)
                regionSlider("高度", identifier: "setting.region.height", value: $model.settings.regionHeight, minimum: 0.05,
                             maximum: 1 - model.settings.regionY)
            }.disabled(settingsLocked)
        }
        .navigationTitle("文字区域")
        .accessibilityIdentifier("screen.region")
    }

    private var connectionSection: some View {
        Section("车机连接地址") {
            Text(addressCaption).font(.footnote).foregroundStyle(.secondary)
                .accessibilityIdentifier("network.address-status")
            if let address = receiverURLs.first {
                receiverAddressRow(address, identifier: "action.receiver.copy-address")
            } else if addressPresentation.state == .notStarted || addressPresentation.state == .listening {
                Text("先让车机连接这台手机的热点，或连接同一 Wi-Fi。")
                    .font(.footnote).foregroundStyle(.secondary)
                    .accessibilityIdentifier("network.address-unavailable")
            }
            if receiverURLs.count > 1 {
                DisclosureGroup("打不开？试试其他地址") {
                    ForEach(Array(receiverURLs.dropFirst().enumerated()), id: \.offset) { entry in
                        receiverAddressRow(entry.element, identifier: "action.receiver.copy-alternative-\(entry.offset)")
                    }
                }
                .accessibilityIdentifier("network.alternative-addresses")
            }
            if addressPresentation.state == .notStarted, !receiverURLs.isEmpty {
                Text("可先收藏；开始投屏后才能打开。换网络后地址可能变化。")
                    .font(.footnote).foregroundStyle(.secondary)
                    .accessibilityIdentifier("network.bookmark-guidance")
            }
            if addressPresentation.state == .listening {
                if pairRemaining > 0, let session = model.session {
                    Text(session.pairingCode)
                        .font(.system(.largeTitle, design: .monospaced).weight(.bold))
                        .accessibilityLabel("配对码 \(session.pairingCode.map(String.init).joined(separator: " "))")
                    Button("复制配对码") { copy(session.pairingCode, label: "配对码已复制") }
                        .accessibilityIdentifier("action.receiver.copy-code")
                    Text("打开地址后输入此码，\(pairRemaining) 秒内有效。")
                        .font(.footnote).foregroundStyle(.secondary)
                } else {
                    Text("配对码已过期。新设备连接时，请停止后重新开始。")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            if !copied.isEmpty { Text(copied).font(.caption).foregroundStyle(.secondary) }
        }
    }

    private var addressCaption: String {
        switch addressPresentation.state {
        case .notStarted: return "尚未开始投屏"
        case .preparing: return "正在准备连接地址…"
        case .listening: return "在车机浏览器打开此地址。"
        case .unconfirmed: return "投屏状态待确认，请检查 iPhone 顶部录屏标记。"
        case .stopping: return "正在停止投屏…"
        }
    }

    private func receiverAddressRow(_ address: String, identifier: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(address).font(.system(.body, design: .monospaced)).textSelection(.enabled)
                .accessibilityIdentifier(identifier + ".value")
            Button { copy(address, label: "地址已复制") } label: {
                Label("复制地址", systemImage: "doc.on.doc")
            }.font(.footnote).accessibilityIdentifier(identifier)
        }
    }

    private var statusTitle: String {
        if addressPresentation.state == .stopping { return "正在停止…" }
        if addressPresentation.state == .unconfirmed { return "连接中断，请检查系统投屏状态" }
        guard let status = model.status else { return "准备就绪" }
        if ["stopped", "ended"].contains(status.state) { return "已停止" }
        if status.state == "error" { return "投屏中断" }
        guard status.isCurrent else { return "连接中断，请检查系统投屏状态" }
        switch status.state {
        case "starting": return "正在准备…"
        case "waiting": return "等待画面"
        case "paused": return "已暂停"
        case "stale": return "画面已暂停"
        case "broadcasting": return "正在投屏"
        default: return "正在连接…"
        }
    }
    private var statusSymbol: String {
        if currentStatus?.state == "paused" || currentStatus?.state == "stale" { return "pause.circle" }
        return currentStatus == nil ? "circle" : "dot.radiowaves.left.and.right"
    }
    private func copy(_ value: String, label: String) {
        UIPasteboard.general.setItems([["public.utf8-plain-text": value]],
                                     options: [.localOnly: true, .expirationDate: Date().addingTimeInterval(120)])
        copied = label
    }
    private func regionSlider(_ title: String, identifier: String, value: Binding<Double>, minimum: Double = 0,
                              maximum: Double) -> some View {
        VStack(alignment: .leading) {
            Text("\(title)：\(Int(value.wrappedValue * 100))%").font(.caption).accessibilityHidden(true)
            Slider(value: value, in: minimum...max(minimum + 0.001, maximum))
                .accessibilityLabel(title)
                .accessibilityValue("\(Int(value.wrappedValue * 100))%")
                .accessibilityIdentifier(identifier)
        }.accessibilityElement(children: .contain)
    }
}

private enum DirectAppearanceChoice: String, CaseIterable, Identifiable {
    case system, light, dark
    var id: String { rawValue }
    var title: String {
        switch self {
        case .system: return "跟随系统"
        case .light: return "浅色"
        case .dark: return "深色"
        }
    }
    var colorScheme: ColorScheme? {
        switch self {
        case .system: return nil
        case .light: return .light
        case .dark: return .dark
        }
    }
}

private struct DirectPrivacyStatementView: View {
    private let sourceURL = URL(string: "https://github.com/citrus-13/cabin-direct-ios/blob/codex/public-build/docs/PRIVACY.md")!

    var body: some View {
        List {
            Section {
                Text("隐私说明").font(.title2.bold()).accessibilityAddTraits(.isHeader)
                    .accessibilityIdentifier("privacy.heading")
                Text("你决定何时投屏。只有你在 iOS 系统面板或控制中心确认后，才会开始共享。")
            }
            Section("共享什么") {
                Text("画面可能包含通知和私人消息，建议使用专注模式。只共享你有权显示的内容；受保护视频可能无法投屏。")
                Text("画面与提取的文字在手机本地处理，只发送给已配对的浏览器。不使用麦克风，不保存或转发音轨。声音继续由原播放器播放。")
                Label("本地 HTTP 未加密，只使用可信网络。", systemImage: "lock.open")
                    .foregroundStyle(.secondary).accessibilityIdentifier("privacy.http-warning")
                Text("配对码不等于加密。不要公开地址或配对码，也不要将服务开放到公网。")
            }
            Section("识曲和歌词") {
                Text("两项功能默认关闭。选择自动识曲后，音频声纹会交给 Apple / Shazam。开启获取歌词后，歌名和歌手会发送至 LRCLIB。")
                Text("不会读取音乐账号或车辆数据。识曲、歌词覆盖和同步精度取决于音源与服务；只使用你有权使用的歌词。")
            }
            Section("保存与停止") {
                Text("设置和最后运行状态保存在本机。画面、识曲结果和歌词只保留本次会话需要的最新内容，不自动上传诊断信息。")
                Text("只有点复制才会写入本机剪贴板，内容两分钟后过期且不参与通用剪贴板。配对凭据随会话失效。")
                Text("退出 App 不会替你停止系统投屏。请用停止按钮或 iPhone 顶部录屏标记结束；锁屏或系统限制可能中断投屏。")
            }
            Section {
                Link("完整隐私说明", destination: sourceURL).accessibilityIdentifier("privacy.source-link")
            }
        }.navigationTitle("隐私").accessibilityIdentifier("screen.privacy")
    }
}

private struct DirectSupportAboutView: View {
    @Binding var appearanceChoice: DirectAppearanceChoice
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    private let sourceURL = URL(string: "https://github.com/citrus-13/cabin-direct-ios/blob/codex/public-build/docs/SUPPORT.md")!
    private var version: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "未提供"
    }
    private var build: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "未提供"
    }

    var body: some View {
        List {
            Section {
                Text("Cabin Direct").font(.title2.bold()).accessibilityAddTraits(.isHeader)
                    .accessibilityIdentifier("about.heading")
                    .accessibilityValue(textSizeName)
                Text("版本 \(version)（构建 \(build)）")
                    .accessibilityIdentifier("about.version")
                Text("个人预览版").font(.footnote).foregroundStyle(.secondary)
            }
            Section("外观") {
                Picker("App 外观", selection: $appearanceChoice) {
                    ForEach(DirectAppearanceChoice.allCases) { choice in
                        Text(choice.title).tag(choice)
                            .accessibilityIdentifier("setting.appearance.\(choice.rawValue)")
                    }
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("setting.appearance")
                .accessibilityLabel("App 外观")
                .accessibilityValue(appearanceName)
                .accessibilityHint("本次打开期间生效；不修改系统设置")
            }
            Section {
                Link("项目与支持", destination: sourceURL).accessibilityIdentifier("support.source-link")
            }
        }.navigationTitle("关于 Cabin").accessibilityIdentifier("screen.support")
    }

    private var appearanceName: String { colorScheme == .dark ? "深色" : "浅色" }
    private var textSizeName: String { dynamicTypeSize.isAccessibilitySize ? "辅助功能字号" : "标准字号" }
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
                Image(systemName: "text.viewfinder").font(.largeTitle)
                    .frame(maxWidth: .infinity, maxHeight: .infinity).foregroundStyle(.secondary)
                RoundedRectangle(cornerRadius: 8).stroke(Color.teal, style: StrokeStyle(lineWidth: 2, dash: [6]))
                    .background(Color.teal.opacity(0.12))
                    .frame(width: proxy.size.width * CGFloat(width), height: proxy.size.height * CGFloat(height))
                    .offset(x: proxy.size.width * CGFloat(x), y: proxy.size.height * CGFloat(y))
            }
        }
    }
}

struct DirectBroadcastPicker: UIViewRepresentable {
    func makeUIView(context: Context) -> RPSystemBroadcastPickerView {
        let view = RPSystemBroadcastPickerView(frame: .zero)
        let identifier = DirectInstallationIdentifiers.bundledBroadcastExtension()
        view.preferredExtension = identifier
        // A nil preference could offer unrelated broadcast extensions. Fail closed.
        view.isUserInteractionEnabled = identifier != nil
        view.showsMicrophoneButton = false
        view.accessibilityLabel = identifier == nil ? "Cabin Direct 广播扩展配置不可用" : "打开 Cabin Direct 系统广播面板"
        if identifier == nil { view.accessibilityTraits.insert(.notEnabled) }
        view.accessibilityIdentifier = "action.system-broadcast-picker"
        return view
    }
    func updateUIView(_ view: RPSystemBroadcastPickerView, context: Context) {}
}
