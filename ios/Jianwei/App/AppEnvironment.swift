import BackgroundTasks
import Foundation
import WidgetKit

struct AppEnvironment: Sendable {
    let repository: LocalRepository
    let discovery: PhotoDiscoveryService
    let pipeline: AnalysisPipeline?
    let api: APIClient?
    let identity: DeviceIdentityStore?
    let widgetCoordinator: WidgetCoordinator

    var serviceConfigured: Bool { pipeline != nil && api != nil && identity != nil }

    static func live() throws -> AppEnvironment {
        let repository = try LocalRepository()
        let discovery = PhotoDiscoveryService()
        let widgetCoordinator = WidgetCoordinator(repository: repository)
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
                analyzer: analyzer
            ),
            api: api,
            identity: identity,
            widgetCoordinator: widgetCoordinator
        )
    }
}

struct DiscoveryRunSummary: Sendable {
    let inspected: Int
    let cardsCreated: Int
    let filtered: Int
    let failed: Int
}

actor AutomaticDiscoveryRunner {
    private let environment: AppEnvironment

    init(environment: AppEnvironment) {
        self.environment = environment
    }

    func run(maximumCandidates: Int) async -> DiscoveryRunSummary {
        guard maximumCandidates > 0, let pipeline = environment.pipeline else {
            return DiscoveryRunSummary(inspected: 0, cardsCreated: 0, filtered: 0, failed: 0)
        }
        let access = await environment.discovery.authorizationState()
        guard access == .full || access == .limited else {
            return DiscoveryRunSummary(inspected: 0, cardsCreated: 0, filtered: 0, failed: 0)
        }

        var state = await environment.repository.snapshot()
        guard state.automaticDiscoveryEnabled else {
            return DiscoveryRunSummary(inspected: 0, cardsCreated: 0, filtered: 0, failed: 0)
        }
        var inspected = 0
        var cardsCreated = 0
        var filtered = 0
        var failed = 0

        for candidate in state.candidates where candidate.state == .failed {
            guard inspected < maximumCandidates else { break }
            guard let jpeg = await environment.repository.imageData(candidateToken: candidate.id) else { continue }
            inspected += 1
            do {
                let result = try await pipeline.retry(candidate: candidate, sanitizedJPEG: jpeg)
                try await persist(result)
                if result.card == nil { filtered += 1 } else { cardsCreated += 1 }
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
                failed: failed + 1
            )
        }
        state = await environment.repository.snapshot()
        let knownLocalIDs = Set(state.candidates.compactMap(\.localIdentifier))
        var hashes = Set(state.candidates.compactMap(\.perceptualHash))
        for asset in assets where !knownLocalIDs.contains(asset.localIdentifier) {
            guard inspected < maximumCandidates, !Task.isCancelled else { break }
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
                if result.card == nil { filtered += 1 } else { cardsCreated += 1 }
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
        try? await environment.repository.markScan(at: Date())
        let updated = await environment.repository.snapshot()
        try? await environment.widgetCoordinator.synchronize(cards: updated.cards)
        return DiscoveryRunSummary(
            inspected: inspected,
            cardsCreated: cardsCreated,
            filtered: filtered,
            failed: failed
        )
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
                let snapshot = await environment.repository.snapshot()
                let maximum = snapshot.preparationMode == .weeklyCache ? 12 : 1
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
