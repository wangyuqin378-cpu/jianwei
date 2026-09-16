import Foundation
import CoreGraphics

enum KnowledgeEvidenceKind: String, Codable, Hashable, Sendable {
    case modelKnowledge
    case reviewedCatalog
    case webVerified
    case referenced

    var label: String {
        switch self {
        case .modelKnowledge: "AI 生成，未联网核实"
        case .reviewedCatalog: "来自已审核知识库"
        case .webVerified: "已联网查证"
        case .referenced: "附有参考来源"
        }
    }

    var symbol: String {
        switch self {
        case .modelKnowledge: "sparkles"
        case .reviewedCatalog, .webVerified: "checkmark.seal.fill"
        case .referenced: "book.closed"
        }
    }

    static func resolved(_ declared: Self?, hasSource: Bool) -> Self {
        // Missing evidence must never render as verified, including migrated cards.
        hasSource ? (declared ?? .referenced) : .modelKnowledge
    }
}

struct WidgetSourceSnapshot: Codable, Hashable, Sendable {
    let title: String
    let publisher: String
    let url: URL
}

struct KnowledgeCorrectionNotice: Codable, Hashable, Sendable {
    let id: String
    let reason: String
    let sourceURL: URL
    let issuedDay: String
}

struct WidgetCardSnapshot: Codable, Hashable, Identifiable, Sendable {
    let id: UUID
    let candidateToken: UUID
    let topicID: String
    let objectName: String
    let title: String
    let body: String
    let personalContext: String
    let confidence: Double
    let scheduledDay: String
    let presentationStatus: String
    let createdAt: Date
    let isManualImport: Bool
    let thumbnailFilename: String?
    let source: WidgetSourceSnapshot?
    let evidenceKind: KnowledgeEvidenceKind?
    let correction: KnowledgeCorrectionNotice?

    var isWithdrawn: Bool { correction != nil }

    var effectiveEvidenceKind: KnowledgeEvidenceKind {
        .resolved(evidenceKind, hasSource: source != nil)
    }

    var isPublished: Bool {
        presentationStatus == "scheduled" || presentationStatus == "shown"
    }

    var deepLink: URL {
        URL(string: "jianwei://card/\(id.uuidString.lowercased())")!
    }

    private enum CodingKeys: String, CodingKey {
        case id, candidateToken, topicID, objectName, title, body, personalContext
        case confidence, scheduledDay, presentationStatus, createdAt, isManualImport, thumbnailFilename, source, evidenceKind, correction
    }

    init(
        id: UUID,
        candidateToken: UUID,
        topicID: String,
        objectName: String,
        title: String,
        body: String,
        personalContext: String,
        confidence: Double,
        scheduledDay: String,
        presentationStatus: String = "scheduled",
        createdAt: Date = .distantPast,
        isManualImport: Bool = false,
        thumbnailFilename: String?,
        source: WidgetSourceSnapshot?,
        evidenceKind: KnowledgeEvidenceKind? = nil,
        correction: KnowledgeCorrectionNotice? = nil
    ) {
        self.id = id
        self.candidateToken = candidateToken
        self.topicID = topicID
        self.objectName = objectName
        self.title = title
        self.body = body
        self.personalContext = personalContext
        self.confidence = confidence
        self.scheduledDay = scheduledDay
        self.presentationStatus = presentationStatus
        self.createdAt = createdAt
        self.isManualImport = isManualImport
        self.thumbnailFilename = thumbnailFilename
        self.source = source
        self.evidenceKind = evidenceKind
        self.correction = correction
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(UUID.self, forKey: .id)
        candidateToken = try container.decode(UUID.self, forKey: .candidateToken)
        topicID = try container.decode(String.self, forKey: .topicID)
        objectName = try container.decode(String.self, forKey: .objectName)
        title = try container.decode(String.self, forKey: .title)
        body = try container.decode(String.self, forKey: .body)
        personalContext = try container.decode(String.self, forKey: .personalContext)
        confidence = try container.decode(Double.self, forKey: .confidence)
        scheduledDay = try container.decode(String.self, forKey: .scheduledDay)
        presentationStatus = try container.decodeIfPresent(String.self, forKey: .presentationStatus) ?? "scheduled"
        createdAt = try container.decodeIfPresent(Date.self, forKey: .createdAt) ?? .distantPast
        isManualImport = try container.decodeIfPresent(Bool.self, forKey: .isManualImport) ?? false
        thumbnailFilename = try container.decodeIfPresent(String.self, forKey: .thumbnailFilename)
        source = try container.decodeIfPresent(WidgetSourceSnapshot.self, forKey: .source)
        evidenceKind = try container.decodeIfPresent(KnowledgeEvidenceKind.self, forKey: .evidenceKind)
        correction = try container.decodeIfPresent(KnowledgeCorrectionNotice.self, forKey: .correction)
    }
}

