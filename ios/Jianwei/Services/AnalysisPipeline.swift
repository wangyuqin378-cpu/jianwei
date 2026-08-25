import Foundation

struct AnalysisPipelineResult: Sendable {
    let candidate: PhotoCandidateRecord
    let card: KnowledgeCard?
    let sanitizedJPEG: Data
}

actor AnalysisPipeline {
    private let api: APIClient
    private let identity: DeviceIdentityStore
    private let analyzer: PhotoPrivacyAnalyzer
    private let modelAccessStore: AIModelAccessStore
    private let subscriptionStore: SubscriptionStore
    private let repository: LocalRepository
    private let sanitizer = ImageSanitizer()

    init(
        api: APIClient,
        identity: DeviceIdentityStore,
        analyzer: PhotoPrivacyAnalyzer,
        modelAccessStore: AIModelAccessStore,
        subscriptionStore: SubscriptionStore,
        repository: LocalRepository
    ) {
        self.api = api
        self.identity = identity
        self.analyzer = analyzer
        self.modelAccessStore = modelAccessStore
        self.subscriptionStore = subscriptionStore
        self.repository = repository
    }

    func analyze(
        sourceData: Data,
        localIdentifier: String?,
        capturedAt: Date?,
        initialFlags: Set<String> = [],
        existingHashes: Set<UInt64> = []
    ) async throws -> AnalysisPipelineResult {
        let token = UUID()
        let sanitized = try sanitizer.sanitize(sourceData)
        let analysis = try await analyzer.analyze(jpeg: sanitized.jpeg, initialFlags: initialFlags)
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
            return try await submit(candidate: candidate, sanitizedJPEG: sanitized.jpeg)
        } catch let error as ProductError {
            candidate.state = .failed
            candidate.updatedAt = Date()
            throw PipelineFailure(candidate: candidate, sanitizedJPEG: sanitized.jpeg, cause: error)
        } catch {
            candidate.state = .failed
            candidate.updatedAt = Date()
            throw PipelineFailure(candidate: candidate, sanitizedJPEG: sanitized.jpeg, cause: .requestFailed(-1))
        }
    }

    func retry(candidate: PhotoCandidateRecord, sanitizedJPEG: Data) async throws -> AnalysisPipelineResult {
        var retrying = candidate
        retrying.updatedAt = Date()
        do {
            return try await submit(candidate: retrying, sanitizedJPEG: sanitizedJPEG)
        } catch let error as ProductError {
            retrying.state = .failed
            retrying.updatedAt = Date()
            throw PipelineFailure(candidate: retrying, sanitizedJPEG: sanitizedJPEG, cause: error)
        } catch {
            retrying.state = .failed
            retrying.updatedAt = Date()
            throw PipelineFailure(candidate: retrying, sanitizedJPEG: sanitizedJPEG, cause: .requestFailed(-1))
        }
    }

    private func submit(
        candidate originalCandidate: PhotoCandidateRecord,
        sanitizedJPEG: Data
    ) async throws -> AnalysisPipelineResult {
        var candidate = originalCandidate
        let credentials = try await identity.credentials()
        let created = try await api.createJob(
            bearer: credentials.token,
            candidateToken: candidate.id,
            capturedDay: candidate.capturedAt.map(ChinaDay.string),
            labels: candidate.localLabels,
            qualityScore: candidate.qualityScore
        )
        guard let jobID = UUID(uuidString: created.jobId) else { throw ProductError.invalidServerResponse }
        if created.status == "awaiting_upload" {
            try await api.upload(
                bearer: credentials.token,
                response: created,
                candidateToken: candidate.id,
                jpeg: sanitizedJPEG
            )
            candidate.state = .uploaded
        }

        let card: KnowledgeCard?
        if created.status == "completed" {
            card = try await api.cards(bearer: credentials.token).first { $0.candidateToken == candidate.id }
        } else if created.status == "needs_content" || created.status == "rejected" {
            card = nil
        } else {
            let state = await repository.snapshot()
            let transaction = state.modelAccessMode == .managed
                ? await subscriptionStore.entitlementJWS()
                : nil
            let access = try await modelAccessStore.request(
                for: state.modelAccessMode,
                managedTransaction: transaction
            )
            card = try await api.completeJob(
                bearer: credentials.token,
                jobID: jobID,
                candidateToken: candidate.id,
                modelAccess: access
            )
        }
        candidate.state = card == nil ? .noMatch : .completed
        candidate.updatedAt = Date()
        return AnalysisPipelineResult(candidate: candidate, card: card, sanitizedJPEG: sanitizedJPEG)
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
