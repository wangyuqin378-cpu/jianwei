import BackgroundTasks
import CryptoKit
import Foundation
import WidgetKit

struct AppEnvironment: Sendable {
    let repository: LocalRepository
    let discovery: PhotoDiscoveryService
    let pipeline: AnalysisPipeline?
    let api: APIClient?
    let identity: DeviceIdentityStore?
    let modelAccessStore: AIModelAccessStore
    let subscriptionStore: SubscriptionStore
    let widgetCoordinator: WidgetCoordinator

    var serviceConfigured: Bool { pipeline != nil && api != nil && identity != nil }

    @MainActor
    static func live() throws -> AppEnvironment {
        let repository = try LocalRepository()
        let discovery = PhotoDiscoveryService()
        let widgetCoordinator = WidgetCoordinator(repository: repository)
        let modelAccessStore = AIModelAccessStore()
        let subscriptionStore = SubscriptionStore()
        let configuredBaseURL: String
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-JianweiAuthorizedFixtureE2E") {
            configuredBaseURL = "http://127.0.0.1:8787"
        } else {
            configuredBaseURL = Bundle.main.object(forInfoDictionaryKey: "JianweiAPIBaseURL") as? String ?? ""
        }
        #else
        configuredBaseURL = Bundle.main.object(forInfoDictionaryKey: "JianweiAPIBaseURL") as? String ?? ""
        #endif
        guard
            !configuredBaseURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
            let baseURL = URL(string: configuredBaseURL),
            let api = try? APIClient(baseURL: baseURL)
        else {
            return AppEnvironment(
                repository: repository,
                discovery: discovery,
                pipeline: nil,
                api: nil,
                identity: nil,
                modelAccessStore: modelAccessStore,
                subscriptionStore: subscriptionStore,
                widgetCoordinator: widgetCoordinator
            )
        }
        let identity = DeviceIdentityStore(api: api)
        let analyzer: PhotoPrivacyAnalyzer
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-JianweiAuthorizedFixtureE2E") {
            // iOS 26.5 Simulator cannot create the mandatory Vision inference
            // context. This explicit Debug-only seam keeps the authorized fixture
            // journey repeatable without weakening the Release privacy gate.
            analyzer = PhotoPrivacyAnalyzer(testingObservations: .authorizedFixtureSafe)
        } else {
            analyzer = PhotoPrivacyAnalyzer()
        }
        #else
        analyzer = PhotoPrivacyAnalyzer()
        #endif
        return AppEnvironment(
            repository: repository,
            discovery: discovery,
            pipeline: AnalysisPipeline(
                api: api,
                identity: identity,
                analyzer: analyzer,
                modelAccessStore: modelAccessStore,
                subscriptionStore: subscriptionStore,
                repository: repository
            ),
            api: api,
            identity: identity,
            modelAccessStore: modelAccessStore,
            subscriptionStore: subscriptionStore,
            widgetCoordinator: widgetCoordinator
        )
    }
}

struct DiscoveryRunSummary: Sendable {
    let inspected: Int
    let cardsCreated: Int
    let filtered: Int
    let failed: Int
    let accessError: ProductError?
}

