import Foundation
#if DEBUG
import Network
#endif
import Observation
import UIKit
import WidgetKit

#if DEBUG
private enum DebugNetworkPathProbe {
    static func currentInterface() async -> String {
        let monitor = NWPathMonitor()
        monitor.start(queue: DispatchQueue(label: "cn.jianwei.debug-network-path"))
        defer { monitor.cancel() }
        try? await Task.sleep(for: .milliseconds(350))
        let path = monitor.currentPath
        guard path.status == .satisfied else { return "offline" }
        if path.usesInterfaceType(.wifi) { return "wifi" }
        if path.usesInterfaceType(.cellular) { return "cellular" }
        if path.usesInterfaceType(.wiredEthernet) { return "wired" }
        return "other"
    }
}
#endif

enum AppSection: Hashable {
    case today
    case saved
    case settings
}

enum BackgroundPreparationAvailability: Equatable {
    case available, disabled, restricted, lowPower, unknown

    init(refreshStatus: UIBackgroundRefreshStatus, lowPowerMode: Bool) {
        // Low Power Mode can report denied without the user disabling this app.
        if refreshStatus == .restricted { self = .restricted }
        else if lowPowerMode { self = .lowPower }
        else {
            switch refreshStatus {
            case .available: self = .available
            case .denied: self = .disabled
            case .restricted: self = .restricted
            @unknown default: self = .unknown
            }
        }
    }

    var needsAttention: Bool {
        switch self {
        case .disabled, .restricted, .lowPower: true
        case .available, .unknown: false
        }
    }

    var title: String {
        switch self {
        case .available: "后台补充由系统安排"
        case .disabled: "后台 App 刷新已关闭"
        case .restricted: "系统限制了后台刷新"
        case .lowPower: "低电量模式已开启"
        case .unknown: "暂时无法确认后台状态"
        }
    }

    var detail: String {
        switch self {
        case .available:
            "系统会择机补充知识卡，不保证固定时间。提前准备的卡会供小组件按日切换。"
        case .disabled:
            "请在系统设置的“通用 → 后台 App 刷新”中检查总开关和见微开关。已有卡仍可查看，打开见微可继续补充。"
        case .restricted:
            "系统不允许此 App 后台刷新，可能与设备管理或使用限制有关。已有卡仍可查看，打开见微可继续补充。"
        case .lowPower:
            "低电量模式会暂停后台 App 刷新。已有卡仍可查看，打开见微可继续补充；关闭低电量模式后再检查后台状态。"
        case .unknown:
            "尚不能确认系统是否允许后台补充。已有卡仍可查看，打开见微可继续准备。"
        }
    }
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

enum RemoteCardSyncPolicy {
    static func allows(deviceBetaExperienceEnabled: Bool, modelAccessMode: ModelAccessMode) -> Bool {
        !deviceBetaExperienceEnabled && modelAccessMode == .managed
    }
}

enum CardHistoryResolver {
    static func resolve(
        cards: [KnowledgeCard],
        presentations: [WidgetCardPresentation],
        now: Date = Date()
    ) -> [KnowledgeCard] {
        let today = ChinaDay.string(from: now)
        var seen = Set<UUID>()
        var result: [KnowledgeCard] = []
        for presentation in presentations
            .filter({ $0.hasOccurred(asOf: now) })
            .sorted(by: { $0.presentedAt > $1.presentedAt }) {
            guard seen.insert(presentation.cardID).inserted,
                  let card = cards.first(where: { $0.id == presentation.cardID }) else { continue }
            result.append(card)
        }
        for card in cards
            .filter({ $0.isPublished && !$0.scheduledDay.isEmpty && $0.scheduledDay <= today })
            .sorted(by: { lhs, rhs in
                lhs.scheduledDay == rhs.scheduledDay
                    ? lhs.createdAt > rhs.createdAt
                    : lhs.scheduledDay > rhs.scheduledDay
            }) {
            if seen.insert(card.id).inserted {
                result.append(card)
            }
        }
        return result
    }
}

enum CurrentCardResolver {
    static func resolve(
        cards: [KnowledgeCard],
        widgetState: WidgetQueueState,
        activeCardID: UUID?,
        now: Date = Date()
    ) -> KnowledgeCard? {
        let today = ChinaDay.string(from: now)
        // The day-keyed App Group selection is authoritative, including a
        // runner-up that the app-private repository has not promoted yet.
        if let selected = widgetState.card(for: today) ?? widgetState.mostRecentCard(onOrBefore: today),
           let card = cards.first(where: { $0.id == selected.id && !$0.isWithdrawn }) {
            return card
        }
        if let activeCardID,
           let card = cards.first(where: {
               $0.id == activeCardID && !$0.isWithdrawn && $0.isPublished && $0.scheduledDay == today
           }) {
            return card
        }
        return cards
            .filter { !$0.isWithdrawn && $0.isPublished && !$0.scheduledDay.isEmpty && $0.scheduledDay <= today }
            .max { lhs, rhs in
                lhs.scheduledDay == rhs.scheduledDay
                    ? lhs.createdAt < rhs.createdAt
                    : lhs.scheduledDay < rhs.scheduledDay
            }
    }
}

enum DiscoveryRunMessage {
    static func cachePreparationText(preparedFutureDayCount: Int, hasCurrentCard: Bool = false) -> String {
        // This value is the uninterrupted run from tomorrow, not all cached dates.
        let count = min(6, max(0, preparedFutureDayCount))
        if count > 0 {
            return "已备好未来 \(count) 天的知识卡，会按日期展示。"
        }
        return hasCurrentCard
            ? "暂时没有新的合格知识卡，已有卡片仍会保留。"
            : "暂时没有新的合适照片，有新照片时会继续寻找。"
    }

    static func swapLimitText(preparedFutureDayCount: Int, hasCurrentCard: Bool = false) -> String {
        "今天已经换过两次。" + cachePreparationText(preparedFutureDayCount: preparedFutureDayCount, hasCurrentCard: hasCurrentCard)
    }

    static func text(for summary: DiscoveryRunSummary, maximumCandidates: Int, hasCurrentCard: Bool = false) -> String {
        if summary.accessError == .widgetSyncUnavailable {
            return (summary.cardsCreated > 0 ? "新知识卡已保存在本机。" : "")
                + (ProductError.widgetSyncUnavailable.errorDescription ?? "暂时无法同步桌面组件。")
        }
        if summary.cardsCreated > 0 {
            let prepared = "已准备 \(summary.cardsCreated) 天的新知识卡，将按日期展示。"
            if let accessError = summary.accessError {
                return prepared + "后续准备暂时受阻：" + (accessError.errorDescription ?? "请稍后重试。")
            }
            return prepared
        }
        if let accessError = summary.accessError {
            return accessError.errorDescription ?? "暂时无法访问照片或模型服务，请稍后再试。"
        }
        if summary.failed > 0 {
            return "读取或处理照片时遇到问题，候选照片已加密保留在本机，可稍后重试。"
        }
        if summary.analyzed >= 9 && maximumCandidates >= 9 {
            return "今天交给 AI 的 9 张照片都没有达到发布标准；下次会从其他未处理照片继续。"
                + (hasCurrentCard ? "组件继续展示上一条。" : "")
        }
        if summary.analyzed > 0 {
            return "已交给 AI 分析的 \(summary.analyzed) 张照片都没有达到发布标准；没有为了出卡而猜测。"
        }
        if summary.inspected > 0 {
            return "检查过的新照片都在本机隐私与质量筛选中被排除，没有上传给 AI。"
        }
        return "暂时没有新的合适照片。"
    }
}

enum ServiceConnectionState: Equatable {
    case notChecked
    case checking
    case connected
    case unavailable

    var title: String {
        switch self {
        case .notChecked: "未检测"
        case .checking: "检测中"
        case .connected: "已连接"
        case .unavailable: "连接失败"
        }
    }
}

struct PreparedCardInventory {
    let dayCount: Int
    let consecutiveFutureDayCount: Int

    init(state: PersistedAppState, widgetState: WidgetQueueState, now: Date = Date()) {
        // Count actual day-specific selections, never an older fallback or a
        // ready flag without a card. The Widget may have selected a runner-up.
        let offsets = Set((0..<7).filter { offset in
            let day = ChinaDay.string(from: ChinaDay.adding(days: offset, to: now))
            guard state.dailyPreparations[day]?.status == .ready,
                  let selected = widgetState.card(for: day), selected.scheduledDay == day,
                  !state.hiddenCardIDs.contains(selected.id) else { return false }
            return state.cards.contains {
                $0.id == selected.id && $0.scheduledDay == day && !$0.isWithdrawn
            }
        })
        dayCount = offsets.count
        // "Future N days" means tomorrow through an uninterrupted run, not
        // scattered dates which would leave the user expecting a missing card.
        consecutiveFutureDayCount = (1..<7).prefix { offsets.contains($0) }.count
    }
}

struct DailyPreparationPresentation {
    enum Action: Equatable {
        case enableDiscovery, photoSettings, modelSettings, retry

