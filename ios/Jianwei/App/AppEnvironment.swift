import BackgroundTasks
import CryptoKit
import Foundation
@preconcurrency import Photos
import WidgetKit

struct AppEnvironment: Sendable {
    let repository: LocalRepository
    let discovery: PhotoDiscoveryService
    let pipeline: AnalysisPipeline
    let api: APIClient?
    let identity: DeviceIdentityStore?
    let modelAccessStore: AIModelAccessStore
    let subscriptionStore: any ManagedSubscriptionServing
    let widgetCoordinator: WidgetCoordinator
    let deviceBetaExperienceEnabled: Bool

    var managedServiceConfigured: Bool { api != nil && identity != nil }

    @MainActor
    static func live() throws -> AppEnvironment {
        let repository = try LocalRepository()
        let discovery = PhotoDiscoveryService()
        let widgetCoordinator = WidgetCoordinator(repository: repository)
        let modelAccessStore = AIModelAccessStore()
        let subscriptionStore = SubscriptionStore()
        let knowledgeCatalog = try BundledKnowledgeCatalog.load()
        let directQwen: DirectQwenService
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-JianweiOfflineUITest") {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.protocolClasses = [OfflineUIURLProtocol.self]
            directQwen = try DirectQwenService(session: URLSession(configuration: configuration))
        } else {
            directQwen = try DirectQwenService()
        }
        #else
        directQwen = try DirectQwenService()
        #endif
        let deviceBetaExperienceEnabled = DeviceBetaExperience.isEnabled(
            rawValue: Bundle.main.object(forInfoDictionaryKey: "JianweiDeviceBetaExperience")
        )
        let bundledBaseURL = Bundle.main.object(forInfoDictionaryKey: "JianweiAPIBaseURL") as? String ?? ""
        let configuredBaseURL: String
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-JianweiOfflineUITest") {
            // Isolated UI journeys must not contact the bundled live gateway.
            configuredBaseURL = ""
        } else if ProcessInfo.processInfo.arguments.contains("-JianweiAuthorizedFixtureE2E"),
           bundledBaseURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            configuredBaseURL = "http://127.0.0.1:8787"
        } else {
            configuredBaseURL = bundledBaseURL
        }
        #else
        configuredBaseURL = bundledBaseURL
        #endif
        let api = configuredBaseURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? nil
            : URL(string: configuredBaseURL).flatMap {
                try? APIClient(baseURL: $0, allowsLocalHTTP: deviceBetaExperienceEnabled)
            }
        let identity = api.map { DeviceIdentityStore(api: $0, recoveryTransaction: {
            await subscriptionStore.entitlementJWS()
        }) }
        let managedQwen = try api.map {
            try DirectQwenService(
                baseURL: $0.baseURL.appendingPathComponent("v1/qwen"),
                authorizationPolicy: .deviceBearer
            )
        }
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
                repository: repository,
                directQwen: directQwen,
                managedQwen: managedQwen,
                knowledgeCatalog: knowledgeCatalog,
                allowsMissingManagedTransaction: deviceBetaExperienceEnabled
            ),
            api: api,
            identity: identity,
            modelAccessStore: modelAccessStore,
            subscriptionStore: subscriptionStore,
            widgetCoordinator: widgetCoordinator,
            deviceBetaExperienceEnabled: deviceBetaExperienceEnabled
        )
    }
}

#if DEBUG
/// Offline UI journeys must fail locally, never spend money or send a photo.
private final class OfflineUIURLProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
    }
    override func stopLoading() {}
}

/// Only the explicitly seeded empty UI journey uses this source. PhotoKit's
/// actual authorization is still checked by the runner before reading it.
struct EmptyUIPhotoSource: AutomaticPhotoSource {
    func recentAssets(days: Int, limit: Int, excludingLocalIdentifiers: Set<String>) async throws -> [PhotoAssetReference] { [] }
    func imageData(for reference: PhotoAssetReference) async throws -> Data {
        throw ProductError.photoUnavailable
    }
}
#endif

enum AppLaunchPolicy {
    static func isReadOnlyStateProbe(arguments: [String] = ProcessInfo.processInfo.arguments) -> Bool {
        #if DEBUG
        arguments.contains("-JianweiReadOnlyStateProbe")
        #else
        false
        #endif
    }
}

enum DeviceBetaExperience {
    static func isEnabled(rawValue: Any?) -> Bool {
        guard let value = rawValue as? String else { return false }
        return ["1", "true", "yes"].contains(
            value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        )
    }
}

struct DiscoveryRunSummary: Sendable {
    let inspected: Int
    let analyzed: Int
    let cardsCreated: Int
    let knowledgeReady: Int
    let exhausted: Int
    let filtered: Int
    let failed: Int
    let accessError: ProductError?
}

/// One lifetime for an automatic run, including all of its suspended work.
/// Cancellation is sticky, even if the preference is immediately enabled again.
final class AutomaticDiscoveryRun: @unchecked Sendable {
    private let lock = NSLock()
    private var cancelled = false
    private var authorizationRevoked = false
    private var cancellationHandler: (@Sendable () -> Void)?
    private let authorizationCheck: @Sendable (String?) -> Bool

    init(authorizationCheck: @escaping @Sendable (String?) -> Bool) {
        self.authorizationCheck = authorizationCheck
    }

    func installCancellationHandler(_ handler: @escaping @Sendable () -> Void) {
        let cancelNow = lock.withLock {
            if cancelled { return true }
            cancellationHandler = handler
            return false
        }
        if cancelNow { handler() }
    }

