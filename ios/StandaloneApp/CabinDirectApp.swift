import SwiftUI
import ReplayKit
import UIKit
import TeslaBLE

@main
struct CabinDirectApp: App {
    var body: some Scene { WindowGroup { DirectSetupView() } }
}

@MainActor
final class DirectSetupModel: ObservableObject {
    @Published var settings = DirectSettings()
    @Published var session: DirectBroadcastSession?
    @Published var status: DirectRuntimeStatus?
    @Published var message = "先连接自己的热点或同一 Wi-Fi，保存设置，然后启动系统广播。"
    @Published var saved = false
    @Published var keyAvailable = false
    @Published var enrollmentStatus = "未操作车辆；实车配对须停车并由车主确认。"
    private(set) var preparedSettings: DirectSettings?
    private var enrollmentClient: NativeTeslaMediaClient?

    init() {
        if let stored = try? DirectSessionStore.settings() { settings = stored; preparedSettings = stored; saved = true }
        refresh()
    }

    var active: Bool { status?.isCurrent == true }
    var pairRemaining: Int {
        guard let session, active, status?.sessionID == session.id else { return 0 }
        return max(0, Int(ceil(session.createdAt + 120 - Date().timeIntervalSince1970)))
    }

    func refresh() {
        status = DirectSessionStore.status()
        session = DirectSessionStore.session()
        if let status, status.isCurrent { message = status.message }
        else if status != nil { message = "广播未运行或心跳已过期；不能把旧链接当作在线。" }
        checkKey()
    }

    private func keyStore() -> TeslaKeyStore {
        TeslaKeyStore(accessGroup: Bundle.main.object(forInfoDictionaryKey: "TCKeychainAccessGroup") as? String,
                      tag: "media-monitor." + settings.vin.trimmingCharacters(in: .whitespacesAndNewlines).uppercased())
    }

    private func checkKey() {
        guard DirectSettings.validVIN(settings.vin.uppercased()) else { keyAvailable = false; return }
        do { keyAvailable = try keyStore().hasKey() }
        catch { keyAvailable = false; enrollmentStatus = "钥匙串不可读，请检查签名权限；不会重新生成钥匙替代。" }
    }

    func save() {
        guard !active else { return }
        do {
            let clean = try settings.validated()
            if clean.lyricMode == .teslaMedia, try !keyStore().hasKey() {
                throw DemoError.message("还没有本机媒体读取钥匙；可先选择可见歌词模式。")
            }
            try DirectSessionStore.saveSettings(clean)
            preparedSettings = clean; settings = clean; saved = true
            message = "设置已保存。点下方系统广播按钮，在系统面板选择 Cabin Direct 并开始广播。"
        } catch { saved = false; message = error.localizedDescription }
    }

    func enrollAfterOwnerConfirmation() {
        guard !active, DirectSettings.validVIN(settings.vin.uppercased()) else { return }
        enrollmentClient?.stop()
        let client = NativeTeslaMediaClient(vin: settings.vin.uppercased(), keyStore: keyStore(), timeUnit: .seconds,
            allowEnrollment: true,
            onStatus: { [weak self] value in Task { @MainActor in self?.enrollmentStatus = value; self?.checkKey() } },
            onMedia: { _ in })
        enrollmentClient = client
        client.enrollMonitorKeyExplicitly()
    }

    func stopEnrollment() { enrollmentClient?.stop(); enrollmentClient = nil }
}