        var title: String {
            switch self {
            case .enableDiscovery: "开启自动发现"
            case .photoSettings: "设置照片权限"
            case .modelSettings: "设置 AI 服务"
            case .retry: "现在检查新照片"
            }
        }
    }

    let title: String
    let detail: String
    let symbol: String
    var action: Action? = nil
    var needsAttention = false

    static func preparing(hasCard: Bool, currentCardIsToday: Bool, futureDays: Int) -> Self {
        guard hasCard else {
            return .init(title: "正在替你找今天的一条",
                         detail: "正在从照片里寻找值得讲的小知识，无需逐张选择。", symbol: "sparkles")
        }
        return .init(title: currentCardIsToday ? "今天的知识已就绪" : "正在准备今天的新知识",
                     detail: futureDays > 0
                        ? "已备好未来 \(futureDays) 天，正在继续补充。"
                        : "正在自动寻找新知识，当前卡片仍可阅读。",
                     symbol: "arrow.triangle.2.circlepath")
    }
}

@MainActor
@Observable
final class AppModel {
    private(set) var state = PersistedAppState.empty
    private(set) var photoAccess: PhotoAccessState = .notDetermined
    private(set) var backgroundPreparationAvailability: BackgroundPreparationAvailability = .unknown
    private(set) var isReady = false
    private(set) var isWorking = false
    private(set) var analysisStage: AnalysisStage = .idle
    private(set) var message: String?
    private(set) var activeCardID: UUID?
    private(set) var imageCache: [UUID: Data] = [:]
    private(set) var widgetQueueState = WidgetQueueState.empty
    private(set) var widgetProjectionReady = true
    private(set) var hasQwenAPIKey = false
    private(set) var managedSubscriptionState: ManagedSubscriptionState = .loading
    private(set) var managedSubscriptionPrice: String?
    private(set) var serviceConnectionState: ServiceConnectionState = .notChecked
    private(set) var historyNavigationID = UUID()
    var selectedSection: AppSection = .today
    var presentedCardID: UUID?

    @ObservationIgnored private let environment: AppEnvironment
    @ObservationIgnored private let launchArguments: [String]
    @ObservationIgnored private let automaticRunner: AutomaticDiscoveryRunner
    @ObservationIgnored private let photoAccessCheck: @Sendable () async -> PhotoAccessState
    @ObservationIgnored private let backgroundAvailabilityCheck: @MainActor () -> BackgroundPreparationAvailability
    @ObservationIgnored private let backgroundSchedule: @MainActor () async throws -> Void
    @ObservationIgnored private var isChangingModelAccess = false
    @ObservationIgnored private var isDeletingData = false
    @ObservationIgnored private var deepLinkLaunchBuffer = CardDeepLinkLaunchBuffer()

    init(
        environment: AppEnvironment,
        launchArguments: [String] = ProcessInfo.processInfo.arguments,
        automaticRunner: AutomaticDiscoveryRunner? = nil,
        photoAccessCheck: (@Sendable () async -> PhotoAccessState)? = nil,
        backgroundAvailabilityCheck: (@MainActor () -> BackgroundPreparationAvailability)? = nil,
        backgroundSchedule: (@MainActor () async throws -> Void)? = nil
    ) {
        self.environment = environment
        self.launchArguments = launchArguments
        #if DEBUG
        let emptyUI = launchArguments.contains("-JianweiOfflineUITest") && launchArguments.contains("-JianweiSeedEmpty")
        self.automaticRunner = automaticRunner ?? AutomaticDiscoveryRunner(
            environment: environment, photoSource: emptyUI ? EmptyUIPhotoSource() : nil
        )
        #else
        self.automaticRunner = automaticRunner ?? AutomaticDiscoveryRunner(environment: environment)
        #endif
        self.photoAccessCheck = photoAccessCheck ?? { await environment.discovery.authorizationState() }
        self.backgroundSchedule = backgroundSchedule ?? {
            try await BackgroundDiscoveryController.schedule(repository: environment.repository)
        }
        self.backgroundAvailabilityCheck = backgroundAvailabilityCheck ?? {
            #if DEBUG
            if launchArguments.contains("-JianweiOfflineUITest") && launchArguments.contains("-JianweiBackgroundRefreshDenied") {
                return .disabled
            }
            #endif
            return BackgroundPreparationAvailability(
                refreshStatus: UIApplication.shared.backgroundRefreshStatus,
                lowPowerMode: ProcessInfo.processInfo.isLowPowerModeEnabled
            )
        }
        refreshBackgroundPreparationAvailability()
    }

    var showsBackgroundPreparationNotice: Bool {
        automaticDiscoveryEnabled && backgroundPreparationAvailability.needsAttention
    }

    func refreshBackgroundPreparationAvailability() {
        // An observation, never a reason to revoke access, pause discovery or
        // start another AI run. Foreground preparation remains available.
        backgroundPreparationAvailability = backgroundAvailabilityCheck()
    }

    var isReadOnlyStateProbe: Bool {
        AppLaunchPolicy.isReadOnlyStateProbe(arguments: launchArguments)
    }

    var managedServiceAvailable: Bool {
        if environment.managedServiceConfigured { return true }
        #if DEBUG
        return launchArguments.contains("-JianweiStorefrontPreview")
        #else
        return false
        #endif
    }
    var deviceBetaExperienceEnabled: Bool { environment.deviceBetaExperienceEnabled }
    var usesLocalDevelopmentService: Bool { environment.api?.usesLocalDevelopmentService ?? false }
    var serviceConfigured: Bool {
        switch state.modelAccessMode {
        case .managed: managedServiceAvailable
        case .qwenUserKey: hasQwenAPIKey
        }
    }
    var modelAccessReady: Bool {
        switch modelAccessMode {
        case .qwenUserKey: hasQwenAPIKey
        case .managed: managedServiceAvailable && (deviceBetaExperienceEnabled || managedSubscriptionState == .subscribed)
        }
    }
    var automaticDiscoveryEnabled: Bool { state.automaticDiscoveryEnabled }
    var preparationMode: AutomaticPreparationMode { state.preparationMode }
    var interests: Set<KnowledgeInterest> { state.interests }
    var modelAccessMode: ModelAccessMode { state.modelAccessMode }
    var savedCards: [KnowledgeCard] {
        state.cards
            .filter { state.savedCardIDs.contains($0.id) }
            .sorted { $0.createdAt > $1.createdAt }
    }
    var historyCards: [KnowledgeCard] {
        CardHistoryResolver.resolve(
            cards: state.cards,
            presentations: widgetQueueState.presentations
        )
    }
    var todaySeenCards: [KnowledgeCard] {
        let today = ChinaDay.string(from: Date())
        return widgetQueueState.surfacedCards(on: today).compactMap { snapshot in
            state.cards.first(where: { $0.id == snapshot.id })
        }
    }
    var currentCard: KnowledgeCard? {
        CurrentCardResolver.resolve(cards: state.cards, widgetState: widgetQueueState, activeCardID: activeCardID)
    }

    var preparedFutureDayCount: Int {
        PreparedCardInventory(state: state, widgetState: widgetQueueState).consecutiveFutureDayCount
    }

    var preparationSummary: String { preparationPresentation.title }