enum WidgetPresentationReason: String, Codable, Hashable, Sendable {
    case daily
    case swap
    case manual
}

struct WidgetCardPresentation: Codable, Hashable, Identifiable, Sendable {
    let id: UUID
    let cardID: UUID
    let day: String
    let presentedAt: Date
    let reason: WidgetPresentationReason

    func hasOccurred(asOf now: Date) -> Bool {
        !day.isEmpty && day <= ChinaDay.string(from: now) && presentedAt <= now
    }
}

struct WidgetSwapUndoStep: Codable, Equatable, Sendable {
    let fromCardID: UUID
    let toCardID: UUID
    let at: Date
}

struct WidgetDailySelectionState: Codable, Equatable, Sendable {
    let day: String
    var pool: [UUID]
    var currentCardID: UUID
    var surfacedCardIDs: [UUID]
    var swapCount: Int
    var undoStep: WidgetSwapUndoStep?
}

enum WidgetAdvanceResult: Equatable, Sendable {
    case advanced(UUID)
    case noSelection
    case noCandidate
    case limitReached
}

struct WidgetThumbnailReceipt: Codable, Equatable, Sendable {
    let sourceDigest: String
    let thumbnailDigest: String
    let renditionVersion: String
}

struct WidgetQueueState: Codable, Equatable, Sendable {
    var cards: [WidgetCardSnapshot]
    var dailySelections: [String: WidgetDailySelectionState]
    var presentations: [WidgetCardPresentation]
    var generatedAt: Date
    var thumbnailReceipts: [UUID: WidgetThumbnailReceipt]

    // Legacy fields stay decodable for installed Beta builds. New selection
    // logic never uses them; remove them after the migration window.
    var manuallyConsumedCardIDs: Set<UUID>
    var manualOverrides: [String: UUID]
    var swapCounts: [String: Int]

    static let empty = WidgetQueueState(
        cards: [],
        dailySelections: [:],
        presentations: [],
        generatedAt: .distantPast
    )

    private enum CodingKeys: String, CodingKey {
        case cards, dailySelections, presentations, generatedAt, thumbnailReceipts
        case manuallyConsumedCardIDs, manualOverrides, swapCounts
    }