actor AutomaticDiscoveryRunner {
    private let environment: AppEnvironment

    init(environment: AppEnvironment) {
        self.environment = environment
    }

    func run(maximumCandidates: Int) async -> DiscoveryRunSummary {
        guard maximumCandidates > 0, let pipeline = environment.pipeline else {
            return DiscoveryRunSummary(inspected: 0, cardsCreated: 0, filtered: 0, failed: 0, accessError: nil)
        }
        do {
            _ = try await pipeline.preflightModelAccess()
        } catch let error as ProductError where error.requiresModelAccessAction {
            return DiscoveryRunSummary(inspected: 0, cardsCreated: 0, filtered: 0, failed: 0, accessError: error)
        } catch {
            return DiscoveryRunSummary(inspected: 0, cardsCreated: 0, filtered: 0, failed: 1, accessError: nil)
        }
        let access = await environment.discovery.authorizationState()
        guard access == .full || access == .limited else {
            return DiscoveryRunSummary(inspected: 0, cardsCreated: 0, filtered: 0, failed: 0, accessError: nil)
        }

        var state = await environment.repository.snapshot()
        guard state.automaticDiscoveryEnabled else {
            return DiscoveryRunSummary(inspected: 0, cardsCreated: 0, filtered: 0, failed: 0, accessError: nil)
        }
        let today = ChinaDay.string(from: Date())
        guard state.lastDailySelectionDay != today else {
            return DiscoveryRunSummary(inspected: 0, cardsCreated: 0, filtered: 0, failed: 0, accessError: nil)
        }
        var inspected = 0
        var completedAnalyses = 0
        var cardsCreated = 0
        var generatedCards: [KnowledgeCard] = []
        var filtered = 0
        var failed = 0

        for candidate in state.candidates where candidate.state == .failed {
            guard completedAnalyses < maximumCandidates else { break }
            guard let jpeg = await environment.repository.imageData(candidateToken: candidate.id) else { continue }
            inspected += 1
            do {
                let result = try await pipeline.retry(candidate: candidate, sanitizedJPEG: jpeg)
                try await persist(result)
                completedAnalyses += 1
                if result.card == nil { filtered += 1 } else { cardsCreated += 1 }
                if let card = result.card { generatedCards.append(card) }
            } catch let error as PipelineFailure {
                try? await persist(error)
                failed += 1
            } catch {
                failed += 1
            }
        }

        let assets: [PhotoAssetReference]
        do {
            assets = try await environment.discovery.recentAssets(days: 90, limit: 500)
        } catch {
            return DiscoveryRunSummary(
                inspected: inspected,
                cardsCreated: cardsCreated,
                filtered: filtered,
                failed: failed + 1,
                accessError: nil
            )
        }
        state = await environment.repository.snapshot()
        let knownLocalIDs = Set(state.candidates.compactMap(\.localIdentifier))
        var hashes = Set(state.candidates.compactMap(\.perceptualHash))
        let unseenAssets = Self.dailyOrder(
            assets.filter { !knownLocalIDs.contains($0.localIdentifier) },
            day: today
        )
        let inspectionLimit = max(maximumCandidates, maximumCandidates * 4)
        for asset in unseenAssets {
            guard completedAnalyses < maximumCandidates,
                  inspected < inspectionLimit,
                  !Task.isCancelled else { break }
            inspected += 1
            do {
                let source = try await environment.discovery.imageData(for: asset)
                let result = try await pipeline.analyze(
                    sourceData: source,
                    localIdentifier: asset.localIdentifier,
                    capturedAt: asset.capturedAt,
                    initialFlags: asset.isScreenshot ? ["screenshot"] : [],
                    existingHashes: hashes
                )
                if let hash = result.candidate.perceptualHash { hashes.insert(hash) }
                try await persist(result)
                completedAnalyses += 1
                if result.card == nil { filtered += 1 } else { cardsCreated += 1 }
                if let card = result.card { generatedCards.append(card) }
            } catch let rejection as PipelineRejection {
                try? await environment.repository.upsert(candidate: rejection.candidate)
                filtered += 1
            } catch let error as PipelineFailure {
                try? await persist(error)
                failed += 1
            } catch {
                failed += 1
            }
        }
        if generatedCards.count > 1 {
            let selectedID = await selectDailyWinner(from: generatedCards)
            for card in generatedCards where card.id != selectedID {
                try? await environment.repository.discardUnselectedCard(card)
            }
            cardsCreated = 1
        }
        if failed == 0, completedAnalyses > 0 {
            try? await environment.repository.markDailySelection(day: today, scannedAt: Date())
        } else {
            try? await environment.repository.markScan(at: Date())
        }
        let updated = await environment.repository.snapshot()
        try? await environment.widgetCoordinator.synchronize(cards: updated.cards)
        return DiscoveryRunSummary(
            inspected: inspected,
            cardsCreated: cardsCreated,
            filtered: filtered,
            failed: failed,
            accessError: nil
        )
    }

    private func selectDailyWinner(from cards: [KnowledgeCard]) async -> UUID {
        let localFallback = cards.sorted {
            $0.confidence > $1.confidence || ($0.confidence == $1.confidence && $0.id.uuidString < $1.id.uuidString)
        }.first!.id
        guard let api = environment.api, let identity = environment.identity else { return localFallback }
        do {
            let state = await environment.repository.snapshot()
            let transaction = state.modelAccessMode == .managed
                ? await environment.subscriptionStore.entitlementJWS()
                : nil
            let access = try await environment.modelAccessStore.request(
                for: state.modelAccessMode,
                managedTransaction: transaction
            )
            let credentials = try await identity.credentials()
            return try await api.selectDailyCard(
                bearer: credentials.token,
                cardIDs: cards.map(\.id),
                modelAccess: access
            )
        } catch {
            return localFallback
        }
    }

    private static func dailyOrder(_ assets: [PhotoAssetReference], day: String) -> [PhotoAssetReference] {
        assets.sorted { lhs, rhs in
            let left = SHA256.hash(data: Data((day + "\0" + lhs.localIdentifier).utf8))
            let right = SHA256.hash(data: Data((day + "\0" + rhs.localIdentifier).utf8))
            return left.lexicographicallyPrecedes(right)
        }
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
}

enum BackgroundDiscoveryController {
    static func register(environment: AppEnvironment) {
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: SharedConstants.discoveryTaskIdentifier,
            using: nil
        ) { task in
            guard let processingTask = task as? BGProcessingTask else {
                task.setTaskCompleted(success: false)
                return
            }
            let handle = BackgroundProcessingTaskHandle(processingTask)
            let work = Task {
                let maximum = 3
                let summary = await AutomaticDiscoveryRunner(environment: environment)
                    .run(maximumCandidates: maximum)
                handle.complete(success: summary.failed == 0)
                try? schedule()
            }
            handle.setExpirationHandler { work.cancel() }
        }
    }

    static func schedule() throws {
        let request = BGProcessingTaskRequest(identifier: SharedConstants.discoveryTaskIdentifier)
        request.requiresNetworkConnectivity = true
        request.requiresExternalPower = false
        request.earliestBeginDate = Date(timeIntervalSinceNow: 6 * 60 * 60)
        try BGTaskScheduler.shared.submit(request)
    }
}

private final class BackgroundProcessingTaskHandle: @unchecked Sendable {
    private let task: BGProcessingTask

    init(_ task: BGProcessingTask) {
        self.task = task
    }

    func setExpirationHandler(_ handler: @escaping @Sendable () -> Void) {
        task.expirationHandler = handler
    }

    func complete(success: Bool) {
        task.setTaskCompleted(success: success)
    }
}