    var preparationPresentation: DailyPreparationPresentation {
        let today = ChinaDay.string(from: Date())
        let hasCard = currentCard != nil
        let retained = hasCard ? "已有知识卡仍可查看，也会保留在回顾中。" : "准备完成后，知识卡会自动出现在这里和桌面组件中。"
        if isWorking {
            if hasCard && !widgetProjectionReady {
                return .init(title: "新卡已保存在本机，小组件等待同步", detail: retained,
                             symbol: "arrow.clockwise", needsAttention: true)
            }
            return .preparing(hasCard: hasCard, currentCardIsToday: currentCard?.scheduledDay == today,
                futureDays: preparedFutureDayCount)
        }
        if photoAccess != .full && photoAccess != .limited {
            return .init(title: "需要照片权限才能自动准备", detail: "可以授权全部或部分照片。\(retained)",
                         symbol: "photo.badge.exclamationmark",
                         action: photoAccess == .notDetermined ? .enableDiscovery : .photoSettings, needsAttention: true)
        }
        if !modelAccessReady {
            return .init(title: modelAccessMode == .qwenUserKey ? "添加 Key，开始每日发现" : "请选择可用的 AI 服务",
                         detail: "可以使用自己的 Qwen Key，或选择见微提供的服务。\(retained)",
                         symbol: "key", action: .modelSettings, needsAttention: true)
        }
        if !automaticDiscoveryEnabled {
            return .init(title: "自动发现已暂停", detail: "开启后会继续自动准备，不会重新分析已处理的照片。\(retained)",
                         symbol: "pause.circle", action: .enableDiscovery)
        }
        if !widgetProjectionReady {
            return .init(title: "小组件等待同步", detail: ProductError.widgetSyncUnavailable.errorDescription ?? "",
                         symbol: "arrow.clockwise", action: .retry, needsAttention: true)
        }
        if let record = state.dailyPreparations[today] {
            switch record.status {
            case .ready:
                if hasCard {
                    let futureDays = preparedFutureDayCount
                    return .init(title: currentCard?.scheduledDay == today ? "今天的知识已就绪" : "继续展示上一条知识",
                                 detail: futureDays > 0 ? "已备好未来 \(futureDays) 天，将按日期展示。" : retained,
                                 symbol: "checkmark.circle")
                }
                return .init(title: "等待准备今天的知识", detail: retained, symbol: "clock", action: .retry)
            case .noNewCard:
                return .init(title: hasCard ? "今天暂时没有新知识，继续展示上一条" : "今天暂时没有新知识",
                             detail: "今天的照片已检查完，下次会从其他未处理照片继续。", symbol: "moon")
            case .waitingForPhotos:
                return .init(title: hasCard ? "暂时没有新照片，继续展示上一条" : "还没有合适的照片",
                             detail: photoAccess == .limited
                                ? "已检查当前授权的照片。可以在系统设置中增加可访问照片，或稍后再来。"
                                : "目前可访问的照片还没有准备出知识卡。有新照片时，见微会在下次运行时继续寻找。",
                             symbol: "photo.on.rectangle", action: photoAccess == .limited ? .photoSettings : .retry)
            case .waitingForAccess:
                return .init(title: "请检查 AI 服务设置后继续准备", detail: "请确认所选服务的 Key、余额或使用权限。\(retained)",
                             symbol: "exclamationmark.circle", action: .modelSettings, needsAttention: true)
            case .retryableFailure:
                return .init(title: "暂时未能完成准备", detail: "照片保留了重试资格，下次运行时会继续尝试。\(retained)",
                             symbol: "arrow.clockwise", action: .retry)
            case .queued, .preparing:
                return .init(title: "等待继续准备知识", detail: "上次准备尚未完成，会在下次运行时继续。\(retained)",
                             symbol: "clock", action: .retry)
            }
        }
        return .init(title: "等待自动准备", detail: retained, symbol: "clock", action: .retry)
    }
    var failedCandidate: PhotoCandidateRecord? {
        state.candidates.first(where: { $0.state == .failed })
    }
    var remainingSwaps: Int {
        widgetQueueState.remainingSwaps(on: ChinaDay.string(from: Date()))
    }
    var canAdvanceCard: Bool {
        widgetQueueState.canAdvance(on: ChinaDay.string(from: Date()))
    }
    var canUndoLastSwap: Bool {
        widgetQueueState.canUndo(on: ChinaDay.string(from: Date()))
    }
    var undoExpirationDate: Date? {
        let today = ChinaDay.string(from: Date())
        return widgetQueueState.dailySelections[today]?.undoStep?.at.addingTimeInterval(30)
    }

