import Foundation

actor LocalRepository {
    private let rootURL: URL
    private let stateURL: URL
    private let imageDirectoryURL: URL
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder
    private var state: PersistedAppState

    init(rootURL: URL? = nil) throws {
        let resolvedRoot: URL
        if let rootURL {
            resolvedRoot = rootURL
        } else {
            resolvedRoot = try FileManager.default.url(
                for: .applicationSupportDirectory,
                in: .userDomainMask,
                appropriateFor: nil,
                create: true
            ).appendingPathComponent("Jianwei", isDirectory: true)
        }
        self.rootURL = resolvedRoot
        stateURL = resolvedRoot.appendingPathComponent("state.json")
        imageDirectoryURL = resolvedRoot.appendingPathComponent("images", isDirectory: true)
        encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        if let data = try? Data(contentsOf: stateURL), let decoded = try? decoder.decode(PersistedAppState.self, from: data) {
            state = decoded
        } else {
            state = .empty
        }
    }

    func snapshot() -> PersistedAppState { state }

    func setOnboardingCompleted(_ completed: Bool) throws {
        state.onboardingCompleted = completed
        try persist()
    }

    func setAutomaticDiscovery(_ enabled: Bool) throws {
        state.automaticDiscoveryEnabled = enabled
        try persist()
    }

    func setPreferences(
        interests: Set<KnowledgeInterest>,
        preparationMode: AutomaticPreparationMode
    ) throws {
        state.interests = interests
        state.preparationMode = preparationMode
        try persist()
    }

    func markScan(at date: Date) throws {
        state.lastIncrementalScanAt = date
        try persist()
    }

    func upsert(candidate: PhotoCandidateRecord) throws {
        state.candidates.removeAll { $0.id == candidate.id || (
            candidate.localIdentifier != nil && $0.localIdentifier == candidate.localIdentifier
        ) }
        state.candidates.append(candidate)
        if state.candidates.count > 500 {
            state.candidates.sort { $0.updatedAt > $1.updatedAt }
            state.candidates = Array(state.candidates.prefix(500))
        }
        try persist()
    }

    func upsert(card: KnowledgeCard, sanitizedJPEG: Data?) throws {
        state.cards.removeAll { $0.id == card.id }
        state.cards.append(card)
        state.cards.sort { $0.scheduledDay < $1.scheduledDay }
        if let sanitizedJPEG {
            try FileManager.default.createDirectory(
                at: imageDirectoryURL,
                withIntermediateDirectories: true,
                attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
            )
            try sanitizedJPEG.write(
                to: imageURL(candidateToken: card.candidateToken),
                options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
            )
        }
        try persist()
    }

    func replaceRemoteCards(_ cards: [KnowledgeCard]) throws {
        state.cards = cards.filter { !state.hiddenCardIDs.contains($0.id) }
        try persist()
    }

    func setSaved(_ saved: Bool, cardID: UUID) throws {
        if saved { state.savedCardIDs.insert(cardID) } else { state.savedCardIDs.remove(cardID) }
        try persist()
    }

    func recordFeedback(cardID: UUID, action: FeedbackAction) throws -> PendingFeedback {
        state.feedbackByCardID[cardID] = action
        let pending = PendingFeedback(id: UUID(), cardID: cardID, action: action, createdAt: Date())
        state.pendingFeedback.removeAll { $0.cardID == cardID && $0.action == action }
        state.pendingFeedback.append(pending)
        try persist()
        return pending
    }

    func confirmFeedback(_ pendingID: UUID) throws {
        state.pendingFeedback.removeAll { $0.id == pendingID }
        try persist()
    }

    func hideCard(_ cardID: UUID, candidateToken: UUID, neverAnalyze: Bool) throws {
        state.hiddenCardIDs.insert(cardID)
        state.cards.removeAll { $0.id == cardID }
        state.savedCardIDs.remove(cardID)
        if neverAnalyze, let index = state.candidates.firstIndex(where: { $0.id == candidateToken }) {
            state.candidates[index].state = .neverAnalyze
            state.candidates[index].updatedAt = Date()
        }
        try? FileManager.default.removeItem(at: imageURL(candidateToken: candidateToken))
        try persist()
    }

    func imageData(candidateToken: UUID) -> Data? {
        try? Data(contentsOf: imageURL(candidateToken: candidateToken))
    }

    func storeImage(_ data: Data, candidateToken: UUID) throws {
        try FileManager.default.createDirectory(
            at: imageDirectoryURL,
            withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
        )
        try data.write(
            to: imageURL(candidateToken: candidateToken),
            options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
        )
    }

    func removeImage(candidateToken: UUID) {
        try? FileManager.default.removeItem(at: imageURL(candidateToken: candidateToken))
    }

    func deleteLocalData() throws {
        state = .empty
        try? FileManager.default.removeItem(at: rootURL)
        try persist()
    }

    private func imageURL(candidateToken: UUID) -> URL {
        imageDirectoryURL.appendingPathComponent(candidateToken.uuidString.lowercased() + ".jpg")
    }

    private func persist() throws {
        try FileManager.default.createDirectory(
            at: rootURL,
            withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
        )
        let data = try encoder.encode(state)
        try data.write(to: stateURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
}
