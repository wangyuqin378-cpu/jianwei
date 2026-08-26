import BackgroundTasks
import Foundation
import Observation
import UIKit
import WidgetKit

enum AppSection: Hashable {
    case today
    case saved
    case settings
}

enum AnalysisStage: Equatable {
    case idle
    case preparing
    case filtering
    case understanding
    case ready

    var title: String {
        switch self {
        case .idle: ""
        case .preparing: "准备照片"
        case .filtering: "在 iPhone 上做隐私筛选"
        case .understanding: "识别物件并匹配可靠知识"
        case .ready: "知识卡准备好了"
        }
    }
}

@MainActor
@Observable
final class AppModel {
    private(set) var state = PersistedAppState.empty
    private(set) var photoAccess: PhotoAccessState = .notDetermined
    private(set) var isReady = false
    private(set) var isWorking = false
    private(set) var analysisStage: AnalysisStage = .idle
    private(set) var message: String?
    private(set) var shouldPresentPhotoPicker = false
    private(set) var activeCardID: UUID?
    private(set) var imageCache: [UUID: Data] = [:]
    private(set) var hasQwenAPIKey = false
    private(set) var managedSubscriptionState: ManagedSubscriptionState = .loading
    private(set) var managedSubscriptionPrice: String?
    var selectedSection: AppSection = .today
    var presentedCardID: UUID?

    @ObservationIgnored private let environment: AppEnvironment

    init(environment: AppEnvironment) {
        self.environment = environment
    }

    var serviceConfigured: Bool { environment.serviceConfigured }
    var automaticDiscoveryEnabled: Bool { state.automaticDiscoveryEnabled }
    var preparationMode: AutomaticPreparationMode { state.preparationMode }
    var interests: Set<KnowledgeInterest> { state.interests }
    var modelAccessMode: ModelAccessMode { state.modelAccessMode }
    var savedCards: [KnowledgeCard] {
        state.cards.filter { state.savedCardIDs.contains($0.id) }
    }
    var currentCard: KnowledgeCard? {
        if let activeCardID, let card = state.cards.first(where: { $0.id == activeCardID }) {
            return card
        }
        let today = ChinaDay.string(from: Date())
        return state.cards.first(where: { $0.scheduledDay == today }) ?? state.cards.first
    }
    var failedCandidate: PhotoCandidateRecord? {
        state.candidates.first(where: { $0.state == .failed })
    }
    var remainingSwaps: Int {
        guard let store = try? SharedWidgetStore(),
              let widgetState = try? store.load() else { return SharedConstants.maximumDailySwaps }
        let used = widgetState.swapCounts[ChinaDay.string(from: Date()), default: 0]
        return max(0, SharedConstants.maximumDailySwaps - used)
    }

    func start() async {
        photoAccess = await environment.discovery.authorizationState()
        #if DEBUG
        let launchArguments = ProcessInfo.processInfo.arguments
        if launchArguments.contains("-JianweiResetOnboarding") {
            try? SharedWidgetStore().clear()
            try? await environment.repository.deleteLocalData()
            try? await environment.modelAccessStore.removeQwenAPIKey()
        }
        if launchArguments.contains("-JianweiSeedDemo") {
            try? await installDemoState()
        }
        #endif
        await reloadFromDisk()
        await refreshModelAccessStatus()
        #if DEBUG
        if launchArguments.contains("-JianweiStorefrontPreview") {
            managedSubscriptionState = .notSubscribed
            managedSubscriptionPrice = "¥8.00"
        } else {
            await refreshManagedSubscription()
        }
        #else
        await refreshManagedSubscription()
        #endif
        await flushPendingFeedback()
        if state.automaticDiscoveryEnabled {
            try? BackgroundDiscoveryController.schedule()
        }
        isReady = true
    }

    func finishOnboarding(
        automatic: Bool,
        interests: Set<KnowledgeInterest>,
        preparationMode: AutomaticPreparationMode
    ) async {
        guard interests.count >= 3 else {
            message = "请先选 3 个你感兴趣的方向。"
            return
        }
        do {
            try await environment.repository.setPreferences(
                interests: interests,
                preparationMode: preparationMode
            )
            try await environment.repository.setOnboardingCompleted(true)
            if automatic {
                await enableAutomaticDiscovery()
            } else {
                try await environment.repository.setAutomaticDiscovery(false)
                await reloadFromDisk()
                shouldPresentPhotoPicker = true
            }
        } catch {
            message = "保存设置失败，请再试一次。"
        }
    }