    func start() async {
        refreshBackgroundPreparationAvailability()
        #if DEBUG
        if isReadOnlyStateProbe {
            // Branch before maintenance, seeding, credential changes, feedback
            // delivery, Widget projection and automatic photo discovery.
            await reloadFromDisk()
            isReady = true
            if launchArguments.contains("-JianweiOpenSettings") {
                selectedSection = .settings
            } else if launchArguments.contains("-JianweiOpenSaved") {
                selectedSection = .saved
            }
            await reportReadOnlyStateProbe()
            return
        }
        #endif
        var startupStorageWarning = false
        photoAccess = await photoAccessCheck()
        #if DEBUG
        if launchArguments.contains("-JianweiResetOnboarding") {
            try? environment.widgetCoordinator.makeStore().clear()
            try? await environment.repository.deleteLocalData()
            try? await environment.modelAccessStore.removeQwenAPIKey()
        }
        if launchArguments.contains("-JianweiSeedDemo") {
            try? await installDemoState()
        } else if launchArguments.contains("-JianweiSeedStoreDemo") {
            try? await installStoreDemoState()
        }
        #endif
        do {
            _ = try await environment.repository.removeDuplicateCardsByFactID()
            _ = try await environment.repository.repairImportedPhotoProvenance()
            _ = try await environment.repository.removeOrphanedImages()
        } catch {
            startupStorageWarning = true
        }
        let recoveredImportedCardID: UUID?
        do {
            recoveredImportedCardID = try await environment.repository.recoverLatestImportedCard(
                day: ChinaDay.string(from: Date()),
                recoveredAt: Date()
            )
        } catch {
            recoveredImportedCardID = nil
            startupStorageWarning = true
        }
        await reloadFromDisk()
        if let recoveredImportedCardID {
            await activatePresentation(cardID: recoveredImportedCardID)
        }
        if deviceBetaExperienceEnabled {
            // Fresh installs already default to managed. Never override an
            // explicit BYOK choice, including after its credential was removed.
            // Only the Mac-hosted development backend is ephemeral. Keep
            // valid public-service credentials across launches, including
            // offline starts; an actual 401 still uses the normal recovery.
            if usesLocalDevelopmentService {
                try? await environment.identity?.invalidateServerCredential()
            }
            await reloadFromDisk()
        }
        #if DEBUG
        if launchArguments.contains("-JianweiAuthorizedFixtureE2E") {
            // The cloud journey must not inherit a BYOK choice or a credential
            // issued by an earlier in-memory backend run from the simulator.
            try? await environment.repository.setModelAccessMode(.managed)
            try? await environment.identity?.invalidateServerCredential()
            await reloadFromDisk()
        }
        #endif
        if !managedServiceAvailable, state.modelAccessMode == .managed {
            try? await environment.repository.setModelAccessMode(.qwenUserKey)
            await reloadFromDisk()
        }
        await refreshModelAccessStatus()
        if deviceBetaExperienceEnabled {
            managedSubscriptionState = .subscribed
            managedSubscriptionPrice = nil
        } else {
            #if DEBUG
            if launchArguments.contains("-JianweiStorefrontPreview") || launchArguments.contains("-JianweiOfflineUITest") {
                managedSubscriptionState = .notSubscribed
                managedSubscriptionPrice = "¥8.00"
            } else {
                await refreshManagedSubscription()
            }
            #else
            await refreshManagedSubscription()
            #endif
        }
        await flushPendingFeedback()
        if state.automaticDiscoveryEnabled {
            try? await BackgroundDiscoveryController.schedule(repository: environment.repository)
            let today = ChinaDay.string(from: Date())
            if state.dailyPreparations[today] == nil {
                let status: DailyPreparationStatus = photoAccess == .full || photoAccess == .limited
                    ? .queued
                    : .waitingForAccess
                try? await environment.repository.savePreparation(DailyPreparationRecord(
                    day: today,
                    status: status,
                    lastAttemptAt: Date()
                ))
                await reloadFromDisk()
            }
        }
        if deviceBetaExperienceEnabled && managedServiceAvailable {
            await checkServiceConnection(showResult: false)
        }
        isReady = true
        if let pendingCardID = deepLinkLaunchBuffer.appBecameReady() {
            presentDeepLinkedCard(pendingCardID)
        }
        if startupStorageWarning, message == nil {
            message = "本地数据维护尚未完成；请确认设备存储可用后重启见微。"
        }
        #if DEBUG
        if launchArguments.contains("-JianweiPhotoLibrarySummaryProbe") {
            let access = await environment.discovery.authorizationState()
            let queryResult: ([PhotoAssetReference], PhotoLibraryQuerySummary?, Bool)
            do {
                let assets = try await environment.discovery.recentAssets(days: 90, limit: 500)
                let summary = try await environment.discovery.debugQuerySummary(days: 90, limit: 500)
                queryResult = (assets, summary, true)
            } catch {
                queryResult = ([], nil, false)
            }
            let (assets, querySummary, querySucceeded) = queryResult
            let knownIDs = state.processedLocalIdentifiers
            let unseen = assets.filter { !knownIDs.contains($0.localIdentifier) }
            let formatter = ISO8601DateFormatter()
            let newest = assets.first
            let payload: [String: Any] = [
                "access": access.rawValue,
                "querySucceeded": querySucceeded,
                "returnedAssetCount": assets.count,
                "unseenAssetCount": unseen.count,
                "genericRecentCount": querySummary?.genericRecentCount ?? -1,
                "typedRecentCount": querySummary?.typedRecentCount ?? -1,
                "visibleImageCountUpToLimit": querySummary?.visibleImageCountUpToLimit ?? -1,
                "newestCapturedAt": (querySummary?.newestCapturedAt ?? newest?.capturedAt).map(formatter.string(from:)) ?? NSNull(),
                "newestModifiedAt": (querySummary?.newestModifiedAt ?? newest?.modifiedAt).map(formatter.string(from:)) ?? NSNull(),
                "newestIsScreenshot": querySummary?.newestIsScreenshot ?? newest?.isScreenshot ?? false,
                "newestAlreadyKnown": newest.map { knownIDs.contains($0.localIdentifier) } ?? false,
                "probedAt": formatter.string(from: Date())
            ]
            if let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]),
               let root = try? LocalRepository.defaultRootURL() {
                try? data.write(
                    to: root.appendingPathComponent("photo-library-summary-probe.json"),
                    options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
                )
            }
            message = "只读相册探针：权限 \(access.rawValue)，可见 \(assets.count) 张，未处理 \(unseen.count) 张。"
            print("JIANWEI_PHOTO_LIBRARY_SUMMARY_PROBE access=\(access.rawValue) visible=\(assets.count) unseen=\(unseen.count) query=\(querySucceeded ? 1 : 0)")
            return
        }
        if launchArguments.contains("-JianweiOpenSettings") {
            selectedSection = .settings
        } else if launchArguments.contains("-JianweiOpenSaved") {
            selectedSection = .saved
        }
        if launchArguments.contains("-JianweiDeviceGalleryProbe") {
            try? await environment.repository.setAutomaticDiscovery(true)
            let photoAccess = await environment.discovery.authorizationState()
            let summary = await AutomaticDiscoveryRunner(environment: environment)
                .run(maximumCandidates: 6, ignoreDailySelection: true, lookbackDays: 3_650)
            await reloadFromDisk()
            let accessError = summary.accessError?.errorDescription ?? "无"
            message = "真机相册探针：权限 \(photoAccess.rawValue)，检查 \(summary.inspected) 张，送 AI \(summary.analyzed) 张，生成 \(summary.knowledgeReady) 条，过滤 \(summary.filtered) 张，无卡 \(summary.exhausted) 张，失败 \(summary.failed) 张，错误 \(accessError)。"
            print("JIANWEI_DEVICE_GALLERY_PROBE \(message ?? "")")
        }
        #endif
        if state.automaticDiscoveryEnabled && (photoAccess == .full || photoAccess == .limited) {
            await replenishRollingCache(showResult: false)
        }
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
            await enableAutomaticDiscovery()
        } catch {
            message = "保存设置失败，请再试一次。"
        }
    }

    func enableAutomaticDiscovery() async {
        let access = await environment.discovery.requestAccess()
        photoAccess = access
        guard access == .full || access == .limited else {
            do {
                try await environment.repository.setAutomaticDiscovery(false)
                await BackgroundDiscoveryController.cancel()
                await reloadFromDisk()
                try? await environment.repository.savePreparation(DailyPreparationRecord(
                    day: ChinaDay.string(from: Date()),
                    status: .waitingForAccess,
                    lastAttemptAt: Date()
                ))
                await reloadFromDisk()
                message = "需要照片权限才能每天自动准备知识卡，可在系统设置中重新开启。"
            } catch {
                message = "无法保存相册权限状态，请重启后再试。"
            }
            return
        }
        do {
            try await environment.repository.setAutomaticDiscovery(true)
            // Replenishment reads the observable snapshot, not the repository.
            // Publish the enabled state before its paused-state gate runs.
            await reloadFromDisk()
        } catch {
            message = "自动发现开启失败，请检查设备存储后再试。"
            return
        }
        try? await BackgroundDiscoveryController.schedule(repository: environment.repository)
        await runAutomaticDiscovery()
    }

    func disableAutomaticDiscovery() async {
        await BackgroundDiscoveryController.cancel()
        do {
            try await environment.repository.setAutomaticDiscovery(false)
            await reloadFromDisk()
            message = "自动发现已暂停，已选照片仍保留在本机。"
        } catch {
            message = "暂停状态未能保存，请检查设备存储后重试。"
        }
    }

    func runAutomaticDiscovery() async {
        await replenishRollingCache(showResult: true)
    }

    func replenishRollingCache(showResult: Bool = false) async {
        guard !isReadOnlyStateProbe, !Task.isCancelled else { return }
        guard await refreshAutomaticPhotoAccess() else { return }
        guard !Task.isCancelled else { return }
        guard !isWorking else {
            if showResult { message = "正在自动准备，请稍等片刻。" }
            return
        }
        guard state.automaticDiscoveryEnabled else {
            if showResult { message = "自动发现已暂停。" }
            return
        }
        isWorking = true
        defer {
            isWorking = false
            analysisStage = currentCard == nil ? .idle : .ready
        }
        analysisStage = currentCard == nil ? .understanding : .preparing
        if showResult { message = nil }
        // A failed submission or an OS-discarded request leaves no future
        // opportunity. Recover on every eligible foreground refill, including
        // resume and midnight, without postponing an existing pending request.
        // Failure here must not prevent foreground cards from being prepared.
        try? await backgroundSchedule()
        guard !Task.isCancelled else { return }
        let maximum = AutomaticDiscoveryRunner.foregroundRefillPhotoLimit
        let aggregate = await automaticRunner.replenishRollingWindow(maximumCandidates: maximum) { [weak self] _ in
            guard let self else { return }
            await self.reloadFromDisk()
            await MainActor.run { self.analysisStage = .preparing }
        }
        await reloadFromDisk()
        if showResult {
            message = aggregate.inspected == 0 && aggregate.analyzed == 0 &&
                aggregate.failed == 0 && aggregate.accessError == nil
                ? DiscoveryRunMessage.cachePreparationText(preparedFutureDayCount: preparedFutureDayCount, hasCurrentCard: currentCard != nil)
                : DiscoveryRunMessage.text(for: aggregate, maximumCandidates: maximum, hasCurrentCard: currentCard != nil)
        }
    }

    func importPhoto(data: Data) async {
        let pipeline = environment.pipeline
        guard !isWorking else {
            message = "正在处理另一张照片，请完成后再试。"
            return
        }
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
                capturedAt: nil,
                existingHashes: hashes
            )
            try await persist(result)
            if let card = result.card {
                _ = try await environment.repository.publishCardImmediately(
                    cardID: card.id,
                    day: ChinaDay.string(from: Date()),
                    publishedAt: Date()
                )
            }
            await reloadFromDisk()
            if let card = result.card {
                await activatePresentation(cardID: card.id)
            }
            analysisStage = result.card == nil ? .idle : .ready
            message = result.card == nil
                ? ProductError.noReliableKnowledge.errorDescription
                : "知识卡已直接展示并留在回顾中，不占用今天自动三选一的名额。"
        } catch let rejection as PipelineRejection {
            do {
                try await environment.repository.upsert(candidate: rejection.candidate)
            } catch {
                analysisStage = .idle
                message = ProductError.localStorageUnavailable.errorDescription
                isWorking = false
                return
            }
            analysisStage = .idle
            message = rejection.errorDescription
        } catch let failure as PipelineFailure {
            do {
                try await persist(failure)
            } catch {
                analysisStage = .idle
                message = ProductError.localStorageUnavailable.errorDescription
                isWorking = false
                return
            }
            analysisStage = .idle
            message = failure.cause.errorDescription
        } catch {
            analysisStage = .idle
            message = (error as? LocalizedError)?.errorDescription ?? "暂时无法理解这张照片。"
        }
        isWorking = false
    }

    func retryFailedUpload() async {
        guard let candidate = failedCandidate,
              let jpeg = await environment.repository.imageData(candidateToken: candidate.id),
              !isWorking else { return }
        let pipeline = environment.pipeline
        isWorking = true
        analysisStage = .understanding
        do {
            let result = try await pipeline.retry(candidate: candidate, sanitizedJPEG: jpeg)
            try await persist(result)
            if let card = result.card {
                _ = try await environment.repository.publishCardImmediately(
                    cardID: card.id,
                    day: ChinaDay.string(from: Date()),
                    publishedAt: Date()
                )
            }
            await reloadFromDisk()
            if let card = result.card {
                await activatePresentation(cardID: card.id)
            }
            analysisStage = result.card == nil ? .idle : .ready
            message = result.card == nil
                ? ProductError.noReliableKnowledge.errorDescription
                : "重试成功，知识卡已经准备好。"
        } catch let rejection as PipelineRejection {
            do {
                try await environment.repository.upsert(candidate: rejection.candidate)
            } catch {
                analysisStage = .idle
                message = ProductError.localStorageUnavailable.errorDescription
                isWorking = false
                return
            }
            await reloadFromDisk()
            analysisStage = .idle
            message = rejection.cause.errorDescription
        } catch let failure as PipelineFailure {
            do {
                try await persist(failure)
            } catch {
                analysisStage = .idle
                message = ProductError.localStorageUnavailable.errorDescription
                isWorking = false
                return
            }
            analysisStage = .idle
            message = failure.errorDescription
        } catch {
            analysisStage = .idle
            message = "重试失败，候选仍安全保留在本机。"
        }
        isWorking = false
    }

    func synchronizeCards(showFailure: Bool = false) async {
        guard !isReadOnlyStateProbe, !isDeletingData, !Task.isCancelled else { return }
        // Device Beta cards remain authoritative on the iPhone. An empty
        // gateway response must never erase cards already persisted locally.
        guard RemoteCardSyncPolicy.allows(
            deviceBetaExperienceEnabled: deviceBetaExperienceEnabled,
            modelAccessMode: state.modelAccessMode
        ) else { return }
        guard let api = environment.api, let identity = environment.identity else { return }
        let repository = environment.repository
        let syncToken: UUID
        do { syncToken = try await repository.remoteCardSyncToken() }
        catch { return }
        let checkAccess: @Sendable () async throws -> Void = {
            try await repository.validateRemoteCardSync(syncToken)
        }
        do {
            let cards: [KnowledgeCard]
            do {
                try await checkAccess()
                let credentials = try await identity.credentials()
                cards = try await api.cards(bearer: credentials.token, checkAccess: checkAccess)
            } catch ProductError.serverCredentialExpired {
                // A delayed response from before a clear or mode switch cannot
                // invalidate/re-register the credentials of the current mode.
                try await checkAccess()
                try await identity.invalidateServerCredential()
                try await checkAccess()
                let credentials = try await identity.credentials()
                cards = try await api.cards(bearer: credentials.token, checkAccess: checkAccess)
            }
            try await repository.replaceRemoteCards(cards, syncToken: syncToken)
            await reloadFromDisk()
        } catch {
            guard (try? await checkAccess()) != nil else { return }
            if showFailure {
                message = "暂时无法同步，桌面会继续使用本机缓存。"
            }
        }
    }

    func toggleSaved(_ card: KnowledgeCard) async {
        let saved = !state.savedCardIDs.contains(card.id)
        do {
            try await environment.repository.setSaved(saved, cardID: card.id)
            await reloadFromDisk()
            message = saved ? "已收藏，可以在“回顾 · 收藏”里找到。" : "已取消收藏，卡片仍保留在回顾里。"
        } catch {
            message = "收藏状态未能保存，请检查设备存储后重试。"
        }
    }

    func submitFeedback(
        card: KnowledgeCard,
        action: FeedbackAction,
        hideLocally: Bool? = nil
    ) async {
        let shouldHide = hideLocally ?? (action == .wrongObject || action == .tooPrivate)
        let pending: PendingFeedback
        do {
            pending = try await environment.repository.recordFeedback(cardID: card.id, action: action)
            if shouldHide {
                try await environment.repository.hideCard(
                    card.id,
                    candidateToken: card.candidateToken,
                    neverAnalyze: action == .tooPrivate
                )
            }
        } catch {
            await reloadFromDisk()
            message = shouldHide
                ? "未能完整移除这张卡，请检查设备存储后重试。"
                : "反馈未能保存在本机，请检查设备存储后重试。"
            return
        }
        var widgetProjectionReady = await reloadFromDisk()
        if state.modelAccessMode == .qwenUserKey {
            try? await environment.repository.confirmFeedback(pending.id)
            widgetProjectionReady = await reloadFromDisk() && widgetProjectionReady
            message = shouldHide && !widgetProjectionReady
                ? "卡片已从主应用移除，但桌面小组件副本尚未确认清理；请保持应用打开后再试一次。"
                : feedbackConfirmation(action)
            return
        }
        do {
            try await send(pending)
            try await environment.repository.confirmFeedback(pending.id)
            widgetProjectionReady = await reloadFromDisk() && widgetProjectionReady
            message = shouldHide && !widgetProjectionReady
                ? "卡片已从主应用移除，但桌面小组件副本尚未确认清理；请保持应用打开后再试一次。"
                : feedbackConfirmation(action)
        } catch {
            message = shouldHide && !widgetProjectionReady
                ? "卡片已从主应用移除，但桌面小组件副本尚未确认清理；反馈与清理都会继续重试。"
                : shouldHide
                    ? "已先在本机处理；联网后会同步这次反馈。"
                : "反馈已保存在本机，联网后自动同步。"
        }
    }

    func showAllHistory() {
        // An explicit "view all" request starts at the unfiltered history root.
        // Ordinary tab switches retain the reader's filter and detail position.
        historyNavigationID = UUID()
        selectedSection = .saved
    }

    func showNextCard() async {
        guard let store = try? environment.widgetCoordinator.makeStore() else {
            message = "暂时无法读取桌面卡片，请稍后再试。"
            return
        }
        let result: WidgetAdvanceResult
        do {
            result = try store.advance(on: ChinaDay.string(from: Date()))
        } catch {
            message = "暂时无法更新桌面卡片，请稍后再试。"
            return
        }
        switch result {
        case .advanced:
            WidgetCenter.shared.reloadTimelines(ofKind: SharedConstants.widgetKind)
            await reloadWidgetSelection()
            message = canUndoLastSwap ? "已换一条，30 秒内可以撤销。" : nil
        case .limitReached:
            message = DiscoveryRunMessage.swapLimitText(preparedFutureDayCount: preparedFutureDayCount, hasCurrentCard: currentCard != nil)
        case .noCandidate:
            message = "今天没有更多达到标准的知识了。"
        case .noSelection:
            message = "今天还没有准备好可展示的知识。"
        }
    }

    func undoLastSwap() async {
        guard let store = try? environment.widgetCoordinator.makeStore() else {
            message = "暂时无法读取桌面卡片，请稍后再试。"
            return
        }
        guard (try? store.undo(on: ChinaDay.string(from: Date()))) == true else {
            message = "这次换卡已经不能撤销。出现过且未被移除的卡仍会保留在回顾里。"
            return
        }
        WidgetCenter.shared.reloadTimelines(ofKind: SharedConstants.widgetKind)
        await reloadWidgetSelection()
        message = "已回到上一条。"
    }

    func refreshPresentationState() async {
        refreshBackgroundPreparationAvailability()
        await reloadFromDisk()
    }

    func dayDidChange() async {
        guard !isReadOnlyStateProbe, !Task.isCancelled else { return }
        // Show an already-cached card promptly, then fill the rolling window.
        // No new scene activation is needed when the app stays open overnight.
        await refreshPresentationState()
        guard !Task.isCancelled else { return }
        await replenishRollingCache(showResult: false)
    }

    func resumeFromBackground() async {
        guard isReady, !isReadOnlyStateProbe else { return }
        _ = await refreshAutomaticPhotoAccess()
        if deviceBetaExperienceEnabled && managedServiceAvailable {
            await checkServiceConnection(showResult: false)
        }
        await synchronizeCards(showFailure: false)
        await refreshPresentationState()
        await replenishRollingCache(showResult: false)
    }

    private func refreshAutomaticPhotoAccess() async -> Bool {
        photoAccess = await photoAccessCheck()
        guard photoAccess == .full || photoAccess == .limited else {
            await BackgroundDiscoveryController.cancel()
            try? await environment.repository.setAutomaticDiscovery(false)
            await reloadFromDisk()
            return false
        }
        return true
    }

    func refreshUndoAvailability() async {
        await reloadWidgetSelection()
    }

    func reportPhotoReadFailure() {
        message = ProductError.photoUnavailable.errorDescription
    }

    func open(url: URL) {
        if url.scheme == "jianwei", url.host == "start", url.path.isEmpty || url.path == "/" {
            // An empty widget is a recovery entry, not just an app launcher.
            // A newer start link must also supersede a queued cold-launch card.
            deepLinkLaunchBuffer = CardDeepLinkLaunchBuffer()
            presentedCardID = nil
            message = nil
            selectedSection = .today
            return
        }
        guard let id = deepLinkLaunchBuffer.receive(url: url, isReady: isReady) else { return }
        presentDeepLinkedCard(id)
    }

    private func presentDeepLinkedCard(_ id: UUID) {
        guard state.cards.contains(where: { $0.id == id }) else {
            message = "这张卡已经被移除。"
            return
        }
        selectedSection = .today
        presentedCardID = id
    }

    func clearMessage() { message = nil }

    func checkServiceConnection(showResult: Bool = true) async {
        guard !isReadOnlyStateProbe else { return }
        guard modelAccessMode == .managed else { return }
        guard let api = environment.api else {
            serviceConnectionState = .unavailable
            if showResult { message = "AI 服务尚未配置。" }
            return
        }
        guard serviceConnectionState != .checking else { return }
        serviceConnectionState = .checking
        do {
            try await api.health()
            guard modelAccessMode == .managed else {
                serviceConnectionState = .notChecked
                return
            }
            serviceConnectionState = .connected
            #if DEBUG
            print("JIANWEI_SERVICE_CONNECTION_OK host=\(api.baseURL.host ?? "unknown")")
            #endif
            if showResult { message = "见微服务器可连接。" }
        } catch {
            guard modelAccessMode == .managed else {
                serviceConnectionState = .notChecked
                return
            }
            #if DEBUG
            let diagnostic = error as NSError
            print(
                "JIANWEI_SERVICE_CONNECTION_FAILED "
                    + "domain=\(diagnostic.domain) code=\(diagnostic.code) "
                    + "description=\(diagnostic.localizedDescription)"
            )
            #endif
            serviceConnectionState = .unavailable
            if showResult {
                message = deviceBetaExperienceEnabled && api.usesLocalDevelopmentService
                    ? "无法连接 Mac 上的见微服务。请先在系统设置中允许见微访问本地网络，再确认 Mac 与 iPhone 在同一 Wi-Fi。"
                    : "暂时无法连接 AI 服务，请稍后再试。"
            }
        }
    }

    func deleteLocalData() async {
        guard !isDeletingData else { return }
        isDeletingData = true
        defer { isDeletingData = false }
        let deletion = await clearLocalStores()
        if deletion.repository && deletion.widget {
            message = "本机索引、卡片和脱敏缩略图已清除。"
        } else if deletion.repository {
            message = "主应用数据已清除，但桌面小组件副本尚未确认清理，请重试。"
        } else if deletion.widget {
            message = "桌面小组件副本已清除，但主应用数据清除失败，请重试。"
        } else {
            message = "本机数据尚未确认清除，请检查设备存储后重试。"
        }
    }

    func deleteCloudAndLocalData() async {
        guard !isDeletingData else { return }
        guard environment.api != nil, let identity = environment.identity else {
            message = "云端服务尚未配置；你仍可以先清除本机数据。"
            return
        }
        isDeletingData = true
        defer { isDeletingData = false }
        await environment.repository.invalidateRemoteCardSync()
        // Invalidate suspended analysis before awaiting a remote deletion.
        // Otherwise a late upload can recreate the cloud data just removed.
        await BackgroundDiscoveryController.cancel()
        do {
            try await environment.repository.setAutomaticDiscovery(false)
        } catch {
            message = "无法安全暂停分析，尚未开始删除，请重试。"
            return
        }
        isWorking = true
        defer { isWorking = false }
        var cloudDeleted = false
        var noLocalCloudIdentity = false
        let localDeletion: (repository: Bool, widget: Bool)
        do {
            cloudDeleted = try await identity.deleteExistingCloudData()
            noLocalCloudIdentity = !cloudDeleted
        } catch {
            cloudDeleted = false
        }
        localDeletion = await clearLocalStores()
        if noLocalCloudIdentity {
            message = localDeletion.repository && localDeletion.widget
                ? "本机数据已删除；未找到本机保存的见微云端身份，未发起云端请求。"
                : "未找到本机保存的见微云端身份，未发起云端请求；本机数据尚未全部清除，请重试。"
            return
        }
        switch (cloudDeleted, localDeletion.repository, localDeletion.widget) {
        case (true, true, true):
            message = "云端设备数据与本机索引都已删除。"
        case (false, true, true):
            message = "本机数据已删除；云端尚未确认删除，本机身份仍保留以便重试。"
        default:
            let cloudStatus = cloudDeleted
                ? "云端数据已删除"
                : "云端尚未确认删除，本机身份仍保留以便重试"
            let appStatus = localDeletion.repository
                ? "主应用数据已清除"
                : "主应用数据尚未确认清除"
            let widgetStatus = localDeletion.widget
                ? "桌面小组件副本已清除"
                : "桌面小组件副本尚未确认清除"
            message = "\(cloudStatus)；\(appStatus)；\(widgetStatus)。"
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
        do {
            try await environment.repository.setPreferences(
                interests: interests,
                preparationMode: preparationMode
            )
            await reloadFromDisk()
        } catch {
            message = "偏好未能保存，请检查设备存储后重试。"
        }
    }

    func useManagedModelService() async {
        guard !isWorking, !isChangingModelAccess else { return }
        guard managedServiceAvailable else {
            message = ProductError.apiNotConfigured.errorDescription
            return
        }
        guard managedSubscriptionState == .subscribed || deviceBetaExperienceEnabled else {
            message = "请先订阅见微 Pro，或改用自己的 Qwen API Key。"
            return
        }
        isChangingModelAccess = true
        var changed = false
        do {
            try await environment.repository.setModelAccessMode(.managed)
            await reloadFromDisk()
            changed = true
            message = deviceBetaExperienceEnabled
                ? "现有 AI 已就绪，见微会自动准备每天的知识卡。"
                : "已切换到见微托管服务。正式使用需要有效订阅。"
        } catch {
            message = "暂时无法保存 AI 服务设置。"
        }
        isChangingModelAccess = false
        if changed { await resumeAutomaticPreparationAfterModelChange() }
    }

    func purchaseManagedModelService() async {
        guard managedServiceAvailable else {
            message = ProductError.apiNotConfigured.errorDescription
            return
        }
        guard !isWorking, !isChangingModelAccess else { return }
        isWorking = true
        isChangingModelAccess = true
        var shouldResume = false
        do {
            guard let identity = environment.identity else { throw ProductError.apiNotConfigured }
            let installationID = try await identity.installationID()
            switch try await environment.subscriptionStore.purchase(appAccountToken: installationID) {
            case .cancelled:
                // An existing entitlement is not consent to switch from BYOK.
                message = "已取消购买，当前 AI 服务方式不变。"
            case .purchased:
                await refreshManagedSubscription()
                if managedSubscriptionState == .subscribed {
                    try await environment.repository.setModelAccessMode(.managed)
                    await reloadFromDisk()
                    shouldResume = true
                    message = "见微 Pro 已开通，见微会自动寻找并准备每天的知识卡。"
                } else {
                    message = "购买结果尚未确认，当前 AI 服务方式未更改。请稍后尝试恢复购买。"
                }
            }
        } catch let error as ProductError {
            message = error.errorDescription
        } catch {
            message = "暂时无法完成购买，请稍后再试。"
        }
        isWorking = false
        isChangingModelAccess = false
        if shouldResume { await resumeAutomaticPreparationAfterModelChange() }
    }

    func restoreManagedSubscription() async {
        guard !isWorking, !isChangingModelAccess else { return }
        isWorking = true
        isChangingModelAccess = true
        message = "正在恢复 App Store 购买记录…"
        var shouldResume = false
        do {
            try await environment.subscriptionStore.restore()
            await refreshManagedSubscription()
            await reloadFromDisk()
            // Restore the entitlement, not a different billing preference.
            shouldResume = managedSubscriptionState == .subscribed && state.modelAccessMode == .managed
            message = managedSubscriptionState == .subscribed
                ? "已恢复见微 Pro 订阅。"
                : "没有找到当前有效的见微 Pro 订阅。"
        } catch {
            message = "暂时无法恢复购买，请稍后再试。"
        }
        isWorking = false
        isChangingModelAccess = false
        if shouldResume { await resumeAutomaticPreparationAfterModelChange() }
    }

    func saveAndUseQwenAPIKey(_ value: String) async {
        guard !isWorking, !isChangingModelAccess else {
            message = "正在准备知识卡，请稍后再更新 AI 设置。"
            return
        }
        isChangingModelAccess = true
        var changed = false
        do {
            try await environment.modelAccessStore.saveQwenAPIKey(value)
            do {
                try await environment.repository.setModelAccessMode(.qwenUserKey)
            } catch {
                try? await environment.modelAccessStore.removeQwenAPIKey()
                throw ProductError.localStorageUnavailable
            }
            await refreshModelAccessStatus()
            await reloadFromDisk()
            changed = true
            message = "Qwen API Key 已安全保存在这台 iPhone，并已切换为自带 Key。"
        } catch let error as ProductError {
            message = error.errorDescription
        } catch {
            message = "暂时无法保存 Qwen API Key。"
        }
        isChangingModelAccess = false
        if changed { await resumeAutomaticPreparationAfterModelChange() }
    }

    func useSavedQwenAPIKey() async {
        guard !isWorking, !isChangingModelAccess else { return }
        isChangingModelAccess = true
        var changed = false
        do {
            _ = try await environment.modelAccessStore.request(for: .qwenUserKey)
            try await environment.repository.setModelAccessMode(.qwenUserKey)
            await refreshModelAccessStatus()
            await reloadFromDisk()
            changed = true
            message = "已切换为自己的 Qwen Key，费用计入自己的百炼账号。"
        } catch {
            message = "暂时无法读取本机 Key，请重新添加后再试。"
        }
        isChangingModelAccess = false
        if changed { await resumeAutomaticPreparationAfterModelChange() }
    }

    private func resumeAutomaticPreparationAfterModelChange() async {
        // A working Key restores the automatic loop, not permission to unpause
        // it. Replenishment still checks photo access and the existing budgets.
        guard state.automaticDiscoveryEnabled else { return }
        try? await BackgroundDiscoveryController.schedule(repository: environment.repository)
        await replenishRollingCache(showResult: false)
    }

    func removeQwenAPIKey() async {
        guard !isChangingModelAccess else { return }
        isChangingModelAccess = true
        defer { isChangingModelAccess = false }
        let snapshot = await environment.repository.snapshot()
        if snapshot.modelAccessMode == .qwenUserKey {
            // Stop subsequent stages that already captured the old Key, while
            // retaining the auto preference and any already-reserved usage.
            await environment.repository.invalidateAutomaticDiscoveryRun()
            await BackgroundDiscoveryController.cancel()
        }
        do {
            try await environment.modelAccessStore.removeQwenAPIKey()
            await refreshModelAccessStatus()
            await reloadFromDisk()
            message = snapshot.modelAccessMode == .qwenUserKey
                ? "Key 已删除；新卡准备将等待你添加 Key，已有卡片继续保留。"
                : "Qwen API Key 已从这台 iPhone 删除，当前服务方式不变。"
        } catch {
            await refreshModelAccessStatus()
            await reloadFromDisk()
            message = "Qwen API Key 尚未确认删除，请解锁设备后重试。"
        }
    }

    func imageData(for card: KnowledgeCard) -> Data? {
        imageCache[card.candidateToken]
    }

    private func persist(_ result: AnalysisPipelineResult) async throws {
        if let card = result.card {
            try await environment.repository.upsert(
                candidate: result.candidate,
                card: card,
                sanitizedJPEG: result.sanitizedJPEG
            )
        } else {
            try await environment.repository.removeImage(candidateToken: result.candidate.id)
            try await environment.repository.upsert(candidate: result.candidate)
        }
    }

    private func persist(_ failure: PipelineFailure) async throws {
        try await environment.repository.upsert(candidate: failure.candidate)
        try await environment.repository.storeImage(
            failure.sanitizedJPEG,
            candidateToken: failure.candidate.id
        )
    }

    @discardableResult
    private func reloadFromDisk() async -> Bool {
        state = await environment.repository.snapshot()
        if let presentedCardID, !state.cards.contains(where: { $0.id == presentedCardID }) {
            self.presentedCardID = nil
        }
        var images: [UUID: Data] = [:]
        for card in state.cards {
            if let data = await environment.repository.imageData(candidateToken: card.candidateToken) {
                images[card.candidateToken] = data
            }
        }
        imageCache = images
        if isReadOnlyStateProbe {
            await reloadWidgetSelection()
            return true
        }
        do {
            try await environment.widgetCoordinator.synchronize()
            widgetProjectionReady = true
        } catch {
            #if DEBUG
            print("JIANWEI_WIDGET_SYNC_ERROR \(String(reflecting: error))")
            #endif
            widgetProjectionReady = false
        }
        await reloadWidgetSelection()
        return widgetProjectionReady
    }

    private func clearLocalStores() async -> (repository: Bool, widget: Bool) {
        let repositoryDeleted: Bool
        do {
            try await environment.repository.deleteLocalData()
            repositoryDeleted = true
            state = await environment.repository.snapshot()
            imageCache = [:]
            presentedCardID = nil
        } catch {
            repositoryDeleted = false
        }
        let widgetDeleted: Bool
        do {
            try environment.widgetCoordinator.makeStore().clear()
            widgetDeleted = true
            widgetQueueState = .empty
            activeCardID = nil
            WidgetCenter.shared.reloadAllTimelines()
        } catch {
            widgetDeleted = false
        }
        return (repositoryDeleted, widgetDeleted)
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
        #if DEBUG
        if isReadOnlyStateProbe {
            // SharedWidgetStore.load creates a lock file. Read the atomically
            // replaced JSON directly so probing never creates/repairs a store.
            if let root = FileManager.default.containerURL(
                forSecurityApplicationGroupIdentifier: SharedConstants.appGroupIdentifier
            ), let data = try? Data(contentsOf: root.appendingPathComponent(SharedConstants.widgetStateFilename)) {
                let decoder = JSONDecoder()
                decoder.dateDecodingStrategy = .iso8601
                widgetQueueState = (try? decoder.decode(WidgetQueueState.self, from: data)) ?? .empty
            } else {
                widgetQueueState = .empty
            }
            activeCardID = widgetQueueState.card(for: ChinaDay.string(from: Date()))?.id
            return
        }
        #endif
        guard let store = try? environment.widgetCoordinator.makeStore(),
              let widgetState = try? store.load() else {
            widgetQueueState = .empty
            activeCardID = nil
            return
        }
        widgetQueueState = widgetState
        let today = ChinaDay.string(from: Date())
        activeCardID = widgetState.card(for: today)?.id

        // A widget extension can update the App Group but cannot atomically
        // mutate the app-private repository. Reconcile the selected runner-up
        // whenever the app is active so history and local card status converge.
        if let activeCardID,
           let card = state.cards.first(where: { $0.id == activeCardID }),
           !card.isPublished,
           (try? await environment.repository.publishCardImmediately(
               cardID: activeCardID,
               day: today,
               publishedAt: Date()
           )) == true {
            state = await environment.repository.snapshot()
            try? await environment.widgetCoordinator.synchronize()
            if let refreshed = try? store.load() {
                widgetQueueState = refreshed
            }
        }
    }

    private func activatePresentation(cardID: UUID) async {
        let day = ChinaDay.string(from: Date())
        guard let store = try? environment.widgetCoordinator.makeStore(),
              (try? store.activate(cardID: cardID, on: day)) == true else {
            activeCardID = cardID
            return
        }
        WidgetCenter.shared.reloadTimelines(ofKind: SharedConstants.widgetKind)
        await reloadWidgetSelection()
    }

    #if DEBUG
    private func reportReadOnlyStateProbe() async {
        let today = ChinaDay.string(from: Date())
        let appCardID = currentCard?.id.uuidString.lowercased() ?? "none"
        let widgetCard = widgetQueueState.card(for: today) ?? widgetQueueState.mostRecentCard(onOrBefore: today)
        let widgetCardID = widgetCard?.id.uuidString.lowercased() ?? "none"
        let networkInterface = await DebugNetworkPathProbe.currentInterface()
        let preparation = state.dailyPreparations[today]?.status.rawValue ?? "missing"
        print(
            "JIANWEI_READ_ONLY_STATE_PROBE " +
            "cards=\(state.cards.count) " +
            "current=\(currentCard == nil ? 0 : 1) " +
            "appCardID=\(appCardID) " +
            "history=\(historyCards.count) " +
            "widgetPresentations=\(widgetQueueState.presentations.count) " +
            "widgetCardID=\(widgetCardID) " +
            "cardsMatch=\(appCardID == widgetCardID ? 1 : 0) " +
            "network=\(networkInterface) " +
            "preparation=\(preparation) " +
            "managedService=\(managedServiceAvailable ? 1 : 0)"
        )
    }
    #endif

    private func flushPendingFeedback() async {
        let pending = state.pendingFeedback
        if state.modelAccessMode == .qwenUserKey {
            for item in pending {
                try? await environment.repository.confirmFeedback(item.id)
            }
            state = await environment.repository.snapshot()
            return
        }
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
        do {
            let credentials = try await identity.credentials()
            try await api.feedback(
                bearer: credentials.token,
                cardID: pending.cardID,
                action: pending.action
            )
        } catch ProductError.serverCredentialExpired {
            try await identity.invalidateServerCredential()
            let credentials = try await identity.credentials()
            try await api.feedback(
                bearer: credentials.token,
                cardID: pending.cardID,
                action: pending.action
            )
        }
    }

    private func feedbackConfirmation(_ action: FeedbackAction) -> String {
        switch action {
        case .like: "记住了；以后质量接近时，会优先选择这类知识。"
        case .dislike: "记住了；以后质量接近时，会降低这类知识的优先级。"
        case .wrongObject: "已移除这张卡，并记录了识别错误。"
        case .tooPrivate: "已从本机卡片与缩略图中移除。"
        case .save: "已收藏。"
        }
    }

    #if DEBUG
    private func installDemoState() async throws {
        try? environment.widgetCoordinator.makeStore().clear()
        try await environment.repository.deleteLocalData()
        try await environment.repository.setOnboardingCompleted(true)
        try await environment.repository.setAutomaticDiscovery(false)
        if launchArguments.contains("-JianweiSeedEmpty") { return }
        let cards = Self.demoCards(modelKnowledge:
            launchArguments.contains("-JianweiOfflineUITest") &&
            launchArguments.contains("-JianweiSeedModelKnowledge")
        )
        for (card, image) in cards {
            try await installAutomaticDemoCard(card, image: image)
        }
        let today = ChinaDay.string(from: Date())
        try await environment.repository.savePreparation(DailyPreparationRecord(
            day: today,
            status: .ready,
            aiPhotoCount: 3,
            qualifiedCardIDs: cards.map { $0.0.id },
            selectedCardID: cards.first?.0.id,
            lastAttemptAt: Date()
        ))
    }

    private func installStoreDemoState() async throws {
        try? environment.widgetCoordinator.makeStore().clear()
        try await environment.repository.deleteLocalData()
        try await environment.repository.setOnboardingCompleted(true)
        try await environment.repository.setAutomaticDiscovery(false)
        let cards = Self.storeDemoCards()
        for (card, image) in cards {
            try await installAutomaticDemoCard(card, image: image)
        }
        let today = ChinaDay.string(from: Date())
        try await environment.repository.savePreparation(DailyPreparationRecord(
            day: today,
            status: .ready,
            aiPhotoCount: 3,
            qualifiedCardIDs: cards.map { $0.0.id },
            selectedCardID: cards.first?.0.id,
            lastAttemptAt: Date()
        ))
    }

    private func installAutomaticDemoCard(_ card: KnowledgeCard, image: Data) async throws {
        // Fixtures model automatic discovery, not manual import. Missing local
        // provenance otherwise deliberately excludes all three from the pool.
        let candidate = PhotoCandidateRecord(
            id: card.candidateToken, localIdentifier: "fixture-\(card.candidateToken)",
            capturedAt: nil, perceptualHash: nil, qualityScore: 1, localLabels: [],
            sensitiveFlags: [], state: card.isPublished ? .selected : .knowledgeReady,
            updatedAt: card.createdAt
        )
        try await environment.repository.upsert(candidate: candidate, card: card, sanitizedJPEG: image)
    }

    private static func storeDemoCards() -> [(KnowledgeCard, Data)] {
        let source = KnowledgeSource(
            id: "src-eff-printer-tracking-dots",
            title: "DocuColor Tracking Dot Decoding Guide",
            url: URL(string: "https://w2.eff.org/Privacy/printers/docucolor/")!,
            publisher: "Electronic Frontier Foundation",
            authority: "professional"
        )
        let printer = KnowledgeCard(
            id: UUID(uuidString: "30000000-0000-0000-0000-000000000001")!,
            candidateToken: UUID(uuidString: "40000000-0000-0000-0000-000000000001")!,
            topicID: "printer",
            factID: "printer-yellow-tracking-dots",
            title: "有些彩色打印机，会在彩色打印页上留下“隐形身份证”",
            objectName: "彩色打印机",
            body: "EFF 发现，部分施乐 DocuColor 会在每张彩色打印页反复铺上 15×8 黄色微点；白光下通常肉眼难见，却能编码打印机序列号及打印日期、时间。",
            personalContext: "在你最近拍下的办公用品里，这台打印机藏着一个肉眼很难发现的细节。",
            confidence: 0.96,
            boundingBox: nil,
            sources: [source],
            status: "scheduled",
            scheduledDay: ChinaDay.string(from: Date()),
            createdAt: Date()
        )
        let printerImage = UIImage(named: "StorePrinterDemo")?.jpegData(compressionQuality: 0.9)
            ?? demoImage(index: 0)
        return [(printer, printerImage)] + Array(demoCards().dropFirst())
    }

    private static func demoCards(modelKnowledge: Bool = false) -> [(KnowledgeCard, Data)] {
        let source = KnowledgeSource(
            id: "src-broom",
            title: "US4756039A: angled-cut bristle broom",
            url: URL(string: "https://patents.google.com/patent/US4756039A/en")!,
            publisher: "Google Patents",
            authority: "reference"
        )
        let facts = [
            (
                "扫帚刷毛做成斜扇形，是为了更贴近墙角",
                "有些扫帚把刷毛做成略带角度的扇形，让边缘更容易贴近墙角和家具边缘。",
                "在你最近拍下的清洁工具里，扫帚的形状很适合今天聊聊。",
                "broom-001"
            ),
            (
                "斜切刷毛不只贴地更稳，也会磨得更均匀",
                "斜切扫帚的毛端会形成与手柄斜交的平面，使用时整条扫面更容易均匀贴地，也能让刷毛磨损得更均匀。",
                "来自同一张日常照片的另一个设计细节。",
                "broom-draft-002"
            ),
            (
                "有些扫帚让软毛扫地，硬毛专攻墙角",
                "一种扫帚设计让大部分柔软刷毛负责普通地面，再在一端加入少量硬刷毛，用来处理墙角、边缘和较顽固的污物。",
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
                sources: modelKnowledge ? [] : [source],
                status: index == 0 ? "scheduled" : "candidate",
                scheduledDay: ChinaDay.string(from: start),
                createdAt: Date(),
                evidenceKind: modelKnowledge ? .modelKnowledge : nil
            )
            return (card, demoImage(index: index))
        }
    }

    private static func demoImage(index: Int) -> Data {
        // The second fixture is deliberately panoramic so the daily card and
        // review rows continuously exercise the wide-photo containment path.
        let size = index == 1
            ? CGSize(width: 1800, height: 450)
            : CGSize(width: 900, height: 1200)
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
            cg.fillEllipse(in: CGRect(
                x: size.width * 0.12,
                y: size.height * 0.80,
                width: size.width * 0.72,
                height: size.height * 0.08
            ))
            cg.saveGState()
            cg.translateBy(x: CGFloat(20 * index), y: 0)
            cg.setStrokeColor(UIColor(red: 0.30, green: 0.22, blue: 0.15, alpha: 1).cgColor)
            cg.setLineWidth(max(18, size.width * 0.038))
            cg.setLineCap(.round)
            cg.move(to: CGPoint(x: size.width * 0.68, y: size.height * 0.10))
            cg.addLine(to: CGPoint(x: size.width * 0.43, y: size.height * 0.69))
            cg.strokePath()
            cg.setFillColor(UIColor(red: 0.21, green: 0.36, blue: 0.29, alpha: 1).cgColor)
            let head = UIBezierPath()
            head.move(to: CGPoint(x: size.width * 0.34, y: size.height * 0.66))
            head.addLine(to: CGPoint(x: size.width * 0.60, y: size.height * 0.71))
            head.addLine(to: CGPoint(x: size.width * 0.54, y: size.height * 0.85))
            head.addLine(to: CGPoint(x: size.width * 0.24, y: size.height * 0.78))
            head.close()
            head.fill()
            cg.restoreGState()
        }
    }
    #endif
}

struct CardDeepLinkLaunchBuffer {
    private var pendingCardID: UUID?

    mutating func receive(url: URL, isReady: Bool) -> UUID? {
        guard url.scheme == "jianwei", url.host == "card",
              let id = UUID(uuidString: url.lastPathComponent) else { return nil }
        guard isReady else {
            pendingCardID = id
            return nil
        }
        return id
    }

    mutating func appBecameReady() -> UUID? {
        defer { pendingCardID = nil }
        return pendingCardID
    }
}