struct DirectSetupView: View {
    @StateObject private var model = DirectSetupModel()
    @State private var confirmEnrollment = false
    private let timer = Timer.publish(every: 2, on: .main, in: .common).autoconnect()

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Label("Cabin Direct · iPhone 独立运行版", systemImage: "iphone.radiowaves.left.and.right")
                        .font(.headline)
                    Text("运行时无需 Mac、服务器或付费 API。当前为开发验证版，尚未完成 iPhone 安装与 Tesla 实车验收。")
                    Text("只在停车状态操作。系统录屏会共享屏幕上的消息和通知；建议开启专注模式。")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Section("1 · 选择歌词来源") {
                    Picker("歌词模式", selection: $model.settings.lyricMode) {
                        ForEach(DirectLyricMode.allCases) { mode in Text(mode.title).tag(mode) }
                    }
                    Text("最广泛的兼容路径：在音乐 App 打开歌词页并保持亮屏，车机显示相同画面。文字识别只读已显示的文字，不是读取所有 App 的后台歌曲，也不能精确识别高亮歌词。")
                        .font(.caption).foregroundStyle(.secondary)
                    if model.settings.lyricMode == .visibleText {
                        Text("默认识别屏幕中央偏下区域；横竖屏均按当前显示方向计算。可按音乐 App 布局调整。")
                            .font(.caption)
                        regionSlider("左侧", value: $model.settings.regionX, maximum: max(0, 1 - model.settings.regionWidth))
                        regionSlider("顶部", value: $model.settings.regionY, maximum: max(0, 1 - model.settings.regionHeight))
                        regionSlider("宽度", value: $model.settings.regionWidth, minimum: 0.05, maximum: 1 - model.settings.regionX)
                        regionSlider("高度", value: $model.settings.regionHeight, minimum: 0.05, maximum: 1 - model.settings.regionY)
                    }
                    if model.settings.lyricMode == .teslaMedia {
                        TextField("车辆 VIN（17 位）", text: $model.settings.vin)
                            .textInputAutocapitalization(.characters).autocorrectionDisabled()
                        Picker("媒体时间单位（需实车核实）", selection: $model.settings.mediaTimeUnit) {
                            Text("尚未确认").tag("unconfirmed")
                            Text("毫秒").tag("milliseconds")
                            Text("秒").tag("seconds")
                        }
                        Toggle("允许按曲名与歌手查询 LRCLIB", isOn: $model.settings.onlineLyrics)
                        Text("默认不开启外部歌词查询。启用后只把车辆给出的曲名、歌手与时长发送至 lrclib.net；不发 VIN、屏幕或钥匙。未匹配到歌词就留空，不抓取音乐平台账号。")
                            .font(.caption).foregroundStyle(.secondary)
                        Text(model.keyAvailable ? "本机已有钥匙材料；不代表车辆已经认可。" : "本机没有可读取的媒体钥匙。")
                        Button("车主明确授权：添加只读监控钥匙") { confirmEnrollment = true }
                            .disabled(!DirectSettings.validVIN(model.settings.vin.uppercased()))
                        Button("停止蓝牙配对尝试") { model.stopEnrollment() }
                        Text(model.enrollmentStatus).font(.caption)
                    }
                }.disabled(model.active)
                Section("2 · 保存并启动") {
                    Button("保存设置") { model.save() }.disabled(model.active)
                    if model.saved {
                        DirectBroadcastPicker().frame(height: 54)
                            .accessibilityLabel("打开 Cabin Direct 系统广播面板")
                    }
                    Text(model.message)
                    Text("开始后切回本 App 查看当次地址与配对码，再打开音乐 App 歌词页。停止请用 iPhone 的系统录屏指示器；主 App 退到后台不会替代扩展运行。")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Section("3 · Tesla 浏览器连接") {
                    if let status = model.status, status.isCurrent {
                        if status.addresses.isEmpty {
                            Text("尚未找到可用的局域网 IPv4。请连接自己的热点/Wi-Fi；不猜测网关地址。")
                        }
                        ForEach(status.addresses, id: \.self) { address in
                            Text("http://\(address):\(status.port)").font(.system(.body, design: .monospaced)).textSelection(.enabled)
                        }
                        if model.pairRemaining > 0, let session = model.session, session.id == status.sessionID {
                            Text(session.pairingCode).font(.system(size: 34, weight: .bold, design: .monospaced))
                            Text("配对码剩余 \(model.pairRemaining) 秒；最多 5 次错误输入。已配对浏览器不必重复输入。")
                        } else {
                            Text("初始配对窗口已结束。已配对的浏览器仍可使用；如需新浏览器，请停止系统广播后重启。")
                        }
                        Text("已编码画面：\(status.frames)。这不是实车已连接的证明。")
                            .font(.caption)
                    } else { Text("等待系统广播启动。没有广播时不显示旧配对码或旧在线状态。") }
                    Text("车机与手机必须实际可达。热点支持不等于 Tesla 固件一定允许本地 HTTP/MJPEG；之后需要停车实测。HTTP 未加密，只在自己控制的网络使用。")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Section("兼容与限制") {
                    Text("Apple Music / Spotify / QQ 音乐 / 网易云 / YouTube Music / TIDAL / Deezer / Amazon Music：先验证各自可见歌词页，均未标记为实车通过。")
                    Text("普通未受保护画面可尝试投屏；Netflix 等受 DRM 保护内容不支持，不绕过黑屏或录屏限制。")
                    Text("录屏中断、暂停或画面过期会清空接收端旧画面。手机锁屏、发热、系统内存终止都可能中断广播，不承诺锁屏持续运行。")
                    Text("免费 Personal Team 签名通常 7 天需重签。本版无运行时 Mac 依赖，不等于可永久免重签安装。")
                }.font(.caption).foregroundStyle(.secondary)
                Section("第三方许可") {
                    NavigationLink("Tesla 协议移植 · Apache-2.0") { DirectNoticeView(resource: "LICENSE-TESLA") }
                    NavigationLink("协议来源与改动说明") { DirectNoticeView(resource: "PROVENANCE.md") }
                }
            }.navigationTitle("Cabin Direct")
                .onReceive(timer) { _ in model.refresh() }
                .onChange(of: model.settings) { _ in
                    if !model.active, model.settings != model.preparedSettings { model.saved = false }
                }
                .confirmationDialog("只有车主在车旁停车时才能继续", isPresented: $confirmEnrollment, titleVisibility: .visible) {
                    Button("我确认：申请 Vehicle Monitor 只读钥匙") { model.enrollAfterOwnerConfirmation() }
                } message: {
                    Text("会生成并保存在本机钥匙串的密钥，并通过蓝牙向车辆申请监控角色，需要实体卡片/NFC 确认。此角色可读取的车辆数据范围比媒体更广，但本实现仅发送两种媒体读取请求；不申请驾驶/车主权限。")
                }
        }
    }

    private func regionSlider(_ title: String, value: Binding<Double>, minimum: Double = 0, maximum: Double) -> some View {
        VStack(alignment: .leading) {
            Text("\(title)：\(Int(value.wrappedValue * 100))%")
            Slider(value: value, in: minimum...max(minimum + 0.001, maximum))
        }
    }
}

struct DirectNoticeView: View {
    let resource: String
    private var content: String {
        guard let url = Bundle.main.url(forResource: resource, withExtension: nil),
              let value = try? String(contentsOf: url, encoding: .utf8) else { return "许可资源缺失，请勿分发此构建。" }
        return value
    }
    var body: some View {
        ScrollView { Text(content).font(.system(.caption, design: .monospaced)).textSelection(.enabled).padding() }
            .navigationTitle("第三方说明")
    }
}

struct DirectBroadcastPicker: UIViewRepresentable {
    func makeUIView(context: Context) -> RPSystemBroadcastPickerView {
        let view = RPSystemBroadcastPickerView(frame: .zero)
        view.preferredExtension = Bundle.main.object(forInfoDictionaryKey: "TCBroadcastExtensionIdentifier") as? String
        view.showsMicrophoneButton = false
        return view
    }
    func updateUIView(_ view: RPSystemBroadcastPickerView, context: Context) {}
}