    init(
        cards: [WidgetCardSnapshot],
        dailySelections: [String: WidgetDailySelectionState],
        presentations: [WidgetCardPresentation],
        generatedAt: Date,
        manuallyConsumedCardIDs: Set<UUID> = [],
        manualOverrides: [String: UUID] = [:],
        swapCounts: [String: Int] = [:],
        thumbnailReceipts: [UUID: WidgetThumbnailReceipt] = [:]
    ) {
        self.cards = cards
        self.dailySelections = dailySelections
        self.presentations = presentations
        self.generatedAt = generatedAt
        self.manuallyConsumedCardIDs = manuallyConsumedCardIDs
        self.manualOverrides = manualOverrides
        self.swapCounts = swapCounts
        self.thumbnailReceipts = thumbnailReceipts
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        cards = try container.decodeIfPresent([WidgetCardSnapshot].self, forKey: .cards) ?? []
        dailySelections = try container.decodeIfPresent(
            [String: WidgetDailySelectionState].self,
            forKey: .dailySelections
        ) ?? [:]
        presentations = try container.decodeIfPresent(
            [WidgetCardPresentation].self,
            forKey: .presentations
        ) ?? []
        generatedAt = try container.decodeIfPresent(Date.self, forKey: .generatedAt) ?? .distantPast
        // Optional optimization metadata must never make existing cards,
        // selections or history unreadable after an upgrade or a cache error.
        thumbnailReceipts = (try? container.decodeIfPresent(
            [UUID: WidgetThumbnailReceipt].self, forKey: .thumbnailReceipts
        )) ?? [:]
        manuallyConsumedCardIDs = try container.decodeIfPresent(
            Set<UUID>.self,
            forKey: .manuallyConsumedCardIDs
        ) ?? []
        manualOverrides = try container.decodeIfPresent(
            [String: UUID].self,
            forKey: .manualOverrides
        ) ?? [:]
        swapCounts = try container.decodeIfPresent([String: Int].self, forKey: .swapCounts) ?? [:]
        migrateLegacySelectionState()
    }

