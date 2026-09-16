import Foundation

actor LocalRepository {
    private var automaticDiscoveryRunActive = false
    private var automaticDiscoveryRun: AutomaticDiscoveryRun?
    private var remoteCardSyncGeneration = UUID()
    private let rootURL: URL
    private let stateURL: URL
    private let backupStateURL: URL
    private let imageDirectoryURL: URL
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder
    private var state: PersistedAppState

    init(rootURL: URL? = nil) throws {
        let resolvedRoot: URL
        if let rootURL {
            resolvedRoot = rootURL
        } else {
            resolvedRoot = try Self.defaultRootURL()
        }
        self.rootURL = resolvedRoot
        let resolvedStateURL = resolvedRoot.appendingPathComponent("state.json")
        let resolvedBackupStateURL = resolvedRoot.appendingPathComponent("state.backup.json")
        stateURL = resolvedStateURL
        backupStateURL = resolvedBackupStateURL
        imageDirectoryURL = resolvedRoot.appendingPathComponent("images", isDirectory: true)
        encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        if let data = try? Data(contentsOf: resolvedStateURL),
           let decoded = try? decoder.decode(PersistedAppState.self, from: data) {
            state = decoded
        } else if let backup = try? Data(contentsOf: resolvedBackupStateURL),
                  let decoded = try? decoder.decode(PersistedAppState.self, from: backup) {
            state = decoded
            try? backup.write(
                to: resolvedStateURL,
                options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
            )
        } else if FileManager.default.fileExists(atPath: resolvedStateURL.path) ||
                    FileManager.default.fileExists(atPath: resolvedBackupStateURL.path) {
            throw CocoaError(.fileReadCorruptFile)
        } else {
            state = .empty
        }
        // Earlier builds could leave a ready date pointing at a hidden card.
        // Repair the reference, never the spent-analysis ledger, on reopening.
        let corrected = Self.applyKnownCorrections(in: &state)
        let repaired = Self.reconcilePreparedCards(in: &state)
        if corrected || repaired {
            let data = try encoder.encode(state)
            try data.write(to: stateURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            try? data.write(to: backupStateURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        }
    }

    static func defaultRootURL() throws -> URL {
        try FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        ).appendingPathComponent("Jianwei", isDirectory: true)
    }

    @discardableResult
    static func quarantineStore(at rootURL: URL) throws -> URL? {
        guard FileManager.default.fileExists(atPath: rootURL.path) else { return nil }
        let quarantineURL = rootURL.deletingLastPathComponent().appendingPathComponent(
            "\(rootURL.lastPathComponent)-recovery-\(UUID().uuidString.lowercased())",
            isDirectory: true
        )
        try FileManager.default.moveItem(at: rootURL, to: quarantineURL)
        return quarantineURL
    }

    func snapshot() -> PersistedAppState { state }

    @discardableResult
    func removeDuplicateCardsByFactID() throws -> Int {
        // A card assigned to a day may already be visible in the widget or in
        // 回顾 even while its repository status is still `candidate`. Never
        // delete those cards merely because another photo matched the same
        // fact. Deduplicate only cards that have never entered a daily batch.
        let protected = state.cards.filter {
            $0.isWithdrawn || $0.isPublished || !$0.scheduledDay.isEmpty || state.savedCardIDs.contains($0.id)
        }
        var keptIDs = Set(protected.map(\.id))
        var keptKnowledge = Set(protected.flatMap(\.knowledgeIdentityKeys))
        let unassigned = state.cards
            .filter { !keptIDs.contains($0.id) }
            .sorted { $0.createdAt > $1.createdAt }
        for card in unassigned where keptKnowledge.isDisjoint(with: card.knowledgeIdentityKeys) {
            keptIDs.insert(card.id)
            keptKnowledge.formUnion(card.knowledgeIdentityKeys)
        }
        let removed = state.cards.filter { !keptIDs.contains($0.id) }
        guard !removed.isEmpty else { return 0 }
        let removedImageTokens = Set(removed.compactMap { card in
            state.cards.contains(where: {
                keptIDs.contains($0.id) && $0.candidateToken == card.candidateToken
            }) ? nil : card.candidateToken
        })
        try commit {
            $0.cards.removeAll { !keptIDs.contains($0.id) }
            $0.savedCardIDs = $0.savedCardIDs.intersection(keptIDs)
            for token in removedImageTokens {
                if let index = $0.candidates.firstIndex(where: { $0.id == token }) {
                    $0.candidates[index].state = .exhausted
                    $0.candidates[index].updatedAt = Date()
                }
            }
        }
        for token in removedImageTokens {
            try? FileManager.default.removeItem(at: imageURL(candidateToken: token))
        }
        return removed.count
    }

    func setOnboardingCompleted(_ completed: Bool) throws {
        if !completed { invalidateRemoteCardSync() }
        try commit { $0.onboardingCompleted = completed }
    }

    func setAutomaticDiscovery(_ enabled: Bool) throws {
        if !enabled { invalidateAutomaticDiscoveryRun() }
        try commit { $0.automaticDiscoveryEnabled = enabled }
    }

    func setPreferences(
        interests: Set<KnowledgeInterest>,
        preparationMode: AutomaticPreparationMode
    ) throws {
        try commit {
            $0.interests = interests
            $0.preparationMode = preparationMode
        }
    }

    func setModelAccessMode(_ mode: ModelAccessMode) throws {
        if state.modelAccessMode != mode {
            invalidateAutomaticDiscoveryRun()
            invalidateRemoteCardSync()
        }
        try commit { $0.modelAccessMode = mode }
    }

    func markScan(at date: Date) throws {
        try commit { $0.lastIncrementalScanAt = date }
    }

    func beginAutomaticDiscoveryRun() -> Bool {
        guard !automaticDiscoveryRunActive else { return false }
        automaticDiscoveryRunActive = true
        return true
    }

    func endAutomaticDiscoveryRun() {
        automaticDiscoveryRun?.cancel()
        automaticDiscoveryRun = nil
        automaticDiscoveryRunActive = false
    }

    func acquireAutomaticDiscoveryRun(
        authorizationCheck: @escaping @Sendable (String?) -> Bool
    ) -> AutomaticDiscoveryRun? {
        guard state.automaticDiscoveryEnabled, !automaticDiscoveryRunActive else { return nil }
        let run = AutomaticDiscoveryRun(authorizationCheck: authorizationCheck)
        automaticDiscoveryRun = run
        automaticDiscoveryRunActive = true
        return run
    }

    func endAutomaticDiscoveryRun(_ run: AutomaticDiscoveryRun) {
        guard automaticDiscoveryRun === run else { return }
        endAutomaticDiscoveryRun()
    }

    func invalidateAutomaticDiscoveryRun() {
        // Keep the exclusive slot until the old owner actually exits. A quick
        // pause/resume must neither revive it nor allow overlapping requests.
        automaticDiscoveryRun?.cancel()
    }

    func validateAutomaticDiscoveryRun(_ run: AutomaticDiscoveryRun?) throws {
        guard let run else { return }
        guard automaticDiscoveryRun === run, state.automaticDiscoveryEnabled else {
            throw CancellationError()
        }
        try run.check()
    }

    func reserveDiscoveryInspection(day: String, run: AutomaticDiscoveryRun) throws {
        try validateAutomaticDiscoveryRun(run)
        var record = state.dailyPreparations[day] ?? DailyPreparationRecord(day: day, status: .preparing)
        guard record.inspectedPhotoCount < AutomaticDiscoveryRunner.dailyInspectionLimit else {
            throw CancellationError()
        }
        record.inspectedPhotoCount = max(0, record.inspectedPhotoCount) + 1
        record.lastAttemptAt = Date()
        try savePreparation(record, discoveryRun: run)
    }

    @discardableResult
    func reserveDiscoveryCloudPhoto(day: String, run: AutomaticDiscoveryRun) throws -> UUID {
        try validateAutomaticDiscoveryRun(run)
        var record = state.dailyPreparations[day] ?? DailyPreparationRecord(day: day, status: .preparing)
        guard record.aiPhotoCount < AutomaticDiscoveryRunner.dailyCloudPhotoLimit else {
            throw ProductError.dailyAnalysisLimitReached
        }
        // Charge before dispatch, not after the response: cancellation, failure,
        // or process death must not reset a potentially consumed upload budget.
        record.aiPhotoCount = max(0, record.aiPhotoCount) + 1
        let reservationID = UUID()
        record.cloudPhotoReservationIDs = (record.cloudPhotoReservationIDs ?? []).union([reservationID])
        record.lastAttemptAt = Date()
        try savePreparation(record, discoveryRun: run)
        return reservationID
    }

    func checkpointManagedPhoto(
        candidate: PhotoCandidateRecord, sanitizedJPEG: Data, day: String,
        run: AutomaticDiscoveryRun, now: Date = Date()
    ) throws -> PhotoCandidateRecord {
        try validateAutomaticDiscoveryRun(run)
        try run.check(localIdentifier: candidate.localIdentifier)
        if let existing = state.candidates.first(where: { $0.id == candidate.id }), existing.hasPendingManagedDispatch {
            guard imageData(candidateToken: candidate.id) == sanitizedJPEG else {
                throw ProductError.localStorageUnavailable
            }
        }
        if let existing = state.candidates.first(where: { $0.id == candidate.id }),
           existing.hasPendingManagedDispatch,
           let dispatch = existing.managedDispatch, dispatch.isReplayable(at: now),
           state.dailyPreparations[dispatch.day]?.cloudPhotoReservationIDs?.contains(dispatch.reservationID) == true,
           imageData(candidateToken: candidate.id) == sanitizedJPEG {
            return existing
        }
        var record = state.dailyPreparations[day] ?? DailyPreparationRecord(day: day, status: .preparing)
        guard record.aiPhotoCount < AutomaticDiscoveryRunner.dailyCloudPhotoLimit else {
            throw ProductError.dailyAnalysisLimitReached
        }
        var checkpoint = candidate
        let reservationID = UUID()
        checkpoint.state = .uploaded
        checkpoint.updatedAt = now
        checkpoint.managedDispatch = ManagedPhotoDispatch(day: day, reservationID: reservationID, createdAt: now)
        record.aiPhotoCount = max(0, record.aiPhotoCount) + 1
        record.cloudPhotoReservationIDs = (record.cloudPhotoReservationIDs ?? []).union([reservationID])
        record.lastAttemptAt = now
        let image = imageURL(candidateToken: candidate.id)
        let previousImage = imageData(candidateToken: candidate.id)
        // Bytes precede one atomic state commit containing BOTH identity and
        // allowance. No network dispatch is allowed until this returns.
        do {
            try storeImage(sanitizedJPEG, candidateToken: candidate.id, discoveryRun: run)
            try commit {
                $0.dailyPreparations[day] = record
                $0.candidates.removeAll { $0.id == candidate.id || (
                    candidate.localIdentifier != nil && $0.localIdentifier == candidate.localIdentifier
                ) }
                $0.candidates.append(checkpoint)
                if let identifier = candidate.localIdentifier { $0.processedLocalIdentifiers.insert(identifier) }
                if $0.candidates.count > 500 {
                    $0.candidates.sort(by: Self.retainsCandidateBefore)
                    $0.candidates = Array($0.candidates.prefix(500))
                }
            }
        } catch {
            if let previousImage {
                try? previousImage.write(to: image, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            } else { try? FileManager.default.removeItem(at: image) }
            throw error
        }
        return checkpoint
    }

    func rejectManagedCloudPhotoReservation(
        day: String, reservationID: UUID, run: AutomaticDiscoveryRun, now: Date = Date()
    ) throws {
        try validateAutomaticDiscoveryRun(run)
        guard var record = state.dailyPreparations[day],
              record.cloudPhotoReservationIDs?.remove(reservationID) != nil else { return }
        // One durable reservation can be released once, and only on the
        // gateway's explicit pre-AI daily-dispatch rejection. Never refund a
        // timeout, cancellation, unclassified 429, or an old unknown attempt.
        record.aiPhotoCount = max(0, record.aiPhotoCount - 1)
        record.status = .retryableFailure
        record.lastAttemptAt = now
        try commit {
            $0.dailyPreparations[day] = record
            $0.managedDispatchResumeAt = ChinaDay.adding(days: 1, to: now)
            for index in $0.candidates.indices
                where $0.candidates[index].managedDispatch?.reservationID == reservationID {
                $0.candidates[index].managedDispatch = nil
                $0.candidates[index].state = .failed
            }
        }
    }

    func markDailySelection(day: String, scannedAt: Date) throws {
        try commit {
            $0.dailyPreparations[day] = DailyPreparationRecord(
                day: day,
                status: .noNewCard,
                lastAttemptAt: scannedAt
            )
            $0.lastIncrementalScanAt = scannedAt
        }
    }

    @discardableResult
    func recoverPrematureEmptyPreparation(now: Date, discoveryRun: AutomaticDiscoveryRun? = nil) throws -> Bool {
        try validateAutomaticDiscoveryRun(discoveryRun)
        let today = ChinaDay.string(from: now)
        let lastDay = ChinaDay.string(from: ChinaDay.adding(days: 6, to: now))
        guard state.automaticDiscoveryEnabled else { return false }
        var recovered: [String: DailyPreparationRecord] = [:]
        for (day, original) in state.dailyPreparations where day >= today && day <= lastDay {
            guard original.status == .noNewCard,
                  original.selectedCardID == nil, original.qualifiedCardIDs.isEmpty,
                  let attemptedAt = original.lastAttemptAt,
                  ChinaDay.string(from: attemptedAt) < today else { continue }
            var record = original
            if let previous = record.previousAdvanceAttempt {
                record.earlierAdvanceAttempts = (record.earlierAdvanceAttempts ?? []) + [previous]
            }
            record.previousAdvanceAttempt = AdvancePreparationAttempt(
                inspectedPhotoCount: record.inspectedPhotoCount, aiPhotoCount: record.aiPhotoCount,
                lastAttemptAt: attemptedAt, recoveredAt: now
            )
            record.status = .queued
            record.inspectedPhotoCount = 0
            record.aiPhotoCount = 0
            record.cloudPhotoReservationIDs = nil
            record.lastAttemptAt = nil
            recovered[day] = record
        }
        guard !recovered.isEmpty else { return false }
        // Repair the rolling window, not just today, or tomorrow's legacy
        // failure still stops cache refill. Same-day repeats never reset it.
        try commit { $0.dailyPreparations.merge(recovered) { _, updated in updated } }
        return true
    }

    func savePreparation(_ record: DailyPreparationRecord, discoveryRun: AutomaticDiscoveryRun? = nil) throws {
        try validateAutomaticDiscoveryRun(discoveryRun)
        try commit {
            var updated = record
            updated.previousAdvanceAttempt = $0.dailyPreparations[record.day]?.previousAdvanceAttempt
                ?? record.previousAdvanceAttempt
            updated.earlierAdvanceAttempts = $0.dailyPreparations[record.day]?.earlierAdvanceAttempts
                ?? record.earlierAdvanceAttempts
            updated.cloudPhotoReservationIDs = record.cloudPhotoReservationIDs
                ?? $0.dailyPreparations[record.day]?.cloudPhotoReservationIDs
            $0.dailyPreparations[record.day] = updated
            $0.lastIncrementalScanAt = record.lastAttemptAt ?? $0.lastIncrementalScanAt
            // Seven future days plus a small migration/retry margin is enough
            // for runtime state; surfaced cards and history live elsewhere.
            let retainedDays = $0.dailyPreparations.keys.sorted().suffix(14)
            let retained = Set(retainedDays)
            $0.dailyPreparations = $0.dailyPreparations.filter { retained.contains($0.key) }
        }
    }

    @discardableResult
    func adoptKnowledgeCatalogRevision(_ revision: String, discoveryRun: AutomaticDiscoveryRun? = nil) throws -> Int {
        try validateAutomaticDiscoveryRun(discoveryRun)
        let normalized = revision.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalized.isEmpty, state.knowledgeCatalogRevision != normalized else { return 0 }
        let retryableLocalIDs = state.exhaustedLocalIdentifiers
        let retryableTokens = Set<UUID>(state.candidates.compactMap { candidate -> UUID? in
            guard candidate.state == .exhausted || candidate.state == .noMatch,
                  let localIdentifier = candidate.localIdentifier,
                  retryableLocalIDs.contains(localIdentifier) else { return nil }
            return candidate.id
        })
        try commit {
            $0.processedLocalIdentifiers.subtract(retryableLocalIDs)
            $0.candidates.removeAll { retryableTokens.contains($0.id) }
            $0.exhaustedLocalIdentifiers.removeAll()
            $0.knowledgeCatalogRevision = normalized
        }
        let retainedCardTokens = Set(state.cards.map(\.candidateToken))
        for token in retryableTokens where !retainedCardTokens.contains(token) {
            try? FileManager.default.removeItem(at: imageURL(candidateToken: token))
        }
        return retryableLocalIDs.count
    }

    func deferUnavailableFailedCandidates(candidateIDs: Set<UUID>, discoveryRun: AutomaticDiscoveryRun) throws {
        try validateAutomaticDiscoveryRun(discoveryRun)
        let failedIDs = Set(state.candidates.filter { $0.state == .failed || $0.hasPendingManagedDispatch }.map(\.id))
        let deferredIDs = candidateIDs.intersection(failedIDs)
        guard !deferredIDs.isEmpty else { return }
        let now = Date()
        // This only schedules local retries; it must also work for an asset
        // removed from limited access. It never reads bytes or changes identity,
        // processing state, permission, or reserved inspection/upload counts.
        try commit {
            for index in $0.candidates.indices where deferredIDs.contains($0.candidates[index].id) {
                $0.candidates[index].updatedAt = now
            }
        }
    }

    func upsert(candidate: PhotoCandidateRecord, discoveryRun: AutomaticDiscoveryRun? = nil) throws {
        try validateAutomaticDiscoveryRun(discoveryRun)
        try discoveryRun?.check(localIdentifier: candidate.localIdentifier)
        var removedTokens = Set<UUID>()
        try commit {
            $0.candidates.removeAll { $0.id == candidate.id || (
                candidate.localIdentifier != nil && $0.localIdentifier == candidate.localIdentifier
            ) }
            $0.candidates.append(candidate)
            if let localIdentifier = candidate.localIdentifier {
                $0.processedLocalIdentifiers.insert(localIdentifier)
                if candidate.state == .exhausted || candidate.state == .noMatch {
                    $0.exhaustedLocalIdentifiers.insert(localIdentifier)
                } else {
                    $0.exhaustedLocalIdentifiers.remove(localIdentifier)
                }
            }
            if $0.candidates.count > 500 {
                $0.candidates.sort(by: Self.retainsCandidateBefore)
                removedTokens = Set($0.candidates.dropFirst(500).map(\.id))
                $0.candidates = Array($0.candidates.prefix(500))
            }
        }
        let retainedCardTokens = Set(state.cards.map(\.candidateToken))
        for token in removedTokens where !retainedCardTokens.contains(token) {
            let image = imageURL(candidateToken: token)
            if FileManager.default.fileExists(atPath: image.path) {
                try FileManager.default.removeItem(at: image)
            }
        }
    }

    func upsert(
        candidate: PhotoCandidateRecord,
        card: KnowledgeCard,
        sanitizedJPEG: Data,
        discoveryRun: AutomaticDiscoveryRun? = nil
    ) throws {
        try validateAutomaticDiscoveryRun(discoveryRun)
        try discoveryRun?.check(localIdentifier: candidate.localIdentifier)
        let replacedCards = state.cards.filter {
            $0.id == card.id || (
                $0.factID == card.factID &&
                    !$0.isWithdrawn &&
                    !$0.isPublished &&
                    $0.scheduledDay.isEmpty &&
                    !state.savedCardIDs.contains($0.id)
            )
        }
        let replacedCardIDs = Set(replacedCards.map(\.id))
        let remainingCards = state.cards.filter { !replacedCardIDs.contains($0.id) }
        let staleImageTokens = Set(replacedCards.compactMap { old in
            old.candidateToken != card.candidateToken &&
                !remainingCards.contains(where: { $0.candidateToken == old.candidateToken })
                ? old.candidateToken
                : nil
        })
        let cardImageURL = imageURL(candidateToken: card.candidateToken)
        let previousImage = try? Data(contentsOf: cardImageURL)
        try FileManager.default.createDirectory(
            at: imageDirectoryURL,
            withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
        )
        try sanitizedJPEG.write(
            to: cardImageURL,
            options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
        )

        var trimmedCandidateTokens = Set<UUID>()
        do {
            try commit {
                $0.candidates.removeAll { $0.id == candidate.id || (
                    candidate.localIdentifier != nil && $0.localIdentifier == candidate.localIdentifier
                ) }
                $0.candidates.append(candidate)
                if let localIdentifier = candidate.localIdentifier {
                    $0.processedLocalIdentifiers.insert(localIdentifier)
                    $0.exhaustedLocalIdentifiers.remove(localIdentifier)
                }
                if $0.candidates.count > 500 {
                    $0.candidates.sort(by: Self.retainsCandidateBefore)
                    trimmedCandidateTokens = Set($0.candidates.dropFirst(500).map(\.id))
                    $0.candidates = Array($0.candidates.prefix(500))
                }
                $0.cards.removeAll { replacedCardIDs.contains($0.id) }
                $0.cards.append(card)
                $0.cards.sort { $0.scheduledDay < $1.scheduledDay }
            }
        } catch {
            if let previousImage {
                try? previousImage.write(
                    to: cardImageURL,
                    options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
                )
            } else {
                try? FileManager.default.removeItem(at: cardImageURL)
            }
            throw error
        }

        let retainedCardTokens = Set(state.cards.map(\.candidateToken))
        for token in staleImageTokens.union(trimmedCandidateTokens)
            where !retainedCardTokens.contains(token) {
            let image = imageURL(candidateToken: token)
            if FileManager.default.fileExists(atPath: image.path) {
                try FileManager.default.removeItem(at: image)
            }
        }
    }

    func upsert(card: KnowledgeCard, sanitizedJPEG: Data?) throws {
        let replaced = state.cards.filter {
            $0.id == card.id || (
                $0.factID == card.factID &&
                    !$0.isWithdrawn &&
                    !$0.isPublished &&
                    $0.scheduledDay.isEmpty &&
                !state.savedCardIDs.contains($0.id)
            )
        }
        let cardImageURL = imageURL(candidateToken: card.candidateToken)
        let previousImage = sanitizedJPEG.flatMap { _ in try? Data(contentsOf: cardImageURL) }
        if let sanitizedJPEG {
            try FileManager.default.createDirectory(
                at: imageDirectoryURL,
                withIntermediateDirectories: true,
                attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
            )
            try sanitizedJPEG.write(
                to: cardImageURL,
                options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
            )
        }
        let replacedIDs = Set(replaced.map(\.id))
        let remainingCards = state.cards.filter { !replacedIDs.contains($0.id) }
        let staleImageTokens = Set(replaced.compactMap { old in
            old.candidateToken != card.candidateToken &&
                !remainingCards.contains(where: { $0.candidateToken == old.candidateToken })
                ? old.candidateToken
                : nil
        })
        do {
            try commit {
                $0.cards.removeAll { replacedIDs.contains($0.id) }
                $0.cards.append(card)
                $0.cards.sort { $0.scheduledDay < $1.scheduledDay }
            }
        } catch {
            if sanitizedJPEG != nil {
                if let previousImage {
                    try? previousImage.write(
                        to: cardImageURL,
                        options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
                    )
                } else {
                    try? FileManager.default.removeItem(at: cardImageURL)
                }
            }
            throw error
        }
        for token in staleImageTokens {
            try? FileManager.default.removeItem(at: imageURL(candidateToken: token))
        }
    }

    func finalizeDailySelection(
        day: String,
        selectedCardID: UUID?,
        candidateIDs: Set<UUID>,
        inspectedPhotoCount: Int = 0,
        aiPhotoCount: Int = 0,
        scannedAt: Date,
        discoveryRun: AutomaticDiscoveryRun? = nil
    ) throws {
        try validateAutomaticDiscoveryRun(discoveryRun)
        // The runner's snapshot precedes an actor hop. A user can hide its
        // winner during that hop; reject it before scheduling any batch card.
        if let selectedCardID {
            guard !state.hiddenCardIDs.contains(selectedCardID),
                  state.cards.contains(where: { $0.id == selectedCardID && !$0.isWithdrawn }) else {
                throw ProductError.invalidServerResponse
            }
        }
        let selectedCandidateToken = state.cards.first(where: { $0.id == selectedCardID })?.candidateToken
        let affectedCandidateIDs = selectedCandidateToken.map { candidateIDs.union([$0]) } ?? candidateIDs
        try commit {
            for index in $0.cards.indices where affectedCandidateIDs.contains($0.cards[index].candidateToken) {
                guard !$0.cards[index].isWithdrawn else { continue }
                let selected = $0.cards[index].id == selectedCardID
                guard selected || candidateIDs.contains($0.cards[index].candidateToken) else { continue }
                $0.cards[index] = $0.cards[index].withPresentation(
                    status: selected ? "scheduled" : "candidate",
                    // All good cards from the same daily batch keep the batch day.
                    // The winner is shown first; the other two remain eligible for
                    // that day's two explicit swaps and no later day can borrow them.
                    scheduledDay: day
                )
            }
            for index in $0.candidates.indices where affectedCandidateIDs.contains($0.candidates[index].id) {
                let candidateID = $0.candidates[index].id
                let isSelected = $0.cards.contains(where: {
                    $0.candidateToken == candidateID && $0.id == selectedCardID
                })
                let hasCard = $0.cards.contains(where: { $0.candidateToken == candidateID })
                if isSelected {
                    $0.candidates[index].state = .selected
                } else if hasCard {
                    $0.candidates[index].state = .knowledgeReady
                }
                $0.candidates[index].updatedAt = scannedAt
            }
            let qualifiedCardIDs = $0.cards
                .filter { candidateIDs.contains($0.candidateToken) && $0.scheduledDay == day && !$0.isWithdrawn }
                .map(\.id)
            $0.dailyPreparations[day] = DailyPreparationRecord(
                day: day,
                status: selectedCardID == nil ? .noNewCard : .ready,
                inspectedPhotoCount: inspectedPhotoCount,
                aiPhotoCount: aiPhotoCount,
                qualifiedCardIDs: qualifiedCardIDs,
                selectedCardID: selectedCardID,
                lastAttemptAt: scannedAt,
                previousAdvanceAttempt: $0.dailyPreparations[day]?.previousAdvanceAttempt,
                earlierAdvanceAttempts: $0.dailyPreparations[day]?.earlierAdvanceAttempts,
                cloudPhotoReservationIDs: $0.dailyPreparations[day]?.cloudPhotoReservationIDs
            )
            $0.lastIncrementalScanAt = scannedAt
        }
    }

    @discardableResult
    func publishCardImmediately(cardID: UUID, day: String, publishedAt: Date) throws -> Bool {
        guard let cardIndex = state.cards.firstIndex(where: { $0.id == cardID && !$0.isWithdrawn }),
              let candidateIndex = state.candidates.firstIndex(where: {
                  $0.id == state.cards[cardIndex].candidateToken
              }) else {
            return false
        }
        try commit {
            $0.cards[cardIndex] = $0.cards[cardIndex].withPresentation(
                status: "scheduled",
                scheduledDay: day
            )
            $0.candidates[candidateIndex].state = .selected
            $0.candidates[candidateIndex].updatedAt = publishedAt
        }
        return true
    }

    func recoverLatestImportedCard(day: String, recoveredAt: Date) throws -> UUID? {
        let importedReadyCandidateIDs = Set(
            state.candidates
                .filter { $0.localIdentifier == nil && $0.state == .knowledgeReady }
                .map(\.id)
        )
        let recoverableCards = state.cards.filter {
            !$0.isWithdrawn && $0.status == "candidate" && importedReadyCandidateIDs.contains($0.candidateToken)
        }
        guard let card = recoverableCards.max(by: { $0.createdAt < $1.createdAt }) else {
            return nil
        }
        guard try publishCardImmediately(cardID: card.id, day: day, publishedAt: recoveredAt) else {
            return nil
        }
        return card.id
    }

    @discardableResult
    func repairImportedPhotoProvenance() throws -> Int {
        let importedCandidateIDs = Set(
            state.candidates
                .filter { $0.localIdentifier == nil }
                .map(\.id)
        )
        let repaired = state.cards.indices.filter { index in
            let card = state.cards[index]
            let context = "它来自你保存的照片，所以今天从「\(card.objectName)」讲起。"
            return importedCandidateIDs.contains(card.candidateToken) && card.personalContext != context
        }
        if !repaired.isEmpty {
            try commit {
                for index in repaired {
                    let card = $0.cards[index]
                    let context = "它来自你保存的照片，所以今天从「\(card.objectName)」讲起。"
                    $0.cards[index] = card.withPersonalContext(context)
                }
            }
        }
        return repaired.count
    }

    func invalidateRemoteCardSync() {
        remoteCardSyncGeneration = UUID()
    }

    func remoteCardSyncToken() throws -> UUID {
        try validateRemoteCardSync(remoteCardSyncGeneration)
        return remoteCardSyncGeneration
    }

    func validateRemoteCardSync(_ token: UUID) throws {
        try Task.checkCancellation()
        guard token == remoteCardSyncGeneration,
              state.onboardingCompleted, state.modelAccessMode == .managed else {
            throw CancellationError()
        }
    }

    func replaceRemoteCards(_ cards: [KnowledgeCard], syncToken: UUID) throws {
        // Check at the same actor-isolated boundary as the write. Returning to
        // managed mode or onboarding after a clear cannot revive an old fetch.
        try validateRemoteCardSync(syncToken)
        // The remote list is an update stream, not a deletion manifest. The
        // service can omit archived runner-ups and older pages, while those
        // cards may still be today's swap candidates or local history. Only an
        // explicit local hide/delete is authoritative for removal.
        try commit { stored in
            let visibleRemote = cards.filter { !stored.hiddenCardIDs.contains($0.id) }
            let localByID = Dictionary(uniqueKeysWithValues: stored.cards.map { ($0.id, $0) })
            let importedCandidateIDs = Set(
                stored.candidates
                    .filter { $0.localIdentifier == nil }
                    .map(\.id)
            )
            var remoteByID: [UUID: KnowledgeCard] = [:]
            for remoteCard in visibleRemote {
                guard let localCard = localByID[remoteCard.id] else {
                    remoteByID[remoteCard.id] = remoteCard
                    continue
                }
                // The backend still allocates one scheduled date per completed
                // card, while the iOS product owns the three-card daily pool and
                // manual presentation date. Refresh remote knowledge content, but
                // never let that legacy schedule overwrite a local assignment.
                var merged = remoteCard.withPresentation(
                    status: localCard.status,
                    scheduledDay: localCard.scheduledDay
                )
                if importedCandidateIDs.contains(localCard.candidateToken) {
                    merged = merged.withPersonalContext(localCard.personalContext)
                }
                remoteByID[remoteCard.id] = merged
            }
            let preservedLocal = stored.cards
                .filter { remoteByID[$0.id] == nil && !stored.hiddenCardIDs.contains($0.id) }
            stored.cards = Array(remoteByID.values) + preservedLocal
            stored.cards.sort {
                if $0.scheduledDay != $1.scheduledDay { return $0.scheduledDay < $1.scheduledDay }
                return $0.createdAt < $1.createdAt
            }
        }
    }

    func setSaved(_ saved: Bool, cardID: UUID) throws {
        try commit {
            if saved { $0.savedCardIDs.insert(cardID) } else { $0.savedCardIDs.remove(cardID) }
        }
    }

    func recordFeedback(cardID: UUID, action: FeedbackAction) throws -> PendingFeedback {
        let pending = PendingFeedback(id: UUID(), cardID: cardID, action: action, createdAt: Date())
        try commit {
            $0.feedbackByCardID[cardID] = action
            $0.pendingFeedback.removeAll { $0.cardID == cardID && $0.action == action }
            $0.pendingFeedback.append(pending)
        }
        return pending
    }

    func confirmFeedback(_ pendingID: UUID) throws {
        try commit { $0.pendingFeedback.removeAll { $0.id == pendingID } }
    }

    func hideCard(_ cardID: UUID, candidateToken: UUID, neverAnalyze: Bool) throws {
        let image = imageURL(candidateToken: candidateToken)
        if FileManager.default.fileExists(atPath: image.path) {
            try FileManager.default.removeItem(at: image)
        }
        try commit {
            $0.hiddenCardIDs.insert(cardID)
            $0.cards.removeAll { $0.id == cardID }
            $0.savedCardIDs.remove(cardID)
            if neverAnalyze,
               let index = $0.candidates.firstIndex(where: { $0.id == candidateToken }) {
                $0.candidates[index].state = .neverAnalyze
                $0.candidates[index].updatedAt = Date()
            }
            Self.reconcilePreparedCards(in: &$0)
        }
    }

    @discardableResult
    private static func applyKnownCorrections(in state: inout PersistedAppState) -> Bool {
        var changed = false
        for index in state.cards.indices {
            let updated = KnowledgeCorrectionCatalog.applying(to: state.cards[index])
            if updated != state.cards[index] {
                state.cards[index] = updated
                changed = true
            }
        }
        return changed
    }

    @discardableResult
    private static func reconcilePreparedCards(in state: inout PersistedAppState) -> Bool {
        let available = state.cards.filter { !state.hiddenCardIDs.contains($0.id) && !$0.isWithdrawn }
        let availableIDs = Set(available.map(\.id))
        var changed = false
        for day in Array(state.dailyPreparations.keys) {
            guard var record = state.dailyPreparations[day] else { continue }
            let original = record
            record.qualifiedCardIDs.removeAll { !availableIDs.contains($0) }
            if record.status == .ready,
               !available.contains(where: { $0.id == record.selectedCardID && $0.scheduledDay == day }) {
                // An alternate belongs to this date, not tomorrow's cache or
                // an unassigned in-flight batch. Preserve its existing order.
                let replacement = record.qualifiedCardIDs.lazy.compactMap { id in
                    available.first { $0.id == id && $0.scheduledDay == day }
                }.first
                record.selectedCardID = replacement?.id
                record.status = replacement == nil ? .queued : .ready
                if let replacement,
                   let index = state.cards.firstIndex(where: { $0.id == replacement.id }) {
                    state.cards[index] = replacement.withPresentation(status: "scheduled", scheduledDay: day)
                    if let candidate = state.candidates.firstIndex(where: { $0.id == replacement.candidateToken }) {
                        state.candidates[candidate].state = .selected
                    }
                }
            }
            if record != original {
                state.dailyPreparations[day] = record
                changed = true
            }
        }
        return changed
    }

    func imageData(candidateToken: UUID) -> Data? {
        try? Data(contentsOf: imageURL(candidateToken: candidateToken))
    }

    func storeImage(_ data: Data, candidateToken: UUID, discoveryRun: AutomaticDiscoveryRun? = nil) throws {
        try validateAutomaticDiscoveryRun(discoveryRun)
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

    func removeImage(candidateToken: UUID, discoveryRun: AutomaticDiscoveryRun? = nil) throws {
        try validateAutomaticDiscoveryRun(discoveryRun)
        let image = imageURL(candidateToken: candidateToken)
        if FileManager.default.fileExists(atPath: image.path) {
            try FileManager.default.removeItem(at: image)
        }
    }

    @discardableResult
    func removeOrphanedImages() throws -> Int {
        guard FileManager.default.fileExists(atPath: imageDirectoryURL.path) else { return 0 }
        let retainedTokens = Set(state.cards.map(\.candidateToken)).union(
            state.candidates.filter { $0.state == .failed || $0.hasPendingManagedDispatch }.map(\.id)
        )
        let retainedNames = Set(retainedTokens.map { $0.uuidString.lowercased() + ".jpg" })
        let images = try FileManager.default.contentsOfDirectory(
            at: imageDirectoryURL,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        )
        var removed = 0
        for image in images
            where image.pathExtension.lowercased() == "jpg" && !retainedNames.contains(image.lastPathComponent.lowercased()) {
            try FileManager.default.removeItem(at: image)
            removed += 1
        }
        return removed
    }

    func deleteLocalData() throws {
        invalidateAutomaticDiscoveryRun()
        invalidateRemoteCardSync()
        let modelAccessMode = state.modelAccessMode
        if FileManager.default.fileExists(atPath: rootURL.path) {
            try FileManager.default.removeItem(at: rootURL)
        }
        state = .empty
        // The Key is intentionally kept in Keychain. Clearing photo data must
        // not silently choose platform billing when onboarding starts again.
        state.modelAccessMode = modelAccessMode
        try persist()
    }

    private static func retainsCandidateBefore(_ lhs: PhotoCandidateRecord, _ rhs: PhotoCandidateRecord) -> Bool {
        if lhs.hasPendingManagedDispatch != rhs.hasPendingManagedDispatch { return lhs.hasPendingManagedDispatch }
        return lhs.updatedAt > rhs.updatedAt
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
        try? data.write(
            to: backupStateURL,
            options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
        )
    }

    @discardableResult
    private func commit<T>(_ mutation: (inout PersistedAppState) throws -> T) throws -> T {
        let previous = state
        do {
            let result = try mutation(&state)
            Self.applyKnownCorrections(in: &state)
            if state.cards.contains(where: \.isWithdrawn) {
                Self.reconcilePreparedCards(in: &state)
            }
            try persist()
            return result
        } catch {
            state = previous
            throw error
        }
    }
}
