import SwiftUI

@main
struct JianweiApp: App {
    @State private var model: AppModel?
    @State private var canRecoverCorruptStorage = false
    @State private var recoveryMessage: String?

    init() {
        do {
            let environment = try AppEnvironment.live()
            BackgroundDiscoveryController.register(environment: environment)
            _model = State(initialValue: AppModel(environment: environment))
        } catch {
            _model = State(initialValue: nil)
            _canRecoverCorruptStorage = State(
                initialValue: (error as? CocoaError)?.code == .fileReadCorruptFile
            )
        }
    }

    var body: some Scene {
        WindowGroup {
            if let model {
                RootView()
                    .environment(model)
                    .task { await model.start() }
                    .onOpenURL { model.open(url: $0) }
            } else {
                InitializationFailureView(
                    canRecoverCorruptStorage: canRecoverCorruptStorage,
                    recoveryMessage: recoveryMessage,
                    retry: bootstrap,
                    archiveAndRestart: archiveCorruptStorageAndBootstrap
                )
            }
        }
    }

    @MainActor
    private func bootstrap() {
        do {
            let environment = try AppEnvironment.live()
            BackgroundDiscoveryController.register(environment: environment)
            model = AppModel(environment: environment)
            canRecoverCorruptStorage = false
            recoveryMessage = nil
        } catch {
            canRecoverCorruptStorage = (error as? CocoaError)?.code == .fileReadCorruptFile
            recoveryMessage = "仍无法安全读取本机数据，请确认 iPhone 储存空间后再试。"
        }
    }

    @MainActor
    private func archiveCorruptStorageAndBootstrap() {
        do {
            _ = try LocalRepository.quarantineStore(at: LocalRepository.defaultRootURL())
            recoveryMessage = "损坏的数据已保留在本机恢复归档中，见微将建立新的本机索引。"
            bootstrap()
        } catch {
            recoveryMessage = "无法安全归档旧数据，因此没有删除或覆盖任何内容。"
        }
    }
}

private struct InitializationFailureView: View {
    let canRecoverCorruptStorage: Bool
    let recoveryMessage: String?
    let retry: () -> Void
    let archiveAndRestart: () -> Void

    var body: some View {
        ZStack {
            JianweiBrand.paper.ignoresSafeArea()
            VStack(spacing: 18) {
                JianweiMark(size: 54)
                Text("见微暂时无法启动")
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(JianweiBrand.ink)
                Text(canRecoverCorruptStorage
                    ? "本机索引与备份都无法安全读取。见微没有覆盖原数据。"
                    : "启动所需的本机资源暂时不可用，请稍后重试。")
                    .font(.body)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
                if let recoveryMessage {
                    Text(recoveryMessage)
                        .font(.footnote)
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.secondary)
                }
                Button("重新尝试", action: retry)
                    .buttonStyle(.borderedProminent)
                    .tint(JianweiBrand.forest)
                if canRecoverCorruptStorage {
                    Button("保留旧数据归档并重新开始", action: archiveAndRestart)
                        .buttonStyle(.bordered)
                }
            }
            .padding(28)
        }
    }
}