    mutating func mergeCards(_ newCards: [WidgetCardSnapshot], now: Date = Date()) {
        let validIDs = Set(newCards.map(\.id))
        let retainedCandidates = Set(newCards.map(\.candidateToken))
        thumbnailReceipts = thumbnailReceipts.filter { retainedCandidates.contains($0.key) }
        let eligibleIDs = Set(newCards.filter { !$0.isWithdrawn }.map(\.id))
        cards = newCards.sorted {
            if $0.scheduledDay != $1.scheduledDay { return $0.scheduledDay < $1.scheduledDay }
            if $0.isPublished != $1.isPublished { return $0.isPublished }
            if $0.createdAt != $1.createdAt { return $0.createdAt < $1.createdAt }
            return $0.id.uuidString < $1.id.uuidString
        }
        presentations.removeAll { !validIDs.contains($0.cardID) }

        for day in Array(dailySelections.keys) {
            guard var selection = dailySelections[day] else { continue }
            selection.pool.removeAll { !eligibleIDs.contains($0) }
            selection.surfacedCardIDs.removeAll { !validIDs.contains($0) }
            if !eligibleIDs.contains(selection.currentCardID) {
                guard let replacement = selection.pool.first else {
                    if validIDs.contains(selection.currentCardID) {
                        // Keep spent swaps/history when a correction empties
                        // the pool. Accessors fall back to an older valid day.
                        selection.undoStep = nil
                        dailySelections[day] = selection
                    } else {
                        dailySelections.removeValue(forKey: day)
                    }
                    continue
                }
                selection.currentCardID = replacement
                if !selection.surfacedCardIDs.contains(replacement) {
                    selection.surfacedCardIDs.append(replacement)
                    appendPresentation(cardID: replacement, day: day, reason: .daily, now: now)
                }
            }
            if let step = selection.undoStep,
               !eligibleIDs.contains(step.fromCardID) ||
               !eligibleIDs.contains(step.toCardID) ||
               selection.currentCardID != step.toCardID {
                selection.undoStep = nil
            }
            dailySelections[day] = selection
        }

        let days = Set(cards.compactMap { $0.scheduledDay.isEmpty ? nil : $0.scheduledDay })
        for day in days {
            let dayCards = cards.filter { $0.scheduledDay == day && !$0.isWithdrawn }
            let manuallyPresentedIDs = Set(
                dayCards.filter(\.isManualImport).map(\.id) + presentations
                    .filter { $0.day == day && $0.reason == .manual }
                    .map(\.cardID)
            )
            if var selection = dailySelections[day] {
                selection.pool.removeAll { manuallyPresentedIDs.contains($0) }
                dailySelections[day] = selection
            }
            for index in presentations.indices
                where presentations[index].day == day &&
                manuallyPresentedIDs.contains(presentations[index].cardID) &&
                presentations[index].reason != .manual {
                let previous = presentations[index]
                presentations[index] = WidgetCardPresentation(
                    id: previous.id,
                    cardID: previous.cardID,
                    day: previous.day,
                    presentedAt: previous.presentedAt,
                    reason: .manual
                )
            }
            let dailyCards = dayCards.filter { !manuallyPresentedIDs.contains($0.id) }
            let published = dailyCards.filter(\.isPublished).sorted(by: Self.presentationOrder)
            let candidates = dailyCards.filter { !$0.isPublished }.sorted(by: Self.presentationOrder)
            guard let winner = published.first else { continue }
            // If the daily batch contains different objects, make the first
            // swap feel genuinely different before offering another angle on
            // the winner's object. Every valid card remains available when the
            // batch has fewer than three distinct topics.
            let remainingCards = Array(published.dropFirst()) + candidates
            let differentTopic = remainingCards.filter { $0.topicID != winner.topicID }
            let sameTopic = remainingCards.filter { $0.topicID == winner.topicID }
            let freshPool = ([winner] + differentTopic + sameTopic).prefix(3).map(\.id)
            if var selection = dailySelections[day] {
                // Once a daily pool exists it is authoritative. A manually
                // imported/presented card may become current, but must not
                // consume one of the day's three discovery slots or evict an
                // unsurfaced runner-up.
                var reconciledPool = selection.pool.filter { eligibleIDs.contains($0) }
                if reconciledPool.isEmpty {
                    reconciledPool = freshPool
                    if (manuallyPresentedIDs.contains(selection.currentCardID) || !eligibleIDs.contains(selection.currentCardID)),
                       let dailyWinnerID = freshPool.first {
                        selection.currentCardID = dailyWinnerID
                        if !selection.surfacedCardIDs.contains(dailyWinnerID) {
                            selection.surfacedCardIDs.append(dailyWinnerID)
                            appendPresentation(cardID: dailyWinnerID, day: day, reason: .daily, now: now)
                        }
                    }
                } else if reconciledPool.count < 3 {
                    let additions = freshPool.filter { !reconciledPool.contains($0) }
                    reconciledPool.append(contentsOf: additions.prefix(3 - reconciledPool.count))
                }
                selection.pool = Array(reconciledPool.prefix(3))
                if !selection.surfacedCardIDs.contains(selection.currentCardID) {
                    selection.surfacedCardIDs.append(selection.currentCardID)
                }
                selection.swapCount = min(selection.swapCount, SharedConstants.maximumDailySwaps)
                dailySelections[day] = selection
            } else {
                dailySelections[day] = WidgetDailySelectionState(
                    day: day,
                    pool: freshPool,
                    currentCardID: winner.id,
                    surfacedCardIDs: [winner.id],
                    swapCount: 0,
                    undoStep: nil
                )
                appendPresentation(cardID: winner.id, day: day, reason: .daily, now: now)
            }
        }

        trimHistory()
        mirrorLegacyFields()
        generatedAt = now
    }

    func card(for day: String) -> WidgetCardSnapshot? {
        guard let id = dailySelections[day]?.currentCardID else { return nil }
        return cards.first(where: { $0.id == id && !$0.isWithdrawn })
    }

    func mostRecentCard(onOrBefore day: String) -> WidgetCardSnapshot? {
        let latestSelection = dailySelections
            .filter { entry in
                entry.key <= day && cards.contains { $0.id == entry.value.currentCardID && !$0.isWithdrawn }
            }
            .max { $0.key < $1.key }?
            .value
        guard let id = latestSelection?.currentCardID else { return nil }
        return cards.first(where: { $0.id == id })
    }

    func surfacedCards(on day: String) -> [WidgetCardSnapshot] {
        guard let ids = dailySelections[day]?.surfacedCardIDs else { return [] }
        return ids.compactMap { id in cards.first(where: { $0.id == id }) }
    }

