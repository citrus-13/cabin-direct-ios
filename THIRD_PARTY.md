# 第三方组件与资料

- `ws` 8.22.0：Node.js WebSocket 实现，MIT，https://github.com/websockets/ws 。安装时随包保留 LICENSE，完整依赖锁定于 package-lock.json。
- `stasel/WebRTC` 156.0.0：iOS WebRTC 预编译包，BSD 3-Clause，https://github.com/stasel/WebRTC/releases/tag/156.0.0 。原许可文本随 iOS 工程保存在 `ios/App/ThirdPartyNotices.txt`。
- Apple ReplayKit / CoreMedia / CoreImage / SwiftUI：平台 SDK，使用对应 Apple SDK 与开发者条款。源码使用公开 API，不包含 Apple SDK 二进制。

本项目网页、服务端、测试、歌词样例和 Swift 集成源码为本次任务编写。没有复制 `tesycast`、`teslanav` 等未明确许可仓库的代码。界面不使用外部字体、分析脚本或远程图片。

- LRCLIB：可选、按需访问 `https://lrclib.net/api/get` 和 `/search`，遵守客户端标识、返回的 `Retry-After` 和有界缓存规则。没有复制其源码或把商业歌曲歌词加入仓库。API 文档：https://lrclib.net/docs.md 。可访问 API 不代表取得全部歌词再分发权。
- Tesla 官方 `vehicle-command`：旧 CLI 适配器只调用外部 `state media` / `state media-detail`，不捆绑其可执行文件。新的 `ios/TeslaBLE` 是基于官方协议/源码的有限 Swift 移植，固定 commit `0a582da430c4aca6d397fb6cbed5b4d6bb380125`，保留完整 Apache-2.0 许可证、改动说明、公开向量来源和 schema 指纹：[PROVENANCE](ios/TeslaBLE/PROVENANCE.md)、[LICENSE-TESLA](ios/TeslaBLE/LICENSE-TESLA)。没有完整上游文件或生成的绑定；测试标量是公开夹具，不是生产凭据。两条路径均不申请 Fleet 权限。
- 独立版额外使用 Apple Network、Vision、ImageIO、CoreBluetooth、CryptoKit 和 Security 平台 SDK；不分发 SDK 二进制，无额外下载的第三方 Swift 包。
- TesLyr / TesDisplay：仅为公开行为研究对象。没有验证可复用开源许可证，没有将它们的源码、图像、字体、品牌、第三方应用密钥或后台服务放入本项目。其公开资源的研究副本及 REA 输出保存在项目之外。
- REA 6.7.0：本次静态研究工具，从官方 `morluto/rea` 对应 npm `rea-agents` 临时运行；不是 Cabin 的生产依赖，没有安装原生收费引擎或修改全局 MCP 配置。

开源程序的许可证不意味着任何第三方歌曲或歌词都可以自由再分发。

## 0.8.0 运行时范围

TeslaBLE 不再仅是保留的研究源码：0.8.0 开发目标在 CabinDirect 主应用中集成其有限协议实现，用于用户单独确认的 Monitor 配对与经过认证的媒体读取。车辆授予的 Monitor 只读权限比媒体更广；应用的读取白名单仅包含媒体信息。它不进入 ReplayKit 扩展，不使用 Tesla 云端、OAuth 或收费 API，不共享车辆密钥。主应用通过默认钥匙串（`accessGroup: nil`）保存密钥。

分发包含这一改编实现的源码或二进制时，应保留上述 Tesla 来源、改动说明、完整 Apache-2.0 许可及 NOTICE。许可和公开协议不证明真实车辆授权、固件兼容、Tesla 背书或 App Store 审核通过。旧 Node/WebRTC 路径仍是独立工具，不能与当前主应用依赖范围混同。
