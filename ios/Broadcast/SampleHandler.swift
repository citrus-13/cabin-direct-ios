import ReplayKit

final class SampleHandler: RPBroadcastSampleHandler {
    private var publisher: ScreenPublisher?

    override func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {
        do {
            let configuration = try SharedSession.load()
            guard !configuration.isExpired else { throw DemoError.message("配对会话已过期。请回主 App 创建新会话。") }
            let publisher = ScreenPublisher(configuration: configuration) { [weak self] message in
                SharedSession.setStatus(message, active: false)
                self?.finishBroadcastWithError(DemoError.message(message))
            }
            self.publisher = publisher
            publisher.start()
        } catch {
            SharedSession.setStatus("无法读取配对会话。请先打开主 App 完成配对。", active: false)
            finishBroadcastWithError(error)
        }
    }

    override func processSampleBuffer(_ sampleBuffer: CMSampleBuffer, with sampleBufferType: RPSampleBufferType) {
        guard sampleBufferType == .video else { return }
        publisher?.append(sampleBuffer)
    }

    override func broadcastPaused() { publisher?.setPaused(true) }
    override func broadcastResumed() { publisher?.setPaused(false) }
    override func broadcastFinished() {
        publisher?.stop()
        publisher = nil
        SharedSession.setStatus("广播已停止。", active: false)
    }
}