    func remainingSwaps(
        on day: String,
        maximumSwaps: Int = SharedConstants.maximumDailySwaps
    ) -> Int {
        max(0, maximumSwaps - (dailySelections[day]?.swapCount ?? 0))
    }

    func canAdvance(
        on day: String,
        maximumSwaps: Int = SharedConstants.maximumDailySwaps
    ) -> Bool {
        guard let selection = dailySelections[day], selection.swapCount < maximumSwaps else { return false }
        return selection.pool.contains { id in
            !selection.surfacedCardIDs.contains(id) && cards.contains { $0.id == id && !$0.isWithdrawn }
        }
    }

    @discardableResult
    mutating func advance(
        on day: String,
        now: Date = Date(),
        maximumSwaps: Int = SharedConstants.maximumDailySwaps
    ) -> WidgetAdvanceResult {
        guard var selection = dailySelections[day] else { return .noSelection }
        guard selection.swapCount < maximumSwaps else { return .limitReached }
        guard let next = selection.pool.first(where: { id in
            !selection.surfacedCardIDs.contains(id) && cards.contains { $0.id == id && !$0.isWithdrawn }
        }) else {
            return .noCandidate
        }
        let previous = selection.currentCardID
        selection.currentCardID = next
        selection.surfacedCardIDs.append(next)
        selection.swapCount += 1
        selection.undoStep = WidgetSwapUndoStep(fromCardID: previous, toCardID: next, at: now)
        dailySelections[day] = selection
        appendPresentation(cardID: next, day: day, reason: .swap, now: now)
        mirrorLegacyFields()
        return .advanced(next)
    }

    mutating func activate(cardID: UUID, on day: String, now: Date = Date()) -> Bool {
        guard let card = cards.first(where: { $0.id == cardID && !$0.isWithdrawn }), card.scheduledDay == day else { return false }
        var selection = dailySelections[day] ?? WidgetDailySelectionState(
            day: day,
            pool: [],
            currentCardID: cardID,
            surfacedCardIDs: [],
            swapCount: 0,
            undoStep: nil
        )
        // Manual cards are intentionally outside an existing daily discovery
        // pool. They can be current and appear in history without reducing the
        // two swaps reserved for the three daily candidates.
        selection.pool.removeAll { $0 == cardID }
        selection.currentCardID = cardID
        selection.undoStep = nil
        if !selection.surfacedCardIDs.contains(cardID) {
            selection.surfacedCardIDs.append(cardID)
        }
        presentations.removeAll { $0.cardID == cardID && $0.day == day }
        appendPresentation(cardID: cardID, day: day, reason: .manual, now: now)
        dailySelections[day] = selection
        mirrorLegacyFields()
        return true
    }

    func canUndo(on day: String, now: Date = Date(), window: TimeInterval = 30) -> Bool {
        guard let selection = dailySelections[day],
              let step = selection.undoStep,
              selection.currentCardID == step.toCardID,
              cards.contains(where: { $0.id == step.fromCardID && !$0.isWithdrawn }),
              cards.contains(where: { $0.id == step.toCardID && !$0.isWithdrawn }) else { return false }
        return now.timeIntervalSince(step.at) >= 0 && now.timeIntervalSince(step.at) <= window
    }

    mutating func undo(on day: String, now: Date = Date(), window: TimeInterval = 30) -> Bool {
        guard var selection = dailySelections[day],
              let step = selection.undoStep,
              now.timeIntervalSince(step.at) >= 0,
              now.timeIntervalSince(step.at) <= window,
              selection.currentCardID == step.toCardID,
              cards.contains(where: { $0.id == step.fromCardID && !$0.isWithdrawn }),
              cards.contains(where: { $0.id == step.toCardID && !$0.isWithdrawn }) else { return false }
        selection.currentCardID = step.fromCardID
        selection.swapCount = max(0, selection.swapCount - 1)
        selection.undoStep = nil
        dailySelections[day] = selection
        // Undo changes which card is current; it does not erase the fact that
        // the user already saw the swapped-to card. Keeping both the surfaced
        // ID and presentation makes every viewed card recoverable in history.
        mirrorLegacyFields()
        return true
    }