    func consumePhotoPickerRequest() {
        shouldPresentPhotoPicker = false
    }

    func enableAutomaticDiscovery() async {
        let access = await environment.discovery.requestAccess()
        photoAccess = access
        guard access == .full || access == .limited else {
            try? await environment.repository.setAutomaticDiscovery(false)
            await reloadFromDisk()
            message = "没有开放相册访问。你仍然可以只选择想理解的照片。"
            return
        }
        try? await environment.repository.setAutomaticDiscovery(true)
        try? BackgroundDiscoveryController.schedule()
        await runAutomaticDiscovery()
    }

    func disableAutomaticDiscovery() async {
        try? await environment.repository.setAutomaticDiscovery(false)
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: SharedConstants.discoveryTaskIdentifier)
        await reloadFromDisk()
        message = "自动发现已暂停，已选照片仍保留在本机。"
    }

    func runAutomaticDiscovery() async {
        guard serviceConfigured else {
            message = "服务地址尚未配置，照片不会离开设备。"
            return
        }
        guard !isWorking else { return }
        let today = ChinaDay.string(from: Date())
        guard state.lastDailySelectionDay != today else {
            message = "今天的三张候选已经分析过了，明天会从未选过的照片继续。"
            return
        }
        isWorking = true
        analysisStage = .filtering
        message = nil
        let maximum = 3
        let summary = await AutomaticDiscoveryRunner(environment: environment)
            .run(maximumCandidates: maximum)
        await reloadFromDisk()
        isWorking = false
        analysisStage = summary.cardsCreated > 0 ? .ready : .idle
        if let accessError = summary.accessError {
            message = accessError.errorDescription
        } else if summary.cardsCreated > 0 {
            message = "今天从三张候选里准备了 \(summary.cardsCreated) 个知识点，正在选择最有趣的一条。"
        } else if summary.failed > 0 {
            message = "网络暂时不可用，候选照片已加密保留在本机，可稍后重试。"
        } else if summary.inspected > 0 {
            message = "这批照片没有可靠命中；见微没有为了出卡而猜测。"
        } else {
            message = "暂时没有新的合适照片。"
        }
    }

    func importPhoto(data: Data) async {
        guard let pipeline = environment.pipeline else {
            message = "服务地址尚未配置，照片不会离开设备。"
            return
        }
        guard !isWorking else { return }
        isWorking = true
        analysisStage = .preparing
        message = nil
        do {
            analysisStage = .filtering
            let snapshot = await environment.repository.snapshot()
            let hashes = Set(snapshot.candidates.compactMap(\.perceptualHash))
            analysisStage = .understanding
            let result = try await pipeline.analyze(
                sourceData: data,
                localIdentifier: nil,
                capturedAt: Date(),
                existingHashes: hashes
            )
            try await persist(result)
            await reloadFromDisk()
            analysisStage = result.card == nil ? .idle : .ready
            message = result.card == nil
                ? ProductError.noReliableKnowledge.errorDescription
                : "知识卡已经加入今天的桌面卡池。"
        } catch let rejection as PipelineRejection {
            try? await environment.repository.upsert(candidate: rejection.candidate)
            analysisStage = .idle
            message = rejection.errorDescription
        } catch let failure as PipelineFailure {
            try? await persist(failure)
            analysisStage = .idle
            message = "网络暂时不可用，已在本机保留这张脱敏候选，稍后可重试。"
        } catch {
            analysisStage = .idle
            message = (error as? LocalizedError)?.errorDescription ?? "暂时无法理解这张照片。"
        }
        isWorking = false
    }

    func retryFailedUpload() async {
        guard let candidate = failedCandidate,
              let pipeline = environment.pipeline,
              let jpeg = await environment.repository.imageData(candidateToken: candidate.id),
              !isWorking else { return }
        isWorking = true
        analysisStage = .understanding
        do {
            let result = try await pipeline.retry(candidate: candidate, sanitizedJPEG: jpeg)
            try await persist(result)
            await reloadFromDisk()
            analysisStage = result.card == nil ? .idle : .ready
            message = result.card == nil
                ? ProductError.noReliableKnowledge.errorDescription
                : "重试成功，知识卡已经准备好。"
        } catch let failure as PipelineFailure {
            try? await persist(failure)
            analysisStage = .idle
            message = failure.errorDescription
        } catch {
            analysisStage = .idle
            message = "重试失败，候选仍安全保留在本机。"
        }
        isWorking = false
    }

    func synchronizeCards(showFailure: Bool = false) async {
        guard let api = environment.api, let identity = environment.identity else { return }
        do {
            let credentials = try await identity.credentials()
            let cards = try await api.cards(bearer: credentials.token)
            try await environment.repository.replaceRemoteCards(cards)
            await reloadFromDisk()
        } catch {
            if showFailure {
                message = "暂时无法同步，桌面会继续使用本机缓存。"
            }
        }
    }

    func toggleSaved(_ card: KnowledgeCard) async {
        let saved = !state.savedCardIDs.contains(card.id)
        try? await environment.repository.setSaved(saved, cardID: card.id)
        if saved { await submitFeedback(card: card, action: .save, hideLocally: false) }
        await reloadFromDisk()
    }

    func submitFeedback(
        card: KnowledgeCard,
        action: FeedbackAction,
        hideLocally: Bool? = nil
    ) async {
        let shouldHide = hideLocally ?? (action == .wrongObject || action == .tooPrivate)
        let pending = try? await environment.repository.recordFeedback(cardID: card.id, action: action)
        if shouldHide {
            try? await environment.repository.hideCard(
                card.id,
                candidateToken: card.candidateToken,
                neverAnalyze: action == .tooPrivate
            )
        }
        await reloadFromDisk()
        guard let pending else { return }
        do {
            try await send(pending)
            try await environment.repository.confirmFeedback(pending.id)
            await reloadFromDisk()
            message = feedbackConfirmation(action)
        } catch {
            message = shouldHide
                ? "已先在本机处理；联网后会同步这次反馈。"
                : "反馈已保存在本机，联网后自动同步。"
        }
    }

    func showNextCard() async {
        guard remainingSwaps > 0, let store = try? SharedWidgetStore() else { return }
        let changed = (try? store.advance(on: ChinaDay.string(from: Date()))) == true
        if changed {
            WidgetCenter.shared.reloadTimelines(ofKind: SharedConstants.widgetKind)
            await reloadWidgetSelection()
        }
    }

    func open(url: URL) {
        guard url.scheme == "jianwei", url.host == "card",
              let id = UUID(uuidString: url.lastPathComponent),
              state.cards.contains(where: { $0.id == id }) else { return }
        selectedSection = .today
        presentedCardID = id
    }

    func clearMessage() { message = nil }

    func deleteLocalData() async {
        do {
            try await environment.repository.deleteLocalData()
            try? SharedWidgetStore().clear()
            WidgetCenter.shared.reloadAllTimelines()
            await reloadFromDisk()
            message = "本机索引、卡片和脱敏缩略图已清除。"
        } catch {
            message = "清除失败，请重启后再试。"
        }
    }

    func deleteCloudAndLocalData() async {
        guard let api = environment.api, let identity = environment.identity else {
            message = "云端服务尚未配置；你仍可以先清除本机数据。"
            return
        }
        isWorking = true
        defer { isWorking = false }
        do {
            let credentials = try await identity.credentials()
            try await api.deleteDeviceData(
                bearer: credentials.token,
                expectedDeviceID: credentials.deviceID
            )
            try await identity.invalidateServerCredential()
            try await environment.repository.deleteLocalData()
            try? SharedWidgetStore().clear()
            WidgetCenter.shared.reloadAllTimelines()
            await reloadFromDisk()
            message = "云端设备数据与本机索引都已删除。"
        } catch {
            message = "云端尚未确认删除，本机身份仍保留以便重试。"
        }
    }

    func updatePreferences(
        interests: Set<KnowledgeInterest>,
        preparationMode: AutomaticPreparationMode
    ) async {
        guard interests.count >= 3 else {
            message = "至少保留 3 个兴趣方向。"
            return
        }
        try? await environment.repository.setPreferences(
            interests: interests,
            preparationMode: preparationMode
        )
        await reloadFromDisk()
    }

    func useManagedModelService() async {
        guard managedSubscriptionState == .subscribed else {
            message = "请先订阅见微 Pro，或改用自己的 Qwen API Key。"
            return
        }
        do {
            try await environment.repository.setModelAccessMode(.managed)
            await reloadFromDisk()
            message = "已切换到见微托管服务。正式使用需要有效订阅。"
        } catch {
            message = "暂时无法保存 AI 服务设置。"
        }
    }

    func purchaseManagedModelService() async {
        guard !isWorking else { return }
        isWorking = true
        defer { isWorking = false }
        do {
            let installationID = try DeviceIdentityStore.installationIDForSubscription()
            try await environment.subscriptionStore.purchase(appAccountToken: installationID)
            await refreshManagedSubscription()
            guard managedSubscriptionState == .subscribed else { return }
            try await environment.repository.setModelAccessMode(.managed)
            await reloadFromDisk()
            message = "见微 Pro 已开通：每天 3 张候选，发布 1 条知识。"
        } catch let error as ProductError {
            message = error.errorDescription
        } catch {
            message = "暂时无法完成购买，请稍后再试。"
        }
    }

    func restoreManagedSubscription() async {
        guard !isWorking else { return }
        isWorking = true
        message = "正在恢复 App Store 购买记录…"
        defer { isWorking = false }
        do {
            try await environment.subscriptionStore.restore()
            await refreshManagedSubscription()
            message = managedSubscriptionState == .subscribed
                ? "已恢复见微 Pro 订阅。"
                : "没有找到当前有效的见微 Pro 订阅。"
        } catch {
            message = "暂时无法恢复购买，请稍后再试。"
        }
    }

    func saveAndUseQwenAPIKey(_ value: String) async {
        do {
            try await environment.modelAccessStore.saveQwenAPIKey(value)
            try await environment.repository.setModelAccessMode(.qwenUserKey)
            await refreshModelAccessStatus()
            await reloadFromDisk()
            message = "Qwen API Key 已安全保存在这台 iPhone，并已切换为自带 Key。"
        } catch let error as ProductError {
            message = error.errorDescription
        } catch {
            message = "暂时无法保存 Qwen API Key。"
        }
    }

    func removeQwenAPIKey() async {
        do {
            try await environment.modelAccessStore.removeQwenAPIKey()
            try await environment.repository.setModelAccessMode(.managed)
            await refreshModelAccessStatus()
            await reloadFromDisk()
            message = "Qwen API Key 已从这台 iPhone 删除。"
        } catch {
            message = "暂时无法删除 Qwen API Key。"
        }
    }

    func imageData(for card: KnowledgeCard) -> Data? {
        imageCache[card.candidateToken]
    }

    private func persist(_ result: AnalysisPipelineResult) async throws {
        try await environment.repository.upsert(candidate: result.candidate)
        if let card = result.card {
            try await environment.repository.upsert(card: card, sanitizedJPEG: result.sanitizedJPEG)
        } else {
            await environment.repository.removeImage(candidateToken: result.candidate.id)
        }
    }

    private func persist(_ failure: PipelineFailure) async throws {
        try await environment.repository.upsert(candidate: failure.candidate)
        try await environment.repository.storeImage(
            failure.sanitizedJPEG,
            candidateToken: failure.candidate.id
        )
    }

    private func reloadFromDisk() async {
        state = await environment.repository.snapshot()
        var images: [UUID: Data] = [:]
        for card in state.cards {
            if let data = await environment.repository.imageData(candidateToken: card.candidateToken) {
                images[card.candidateToken] = data
            }
        }
        imageCache = images
        try? await environment.widgetCoordinator.synchronize(cards: state.cards)
        await reloadWidgetSelection()
    }

    private func refreshModelAccessStatus() async {
        hasQwenAPIKey = (try? await environment.modelAccessStore.hasQwenAPIKey()) == true
    }

    private func refreshManagedSubscription() async {
        await environment.subscriptionStore.refresh()
        managedSubscriptionState = environment.subscriptionStore.state
        managedSubscriptionPrice = environment.subscriptionStore.displayPrice
    }

    private func reloadWidgetSelection() async {
        guard let store = try? SharedWidgetStore(),
              let widgetState = try? store.load() else {
            activeCardID = currentCard?.id
            return
        }
        activeCardID = widgetState.card(for: ChinaDay.string(from: Date()))?.id
    }

    private func flushPendingFeedback() async {
        let pending = state.pendingFeedback
        for item in pending {
            do {
                try await send(item)
                try await environment.repository.confirmFeedback(item.id)
            } catch {
                break
            }
        }
        state = await environment.repository.snapshot()
    }

    private func send(_ pending: PendingFeedback) async throws {
        guard let api = environment.api, let identity = environment.identity else {
            throw ProductError.apiNotConfigured
        }
        let credentials = try await identity.credentials()
        try await api.feedback(
            bearer: credentials.token,
            cardID: pending.cardID,
            action: pending.action
        )
    }

    private func feedbackConfirmation(_ action: FeedbackAction) -> String {
        switch action {
        case .like: "记住了，会多找一些相近的知识。"
        case .dislike: "记住了，会减少这类内容。"
        case .wrongObject: "已移除这张卡，并记录了识别错误。"
        case .tooPrivate: "已从本机卡片与缩略图中移除。"
        case .save: "已收藏。"
        }
    }

    #if DEBUG
    private func installDemoState() async throws {
        try? SharedWidgetStore().clear()
        try await environment.repository.deleteLocalData()
        try await environment.repository.setOnboardingCompleted(true)
        try await environment.repository.setAutomaticDiscovery(false)
        let cards = Self.demoCards()
        for (card, image) in cards {
            try await environment.repository.upsert(card: card, sanitizedJPEG: image)
        }
    }

    private static func demoCards() -> [(KnowledgeCard, Data)] {
        let source = KnowledgeSource(
            id: "src-broom",
            title: "US4756039A: angled-cut bristle broom",
            url: URL(string: "https://patents.google.com/patent/US4756039A/en")!,
            publisher: "Google Patents",
            authority: "reference"
        )
        let facts = [
            (
                "扫帚为什么总有一点斜？",
                "现代扫帚常把刷毛设计成略带角度的扇形，让边缘更容易贴近墙角和家具边缘。",
                "在你最近拍下的清洁工具里，扫帚的形状很适合今天聊聊。",
                "broom-001"
            ),
            (
                "一把扫帚，也在照顾你的手腕",
                "斜切毛端能让整条扫面更均匀地贴地，减少反复调整手柄角度的动作。",
                "来自同一张日常照片的另一个设计细节。",
                "broom-draft-002"
            ),
            (
                "软毛与硬毛，其实各有分工",
                "有些扫帚会让大部分软毛清理普通地面，再用边缘硬毛处理墙角和顽固污物。",
                "因为你偏好生活设计与制造工艺。",
                "broom-draft-003"
            )
        ]
        let start = ChinaDay.start(of: Date())
        return facts.enumerated().map { index, fact in
            let card = KnowledgeCard(
                id: UUID(uuidString: String(format: "10000000-0000-0000-0000-%012d", index + 1))!,
                candidateToken: UUID(uuidString: String(format: "20000000-0000-0000-0000-%012d", index + 1))!,
                topicID: "broom",
                factID: fact.3,
                title: fact.0,
                objectName: "扫帚",
                body: fact.1,
                personalContext: fact.2,
                confidence: 0.96,
                boundingBox: nil,
                sources: [source],
                status: "scheduled",
                scheduledDay: ChinaDay.string(from: ChinaDay.adding(days: index, to: start)),
                createdAt: Date()
            )
            return (card, demoImage(index: index))
        }
    }

    private static func demoImage(index: Int) -> Data {
        let size = CGSize(width: 900, height: 1200)
        let renderer = UIGraphicsImageRenderer(size: size)
        return renderer.jpegData(withCompressionQuality: 0.9) { context in
            let cg = context.cgContext
            let colors = [
                UIColor(red: 0.94, green: 0.90, blue: 0.82, alpha: 1).cgColor,
                UIColor(red: 0.73, green: 0.63, blue: 0.48, alpha: 1).cgColor
            ] as CFArray
            let gradient = CGGradient(
                colorsSpace: CGColorSpaceCreateDeviceRGB(),
                colors: colors,
                locations: [0, 1]
            )!
            cg.drawLinearGradient(
                gradient,
                start: CGPoint(x: 0, y: 0),
                end: CGPoint(x: size.width, y: size.height),
                options: []
            )
            cg.setFillColor(UIColor(red: 0.28, green: 0.36, blue: 0.29, alpha: 0.16).cgColor)
            cg.fillEllipse(in: CGRect(x: 110, y: 970, width: 650, height: 100))
            cg.saveGState()
            cg.translateBy(x: CGFloat(40 * index), y: 0)
            cg.setStrokeColor(UIColor(red: 0.30, green: 0.22, blue: 0.15, alpha: 1).cgColor)
            cg.setLineWidth(34)
            cg.setLineCap(.round)
            cg.move(to: CGPoint(x: 610, y: 120))
            cg.addLine(to: CGPoint(x: 390, y: 830))
            cg.strokePath()
            cg.setFillColor(UIColor(red: 0.21, green: 0.36, blue: 0.29, alpha: 1).cgColor)
            let head = UIBezierPath()
            head.move(to: CGPoint(x: 305, y: 790))
            head.addLine(to: CGPoint(x: 540, y: 855))
            head.addLine(to: CGPoint(x: 485, y: 1015))
            head.addLine(to: CGPoint(x: 215, y: 940))
            head.close()
            head.fill()
            cg.restoreGState()
        }
    }
    #endif
}