    func cancel() {
        let handler = lock.withLock {
            cancelled = true
            let handler = cancellationHandler
            cancellationHandler = nil
            return handler
        }
        handler?()
    }

    func check(localIdentifier: String? = nil) throws {
        if lock.withLock({ authorizationRevoked }) { throw ProductError.permissionDenied }
        try Task.checkCancellation()
        guard !lock.withLock({ cancelled }) else { throw CancellationError() }
        guard authorizationCheck(localIdentifier) else {
            // Removing one item from Limited Photos is not revoking the entire
            // library. Reject that asset without disabling other authorized work.
            if localIdentifier != nil && authorizationCheck(nil) {
                throw ProductError.photoUnavailable
            }
            lock.withLock { authorizationRevoked = true }
            cancel()
            throw ProductError.permissionDenied
        }
        try Task.checkCancellation()
        guard !lock.withLock({ cancelled }) else { throw CancellationError() }
    }

    func commitWidget(_ write: () throws -> Void) throws {
        try check()
        // Serialize the final synchronous cache write with invalidation. A
        // deletion after cancel() returns can never be undone by this writer.
        try lock.withLock {
            guard !cancelled else { throw CancellationError() }
            try write()
        }
    }

    static func hasPhotoAccess(localIdentifier: String?) -> Bool {
        let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        guard status == .authorized || status == .limited else { return false }
        guard let localIdentifier else { return true }
        // Limited access can remove just this asset while retaining permission.
        return PHAsset.fetchAssets(withLocalIdentifiers: [localIdentifier], options: nil).count == 1
    }
}

