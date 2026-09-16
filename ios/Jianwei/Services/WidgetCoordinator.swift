import Foundation
import WidgetKit

struct WidgetCoordinator: Sendable {
    static let maximumThumbnailSide = CGFloat(SharedWidgetStore.maximumThumbnailSide)

    let repository: LocalRepository
    private let sharedStore: SharedWidgetStore?

    init(repository: LocalRepository, sharedStore: SharedWidgetStore? = nil) {
        self.repository = repository
        self.sharedStore = sharedStore
    }

    func makeStore() throws -> SharedWidgetStore {
        try sharedStore ?? SharedWidgetStore()
    }

    static func presentationCards(
        from cards: [KnowledgeCard],
        previouslyPresentedIDs: Set<UUID>,
        now: Date = Date()
    ) -> [KnowledgeCard] {
        let today = ChinaDay.string(from: now)
        let lastCachedDay = ChinaDay.string(from: ChinaDay.adding(days: 6, to: now))
        // Cache each prepared day's runner-ups too: widget swaps must work
        // without the app waking up to copy them on that day.
        return cards.filter {
            $0.isWithdrawn || $0.isPublished || previouslyPresentedIDs.contains($0.id) ||
                ($0.status == "candidate" && $0.scheduledDay >= today && $0.scheduledDay <= lastCachedDay)
        }
    }

    func synchronize(discoveryRun: AutomaticDiscoveryRun? = nil) async throws {
        let store = try makeStore()
        // Never accept a caller's old card list. Image preparation suspends, so
        // also validate the snapshot at the final actor-isolated write. A hide
        // or deletion must finish either before this write or after it, never
        // between validation and writing. Keep compression outside the actor.
        for _ in 0..<3 {
            try Task.checkCancellation()
            try discoveryRun?.check()
            let repositoryState = await repository.snapshot()
            let manualCandidateIDs = Set(repositoryState.candidates.filter { $0.localIdentifier == nil }.map(\.id))
            let sharedState = try? store.load()
            let previouslyPresentedIDs = Set(sharedState?.presentations.map(\.cardID) ?? [])
            let cards = Self.presentationCards(from: repositoryState.cards, previouslyPresentedIDs: previouslyPresentedIDs)
            var thumbnails: [UUID: Data] = [:]
            var thumbnailReceipts: [UUID: WidgetThumbnailReceipt] = [:]
            for card in cards {
                try Task.checkCancellation()
                try discoveryRun?.check()
                guard thumbnails[card.candidateToken] == nil else { continue }
                if let data = await repository.imageData(candidateToken: card.candidateToken),
                   let thumbnail = try? store.prepareThumbnail(
                    source: data, candidateToken: card.candidateToken,
                    previousReceipt: sharedState?.thumbnailReceipts[card.candidateToken],
                    render: { try ImageSanitizer().sanitize($0, maximumSide: Self.maximumThumbnailSide).jpeg }
                   ) {
                    thumbnails[card.candidateToken] = thumbnail.data
                    thumbnailReceipts[card.candidateToken] = thumbnail.receipt
                }
            }
            if try await repository.commitWidgetProjection(
                expectedCards: repositoryState.cards,
                expectedManualCandidateIDs: manualCandidateIDs,
                snapshots: cards.compactMap { $0.widgetSnapshot(isManualImport: manualCandidateIDs.contains($0.candidateToken)) },
                thumbnails: thumbnails, thumbnailReceipts: thumbnailReceipts,
                store: store, discoveryRun: discoveryRun
            ) {
                WidgetCenter.shared.reloadTimelines(ofKind: SharedConstants.widgetKind)
                return
            }
        }
        // Ongoing edits won all bounded attempts; let the caller report and
        // retry synchronization instead of declaring a stale cache up to date.
        throw CancellationError()
    }
}

extension LocalRepository {
    func commitWidgetProjection(
        expectedCards: [KnowledgeCard], expectedManualCandidateIDs: Set<UUID>,
        snapshots: [WidgetCardSnapshot], thumbnails: [UUID: Data],
        thumbnailReceipts: [UUID: WidgetThumbnailReceipt] = [:],
        store: SharedWidgetStore, discoveryRun: AutomaticDiscoveryRun? = nil
    ) throws -> Bool {
        try validateAutomaticDiscoveryRun(discoveryRun)
        try Task.checkCancellation()
        let current = snapshot()
        guard current.cards == expectedCards,
              Set(current.candidates.filter { $0.localIdentifier == nil }.map(\.id)) == expectedManualCandidateIDs else {
            return false
        }
        // Only cards still present in the repository protect shared history:
        // a newly seen runner-up must survive, but a hidden/deleted card must not.
        let retainedCardIDs = Set(current.cards.map(\.id))
        var committed = false
        let write = {
            committed = try store.replaceCards(
                snapshots, thumbnails: thumbnails, thumbnailReceipts: thumbnailReceipts,
                preservingPresentationsFor: retainedCardIDs
            )
        }
        if let discoveryRun {
            try discoveryRun.commitWidget(write)
        } else {
            try write()
        }
        return committed
    }
}