    private static func presentationOrder(_ lhs: WidgetCardSnapshot, _ rhs: WidgetCardSnapshot) -> Bool {
        if lhs.createdAt != rhs.createdAt { return lhs.createdAt < rhs.createdAt }
        return lhs.id.uuidString < rhs.id.uuidString
    }

    private mutating func appendPresentation(
        cardID: UUID,
        day: String,
        reason: WidgetPresentationReason,
        now: Date
    ) {
        guard !presentations.contains(where: { $0.cardID == cardID && $0.day == day }) else { return }
        presentations.append(
            WidgetCardPresentation(
                id: UUID(),
                cardID: cardID,
                day: day,
                presentedAt: now,
                reason: reason
            )
        )
    }

    private mutating func migrateLegacySelectionState() {
        guard dailySelections.isEmpty else {
            mirrorLegacyFields()
            return
        }
        let days = Set(cards.compactMap { $0.scheduledDay.isEmpty ? nil : $0.scheduledDay })
        for day in days {
            let dayCards = cards.filter { $0.scheduledDay == day && !$0.isWithdrawn }.sorted(by: Self.presentationOrder)
            guard let fallback = dayCards.first else { continue }
            let currentID = manualOverrides[day].flatMap { id in
                dayCards.contains(where: { $0.id == id }) ? id : nil
            } ?? fallback.id
            let surfaced = dayCards.map(\.id).filter {
                $0 == currentID || manuallyConsumedCardIDs.contains($0)
            }
            dailySelections[day] = WidgetDailySelectionState(
                day: day,
                pool: Array(dayCards.prefix(3).map(\.id)),
                currentCardID: currentID,
                surfacedCardIDs: surfaced.isEmpty ? [currentID] : surfaced,
                swapCount: swapCounts[day, default: 0],
                undoStep: nil
            )
            appendPresentation(cardID: currentID, day: day, reason: .daily, now: generatedAt)
        }
        mirrorLegacyFields()
    }

    private mutating func mirrorLegacyFields() {
        manualOverrides = dailySelections.mapValues(\.currentCardID)
        swapCounts = dailySelections.mapValues(\.swapCount)
        manuallyConsumedCardIDs = Set(dailySelections.values.flatMap(\.surfacedCardIDs))
    }

    private mutating func trimHistory() {
        presentations.sort { $0.presentedAt < $1.presentedAt }
        if presentations.count > 1_000 {
            presentations = Array(presentations.suffix(1_000))
        }
        if dailySelections.count > 400 {
            let retainedDays = Set(dailySelections.keys.sorted().suffix(400))
            dailySelections = dailySelections.filter { retainedDays.contains($0.key) }
        }
    }
}

// Shared by app cards, review thumbnails and Widget photos. Keep extreme
// aspect ratios intact inside a fixed canvas rather than cropping the object.
enum CardPhotoLayout {
    static func preservesWholeImage(_ size: CGSize) -> Bool {
        guard size.width > 0, size.height > 0 else { return false }
        return max(size.width / size.height, size.height / size.width) > 2.2
    }

    static func fittedSize(_ image: CGSize, in container: CGSize) -> CGSize {
        guard image.width.isFinite, image.height.isFinite,
              container.width.isFinite, container.height.isFinite,
              image.width > 0, image.height > 0,
              container.width > 0, container.height > 0 else { return .zero }
        let scale = min(container.width / image.width, container.height / image.height)
        return CGSize(width: image.width * scale, height: image.height * scale)
    }
}

enum ChinaDay {
    static let timeZone = TimeZone(identifier: "Asia/Shanghai")!

    static func string(from date: Date) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let components = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", components.year!, components.month!, components.day!)
    }

    static func start(of date: Date) -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        return calendar.startOfDay(for: date)
    }

    static func adding(days: Int, to date: Date) -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        return calendar.date(byAdding: .day, value: days, to: start(of: date))!
    }
}