actor AutomaticDiscoveryRunner {
    private let environment: AppEnvironment
    private let authorizationCheck: @Sendable (String?) -> Bool
    private let widgetStore: SharedWidgetStore?
    private let photoSource: any AutomaticPhotoSource
    private let isReadOnlyStateProbe: Bool

    init(
        environment: AppEnvironment,
        authorizationCheck: @escaping @Sendable (String?) -> Bool = AutomaticDiscoveryRun.hasPhotoAccess,
        widgetStore: SharedWidgetStore? = nil,
        photoSource: (any AutomaticPhotoSource)? = nil,
        launchArguments: [String] = ProcessInfo.processInfo.arguments
    ) {
        self.environment = environment
        self.authorizationCheck = authorizationCheck
        self.widgetStore = widgetStore
        self.photoSource = photoSource ?? environment.discovery
        self.isReadOnlyStateProbe = AppLaunchPolicy.isReadOnlyStateProbe(arguments: launchArguments)
    }

    func run(
        maximumCandidates: Int,
        ignoreDailySelection: Bool = false,
        lookbackDays: Int = 90,
        targetDay: String? = nil
    ) async -> DiscoveryRunSummary {
        await withAutomaticRun { run in
            try await self.runExclusively(
                maximumCandidates: maximumCandidates,
                ignoreDailySelection: ignoreDailySelection,
                lookbackDays: lookbackDays,
                targetDay: targetDay,
                run: run
            )
        }
    }

    /// Both foreground and background spend one bounded opportunity on the
    /// rolling queue. A single lease also prevents two refill loops interleaving.
    func replenishRollingWindow(
        maximumCandidates: Int,
        didPrepare: @escaping @Sendable (DiscoveryRunSummary) async -> Void = { _ in }
    ) async -> DiscoveryRunSummary {
        await withAutomaticRun { run in
            let repository = self.environment.repository
            _ = try await repository.recoverPrematureEmptyPreparation(now: Date(), discoveryRun: run)
            let maximum = min(Self.foregroundRefillPhotoLimit, max(0, maximumCandidates))
            var aggregate = Self.emptySummary()
            for _ in 0..<Self.rollingCacheDayCount {
                if Task.isCancelled { break }
                let remaining = maximum - aggregate.analyzed
                guard remaining > 0 else { break }
                let state = await repository.snapshot()
                let day = BackgroundDiscoveryController.nextPreparationDay(state: state, now: Date())
                guard state.dailyPreparations[day]?.status.isFinal != true else { break }
                let next: DiscoveryRunSummary
                do {
                    next = try await self.runExclusively(
                        maximumCandidates: min(remaining, Self.remainingCloudPhotoBudget(
                            previous: state.dailyPreparations[day]?.aiPhotoCount ?? 0)),
                        ignoreDailySelection: false, lookbackDays: 90, targetDay: day, run: run
                    )
                } catch is CancellationError {
                    break
                } catch let error as ProductError {
                    if error == .permissionDenied { try? await repository.setAutomaticDiscovery(false) }
                    next = Self.emptySummary(failed: 1, accessError: error)
                } catch {
                    next = Self.emptySummary(failed: 1, accessError: .localStorageUnavailable)
                }
                aggregate = DiscoveryRunSummary(
                    inspected: aggregate.inspected + next.inspected,
                    analyzed: aggregate.analyzed + next.analyzed,
                    cardsCreated: aggregate.cardsCreated + next.cardsCreated,
                    knowledgeReady: aggregate.knowledgeReady + next.knowledgeReady,
                    exhausted: aggregate.exhausted + next.exhausted,
                    filtered: aggregate.filtered + next.filtered,
                    failed: aggregate.failed + next.failed,
                    accessError: next.accessError ?? aggregate.accessError
                )
                // Deliver the first card immediately; do not hold the home UI
                // until the rest of the week's photos finish.
                await didPrepare(next)
                let updated = await repository.snapshot()
                if next.accessError != nil || next.failed > 0 {
                    if next.accessError != .knowledgeSourceUnavailable || updated.dailyPreparations[day]?.status != .ready { break }
                }
                if updated.dailyPreparations[day]?.status == .waitingForPhotos { break }
            }
            return aggregate
        }
    }

    static let rollingCacheDayCount = 7
    // Give each missing date its existing allowance, even when a good card
    // appears only on the ninth photo. Stop rules still end the opportunity
    // on no new card, lack of photos, access/service errors or cancellation.
    static let foregroundRefillPhotoLimit = rollingCacheDayCount * dailyCloudPhotoLimit
    static let backgroundRefillPhotoLimit = 9

    private func withAutomaticRun(
        _ operation: @escaping @Sendable (AutomaticDiscoveryRun) async throws -> DiscoveryRunSummary
    ) async -> DiscoveryRunSummary {
        // The system can launch discovery without going through AppModel.start.
        // A device-state probe must not acquire a run, read Photos or spend AI.
        guard !isReadOnlyStateProbe else { return Self.emptySummary() }
        guard let run = await environment.repository.acquireAutomaticDiscoveryRun(
            authorizationCheck: authorizationCheck
        ) else { return Self.emptySummary() }
        let work = Task {
            do {
                // A prior run may have committed its card before the shared
                // cache write failed or iOS suspended it. Repair that projection
                // even when every day is ready or no AI budget remains.
                try await self.synchronizeWidget(run: run)
                return try await operation(run)
            } catch is CancellationError {
                return Self.emptySummary()
            } catch let error as ProductError {
                if error == .permissionDenied {
                    try? await self.environment.repository.setAutomaticDiscovery(false)
                }
                return Self.emptySummary(failed: 1, accessError: error)
            } catch {
                return Self.emptySummary(failed: 1, accessError: .localStorageUnavailable)
            }
        }
        run.installCancellationHandler { work.cancel() }
        let summary = await withTaskCancellationHandler {
            await work.value
        } onCancel: {
            run.cancel()
        }
        await environment.repository.endAutomaticDiscoveryRun(run)
        return summary
    }

    private static func emptySummary(failed: Int = 0, accessError: ProductError? = nil) -> DiscoveryRunSummary {
        DiscoveryRunSummary(inspected: 0, analyzed: 0, cardsCreated: 0, knowledgeReady: 0,
                            exhausted: 0, filtered: 0, failed: failed, accessError: accessError)
    }

    private func runExclusively(
        maximumCandidates: Int,
        ignoreDailySelection: Bool,
        lookbackDays: Int,
        targetDay: String?,
        run: AutomaticDiscoveryRun
    ) async throws -> DiscoveryRunSummary {
        try run.check()
        let repository = environment.repository
        let pipeline = environment.pipeline
        _ = try await pipeline.prepareKnowledgeCatalog(discoveryRun: run)
        try run.check()
        _ = try await repository.recoverPrematureEmptyPreparation(now: Date(), discoveryRun: run)
        var state = await repository.snapshot()
        let day = targetDay ?? ChinaDay.string(from: Date())
        guard ignoreDailySelection || state.dailyPreparations[day]?.status.isFinal != true else {
            return Self.emptySummary()
        }
        let existingPreparation = state.dailyPreparations[day]
        let previousInspected = max(0, existingPreparation?.inspectedPhotoCount ?? 0)
        let previousAIPhotoCount = max(0, existingPreparation?.aiPhotoCount ?? 0)
        let runLimit = min(max(0, maximumCandidates), Self.remainingCloudPhotoBudget(previous: previousAIPhotoCount))
        let inspectionLimit = Self.remainingInspectionBudget(previous: previousInspected)
        var inspected = 0
        var attemptedAnalyses = 0
        var generatedCards: [KnowledgeCard] = []
        var exhausted = 0
        var filtered = 0
        var failed = 0
        var blockingFailures = 0
        var firstFailureError: ProductError?
        var retriedLocalIDs = Set<String>()
        var pool = Self.selectionPool(
            newCards: [],
            carryOverCards: Self.carryOverCards(cards: state.cards, candidates: state.candidates)
        )
        if Self.canInspectMore(inspected: inspected, inspectionLimit: inspectionLimit,
                               analyzed: attemptedAnalyses, runLimit: runLimit, poolCount: pool.count) {
            do {
                _ = try await pipeline.preflightModelAccess()
            } catch let error as ProductError where !pool.isEmpty && Self.canSelectCachedCard(after: error) {
                // Credentials are needed for new AI work, not for publishing
                // cards that have already passed the knowledge checks.
                firstFailureError = error
                failed += 1
                blockingFailures = Self.automaticFailureLimit
            }
            try run.check()
        }
        // Zero remaining budget still reaches selection/finalization. In
        // particular, a suspended ninth upload must not leave .preparing forever.
        try await repository.savePreparation(DailyPreparationRecord(
            day: day, status: .preparing,
            inspectedPhotoCount: previousInspected, aiPhotoCount: previousAIPhotoCount,
            qualifiedCardIDs: pool.map(\.id),
            selectedCardID: existingPreparation?.selectedCardID,
            lastAttemptAt: Date()
        ), discoveryRun: run)

        let failedCandidates = state.candidates
            .filter {
                $0.hasPendingManagedDispatch ? state.modelAccessMode == .managed : $0.state == .failed
            }
            .sorted {
                if $0.hasPendingManagedDispatch != $1.hasPendingManagedDispatch { return $0.hasPendingManagedDispatch }
                return $0.updatedAt < $1.updatedAt
            }
            .prefix(Self.dailyInspectionLimit)
        let retryLimit = Self.automaticRetryLimit(maximumCandidates: maximumCandidates)
        var retriedCandidateCount = 0
        var resumedCandidateCount = 0
        var unavailableRetryIDs = Set<UUID>()
        for candidate in failedCandidates {
            let resumesReservedPhoto = candidate.hasPendingManagedDispatch &&
                candidate.managedDispatch.map { dispatch in
                    dispatch.isReplayable(at: Date()) &&
                        state.dailyPreparations[dispatch.day]?.cloudPhotoReservationIDs?.contains(dispatch.reservationID) == true
                } == true
            guard blockingFailures < Self.automaticFailureLimit, pool.count < 3 else { break }
            if resumesReservedPhoto {
                guard resumedCandidateCount < Self.dailyCloudPhotoLimit else { break }
            } else {
                guard retriedCandidateCount < retryLimit,
                      Self.canInspectMore(inspected: inspected, inspectionLimit: inspectionLimit,
                                          analyzed: attemptedAnalyses, runLimit: runLimit, poolCount: pool.count) else { continue }
            }
            do { try run.check(localIdentifier: candidate.localIdentifier) }
            catch let error as ProductError where error == .photoUnavailable {
                try await repository.removeImage(candidateToken: candidate.id, discoveryRun: run)
                unavailableRetryIDs.insert(candidate.id)
                if let identifier = candidate.localIdentifier { retriedLocalIDs.insert(identifier) }
                continue
            }
            guard let jpeg = await repository.imageData(candidateToken: candidate.id) else {
                unavailableRetryIDs.insert(candidate.id)
                continue
            }
            // Missing bytes or individual photo access cannot consume a usable
            // retry slot. Real inspections/uploads retain their existing limits.
            if resumesReservedPhoto {
                // This photo already consumed an inspection and a cloud slot.
                // Recover it even when it was the interrupted ninth request.
                resumedCandidateCount += 1
            } else {
                retriedCandidateCount += 1
                try await repository.reserveDiscoveryInspection(day: day, run: run)
                inspected += 1
            }
            if let identifier = candidate.localIdentifier { retriedLocalIDs.insert(identifier) }
            let attempt = try await process(run: run) {
                try await pipeline.retry(candidate: candidate, sanitizedJPEG: jpeg, targetDay: day, discoveryRun: run)
            }
            switch attempt {
            case .result(let result):
                if let card = result.card { generatedCards.append(card) } else { exhausted += 1 }
            case .filtered: filtered += 1
            case .failed(let error):
                failed += 1
                if error != .knowledgeSourceUnavailable { blockingFailures += 1 }
                if firstFailureError == nil || error != .knowledgeSourceUnavailable { firstFailureError = error }
            }
            state = await repository.snapshot()
            attemptedAnalyses = max(0, (state.dailyPreparations[day]?.aiPhotoCount ?? previousAIPhotoCount) - previousAIPhotoCount)
            pool = Self.selectionPool(newCards: generatedCards, carryOverCards: Self.carryOverCards(cards: state.cards, candidates: state.candidates))
        }
        // Rotate skipped metadata in one write, so even a longer unavailable
        // prefix cannot starve valid retries on subsequent runs or after restart.
        try await repository.deferUnavailableFailedCandidates(candidateIDs: unavailableRetryIDs, discoveryRun: run)

        // Do not even query the library when carryover already fills the pool.
        if blockingFailures < Self.automaticFailureLimit,
           Self.canInspectMore(inspected: inspected, inspectionLimit: inspectionLimit,
                               analyzed: attemptedAnalyses, runLimit: runLimit, poolCount: pool.count) {
            try run.check()
            let assets = try await photoSource.recentAssets(
                days: lookbackDays, limit: 500,
                excludingLocalIdentifiers: state.processedLocalIdentifiers.union(retriedLocalIDs)
            )
            try run.check()
            state = await repository.snapshot()
            var hashes = Set(state.candidates.compactMap(\.perceptualHash))
            let unseenAssets = Self.dailyOrder(
                Self.unprocessedAssets(assets, state: state, retriedLocalIDs: retriedLocalIDs), day: day
            )
            for asset in unseenAssets {
                guard blockingFailures < Self.automaticFailureLimit,
                      Self.canInspectMore(inspected: inspected, inspectionLimit: inspectionLimit,
                                          analyzed: attemptedAnalyses, runLimit: runLimit, poolCount: pool.count) else { break }
                do { try run.check(localIdentifier: asset.localIdentifier) }
                catch let error as ProductError where error == .photoUnavailable { continue }
                try await repository.reserveDiscoveryInspection(day: day, run: run)
                inspected += 1
                let existingHashes = hashes
                let discovery = photoSource
                let attempt = try await process(run: run) {
                    let source = try await discovery.imageData(for: asset)
                    try run.check(localIdentifier: asset.localIdentifier)
                    return try await pipeline.analyze(
                        sourceData: source, localIdentifier: asset.localIdentifier, capturedAt: asset.capturedAt,
                        initialFlags: asset.isScreenshot ? ["screenshot"] : [], existingHashes: existingHashes,
                        targetDay: day, discoveryRun: run
                    )
                }
                switch attempt {
                case .result(let result):
                    if let hash = result.candidate.perceptualHash { hashes.insert(hash) }
                    if let card = result.card { generatedCards.append(card) } else { exhausted += 1 }
                case .filtered: filtered += 1
                case .failed(let error):
                    failed += 1
                    if error != .knowledgeSourceUnavailable { blockingFailures += 1 }
                    if firstFailureError == nil || error != .knowledgeSourceUnavailable { firstFailureError = error }
                }
                state = await repository.snapshot()
                attemptedAnalyses = max(0, (state.dailyPreparations[day]?.aiPhotoCount ?? previousAIPhotoCount) - previousAIPhotoCount)
                pool = Self.selectionPool(newCards: generatedCards, carryOverCards: Self.carryOverCards(cards: state.cards, candidates: state.candidates))
            }
        }

        try run.check()
        state = await repository.snapshot()
        pool = try Self.availableSelectionPool(pool, state: state, run: run)
        var selectedID: UUID?
        var selectionError: ProductError?
        // Do not follow a known service failure with another paid selection.
        if !pool.isEmpty && blockingFailures == 0 {
            do {
                selectedID = try await pipeline.selectDailyWinner(from: pool, day: day, discoveryRun: run)
                if selectedID == nil { selectionError = .invalidServerResponse }
            } catch is CancellationError {
                throw CancellationError()
            } catch let error as ProductError {
                if error == .permissionDenied { throw error }
                selectionError = error
            } catch {
                selectionError = .requestFailed(-1)
            }
        }
        // Selection can ignore cancellation or return nil after a long await.
        // Neither result is allowed to recreate a deleted preparation or widget.
        try run.check()
        state = await repository.snapshot()
        pool = try Self.availableSelectionPool(pool, state: state, run: run)
        if let winner = selectedID, !pool.contains(where: { $0.id == winner }) {
            selectedID = nil
            selectionError = .invalidServerResponse
        }
        let preparationError = selectionError ?? firstFailureError
        if selectedID == nil, let preparationError, Self.canSelectCachedCard(after: preparationError) {
            selectedID = Self.localFallbackCardID(from: pool, state: state)
        }
        try run.check()
        let cumulativeInspected = previousInspected + inspected
        let cumulativeAIPhotoCount = Self.reconciledCloudPhotoCount(
            previous: previousAIPhotoCount, current: attemptedAnalyses, failure: firstFailureError
        )
        let hasUnfinishedDispatch = state.modelAccessMode == .managed && state.candidates.contains {
            $0.hasPendingManagedDispatch && $0.managedDispatch?.day == day &&
                $0.managedDispatch?.isReplayable(at: Date()) == true && !unavailableRetryIDs.contains($0.id)
        }
        let shouldFinalize = (selectedID != nil || !hasUnfinishedDispatch) && Self.shouldFinalizeDailySelection(
            completedAnalyses: cumulativeAIPhotoCount, maximumCandidates: Self.dailyCloudPhotoLimit,
            selectionPool: pool, selectedCardID: selectedID,
            inspectedPhotos: cumulativeInspected
        )
        if shouldFinalize {
            try await repository.finalizeDailySelection(
                day: day, selectedCardID: selectedID, candidateIDs: Self.selectionCandidateIDs(pool),
                inspectedPhotoCount: cumulativeInspected, aiPhotoCount: cumulativeAIPhotoCount,
                scannedAt: Date(), discoveryRun: run
            )
        } else {
            let status: DailyPreparationStatus
            if preparationError?.requiresModelAccessAction == true {
                status = .waitingForAccess
            } else if preparationError != nil {
                status = .retryableFailure
            } else if inspected < inspectionLimit && attemptedAnalyses < runLimit {
                status = .waitingForPhotos
            } else {
                status = .queued
            }
            try await repository.savePreparation(DailyPreparationRecord(
                day: day, status: status, inspectedPhotoCount: cumulativeInspected,
                aiPhotoCount: cumulativeAIPhotoCount, qualifiedCardIDs: pool.map(\.id),
                lastAttemptAt: Date()
            ), discoveryRun: run)
        }
        try run.check()
        var widgetError: ProductError?
        do {
            try await synchronizeWidget(run: run)
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as ProductError {
            if error == .permissionDenied { throw error }
            widgetError = error
        }
        try run.check()
        #if DEBUG
        let completedPreparation = await repository.snapshot().dailyPreparations[day]
        print("JIANWEI_DAILY_PREPARATION day=\(day) inspected=\(inspected) analyzed=\(attemptedAnalyses) " +
              "qualified=\(pool.count) status=\(completedPreparation?.status.rawValue ?? "missing") " +
              "error=\((widgetError ?? preparationError).map { String(describing: $0) } ?? "none")")
        #endif
        return DiscoveryRunSummary(
            inspected: inspected, analyzed: attemptedAnalyses,
            cardsCreated: shouldFinalize && selectedID != nil ? 1 : 0,
            knowledgeReady: generatedCards.count, exhausted: exhausted, filtered: filtered,
            failed: failed + (selectionError == nil ? 0 : 1) + (widgetError == nil ? 0 : 1),
            accessError: widgetError ?? preparationError
        )
    }

    private enum Attempt {
        case result(AnalysisPipelineResult)
        case filtered
        case failed(ProductError)
    }

    private func process(
        run: AutomaticDiscoveryRun,
        operation: @Sendable () async throws -> AnalysisPipelineResult
    ) async throws -> Attempt {
        do {
            let result = try await operation()
            try run.check(localIdentifier: result.candidate.localIdentifier)
            do { try await persist(result, run: run) }
            catch is CancellationError { throw CancellationError() }
            catch let error as ProductError where error == .permissionDenied { throw error }
            catch { throw ProductError.localStorageUnavailable }
            return .result(result)
        } catch is CancellationError {
            throw CancellationError()
        } catch let rejection as PipelineRejection {
            try run.check(localIdentifier: rejection.candidate.localIdentifier)
            try await environment.repository.upsert(candidate: rejection.candidate, discoveryRun: run)
            try await environment.repository.removeImage(candidateToken: rejection.candidate.id, discoveryRun: run)
            return .filtered
        } catch let failure as PipelineFailure {
            try run.check(localIdentifier: failure.candidate.localIdentifier)
            try await persist(failure, run: run)
            return .failed(failure.cause)
        } catch let error as ProductError {
            try run.check()
            if error == .permissionDenied { throw error }
            return .failed(error)
        } catch {
            try run.check()
            return .failed(.requestFailed(-1))
        }
    }

    private func synchronizeWidget(run: AutomaticDiscoveryRun) async throws {
        do {
            let store = try widgetStore ?? SharedWidgetStore()
            try await WidgetCoordinator(repository: environment.repository, sharedStore: store).synchronize(discoveryRun: run)
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as ProductError {
            throw error
        } catch {
            throw ProductError.widgetSyncUnavailable
        }
    }

    static func preparationCheckpoint(
        day: String,
        existingPreparation: DailyPreparationRecord?,
        previousInspected: Int,
        inspected: Int,
        previousAIPhotoCount: Int,
        attemptedAnalyses: Int,
        generatedCards: [KnowledgeCard],
        now: Date
    ) -> DailyPreparationRecord {
        var qualifiedCardIDs = existingPreparation?.qualifiedCardIDs ?? []
        for cardID in generatedCards.map(\.id) where !qualifiedCardIDs.contains(cardID) {
            qualifiedCardIDs.append(cardID)
        }
        return DailyPreparationRecord(
            day: day,
            status: .preparing,
            inspectedPhotoCount: Self.accumulatedMetric(previous: previousInspected, current: inspected),
            aiPhotoCount: Self.accumulatedMetric(previous: previousAIPhotoCount, current: attemptedAnalyses),
            qualifiedCardIDs: qualifiedCardIDs,
            selectedCardID: existingPreparation?.selectedCardID,
            lastAttemptAt: now
        )
    }

    static func unprocessedAssets(
        _ assets: [PhotoAssetReference],
        state: PersistedAppState,
        retriedLocalIDs: Set<String>
    ) -> [PhotoAssetReference] {
        // Failed photos belong to the bounded retry queue above. Re-entering
        // them as fresh assets changes their token and compares their image
        // with its own stored hash, turning a transient failure into a terminal
        // duplicate. Keep deferred retries eligible only through that queue.
        let knownLocalIDs = state.processedLocalIdentifiers.union(retriedLocalIDs)
        return assets.filter { !knownLocalIDs.contains($0.localIdentifier) }
    }

    private static func dailyOrder(_ assets: [PhotoAssetReference], day: String) -> [PhotoAssetReference] {
        assets.sorted { lhs, rhs in
            let left = SHA256.hash(data: Data((day + "\0" + lhs.localIdentifier).utf8))
            let right = SHA256.hash(data: Data((day + "\0" + rhs.localIdentifier).utf8))
            return left.lexicographicallyPrecedes(right)
        }
    }

    static func selectionPool(
        newCards: [KnowledgeCard],
        carryOverCards: [KnowledgeCard]
    ) -> [KnowledgeCard] {
        var cardsByID: [UUID: KnowledgeCard] = [:]
        for incoming in carryOverCards + newCards {
            let card = KnowledgeCorrectionCatalog.applying(to: incoming)
            guard !card.isWithdrawn, card.status == "candidate", card.scheduledDay.isEmpty else { continue }
            cardsByID[card.id] = card
        }
        var seenKnowledge = Set<String>()
        return Array(cardsByID.values)
            .sorted {
                $0.createdAt == $1.createdAt
                    ? $0.id.uuidString < $1.id.uuidString
                    : $0.createdAt < $1.createdAt
            }
            .filter { card in
                guard seenKnowledge.isDisjoint(with: card.knowledgeIdentityKeys) else { return false }
                seenKnowledge.formUnion(card.knowledgeIdentityKeys)
                return true
            }
            .prefix(3)
            .map { $0 }
    }

    static func carryOverCards(
        cards: [KnowledgeCard],
        candidates: [PhotoCandidateRecord]
    ) -> [KnowledgeCard] {
        let readyAutomaticCandidateIDs = Set(
            candidates
                .filter {
                    $0.state == .knowledgeReady &&
                        $0.localIdentifier != nil
                }
                .map(\.id)
        )
        let assignedKnowledge = Set(cards.filter { $0.isPublished || !$0.scheduledDay.isEmpty }
            .flatMap(\.knowledgeIdentityKeys))
        return cards.filter {
            !$0.isWithdrawn && $0.status == "candidate" &&
                $0.scheduledDay.isEmpty &&
                assignedKnowledge.isDisjoint(with: $0.knowledgeIdentityKeys) &&
                readyAutomaticCandidateIDs.contains($0.candidateToken)
        }
    }

    static func selectionCandidateIDs(_ selectionPool: [KnowledgeCard]) -> Set<UUID> {
        Set(selectionPool.map(\.candidateToken))
    }

    private static func canSelectCachedCard(after error: ProductError) -> Bool {
        if error.requiresModelAccessAction { return true }
        switch error {
        case .requestFailed, .requestThrottled, .dailyAnalysisLimitReached,
             .monthlyAnalysisLimitReached, .managedDailyDispatchLimitReached, .serverCredentialExpired,
             .secureStorageUnavailable, .invalidServerResponse, .managedServiceUnavailable:
            return true
        default:
            // A storage, privacy or photo-access failure must not be treated
            // as permission to publish a new card.
            return false
        }
    }

    private static func availableSelectionPool(
        _ pool: [KnowledgeCard], state: PersistedAppState, run: AutomaticDiscoveryRun
    ) throws -> [KnowledgeCard] {
        let candidatesByID = Dictionary(uniqueKeysWithValues: state.candidates.map { ($0.id, $0) })
        let eligibleCards = Dictionary(uniqueKeysWithValues:
            carryOverCards(cards: state.cards, candidates: state.candidates).map { ($0.id, $0) })
        return try pool.compactMap { original in
            guard let card = eligibleCards[original.id], !state.hiddenCardIDs.contains(card.id),
                  let identifier = candidatesByID[card.candidateToken]?.localIdentifier else { return nil }
            do { try run.check(localIdentifier: identifier) }
            catch let error as ProductError where error == .photoUnavailable { return nil }
            return card
        }
    }

    private static func localFallbackCardID(from pool: [KnowledgeCard], state: PersistedAppState) -> UUID? {
        // Only already-qualified cards enter this fallback. Image confidence
        // is a tie-breaker, not a substitute for source/knowledge validation.
        let affinities = AnalysisPipeline.topicAffinities(from: state)
        return pool.sorted { lhs, rhs in
            let left = affinities[lhs.topicID, default: 0]
            let right = affinities[rhs.topicID, default: 0]
            if left != right { return left > right }
            if lhs.confidence != rhs.confidence { return lhs.confidence > rhs.confidence }
            if lhs.createdAt != rhs.createdAt { return lhs.createdAt < rhs.createdAt }
            return lhs.id.uuidString < rhs.id.uuidString
        }.first?.id
    }

    static func shouldFinalizeDailySelection(
        completedAnalyses: Int,
        maximumCandidates: Int,
        selectionPool: [KnowledgeCard],
        selectedCardID: UUID?,
        inspectedPhotos: Int = 0
    ) -> Bool {
        if selectedCardID != nil { return true }
        // A smaller maximum can be the remainder of today's device budget
        // while preparing a future day. Exhaust either persisted daily budget
        // before making an empty pool terminal for that target day.
        return selectionPool.isEmpty && (
            (completedAnalyses >= dailyCloudPhotoLimit && maximumCandidates >= dailyCloudPhotoLimit) ||
                inspectedPhotos >= dailyInspectionLimit
        )
    }

    static func automaticRetryLimit(maximumCandidates: Int) -> Int {
        guard maximumCandidates > 0 else { return 0 }
        return max(1, maximumCandidates / 3)
    }

    static let dailyCloudPhotoLimit = 9
    static let dailyInspectionLimit = 72

    static func remainingInspectionBudget(previous: Int) -> Int {
        max(0, dailyInspectionLimit - max(0, previous))
    }

    static func canInspectMore(inspected: Int, inspectionLimit: Int, analyzed: Int, runLimit: Int, poolCount: Int) -> Bool {
        inspected < inspectionLimit && analyzed < runLimit && poolCount < 3
    }

    static func accumulatedMetric(previous: Int, current: Int) -> Int {
        max(0, previous) + max(0, current)
    }

    static func reconciledCloudPhotoCount(
        previous: Int,
        current: Int,
        failure: ProductError?
    ) -> Int {
        let accumulated = accumulatedMetric(previous: previous, current: current)
        // The server is authoritative for a target day's device allowance.
        // This can differ from local state if iOS suspended an older build
        // after the server completed a request but before the client saved it.
        guard failure == .dailyAnalysisLimitReached else { return accumulated }
        return max(accumulated, dailyCloudPhotoLimit)
    }

    static func remainingCloudPhotoBudget(previous: Int, limit: Int = dailyCloudPhotoLimit) -> Int {
        max(0, limit - max(0, previous))
    }

    // A remote, credential, or durable-storage failure says nothing about the
    // next photo's knowledge potential. Stop the run instead of multiplying one
    // outage into up to 24 model or storage attempts; the background scheduler
    // can retry the unfinished day later.
    static let automaticFailureLimit = 1

    private func persist(_ result: AnalysisPipelineResult, run: AutomaticDiscoveryRun) async throws {
        if let card = result.card {
            try await environment.repository.upsert(
                candidate: result.candidate,
                card: card,
                sanitizedJPEG: result.sanitizedJPEG,
                discoveryRun: run
            )
        } else {
            try await environment.repository.upsert(candidate: result.candidate, discoveryRun: run)
            try await environment.repository.removeImage(candidateToken: result.candidate.id, discoveryRun: run)
        }
    }

    private func persist(_ failure: PipelineFailure, run: AutomaticDiscoveryRun) async throws {
        try await environment.repository.upsert(candidate: failure.candidate, discoveryRun: run)
        try await environment.repository.storeImage(
            failure.sanitizedJPEG,
            candidateToken: failure.candidate.id,
            discoveryRun: run
        )
    }
}

struct PendingDiscoveryTask: Sendable {
    let earliestBeginDate: Date?
}

protocol DiscoveryTaskScheduling: Sendable {
    func pendingRequest() async -> PendingDiscoveryTask?
    func submit(earliestBeginDate: Date) throws
    func cancel()
}

struct SystemDiscoveryTaskScheduling: DiscoveryTaskScheduling {
    func pendingRequest() async -> PendingDiscoveryTask? {
        await withCheckedContinuation { continuation in
            BGTaskScheduler.shared.getPendingTaskRequests { requests in
                let pending = requests.first { $0.identifier == SharedConstants.discoveryTaskIdentifier }
                continuation.resume(returning: pending.map { PendingDiscoveryTask(earliestBeginDate: $0.earliestBeginDate) })
            }
        }
    }

    func submit(earliestBeginDate: Date) throws {
        let request = BGProcessingTaskRequest(identifier: SharedConstants.discoveryTaskIdentifier)
        request.requiresNetworkConnectivity = true
        request.requiresExternalPower = false
        request.earliestBeginDate = earliestBeginDate
        try BGTaskScheduler.shared.submit(request)
    }

    func cancel() {
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: SharedConstants.discoveryTaskIdentifier)
    }
}

actor DiscoveryTaskScheduler {
    private let transport: any DiscoveryTaskScheduling
    private var revision = UUID()

    init(transport: any DiscoveryTaskScheduling) { self.transport = transport }

    func schedule(repository: LocalRepository, now: Date = Date()) async throws {
        try await reconcile(repository: repository, now: now, preservePending: true)
    }

    private func reconcile(repository: LocalRepository, now: Date, preservePending: Bool) async throws {
        try Task.checkCancellation()
        let requestRevision = UUID()
        revision = requestRevision
        let pending = preservePending ? await transport.pendingRequest() : nil
        // Read the current preference and managed-service wait after the OS
        // callback. Pause, deletion, or a mode change may have happened meanwhile.
        let state = await repository.snapshot()
        guard revision == requestRevision else { return }
        try Task.checkCancellation()
        guard state.automaticDiscoveryEnabled else { return }
        let notBefore = state.modelAccessMode == .managed ? state.managedDispatchResumeAt : nil
        let accessFloor = notBefore.flatMap { $0 > now ? $0 : nil } ?? .distantPast
        let desiredDate = max(now.addingTimeInterval(6 * 60 * 60), accessFloor)
        if let pending {
            let existingDate = pending.earliestBeginDate ?? .distantPast
            if existingDate >= accessFloor && existingDate <= desiredDate { return }
        }
        // submit replaces an unexecuted request. Never keep sliding its earliest
        // opportunity forward on launch; a consumed/missing request needs a new one.
        try transport.submit(earliestBeginDate: desiredDate)
    }

    func cancel() {
        revision = UUID()
        transport.cancel()
    }

    func rescheduleAfterOpportunity(repository: LocalRepository, accessError: ProductError?, now: Date = Date()) async throws {
        // Expiration cancels photo/model work, not the next OS opportunity.
        // This unstructured task does bookkeeping only and does not inherit the
        // expired worker's cancellation; current pause/access gates still apply.
        let renewal = Task {
            let state = await repository.snapshot()
            guard BackgroundDiscoveryController.shouldReschedule(
                automaticDiscoveryEnabled: state.automaticDiscoveryEnabled, accessError: accessError
            ) else { return }
            // A completed/expired execution consumes an opportunity: explicitly
            // submit its successor, rather than treating its old entry as future work.
            try await self.reconcile(repository: repository, now: now, preservePending: false)
        }
        try await renewal.value
    }
}

enum BackgroundDiscoveryController {
    private static let scheduler = DiscoveryTaskScheduler(transport: SystemDiscoveryTaskScheduling())

    static func register(environment: AppEnvironment) {
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: SharedConstants.discoveryTaskIdentifier,
            using: nil
        ) { task in
            guard !AppLaunchPolicy.isReadOnlyStateProbe() else {
                task.setTaskCompleted(success: false)
                return
            }
            guard let processingTask = task as? BGProcessingTask else {
                task.setTaskCompleted(success: false)
                return
            }
            let handle = BackgroundProcessingTaskHandle(processingTask)
            let work = Task {
                let summary = await AutomaticDiscoveryRunner(environment: environment)
                    .replenishRollingWindow(maximumCandidates: AutomaticDiscoveryRunner.backgroundRefillPhotoLimit)
                try? await scheduler.rescheduleAfterOpportunity(repository: environment.repository, accessError: summary.accessError)
                // Finish all required bookkeeping before releasing the system's
                // execution grant. Expiration is not a successful refill.
                handle.complete(success: !Task.isCancelled && summary.failed == 0)
            }
            handle.setExpirationHandler { work.cancel() }
        }
    }

    static func schedule(repository: LocalRepository) async throws {
        guard !AppLaunchPolicy.isReadOnlyStateProbe() else { return }
        try await scheduler.schedule(repository: repository)
    }

    static func cancel() async {
        guard !AppLaunchPolicy.isReadOnlyStateProbe() else { return }
        await scheduler.cancel()
    }

    static func shouldReschedule(
        automaticDiscoveryEnabled: Bool,
        accessError: ProductError?
    ) -> Bool {
        guard automaticDiscoveryEnabled else { return false }
        guard let accessError else { return true }
        return accessError != .permissionDenied && !accessError.requiresModelAccessAction
    }

    static func nextPreparationDay(state: PersistedAppState, now: Date) -> String {
        for offset in 0..<7 {
            let day = ChinaDay.string(from: ChinaDay.adding(days: offset, to: now))
            // A failed date closes its own allowance, not permission to spend
            // tomorrow's. Only successful cards advance the rolling queue;
            // a noNewCard date is retried neither here nor by the runner.
            if state.dailyPreparations[day]?.status != .ready { return day }
        }
        return ChinaDay.string(from: ChinaDay.adding(days: 6, to: now))
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
