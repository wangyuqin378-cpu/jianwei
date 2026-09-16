import Foundation

struct AnalysisPipelineResult: Sendable {
    let candidate: PhotoCandidateRecord
    let card: KnowledgeCard?
    let sanitizedJPEG: Data
}

actor AnalysisPipeline {
    private let api: APIClient?
    private let identity: DeviceIdentityStore?
    private let analyzer: PhotoPrivacyAnalyzer
    private let modelAccessStore: AIModelAccessStore
    private let subscriptionStore: any ManagedSubscriptionServing
    private let repository: LocalRepository
    private let directQwen: any DirectQwenServing
    private let managedQwen: (any DirectQwenServing)?
    private let knowledgeCatalog: BundledKnowledgeCatalog
    private let allowsMissingManagedTransaction: Bool
    private let sanitizer = ImageSanitizer()

    init(
        api: APIClient?,
        identity: DeviceIdentityStore?,
        analyzer: PhotoPrivacyAnalyzer,
        modelAccessStore: AIModelAccessStore,
        subscriptionStore: any ManagedSubscriptionServing,
        repository: LocalRepository,
        directQwen: any DirectQwenServing,
        managedQwen: (any DirectQwenServing)? = nil,
        knowledgeCatalog: BundledKnowledgeCatalog,
        allowsMissingManagedTransaction: Bool = false
    ) {
        self.api = api
        self.identity = identity
        self.analyzer = analyzer
        self.modelAccessStore = modelAccessStore
        self.subscriptionStore = subscriptionStore
        self.repository = repository
        self.directQwen = directQwen
        self.managedQwen = managedQwen
        self.knowledgeCatalog = knowledgeCatalog
        self.allowsMissingManagedTransaction = allowsMissingManagedTransaction
    }

    @discardableResult
    func prepareKnowledgeCatalog(discoveryRun: AutomaticDiscoveryRun? = nil) async throws -> Int {
        try discoveryRun?.check()
        let state = await repository.snapshot()
        let revision = state.modelAccessMode == .managed
            ? "\(knowledgeCatalog.revision)+\(SharedConstants.managedAnalysisRevision)"
            : "\(knowledgeCatalog.revision)+\(DirectQwenService.modelKnowledgeRevision)"
        return try await repository.adoptKnowledgeCatalogRevision(revision, discoveryRun: discoveryRun)
    }

    func analyze(
        sourceData: Data,
        localIdentifier: String?,
        capturedAt: Date?,
        initialFlags: Set<String> = [],
        existingHashes: Set<UInt64> = [],
        targetDay: String? = nil,
        discoveryRun: AutomaticDiscoveryRun? = nil
    ) async throws -> AnalysisPipelineResult {
        try Task.checkCancellation()
        try discoveryRun?.check(localIdentifier: localIdentifier)
        let token = UUID()
        let sanitized: SanitizedImage
        do {
            sanitized = try sanitizer.sanitize(sourceData)
        } catch {
            // A permanently unreadable MediaStore asset must become terminal;
            // otherwise automatic discovery selects the same corrupt photo on
            // every run and never reaches the next candidate.
            throw PipelineRejection(
                candidate: PhotoCandidateRecord(
                    id: token,
                    localIdentifier: localIdentifier,
                    capturedAt: capturedAt,
                    perceptualHash: nil,
                    qualityScore: 0,
                    localLabels: [],
                    sensitiveFlags: ["unreadable"],
                    state: .filtered,
                    updatedAt: Date()
                ),
                cause: .photoUnavailable
            )
        }
        let analysis = try await analyzer.analyze(jpeg: sanitized.jpeg, initialFlags: initialFlags)
        try Task.checkCancellation()
        try discoveryRun?.check(localIdentifier: localIdentifier)
        var candidate = PhotoCandidateRecord(
            id: token,
            localIdentifier: localIdentifier,
            capturedAt: capturedAt,
            perceptualHash: analysis.perceptualHash,
            qualityScore: analysis.qualityScore,
            localLabels: analysis.labels,
            sensitiveFlags: analysis.sensitiveFlags,
            state: .discovered,
            updatedAt: Date()
        )
        guard analysis.qualityScore >= 0.35 else {
            candidate.state = .filtered
            throw PipelineRejection(candidate: candidate, cause: .lowQualityPhoto)
        }
        guard !existingHashes.contains(analysis.perceptualHash) else {
            candidate.state = .filtered
            throw PipelineRejection(candidate: candidate, cause: .duplicatePhoto)
        }
        guard analysis.sensitiveFlags.isEmpty else {
            candidate.state = .filtered
            throw PipelineRejection(candidate: candidate, cause: .sensitivePhoto(analysis.sensitiveFlags))
        }

        do {
            return try await submit(candidate: candidate, sanitizedJPEG: sanitized.jpeg, targetDay: targetDay, discoveryRun: discoveryRun)
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as ProductError {
            try Task.checkCancellation()
            try discoveryRun?.check(localIdentifier: localIdentifier)
            candidate.managedDispatch = await repository.snapshot().candidates.first { $0.id == candidate.id }?.managedDispatch
            if case .sensitivePhoto(let flags) = error {
                candidate.state = .filtered
                candidate.managedDispatch = nil
                candidate.sensitiveFlags.formUnion(flags)
                candidate.updatedAt = Date()
                throw PipelineRejection(candidate: candidate, cause: error)
            }
            if error.requiresModelAccessAction { throw error }
            candidate.state = .failed
            candidate.updatedAt = Date()
            throw PipelineFailure(candidate: candidate, sanitizedJPEG: sanitized.jpeg, cause: error)
        } catch {
            try Task.checkCancellation()
            try discoveryRun?.check(localIdentifier: localIdentifier)
            candidate.managedDispatch = await repository.snapshot().candidates.first { $0.id == candidate.id }?.managedDispatch
            candidate.state = .failed
            candidate.updatedAt = Date()
            throw PipelineFailure(candidate: candidate, sanitizedJPEG: sanitized.jpeg, cause: .requestFailed(-1))
        }
    }

    func retry(
        candidate: PhotoCandidateRecord,
        sanitizedJPEG: Data,
        targetDay: String? = nil,
        discoveryRun: AutomaticDiscoveryRun? = nil
    ) async throws -> AnalysisPipelineResult {
        try Task.checkCancellation()
        try discoveryRun?.check(localIdentifier: candidate.localIdentifier)
        var retrying = candidate
        retrying.updatedAt = Date()
        let analysis = try await analyzer.analyze(jpeg: sanitizedJPEG)
        try Task.checkCancellation()
        try discoveryRun?.check(localIdentifier: candidate.localIdentifier)
        retrying.perceptualHash = analysis.perceptualHash
        retrying.qualityScore = analysis.qualityScore
        retrying.localLabels = analysis.labels
        retrying.sensitiveFlags = analysis.sensitiveFlags
        guard analysis.qualityScore >= 0.35 else {
            retrying.state = .filtered
            retrying.managedDispatch = nil
            throw PipelineRejection(candidate: retrying, cause: .lowQualityPhoto)
        }
        guard analysis.sensitiveFlags.isEmpty else {
            retrying.state = .filtered
            retrying.managedDispatch = nil
            throw PipelineRejection(candidate: retrying, cause: .sensitivePhoto(analysis.sensitiveFlags))
        }
        do {
            return try await submit(candidate: retrying, sanitizedJPEG: sanitizedJPEG, targetDay: targetDay, discoveryRun: discoveryRun)
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as ProductError {
            try Task.checkCancellation()
            try discoveryRun?.check(localIdentifier: candidate.localIdentifier)
            retrying.managedDispatch = await repository.snapshot().candidates.first { $0.id == candidate.id }?.managedDispatch
            if case .sensitivePhoto(let flags) = error {
                retrying.state = .filtered
                retrying.managedDispatch = nil
                retrying.sensitiveFlags.formUnion(flags)
                retrying.updatedAt = Date()
                throw PipelineRejection(candidate: retrying, cause: error)
            }
            if error.requiresModelAccessAction { throw error }
            retrying.state = .failed
            retrying.updatedAt = Date()
            throw PipelineFailure(candidate: retrying, sanitizedJPEG: sanitizedJPEG, cause: error)
        } catch {
            try Task.checkCancellation()
            try discoveryRun?.check(localIdentifier: candidate.localIdentifier)
            retrying.managedDispatch = await repository.snapshot().candidates.first { $0.id == candidate.id }?.managedDispatch
            retrying.state = .failed
            retrying.updatedAt = Date()
            throw PipelineFailure(candidate: retrying, sanitizedJPEG: sanitizedJPEG, cause: .requestFailed(-1))
        }
    }

    private func submit(
        candidate originalCandidate: PhotoCandidateRecord,
        sanitizedJPEG: Data,
        targetDay: String?,
        discoveryRun: AutomaticDiscoveryRun? = nil
    ) async throws -> AnalysisPipelineResult {
        var candidate = originalCandidate
        try Task.checkCancellation()
        try discoveryRun?.check(localIdentifier: candidate.localIdentifier)
        let access = try await preflightModelAccess()
        try Task.checkCancellation()
        try discoveryRun?.check(localIdentifier: candidate.localIdentifier)
        var reservationDay = targetDay ?? ChinaDay.string(from: Date())
        let dispatchedAt = Date()
        let reservationID: UUID?
        if let discoveryRun {
            if access.mode == .managed {
                candidate = try await repository.checkpointManagedPhoto(candidate: candidate,
                    sanitizedJPEG: sanitizedJPEG, day: reservationDay, run: discoveryRun)
                reservationID = candidate.managedDispatch?.reservationID
                reservationDay = candidate.managedDispatch?.day ?? reservationDay
            } else {
                // An unfinished platform request belongs to platform billing,
                // not to a subsequently selected personal API key.
                guard !candidate.hasPendingManagedDispatch else { throw CancellationError() }
                reservationID = try await repository.reserveDiscoveryCloudPhoto(day: reservationDay, run: discoveryRun)
            }
        } else { reservationID = nil }
        if access.mode == .qwenUserKey {
            guard let apiKey = access.apiKey else { throw ProductError.apiKeyRequired }
            return try await submitLocally(
                candidate: candidate,
                sanitizedJPEG: sanitizedJPEG,
                service: directQwen,
                credential: apiKey,
                discoveryRun: discoveryRun
            )
        }

        do {
            return try await submitManaged(candidate: candidate, sanitizedJPEG: sanitizedJPEG,
                targetDay: targetDay, discoveryRun: discoveryRun, access: access)
        } catch ProductError.managedDailyDispatchLimitReached {
            if let discoveryRun, let reservationID {
                try await repository.rejectManagedCloudPhotoReservation(
                    day: reservationDay, reservationID: reservationID, run: discoveryRun, now: dispatchedAt)
            }
            throw ProductError.managedDailyDispatchLimitReached
        }
    }

    private func submitManaged(
        candidate: PhotoCandidateRecord, sanitizedJPEG: Data, targetDay: String?,
        discoveryRun: AutomaticDiscoveryRun?, access: ModelAccessRequest
    ) async throws -> AnalysisPipelineResult {
        guard let api, let identity else { throw ProductError.apiNotConfigured }
        let state = await repository.snapshot()
        let interests = state.interests.map(\.title).sorted()
        let knownKnowledgeHashes = APIClient.packedKnowledgeHistory(state.cards)
        do {
            let credentials = try await identity.credentials()
            try Task.checkCancellation()
            try discoveryRun?.check(localIdentifier: candidate.localIdentifier)
            let card = try await api.photoInsight(
                bearer: credentials.token,
                candidateToken: candidate.id,
                jpeg: sanitizedJPEG,
                localLabels: candidate.localLabels,
                interests: interests,
                targetDay: targetDay,
                appStoreTransaction: access.appStoreTransaction,
                knownKnowledgeHashes: knownKnowledgeHashes
            )
            try Task.checkCancellation()
            try discoveryRun?.check(localIdentifier: candidate.localIdentifier)
            return await managedResult(candidate: candidate, card: card, sanitizedJPEG: sanitizedJPEG)
        } catch ProductError.serverCredentialExpired {
            try Task.checkCancellation()
            try discoveryRun?.check(localIdentifier: candidate.localIdentifier)
            try await identity.invalidateServerCredential()
            try Task.checkCancellation()
            try discoveryRun?.check(localIdentifier: candidate.localIdentifier)
            let credentials = try await identity.credentials()
            try Task.checkCancellation()
            try discoveryRun?.check(localIdentifier: candidate.localIdentifier)
            let card = try await api.photoInsight(
                bearer: credentials.token,
                candidateToken: candidate.id,
                jpeg: sanitizedJPEG,
                localLabels: candidate.localLabels,
                interests: interests,
                targetDay: targetDay,
                appStoreTransaction: access.appStoreTransaction,
                knownKnowledgeHashes: knownKnowledgeHashes
            )
            try Task.checkCancellation()
            try discoveryRun?.check(localIdentifier: candidate.localIdentifier)
            return await managedResult(candidate: candidate, card: card, sanitizedJPEG: sanitizedJPEG)
        }
    }

    private func managedResult(
        candidate originalCandidate: PhotoCandidateRecord,
        card: KnowledgeCard?,
        sanitizedJPEG: Data
    ) async -> AnalysisPipelineResult {
        let state = await repository.snapshot()
        // An idempotent replay must retain local presentation/history state.
        if let card, let existing = state.cards.first(where: { $0.id == card.id }) {
            var candidate = state.candidates.first { $0.id == originalCandidate.id } ?? originalCandidate
            if candidate.state == .uploaded || candidate.state == .failed {
                candidate.state = existing.isPublished ? .selected : .knowledgeReady
            }
            candidate.managedDispatch = nil
            return AnalysisPipelineResult(
                candidate: candidate,
                card: existing, sanitizedJPEG: sanitizedJPEG)
        }
        let card = card.flatMap { incoming in
            state.cards.contains { !$0.knowledgeIdentityKeys.isDisjoint(with: incoming.knowledgeIdentityKeys) }
                ? nil : incoming
        }
        var candidate = originalCandidate
        candidate.managedDispatch = nil
        candidate.state = card == nil ? .exhausted : .knowledgeReady
        candidate.updatedAt = Date()
        return AnalysisPipelineResult(candidate: candidate, card: card, sanitizedJPEG: sanitizedJPEG)
    }

    private func submitLocally(
        candidate originalCandidate: PhotoCandidateRecord,
        sanitizedJPEG: Data,
        service: any DirectQwenServing,
        credential: String,
        discoveryRun: AutomaticDiscoveryRun?
    ) async throws -> AnalysisPipelineResult {
        var candidate = originalCandidate
        try Task.checkCancellation()
        try discoveryRun?.check(localIdentifier: candidate.localIdentifier)
        let understanding = try await service.detect(
                jpeg: sanitizedJPEG,
                localLabels: candidate.localLabels,
                preferredTopics: knowledgeCatalog.preferredDetectionTopics(),
                apiKey: credential
            )
            try Task.checkCancellation()
            try discoveryRun?.check(localIdentifier: candidate.localIdentifier)
            guard understanding.sensitiveFlags.isEmpty else {
                candidate.sensitiveFlags.formUnion(understanding.sensitiveFlags)
                candidate.state = .filtered
                candidate.updatedAt = Date()
                return AnalysisPipelineResult(candidate: candidate, card: nil, sanitizedJPEG: sanitizedJPEG)
            }
            let subjects = understanding.subjects.map { knowledgeCatalog.canonicalize($0) }
            let state = await repository.snapshot()
            // All retained cards participate, including older history and
            // future prepared cards. This local ID set is not model context.
            let recentFactIDs = state.cards.map(\.factID)
            var discoveredCards: [KnowledgeCard] = []
            var firstGenerationError: ProductError?
            for entity in subjects {
                try Task.checkCancellation()
                try discoveryRun?.check(localIdentifier: candidate.localIdentifier)
                let options = knowledgeCatalog.factOptions(
                    entity: entity,
                    recentFactIDs: recentFactIDs
                )
                guard !options.isEmpty else { continue }
                do {
                    let editorial = try await service.editKnowledgeCard(
                        jpeg: sanitizedJPEG,
                        from: options,
                        apiKey: credential
                    )
                    try Task.checkCancellation()
                    try discoveryRun?.check(localIdentifier: candidate.localIdentifier)
                    guard let editorial else { continue }
                    if let card = knowledgeCatalog.makeCard(
                        entity: entity,
                        candidateToken: candidate.id,
                        capturedAt: candidate.capturedAt,
                        recentFactIDs: recentFactIDs,
                        editorial: editorial
                    )?.withPresentation(status: "candidate", scheduledDay: "") {
                        discoveredCards.append(card)
                    }
                } catch let error as ProductError {
                    try discoveryRun?.check(localIdentifier: candidate.localIdentifier)
                    // Another object in the same photo cannot fix an account
                    // denial. Preserve the cause and stop before another call.
                    if error.requiresModelAccessAction { throw error }
                    firstGenerationError = firstGenerationError ?? error
                }
            }
            if discoveredCards.isEmpty, let firstGenerationError { throw firstGenerationError }
            if discoveredCards.isEmpty {
                let identifier = candidate.localIdentifier
                try Task.checkCancellation()
                try discoveryRun?.check(localIdentifier: identifier)
                let draft = try await service.generateModelKnowledge(
                    jpeg: sanitizedJPEG, subjects: subjects, recentCards: state.cards,
                    apiKey: credential,
                    checkAccess: { try discoveryRun?.check(localIdentifier: identifier) }
                )
                try Task.checkCancellation()
                try discoveryRun?.check(localIdentifier: identifier)
                if let draft {
                    let card = draft.makeCard(candidateToken: candidate.id, capturedAt: candidate.capturedAt)
                    if !recentFactIDs.contains(card.factID) { discoveredCards.append(card) }
                }
            }
            let card: KnowledgeCard?
            if discoveredCards.isEmpty {
                card = nil
            } else {
                let selectableCards = Array(discoveredCards.prefix(3))
                try Task.checkCancellation()
                try discoveryRun?.check(localIdentifier: candidate.localIdentifier)
                let selectedID = try await service.selectDailyCard(from: selectableCards, apiKey: credential)
                try Task.checkCancellation()
                try discoveryRun?.check(localIdentifier: candidate.localIdentifier)
                card = selectedID.flatMap { id in selectableCards.first(where: { $0.id == id }) }
            }
            candidate.state = card == nil ? .exhausted : .knowledgeReady
            candidate.updatedAt = Date()
            return AnalysisPipelineResult(candidate: candidate, card: card, sanitizedJPEG: sanitizedJPEG)
    }

    func selectDailyWinner(from cards: [KnowledgeCard], day: String, discoveryRun: AutomaticDiscoveryRun? = nil) async throws -> UUID? {
        try Task.checkCancellation()
        try discoveryRun?.check()
        guard !cards.isEmpty else { return nil }
        if cards.count == 1 { return cards[0].id }
        let access = try await preflightModelAccess()
        let state = await repository.snapshot()
        try Task.checkCancellation()
        try discoveryRun?.check()
        if access.mode == .qwenUserKey {
            guard let apiKey = access.apiKey else { throw ProductError.apiKeyRequired }
            let selectedID = try await directQwen.selectDailyCard(
                from: cards,
                topicAffinities: Self.topicAffinities(from: state),
                apiKey: apiKey
            )
            try Task.checkCancellation()
            try discoveryRun?.check()
            return selectedID
        }
        guard let api, let identity else { throw ProductError.apiNotConfigured }
        do {
            let credentials = try await identity.credentials()
            try Task.checkCancellation()
            try discoveryRun?.check()
            let selectedID = try await api.dailyWinner(
                bearer: credentials.token,
                cards: cards,
                topicAffinities: Self.topicAffinities(from: state),
                day: day,
                appStoreTransaction: access.appStoreTransaction
            )
            try Task.checkCancellation()
            try discoveryRun?.check()
            return selectedID
        } catch ProductError.serverCredentialExpired {
            try Task.checkCancellation()
            try discoveryRun?.check()
            try await identity.invalidateServerCredential()
            try Task.checkCancellation()
            try discoveryRun?.check()
            let credentials = try await identity.credentials()
            try Task.checkCancellation()
            try discoveryRun?.check()
            let selectedID = try await api.dailyWinner(
                bearer: credentials.token,
                cards: cards,
                topicAffinities: Self.topicAffinities(from: state),
                day: day,
                appStoreTransaction: access.appStoreTransaction
            )
            try Task.checkCancellation()
            try discoveryRun?.check()
            return selectedID
        }
    }

    static func topicAffinities(from state: PersistedAppState) -> [String: Int] {
        var result: [String: Int] = [:]
        let cardsByID = Dictionary(uniqueKeysWithValues: state.cards.map { ($0.id, $0) })
        for (cardID, action) in state.feedbackByCardID {
            guard let card = cardsByID[cardID] else { continue }
            let delta: Int
            switch action {
            case .like: delta = 4
            case .save: delta = 5
            case .dislike: delta = -4
            case .wrongObject: delta = 0
            case .tooPrivate: delta = -8
            }
            result[card.topicID] = max(-20, min(20, result[card.topicID, default: 0] + delta))
        }
        return result
    }

    func preflightModelAccess() async throws -> ModelAccessRequest {
        let state = await repository.snapshot()
        if state.modelAccessMode == .managed,
           let resumeAt = state.managedDispatchResumeAt, resumeAt > Date() {
            throw ProductError.managedDailyDispatchLimitReached
        }
        if state.modelAccessMode == .managed, (api == nil || identity == nil) {
            throw ProductError.apiNotConfigured
        }
        let transaction = state.modelAccessMode == .managed
            ? await subscriptionStore.entitlementJWS()
            : nil
        return try await modelAccessStore.request(
            for: state.modelAccessMode,
            managedTransaction: transaction,
            allowsMissingManagedTransaction: allowsMissingManagedTransaction || allowsFixtureManagedAccess
        )
    }

    private var allowsFixtureManagedAccess: Bool {
        #if DEBUG
        ProcessInfo.processInfo.arguments.contains("-JianweiAuthorizedFixtureE2E")
        #else
        false
        #endif
    }
}

struct PipelineRejection: LocalizedError, Sendable {
    let candidate: PhotoCandidateRecord
    let cause: ProductError
    var errorDescription: String? { cause.errorDescription }
}

struct PipelineFailure: LocalizedError, Sendable {
    let candidate: PhotoCandidateRecord
    let sanitizedJPEG: Data
    let cause: ProductError
    var errorDescription: String? { cause.errorDescription }
}
