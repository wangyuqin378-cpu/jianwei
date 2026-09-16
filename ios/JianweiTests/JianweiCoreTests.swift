import Foundation
import CryptoKit
import UIKit
import SwiftUI
import XCTest
@testable import Jianwei

final class JianweiCoreTests: XCTestCase {
    // Public text only: no device/photo identifiers from the observed bad card.
    private func knownUnsupportedCard(day: String = "2026-09-14") -> KnowledgeCard {
        KnowledgeCard(
            id: UUID(), candidateToken: UUID(), topicID: "manatee", factID: UUID().uuidString,
            title: "船开越慢，海牛反而越难听见", objectName: "海牛",
            body: "海牛听力对高频敏感，却听不清低频。慢速船只引擎声低沉，海牛难以定位声源；加上脖子僵硬无法转头确认，导致它们常在船靠近时才察觉，避让不及。",
            personalContext: "测试", confidence: 0.95, boundingBox: nil,
            sources: [KnowledgeSource(id: "source", title: "Manatee Senses",
                url: URL(string: "https://faculty.washington.edu/chudler/manat.html")!,
                publisher: "University of Washington", authority: "official")],
            status: "scheduled", scheduledDay: day, createdAt: .distantPast
        )
    }

    func testKnownUnsupportedCardStopsBeingCurrentWithoutDeletingHistoryOrPhoto() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let card = knownUnsupportedCard()
        let repository = try LocalRepository(rootURL: root)
        let image = Data([1, 2, 3])
        try await repository.upsert(card: card, sanitizedJPEG: image)
        try await repository.setSaved(true, cardID: card.id)
        _ = try await repository.recordFeedback(cardID: card.id, action: .like)
        let reopened = try LocalRepository(rootURL: root)
        let state = await reopened.snapshot()
        let now = ISO8601DateFormatter().date(from: "2026-09-14T09:00:00Z")!
        // An old shared snapshot must not override a correction on disk.
        var staleWidget = WidgetQueueState.empty
        staleWidget.mergeCards([card.widgetSnapshot(isManualImport: false)!], now: now)
        XCTAssertNil(CurrentCardResolver.resolve(cards: state.cards, widgetState: staleWidget,
            activeCardID: card.id, now: now))
        XCTAssertEqual(CardHistoryResolver.resolve(cards: state.cards, presentations: staleWidget.presentations,
            now: now).map(\.id), [card.id])
        XCTAssertEqual(state.cards.map(\.id), [card.id])
        XCTAssertTrue(state.savedCardIDs.contains(card.id))
        XCTAssertEqual(state.feedbackByCardID[card.id], .like)
        XCTAssertTrue(state.hiddenCardIDs.isEmpty)
        let retainedImage = await reopened.imageData(candidateToken: card.candidateToken)
        XCTAssertEqual(retainedImage, image)
    }

    func testCorrectionMatchesExactPublicContentNotPhotoIDsOrObjectTopic() throws {
        let original = knownUnsupportedCard()
        let corrected = KnowledgeCorrectionCatalog.applying(to: original)
        XCTAssertTrue(corrected.isWithdrawn)
        XCTAssertEqual(corrected.id, original.id)
        XCTAssertEqual(corrected.title, original.title)
        XCTAssertEqual(corrected.body, original.body)
        XCTAssertEqual(KnowledgeCorrectionCatalog.applying(to: knownUnsupportedCard()).correction, corrected.correction)
        XCTAssertEqual(KnowledgeCorrectionCatalog.applying(to: corrected), corrected)
        XCTAssertEqual(corrected.withPresentation(status: "shown", scheduledDay: "2026-09-15").correction, corrected.correction)
        XCTAssertEqual(corrected.withPersonalContext("另一张照片").correction, corrected.correction)
        // A new fact about the same animal is NOT automatically blacklisted.
        var json = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(original)) as? [String: Any])
        json["body"] = "来源描述的是颈部活动受限，并非完全无法转头。"
        let revised = try JSONDecoder().decode(KnowledgeCard.self, from: JSONSerialization.data(withJSONObject: json))
        XCTAssertFalse(KnowledgeCorrectionCatalog.applying(to: revised).isWithdrawn)
        XCTAssertFalse(original.isWithdrawn, "Legacy JSON without the optional notice remains decodable")
        let snapshot = try XCTUnwrap(corrected.widgetSnapshot(isManualImport: false))
        XCTAssertEqual(try JSONDecoder().decode(WidgetCardSnapshot.self, from: JSONEncoder().encode(snapshot)), snapshot)
    }

    func testLegacyFutureCorrectionRepairsWinnerAndKeepsSpentAnalysisLedger() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let day = "2026-09-18"
        let bad = knownUnsupportedCard(day: day)
        let alternate = makeCard(topic: "alternate").withPresentation(status: "candidate", scheduledDay: day)
        let later = makeCard(topic: "tomorrow").withPresentation(status: "scheduled", scheduledDay: "2026-09-19")
        let reservation = UUID()
        var legacy = PersistedAppState.empty
        legacy.cards = [bad, alternate, later]
        legacy.savedCardIDs = [bad.id]
        legacy.dailyPreparations[day] = DailyPreparationRecord(day: day, status: .ready,
            inspectedPhotoCount: 72, aiPhotoCount: 9, qualifiedCardIDs: [bad.id, alternate.id],
            selectedCardID: bad.id, cloudPhotoReservationIDs: [reservation])
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        try encoder.encode(legacy).write(to: root.appendingPathComponent("state.json"))
        let repository = try LocalRepository(rootURL: root)
        let state = await repository.snapshot()
        let record = try XCTUnwrap(state.dailyPreparations[day])
        XCTAssertEqual(record.selectedCardID, alternate.id)
        XCTAssertEqual(record.qualifiedCardIDs, [alternate.id])
        XCTAssertEqual(record.status, .ready)
        XCTAssertEqual(record.aiPhotoCount, 9)
        XCTAssertEqual(record.inspectedPhotoCount, 72)
        XCTAssertEqual(record.cloudPhotoReservationIDs, [reservation])
        XCTAssertEqual(Set(state.cards.map(\.id)), Set(legacy.cards.map(\.id)))
        XCTAssertEqual(state.savedCardIDs, legacy.savedCardIDs)
        XCTAssertTrue(state.cards.first { $0.id == bad.id }!.isWithdrawn)
        XCTAssertEqual(state.cards.first { $0.id == alternate.id }!.status, "scheduled")
        // A replay of an old successful response cannot resurrect the card.
        try await repository.upsert(card: bad, sanitizedJPEG: nil)
        let replayed = await repository.snapshot()
        XCTAssertTrue(replayed.cards.first { $0.id == bad.id }!.isWithdrawn)
        do {
            try await repository.finalizeDailySelection(day: day, selectedCardID: bad.id,
                candidateIDs: [bad.candidateToken], scannedAt: Date())
            XCTFail("A withdrawn card must not be published again")
        } catch let error as ProductError { XCTAssertEqual(error, .invalidServerResponse) }
    }

    func testWithdrawalWithoutAlternateRequeuesDateAndFallsBackWithoutBorrowingTomorrow() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let now = ISO8601DateFormatter().date(from: "2026-09-14T09:00:00Z")!
        let bad = knownUnsupportedCard()
        let older = makeCard(topic: "older").withPresentation(status: "shown", scheduledDay: "2026-09-13")
        let tomorrow = makeCard(topic: "future").withPresentation(status: "scheduled", scheduledDay: "2026-09-15")
        var legacy = PersistedAppState.empty
        legacy.cards = [older, bad, tomorrow]
        legacy.dailyPreparations[bad.scheduledDay] = DailyPreparationRecord(day: bad.scheduledDay, status: .ready,
            aiPhotoCount: 9, qualifiedCardIDs: [bad.id], selectedCardID: bad.id)
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        try encoder.encode(legacy).write(to: root.appendingPathComponent("state.json"))
        let repository = try LocalRepository(rootURL: root)
        let state = await repository.snapshot()
        XCTAssertEqual(state.dailyPreparations[bad.scheduledDay]?.status, .queued)
        XCTAssertNil(state.dailyPreparations[bad.scheduledDay]?.selectedCardID)
        XCTAssertEqual(state.dailyPreparations[bad.scheduledDay]?.aiPhotoCount, 9)
        var queue = WidgetQueueState.empty
        queue.mergeCards(legacy.cards.compactMap { $0.widgetSnapshot(isManualImport: false) }, now: now)
        queue.dailySelections[bad.scheduledDay]?.swapCount = 2
        let oldPresentationIDs = Set(queue.presentations.map(\.id))
        queue.mergeCards(state.cards.compactMap { $0.widgetSnapshot(isManualImport: false) }, now: now)
        XCTAssertNil(queue.card(for: bad.scheduledDay))
        XCTAssertEqual(queue.mostRecentCard(onOrBefore: bad.scheduledDay)?.id, older.id)
        XCTAssertEqual(CurrentCardResolver.resolve(cards: state.cards, widgetState: queue,
            activeCardID: bad.id, now: now)?.id, older.id)
        XCTAssertEqual(queue.dailySelections[bad.scheduledDay]?.swapCount, 2)
        XCTAssertTrue(oldPresentationIDs.isSubset(of: Set(queue.presentations.map(\.id))))
        XCTAssertFalse(queue.activate(cardID: bad.id, on: bad.scheduledDay, now: now))
        // A later replacement must not create two free extra swaps.
        let replacement = makeCard(topic: "replacement").withPresentation(status: "scheduled", scheduledDay: bad.scheduledDay)
        queue.mergeCards((state.cards + [replacement]).compactMap { $0.widgetSnapshot(isManualImport: false) }, now: now)
        XCTAssertEqual(queue.card(for: bad.scheduledDay)?.id, replacement.id)
        XCTAssertEqual(queue.remainingSwaps(on: bad.scheduledDay), 0)
        XCTAssertEqual(queue.advance(on: bad.scheduledDay, now: now), .limitReached)
    }

    func testWithdrawalRemovesSwapAndUndoTargetsButPreservesTheirHistory() throws {
        let now = ISO8601DateFormatter().date(from: "2026-09-14T09:00:00Z")!
        let day = "2026-09-14"
        let winner = makeCard(topic: "winner").withPresentation(status: "scheduled", scheduledDay: day)
        let bad = knownUnsupportedCard().withPresentation(status: "candidate", scheduledDay: day)
        let last = makeCard(topic: "last").withPresentation(status: "candidate", scheduledDay: day)
        var queue = WidgetQueueState.empty
        queue.mergeCards([winner, bad, last].compactMap { $0.widgetSnapshot(isManualImport: false) }, now: now)
        XCTAssertEqual(queue.advance(on: day, now: now), .advanced(bad.id))
        let presentations = Set(queue.presentations.map(\.id))
        let corrected = KnowledgeCorrectionCatalog.applying(to: bad)
        queue.mergeCards([winner, corrected, last].compactMap { $0.widgetSnapshot(isManualImport: false) }, now: now)
        XCTAssertEqual(queue.card(for: day)?.id, winner.id)
        XCTAssertFalse(queue.canUndo(on: day, now: now))
        XCTAssertFalse(queue.undo(on: day, now: now))
        XCTAssertEqual(queue.remainingSwaps(on: day), 1)
        XCTAssertEqual(queue.advance(on: day, now: now), .advanced(last.id))
        XCTAssertTrue(presentations.isSubset(of: Set(queue.presentations.map(\.id))))
        XCTAssertTrue(CardHistoryResolver.resolve(cards: [winner, corrected, last],
            presentations: queue.presentations, now: now).contains { $0.id == bad.id })
    }

    func testOldAIResponseCannotFillTheDailyPoolWithWithdrawnFacts() {
        let invalid = (0..<3).map { _ in knownUnsupportedCard().withPresentation(status: "candidate", scheduledDay: "") }
        let valid = makeCard(topic: "valid").withPresentation(status: "candidate", scheduledDay: "")
        XCTAssertTrue(AutomaticDiscoveryRunner.selectionPool(newCards: invalid, carryOverCards: []).isEmpty,
            "Continue inspecting rather than stopping at three known bad responses")
        XCTAssertEqual(AutomaticDiscoveryRunner.selectionPool(newCards: invalid + [valid], carryOverCards: []).map(\.id), [valid.id])
    }

    func testCorrectionPersistsThroughActualWidgetProjectionWithoutDiscardingHistory() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let repository = try LocalRepository(rootURL: root.appendingPathComponent("app"))
        let store = try SharedWidgetStore(baseURL: root.appendingPathComponent("group"))
        let bad = knownUnsupportedCard()
        // The group has already recorded an old card before upgrading.
        _ = try store.replaceCards([bad.widgetSnapshot(isManualImport: false)!], thumbnails: [:])
        let presentations = try store.load().presentations
        try await repository.upsert(card: bad, sanitizedJPEG: nil)
        try await WidgetCoordinator(repository: repository, sharedStore: store).synchronize()
        let projected = try store.load()
        XCTAssertEqual(projected.presentations, presentations)
        XCTAssertEqual(projected.cards.map(\.id), [bad.id])
        XCTAssertTrue(projected.cards[0].isWithdrawn)
        XCTAssertNil(projected.card(for: bad.scheduledDay))
    }

    @MainActor
    func testCorrectionNoticeRendersAtCompactWidthAndAccessibilityTextSize() throws {
        let notice = try XCTUnwrap(KnowledgeCorrectionCatalog.applying(to: knownUnsupportedCard()).correction)
        for size in [DynamicTypeSize.large, .accessibility3] {
            let renderer = ImageRenderer(content: KnowledgeCorrectionBanner(notice: notice)
                .environment(\.dynamicTypeSize, size).frame(width: 296).padding(12)
                .background(JianweiBrand.paper))
            renderer.scale = 2
            let rendered = try XCTUnwrap(renderer.uiImage)
            XCTAssertEqual(rendered.size.width, 320, accuracy: 0.5)
            let attachment = XCTAttachment(image: rendered)
            attachment.name = size == .large ? "correction-compact" : "correction-accessibility"
            attachment.lifetime = .keepAlways
            add(attachment)
        }
    }

    func testDeviceBetaExperienceRequiresExplicitBuildValue() {
        XCTAssertTrue(DeviceBetaExperience.isEnabled(rawValue: "YES"))
        XCTAssertTrue(DeviceBetaExperience.isEnabled(rawValue: " true "))
        XCTAssertFalse(DeviceBetaExperience.isEnabled(rawValue: "NO"))
        XCTAssertFalse(DeviceBetaExperience.isEnabled(rawValue: nil))
    }

    func testHistoryFallsBackToPublishedCardsWhenWidgetPresentationsAreMissing() {
        let older = makeCard(topic: "older")
            .withPresentation(status: "shown", scheduledDay: "2026-09-01")
        let newer = makeCard(topic: "newer")
            .withPresentation(status: "scheduled", scheduledDay: "2026-09-02")
        let unpublished = makeCard(topic: "candidate")
            .withPresentation(status: "candidate", scheduledDay: "")

        XCTAssertEqual(
            CardHistoryResolver.resolve(
                cards: [older, unpublished, newer],
                presentations: [],
                now: ISO8601DateFormatter().date(from: "2026-09-02T04:00:00Z")!
            ).map(\.id),
            [newer.id, older.id]
        )
    }

    func testHistoryKeepsPresentationOrderThenAppendsPersistedFallbacks() {
        let now = ISO8601DateFormatter().date(from: "2026-09-02T04:00:00Z")!
        let older = makeCard(topic: "older")
            .withPresentation(status: "shown", scheduledDay: "2026-09-01")
        let newer = makeCard(topic: "newer")
            .withPresentation(status: "scheduled", scheduledDay: "2026-09-02")
        let presentation = WidgetCardPresentation(
            id: UUID(),
            cardID: older.id,
            day: "2026-09-02",
            presentedAt: now,
            reason: .swap
        )

        XCTAssertEqual(
            CardHistoryResolver.resolve(
                cards: [older, newer],
                presentations: [presentation],
                now: now
            ).map(\.id),
            [older.id, newer.id]
        )
    }

    func testHistoryExcludesFuturePublishedAndUndatedCardsUntilShanghaiMidnight() {
        let now = ISO8601DateFormatter().date(from: "2026-09-05T15:59:59Z")!
        let today = makeCard(topic: "today").withPresentation(status: "shown", scheduledDay: "2026-09-05")
        let future = makeCard(topic: "future").withPresentation(status: "scheduled", scheduledDay: "2026-09-06")
        let undated = makeCard(topic: "undated").withPresentation(status: "shown", scheduledDay: "")
        let cards = [future, today, undated]

        XCTAssertEqual(CardHistoryResolver.resolve(cards: cards, presentations: [], now: now).map(\.id), [today.id])
        XCTAssertEqual(
            CardHistoryResolver.resolve(cards: cards, presentations: [], now: now.addingTimeInterval(1)).map(\.id),
            [future.id, today.id]
        )
    }

    func testHistoryExcludesFuturePresentationDayAndTimestampButKeepsSeenRunnerUp() {
        let now = ISO8601DateFormatter().date(from: "2026-09-05T04:00:00Z")!
        let seen = makeCard(topic: "seen").withPresentation(status: "candidate", scheduledDay: "2026-09-05")
        let queued = makeCard(topic: "queued").withPresentation(status: "candidate", scheduledDay: "2026-09-06")
        let later = makeCard(topic: "later").withPresentation(status: "candidate", scheduledDay: "2026-09-05")
        let presentations = [
            WidgetCardPresentation(id: UUID(), cardID: seen.id, day: "2026-09-05", presentedAt: now, reason: .swap),
            // Future daily entries are projected now, not when they are seen.
            WidgetCardPresentation(id: UUID(), cardID: queued.id, day: "2026-09-06", presentedAt: now, reason: .daily),
            WidgetCardPresentation(id: UUID(), cardID: later.id, day: "2026-09-05", presentedAt: now.addingTimeInterval(60), reason: .swap),
            WidgetCardPresentation(id: UUID(), cardID: seen.id, day: "2026-09-05", presentedAt: now, reason: .swap)
        ]

        XCTAssertEqual(
            CardHistoryResolver.resolve(cards: [seen, queued, later], presentations: presentations, now: now).map(\.id),
            [seen.id]
        )
        XCTAssertTrue(CardHistoryResolver.resolve(cards: [], presentations: presentations, now: now).isEmpty)
    }

    func testCurrentCardFollowsShanghaiDayInsteadOfStaleActiveCard() throws {
        let before = ISO8601DateFormatter().date(from: "2026-09-05T15:59:59Z")!
        let yesterday = makeCard(topic: "yesterday").withPresentation(status: "scheduled", scheduledDay: "2026-09-05")
        let today = makeCard(topic: "today").withPresentation(status: "scheduled", scheduledDay: "2026-09-06")
        let cards = [yesterday, today]
        var queue = WidgetQueueState.empty
        queue.mergeCards(try cards.map { try XCTUnwrap($0.widgetSnapshot(isManualImport: false)) }, now: before)

        XCTAssertEqual(CurrentCardResolver.resolve(cards: cards, widgetState: queue, activeCardID: yesterday.id, now: before)?.id, yesterday.id)
        XCTAssertEqual(CurrentCardResolver.resolve(cards: cards, widgetState: queue, activeCardID: yesterday.id, now: before.addingTimeInterval(1))?.id, today.id)
    }

    func testCurrentCardWithoutWidgetRejectsFutureActiveCardAndUsesLatestPublishedDay() {
        let now = ISO8601DateFormatter().date(from: "2026-09-05T04:00:00Z")!
        let old = makeCard(topic: "old").withPresentation(status: "shown", scheduledDay: "2026-09-03")
        let recent = makeCard(topic: "recent").withPresentation(status: "shown", scheduledDay: "2026-09-04")
        let future = makeCard(topic: "future").withPresentation(status: "scheduled", scheduledDay: "2026-09-06")
        let cards = [old, recent, future]

        for active in [old.id, future.id] {
            XCTAssertEqual(CurrentCardResolver.resolve(cards: cards, widgetState: .empty, activeCardID: active, now: now)?.id, recent.id)
        }
        XCTAssertNil(CurrentCardResolver.resolve(cards: [future], widgetState: .empty, activeCardID: future.id, now: now))
    }

    func testSwapSaveProjectionUndoAndReviewUseTheSameSelection() throws {
        let now = ISO8601DateFormatter().date(from: "2026-09-05T04:00:00Z")!
        let day = ChinaDay.string(from: now)
        let winner = makeCard(topic: "winner").withPresentation(status: "scheduled", scheduledDay: day)
        let runner = makeCard(topic: "runner").withPresentation(status: "candidate", scheduledDay: day)
        let cards = [winner, runner]
        var queue = WidgetQueueState.empty
        queue.mergeCards(try cards.map { try XCTUnwrap($0.widgetSnapshot(isManualImport: false)) }, now: now)
        XCTAssertEqual(queue.advance(on: day, now: now), .advanced(runner.id))
        XCTAssertEqual(CurrentCardResolver.resolve(cards: cards, widgetState: queue, activeCardID: winner.id, now: now)?.id, runner.id)

        // reloadWidgetSelection promotes the runner; saving reprojects cards.
        let promoted = [winner, runner.withPresentation(status: "shown", scheduledDay: day)]
        let snapshots = try promoted.map { try XCTUnwrap($0.widgetSnapshot(isManualImport: false)) }
        queue.mergeCards(snapshots, now: now.addingTimeInterval(1))
        queue.mergeCards(snapshots, now: now.addingTimeInterval(2))
        XCTAssertEqual(queue.card(for: day)?.id, runner.id)
        XCTAssertTrue(queue.undo(on: day, now: now.addingTimeInterval(20)))
        XCTAssertEqual(CurrentCardResolver.resolve(cards: promoted, widgetState: queue, activeCardID: runner.id, now: now.addingTimeInterval(20))?.id, winner.id)
        XCTAssertEqual(Set(CardHistoryResolver.resolve(cards: promoted, presentations: queue.presentations, now: now.addingTimeInterval(20)).map(\.id)), Set([winner.id, runner.id]))
        XCTAssertEqual(Set(queue.surfacedCards(on: day).map(\.id)), Set([winner.id, runner.id]))
        XCTAssertFalse(queue.canAdvance(on: day))
        XCTAssertFalse(queue.canUndo(on: day, now: now.addingTimeInterval(21)))
    }

    func testExtremePhotoLayoutFitsWideAndTallImagesInsideEveryCardCanvas() {
        let canvases = [CGSize(width: 357, height: 250), CGSize(width: 92, height: 92), CGSize(width: 58, height: 58), CGSize(width: 124, height: 170), CGSize(width: 170, height: 170)]
        let images = [CGSize(width: 12_000, height: 500), CGSize(width: 500, height: 12_000)]
        for image in images {
            XCTAssertTrue(CardPhotoLayout.preservesWholeImage(image))
            for canvas in canvases {
                let fitted = CardPhotoLayout.fittedSize(image, in: canvas)
                XCTAssertLessThanOrEqual(fitted.width, canvas.width + 0.0001)
                XCTAssertLessThanOrEqual(fitted.height, canvas.height + 0.0001)
                XCTAssertEqual(fitted.width / fitted.height, image.width / image.height, accuracy: 0.0001)
                XCTAssertTrue(abs(fitted.width - canvas.width) < 0.0001 || abs(fitted.height - canvas.height) < 0.0001)
            }
        }
        XCTAssertFalse(CardPhotoLayout.preservesWholeImage(CGSize(width: 4, height: 3)))
        XCTAssertFalse(CardPhotoLayout.preservesWholeImage(CGSize(width: 3, height: 4)))
        XCTAssertEqual(CardPhotoLayout.fittedSize(.zero, in: canvases[0]), .zero)
        XCTAssertEqual(CardPhotoLayout.fittedSize(images[0], in: .zero), .zero)
    }

    func testCachePreparationMessageOnlyClaimsTheActuallyPreparedDayCount() {
        XCTAssertEqual(
            DiscoveryRunMessage.cachePreparationText(preparedFutureDayCount: 0),
            "暂时没有新的合适照片，有新照片时会继续寻找。"
        )
        XCTAssertEqual(
            DiscoveryRunMessage.cachePreparationText(preparedFutureDayCount: 0, hasCurrentCard: true),
            "暂时没有新的合格知识卡，已有卡片仍会保留。"
        )
        for count in 1..<7 {
            XCTAssertEqual(
                DiscoveryRunMessage.cachePreparationText(preparedFutureDayCount: count),
                "已备好未来 \(count) 天的知识卡，会按日期展示。"
            )
        }
        XCTAssertEqual(
            DiscoveryRunMessage.cachePreparationText(preparedFutureDayCount: 7),
            "已备好未来 6 天的知识卡，会按日期展示。"
        )
    }

    func testPreparedInventoryDistinguishesContiguousFutureDaysFromGapsAndStaleSelections() throws {
        let now = ISO8601DateFormatter().date(from: "2026-09-14T09:00:00Z")!
        var state = PersistedAppState.empty
        for offset in [0, 1, 3] {
            let day = ChinaDay.string(from: ChinaDay.adding(days: offset, to: now))
            let card = makeCard(topic: "day-\(offset)").withPresentation(status: "scheduled", scheduledDay: day)
            state.cards.append(card)
            state.dailyPreparations[day] = DailyPreparationRecord(day: day, status: .ready,
                qualifiedCardIDs: [card.id], selectedCardID: card.id)
        }
        var queue = WidgetQueueState.empty
        queue.mergeCards(try state.cards.map { try XCTUnwrap($0.widgetSnapshot(isManualImport: false)) }, now: now)
        var inventory = PreparedCardInventory(state: state, widgetState: queue, now: now)
        XCTAssertEqual(inventory.dayCount, 3)
        XCTAssertEqual(inventory.consecutiveFutureDayCount, 1, "The gap on the 16th breaks the run")
        state.hiddenCardIDs.insert(state.cards[1].id)
        inventory = PreparedCardInventory(state: state, widgetState: queue, now: now)
        XCTAssertEqual(inventory.dayCount, 2, "A stale Widget reference must not count a hidden card")
        XCTAssertEqual(inventory.consecutiveFutureDayCount, 0)
        state.cards.removeLast()
        XCTAssertEqual(PreparedCardInventory(state: state, widgetState: queue, now: now).dayCount, 1)
        XCTAssertEqual(PreparedCardInventory(state: state, widgetState: .empty, now: now).dayCount, 0)
        let nextDay = ChinaDay.adding(days: 1, to: now)
        XCTAssertEqual(PreparedCardInventory(state: state, widgetState: queue, now: nextDay).dayCount, 0,
            "Yesterday's fallback does not constitute today's new card")
    }

    func testSwapLimitMessageNeverPromisesThreeNewCandidatesTomorrow() {
        for count in 0...7 {
            let message = DiscoveryRunMessage.swapLimitText(preparedFutureDayCount: count)
            XCTAssertTrue(message.hasPrefix("今天已经换过两次。"))
            XCTAssertTrue(message.hasSuffix(DiscoveryRunMessage.cachePreparationText(preparedFutureDayCount: count)))
            XCTAssertFalse(message.contains("明天会有"))
            XCTAssertFalse(message.contains("三张"))
        }
    }

    func testChinaDayAddingTargetsNextMidnightRatherThanTwentyFourHoursLater() {
        let afternoon = ISO8601DateFormatter().date(from: "2026-09-05T07:30:00Z")!
        let expectedMidnight = ISO8601DateFormatter().date(from: "2026-09-05T16:00:00Z")!
        let midnight = ChinaDay.adding(days: 1, to: afternoon)
        XCTAssertEqual(midnight, expectedMidnight)
        XCTAssertEqual(midnight.timeIntervalSince(afternoon), 8.5 * 60 * 60)
        XCTAssertEqual(ChinaDay.string(from: midnight), "2026-09-06")
    }

    #if DEBUG
    @MainActor
    func testAppModelFutureInventoryExcludesTodayAndStopsAtTheFirstMissingDate() async throws {
        for (offsets, expected) in [([0], 0), ([0, 1], 1), ([0, 1, 3], 1), ([0, 2], 0), (Array(0..<7), 6)] {
            let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            defer { try? FileManager.default.removeItem(at: root) }
            let repository = try LocalRepository(rootURL: root.appendingPathComponent("app"))
            let store = try SharedWidgetStore(baseURL: root.appendingPathComponent("group"))
            let now = Date()
            var cards: [KnowledgeCard] = []
            for offset in offsets {
                let day = ChinaDay.string(from: ChinaDay.adding(days: offset, to: now))
                let card = makeCard(topic: "future-\(offset)").withPresentation(status: "scheduled", scheduledDay: day)
                try await repository.upsert(card: card, sanitizedJPEG: makeTestJPEG())
                try await repository.savePreparation(DailyPreparationRecord(day: day, status: .ready,
                    qualifiedCardIDs: [card.id], selectedCardID: card.id))
                cards.append(card)
            }
            let snapshots = try cards.map { try XCTUnwrap($0.widgetSnapshot(isManualImport: false)) }
            let thumbnails = Dictionary(uniqueKeysWithValues: cards.map { ($0.candidateToken, makeTestJPEG()) })
            XCTAssertTrue(try store.replaceCards(snapshots, thumbnails: thumbnails))
            let model = try makeAuditModel(repository: repository,
                launchArguments: ["-JianweiReadOnlyStateProbe"], sharedStore: store)
            await model.start()

            XCTAssertNotNil(model.currentCard, "Every fixture has today's card")
            XCTAssertEqual(model.preparedFutureDayCount, expected, "Prepared dates: \(offsets)")
            XCTAssertEqual(model.state.cards.count, offsets.count, "Reporting does not remove scattered future cards")
        }
    }

    @MainActor
    func testPreparedDayCountDoesNotCountAReadyRecordWithoutADisplayableCard() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let repository = try LocalRepository(rootURL: root.appendingPathComponent("app"))
        let store = try SharedWidgetStore(baseURL: root.appendingPathComponent("group"))
        let today = ChinaDay.string(from: Date())
        try await repository.savePreparation(DailyPreparationRecord(day: today, status: .ready))
        let model = try makeAuditModel(repository: repository,
            launchArguments: ["-JianweiReadOnlyStateProbe"], sharedStore: store)
        await model.start()
        XCTAssertEqual(model.state.dailyPreparations[today]?.status, .ready)
        XCTAssertNil(model.currentCard)
        XCTAssertEqual(model.preparedFutureDayCount, 0,
            "A bookkeeping flag must not be presented as a cached day of knowledge")
    }

    @MainActor
    func testReadOnlyProbeSkipsStartupMaintenanceAndForegroundWork() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let repository = try LocalRepository(rootURL: root)
        let card = makeCard(topic: "imported").withPresentation(status: "candidate", scheduledDay: "")
        try await repository.upsert(card: card, sanitizedJPEG: makeTestJPEG())
        try await repository.setAutomaticDiscovery(true)
        _ = try await repository.recordFeedback(cardID: card.id, action: .like)
        let model = try makeAuditModel(repository: repository, launchArguments: [
            "-JianweiReadOnlyStateProbe", "-JianweiResetOnboarding", "-JianweiSeedDemo"
        ])
        let original = try Data(contentsOf: root.appendingPathComponent("state.json"))
        let originalImage = await repository.imageData(candidateToken: card.candidateToken)

        await model.start()
        await model.resumeFromBackground()
        await model.runAutomaticDiscovery()
        await model.synchronizeCards(showFailure: true)
        await model.refreshPresentationState()
        await model.refreshUndoAvailability()

        XCTAssertTrue(model.isReady)
        XCTAssertTrue(model.isReadOnlyStateProbe)
        XCTAssertFalse(model.isWorking)
        XCTAssertEqual(model.state.cards, [card])
        XCTAssertTrue(model.state.dailyPreparations.isEmpty)
        XCTAssertEqual(model.state.pendingFeedback.count, 1)
        XCTAssertEqual(model.serviceConnectionState, .notChecked)
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent("state.json")), original)
        let afterImage = await repository.imageData(candidateToken: card.candidateToken)
        XCTAssertEqual(afterImage, originalImage)
    }

    @MainActor
    func testRemovedDetailCardClearsPresentationOnRefresh() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let repository = try LocalRepository(rootURL: root)
        let card = makeCard(topic: "private")
        try await repository.upsert(card: card, sanitizedJPEG: makeTestJPEG())
        let model = try makeAuditModel(repository: repository, launchArguments: ["-JianweiReadOnlyStateProbe"])
        await model.refreshPresentationState()
        model.presentedCardID = card.id
        try await repository.hideCard(card.id, candidateToken: card.candidateToken, neverAnalyze: true)
        await model.refreshPresentationState()

        XCTAssertNil(model.presentedCardID)
        XCTAssertNil(model.imageData(for: card))
        XCTAssertFalse(model.historyCards.contains(where: { $0.id == card.id }))
    }

    @MainActor
    func testBetaStartupPreservesCloudCredentialsEvenOfflineButRefreshesLocalService() async throws {
        for (address, offline) in [
            ("https://jianwei.example.com", false),
            ("https://jianwei.example.com", true),
            ("http://127.0.0.1:8787", false)
        ] {
            let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            defer { try? FileManager.default.removeItem(at: root) }
            let repository = try LocalRepository(rootURL: root)
            try await repository.setAutomaticDiscovery(false)
            let secrets = TestSecretStore()
            let installation = UUID().uuidString.lowercased()
            let device = UUID().uuidString.lowercased()
            let token = String(repeating: "A", count: 43)
            secrets.set(installation, for: "installation-id")
            secrets.set(device, for: "device-id")
            secrets.set(token, for: "device-token")
            let configuration = URLSessionConfiguration.ephemeral
            configuration.protocolClasses = [DirectQwenURLProtocol.self]
            let session = URLSession(configuration: configuration)
            defer { session.invalidateAndCancel() }
            DirectQwenURLProtocol.handler = { request in
                XCTAssertEqual(request.url?.path, "/health", "Startup must not register or analyze photos")
                if offline { throw URLError(.notConnectedToInternet) }
                return (
                    HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 200, httpVersion: nil, headerFields: nil)!,
                    Data("{\"ok\":true}".utf8)
                )
            }
            let api = try APIClient(baseURL: XCTUnwrap(URL(string: address)), session: session)
            let identity = DeviceIdentityStore(api: api, keychain: secrets)
            // Separate AppModels represent relaunches sharing persisted credentials.
            for _ in 0..<2 {
                let model = try makeAuditModel(
                    repository: repository, launchArguments: [], api: api,
                    identity: identity, deviceBetaExperienceEnabled: true
                )
                await model.start()
                XCTAssertTrue(model.isReady)
                XCTAssertFalse(model.automaticDiscoveryEnabled)
                XCTAssertEqual(secrets.string(for: "installation-id"), installation)
                if api.usesLocalDevelopmentService {
                    XCTAssertNil(secrets.string(for: "device-id"))
                    XCTAssertNil(secrets.string(for: "device-token"))
                    XCTAssertEqual(secrets.string(for: "previous-device-token"), token)
                } else {
                    XCTAssertEqual(secrets.string(for: "device-id"), device)
                    XCTAssertEqual(secrets.string(for: "device-token"), token)
                    XCTAssertNil(secrets.string(for: "previous-device-token"))
                }
            }
        }
    }

    @MainActor
    func testBetaStartupDoesNotSwitchADeletedUserKeyToPlatformBilling() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let repository = try LocalRepository(rootURL: root)
        try await repository.setModelAccessMode(.qwenUserKey)
        try await repository.setAutomaticDiscovery(false)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DirectQwenURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        DirectQwenURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/health", "Startup cannot use platform inference as a missing-Key fallback")
            return (HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 200, httpVersion: nil, headerFields: nil)!,
                    Data("{\"ok\":true}".utf8))
        }
        let api = try APIClient(baseURL: XCTUnwrap(URL(string: "https://jianwei.example.com")), session: session)
        let identity = DeviceIdentityStore(api: api, keychain: TestSecretStore())
        for _ in 0..<2 {
            let model = try makeAuditModel(repository: repository, launchArguments: [], api: api,
                                           identity: identity, deviceBetaExperienceEnabled: true)
            await model.start()
            XCTAssertEqual(model.modelAccessMode, .qwenUserKey)
            XCTAssertFalse(model.hasQwenAPIKey)
            XCTAssertFalse(model.serviceConfigured)
            XCTAssertTrue(model.isReady)
        }
    }

    @MainActor
    func testBYOKConnectionCheckNeverUsesManagedServerAvailability() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let repository = try LocalRepository(rootURL: root.appendingPathComponent("app"))
        try await repository.setModelAccessMode(.qwenUserKey)
        try await repository.setAutomaticDiscovery(false)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DirectQwenURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel(); DirectQwenURLProtocol.handler = nil }
        let calls = TestAttemptCounter()
        DirectQwenURLProtocol.handler = { _ in
            _ = calls.incrementAndRead()
            throw URLError(.notConnectedToInternet)
        }
        let api = try APIClient(baseURL: XCTUnwrap(URL(string: "https://jianwei.example.com")), session: session)
        let model = try makeAuditModel(repository: repository, launchArguments: [], api: api,
            identity: DeviceIdentityStore(api: api, keychain: TestSecretStore()),
            deviceBetaExperienceEnabled: true,
            sharedStore: SharedWidgetStore(baseURL: root.appendingPathComponent("widget")))
        await model.start()
        await model.checkServiceConnection()
        await model.resumeFromBackground()
        XCTAssertEqual(calls.value, 0, "BYOK must not diagnose an unrelated managed host")
        XCTAssertEqual(model.serviceConnectionState, .notChecked)
        XCTAssertFalse(model.message?.contains("无法连接") == true)
        XCTAssertEqual(model.modelAccessMode, .qwenUserKey)
    }

    @MainActor
    func testCloudDeletionNeverRegistersAnUnusedOrPreviouslyDeletedIdentity() async throws {
        for previouslyManaged in [false, true] {
            let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            defer { try? FileManager.default.removeItem(at: root) }
            let repository = try LocalRepository(rootURL: root.appendingPathComponent("app"))
            try await repository.setModelAccessMode(.qwenUserKey)
            try await repository.setAutomaticDiscovery(true)
            try await repository.upsert(card: makeCard(topic: "history"), sanitizedJPEG: makeTestJPEG())
            let secrets = TestSecretStore()
            let installation = UUID().uuidString.lowercased()
            let device = UUID().uuidString.lowercased()
            let token = String(repeating: "D", count: 43)
            secrets.set(installation, for: "installation-id")
            // Sharing the test store lets us assert that deletion does not erase
            // the user's provider Key or the App Store purchase-binding UUID.
            secrets.set("sk-synthetic_key_kept_1234567890", for: "qwen-api-key")
            if previouslyManaged {
                secrets.set(device, for: "device-id")
                secrets.set(token, for: "device-token")
            }
            let configuration = URLSessionConfiguration.ephemeral
            configuration.protocolClasses = [DirectQwenURLProtocol.self]
            let session = URLSession(configuration: configuration)
            defer { session.invalidateAndCancel(); DirectQwenURLProtocol.handler = nil }
            let registrations = TestAttemptCounter()
            let deletions = TestAttemptCounter()
            DirectQwenURLProtocol.handler = { request in
                let payload: [String: Any]
                let status: Int
                if request.httpMethod == "POST" {
                    _ = registrations.incrementAndRead()
                    let digest = SHA256.hash(data: Data(("jianwei-installation-binding-v1\0" + installation).utf8))
                        .map { String(format: "%02x", $0) }.joined()
                    payload = ["deviceId": device, "deviceToken": token,
                        "installationBindingSha256": digest, "created": true]
                    status = 201
                } else {
                    _ = deletions.incrementAndRead()
                    XCTAssertEqual(request.httpMethod, "DELETE")
                    XCTAssertEqual(request.url?.path, "/v1/device-data")
                    XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer " + token)
                    payload = ["deviceId": device, "status": "deleted"]
                    status = 200
                }
                return (HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: status,
                    httpVersion: nil, headerFields: nil)!, try JSONSerialization.data(withJSONObject: payload))
            }
            let api = try APIClient(baseURL: XCTUnwrap(URL(string: "https://jianwei.example.com")), session: session)
            let identity = DeviceIdentityStore(api: api, keychain: secrets)
            let shared = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
            let model = try makeAuditModel(repository: repository, launchArguments: [], api: api,
                identity: identity, sharedStore: shared)
            await model.refreshPresentationState()
            for _ in 0..<2 {
                await model.deleteCloudAndLocalData()
                XCTAssertTrue(model.state.cards.isEmpty)
                XCTAssertTrue(try shared.load().cards.isEmpty)
                XCTAssertFalse(model.automaticDiscoveryEnabled)
                XCTAssertEqual(model.modelAccessMode, .qwenUserKey)
            }
            XCTAssertEqual(registrations.value, 0, "Deletion cannot create a new cloud identity")
            XCTAssertEqual(deletions.value, previouslyManaged ? 1 : 0)
            XCTAssertNil(secrets.string(for: "device-id"))
            XCTAssertNil(secrets.string(for: "device-token"))
            XCTAssertNil(secrets.string(for: "previous-device-token"))
            XCTAssertEqual(secrets.string(for: "installation-id"), installation)
            XCTAssertEqual(secrets.string(for: "qwen-api-key"), "sk-synthetic_key_kept_1234567890")
        }
    }

    @MainActor
    func testFailedCloudDeletionKeepsCredentialsAndNeverRegistersOnRetry() async throws {
        for firstReply in ["offline", "expired", "wrong-device"] {
            let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            defer { try? FileManager.default.removeItem(at: root) }
            let repository = try LocalRepository(rootURL: root.appendingPathComponent("app"))
            try await repository.setModelAccessMode(.qwenUserKey)
            try await repository.upsert(card: makeCard(topic: "private_history"), sanitizedJPEG: makeTestJPEG())
            let configuration = URLSessionConfiguration.ephemeral
            configuration.protocolClasses = [DirectQwenURLProtocol.self]
            let session = URLSession(configuration: configuration)
            defer { session.invalidateAndCancel(); DirectQwenURLProtocol.handler = nil }
            let calls = TestAttemptCounter()
            let secrets = TestSecretStore()
            let device = UUID().uuidString.lowercased()
            let token = String(repeating: "D", count: 43)
            secrets.set(device, for: "device-id")
            secrets.set(token, for: "device-token")
            DirectQwenURLProtocol.handler = { request in
                let attempt = calls.incrementAndRead()
                XCTAssertEqual(request.httpMethod, "DELETE")
                XCTAssertEqual(request.url?.path, "/v1/device-data")
                XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer " + token)
                if attempt == 1 && firstReply == "offline" { throw URLError(.notConnectedToInternet) }
                let status = attempt == 1 && firstReply == "expired" ? 401 : 200
                let body = ["deviceId": attempt == 1 && firstReply == "wrong-device" ? UUID().uuidString : device,
                            "status": "deleted"]
                return (HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: status,
                    httpVersion: nil, headerFields: nil)!, try JSONSerialization.data(withJSONObject: body))
            }
            let api = try APIClient(baseURL: XCTUnwrap(URL(string: "https://jianwei.example.com")), session: session)
            let identity = DeviceIdentityStore(api: api, keychain: secrets)
            let shared = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
            let model = try makeAuditModel(repository: repository, launchArguments: [], api: api,
                                           identity: identity, sharedStore: shared)
            await model.refreshPresentationState()
            await model.deleteCloudAndLocalData()
            XCTAssertEqual(calls.value, 1)
            XCTAssertTrue(model.state.cards.isEmpty)
            XCTAssertTrue(try shared.load().cards.isEmpty)
            XCTAssertTrue(model.message?.contains("云端尚未确认删除") == true)
            XCTAssertEqual(secrets.string(for: "device-id"), device)
            XCTAssertEqual(secrets.string(for: "device-token"), token)
            await model.deleteCloudAndLocalData()
            XCTAssertEqual(calls.value, 2)
            XCTAssertEqual(model.message, "云端设备数据与本机索引都已删除。")
            XCTAssertNil(secrets.string(for: "device-token"))
            XCTAssertEqual(model.modelAccessMode, .qwenUserKey)
        }
    }

    func testCloudDeletionHandlesInvalidatedAndLegacyPartialCredentialsWithoutRegistration() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DirectQwenURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel(); DirectQwenURLProtocol.handler = nil }
        let calls = TestAttemptCounter()
        let device = UUID().uuidString.lowercased()
        DirectQwenURLProtocol.handler = { request in
            _ = calls.incrementAndRead()
            XCTAssertEqual(request.httpMethod, "DELETE")
            return (HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 200,
                httpVersion: nil, headerFields: nil)!,
                try JSONSerialization.data(withJSONObject: ["deviceId": device, "status": "deleted"]))
        }
        let api = try APIClient(baseURL: XCTUnwrap(URL(string: "https://jianwei.example.com")), session: session)
        let secrets = TestSecretStore()
        secrets.set(device, for: "device-id")
        secrets.set(String(repeating: "D", count: 43), for: "device-token")
        let identity = DeviceIdentityStore(api: api, keychain: secrets)
        try await identity.invalidateServerCredential()
        XCTAssertEqual(secrets.string(for: "previous-device-id"), device)
        let deleted = try await identity.deleteExistingCloudData()
        XCTAssertTrue(deleted)
        XCTAssertEqual(calls.value, 1)
        XCTAssertNil(secrets.string(for: "previous-device-id"))
        XCTAssertNil(secrets.string(for: "previous-device-token"))
        // Earlier versions could retain only a token. Do not mistake missing
        // device ID / locked Keychain for an unused account or create a new one.
        secrets.set("legacy-token", for: "previous-device-token")
        do {
            _ = try await identity.deleteExistingCloudData()
            XCTFail("Partial cloud identity is not evidence that deletion succeeded")
        } catch { XCTAssertEqual(error as? ProductError, .managedIdentityRecoveryRequired) }
        XCTAssertEqual(calls.value, 1)
        XCTAssertEqual(secrets.string(for: "previous-device-token"), "legacy-token")
    }

    @MainActor
    func testLateManagedHealthReplyCannotOverrideASwitchToUserKey() async throws {
        for statusCode in [200, 503] {
            let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            defer { try? FileManager.default.removeItem(at: root) }
            let repository = try LocalRepository(rootURL: root.appendingPathComponent("app"))
            try await repository.setModelAccessMode(.managed)
            try await repository.setAutomaticDiscovery(false)
            let pending = DeferredCardSyncResponse(path: "/health")
            DeferredCardSyncURLProtocol.handler = { pending.receive($0) }
            let configuration = URLSessionConfiguration.ephemeral
            configuration.protocolClasses = [DeferredCardSyncURLProtocol.self]
            let session = URLSession(configuration: configuration)
            defer { session.invalidateAndCancel(); DeferredCardSyncURLProtocol.handler = nil }
            let api = try APIClient(baseURL: XCTUnwrap(URL(string: "https://jianwei.example.com")), session: session)
            let model = try makeAuditModel(repository: repository, launchArguments: [], api: api,
                identity: DeviceIdentityStore(api: api, keychain: TestSecretStore()),
                sharedStore: SharedWidgetStore(baseURL: root.appendingPathComponent("widget")))
            await model.refreshPresentationState()
            let check = Task { await model.checkServiceConnection() }
            await fulfillment(of: [pending.received], timeout: 3)
            await model.saveAndUseQwenAPIKey("sk-synthetic_switch_1234567890")
            let keySavedMessage = model.message
            XCTAssertEqual(model.modelAccessMode, .qwenUserKey)
            pending.complete(statusCode: statusCode, data: Data("{\"ok\":true}".utf8))
            await check.value
            XCTAssertEqual(model.serviceConnectionState, .notChecked)
            XCTAssertEqual(model.message, keySavedMessage, "An old health reply cannot replace the new mode's status")
            XCTAssertEqual(pending.requestCount, 1)
        }
    }

    func testCloudDeletionWaitsForAnAlreadyStartedRegistrationAndRemovesItsResult() async throws {
        let pending = DeferredCardSyncResponse(path: "/v1/devices/register")
        let deletions = TestAttemptCounter()
        let device = UUID().uuidString.lowercased()
        let token = String(repeating: "D", count: 43)
        let deletionData = try JSONSerialization.data(withJSONObject: ["deviceId": device, "status": "deleted"])
        DeferredCardSyncURLProtocol.handler = { transport in
            if transport.request.httpMethod == "POST" { pending.receive(transport) }
            else {
                _ = deletions.incrementAndRead()
                XCTAssertEqual(transport.request.httpMethod, "DELETE")
                XCTAssertEqual(transport.request.url?.path, "/v1/device-data")
                XCTAssertEqual(transport.request.value(forHTTPHeaderField: "Authorization"), "Bearer " + token)
                transport.finish(statusCode: 200, data: deletionData)
            }
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DeferredCardSyncURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel(); DeferredCardSyncURLProtocol.handler = nil }
        let api = try APIClient(baseURL: XCTUnwrap(URL(string: "https://jianwei.example.com")), session: session)
        let secrets = TestSecretStore()
        let installation = UUID().uuidString.lowercased()
        secrets.set(installation, for: "installation-id")
        let identity = DeviceIdentityStore(api: api, keychain: secrets)
        let registration = Task { try await identity.credentials() }
        await fulfillment(of: [pending.received], timeout: 3)
        let deletion = Task { try await identity.deleteExistingCloudData() }
        await Task.yield()
        XCTAssertEqual(deletions.value, 0)
        let digest = SHA256.hash(data: Data(("jianwei-installation-binding-v1\0" + installation).utf8))
            .map { String(format: "%02x", $0) }.joined()
        pending.complete(statusCode: 201, data: try JSONSerialization.data(withJSONObject: [
            "deviceId": device, "deviceToken": token, "installationBindingSha256": digest, "created": true]))
        _ = try await registration.value
        let deleted = try await deletion.value
        XCTAssertTrue(deleted)
        XCTAssertEqual(pending.requestCount, 1)
        XCTAssertEqual(deletions.value, 1)
        XCTAssertNil(secrets.string(for: "device-id"))
        XCTAssertNil(secrets.string(for: "device-token"))
        XCTAssertEqual(secrets.string(for: "installation-id"), installation)
        let deletedAgain = try await identity.deleteExistingCloudData()
        XCTAssertFalse(deletedAgain)
        XCTAssertEqual(pending.requestCount, 1)
        XCTAssertEqual(deletions.value, 1)
    }

    @MainActor
    private func makeAuditModel(
        repository: LocalRepository, launchArguments: [String],
        api: APIClient? = nil, identity: DeviceIdentityStore? = nil,
        deviceBetaExperienceEnabled: Bool = false,
        sharedStore: SharedWidgetStore? = nil
    ) throws -> AppModel {
        let modelAccessStore = AIModelAccessStore(keychain: TestSecretStore())
        let subscriptionStore = SubscriptionStore()
        let environment = AppEnvironment(
            repository: repository,
            discovery: PhotoDiscoveryService(),
            pipeline: AnalysisPipeline(
                api: api,
                identity: identity,
                analyzer: PhotoPrivacyAnalyzer(),
                modelAccessStore: modelAccessStore,
                subscriptionStore: subscriptionStore,
                repository: repository,
                directQwen: try DirectQwenService(),
                knowledgeCatalog: try BundledKnowledgeCatalog.load()
            ),
            api: api,
            identity: identity,
            modelAccessStore: modelAccessStore,
            subscriptionStore: subscriptionStore,
            widgetCoordinator: WidgetCoordinator(repository: repository, sharedStore: sharedStore),
            deviceBetaExperienceEnabled: deviceBetaExperienceEnabled
        )
        return AppModel(environment: environment, launchArguments: launchArguments)
    }
    #endif

    func testLocalHTTPAPIRequiresExplicitDeviceBetaAllowance() throws {
        let localURL = try XCTUnwrap(URL(string: "http://wyqdemacbook-air.local:8787"))
        XCTAssertThrowsError(try APIClient(baseURL: localURL))
        XCTAssertNoThrow(try APIClient(baseURL: localURL, allowsLocalHTTP: true))

        let privateIPv4URL = try XCTUnwrap(URL(string: "http://192.168.1.3:8787"))
        XCTAssertThrowsError(try APIClient(baseURL: privateIPv4URL))
        XCTAssertNoThrow(try APIClient(baseURL: privateIPv4URL, allowsLocalHTTP: true))

        let publicIPv4URL = try XCTUnwrap(URL(string: "http://8.8.8.8:8787"))
        XCTAssertThrowsError(try APIClient(baseURL: publicIPv4URL, allowsLocalHTTP: true))
    }

    func testDeviceBetaLocalHTTPOnlyAcceptsRFC1918Addresses() {
        XCTAssertTrue(APIClientTransportPolicy.isPrivateIPv4("10.0.0.8"))
        XCTAssertTrue(APIClientTransportPolicy.isPrivateIPv4("172.16.0.8"))
        XCTAssertTrue(APIClientTransportPolicy.isPrivateIPv4("172.31.255.255"))
        XCTAssertTrue(APIClientTransportPolicy.isPrivateIPv4("192.168.1.3"))
        XCTAssertFalse(APIClientTransportPolicy.isPrivateIPv4("172.32.0.8"))
        XCTAssertFalse(APIClientTransportPolicy.isPrivateIPv4("192.169.1.3"))
        XCTAssertFalse(APIClientTransportPolicy.isPrivateIPv4("8.8.8.8"))
        XCTAssertFalse(APIClientTransportPolicy.isPrivateIPv4("192.168.1"))
        XCTAssertFalse(APIClientTransportPolicy.isPrivateIPv4("192.168.1.999"))
    }

    func testDefaultAPITransportRejectsEveryRedirectBeforeCredentialsOrPhotosCanFollow() throws {
        let request = URLRequest(url: try XCTUnwrap(URL(string: "https://other.example/steal")))
        XCTAssertNil(APIClientTransportPolicy.redirectedRequest(request))
    }

    func testAPIHealthUsesTheReadOnlyHealthEndpoint() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DirectQwenURLProtocol.self]
        let session = URLSession(configuration: configuration)
        DirectQwenURLProtocol.handler = { request in
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(request.url?.path, "/health")
            XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
            let data = Data("{\"ok\":true,\"mode\":\"qwen\"}".utf8)
            return (
                HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 200, httpVersion: nil, headerFields: nil)!,
                data
            )
        }
        let client = try APIClient(
            baseURL: try XCTUnwrap(URL(string: "https://jianwei.example.com")),
            session: session
        )

        try await client.health()
    }

    func testPackedManagedHistoryMatchesServerNormalizationWithoutSendingHistoryText() throws {
        let original = makeCard(topic: "clock")
        func copy(topic: String, body: String) -> KnowledgeCard {
            KnowledgeCard(id: UUID(), candidateToken: UUID(), topicID: topic, factID: UUID().uuidString,
                title: "与知识身份无关的标题", objectName: original.objectName, body: body,
                personalContext: "不能上传的个人上下文", confidence: 0.9, boundingBox: nil,
                sources: original.sources, status: "shown", scheduledDay: "2000-01-01", createdAt: original.createdAt)
        }
        let one = copy(topic: " CLOCK ", body: "  合成 Ａ   fact。 [ref_32]\n")
        let repeated = copy(topic: "clock", body: "合成 A fact。[ref_1]")
        let packed = try XCTUnwrap(APIClient.packedKnowledgeHistory([one, repeated]))
        let digest = try XCTUnwrap(Data(base64Encoded: packed))
        XCTAssertEqual(digest.map { String(format: "%02x", $0) }.joined(),
            "0b3b5f1b5d77fab88f0a57ecfa56c189963fb30a0c0d69a6051ddea935883d3c",
            "Cross-language vector from the gateway's topic/NFKC/reference normalization")
        XCTAssertEqual(APIClient.packedKnowledgeHistory([copy(topic: "\u{FEFF}clock\u{FEFF}",
            body: "\u{FEFF}合成 A fact。\u{FEFF}")]), packed,
            "JavaScript trims BOM characters, so the iOS digest must do the same")
        let nel = try XCTUnwrap(APIClient.packedKnowledgeHistory([copy(topic: "clock", body: "\u{0085}合成 A fact。\u{0085}")]))
        XCTAssertEqual(Data(base64Encoded: nel)?.map { String(format: "%02x", $0) }.joined(),
            "56500826b9c355fdfeaf66bb40ba220d027403135f496422f23451223c937d43",
            "ICU treats NEL as whitespace but ECMAScript does not; retain it in the wire identity")
        let history = (0..<106).map { copy(topic: "topic-\($0)", body: "不同物件的合成历史。") }
        let all = try XCTUnwrap(APIClient.packedKnowledgeHistory(history))
        XCTAssertEqual(Data(base64Encoded: all)?.count, 106 * 32)
        XCTAssertEqual(APIClient.packedKnowledgeHistory(Array(history.reversed())), all)
        XCTAssertEqual(APIClient.packedKnowledgeHistory([]), "")
        let tooLarge = (0...16384).map { copy(topic: "archive-\($0)", body: "合成长期归档。") }
        XCTAssertNil(APIClient.packedKnowledgeHistory(tooLarge), "Never silently truncate an oversized archive")
    }

    func testPhotoInsightHistoryNegotiatesOnlyAnExplicitMissingV2Route() async throws {
        for legacy in [false, true] {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.protocolClasses = [DirectQwenURLProtocol.self]
            let session = URLSession(configuration: configuration)
            defer { session.invalidateAndCancel(); DirectQwenURLProtocol.handler = nil }
            let calls = TestAttemptCounter()
            let packed = try XCTUnwrap(APIClient.packedKnowledgeHistory([makeCard(topic: "old")]))
            DirectQwenURLProtocol.handler = { request in
                let index = calls.incrementAndRead()
                XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer same-managed-credential")
                let body = try XCTUnwrap(try JSONSerialization.jsonObject(with: requestBodyData(request)) as? [String: Any])
                let candidate = try XCTUnwrap(body["candidateId"] as? String)
                XCTAssertEqual(request.value(forHTTPHeaderField: "Idempotency-Key"), "photo-" + candidate)
                let v2 = !legacy || index == 1
                XCTAssertEqual(request.url?.path, v2 ? "/v2/photo-insights" : "/v1/photo-insights")
                XCTAssertEqual(body["knownKnowledgeHashes"] as? String, v2 ? packed : nil)
                let status = legacy && index == 1 ? 404 : 200
                let reply: [String: Any] = status == 404
                    ? ["error": ["code": "not_found", "message": "接口不存在"]]
                    : ["status": "no_insight", "candidateId": candidate, "reason": "research_no_fact"]
                return (HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!,
                    try JSONSerialization.data(withJSONObject: reply))
            }
            let client = try APIClient(baseURL: URL(string: "https://managed.synthetic.invalid")!, session: session)
            for _ in 0..<2 {
                let card = try await client.photoInsight(bearer: "same-managed-credential", candidateToken: UUID(),
                    jpeg: makeTestJPEG(), localLabels: [], interests: [], knownKnowledgeHashes: packed)
                XCTAssertNil(card)
            }
            XCTAssertEqual(calls.value, legacy ? 3 : 2, "An old gateway is probed once, not once per candidate")
        }
    }

    func testPhotoInsightHistoryNeverDowngradesAuthenticationLimitsOrAmbiguousErrors() async throws {
        for (status, code) in [(404, "model_not_found"), (400, "not_found"), (401, "not_found"),
                               (429, "not_found"), (503, "not_found")] {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.protocolClasses = [DirectQwenURLProtocol.self]
            let session = URLSession(configuration: configuration)
            defer { session.invalidateAndCancel(); DirectQwenURLProtocol.handler = nil }
            let calls = TestAttemptCounter()
            let candidate = UUID()
            DirectQwenURLProtocol.handler = { request in
                _ = calls.incrementAndRead()
                XCTAssertEqual(request.url?.path, "/v2/photo-insights")
                XCTAssertEqual(request.value(forHTTPHeaderField: "Idempotency-Key"), "photo-" + candidate.uuidString.lowercased())
                return (HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!,
                    try JSONSerialization.data(withJSONObject: ["error": ["code": code]]))
            }
            let client = try APIClient(baseURL: URL(string: "https://managed.synthetic.invalid")!, session: session)
            do {
                _ = try await client.photoInsight(bearer: "same-managed-credential", candidateToken: candidate,
                    jpeg: makeTestJPEG(), localLabels: [], interests: [], knownKnowledgeHashes: "")
                XCTFail("A provider or authorization error is not permission to change the request contract")
            } catch { XCTAssertTrue(error is ProductError) }
            XCTAssertEqual(calls.value, status == 503 ? 3 : 1)
        }
    }

    func testPhotoInsightRejectsUnclassifiedNoInsightWithoutImmediateRetry() async throws {
        let reasons: [String?] = [nil, "", "upstream_timeout", "rate_limited", "unknown_future_reason"]
        for reason in reasons {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.protocolClasses = [DirectQwenURLProtocol.self]
            let session = URLSession(configuration: configuration)
            defer { session.invalidateAndCancel(); DirectQwenURLProtocol.handler = nil }
            let candidate = UUID()
            let attempts = TestAttemptCounter()
            DirectQwenURLProtocol.handler = { request in
                _ = attempts.incrementAndRead()
                XCTAssertEqual(request.value(forHTTPHeaderField: "Idempotency-Key"), "photo-" + candidate.uuidString.lowercased())
                var payload: [String: Any] = ["status": "no_insight", "candidateId": candidate.uuidString.lowercased(), "card": NSNull()]
                if let reason { payload["reason"] = reason }
                return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                        try JSONSerialization.data(withJSONObject: payload))
            }
            let api = try APIClient(baseURL: URL(string: "https://managed.synthetic.invalid")!, session: session)
            do {
                _ = try await api.photoInsight(bearer: "synthetic-token", candidateToken: candidate,
                    jpeg: makeTestJPEG(), localLabels: [], interests: [])
                XCTFail("Unclassified no-insight must not permanently exhaust a photo: \(reason ?? "missing")")
            } catch {
                XCTAssertEqual(error as? ProductError, .invalidServerResponse)
            }
            XCTAssertEqual(attempts.value, 1, "An invalid cached response is not an instruction to make more immediate requests")
        }
    }

    func testUnavailableKnowledgeSourceDoesNotRepeatPaidPhotoRequest() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DirectQwenURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel(); DirectQwenURLProtocol.handler = nil }
        let attempts = TestAttemptCounter()
        DirectQwenURLProtocol.handler = { request in
            _ = attempts.incrementAndRead()
            return (HTTPURLResponse(url: request.url!, statusCode: 503, httpVersion: nil, headerFields: nil)!,
                    Data("{\"error\":{\"code\":\"source_temporarily_unavailable\"}}".utf8))
        }
        let api = try APIClient(baseURL: URL(string: "https://managed.synthetic.invalid")!, session: session)
        do {
            _ = try await api.photoInsight(bearer: "synthetic-token", candidateToken: UUID(),
                jpeg: makeTestJPEG(), localLabels: [], interests: [])
            XCTFail("Unreachable sources are not evidence that this photo has no knowledge")
        } catch {
            XCTAssertEqual(error as? ProductError, .knowledgeSourceUnavailable)
        }
        XCTAssertEqual(attempts.value, 1)
        XCTAssertTrue(APIClient.isRetryablePhotoInsightError(ProductError.requestFailed(503)),
                      "Generic service outages retain their existing retry policy")
    }

    func testManagedProviderAccessFailureStopsImmediateRetryAndSamePhotoCanRecover() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DirectQwenURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel(); DirectQwenURLProtocol.handler = nil }
        let attempts = TestAttemptCounter()
        let candidate = UUID()
        DirectQwenURLProtocol.handler = { request in
            XCTAssertEqual(request.value(forHTTPHeaderField: "Idempotency-Key"), "photo-" + candidate.uuidString.lowercased())
            let first = attempts.incrementAndRead() == 1
            let payload: [String: Any] = first
                ? ["error": ["code": "managed_provider_access_unavailable"]]
                : ["status": "no_insight", "candidateId": candidate.uuidString.lowercased(), "reason": "no_object"]
            return (HTTPURLResponse(url: request.url!, statusCode: first ? 424 : 200, httpVersion: nil, headerFields: nil)!,
                    try JSONSerialization.data(withJSONObject: payload))
        }
        let api = try APIClient(baseURL: URL(string: "https://managed.synthetic.invalid")!, session: session)
        do {
            _ = try await api.photoInsight(bearer: "synthetic-token", candidateToken: candidate,
                jpeg: makeTestJPEG(), localLabels: [], interests: [])
            XCTFail("Provider access must not be treated as a photo rejection or silently retried")
        } catch { XCTAssertEqual(error as? ProductError, .managedServiceUnavailable) }
        XCTAssertEqual(attempts.value, 1)
        XCTAssertFalse(ProductError.managedServiceUnavailable.requiresModelAccessAction)
        XCTAssertFalse(APIClient.isRetryablePhotoInsightError(ProductError.managedServiceUnavailable))
        XCTAssertFalse(APIClient.isRetryablePhotoInsightError(ProductError.requestFailed(424)), "Already-installed clients must also avoid immediate retry")
        let result = try await api.photoInsight(bearer: "synthetic-token", candidateToken: candidate,
            jpeg: makeTestJPEG(), localLabels: [], interests: [])
        XCTAssertNil(result)
        XCTAssertEqual(attempts.value, 2, "A later logical attempt can use the same candidate and key")
    }

    func testPhotoInsightAcceptsCurrentAndLegacyTerminalReasons() async throws {
        // Include reasons observed in the deployed gateway, not only the new implementation.
        for reason in ["no_object", "no_qualified_fact", "research_no_fact",
                       "cached_fact_photo_mismatch_and_research_no_fact", "dynamic_fact_evidence_rejected",
                       "dynamic_fact_photo_mismatch", "dynamic_fact_quality_rejected", "dynamic_fact_object_mismatch"] {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.protocolClasses = [DirectQwenURLProtocol.self]
            let session = URLSession(configuration: configuration)
            defer { session.invalidateAndCancel(); DirectQwenURLProtocol.handler = nil }
            let candidate = UUID()
            DirectQwenURLProtocol.handler = { request in
                let payload: [String: Any] = ["status": "no_insight", "candidateId": candidate.uuidString.lowercased(), "card": NSNull(), "reason": reason]
                return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                        try JSONSerialization.data(withJSONObject: payload))
            }
            let api = try APIClient(baseURL: URL(string: "https://managed.synthetic.invalid")!, session: session)
            let card = try await api.photoInsight(bearer: "synthetic-token", candidateToken: candidate,
                jpeg: makeTestJPEG(), localLabels: [], interests: [])
            XCTAssertNil(card, reason)
        }
    }

    func testPhotoInsightUsesProductEndpointAndStableIdempotencyKey() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DirectQwenURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let candidate = UUID()
        let jpeg = Data([0xff, 0xd8, 0xff] + Array(repeating: 0, count: 40))
        DirectQwenURLProtocol.handler = { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url?.path, "/v1/photo-insights")
            XCTAssertEqual(
                request.value(forHTTPHeaderField: "Idempotency-Key"),
                "photo-" + candidate.uuidString.lowercased()
            )
            let payload = try XCTUnwrap(
                try JSONSerialization.jsonObject(with: requestBodyData(request)) as? [String: Any]
            )
            XCTAssertEqual(payload["targetDay"] as? String, "2026-09-05")
            return (
                HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 200, httpVersion: nil, headerFields: nil)!,
                Data(("{\"status\":\"no_insight\",\"candidateId\":\"" + candidate.uuidString.lowercased() + "\",\"card\":null,\"reason\":\"research_no_fact\"}").utf8)
            )
        }
        let client = try APIClient(
            baseURL: try XCTUnwrap(URL(string: "https://jianwei.example.com")),
            session: session
        )

        let card = try await client.photoInsight(
            bearer: "test-token",
            candidateToken: candidate,
            jpeg: jpeg,
            localLabels: ["物件"],
            interests: ["生活设计"],
            targetDay: "2026-09-05"
        )

        XCTAssertNil(card)
    }

    func testPhotoInsightRetriesATransientTransportFailureWithTheSameIdempotencyKey() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DirectQwenURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let candidate = UUID()
        let jpeg = Data([0xff, 0xd8, 0xff] + Array(repeating: 0, count: 40))
        let attempts = TestAttemptCounter()
        DirectQwenURLProtocol.handler = { request in
            XCTAssertEqual(
                request.value(forHTTPHeaderField: "Idempotency-Key"),
                "photo-" + candidate.uuidString.lowercased()
            )
            if attempts.incrementAndRead() == 1 {
                throw URLError(.networkConnectionLost)
            }
            return (
                HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 200, httpVersion: nil, headerFields: nil)!,
                Data(("{\"status\":\"no_insight\",\"candidateId\":\"" + candidate.uuidString.lowercased() + "\",\"card\":null,\"reason\":\"research_no_fact\"}").utf8)
            )
        }
        let client = try APIClient(
            baseURL: try XCTUnwrap(URL(string: "https://jianwei.example.com")),
            session: session
        )

        let card = try await client.photoInsight(
            bearer: "test-token",
            candidateToken: candidate,
            jpeg: jpeg,
            localLabels: ["物件"],
            interests: ["生活设计"],
            targetDay: "2026-09-07"
        )

        XCTAssertNil(card)
        XCTAssertEqual(attempts.value, 2)
    }

    func testPhotoInsightRecoversFromIncompleteModelReviewWithoutChangingThePhotoOrKey() async throws {
        for code in ["invalid_research_response", "invalid_evidence_verification_response", "invalid_interestingness_response"] {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.protocolClasses = [DirectQwenURLProtocol.self]
            let session = URLSession(configuration: configuration)
            defer { session.invalidateAndCancel() }
            let candidate = UUID()
            let cardID = UUID()
            let jpeg = Data([0xff, 0xd8, 0xff] + Array(repeating: 0, count: 40))
            let attempts = TestAttemptCounter()
            let readyData = try JSONSerialization.data(withJSONObject: [
                "status": "ready", "candidateId": candidate.uuidString.lowercased(),
                "card": [
                    "cardId": cardID.uuidString.lowercased(), "candidateToken": candidate.uuidString.lowercased(),
                    "topicId": "clock", "factId": "synthetic-clock", "title": "合成协议测试标题",
                    "detectedObjectName": "时钟", "body": "这不是实际知识，仅验证客户端能接收恢复后的卡片。",
                    "personalContext": "协议回归控制", "confidence": 0.95,
                    "sources": [["sourceId": "synthetic-source", "title": "Synthetic source", "url": "https://example.edu/clock", "publisher": "example.edu", "authority": "official"]],
                    "status": "candidate", "scheduledDate": "", "createdAt": "2026-09-06T00:00:00Z"
                ]
            ])
            DirectQwenURLProtocol.handler = { request in
                XCTAssertEqual(request.url?.path, "/v1/photo-insights")
                XCTAssertEqual(request.value(forHTTPHeaderField: "Idempotency-Key"), "photo-" + candidate.uuidString.lowercased())
                let payload = try XCTUnwrap(try JSONSerialization.jsonObject(with: requestBodyData(request)) as? [String: Any])
                XCTAssertEqual(payload["candidateId"] as? String, candidate.uuidString.lowercased())
                XCTAssertEqual(payload["jpegBase64"] as? String, jpeg.base64EncodedString())
                XCTAssertEqual(payload["targetDay"] as? String, "2026-09-06")
                let failed = attempts.incrementAndRead() == 1
                let data = failed ? try JSONSerialization.data(withJSONObject: ["error": ["code": code]]) : readyData
                return (HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: failed ? 502 : 200, httpVersion: nil, headerFields: nil)!, data)
            }
            let client = try APIClient(baseURL: XCTUnwrap(URL(string: "https://jianwei.example.com")), session: session)
            let card = try await client.photoInsight(bearer: "test-token", candidateToken: candidate, jpeg: jpeg, localLabels: [], interests: [], targetDay: "2026-09-06")
            XCTAssertEqual(card?.id, cardID)
            XCTAssertEqual(card?.candidateToken, candidate)
            XCTAssertEqual(attempts.value, 2)
        }
    }

    func testIncompleteModelReviewRetriesAreBoundedAndStopWhenTheDailyBudgetIsExhausted() async throws {
        for budgetExhausted in [false, true] {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.protocolClasses = [DirectQwenURLProtocol.self]
            let session = URLSession(configuration: configuration)
            defer { session.invalidateAndCancel() }
            let candidate = UUID()
            let attempts = TestAttemptCounter()
            DirectQwenURLProtocol.handler = { request in
                XCTAssertEqual(request.value(forHTTPHeaderField: "Idempotency-Key"), "photo-" + candidate.uuidString.lowercased())
                let blocked = attempts.incrementAndRead() > 1 && budgetExhausted
                let data = try JSONSerialization.data(withJSONObject: ["error": ["code": blocked ? "daily_budget_exceeded" : "invalid_interestingness_response"]])
                return (HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: blocked ? 429 : 502, httpVersion: nil, headerFields: nil)!, data)
            }
            let client = try APIClient(baseURL: XCTUnwrap(URL(string: "https://jianwei.example.com")), session: session)
            do {
                _ = try await client.photoInsight(bearer: "test-token", candidateToken: candidate, jpeg: Data([0xff, 0xd8, 0xff] + Array(repeating: 0, count: 40)), localLabels: [], interests: [])
                XCTFail("Incomplete review must not be reported as a terminal no-insight result")
            } catch let error as ProductError {
                XCTAssertEqual(error, budgetExhausted ? .dailyAnalysisLimitReached : .requestFailed(502))
            }
            XCTAssertEqual(attempts.value, budgetExhausted ? 2 : 3)
        }
    }

    func testPhotoInsightRetryPolicyExcludesAuthenticationAndCancellation() {
        XCTAssertTrue(APIClient.isRetryablePhotoInsightError(ProductError.requestFailed(408)))
        XCTAssertTrue(APIClient.isRetryablePhotoInsightError(ProductError.requestFailed(409)))
        XCTAssertTrue(APIClient.isRetryablePhotoInsightError(ProductError.requestFailed(URLError.timedOut.rawValue)))
        XCTAssertFalse(APIClient.isRetryablePhotoInsightError(ProductError.serverCredentialExpired))
        XCTAssertFalse(APIClient.isRetryablePhotoInsightError(ProductError.requestFailed(URLError.cancelled.rawValue)))
    }

    func testStrandedDeviceCredentialCannotSilentlyReplaceTheSubscriptionIdentity() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DirectQwenURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let originalInstallationID = UUID()
        let replacementDeviceID = UUID()
        let replacementToken = String(repeating: "A", count: 43)
        let secrets = TestSecretStore()
        try secrets.set(originalInstallationID.uuidString.lowercased(), for: "installation-id")
        try secrets.set(UUID().uuidString.lowercased(), for: "device-id")
        try secrets.set("stale-token", for: "device-token")

        DirectQwenURLProtocol.handler = { request in
            if request.value(forHTTPHeaderField: "Authorization") != nil {
                return (
                    HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 401, httpVersion: nil, headerFields: nil)!,
                    Data("{\"error\":{\"code\":\"installation_binding_proof_required\",\"message\":\"stale\"}}".utf8)
                )
            }
            let payload = try XCTUnwrap(
                try JSONSerialization.jsonObject(with: requestBodyData(request)) as? [String: Any]
            )
            let installationID = try XCTUnwrap(payload["installationId"] as? String)
            let digest = SHA256.hash(data: Data(("jianwei-installation-binding-v1\0" + installationID).utf8))
                .map { String(format: "%02x", $0) }
                .joined()
            let response: [String: Any] = [
                "deviceId": replacementDeviceID.uuidString.lowercased(),
                "deviceToken": replacementToken,
                "installationBindingSha256": digest,
                "created": true
            ]
            return (
                HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 201, httpVersion: nil, headerFields: nil)!,
                try JSONSerialization.data(withJSONObject: response)
            )
        }
        let client = try APIClient(
            baseURL: try XCTUnwrap(URL(string: "https://jianwei.example.com")),
            session: session
        )
        let identity = DeviceIdentityStore(api: client, keychain: secrets)
        try await identity.invalidateServerCredential()

        do {
            _ = try await identity.credentials()
            XCTFail("A new anonymous identity strands the existing subscription and orphans cloud deletion")
        } catch let error as ProductError {
            XCTAssertEqual(error, .managedIdentityRecoveryRequired)
            XCTAssertTrue(error.requiresModelAccessAction)
        }
        XCTAssertEqual(try secrets.string(for: "installation-id"), originalInstallationID.uuidString.lowercased())
        XCTAssertEqual(try secrets.string(for: "previous-device-token"), "stale-token")
        XCTAssertNil(try secrets.string(for: "device-token"))
    }

    func testOwnedPurchaseRecoversLostBearerWithoutChangingInstallation() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DirectQwenURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let installation = UUID()
        let device = UUID()
        let token = String(repeating: "B", count: 43)
        let receipt = "synthetic.owned.receipt"
        let secrets = TestSecretStore()
        try secrets.set(installation.uuidString.lowercased(), for: "installation-id")
        try secrets.set("lost-token", for: "previous-device-token")
        let attempts = TestAttemptCounter()
        let proofReads = TestAttemptCounter()
        DirectQwenURLProtocol.handler = { request in
            let index = attempts.incrementAndRead()
            XCTAssertEqual(request.url?.path, "/v1/devices/register")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer lost-token")
            let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: requestBodyData(request)) as? [String: String])
            XCTAssertEqual(payload, ["installationId": installation.uuidString.lowercased()])
            if index == 1 {
                XCTAssertNil(request.value(forHTTPHeaderField: "X-Jianwei-App-Store-Transaction"))
                return (HTTPURLResponse(url: request.url!, statusCode: 401, httpVersion: nil, headerFields: nil)!,
                        Data("{\"error\":{\"code\":\"installation_binding_proof_required\"}}".utf8))
            }
            XCTAssertEqual(index, 2)
            XCTAssertEqual(request.value(forHTTPHeaderField: "X-Jianwei-App-Store-Transaction"), receipt)
            let digest = SHA256.hash(data: Data(("jianwei-installation-binding-v1\0" + installation.uuidString.lowercased()).utf8))
                .map { String(format: "%02x", $0) }.joined()
            let response: [String: Any] = ["deviceId": device.uuidString.lowercased(), "deviceToken": token,
                                          "installationBindingSha256": digest, "created": false]
            return (HTTPURLResponse(url: request.url!, statusCode: 201, httpVersion: nil, headerFields: nil)!,
                    try JSONSerialization.data(withJSONObject: response))
        }
        let api = try APIClient(baseURL: XCTUnwrap(URL(string: "https://jianwei.example.com")), session: session)
        let identity = DeviceIdentityStore(api: api, keychain: secrets, recoveryTransaction: {
            _ = proofReads.incrementAndRead()
            return receipt
        })
        let recovered = try await identity.credentials()
        XCTAssertEqual(recovered.deviceID, device.uuidString.lowercased())
        XCTAssertEqual(recovered.token, token)
        XCTAssertEqual(try secrets.string(for: "installation-id"), installation.uuidString.lowercased())
        XCTAssertNil(try secrets.string(for: "previous-device-token"))
        XCTAssertEqual(try secrets.string(for: "device-token"), token)
        let cached = try await identity.credentials()
        XCTAssertEqual(cached.token, token)
        XCTAssertEqual(attempts.value, 2)
        XCTAssertEqual(proofReads.value, 1)
    }

    func testFailedPurchaseRecoveryPreservesIdentityAndRetryProof() async throws {
        for status in [401, 402, 503] {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.protocolClasses = [DirectQwenURLProtocol.self]
            let session = URLSession(configuration: configuration)
            defer { session.invalidateAndCancel() }
            let installation = UUID().uuidString.lowercased()
            let secrets = TestSecretStore()
            try secrets.set(installation, for: "installation-id")
            try secrets.set("lost-token", for: "previous-device-token")
            let attempts = TestAttemptCounter()
            DirectQwenURLProtocol.handler = { request in
                let index = attempts.incrementAndRead()
                XCTAssertLessThanOrEqual(index, 2, "Recovery must not enter a registration loop")
                let responseStatus = index == 1 ? 401 : status
                return (HTTPURLResponse(url: request.url!, statusCode: responseStatus, httpVersion: nil, headerFields: nil)!,
                        Data("{\"error\":{\"code\":\"synthetic_recovery_failure\"}}".utf8))
            }
            let api = try APIClient(baseURL: XCTUnwrap(URL(string: "https://jianwei.example.com")), session: session)
            let identity = DeviceIdentityStore(api: api, keychain: secrets, recoveryTransaction: { "synthetic.owned.receipt" })
            do {
                _ = try await identity.credentials()
                XCTFail("Unverified recovery cannot return fresh anonymous credentials")
            } catch let error as ProductError {
                let expected: ProductError = status == 401 ? .managedIdentityRecoveryRequired
                    : status == 402 ? .subscriptionRequired : .requestFailed(503)
                XCTAssertEqual(error, expected)
            }
            XCTAssertEqual(try secrets.string(for: "installation-id"), installation)
            XCTAssertEqual(try secrets.string(for: "previous-device-token"), "lost-token")
            XCTAssertNil(try secrets.string(for: "device-token"))
            XCTAssertEqual(attempts.value, 2)
        }
    }

    func testDailyWinnerProductEndpointOnlyReturnsAnAllowedCandidate() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DirectQwenURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let cards = [makeCard(topic: "broom"), makeCard(topic: "scissors")]
        DirectQwenURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/v1/daily-winner")
            XCTAssertTrue(request.value(forHTTPHeaderField: "Idempotency-Key")?.hasPrefix("winner-") == true)
            let payload: [String: Any] = [
                "cardId": cards[1].id.uuidString.lowercased(),
                "reason": "综合质量与兴趣选出"
            ]
            return (
                HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 200, httpVersion: nil, headerFields: nil)!,
                try JSONSerialization.data(withJSONObject: payload)
            )
        }
        let client = try APIClient(
            baseURL: try XCTUnwrap(URL(string: "https://jianwei.example.com")),
            session: session
        )

        let selected = try await client.dailyWinner(
            bearer: "test-token",
            cards: cards,
            topicAffinities: ["scissors": 5],
            day: "2026-09-03"
        )

        XCTAssertEqual(selected, cards[1].id)
    }

    func testAPIDailyDispatchBudgetIsDistinctFromUnknownOrGlobalThrottling() async throws {
        for code in ["global_daily_budget_exceeded", "global_daily_cost_budget_exceeded", "rate_limited", "daily_dispatch_budget_exceeded"] {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DirectQwenURLProtocol.self]
        let session = URLSession(configuration: configuration)
        DirectQwenURLProtocol.handler = { request in
            let data = try JSONSerialization.data(withJSONObject: ["error": ["code": code, "message": "limit"]])
            return (
                HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 429, httpVersion: nil, headerFields: nil)!,
                data
            )
        }
        let client = try APIClient(
            baseURL: try XCTUnwrap(URL(string: "https://jianwei.example.com")),
            session: session
        )

        do {
            _ = try await client.cards(bearer: "test-token")
            XCTFail("The daily limit must stop the request")
        } catch {
            XCTAssertEqual(error as? ProductError,
                code == "daily_dispatch_budget_exceeded" ? .managedDailyDispatchLimitReached : .requestThrottled)
        }
        }
    }

    func testAPIDeviceDailyBudgetErrorReconcilesTheTargetDay() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DirectQwenURLProtocol.self]
        let session = URLSession(configuration: configuration)
        DirectQwenURLProtocol.handler = { request in
            let data = Data("{\"error\":{\"code\":\"daily_budget_exceeded\",\"message\":\"limit\"}}".utf8)
            return (
                HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 429, httpVersion: nil, headerFields: nil)!,
                data
            )
        }
        let client = try APIClient(
            baseURL: try XCTUnwrap(URL(string: "https://jianwei.example.com")),
            session: session
        )

        do {
            _ = try await client.cards(bearer: "test-token")
            XCTFail("The device daily limit must stop the request")
        } catch {
            XCTAssertEqual(error as? ProductError, .dailyAnalysisLimitReached)
        }
    }

    func testAPIUnauthorizedResponseRequestsCredentialRefresh() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DirectQwenURLProtocol.self]
        let session = URLSession(configuration: configuration)
        DirectQwenURLProtocol.handler = { request in
            let data = Data("{\"error\":{\"code\":\"unauthorized\",\"message\":\"expired\"}}".utf8)
            return (
                HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 401, httpVersion: nil, headerFields: nil)!,
                data
            )
        }
        let client = try APIClient(
            baseURL: try XCTUnwrap(URL(string: "https://jianwei.example.com")),
            session: session
        )

        do {
            _ = try await client.cards(bearer: "stale-token")
            XCTFail("An expired credential must be refreshed instead of shown as a network failure")
        } catch {
            XCTAssertEqual(error as? ProductError, .serverCredentialExpired)
        }
    }

    func testAPICardPaginationRejectsAnUnboundedCursorChain() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DirectQwenURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let cursors = (0..<100).map { _ in UUID() }
        DirectQwenURLProtocol.handler = { request in
            let components = try XCTUnwrap(URLComponents(
                url: try XCTUnwrap(request.url),
                resolvingAgainstBaseURL: false
            ))
            let cursor = components.queryItems?.first(where: { $0.name == "cursor" })?.value
            let pageIndex = cursor.flatMap { value in
                cursors.firstIndex(where: { $0.uuidString.caseInsensitiveCompare(value) == .orderedSame })
            }.map { $0 + 1 } ?? 0
            let payload: [String: Any] = [
                "items": [],
                "nextCursor": cursors[min(pageIndex, cursors.count - 1)].uuidString.lowercased()
            ]
            return (
                HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 200, httpVersion: nil, headerFields: nil)!,
                try JSONSerialization.data(withJSONObject: payload)
            )
        }
        let client = try APIClient(
            baseURL: try XCTUnwrap(URL(string: "https://jianwei.example.com")),
            session: session
        )

        do {
            _ = try await client.cards(bearer: "test-token")
            XCTFail("An unbounded cursor chain must be rejected")
        } catch {
            XCTAssertEqual(error as? ProductError, .invalidServerResponse)
        }
    }

    func testAPIRejectsUploadPathThatOnlyEndsWithTheExpectedEndpoint() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DirectQwenURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let candidate = UUID()
        let sessionID = UUID()
        let jobID = UUID()
        DirectQwenURLProtocol.handler = { request in
            let payload: [String: Any] = [
                "jobId": jobID.uuidString.lowercased(),
                "candidateToken": candidate.uuidString.lowercased(),
                "status": "awaiting_upload",
                "uploadUrl": "https://jianwei.example.com/untrusted/v1/analysis-jobs/\(sessionID.uuidString.lowercased())/image",
                "uploadSessionId": sessionID.uuidString.lowercased(),
                "expiresAt": "2026-09-01T08:00:00Z"
            ]
            return (
                HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 201, httpVersion: nil, headerFields: nil)!,
                try JSONSerialization.data(withJSONObject: payload)
            )
        }
        let client = try APIClient(
            baseURL: try XCTUnwrap(URL(string: "https://jianwei.example.com")),
            session: session
        )

        do {
            _ = try await client.createJob(
                bearer: "test-token",
                candidateToken: candidate,
                capturedDay: nil,
                labels: [],
                qualityScore: 0.9
            )
            XCTFail("A suffix-only upload path match must be rejected")
        } catch {
            XCTAssertEqual(error as? ProductError, .invalidServerResponse)
        }
    }

    func testAPICardSyncDoesNotDropCardsAfterTheOldFiveHundredItemBoundary() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DirectQwenURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let cardIDs = (0..<501).map { _ in UUID() }
        let candidateIDs = (0..<501).map { _ in UUID() }
        DirectQwenURLProtocol.handler = { request in
            let components = try XCTUnwrap(URLComponents(url: try XCTUnwrap(request.url), resolvingAgainstBaseURL: false))
            let cursor = components.queryItems?.first(where: { $0.name == "cursor" })?.value
            let start = cursor.flatMap { value in
                cardIDs.firstIndex(where: { $0.uuidString.lowercased() == value.lowercased() })
            }.map { $0 + 1 } ?? 0
            let end = min(start + 50, cardIDs.count)
            let items: [[String: Any]] = (start..<end).map { index in
                [
                    "cardId": cardIDs[index].uuidString.lowercased(),
                    "candidateToken": candidateIDs[index].uuidString.lowercased(),
                    "topicId": "topic-\(index)",
                    "factId": "fact-\(index)",
                    "title": "标题 \(index)",
                    "detectedObjectName": "物件",
                    "body": "这是一条用于验证完整分页同步的知识内容。",
                    "personalContext": "来自今天的候选照片。",
                    "confidence": 0.9,
                    "sources": [[
                        "sourceId": "source-\(index)",
                        "title": "Reference",
                        "url": "https://example.com/reference",
                        "publisher": "Example",
                        "authority": "reference"
                    ]],
                    "status": "scheduled",
                    "scheduledDate": "2026-08-03",
                    "createdAt": "2026-08-03T00:00:00Z"
                ]
            }
            let payload: [String: Any] = [
                "items": items,
                "nextCursor": end < cardIDs.count ? cardIDs[end - 1].uuidString.lowercased() : NSNull()
            ]
            return (
                HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 200, httpVersion: nil, headerFields: nil)!,
                try JSONSerialization.data(withJSONObject: payload)
            )
        }
        let client = try APIClient(
            baseURL: try XCTUnwrap(URL(string: "https://jianwei.example.com")),
            session: session
        )

        let cards = try await client.cards(bearer: "test-token")

        XCTAssertEqual(cards.count, 501)
        XCTAssertEqual(cards.first?.id, cardIDs.first)
        XCTAssertEqual(cards.last?.id, cardIDs.last)
    }

    func testEphemeralDeviceBetaNeverTreatsAnEmptyServerAsAuthoritative() {
        XCTAssertFalse(RemoteCardSyncPolicy.allows(
            deviceBetaExperienceEnabled: true,
            modelAccessMode: .managed
        ))
        XCTAssertTrue(RemoteCardSyncPolicy.allows(
            deviceBetaExperienceEnabled: false,
            modelAccessMode: .managed
        ))
        XCTAssertFalse(RemoteCardSyncPolicy.allows(
            deviceBetaExperienceEnabled: false,
            modelAccessMode: .qwenUserKey
        ))
    }

    func testDailySelectionKeepsOtherGoodPhotoAndExhaustsNoMatchPhoto() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let repository = try LocalRepository(rootURL: root)
        let goodA = makeCandidate(state: .knowledgeReady)
        let goodB = makeCandidate(state: .knowledgeReady)
        let exhausted = makeCandidate(state: .exhausted)
        let winner = makeCard(topic: "winner", candidateToken: goodA.id)
            .withPresentation(status: "candidate", scheduledDay: "")
        let runnerUp = makeCard(topic: "runner-up", candidateToken: goodB.id)
            .withPresentation(status: "candidate", scheduledDay: "")
        for candidate in [goodA, goodB, exhausted] {
            try await repository.upsert(candidate: candidate)
        }
        try await repository.upsert(card: winner, sanitizedJPEG: nil)
        try await repository.upsert(card: runnerUp, sanitizedJPEG: nil)

        try await repository.finalizeDailySelection(
            day: "2026-08-31",
            selectedCardID: winner.id,
            candidateIDs: [goodA.id, goodB.id, exhausted.id],
            scannedAt: Date(timeIntervalSince1970: 1_700_000_000)
        )

        let state = await repository.snapshot()
        XCTAssertEqual(state.cards.count, 2, "合格但未胜出的知识不应被删除")
        XCTAssertEqual(state.cards.first(where: { $0.id == winner.id })?.status, "scheduled")
        XCTAssertEqual(state.cards.first(where: { $0.id == runnerUp.id })?.status, "candidate")
        XCTAssertEqual(state.cards.first(where: { $0.id == runnerUp.id })?.scheduledDay, "2026-08-31")
        XCTAssertEqual(state.candidates.first(where: { $0.id == goodA.id })?.state, .selected)
        XCTAssertEqual(state.candidates.first(where: { $0.id == goodB.id })?.state, .knowledgeReady)
        XCTAssertEqual(state.candidates.first(where: { $0.id == exhausted.id })?.state, .exhausted)
        XCTAssertEqual(state.dailyPreparations["2026-08-31"]?.status, .ready)
        XCTAssertEqual(state.dailyPreparations["2026-08-31"]?.selectedCardID, winner.id)
    }

    func testRemoteSyncPreservesLocalCandidatesAndUnsavedHistoryCardsMissingFromTheResponse() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let repository = try LocalRepository(rootURL: root)
        let winner = makeCard(topic: "winner")
        let runnerUp = makeCard(topic: "runner-up")
            .withPresentation(status: "candidate", scheduledDay: winner.scheduledDay)
        let previouslyShown = makeCard(topic: "previously-shown")
            .withPresentation(status: "shown", scheduledDay: "2026-08-26")
        for card in [winner, runnerUp, previouslyShown] {
            try await repository.upsert(card: card, sanitizedJPEG: nil)
        }

        try await repository.setOnboardingCompleted(true)
        let syncToken = try await repository.remoteCardSyncToken()
        try await repository.replaceRemoteCards([winner, winner], syncToken: syncToken)

        let state = await repository.snapshot()
        XCTAssertEqual(Set(state.cards.map(\.id)), Set([winner.id, runnerUp.id, previouslyShown.id]))
    }

    func testClearingLocalDataPreservesChosenBillingModeAndStopsDiscovery() async throws {
        for mode in [ModelAccessMode.qwenUserKey, .managed] {
            let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            defer { try? FileManager.default.removeItem(at: root) }
            let repository = try LocalRepository(rootURL: root)
            try await repository.setModelAccessMode(mode)
            try await repository.setAutomaticDiscovery(true)
            try await repository.setOnboardingCompleted(true)
            try await repository.upsert(card: makeCard(topic: "before_clear"), sanitizedJPEG: makeTestJPEG())
            try await repository.deleteLocalData()
            let reopened = try LocalRepository(rootURL: root)
            let state = await reopened.snapshot()
            XCTAssertEqual(state.modelAccessMode, mode, "Clearing photos is not permission to change who pays")
            XCTAssertFalse(state.automaticDiscoveryEnabled)
            XCTAssertFalse(state.onboardingCompleted)
            XCTAssertTrue(state.cards.isEmpty)
        }
    }

    #if DEBUG
    @MainActor
    func testRemoteSyncCannotUndoDeletionOrModeChangesAndDoesNotRenewStaleCredentials() async throws {
        // All HTTP replies are synthetic and deferred locally. Exercise the real
        // AppModel -> APIClient -> repository -> widget path, not a live account.
        for action in ["delete", "delete_page", "mode", "expired_mode", "normal"] {
            let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            defer { try? FileManager.default.removeItem(at: root) }
            let repository = try LocalRepository(rootURL: root.appendingPathComponent("app"))
            try await repository.setOnboardingCompleted(true)
            try await repository.setModelAccessMode(.managed)
            let local = makeCard(topic: "existing_history")
            let remote = makeCard(topic: "remote_history")
            try await repository.upsert(card: local, sanitizedJPEG: makeTestJPEG())
            let shared = try SharedWidgetStore(baseURL: root.appendingPathComponent("widget"))
            let pending = DeferredCardSyncResponse()
            DeferredCardSyncURLProtocol.handler = { pending.receive($0) }
            let configuration = URLSessionConfiguration.ephemeral
            configuration.protocolClasses = [DeferredCardSyncURLProtocol.self]
            let session = URLSession(configuration: configuration)
            defer { session.invalidateAndCancel(); DeferredCardSyncURLProtocol.handler = nil }
            let api = try APIClient(baseURL: XCTUnwrap(URL(string: "https://jianwei.example.com")), session: session)
            let secrets = TestSecretStore()
            let deviceID = UUID().uuidString.lowercased()
            let token = String(repeating: "A", count: 43)
            secrets.set(deviceID, for: "device-id")
            secrets.set(token, for: "device-token")
            let identity = DeviceIdentityStore(api: api, keychain: secrets)
            let model = try makeAuditModel(repository: repository, launchArguments: [], api: api,
                                           identity: identity, sharedStore: shared)
            await model.refreshPresentationState()
            let work = Task { await model.synchronizeCards(showFailure: true) }
            await fulfillment(of: [pending.received], timeout: 3)
            if action.hasPrefix("delete") {
                await model.deleteLocalData()
                await model.synchronizeCards()
                XCTAssertEqual(pending.requestCount, 1, "Cleared onboarding cannot auto-import old cloud cards")
                // Returning to the same allowed state must not revive old work.
                try await repository.setOnboardingCompleted(true)
                await model.refreshPresentationState()
            } else if action != "normal" {
                try await repository.setModelAccessMode(.qwenUserKey)
                try await repository.setModelAccessMode(.managed)
                await model.refreshPresentationState()
            }
            if action == "expired_mode" {
                pending.complete(statusCode: 401, data: Data("{\"error\":{\"code\":\"unauthorized\"}}".utf8))
            } else {
                pending.complete(statusCode: 200, data: try remoteSyncPayload(
                    remote, nextCursor: action == "delete_page" ? remote.id.uuidString : nil))
            }
            await work.value
            let reopened = try LocalRepository(rootURL: root.appendingPathComponent("app"))
            let stored = await reopened.snapshot()
            let expected = action.hasPrefix("delete") ? Set<UUID>()
                : action == "normal" ? Set([local.id, remote.id]) : Set([local.id])
            XCTAssertEqual(Set(stored.cards.map(\.id)), expected, action)
            XCTAssertEqual(Set(model.historyCards.map(\.id)), expected, action)
            XCTAssertEqual(Set(try shared.load().cards.map(\.id)), expected, action)
            XCTAssertEqual(pending.requestCount, 1, "A stale 401 cannot register or fetch again")
            XCTAssertEqual(secrets.string(for: "device-id"), deviceID)
            XCTAssertEqual(secrets.string(for: "device-token"), token)
            XCTAssertNil(secrets.string(for: "previous-device-token"))
            XCTAssertFalse(model.message?.contains("暂时无法同步") ?? false,
                           "An obsolete response cannot replace current deletion or mode feedback")
        }
    }

    private func remoteSyncPayload(_ card: KnowledgeCard, nextCursor: String? = nil) throws -> Data {
        try JSONSerialization.data(withJSONObject: [
            "items": [[
                "cardId": card.id.uuidString, "candidateToken": card.candidateToken.uuidString,
                "topicId": card.topicID, "factId": card.factID, "title": card.title,
                "detectedObjectName": card.objectName, "body": card.body,
                "personalContext": card.personalContext, "confidence": card.confidence,
                "sources": [["sourceId": "test", "title": "Synthetic reference", "url": "https://example.com/test",
                             "publisher": "Test", "authority": "reference"]],
                "status": "scheduled", "scheduledDate": card.scheduledDay,
                "createdAt": ISO8601DateFormatter().string(from: card.createdAt)
            ]],
            "nextCursor": nextCursor as Any? ?? NSNull()
        ])
    }
    #endif

    func testRemoteSyncCommitRejectsInvalidatedTicketsEvenAfterReturningToManagedOnboarding() async throws {
        for mutation in ["delete", "mode", "onboarding", "invalidate"] {
            let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            defer { try? FileManager.default.removeItem(at: root) }
            let repository = try LocalRepository(rootURL: root)
            try await repository.setOnboardingCompleted(true)
            let token = try await repository.remoteCardSyncToken()
            switch mutation {
            case "delete": try await repository.deleteLocalData()
            case "mode": try await repository.setModelAccessMode(.qwenUserKey)
            case "onboarding": try await repository.setOnboardingCompleted(false)
            default: await repository.invalidateRemoteCardSync()
            }
            try await repository.setOnboardingCompleted(true)
            try await repository.setModelAccessMode(.managed)
            let card = makeCard(topic: "late_remote")
            do {
                try await repository.replaceRemoteCards([card], syncToken: token)
                XCTFail("A response that already passed transport checks must still fail at the final write")
            } catch { XCTAssertTrue(error is CancellationError, mutation) }
            let unchanged = await repository.snapshot()
            XCTAssertTrue(unchanged.cards.isEmpty)
            // A new explicitly eligible sync is allowed; invalidation is not a
            // permanent ban on normal managed history updates.
            let fresh = try await repository.remoteCardSyncToken()
            try await repository.replaceRemoteCards([card], syncToken: fresh)
            let updated = await repository.snapshot()
            XCTAssertEqual(updated.cards.map(\.id), [card.id])
        }
    }

    func testRemoteSyncNeverOverwritesLocalDailyPoolAssignments() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let repository = try LocalRepository(rootURL: root)
        let retryable = makeCard(topic: "retryable")
            .withPresentation(status: "candidate", scheduledDay: "")
        let manualToday = makeCard(topic: "manual")
            .withPresentation(status: "scheduled", scheduledDay: "2026-09-01")
        try await repository.upsert(card: retryable, sanitizedJPEG: nil)
        try await repository.upsert(card: manualToday, sanitizedJPEG: nil)

        try await repository.setOnboardingCompleted(true)
        let syncToken = try await repository.remoteCardSyncToken()
        try await repository.replaceRemoteCards([
            retryable.withPresentation(status: "scheduled", scheduledDay: "2026-09-02"),
            manualToday.withPresentation(status: "scheduled", scheduledDay: "2026-09-03")
        ], syncToken: syncToken)

        let state = await repository.snapshot()
        let mergedRetryable = try XCTUnwrap(state.cards.first(where: { $0.id == retryable.id }))
        XCTAssertEqual(mergedRetryable.status, "candidate")
        XCTAssertEqual(mergedRetryable.scheduledDay, "")
        let mergedManual = try XCTUnwrap(state.cards.first(where: { $0.id == manualToday.id }))
        XCTAssertEqual(mergedManual.status, "scheduled")
        XCTAssertEqual(mergedManual.scheduledDay, "2026-09-01")
    }

    func testDiscoveryMessageDistinguishesUploadedPhotosFromLocalFiltering() {
        let analyzed = DiscoveryRunSummary(
            inspected: 2,
            analyzed: 2,
            cardsCreated: 0,
            knowledgeReady: 0,
            exhausted: 2,
            filtered: 0,
            failed: 0,
            accessError: nil
        )
        let analyzedMessage = DiscoveryRunMessage.text(for: analyzed, maximumCandidates: 3)
        XCTAssertTrue(analyzedMessage.contains("已交给 AI 分析的 2 张照片"))
        XCTAssertFalse(analyzedMessage.contains("本机筛选中被排除"))

        let locallyFiltered = DiscoveryRunSummary(
            inspected: 2,
            analyzed: 0,
            cardsCreated: 0,
            knowledgeReady: 0,
            exhausted: 0,
            filtered: 2,
            failed: 0,
            accessError: nil
        )
        let filteredMessage = DiscoveryRunMessage.text(for: locallyFiltered, maximumCandidates: 3)
        XCTAssertTrue(filteredMessage.contains("没有上传给 AI"))
    }

    func testDailySelectionCanPublishAnOlderReadyCardWhileThreeNewPhotosReachTerminalStates() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let repository = try LocalRepository(rootURL: root)
        let olderReady = makeCandidate(state: .knowledgeReady)
        let olderCard = makeCard(topic: "carry-over", candidateToken: olderReady.id)
            .withPresentation(status: "candidate", scheduledDay: "")
        let newExhausted = (0..<3).map { _ in makeCandidate(state: .exhausted) }
        try await repository.upsert(candidate: olderReady)
        try await repository.upsert(card: olderCard, sanitizedJPEG: nil)
        for candidate in newExhausted { try await repository.upsert(candidate: candidate) }

        try await repository.finalizeDailySelection(
            day: "2026-09-01",
            selectedCardID: olderCard.id,
            candidateIDs: Set(newExhausted.map(\.id)),
            scannedAt: Date(timeIntervalSince1970: 1_700_086_400)
        )

        let state = await repository.snapshot()
        XCTAssertEqual(state.cards.first(where: { $0.id == olderCard.id })?.status, "scheduled")
        XCTAssertEqual(state.candidates.first(where: { $0.id == olderReady.id })?.state, .selected)
        XCTAssertTrue(newExhausted.allSatisfy { candidate in
            state.candidates.first(where: { $0.id == candidate.id })?.state == .exhausted
        })
    }

    func testImmediatePublicationShowsAUserInitiatedRetryWithoutConsumingDailySelection() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let repository = try LocalRepository(rootURL: root)
        let candidate = makeCandidate(state: .knowledgeReady)
        let card = makeCard(topic: "vine", candidateToken: candidate.id)
            .withPresentation(status: "candidate", scheduledDay: "")
        try await repository.upsert(candidate: candidate)
        try await repository.upsert(card: card, sanitizedJPEG: nil)

        let published = try await repository.publishCardImmediately(
            cardID: card.id,
            day: "2026-08-31",
            publishedAt: Date(timeIntervalSince1970: 1_700_000_100)
        )

        let state = await repository.snapshot()
        XCTAssertTrue(published)
        XCTAssertEqual(state.cards.first?.status, "scheduled")
        XCTAssertEqual(state.cards.first?.scheduledDay, "2026-08-31")
        XCTAssertEqual(state.candidates.first?.state, .selected)
        XCTAssertTrue(state.dailyPreparations.isEmpty, "旧版主动选图不应迁移成自动准备记录")
    }

    func testStartupRecoveryOnlyPublishesAnOrphanedImportedCard() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let repository = try LocalRepository(rootURL: root)
        var imported = makeCandidate(state: .knowledgeReady)
        imported = PhotoCandidateRecord(
            id: imported.id,
            localIdentifier: nil,
            capturedAt: imported.capturedAt,
            perceptualHash: imported.perceptualHash,
            qualityScore: imported.qualityScore,
            localLabels: imported.localLabels,
            sensitiveFlags: imported.sensitiveFlags,
            state: imported.state,
            updatedAt: imported.updatedAt
        )
        let automatic = makeCandidate(state: .knowledgeReady)
        let importedCard = makeCard(topic: "vine", candidateToken: imported.id)
            .withPresentation(status: "candidate", scheduledDay: "")
        let automaticCard = makeCard(topic: "broom", candidateToken: automatic.id)
            .withPresentation(status: "candidate", scheduledDay: "")
        for candidate in [imported, automatic] {
            try await repository.upsert(candidate: candidate)
        }
        try await repository.upsert(card: importedCard, sanitizedJPEG: nil)
        try await repository.upsert(card: automaticCard, sanitizedJPEG: nil)

        let recoveredID = try await repository.recoverLatestImportedCard(
            day: "2026-08-31",
            recoveredAt: Date(timeIntervalSince1970: 1_700_000_100)
        )

        let state = await repository.snapshot()
        XCTAssertEqual(recoveredID, importedCard.id)
        XCTAssertEqual(state.cards.first(where: { $0.id == importedCard.id })?.status, "scheduled")
        XCTAssertEqual(state.cards.first(where: { $0.id == automaticCard.id })?.status, "candidate")
        XCTAssertEqual(state.candidates.first(where: { $0.id == automatic.id })?.state, .knowledgeReady)
        XCTAssertTrue(state.dailyPreparations.isEmpty)
    }

    func testImportedPhotoProvenanceNeverClaimsTheSelectionDateWasTheCaptureDate() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let repository = try LocalRepository(rootURL: root)
        let base = makeCandidate(state: .selected)
        let imported = PhotoCandidateRecord(
            id: base.id,
            localIdentifier: nil,
            capturedAt: Date(timeIntervalSince1970: 1_788_192_000),
            perceptualHash: base.perceptualHash,
            qualityScore: base.qualityScore,
            localLabels: base.localLabels,
            sensitiveFlags: base.sensitiveFlags,
            state: base.state,
            updatedAt: base.updatedAt
        )
        let original = makeCard(topic: "sea_water", candidateToken: imported.id)
        let incorrect = KnowledgeCard(
            id: original.id,
            candidateToken: original.candidateToken,
            topicID: original.topicID,
            factID: original.factID,
            title: original.title,
            objectName: "海水",
            body: original.body,
            personalContext: "你在 2026 年 9 月 1 日拍下了「海水」，所以今天从它讲起。",
            confidence: original.confidence,
            boundingBox: original.boundingBox,
            sources: original.sources,
            status: original.status,
            scheduledDay: original.scheduledDay,
            createdAt: original.createdAt
        )
        try await repository.upsert(candidate: imported)
        try await repository.upsert(card: incorrect, sanitizedJPEG: nil)

        let repairedCount = try await repository.repairImportedPhotoProvenance()
        let repairedState = await repository.snapshot()
        let secondRepairCount = try await repository.repairImportedPhotoProvenance()
        XCTAssertEqual(repairedCount, 1)
        XCTAssertEqual(
            repairedState.cards.first?.personalContext,
            "它来自你保存的照片，所以今天从「海水」讲起。"
        )
        XCTAssertEqual(secondRepairCount, 0)
    }

    func testDailySelectionPoolUsesOldestReadyCardsWithoutDuplicatingNewCards() {
        let token = UUID()
        let old = makeCard(topic: "old")
            .withPresentation(status: "candidate", scheduledDay: "")
        let duplicate = KnowledgeCard(
            id: old.id,
            candidateToken: token,
            topicID: old.topicID,
            factID: old.factID,
            title: old.title,
            objectName: old.objectName,
            body: old.body,
            personalContext: old.personalContext,
            confidence: old.confidence,
            boundingBox: old.boundingBox,
            sources: old.sources,
            status: "candidate",
            scheduledDay: "",
            createdAt: old.createdAt.addingTimeInterval(10)
        )
        let later = (0..<3).map { index in
            KnowledgeCard(
                id: UUID(),
                candidateToken: UUID(),
                topicID: "later-\(index)",
                factID: "fact-later-\(index)",
                title: "标题",
                objectName: "物件",
                body: "正文",
                personalContext: "来自照片",
                confidence: 0.9,
                boundingBox: nil,
                sources: old.sources,
                status: "candidate",
                scheduledDay: "",
                createdAt: old.createdAt.addingTimeInterval(Double(index + 20))
            )
        }

        let pool = AutomaticDiscoveryRunner.selectionPool(
            newCards: [duplicate] + later,
            carryOverCards: [old]
        )

        XCTAssertEqual(pool.count, 3)
        XCTAssertEqual(pool.filter { $0.id == old.id }.count, 1)
        XCTAssertEqual(pool.first?.id, old.id)
    }

    func testDailySelectionPoolNeverBorrowsYesterdayRunnerUp() {
        let yesterdayRunnerUp = makeCard(topic: "yesterday")
            .withPresentation(status: "candidate", scheduledDay: "2026-08-31")
        let unassigned = makeCard(topic: "unassigned")
            .withPresentation(status: "candidate", scheduledDay: "")

        let pool = AutomaticDiscoveryRunner.selectionPool(
            newCards: [],
            carryOverCards: [yesterdayRunnerUp, unassigned]
        )

        XCTAssertEqual(pool.map(\.id), [unassigned.id])
        XCTAssertFalse(pool.contains(where: { $0.id == yesterdayRunnerUp.id }))
    }

    func testPhotoDiscoveryPrioritizesRecentAssetsThenFillsFromOlderPhotos() {
        let recent = [
            PhotoAssetReference(localIdentifier: "recent-1", capturedAt: nil, modifiedAt: nil, isScreenshot: false),
            PhotoAssetReference(localIdentifier: "recent-2", capturedAt: nil, modifiedAt: nil, isScreenshot: false)
        ]
        let fallback = [
            recent[0],
            PhotoAssetReference(localIdentifier: "older-1", capturedAt: nil, modifiedAt: nil, isScreenshot: false),
            PhotoAssetReference(localIdentifier: "older-2", capturedAt: nil, modifiedAt: nil, isScreenshot: false)
        ]

        XCTAssertEqual(
            PhotoDiscoveryService.prioritizedReferences(recent: recent, fallback: fallback, limit: 4)
                .map(\.localIdentifier),
            ["recent-1", "recent-2", "older-1", "older-2"]
        )
        XCTAssertTrue(
            PhotoDiscoveryService.prioritizedReferences(recent: recent, fallback: fallback, limit: 0).isEmpty
        )
    }

    func testDailyCarryOverExcludesInterruptedManualImport() {
        var manual = makeCandidate(state: .knowledgeReady)
        manual = PhotoCandidateRecord(
            id: manual.id,
            localIdentifier: nil,
            capturedAt: manual.capturedAt,
            perceptualHash: manual.perceptualHash,
            qualityScore: manual.qualityScore,
            localLabels: manual.localLabels,
            sensitiveFlags: manual.sensitiveFlags,
            state: manual.state,
            updatedAt: manual.updatedAt
        )
        let automatic = makeCandidate(state: .knowledgeReady)
        let manualCard = makeCard(topic: "manual", candidateToken: manual.id)
            .withPresentation(status: "candidate", scheduledDay: "")
        let automaticCard = makeCard(topic: "automatic", candidateToken: automatic.id)
            .withPresentation(status: "candidate", scheduledDay: "")

        let carryOver = AutomaticDiscoveryRunner.carryOverCards(
            cards: [manualCard, automaticCard],
            candidates: [manual, automatic]
        )

        XCTAssertEqual(carryOver.map(\.id), [automaticCard.id])
        XCTAssertFalse(carryOver.contains(where: { $0.id == manualCard.id }))
    }

    func testDailySelectionOnlyAssignsTheThreeCardsActuallySentToWinnerSelection() {
        let cards = (0..<4).map { index in
            KnowledgeCard(
                id: UUID(),
                candidateToken: UUID(),
                topicID: "topic-\(index)",
                factID: "fact-\(index)",
                title: "标题",
                objectName: "物件",
                body: "正文",
                personalContext: "来自照片",
                confidence: 0.9,
                boundingBox: nil,
                sources: makeCard(topic: "source").sources,
                status: "candidate",
                scheduledDay: "",
                createdAt: Date(timeIntervalSince1970: Double(index))
            )
        }
        let pool = AutomaticDiscoveryRunner.selectionPool(newCards: cards, carryOverCards: [])
        let assignedCandidateIDs = AutomaticDiscoveryRunner.selectionCandidateIDs(pool)

        XCTAssertEqual(pool.count, 3)
        XCTAssertEqual(assignedCandidateIDs, Set(cards.prefix(3).map(\.candidateToken)))
        XCTAssertFalse(assignedCandidateIDs.contains(cards[3].candidateToken))
    }

    func testDailySelectionFailureDoesNotConsumeTheDay() {
        let card = makeCard(topic: "ready")
            .withPresentation(status: "candidate", scheduledDay: "")

        XCTAssertFalse(AutomaticDiscoveryRunner.shouldFinalizeDailySelection(
            completedAnalyses: 3,
            maximumCandidates: 3,
            selectionPool: [card],
            selectedCardID: nil
        ))
        XCTAssertTrue(AutomaticDiscoveryRunner.shouldFinalizeDailySelection(
            completedAnalyses: 3,
            maximumCandidates: 3,
            selectionPool: [card],
            selectedCardID: card.id
        ))
        XCTAssertFalse(AutomaticDiscoveryRunner.shouldFinalizeDailySelection(
            completedAnalyses: 3,
            maximumCandidates: 3,
            selectionPool: [],
            selectedCardID: nil
        ))
    }

    func testPartialDailyRunPublishesItsBestAvailableCardWithoutFalseSuccess() {
        let card = makeCard(topic: "only-available-card")
            .withPresentation(status: "candidate", scheduledDay: "")

        XCTAssertTrue(AutomaticDiscoveryRunner.shouldFinalizeDailySelection(
            completedAnalyses: 1,
            maximumCandidates: 3,
            selectionPool: [card],
            selectedCardID: card.id
        ))
        XCTAssertFalse(AutomaticDiscoveryRunner.shouldFinalizeDailySelection(
            completedAnalyses: 1,
            maximumCandidates: 3,
            selectionPool: [],
            selectedCardID: nil
        ))
    }

    func testAutomaticDiscoveryLimitsOldFailedRetriesSoNewPhotosStillGetAChance() {
        XCTAssertEqual(AutomaticDiscoveryRunner.automaticRetryLimit(maximumCandidates: 0), 0)
        XCTAssertEqual(AutomaticDiscoveryRunner.automaticRetryLimit(maximumCandidates: 1), 1)
        XCTAssertEqual(AutomaticDiscoveryRunner.automaticRetryLimit(maximumCandidates: 3), 1)
        XCTAssertEqual(AutomaticDiscoveryRunner.automaticRetryLimit(maximumCandidates: 6), 2)
        XCTAssertEqual(AutomaticDiscoveryRunner.automaticFailureLimit, 1)
    }

    func testDailyCloudPhotoBudgetAccumulatesAcrossRetryableRuns() {
        XCTAssertEqual(AutomaticDiscoveryRunner.accumulatedMetric(previous: 3, current: 4), 7)
        XCTAssertEqual(AutomaticDiscoveryRunner.remainingCloudPhotoBudget(previous: 3), 6)
        XCTAssertEqual(AutomaticDiscoveryRunner.remainingCloudPhotoBudget(previous: 9), 0)
        XCTAssertEqual(AutomaticDiscoveryRunner.remainingCloudPhotoBudget(previous: 12), 0)
        XCTAssertEqual(AutomaticDiscoveryRunner.remainingCloudPhotoBudget(previous: -1), 9)
    }

    func testServerDeviceLimitRepairsAnInterruptedLocalDayWithoutConsumingThePhoto() {
        XCTAssertEqual(AutomaticDiscoveryRunner.reconciledCloudPhotoCount(
            previous: 4,
            current: 0,
            failure: .dailyAnalysisLimitReached
        ), 9)
        XCTAssertEqual(AutomaticDiscoveryRunner.reconciledCloudPhotoCount(
            previous: 4,
            current: 0,
            failure: .requestThrottled
        ), 4)
    }

    func testPreparationCheckpointPersistsEachConclusivePhotoWithoutDroppingExistingCards() {
        let existingCardID = UUID()
        let selectedCardID = UUID()
        let generatedCard = makeCard(topic: "new-qualified")
        let now = Date(timeIntervalSince1970: 1_788_192_123)
        let existing = DailyPreparationRecord(
            day: "2026-09-06",
            status: .preparing,
            inspectedPhotoCount: 2,
            aiPhotoCount: 1,
            qualifiedCardIDs: [existingCardID],
            selectedCardID: selectedCardID
        )

        let checkpoint = AutomaticDiscoveryRunner.preparationCheckpoint(
            day: existing.day,
            existingPreparation: existing,
            previousInspected: 2,
            inspected: 5,
            previousAIPhotoCount: 1,
            attemptedAnalyses: 2,
            generatedCards: [generatedCard],
            now: now
        )

        XCTAssertEqual(checkpoint.status, .preparing)
        XCTAssertEqual(checkpoint.inspectedPhotoCount, 7)
        XCTAssertEqual(checkpoint.aiPhotoCount, 3)
        XCTAssertEqual(checkpoint.qualifiedCardIDs, [existingCardID, generatedCard.id])
        XCTAssertEqual(checkpoint.selectedCardID, selectedCardID)
        XCTAssertEqual(checkpoint.lastAttemptAt, now)
    }

    func testNinePhotoDayFinalizesEvenWhenOnlyOneCardQualifies() {
        let card = makeCard(topic: "only-qualified")
            .withPresentation(status: "candidate", scheduledDay: "")

        XCTAssertTrue(AutomaticDiscoveryRunner.shouldFinalizeDailySelection(
            completedAnalyses: 9,
            maximumCandidates: 9,
            selectionPool: [card],
            selectedCardID: card.id
        ))
    }

    func testPreparationRecordKeepsRetryableFailureSeparateFromTerminalNoCard() {
        XCTAssertFalse(DailyPreparationStatus.retryableFailure.isFinal)
        XCTAssertFalse(DailyPreparationStatus.preparing.isFinal)
        XCTAssertFalse(DailyPreparationStatus.waitingForPhotos.isFinal)
        XCTAssertTrue(DailyPreparationStatus.noNewCard.isFinal)
        XCTAssertTrue(DailyPreparationStatus.ready.isFinal)
    }

    func testBackgroundPreparationTargetsFirstUnfinishedDay() {
        let now = Date(timeIntervalSince1970: 1_788_192_000)
        let today = ChinaDay.string(from: now)
        let tomorrow = ChinaDay.string(from: ChinaDay.adding(days: 1, to: now))
        var state = PersistedAppState.empty
        state.dailyPreparations[today] = DailyPreparationRecord(day: today, status: .ready)

        XCTAssertEqual(
            BackgroundDiscoveryController.nextPreparationDay(state: state, now: now),
            tomorrow
        )
    }

    func testRollingPreparationCannotSpendTomorrowAfterTodayHasNoNewCard() {
        let now = Date(timeIntervalSince1970: 1_788_192_000)
        let today = ChinaDay.string(from: now)
        var state = PersistedAppState.empty
        state.dailyPreparations[today] = DailyPreparationRecord(
            day: today, status: .noNewCard, inspectedPhotoCount: 18, aiPhotoCount: 9
        )

        // Reopening the app must not convert today's unsuccessful allowance
        // into permission to consume the next six dates.
        for _ in 0..<8 {
            XCTAssertEqual(BackgroundDiscoveryController.nextPreparationDay(state: state, now: now), today)
        }
        XCTAssertEqual(state.dailyPreparations[today]?.aiPhotoCount, 9)
        XCTAssertEqual(state.dailyPreparations.count, 1)
    }

    func testRollingPreparationStopsAtAnEmptyFutureDateInsteadOfSkippingIt() {
        let now = Date(timeIntervalSince1970: 1_788_192_000)
        var state = PersistedAppState.empty
        let days = (0..<7).map { ChinaDay.string(from: ChinaDay.adding(days: $0, to: now)) }
        for day in days.prefix(2) {
            state.dailyPreparations[day] = DailyPreparationRecord(day: day, status: .ready)
        }
        state.dailyPreparations[days[2]] = DailyPreparationRecord(
            day: days[2], status: .noNewCard, inspectedPhotoCount: 72, aiPhotoCount: 4
        )

        XCTAssertEqual(BackgroundDiscoveryController.nextPreparationDay(state: state, now: now), days[2])
        XCTAssertEqual(state.dailyPreparations[days[2]]?.aiPhotoCount, 4)
        XCTAssertNil(state.dailyPreparations[days[3]])
    }

    func testRollingPreparationResumesOnTheNextNaturalDayWithoutResettingYesterday() {
        let now = Date(timeIntervalSince1970: 1_788_192_000)
        let tomorrow = ChinaDay.adding(days: 1, to: now)
        let today = ChinaDay.string(from: now)
        var state = PersistedAppState.empty
        state.dailyPreparations[today] = DailyPreparationRecord(day: today, status: .noNewCard, aiPhotoCount: 9)

        XCTAssertEqual(
            BackgroundDiscoveryController.nextPreparationDay(state: state, now: tomorrow),
            ChinaDay.string(from: tomorrow)
        )
        XCTAssertEqual(state.dailyPreparations[today]?.status, .noNewCard)
        XCTAssertEqual(state.dailyPreparations[today]?.aiPhotoCount, 9)
    }

    func testRollingPreparationResumesTheSameUnfinishedDateAfterEarlierSuccess() {
        let now = Date(timeIntervalSince1970: 1_788_192_000)
        let today = ChinaDay.string(from: now)
        let tomorrow = ChinaDay.string(from: ChinaDay.adding(days: 1, to: now))
        for status: DailyPreparationStatus in [.queued, .preparing, .retryableFailure, .waitingForPhotos, .waitingForAccess] {
            var state = PersistedAppState.empty
            state.dailyPreparations[today] = DailyPreparationRecord(day: today, status: .ready)
            state.dailyPreparations[tomorrow] = DailyPreparationRecord(day: tomorrow, status: status, aiPhotoCount: 3)
            XCTAssertEqual(BackgroundDiscoveryController.nextPreparationDay(state: state, now: now), tomorrow)
            XCTAssertEqual(state.dailyPreparations[tomorrow]?.aiPhotoCount, 3)
        }
    }

    func testBackgroundDiscoveryStopsAfterPausePermissionOrModelAccessBlocker() {
        XCTAssertFalse(BackgroundDiscoveryController.shouldReschedule(
            automaticDiscoveryEnabled: false,
            accessError: nil
        ))
        XCTAssertFalse(BackgroundDiscoveryController.shouldReschedule(
            automaticDiscoveryEnabled: true,
            accessError: .permissionDenied
        ))
        XCTAssertFalse(BackgroundDiscoveryController.shouldReschedule(
            automaticDiscoveryEnabled: true,
            accessError: .apiKeyRequired
        ))
        XCTAssertTrue(BackgroundDiscoveryController.shouldReschedule(
            automaticDiscoveryEnabled: true,
            accessError: .requestFailed(503)
        ))
        XCTAssertTrue(BackgroundDiscoveryController.shouldReschedule(
            automaticDiscoveryEnabled: true,
            accessError: nil
        ))
    }

    func testCardDeepLinkWaitsUntilLaunchStateIsReady() throws {
        let cardID = UUID()
        let url = try XCTUnwrap(URL(string: "jianwei://card/\(cardID.uuidString)"))
        var buffer = CardDeepLinkLaunchBuffer()

        XCTAssertNil(buffer.receive(url: url, isReady: false))
        XCTAssertEqual(buffer.appBecameReady(), cardID)
        XCTAssertNil(buffer.appBecameReady(), "待处理跳转只能消费一次")
        XCTAssertEqual(buffer.receive(url: url, isReady: true), cardID)
    }

    func testRepositoryKeepsOneCardPerFactAndPrefersThePublishedCard() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let repository = try LocalRepository(rootURL: root)
        let published = makeCard(topic: "vine")
            .withPresentation(status: "scheduled", scheduledDay: "2026-08-31")
        let duplicate = KnowledgeCard(
            id: UUID(),
            candidateToken: UUID(),
            topicID: published.topicID,
            factID: published.factID,
            title: published.title,
            objectName: published.objectName,
            body: published.body,
            personalContext: published.personalContext,
            confidence: published.confidence,
            boundingBox: published.boundingBox,
            sources: published.sources,
            status: "candidate",
            scheduledDay: "",
            createdAt: published.createdAt.addingTimeInterval(60)
        )
        try await repository.upsert(card: published, sanitizedJPEG: nil)
        try await repository.upsert(card: duplicate, sanitizedJPEG: nil)

        let removed = try await repository.removeDuplicateCardsByFactID()
        let state = await repository.snapshot()

        XCTAssertEqual(removed, 1)
        XCTAssertEqual(state.cards.map(\.id), [published.id])
    }

    func testLegacyRandomFactIDsDoNotReintroduceTheSameKnowledge() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let repository = try LocalRepository(rootURL: root)
        let old = makeCard(topic: "clock").withPresentation(status: "shown", scheduledDay: "2026-08-31")
        func copy(_ body: String, day: String = "") -> KnowledgeCard {
            KnowledgeCard(id: UUID(), candidateToken: UUID(), topicID: old.topicID,
                factID: "dynamic-clock-" + UUID().uuidString, title: "另一个标题", objectName: old.objectName,
                body: body, personalContext: old.personalContext, confidence: old.confidence,
                boundingBox: nil, sources: old.sources, status: "candidate", scheduledDay: day,
                createdAt: old.createdAt.addingTimeInterval(60))
        }
        let repeatCard = copy("  " + old.body + " [ref_2]\n")
        let differentFact = copy("同一个物件的另一条合成知识，不应当因为属于同一主题而被删除。")
        let historicalAlternative = copy(old.body, day: "2026-09-01")
        let saved = copy(old.body)
        let legacyCandidate = PhotoCandidateRecord(id: repeatCard.candidateToken, localIdentifier: "synthetic-legacy",
            capturedAt: nil, perceptualHash: nil, qualityScore: 1, localLabels: [], sensitiveFlags: [],
            state: .knowledgeReady, updatedAt: Date())
        XCTAssertTrue(AutomaticDiscoveryRunner.carryOverCards(cards: [old, repeatCard], candidates: [legacyCandidate]).isEmpty,
            "A background run must reject legacy carryover repeats even before foreground cleanup runs")
        for card in [old, repeatCard, differentFact, historicalAlternative, saved] {
            try await repository.upsert(card: card, sanitizedJPEG: nil)
        }
        try await repository.setSaved(true, cardID: saved.id)
        let removed = try await repository.removeDuplicateCardsByFactID()
        let state = await repository.snapshot()
        XCTAssertEqual(removed, 1)
        XCTAssertEqual(Set(state.cards.map(\.id)), Set([old.id, differentFact.id, historicalAlternative.id, saved.id]))
        XCTAssertEqual(state.cards.first { $0.id == old.id }, old, "Never rewrite historical identifiers or content")
        XCTAssertEqual(state.savedCardIDs, [saved.id])
        let reloaded = try LocalRepository(rootURL: root)
        let reloadedState = await reloaded.snapshot()
        XCTAssertEqual(reloadedState.cards.count, 4)
    }

    func testDailyPoolDeduplicatesLegacyKnowledgeBeforeTakingThreeCards() {
        let original = makeCard(topic: "clock").withPresentation(status: "candidate", scheduledDay: "")
        let repeatCard = KnowledgeCard(id: UUID(), candidateToken: UUID(), topicID: original.topicID,
            factID: "legacy-random-id", title: "不同标题", objectName: original.objectName, body: original.body,
            personalContext: original.personalContext, confidence: 0.9, boundingBox: nil,
            sources: original.sources, status: "candidate", scheduledDay: "", createdAt: original.createdAt.addingTimeInterval(-1))
        let second = makeCard(topic: "pencil").withPresentation(status: "candidate", scheduledDay: "")
        let third = makeCard(topic: "scissors").withPresentation(status: "candidate", scheduledDay: "")
        let pool = AutomaticDiscoveryRunner.selectionPool(newCards: [original, repeatCard, second, third], carryOverCards: [])
        XCTAssertEqual(Set(pool.map(\.id)), Set([repeatCard.id, second.id, third.id]))
    }

    func testRepositoryRollsBackMemoryWhenStateWriteFails() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let repository = try LocalRepository(rootURL: root)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(
            at: root.appendingPathComponent("state.json", isDirectory: true),
            withIntermediateDirectories: true
        )

        var didThrow = false
        do {
            try await repository.setAutomaticDiscovery(true)
        } catch {
            didThrow = true
        }

        XCTAssertTrue(didThrow)
        let state = await repository.snapshot()
        XCTAssertFalse(state.automaticDiscoveryEnabled)
    }

    func testRepositoryRemovesNewCardImageWhenStateWriteFails() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let repository = try LocalRepository(rootURL: root)
        let card = makeCard(topic: "orphan-image")
        try FileManager.default.createDirectory(
            at: root.appendingPathComponent("state.json", isDirectory: true),
            withIntermediateDirectories: true
        )

        do {
            try await repository.upsert(card: card, sanitizedJPEG: Data([0xff, 0xd8, 0xff, 0xd9]))
            XCTFail("A failed state write must reject the card")
        } catch {
            // Expected: state.json is deliberately blocked by a directory.
        }

        let state = await repository.snapshot()
        XCTAssertFalse(state.cards.contains(where: { $0.id == card.id }))
        let image = await repository.imageData(candidateToken: card.candidateToken)
        XCTAssertNil(image, "A rejected card must not leave its uploaded thumbnail behind")
    }

    func testRepositoryAtomicallyRollsBackCandidateCardAndImageWhenStateWriteFails() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let repository = try LocalRepository(rootURL: root)
        let candidate = makeCandidate(state: .knowledgeReady)
        let card = makeCard(topic: "atomic-card", candidateToken: candidate.id)
        try FileManager.default.createDirectory(
            at: root.appendingPathComponent("state.json", isDirectory: true),
            withIntermediateDirectories: true
        )

        do {
            try await repository.upsert(
                candidate: candidate,
                card: card,
                sanitizedJPEG: Data([0xff, 0xd8, 0xff, 0xd9])
            )
            XCTFail("A failed state write must reject the complete analysis result")
        } catch {
            // Expected: state.json is deliberately blocked by a directory.
        }

        let state = await repository.snapshot()
        XCTAssertFalse(state.candidates.contains(where: { $0.id == candidate.id }))
        XCTAssertFalse(state.cards.contains(where: { $0.id == card.id }))
        let rolledBackImage = await repository.imageData(candidateToken: candidate.id)
        XCTAssertNil(rolledBackImage)
    }

    func testRepositoryStartupCleanupRemovesOnlyUnreferencedPrivateImages() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let repository = try LocalRepository(rootURL: root)
        let cardCandidate = makeCandidate(state: .knowledgeReady)
        let card = makeCard(topic: "retained-card", candidateToken: cardCandidate.id)
        let failedCandidate = makeCandidate(state: .failed)
        let exhaustedCandidate = makeCandidate(state: .exhausted)
        try await repository.upsert(candidate: cardCandidate)
        try await repository.upsert(card: card, sanitizedJPEG: Data([0x01]))
        try await repository.upsert(candidate: failedCandidate)
        try await repository.storeImage(Data([0x02]), candidateToken: failedCandidate.id)
        try await repository.upsert(candidate: exhaustedCandidate)
        try await repository.storeImage(Data([0x03]), candidateToken: exhaustedCandidate.id)

        let removed = try await repository.removeOrphanedImages()
        let retainedCardImage = await repository.imageData(candidateToken: cardCandidate.id)
        let retainedRetryImage = await repository.imageData(candidateToken: failedCandidate.id)
        let removedExhaustedImage = await repository.imageData(candidateToken: exhaustedCandidate.id)

        XCTAssertEqual(removed, 1)
        XCTAssertNotNil(retainedCardImage)
        XCTAssertNotNil(retainedRetryImage)
        XCTAssertNil(removedExhaustedImage)
    }

    func testCatalogRevisionReconsidersOnlyPreviouslyExhaustedPhotos() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let repository = try LocalRepository(rootURL: root)
        let exhausted = makeCandidate(state: .exhausted)
        let selected = makeCandidate(state: .selected)
        try await repository.upsert(candidate: exhausted)
        try await repository.upsert(candidate: selected)

        let reconsidered = try await repository.adoptKnowledgeCatalogRevision("catalog-v1")
        XCTAssertEqual(reconsidered, 1)
        var state = await repository.snapshot()
        XCTAssertFalse(state.processedLocalIdentifiers.contains(try XCTUnwrap(exhausted.localIdentifier)))
        XCTAssertTrue(state.processedLocalIdentifiers.contains(try XCTUnwrap(selected.localIdentifier)))
        XCTAssertFalse(state.candidates.contains(where: { $0.id == exhausted.id }))
        XCTAssertTrue(state.candidates.contains(where: { $0.id == selected.id }))
        XCTAssertEqual(state.knowledgeCatalogRevision, "catalog-v1")

        let unchanged = try await repository.adoptKnowledgeCatalogRevision("catalog-v1")
        XCTAssertEqual(unchanged, 0)
        state = await repository.snapshot()
        XCTAssertEqual(state.knowledgeCatalogRevision, "catalog-v1")
    }

    func testTopicAffinitiesUseLocalFeedbackAsBoundedRankingTieBreaker() {
        let liked = makeCard(topic: "broom")
        let disliked = makeCard(topic: "toothbrush")
        let privateCard = makeCard(topic: "toothbrush")
        var state = PersistedAppState.empty
        state.cards = [liked, disliked, privateCard]
        state.feedbackByCardID = [
            liked.id: .like,
            disliked.id: .dislike,
            privateCard.id: .tooPrivate
        ]

        let affinities = AnalysisPipeline.topicAffinities(from: state)

        XCTAssertEqual(affinities["broom"], 4)
        XCTAssertEqual(affinities["toothbrush"], -12)
    }

    func testRepositoryRecoversLastGoodStateWhenPrimaryFileIsCorrupt() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let repository = try LocalRepository(rootURL: root)
        try await repository.setOnboardingCompleted(true)
        try Data("not-json".utf8).write(
            to: root.appendingPathComponent("state.json"),
            options: .atomic
        )

        let recovered = try LocalRepository(rootURL: root)
        let state = await recovered.snapshot()

        XCTAssertTrue(state.onboardingCompleted)
        XCTAssertTrue(FileManager.default.fileExists(
            atPath: root.appendingPathComponent("state.backup.json").path
        ))
    }

    func testCorruptPrimaryAndBackupCanBeQuarantinedWithoutDeletingThem() async throws {
        let parent = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        let root = parent.appendingPathComponent("Jianwei", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: parent) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try Data("bad-primary".utf8).write(to: root.appendingPathComponent("state.json"))
        try Data("bad-backup".utf8).write(to: root.appendingPathComponent("state.backup.json"))
        XCTAssertThrowsError(try LocalRepository(rootURL: root))

        let quarantine = try XCTUnwrap(LocalRepository.quarantineStore(at: root))
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.path))
        XCTAssertEqual(
            try Data(contentsOf: quarantine.appendingPathComponent("state.json")),
            Data("bad-primary".utf8)
        )
        XCTAssertEqual(
            try Data(contentsOf: quarantine.appendingPathComponent("state.backup.json")),
            Data("bad-backup".utf8)
        )
        let fresh = try LocalRepository(rootURL: root)
        let freshState = await fresh.snapshot()
        XCTAssertEqual(freshState.cards, [])
    }

    func testHidingPrivateCardRemovesThumbnailAndPersistsNeverAnalyze() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let repository = try LocalRepository(rootURL: root)
        let candidate = makeCandidate(state: .knowledgeReady)
        let card = makeCard(topic: "private", candidateToken: candidate.id)
        try await repository.upsert(candidate: candidate)
        try await repository.upsert(card: card, sanitizedJPEG: Data([0x01, 0x02]))

        try await repository.hideCard(card.id, candidateToken: candidate.id, neverAnalyze: true)

        let state = await repository.snapshot()
        XCTAssertFalse(state.cards.contains(where: { $0.id == card.id }))
        XCTAssertTrue(state.hiddenCardIDs.contains(card.id))
        XCTAssertEqual(state.candidates.first(where: { $0.id == candidate.id })?.state, .neverAnalyze)
        let image = await repository.imageData(candidateToken: candidate.id)
        XCTAssertNil(image)
    }

    func testCandidateWorkingSetTrimNeverMakesAnOldPhotoEligibleAgain() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let repository = try LocalRepository(rootURL: root)
        var oldestID: UUID?
        for index in 0...500 {
            let id = UUID()
            if index == 0 {
                oldestID = id
                try await repository.storeImage(Data([0xff, 0xd8, 0xff, 0xd9]), candidateToken: id)
            }
            try await repository.upsert(candidate: PhotoCandidateRecord(
                id: id,
                localIdentifier: "asset-\(index)",
                capturedAt: nil,
                perceptualHash: UInt64(index),
                qualityScore: 0.8,
                localLabels: [],
                sensitiveFlags: [],
                state: .exhausted,
                updatedAt: Date(timeIntervalSince1970: TimeInterval(index))
            ))
        }

        let state = await repository.snapshot()
        XCTAssertEqual(state.candidates.count, 500)
        XCTAssertFalse(state.candidates.contains(where: { $0.localIdentifier == "asset-0" }))
        XCTAssertEqual(state.processedLocalIdentifiers.count, 501)
        XCTAssertTrue(state.processedLocalIdentifiers.contains("asset-0"))
        let orphan = await repository.imageData(candidateToken: try XCTUnwrap(oldestID))
        XCTAssertNil(orphan, "trimmed retry data must not leave private image bytes behind")
    }

    func testRepositoryNeverDeduplicatesCardsAlreadyAssignedToHistoryOrDailyPool() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let repository = try LocalRepository(rootURL: root)
        let published = makeCard(topic: "same-fact")
            .withPresentation(status: "scheduled", scheduledDay: "2026-08-30")
        let runnerUp = KnowledgeCard(
            id: UUID(),
            candidateToken: UUID(),
            topicID: published.topicID,
            factID: published.factID,
            title: "另一张照片里的同一知识",
            objectName: published.objectName,
            body: published.body,
            personalContext: published.personalContext,
            confidence: published.confidence,
            boundingBox: published.boundingBox,
            sources: published.sources,
            status: "candidate",
            scheduledDay: "2026-08-31",
            createdAt: published.createdAt.addingTimeInterval(60)
        )
        try await repository.upsert(card: published, sanitizedJPEG: nil)
        try await repository.upsert(card: runnerUp, sanitizedJPEG: nil)

        let removed = try await repository.removeDuplicateCardsByFactID()
        let state = await repository.snapshot()

        XCTAssertEqual(removed, 0)
        XCTAssertEqual(Set(state.cards.map(\.id)), Set([published.id, runnerUp.id]))
    }

    override func tearDown() {
        DirectQwenURLProtocol.handler = nil
        DeferredCardSyncURLProtocol.handler = nil
        super.tearDown()
    }

    func testAuthorizedBroomFixtureIsSanitizedForAnalysisUpload() throws {
        let fixtureURL = try XCTUnwrap(
            Bundle(for: Self.self).url(
                forResource: "onboarding_broom_example",
                withExtension: "webp"
            )
        )
        let sanitized = try ImageSanitizer().sanitize(Data(contentsOf: fixtureURL))
        XCTAssertFalse(sanitized.jpeg.isEmpty)
        XCTAssertLessThanOrEqual(max(sanitized.pixelSize.width, sanitized.pixelSize.height), 1_280)
        XCTAssertNoThrow(try JPEGMetadataStripper.requireNoMetadata(sanitized.jpeg))
    }

    func testPersistedStateDecodesOlderPartialPayloadWithSafeDefaults() throws {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        let state = try decoder.decode(PersistedAppState.self, from: Data("{}".utf8))

        XCTAssertEqual(state.schemaVersion, 6)
        XCTAssertEqual(state.cards.count, 0)
        XCTAssertEqual(state.processedLocalIdentifiers, [])
        XCTAssertEqual(state.exhaustedLocalIdentifiers, [])
        XCTAssertNil(state.knowledgeCatalogRevision)
        XCTAssertEqual(state.interests, PersistedAppState.empty.interests)
        XCTAssertEqual(state.preparationMode, .dailySingle)
        XCTAssertFalse(state.onboardingCompleted)
        XCTAssertFalse(state.automaticDiscoveryEnabled)
        XCTAssertTrue(state.dailyPreparations.isEmpty)
    }

    func testSchemaFiveDailySelectionMigratesWithoutLosingCards() throws {
        let card = makeCard(topic: "legacy")
            .withPresentation(status: "scheduled", scheduledDay: "2026-09-03")
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let cardJSON = try JSONSerialization.jsonObject(with: encoder.encode(card))
        let payload: [String: Any] = [
            "schemaVersion": 5,
            "cards": [cardJSON],
            "lastDailySelectionDay": "2026-09-03"
        ]
        let data = try JSONSerialization.data(withJSONObject: payload)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        let state = try decoder.decode(PersistedAppState.self, from: data)

        XCTAssertEqual(state.schemaVersion, 6)
        XCTAssertEqual(state.cards.map(\.id), [card.id])
        XCTAssertEqual(state.dailyPreparations["2026-09-03"]?.status, .ready)
        XCTAssertEqual(state.dailyPreparations["2026-09-03"]?.selectedCardID, card.id)
    }

    func testQwenAPIKeyIsStoredOutsidePersistedStateAndCanBeRemoved() async throws {
        let secrets = TestSecretStore()
        let store = AIModelAccessStore(keychain: secrets)
        let key = "sk-test_12345678901234567890"

        let initiallyStored = try await store.hasQwenAPIKey()
        XCTAssertFalse(initiallyStored)
        try await store.saveQwenAPIKey(key)
        let stored = try await store.hasQwenAPIKey()
        XCTAssertTrue(stored)
        let request = try await store.request(for: .qwenUserKey)
        XCTAssertEqual(request.mode, .qwenUserKey)
        XCTAssertEqual(request.apiKey, key)

        try await store.removeQwenAPIKey()
        let storedAfterRemoval = try await store.hasQwenAPIKey()
        XCTAssertFalse(storedAfterRemoval)
    }

    func testBundledCatalogBuildsCardOnlyFromQualityApprovedCopy() throws {
        let url = try XCTUnwrap(Bundle.main.url(forResource: "catalog", withExtension: "json"))
        let catalog = try BundledKnowledgeCatalog(data: Data(contentsOf: url))
        let candidate = UUID()
        let card = try XCTUnwrap(catalog.makeCard(
            entity: DirectDetectedEntity(
                canonicalTopicID: "computer_mouse",
                displayName: "鼠标",
                confidence: 0.94,
                boundingBox: nil,
                alternatives: [],
                sensitiveFlags: []
            ),
            candidateToken: candidate,
            capturedAt: Date(timeIntervalSince1970: 1_700_000_000),
            recentFactIDs: [],
            now: Date(timeIntervalSince1970: 1_700_000_000)
        ))

        XCTAssertEqual(card.candidateToken, candidate)
        XCTAssertEqual(card.topicID, "computer_mouse")
        XCTAssertEqual(card.objectName, "鼠标")
        XCTAssertEqual(card.factID, "computer-mouse-6000-snapshots")
        XCTAssertTrue((28...80).contains(card.body.count))
        XCTAssertFalse(card.sources.isEmpty)
        XCTAssertTrue(card.sources.allSatisfy { $0.url.scheme == "https" })
    }

    func testBundledCatalogOffersOnlyQualityApprovedFactsForPerPhotoDiscovery() throws {
        let url = try XCTUnwrap(Bundle.main.url(forResource: "catalog", withExtension: "json"))
        let catalog = try BundledKnowledgeCatalog(data: Data(contentsOf: url))
        let options = catalog.factOptions(
            entity: DirectDetectedEntity(
                canonicalTopicID: "computer_mouse",
                displayName: "鼠标",
                confidence: 0.94,
                boundingBox: nil,
                alternatives: [],
                sensitiveFlags: []
            ),
            recentFactIDs: []
        )

        XCTAssertEqual(options.count, 1)
        XCTAssertEqual(options.first?.factID, "computer-mouse-6000-snapshots")
        XCTAssertEqual(options.filter { $0.reviewedTitle != nil }.count, 1)
        XCTAssertTrue(options.allSatisfy { !$0.sources.isEmpty })
    }

    func testExhaustedCatalogDoesNotOfferOrRepublishAnAlreadyUsedFact() throws {
        let catalog = try BundledKnowledgeCatalog.load()
        let entity = DirectDetectedEntity(canonicalTopicID: "computer_mouse", displayName: "鼠标", confidence: 0.95,
            boundingBox: nil, alternatives: [], sensitiveFlags: [])
        let available = catalog.factOptions(entity: entity, recentFactIDs: [])
        let option = try XCTUnwrap(available.first)
        let usedIDs = available.map(\.factID)
        XCTAssertFalse(usedIDs.isEmpty)
        XCTAssertTrue(catalog.factOptions(entity: entity, recentFactIDs: usedIDs).isEmpty,
                      "An exhausted cache must allow a different knowledge angle, not recycle the same fact")
        XCTAssertNil(catalog.makeCard(entity: entity, candidateToken: UUID(), capturedAt: nil,
            recentFactIDs: usedIDs))
        XCTAssertNil(catalog.makeCard(entity: entity, candidateToken: UUID(), capturedAt: nil,
            recentFactIDs: usedIDs, editorial: KnowledgeEditorialDraft(factID: option.factID,
                title: try XCTUnwrap(option.reviewedTitle), body: try XCTUnwrap(option.reviewedBody))),
            "A previously edited copy cannot bypass fact-level novelty")
        XCTAssertEqual(catalog.factOptions(entity: entity, recentFactIDs: ["unrelated-used-fact"]).map(\.factID), usedIDs,
                       "Unseen reviewed facts still use the low-cost catalog path")
    }

    func testBicycleBellFactKeepsRelevantSourceButDoesNotPublishWeakCopy() throws {
        let url = try XCTUnwrap(Bundle.main.url(forResource: "catalog", withExtension: "json"))
        let data = try Data(contentsOf: url)
        let catalog = try BundledKnowledgeCatalog(data: data)
        let options = catalog.factOptions(
            entity: DirectDetectedEntity(
                canonicalTopicID: "bicycle_bell",
                displayName: "自行车铃",
                confidence: 0.95,
                boundingBox: nil,
                alternatives: [],
                sensitiveFlags: []
            ),
            recentFactIDs: []
        )
        XCTAssertNil(options.first(where: { $0.factID == "bicycle-bell-rain-damping" }))
        XCTAssertNil(options.first(where: { $0.factID == "bicycle-bell-001" }))
        XCTAssertNil(options.first(where: { $0.factID == "bicycle-bell-draft-003" }))
        XCTAssertTrue(options.allSatisfy { !$0.sources.isEmpty })

        let root = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        let topics = try XCTUnwrap(root["topics"] as? [[String: Any]])
        let bellTopic = try XCTUnwrap(topics.first { $0["topicId"] as? String == "bicycle_bell" })
        let facts = try XCTUnwrap(bellTopic["facts"] as? [[String: Any]])
        let rainFact = try XCTUnwrap(facts.first { $0["factId"] as? String == "bicycle-bell-rain-damping" })
        XCTAssertEqual(rainFact["cardQualityStatus"] as? String, "candidate")
        XCTAssertEqual(rainFact["sourceIds"] as? [String], ["src-inverted-dome-bell"])

        let sources = try XCTUnwrap(root["sources"] as? [[String: Any]])
        let source = try XCTUnwrap(sources.first { $0["sourceId"] as? String == "src-inverted-dome-bell" })
        XCTAssertTrue(try XCTUnwrap(source["url"] as? String).contains("US6450115B1"))
        XCTAssertTrue(try XCTUnwrap(source["title"] as? String).localizedCaseInsensitiveContains("bell"))
    }

    func testCatalogCanonicalizesConflictingRoutingIDWithoutChangingVisualEvidence() throws {
        let catalog = try BundledKnowledgeCatalog.load()
        let box = ObjectBoundingBox(x: 0.1, y: 0.2, width: 0.6, height: 0.3)
        // Real evaluation failure: the Chinese name was correct but the model
        // attached the unrelated shoelace routing ID. An alternative must not
        // override the unambiguous primary object name either.
        let original = DirectDetectedEntity(canonicalTopicID: "shoelace", displayName: "拉链", confidence: 0.67,
            boundingBox: box, alternatives: ["鞋带"], sensitiveFlags: [])
        let normalized = catalog.canonicalize(original)
        XCTAssertEqual(normalized.canonicalTopicID, "zipper")
        XCTAssertEqual(normalized.displayName, original.displayName)
        XCTAssertEqual(normalized.confidence, original.confidence)
        XCTAssertEqual(normalized.boundingBox, original.boundingBox)
        XCTAssertEqual(normalized.alternatives, original.alternatives)
        XCTAssertEqual(catalog.canonicalize(normalized).canonicalTopicID, "zipper")
        let card = ModelKnowledgeDraft(entity: normalized, title: "分类一致性测试卡片",
            body: "这是验证分类和物件名称保持一致的合成卡片，不代表真实知识质量。")
            .makeCard(candidateToken: UUID(), capturedAt: nil)
        XCTAssertEqual(card.topicID, "zipper")
        XCTAssertEqual(card.objectName, "拉链")
        XCTAssertEqual(card.evidenceKind, .modelKnowledge)
    }

    func testCatalogDoesNotRetrieveUnrelatedApprovedFactsForAConflictingID() throws {
        let catalog = try BundledKnowledgeCatalog.load()
        let entity = DirectDetectedEntity(canonicalTopicID: "computer_mouse", displayName: "拉链", confidence: 0.98,
            boundingBox: nil, alternatives: [], sensitiveFlags: [])
        XCTAssertEqual(catalog.canonicalize(entity).canonicalTopicID, "zipper")
        // A known topic with no approved facts must fall through to generation,
        // not silently receive the approved mouse card through the wrong ID.
        XCTAssertTrue(catalog.factOptions(entity: entity, recentFactIDs: []).isEmpty)
        XCTAssertNil(catalog.makeCard(entity: entity, candidateToken: UUID(), capturedAt: nil, recentFactIDs: []))
        let alias = DirectDetectedEntity(canonicalTopicID: "wrong_id", displayName: "鼠标", confidence: 0.9,
            boundingBox: nil, alternatives: [], sensitiveFlags: [])
        XCTAssertEqual(catalog.canonicalize(alias).canonicalTopicID, "computer_mouse")
        XCTAssertEqual(catalog.factOptions(entity: alias, recentFactIDs: []).first?.topicID, "computer_mouse")
    }

    func testCatalogNormalizationDoesNotBecomeAnObjectWhitelistOrErasePrivacyFlags() throws {
        let catalog = try BundledKnowledgeCatalog.load()
        let unknown = DirectDetectedEntity(canonicalTopicID: "synthetic_unknown_object", displayName: "测试用的目录外组合装置",
            confidence: 0.93, boundingBox: nil, alternatives: [], sensitiveFlags: [])
        XCTAssertEqual(catalog.canonicalize(unknown).canonicalTopicID, unknown.canonicalTopicID)
        XCTAssertEqual(catalog.canonicalize(unknown).displayName, unknown.displayName)
        XCTAssertTrue(catalog.factOptions(entity: unknown, recentFactIDs: []).isEmpty)
        let privateEntity = DirectDetectedEntity(canonicalTopicID: "shoelace", displayName: "拉链", confidence: 0.5,
            boundingBox: nil, alternatives: [], sensitiveFlags: ["face"])
        let normalized = catalog.canonicalize(privateEntity)
        XCTAssertEqual(normalized.sensitiveFlags, ["face"])
        XCTAssertEqual(normalized.confidence, 0.5)
        XCTAssertTrue(catalog.factOptions(entity: normalized, recentFactIDs: []).isEmpty)
    }

    func testAmbiguousAlternativeNamesCannotSelectTheFirstCatalogTopic() throws {
        let catalog = try BundledKnowledgeCatalog.load()
        let ambiguous = DirectDetectedEntity(canonicalTopicID: "synthetic_unknown_object", displayName: "未确定的工具",
            confidence: 0.61, boundingBox: nil, alternatives: ["鼠标", "扫帚"], sensitiveFlags: [])
        XCTAssertTrue(catalog.factOptions(entity: ambiguous, recentFactIDs: []).isEmpty)
        XCTAssertEqual(catalog.canonicalize(ambiguous).canonicalTopicID, ambiguous.canonicalTopicID)
    }

    func testDirectQwenUsesAuthorizationHeaderAndStrictEntityJSON() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DirectQwenURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let key = "sk-test_12345678901234567890"
        DirectQwenURLProtocol.handler = { request in
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer \(key)")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
            XCTAssertNil(request.value(forHTTPHeaderField: "X-DashScope-DataInspection"))
            XCTAssertEqual(request.url?.host, "dashscope.aliyuncs.com")
            let content = """
            {"subjects":[{"canonicalTopicId":"broom","displayName":"扫帚","confidence":0.94,"boundingBox":null,"alternatives":["清洁扫帚"]},{"canonicalTopicId":"dustpan","displayName":"簸箕","confidence":0.88,"boundingBox":null,"alternatives":["畚箕"]}],"sensitiveFlags":[]}
            """
            let envelope = try JSONSerialization.data(withJSONObject: [
                "choices": [["finish_reason": "stop", "message": ["content": content]]]
            ])
            return (
                HTTPURLResponse(
                    url: try XCTUnwrap(request.url),
                    statusCode: 200,
                    httpVersion: "HTTP/1.1",
                    headerFields: ["Content-Type": "application/json"]
                )!,
                envelope
            )
        }
        let service = try DirectQwenService(session: session)
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: 32, height: 32))
        let jpeg = renderer.jpegData(withCompressionQuality: 0.8) { context in
            UIColor.systemBrown.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 32, height: 32))
        }

        let understanding = try await service.detect(
            jpeg: jpeg,
            localLabels: ["清洁用品"],
            preferredTopics: ["broom=扫帚"],
            apiKey: key
        )

        XCTAssertEqual(understanding.subjects.count, 2)
        let entity = try XCTUnwrap(understanding.subjects.first)
        XCTAssertEqual(entity.canonicalTopicID, "broom")
        XCTAssertEqual(entity.displayName, "扫帚")
        XCTAssertEqual(entity.confidence, 0.94, accuracy: 0.000_1)
        XCTAssertTrue(understanding.sensitiveFlags.isEmpty)
    }

    func testRepeatedVisibleObjectsDoNotTurnSuccessfulDetectionIntoServiceFailure() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DirectQwenURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel(); DirectQwenURLProtocol.handler = nil }
        let service = try DirectQwenService(session: session)
        // Real public-photo failure: a case contains two camera lenses. The
        // second has a different box, but both are the same knowledge entrance.
        let first: [String: Any] = ["canonicalTopicId": "camera_lens", "displayName": "相机镜头",
            "confidence": 0.92, "boundingBox": ["x": 0.25, "y": 0.48, "width": 0.7, "height": 0.15],
            "alternatives": ["摄影镜头"]]
        var second = first
        second["confidence"] = 0.98
        second["boundingBox"] = ["x": 0.23, "y": 0.66, "width": 0.75, "height": 0.18]
        let distinct: [String: Any] = ["canonicalTopicId": "case", "displayName": "收纳盒",
            "confidence": 0.9, "boundingBox": NSNull(), "alternatives": []]
        for malformed in [false, true] {
            var repeated = second
            if malformed { repeated["confidence"] = 1.5 }
            let raw = try JSONSerialization.data(withJSONObject: ["subjects": [first, repeated, distinct], "sensitiveFlags": []])
            let content = String(decoding: raw, as: UTF8.self)
            DirectQwenURLProtocol.handler = { request in
                let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
                return (response, try JSONSerialization.data(withJSONObject: ["choices": [["finish_reason": "stop", "message": ["content": content]]]]))
            }
            do {
                let result = try await service.detect(jpeg: makeTestJPEG(), localLabels: [], preferredTopics: [],
                    apiKey: "sk-test_12345678901234567890")
                XCTAssertFalse(malformed, "Malformed duplicates must not be silently removed")
                XCTAssertEqual(result.subjects.map(\.displayName), ["相机镜头", "收纳盒"])
                XCTAssertEqual(result.subjects.first?.confidence, 0.98)
                XCTAssertEqual(result.subjects.first?.boundingBox?.y, 0.66)
            } catch {
                XCTAssertTrue(malformed)
                XCTAssertEqual(error as? ProductError, .invalidServerResponse)
            }
        }
    }

    func testDirectQwenSelectsOnlyAnAllowedDailyCard() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DirectQwenURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let key = "sk-test_12345678901234567890"
        let cards = [makeCard(topic: "broom"), makeCard(topic: "toothbrush")]
        let expected = cards[1].id
        DirectQwenURLProtocol.handler = { request in
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer \(key)")
            XCTAssertNil(request.value(forHTTPHeaderField: "X-DashScope-DataInspection"))
            XCTAssertEqual(request.url?.path, "/compatible-mode/v1/chat/completions")
            let content = "{\"cardId\":\"\(expected.uuidString.lowercased())\",\"reason\":\"更具体，也更贴近日常使用\"}"
            let envelope = try JSONSerialization.data(withJSONObject: [
                "choices": [["finish_reason": "stop", "message": ["content": content]]]
            ])
            return (
                HTTPURLResponse(
                    url: try XCTUnwrap(request.url),
                    statusCode: 200,
                    httpVersion: "HTTP/1.1",
                    headerFields: ["Content-Type": "application/json"]
                )!,
                envelope
            )
        }
        let service = try DirectQwenService(session: session)

        let selected = try await service.selectDailyCard(from: cards, apiKey: key)

        XCTAssertEqual(selected, expected)
    }

    func testManagedQwenGatewayUsesDeviceBearerAndGatewayPath() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DirectQwenURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let token = String(repeating: "a", count: 43)
        let cards = [makeCard(topic: "broom"), makeCard(topic: "toothbrush")]
        let expected = cards[0].id
        DirectQwenURLProtocol.handler = { request in
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer \(token)")
            XCTAssertEqual(request.url?.host, "jianwei-api.example.com")
            XCTAssertEqual(request.url?.path, "/v1/qwen/chat/completions")
            let content = "{\"cardId\":\"\(expected.uuidString.lowercased())\",\"reason\":\"更具体\"}"
            let envelope = try JSONSerialization.data(withJSONObject: [
                "choices": [["finish_reason": "stop", "message": ["content": content]]]
            ])
            return (
                HTTPURLResponse(
                    url: try XCTUnwrap(request.url),
                    statusCode: 200,
                    httpVersion: "HTTP/1.1",
                    headerFields: ["Content-Type": "application/json"]
                )!,
                envelope
            )
        }
        let service = try DirectQwenService(
            baseURL: URL(string: "https://jianwei-api.example.com/v1/qwen")!,
            authorizationPolicy: .deviceBearer,
            session: session
        )

        let selected = try await service.selectDailyCard(from: cards, apiKey: token)

        XCTAssertEqual(selected, expected)
    }

    func testManagedQwenGatewayMapsUnauthorizedToExpiredDeviceCredential() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DirectQwenURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let token = String(repeating: "b", count: 43)
        let cards = [makeCard(topic: "broom"), makeCard(topic: "toothbrush")]
        DirectQwenURLProtocol.handler = { request in
            (
                HTTPURLResponse(
                    url: try XCTUnwrap(request.url),
                    statusCode: 401,
                    httpVersion: "HTTP/1.1",
                    headerFields: ["Content-Type": "application/json"]
                )!,
                Data("{\"error\":{\"code\":\"invalid_device_token\"}}".utf8)
            )
        }
        let service = try DirectQwenService(
            baseURL: URL(string: "https://jianwei-api.example.com/v1/qwen")!,
            authorizationPolicy: .deviceBearer,
            session: session
        )

        do {
            _ = try await service.selectDailyCard(from: cards, apiKey: token)
            XCTFail("无效设备令牌必须触发重新注册")
        } catch let error as ProductError {
            XCTAssertEqual(error, .serverCredentialExpired)
        }
    }

    func testDirectQwenSelectsTheOnlyPreapprovedDailyCardWithoutAnotherModelVeto() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DirectQwenURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let key = "sk-test_12345678901234567890"
        let card = makeCard(topic: "headphones")
        DirectQwenURLProtocol.handler = { _ in XCTFail("单张已审核卡不应再次请求模型"); throw ProductError.invalidServerResponse }
        let service = try DirectQwenService(session: session)

        let selected = try await service.selectDailyCard(from: [card], apiKey: key)

        XCTAssertEqual(selected, card.id)
    }

    func testDirectQwenRejectsLegacyDailyVetoShape() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DirectQwenURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let key = "sk-test_12345678901234567890"
        let cards = [makeCard(topic: "headphones"), makeCard(topic: "broom")]
        DirectQwenURLProtocol.handler = { request in
            let content = "{\"decision\":\"skip\",\"cardId\":null,\"surprise\":2,\"aha\":3,\"retellability\":3,\"naturalness\":4,\"hardIssue\":false,\"reason\":\"旧版重复质量闸门\"}"
            let envelope = try JSONSerialization.data(withJSONObject: [
                "choices": [["finish_reason": "stop", "message": ["content": content]]]
            ])
            return (
                HTTPURLResponse(
                    url: try XCTUnwrap(request.url),
                    statusCode: 200,
                    httpVersion: "HTTP/1.1",
                    headerFields: ["Content-Type": "application/json"]
                )!,
                envelope
            )
        }
        let service = try DirectQwenService(session: session)

        do {
            _ = try await service.selectDailyCard(from: cards, apiKey: key)
            XCTFail("旧版 veto 结构不应被接受")
        } catch let error as ProductError {
            XCTAssertEqual(error, .invalidServerResponse)
        }
    }

    func testDirectQwenEditsFromEveryReviewedFactAndReturnsGroundedCopy() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DirectQwenURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let key = "sk-test_12345678901234567890"
        let jpeg = makeTestJPEG()
        let options = [
            KnowledgeFactOption(
                factID: "broom-angled",
                topicID: "broom",
                objectName: "扫帚",
                factText: "斜切扫帚的毛端会形成与手柄斜交的平面，使用时整条扫面更容易均匀贴地，也能让刷毛磨损得更均匀。",
                sources: []
            ),
            KnowledgeFactOption(
                factID: "broom-soft-hard",
                topicID: "broom",
                objectName: "扫帚",
                factText: "扫帚的大部分柔软刷毛负责普通地面，末端少量硬刷毛用来处理墙角、边缘和较顽固的污物。",
                sources: []
            )
        ]
        DirectQwenURLProtocol.handler = { request in
            let body = try requestBodyData(request)
            let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
            let serialized = String(decoding: body, as: UTF8.self)
            let messages = try XCTUnwrap(payload["messages"] as? [[String: Any]])
            let content = try XCTUnwrap(messages.first?["content"] as? [[String: Any]])
            let imagePart = try XCTUnwrap(content.first(where: { $0["type"] as? String == "image_url" }))
            let imageURL = try XCTUnwrap(imagePart["image_url"] as? [String: String])
            XCTAssertTrue(try XCTUnwrap(imageURL["url"]).hasPrefix("data:image/jpeg;base64,"))
            let responseContent: String
            if serialized.contains("第二位独立视觉核验员，只判断指定部件或纹理") {
                XCTAssertEqual(try XCTUnwrap(payload["temperature"] as? Double), 0, accuracy: 0.001)
                XCTAssertEqual(payload["model"] as? String, DirectQwenService.verificationModel)
                XCTAssertNil(request.value(forHTTPHeaderField: "X-DashScope-DataInspection"))
                XCTAssertTrue(serialized.contains("软刷毛负责地面硬刷毛处理墙角"))
                responseContent = """
                {"decision":"accept","imageObject":"扫帚刷毛","requiredVisualEvidenceVisible":true,"visibleEvidence":"刷头上可直接分辨软硬两组刷毛","reason":"指定刷毛分组清楚可见"}
                """
            } else if serialized.contains("只做照片知识卡发布前核验") {
                XCTAssertEqual(try XCTUnwrap(payload["temperature"] as? Double), 0, accuracy: 0.001)
                XCTAssertEqual(payload["model"] as? String, DirectQwenService.verificationModel)
                XCTAssertNil(request.value(forHTTPHeaderField: "X-DashScope-DataInspection"))
                XCTAssertTrue(serialized.contains("先只看图片，独立判断清晰可见的主体"))
                XCTAssertTrue(serialized.contains("扫帚的大部分柔软刷毛"))
                XCTAssertTrue(serialized.contains("软刷毛负责地面硬刷毛处理墙角"))
                responseContent = """
                {"decision":"accept","imageObject":"扫帚","objectMatchesImage":true,"objectIsPrimarySubject":true,"subtypeMatchesFact":true,"titleGrounded":true,"bodyGrounded":true,"factAppliesToImage":true,"reason":"标题正文保留了软硬刷毛的明确分工"}
                """
            } else {
                XCTAssertEqual(try XCTUnwrap(payload["temperature"] as? Double), 0.1, accuracy: 0.001)
                XCTAssertEqual(payload["model"] as? String, DirectQwenService.reviewedModel)
                XCTAssertNil(request.value(forHTTPHeaderField: "X-DashScope-DataInspection"))
                XCTAssertTrue(serialized.contains("broom-angled"))
                XCTAssertTrue(serialized.contains("broom-soft-hard"))
                XCTAssertTrue(serialized.contains("只能选择该类物件几乎都共有的当前机制"))
                XCTAssertTrue(serialized.contains("必须保留事实里的适用范围和时间限定"))
                responseContent = """
                {"decision":"publish","factId":"broom-soft-hard","title":"软刷毛负责地面硬刷毛处理墙角"}
                """
            }
            let envelope = try JSONSerialization.data(withJSONObject: [
                "choices": [["finish_reason": "stop", "message": ["content": responseContent]]]
            ])
            return (
                HTTPURLResponse(
                    url: try XCTUnwrap(request.url),
                    statusCode: 200,
                    httpVersion: "HTTP/1.1",
                    headerFields: ["Content-Type": "application/json"]
                )!,
                envelope
            )
        }
        let service = try DirectQwenService(session: session)

        let result = try await service.editKnowledgeCard(jpeg: jpeg, from: options, apiKey: key)
        let edited = try XCTUnwrap(result)

        XCTAssertEqual(edited.factID, "broom-soft-hard")
        XCTAssertEqual(edited.title, "软刷毛负责地面硬刷毛处理墙角")
        XCTAssertEqual(edited.body, options[1].factText)
        XCTAssertFalse(edited.body.hasPrefix(edited.title))
    }

    func testCachedEditorialCarriesEachFactPhotoScopeThroughSelection() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DirectQwenURLProtocol.self]
        let session = URLSession(configuration: configuration)
        // Synthetic contract fixtures, not newly approved catalog content.
        let category = KnowledgeFactOption(
            factID: "stapler-category", topicID: "stapler", objectName: "订书机",
            reviewedTitle: "有些订书机不打钉，也不打孔",
            reviewedBody: "有一种无针订书机，通过压出凹凸纹路把纸页固定在一起。",
            photoApplicability: "category", photoObjectName: "订书机",
            factText: "有一种无针订书机，通过压出凹凸纹路把纸页固定在一起。", sources: []
        )
        let visible = KnowledgeFactOption(
            factID: "stapler-visible", topicID: "stapler", objectName: "订书机",
            reviewedTitle: "这台无针订书机靠压纹装订",
            reviewedBody: "这台无针订书机通过压出凹凸纹路把纸页固定在一起。",
            photoApplicability: "visible_subtype", photoObjectName: "压纹式无针订书机",
            factText: "压纹式无针订书机通过压出凹凸纹路把纸页固定在一起。", sources: []
        )
        let attempts = TestAttemptCounter()
        DirectQwenURLProtocol.handler = { request in
            let body = try requestBodyData(request)
            let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
            let messages = try XCTUnwrap(payload["messages"] as? [[String: Any]])
            let content = try XCTUnwrap(messages.first?["content"] as? [[String: Any]])
            let prompt = try XCTUnwrap(content.first(where: { $0["type"] as? String == "text" })?["text"] as? String)
            XCTAssertNil(payload["tools"])
            XCTAssertNil(payload["enable_search"])
            XCTAssertNil(request.value(forHTTPHeaderField: "X-DashScope-DataInspection"))
            let reply: String
            if attempts.incrementAndRead() == 1 {
                let candidatesJSON = try XCTUnwrap(prompt.split(separator: "\n").last)
                let candidates = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(candidatesJSON.utf8)) as? [[String: Any]])
                XCTAssertEqual(candidates.count, 2)
                XCTAssertEqual(candidates[0]["photoApplicability"] as? String, "category")
                XCTAssertEqual(candidates[0]["photoObjectName"] as? String, "订书机")
                XCTAssertEqual(candidates[1]["photoApplicability"] as? String, "visible_subtype")
                XCTAssertEqual(candidates[1]["photoObjectName"] as? String, "压纹式无针订书机")
                reply = """
                {"decision":"publish","factId":"stapler-category","title":"有些订书机不打钉，也不打孔"}
                """
            } else {
                XCTAssertTrue(prompt.contains("照片触发规则：category"))
                XCTAssertTrue(prompt.contains("本次类别知识不要求特殊结构出现在照片中"))
                XCTAssertFalse(prompt.contains("即使标题保留‘有些’‘一种方案’，普通同类照片也不能作为入口"))
                reply = """
                {"decision":"accept","imageObject":"普通订书机","objectMatchesImage":true,"objectIsPrimarySubject":true,"subtypeMatchesFact":false,"titleGrounded":true,"bodyGrounded":true,"factAppliesToImage":true,"reason":"普通订书机引出明确限定的同类设计，没有断言图中型号"}
                """
            }
            let envelope = try JSONSerialization.data(withJSONObject: ["choices": [["finish_reason": "stop", "message": ["content": reply]]]])
            return (HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 200, httpVersion: nil, headerFields: nil)!, envelope)
        }
        let result = try await DirectQwenService(session: session).editKnowledgeCard(
            jpeg: makeTestJPEG(), from: [category, visible], apiKey: "sk-test_12345678901234567890"
        )
        XCTAssertEqual(result?.factID, category.factID)
        XCTAssertEqual(result?.body, category.reviewedBody)
        XCTAssertEqual(attempts.value, 2, "Category knowledge must not add a visible-subtype call")
    }

    func testCachedFeatureReviewKeepsTheExplicitPhotoRequirementInsteadOfOnlyTheTitle() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DirectQwenURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let requirement = "底座有两组不同弯折方向导槽的订书机承砧"
        let option = KnowledgeFactOption(
            factID: "stapler-anvil", topicID: "stapler", objectName: "订书机",
            reviewedTitle: "订书机底座还藏着另一种装订方式",
            reviewedBody: "有些订书机的承砧有两组导槽，可以让订书钉向不同方向弯折。",
            photoApplicability: "visible_feature", photoObjectName: requirement,
            factText: "有些订书机的承砧有两组导槽，可以让订书钉向不同方向弯折。", sources: []
        )
        let attempts = TestAttemptCounter()
        DirectQwenURLProtocol.handler = { request in
            let serialized = String(decoding: try requestBodyData(request), as: UTF8.self)
            let reply: String
            if attempts.incrementAndRead() == 1 {
                XCTAssertTrue(serialized.contains(requirement))
                reply = """
                {"decision":"accept","imageObject":"订书机","objectMatchesImage":true,"objectIsPrimarySubject":true,"subtypeMatchesFact":true,"titleGrounded":true,"bodyGrounded":true,"factAppliesToImage":true,"reason":"初步看见了承砧"}
                """
            } else {
                XCTAssertTrue(serialized.contains("requiredFeature：\(requirement)"))
                reply = """
                {"decision":"reject","imageObject":"订书机","requiredVisualEvidenceVisible":false,"visibleEvidence":"底座大部分被纸遮住，无法辨认两组导槽","reason":"没有看见要求的全部特征"}
                """
            }
            let envelope = try JSONSerialization.data(withJSONObject: ["choices": [["finish_reason": "stop", "message": ["content": reply]]]])
            return (HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 200, httpVersion: nil, headerFields: nil)!, envelope)
        }
        let result = try await DirectQwenService(session: session).editKnowledgeCard(
            jpeg: makeTestJPEG(), from: [option], apiKey: "sk-test_12345678901234567890"
        )
        XCTAssertNil(result)
        XCTAssertEqual(attempts.value, 2)
    }

    func testDirectQwenDropsEditorialTitleWhenVerificationFindsUnsupportedClaim() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DirectQwenURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let key = "sk-test_12345678901234567890"
        let option = KnowledgeFactOption(
            factID: "soap-pump",
            topicID: "soap_dispenser",
            objectName: "皂液器",
            factText: "按压皂液泵会压缩泵腔，入口和出口的单向阀让液体只能朝喷嘴前进。",
            sources: []
        )
        DirectQwenURLProtocol.handler = { request in
            let serialized = String(decoding: try requestBodyData(request), as: UTF8.self)
            let content: String
            if serialized.contains("只做照片知识卡发布前核验") {
                XCTAssertTrue(serialized.contains("入口藏着泵腔让单向阀朝喷嘴前进"))
                content = """
                {"decision":"reject","imageObject":"皂液器","objectMatchesImage":true,"objectIsPrimarySubject":true,"subtypeMatchesFact":true,"titleGrounded":false,"bodyGrounded":true,"factAppliesToImage":true,"reason":"标题错误地声称入口包含泵腔"}
                """
            } else {
                content = """
                {"decision":"publish","factId":"soap-pump","title":"入口藏着泵腔让单向阀朝喷嘴前进"}
                """
            }
            let envelope = try JSONSerialization.data(withJSONObject: [
                "choices": [["finish_reason": "stop", "message": ["content": content]]]
            ])
            return (
                HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 200, httpVersion: nil, headerFields: nil)!,
                envelope
            )
        }
        let service = try DirectQwenService(session: session)

        let edited = try await service.editKnowledgeCard(
            jpeg: makeTestJPEG(),
            from: [option],
            apiKey: key
        )

        XCTAssertNil(edited)
    }

    func testDirectQwenRejectsVisibleSubtypeWhenPrimaryVerificationCannotSeeSubtype() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DirectQwenURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let option = KnowledgeFactOption(
            factID: "mosquito-double-coil",
            topicID: "mosquito_coil",
            objectName: "蚊香",
            reviewedTitle: "双盘蚊香，其实是一张片切出来的",
            reviewedBody: "常见双盘蚊香会在同一张材料片里切出彼此嵌套的两条螺旋。",
            photoApplicability: "visible_subtype",
            photoObjectName: "未分离、中心呈S形分界且有两个相向内端的双盘蚊香",
            factText: "常见双盘蚊香会在同一张材料片里切出彼此嵌套的两条螺旋。",
            sources: []
        )
        DirectQwenURLProtocol.handler = { request in
            let serialized = String(decoding: try requestBodyData(request), as: UTF8.self)
            XCTAssertTrue(serialized.contains("只做照片知识卡发布前核验"))
            XCTAssertFalse(serialized.contains("第二位独立视觉核验员"))
            let content = """
            {"decision":"accept","imageObject":"单盘蚊香","objectMatchesImage":true,"objectIsPrimarySubject":true,"subtypeMatchesFact":false,"titleGrounded":true,"bodyGrounded":true,"factAppliesToImage":true,"reason":"图片是蚊香，但无法确认双盘子类型"}
            """
            let envelope = try JSONSerialization.data(withJSONObject: [
                "choices": [["finish_reason": "stop", "message": ["content": content]]]
            ])
            return (
                HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 200, httpVersion: nil, headerFields: nil)!,
                envelope
            )
        }
        let service = try DirectQwenService(session: session)

        let edited = try await service.editKnowledgeCard(
            jpeg: makeTestJPEG(),
            from: [option],
            apiKey: "sk-test_12345678901234567890"
        )

        XCTAssertNil(edited)
    }

    func testDirectQwenRequiresIndependentVisibleSubtypeVerification() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DirectQwenURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let option = KnowledgeFactOption(
            factID: "mosquito-double-coil",
            topicID: "mosquito_coil",
            objectName: "蚊香",
            reviewedTitle: "双盘蚊香，其实是一张片切出来的",
            reviewedBody: "常见双盘蚊香会在同一张材料片里切出彼此嵌套的两条螺旋。",
            photoApplicability: "visible_subtype",
            photoObjectName: "未分离、中心呈S形分界且有两个相向内端的双盘蚊香",
            factText: "常见双盘蚊香会在同一张材料片里切出彼此嵌套的两条螺旋。",
            sources: []
        )
        DirectQwenURLProtocol.handler = { request in
            let serialized = String(decoding: try requestBodyData(request), as: UTF8.self)
            let content: String
            if serialized.contains("第二位独立视觉核验员") {
                XCTAssertTrue(serialized.contains("中心呈S形分界"))
                content = """
                {"decision":"reject","imageObject":"单盘蚊香","requiredVisualEvidenceVisible":false,"reason":"只看见一个开放内端，没有S形分界"}
                """
            } else {
                XCTAssertTrue(serialized.contains("只做照片知识卡发布前核验"))
                content = """
                {"decision":"accept","imageObject":"双盘蚊香","objectMatchesImage":true,"objectIsPrimarySubject":true,"subtypeMatchesFact":true,"titleGrounded":true,"bodyGrounded":true,"factAppliesToImage":true,"reason":"初步判断照片像双盘蚊香"}
                """
            }
            let envelope = try JSONSerialization.data(withJSONObject: [
                "choices": [["finish_reason": "stop", "message": ["content": content]]]
            ])
            return (
                HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 200, httpVersion: nil, headerFields: nil)!,
                envelope
            )
        }
        let service = try DirectQwenService(session: session)

        let edited = try await service.editKnowledgeCard(
            jpeg: makeTestJPEG(),
            from: [option],
            apiKey: "sk-test_12345678901234567890"
        )

        XCTAssertNil(edited)
    }

    func testDirectQwenRequiresIndependentVisibleFeatureVerification() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DirectQwenURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let option = KnowledgeFactOption(
            factID: "microwave-door-mesh",
            topicID: "microwave_oven",
            objectName: "微波炉",
            reviewedTitle: "微波炉门上的网孔，让你看进去却挡回微波",
            reviewedBody: "门上的金属网孔让你看见里面，却会把微波像实心金属面一样反射回去。",
            photoApplicability: "visible_feature",
            factText: "微波炉门屏网让用户看见炉腔，却会像实心表面一样反射微波。",
            sources: []
        )
        DirectQwenURLProtocol.handler = { request in
            let serialized = String(decoding: try requestBodyData(request), as: UTF8.self)
            let content: String
            if serialized.contains("只判断指定部件或纹理") {
                XCTAssertTrue(serialized.contains("反光、磨砂或不透明面板本身不等于"))
                content = """
                {"decision":"reject","imageObject":"反光门微波炉","requiredVisualEvidenceVisible":false,"visibleEvidence":"门面只有环境倒影，没有可辨网孔","reason":"不能把倒影纹理当作门屏网"}
                """
            } else {
                XCTAssertTrue(serialized.contains("只做照片知识卡发布前核验"))
                content = """
                {"decision":"accept","imageObject":"微波炉","objectMatchesImage":true,"objectIsPrimarySubject":true,"subtypeMatchesFact":true,"titleGrounded":true,"bodyGrounded":true,"factAppliesToImage":true,"reason":"初步判断门面似乎存在屏网"}
                """
            }
            let envelope = try JSONSerialization.data(withJSONObject: [
                "choices": [["finish_reason": "stop", "message": ["content": content]]]
            ])
            return (
                HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 200, httpVersion: nil, headerFields: nil)!,
                envelope
            )
        }
        let service = try DirectQwenService(session: session)

        let edited = try await service.editKnowledgeCard(
            jpeg: makeTestJPEG(),
            from: [option],
            apiKey: "sk-test_12345678901234567890"
        )

        XCTAssertNil(edited)
    }

    func testDirectQwenFallsBackToReviewedTitleWhenModelChangesApprovedCopy() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DirectQwenURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let option = KnowledgeFactOption(
            factID: "floss-history",
            topicID: "dental_floss",
            objectName: "牙线",
            reviewedTitle: "牙线有没有蜡，并不决定它能不能清干净",
            reviewedBody: "牙线从过去的多股丝纤维，发展到如今常见的尼龙细丝或塑料单丝；是否上蜡，并不是清洁效果的决定因素。",
            photoApplicability: "category",
            factText: "牙线过去曾用多股丝纤维捻成；如今常见产品更多采用尼龙细丝或塑料单丝，是否上蜡并不是清洁效果的决定因素。",
            sources: []
        )
        DirectQwenURLProtocol.handler = { request in
            let serialized = String(decoding: try requestBodyData(request), as: UTF8.self)
            let content: String
            if serialized.contains("只做照片知识卡发布前核验") {
                XCTAssertTrue(serialized.contains("牙线有没有蜡，并不决定它能不能清干净"))
                content = """
                {"decision":"accept","imageObject":"牙线","objectMatchesImage":true,"objectIsPrimarySubject":true,"subtypeMatchesFact":true,"titleGrounded":true,"bodyGrounded":true,"factAppliesToImage":true,"reason":"审核标题正文与事实一致且适用于牙线"}
                """
            } else {
                XCTAssertTrue(serialized.contains("带完整 reviewedTitle 和 reviewedBody 的事实已经过表达审核"))
                content = """
                {"decision":"publish","factId":"floss-history","title":"牙线过去用多股丝捻成如今多为尼龙细丝或塑料单丝"}
                """
            }
            let envelope = try JSONSerialization.data(withJSONObject: [
                "choices": [["finish_reason": "stop", "message": ["content": content]]]
            ])
            return (
                HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 200, httpVersion: nil, headerFields: nil)!,
                envelope
            )
        }
        let service = try DirectQwenService(session: session)

        let edited = try await service.editKnowledgeCard(
            jpeg: makeTestJPEG(),
            from: [option],
            apiKey: "sk-test_12345678901234567890"
        )

        XCTAssertEqual(edited?.factID, "floss-history")
        XCTAssertEqual(edited?.title, "牙线有没有蜡，并不决定它能不能清干净")
        XCTAssertEqual(edited?.body, "牙线从过去的多股丝纤维，发展到如今常见的尼龙细丝或塑料单丝；是否上蜡，并不是清洁效果的决定因素。")
    }

    func testDirectQwenRejectsEditorialChineseContentOutsideReviewedFact() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DirectQwenURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let option = KnowledgeFactOption(
            factID: "soap-pump",
            topicID: "soap_dispenser",
            objectName: "皂液器",
            factText: "按压皂液泵会压缩泵腔，入口和出口的单向阀让液体只能朝喷嘴前进。",
            sources: []
        )
        DirectQwenURLProtocol.handler = { request in
            let content = """
            {"decision":"publish","factId":"soap-pump","title":"月牙孔藏着空气混合泡沫"}
            """
            let envelope = try JSONSerialization.data(withJSONObject: [
                "choices": [["finish_reason": "stop", "message": ["content": content]]]
            ])
            return (
                HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 200, httpVersion: nil, headerFields: nil)!,
                envelope
            )
        }
        let service = try DirectQwenService(session: session)

        do {
            _ = try await service.editKnowledgeCard(
                jpeg: makeTestJPEG(),
                from: [option],
                apiKey: "sk-test_12345678901234567890"
            )
            XCTFail("Chinese content outside the reviewed fact must be rejected before publication")
        } catch {
            XCTAssertEqual(error as? ProductError, .invalidServerResponse)
        }
    }

    func testDirectQwenDropsTitleThatCrossCombinesAlternativeMaterials() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DirectQwenURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let option = KnowledgeFactOption(
            factID: "floss-materials",
            topicID: "dental_floss",
            objectName: "牙线",
            factText: "牙线过去曾用多股丝纤维捻成；如今常见产品更多采用尼龙细丝或塑料单丝。",
            sources: []
        )
        DirectQwenURLProtocol.handler = { request in
            let serialized = String(decoding: try requestBodyData(request), as: UTF8.self)
            let content: String
            if serialized.contains("只做照片知识卡发布前核验") {
                XCTAssertTrue(serialized.contains("尼龙细丝或塑料单丝"))
                XCTAssertTrue(serialized.contains("跨越‘或’重组材料与结构"))
                content = """
                {"decision":"reject","imageObject":"牙线","objectMatchesImage":true,"objectIsPrimarySubject":true,"subtypeMatchesFact":true,"titleGrounded":false,"bodyGrounded":true,"factAppliesToImage":true,"reason":"尼龙与单丝来自或号两侧，组合关系不受事实支持"}
                """
            } else {
                content = """
                {"decision":"publish","factId":"floss-materials","title":"牙线过去用丝纤维捻成如今多为尼龙单丝"}
                """
            }
            let envelope = try JSONSerialization.data(withJSONObject: [
                "choices": [["finish_reason": "stop", "message": ["content": content]]]
            ])
            return (
                HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 200, httpVersion: nil, headerFields: nil)!,
                envelope
            )
        }
        let service = try DirectQwenService(session: session)

        let edited = try await service.editKnowledgeCard(
            jpeg: makeTestJPEG(),
            from: [option],
            apiKey: "sk-test_12345678901234567890"
        )

        XCTAssertNil(edited)
    }

    func testDirectQwenRejectsPatentStyleRepeatedEditorialCopy() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DirectQwenURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let key = "sk-test_12345678901234567890"
        let jpeg = makeTestJPEG()
        let options = [KnowledgeFactOption(
            factID: "broom-fact",
            topicID: "broom",
            objectName: "扫帚",
            factText: "一种扫帚设计让柔软刷毛负责普通地面，再用硬刷毛处理墙角和顽固污物。",
            sources: []
        )]
        DirectQwenURLProtocol.handler = { request in
            let content = """
            {"decision":"publish","factId":"broom-fact","title":"一种扫帚设计让柔软刷毛负责地面"}
            """
            let envelope = try JSONSerialization.data(withJSONObject: [
                "choices": [["finish_reason": "stop", "message": ["content": content]]]
            ])
            return (
                HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 200, httpVersion: nil, headerFields: nil)!,
                envelope
            )
        }
        let service = try DirectQwenService(session: session)

        do {
            _ = try await service.editKnowledgeCard(jpeg: jpeg, from: options, apiKey: key)
            XCTFail("Patent-style repeated copy must be rejected")
        } catch {
            XCTAssertEqual(error as? ProductError, .invalidServerResponse)
        }
    }

    func testDirectQwenCanSkipWhenNoReviewedFactMatchesTheVisibleSubtype() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DirectQwenURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let key = "sk-test_12345678901234567890"
        let options = [KnowledgeFactOption(
            factID: "washing-machine-drum",
            topicID: "washing_machine",
            objectName: "洗衣机",
            factText: "滚筒洗衣机会把衣物带到较高位置再落下，利用翻滚和水流完成洗涤。",
            sources: []
        )]
        DirectQwenURLProtocol.handler = { request in
            let serialized = String(decoding: try requestBodyData(request), as: UTF8.self)
            XCTAssertTrue(serialized.contains("只有图片能看出该结构或子类型时才可选"))
            let content = """
            {"decision":"skip","factId":null,"title":null}
            """
            let envelope = try JSONSerialization.data(withJSONObject: [
                "choices": [["finish_reason": "stop", "message": ["content": content]]]
            ])
            return (
                HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 200, httpVersion: nil, headerFields: nil)!,
                envelope
            )
        }
        let service = try DirectQwenService(session: session)

        let edited = try await service.editKnowledgeCard(
            jpeg: makeTestJPEG(),
            from: options,
            apiKey: key
        )

        XCTAssertNil(edited)
    }

    func testManagedModelAccessRequiresAnEntitlementBeforeAnyRequest() async throws {
        let store = AIModelAccessStore(keychain: TestSecretStore())

        do {
            _ = try await store.request(for: .managed)
            XCTFail("Managed access must not proceed without an App Store entitlement")
        } catch {
            XCTAssertEqual(error as? ProductError, .subscriptionRequired)
        }

        let transaction = "eyJhbGciOiJFUzI1NiJ9.\(String(repeating: "x", count: 100)).signature"
        let request = try await store.request(
            for: .managed,
            managedTransaction: transaction
        )
        XCTAssertEqual(request.mode, .managed)
        XCTAssertEqual(request.appStoreTransaction, transaction)
        XCTAssertNil(request.apiKey)
    }

    func testWidgetQueueAllowsAtMostTwoDistinctSwapsPerDay() {
        let cards = (0..<4).map { index in
            WidgetCardSnapshot(
                id: UUID(),
                candidateToken: UUID(),
                topicID: "topic-\(index)",
                objectName: "物件 \(index)",
                title: "标题 \(index)",
                body: "正文 \(index)",
                personalContext: "原因",
                confidence: 0.9,
                scheduledDay: "2026-08-03",
                presentationStatus: index == 0 ? "scheduled" : "candidate",
                createdAt: Date(timeIntervalSince1970: TimeInterval(index)),
                thumbnailFilename: nil,
                source: WidgetSourceSnapshot(
                    title: "来源",
                    publisher: "发布者",
                    url: URL(string: "https://example.com/\(index)")!
                )
            )
        }
        var state = WidgetQueueState.empty
        state.mergeCards(cards)

        if case .advanced = state.advance(on: "2026-08-03") {} else {
            XCTFail("第一次换卡应成功")
        }
        if case .advanced = state.advance(on: "2026-08-03") {} else {
            XCTFail("第二次换卡应成功")
        }
        XCTAssertEqual(state.advance(on: "2026-08-03"), .limitReached)
        XCTAssertEqual(state.swapCounts["2026-08-03"], 2)
    }

    func testWidgetQueueDoesNotOfferSwitchWhenOnlyOneCardExists() {
        let card = WidgetCardSnapshot(
            id: UUID(),
            candidateToken: UUID(),
            topicID: "broom",
            objectName: "扫帚",
            title: "扫帚的刷毛为什么斜切",
            body: "斜切刷毛更容易贴近边缘。",
            personalContext: "来自你选择的照片",
            confidence: 0.95,
            scheduledDay: "2026-08-03",
            thumbnailFilename: nil,
            source: WidgetSourceSnapshot(
                title: "来源",
                publisher: "Google Patents",
                url: URL(string: "https://example.com/broom")!
            )
        )
        var state = WidgetQueueState.empty
        state.mergeCards([card])

        XCTAssertFalse(state.canAdvance(on: "2026-08-03"))
        XCTAssertEqual(state.advance(on: "2026-08-03"), .noCandidate)
        XCTAssertEqual(state.swapCounts["2026-08-03"], 0)
    }

    func testWidgetQueueOnlyUsesTodayBatchAndNeverFallsBackAcrossDays() {
        let yesterday = makeWidgetCard(index: 0, day: "2026-08-02", status: "scheduled")
        let todayWinner = makeWidgetCard(index: 1, day: "2026-08-03", status: "scheduled")
        let todayRunnerUp = makeWidgetCard(index: 2, day: "2026-08-03", status: "candidate")
        var state = WidgetQueueState.empty
        state.mergeCards([yesterday, todayWinner, todayRunnerUp])

        XCTAssertEqual(state.card(for: "2026-08-03")?.id, todayWinner.id)
        XCTAssertNil(state.card(for: "2026-08-04"), "无新卡日不得把昨天卡伪装成今日内容")
        guard case let .advanced(nextID) = state.advance(on: "2026-08-03") else {
            return XCTFail("今天的 runner-up 应可换出")
        }
        XCTAssertEqual(nextID, todayRunnerUp.id)
        XCTAssertNotEqual(nextID, yesterday.id)
    }

    func testWidgetOffersADifferentTopicBeforeAnotherAngleOnTheWinner() {
        let day = "2026-08-03"
        let winner = makeWidgetCard(index: 0, day: day, status: "scheduled")
        let sameTopicBase = makeWidgetCard(index: 1, day: day, status: "candidate")
        let differentTopic = makeWidgetCard(index: 2, day: day, status: "candidate")
        let sameTopic = WidgetCardSnapshot(
            id: sameTopicBase.id,
            candidateToken: sameTopicBase.candidateToken,
            topicID: winner.topicID,
            objectName: sameTopicBase.objectName,
            title: sameTopicBase.title,
            body: sameTopicBase.body,
            personalContext: sameTopicBase.personalContext,
            confidence: sameTopicBase.confidence,
            scheduledDay: sameTopicBase.scheduledDay,
            presentationStatus: sameTopicBase.presentationStatus,
            createdAt: sameTopicBase.createdAt,
            isManualImport: sameTopicBase.isManualImport,
            thumbnailFilename: sameTopicBase.thumbnailFilename,
            source: sameTopicBase.source
        )
        var state = WidgetQueueState.empty
        state.mergeCards([winner, sameTopic, differentTopic])

        guard case let .advanced(nextID) = state.advance(on: day) else {
            return XCTFail("不同物件的 runner-up 应优先出现")
        }
        XCTAssertEqual(nextID, differentTopic.id)
    }

    func testWidgetCanKeepTheMostRecentCardVisibleUntilANewDayIsPrepared() {
        let yesterday = makeWidgetCard(index: 0, day: "2026-08-02", status: "scheduled")
        var state = WidgetQueueState.empty
        state.mergeCards([yesterday])

        XCTAssertNil(state.card(for: "2026-08-03"))
        XCTAssertEqual(state.mostRecentCard(onOrBefore: "2026-08-03")?.id, yesterday.id)
        XCTAssertNil(state.mostRecentCard(onOrBefore: "2026-08-01"))
    }

    func testRepositoryAllowsOnlyOneAutomaticDiscoveryRunAtATime() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let repository = try LocalRepository(rootURL: root)

        let firstRun = await repository.beginAutomaticDiscoveryRun()
        let overlappingRun = await repository.beginAutomaticDiscoveryRun()
        XCTAssertTrue(firstRun)
        XCTAssertFalse(overlappingRun)
        await repository.endAutomaticDiscoveryRun()
        let runAfterRelease = await repository.beginAutomaticDiscoveryRun()
        XCTAssertTrue(runAfterRelease)
        await repository.endAutomaticDiscoveryRun()
    }

    func testWidgetSelectionSurvivesPromotionAndCanUndoWithinThirtySeconds() {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let winner = makeWidgetCard(index: 0, day: "2026-08-03", status: "scheduled")
        let runnerUp = makeWidgetCard(index: 1, day: "2026-08-03", status: "candidate")
        let third = makeWidgetCard(index: 2, day: "2026-08-03", status: "candidate")
        var state = WidgetQueueState.empty
        state.mergeCards([winner, runnerUp, third], now: now)

        guard case let .advanced(selectedID) = state.advance(on: "2026-08-03", now: now) else {
            return XCTFail("换卡应成功")
        }
        let promoted = [winner, runnerUp, third].map { card in
            guard card.id == selectedID else { return card }
            return WidgetCardSnapshot(
                id: card.id,
                candidateToken: card.candidateToken,
                topicID: card.topicID,
                objectName: card.objectName,
                title: card.title,
                body: card.body,
                personalContext: card.personalContext,
                confidence: card.confidence,
                scheduledDay: card.scheduledDay,
                presentationStatus: "scheduled",
                createdAt: card.createdAt,
                thumbnailFilename: card.thumbnailFilename,
                source: card.source
            )
        }
        state.mergeCards(promoted, now: now.addingTimeInterval(1))

        XCTAssertEqual(state.card(for: "2026-08-03")?.id, selectedID)
        XCTAssertTrue(state.canUndo(on: "2026-08-03", now: now.addingTimeInterval(20)))
        XCTAssertTrue(state.undo(on: "2026-08-03", now: now.addingTimeInterval(20)))
        XCTAssertEqual(state.card(for: "2026-08-03")?.id, winner.id)
        XCTAssertEqual(state.remainingSwaps(on: "2026-08-03"), 2)
        XCTAssertTrue(state.surfacedCards(on: "2026-08-03").contains(where: { $0.id == selectedID }))
        XCTAssertTrue(state.presentations.contains(where: { $0.cardID == selectedID }))
    }

    func testRemovingTheSwappedToCardClearsTheStaleUndoStep() {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let winner = makeWidgetCard(index: 0, day: "2026-08-03", status: "scheduled")
        let runnerUp = makeWidgetCard(index: 1, day: "2026-08-03", status: "candidate")
        let third = makeWidgetCard(index: 2, day: "2026-08-03", status: "candidate")
        var state = WidgetQueueState.empty
        state.mergeCards([winner, runnerUp, third], now: now)
        guard case let .advanced(swappedID) = state.advance(on: "2026-08-03", now: now) else {
            return XCTFail("换卡应成功")
        }

        state.mergeCards(
            [winner, runnerUp, third].filter { $0.id != swappedID },
            now: now.addingTimeInterval(5)
        )

        XCTAssertFalse(state.canUndo(on: "2026-08-03", now: now.addingTimeInterval(10)))
        XCTAssertFalse(state.undo(on: "2026-08-03", now: now.addingTimeInterval(10)))
        XCTAssertFalse(state.presentations.contains(where: { $0.cardID == swappedID }))
    }

    func testManualCardDoesNotCrowdOutTheThreeCardDailyPoolOrResetCurrentSelection() {
        let day = "2026-08-03"
        let winner = makeWidgetCard(index: 0, day: day, status: "scheduled")
        let runnerUp = makeWidgetCard(index: 1, day: day, status: "candidate")
        let third = makeWidgetCard(index: 2, day: day, status: "candidate")
        let imported = makeWidgetCard(index: 9, day: day, status: "scheduled")
        var state = WidgetQueueState.empty
        state.mergeCards([winner, runnerUp, third])
        let originalPool = state.dailySelections[day]?.pool

        XCTAssertTrue(state.activate(cardID: imported.id, on: day) == false)
        state.mergeCards([winner, runnerUp, third, imported])
        XCTAssertTrue(state.activate(cardID: imported.id, on: day))
        state.mergeCards([winner, runnerUp, third, imported])

        XCTAssertEqual(state.card(for: day)?.id, imported.id)
        XCTAssertEqual(state.dailySelections[day]?.pool, originalPool)
        guard case let .advanced(firstSwap) = state.advance(on: day) else {
            return XCTFail("导入卡不应吞掉第一张 runner-up")
        }
        guard case let .advanced(secondSwap) = state.advance(on: day) else {
            return XCTFail("导入卡不应吞掉第二张 runner-up")
        }
        XCTAssertEqual(Set([firstSwap, secondSwap]), Set([runnerUp.id, third.id]))
    }

    func testManualCardImportedBeforeDailyBatchCannotHideTheDailyWinner() {
        let day = "2026-08-03"
        let imported = makeWidgetCard(index: 9, day: day, status: "scheduled")
        let winner = makeWidgetCard(index: 0, day: day, status: "scheduled")
        let runnerUp = makeWidgetCard(index: 1, day: day, status: "candidate")
        let third = makeWidgetCard(index: 2, day: day, status: "candidate")
        var state = WidgetQueueState.empty

        state.mergeCards([imported])
        XCTAssertTrue(state.activate(cardID: imported.id, on: day))
        XCTAssertTrue(state.dailySelections[day]?.pool.isEmpty == true)
        XCTAssertEqual(state.presentations.last?.reason, .manual)

        state.mergeCards([imported, winner, runnerUp, third])

        XCTAssertEqual(state.card(for: day)?.id, winner.id)
        XCTAssertEqual(
            state.dailySelections[day]?.pool,
            [winner.id, runnerUp.id, third.id]
        )
        XCTAssertEqual(
            Set(state.dailySelections[day]?.surfacedCardIDs ?? []),
            Set([imported.id, winner.id])
        )
        guard case let .advanced(firstSwap) = state.advance(on: day) else {
            return XCTFail("每日 winner 出现后仍应保留第一张 runner-up")
        }
        guard case let .advanced(secondSwap) = state.advance(on: day) else {
            return XCTFail("每日 winner 出现后仍应保留第二张 runner-up")
        }
        XCTAssertEqual(Set([firstSwap, secondSwap]), Set([runnerUp.id, third.id]))
        XCTAssertEqual(state.advance(on: day), .limitReached)
    }

    func testExistingManualImportSelectionIsRepairedWhenDailyBatchArrives() {
        let day = "2026-08-03"
        let imported = makeWidgetCard(
            index: 9,
            day: day,
            status: "scheduled",
            isManualImport: true
        )
        let winner = makeWidgetCard(index: 0, day: day, status: "scheduled")
        let runnerUp = makeWidgetCard(index: 1, day: day, status: "candidate")
        let third = makeWidgetCard(index: 2, day: day, status: "candidate")
        var state = WidgetQueueState(
            cards: [imported],
            dailySelections: [
                day: WidgetDailySelectionState(
                    day: day,
                    pool: [imported.id],
                    currentCardID: imported.id,
                    surfacedCardIDs: [imported.id],
                    swapCount: 0,
                    undoStep: nil
                )
            ],
            presentations: [
                WidgetCardPresentation(
                    id: UUID(),
                    cardID: imported.id,
                    day: day,
                    presentedAt: .distantPast,
                    reason: .daily
                )
            ],
            generatedAt: .distantPast
        )

        state.mergeCards([imported, winner, runnerUp, third])

        XCTAssertEqual(state.card(for: day)?.id, winner.id)
        XCTAssertEqual(state.dailySelections[day]?.pool, [winner.id, runnerUp.id, third.id])
        XCTAssertEqual(
            state.presentations.first(where: { $0.cardID == imported.id })?.reason,
            .manual
        )
    }

    func testSensitiveTextCatchesGroupedBankCardAndIdentityCard() {
        let bank = PhotoPrivacyAnalyzer.sensitiveFlags(
            faceDetected: false,
            recognizedText: "6222 0202 1234 5678",
            textBlockCount: 1,
            labels: []
        )
        XCTAssertTrue(bank.contains("bank_card"))

        let identity = PhotoPrivacyAnalyzer.sensitiveFlags(
            faceDetected: false,
            recognizedText: "姓名 王某 性别 女 民族 汉 公民身份号码 11010119900101123X",
            textBlockCount: 4,
            labels: []
        )
        XCTAssertTrue(identity.contains("id_card"))
    }

    func testSensitiveLabelsCatchPluralAndDemographicHumanLabels() {
        for label in ["people", "adult", "child", "woman", "portrait"] {
            let flags = PhotoPrivacyAnalyzer.sensitiveFlags(
                faceDetected: false,
                recognizedText: "",
                textBlockCount: 0,
                labels: [label]
            )
            XCTAssertTrue(flags.contains("person"), "Expected human label to be private: \(label)")
        }
    }

    func testHumanRectangleRejectsAPersonWhenFaceDetectionMisses() {
        let flags = PhotoPrivacyAnalyzer.sensitiveFlags(
            faceDetected: false,
            humanDetected: true,
            recognizedText: "",
            textBlockCount: 0,
            labels: ["aquarium"]
        )

        XCTAssertTrue(flags.contains("person"))
    }

    func testQualityScoreKeepsACrispObjectOnAPlainBackground() {
        var pixels = [UInt8](repeating: 245, count: 64 * 64)
        for y in 16..<48 {
            for x in 18..<46 {
                pixels[y * 64 + x] = 24
            }
        }

        XCTAssertGreaterThanOrEqual(
            PhotoPrivacyAnalyzer.qualityScore(pixels),
            PhotoPrivacyAnalyzer.minimumUsableQualityScore
        )
    }

    func testQualityScoreRejectsAnImageWithOnlySoftTonalVariation() {
        var pixels = [UInt8](repeating: 0, count: 64 * 64)
        for y in 0..<64 {
            for x in 0..<64 {
                pixels[y * 64 + x] = UInt8(72 + (x + y) / 2)
            }
        }

        XCTAssertLessThan(
            PhotoPrivacyAnalyzer.qualityScore(pixels),
            PhotoPrivacyAnalyzer.minimumUsableQualityScore
        )
    }

    func testMetadataStripperRemovesApplicationSegments() throws {
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: 16, height: 16))
        let jpeg = renderer.jpegData(withCompressionQuality: 0.8) { context in
            UIColor.systemGreen.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 16, height: 16))
        }
        var tagged = Data(jpeg.prefix(2))
        tagged.append(contentsOf: [0xff, 0xe1, 0x00, 0x08])
        tagged.append(Data("Exif00".utf8))
        tagged.append(jpeg.dropFirst(2))

        let stripped = try JPEGMetadataStripper.strip(tagged)

        XCTAssertFalse(stripped.range(of: Data("Exif".utf8)) != nil)
        XCTAssertNoThrow(try JPEGMetadataStripper.requireNoMetadata(stripped))
        XCTAssertNotNil(UIImage(data: stripped))
    }

    func testWidgetProjectionPersistsCompressionReceiptsAndRepairsDamagedImages() async throws {
        let files = FileManager.default
        let root = files.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? files.removeItem(at: root) }
        let repository = try LocalRepository(rootURL: root.appendingPathComponent("app"))
        let store = try SharedWidgetStore(baseURL: root.appendingPathComponent("group"))
        let card = makeCard(topic: "compression")
        let source = makeTestJPEG()
        try await repository.upsert(card: card, sanitizedJPEG: source)
        let coordinator = WidgetCoordinator(repository: repository, sharedStore: store)
        try await coordinator.synchronize()
        let initial = try store.load()
        let receipt = try XCTUnwrap(initial.thumbnailReceipts[card.candidateToken])
        XCTAssertEqual(receipt.sourceDigest, SHA256.hash(data: source).map { String(format: "%02x", $0) }.joined())
        let imageURL = store.thumbnailURL(for: card.candidateToken)
        let jpeg = try Data(contentsOf: imageURL)
        XCTAssertNotNil(UIImage(data: jpeg))
        XCTAssertEqual(receipt.thumbnailDigest, SHA256.hash(data: jpeg).map { String(format: "%02x", $0) }.joined())
        let oldDate = Date(timeIntervalSince1970: 1_700_000_000)
        try files.setAttributes([.modificationDate: oldDate], ofItemAtPath: imageURL.path)
        try await coordinator.synchronize()
        XCTAssertEqual(try store.load().thumbnailReceipts, initial.thumbnailReceipts)
        XCTAssertEqual(try files.attributesOfItem(atPath: imageURL.path)[.modificationDate] as? Date, oldDate)

        try Data([0, 1, 2]).write(to: imageURL, options: .atomic)
        try await coordinator.synchronize()
        XCTAssertEqual(try Data(contentsOf: imageURL), jpeg)
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: 40, height: 20))
        let changedSource = renderer.jpegData(withCompressionQuality: 0.8) { context in
            UIColor.blue.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 40, height: 20))
        }
        try await repository.storeImage(changedSource, candidateToken: card.candidateToken)
        try await coordinator.synchronize()
        let updated = try store.load()
        XCTAssertNotEqual(updated.thumbnailReceipts[card.candidateToken]?.sourceDigest, receipt.sourceDigest)
        XCTAssertNotEqual(try Data(contentsOf: imageURL), jpeg)
        XCTAssertNotNil(UIImage(contentsOfFile: imageURL.path))
        XCTAssertEqual(updated.cards, initial.cards)
        XCTAssertEqual(updated.dailySelections, initial.dailySelections)
        XCTAssertEqual(updated.presentations, initial.presentations)
    }

    func testWidgetThumbnailStaysWithinWidgetKitPixelBudget() throws {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 3
        let renderer = UIGraphicsImageRenderer(
            size: CGSize(width: 900, height: 1_200),
            format: format
        )
        let oversized = renderer.jpegData(withCompressionQuality: 0.9) { context in
            UIColor.systemBrown.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 900, height: 1_200))
        }

        let thumbnail = try ImageSanitizer().sanitize(
            oversized,
            maximumSide: WidgetCoordinator.maximumThumbnailSide
        )
        let decoded = try XCTUnwrap(UIImage(data: thumbnail.jpeg)?.cgImage)

        XCTAssertLessThanOrEqual(max(decoded.width, decoded.height), 800)
        XCTAssertLessThanOrEqual(decoded.width * decoded.height, 800 * 800)
    }

    func testSharedWidgetStorePersistsAtomicStateAndThumbnail() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = try SharedWidgetStore(baseURL: root)
        let card = WidgetCardSnapshot(
            id: UUID(),
            candidateToken: UUID(),
            topicID: "broom",
            objectName: "扫帚",
            title: "扫帚为什么有一点斜",
            body: "刷毛更容易贴近墙角。",
            personalContext: "来自最近照片",
            confidence: 0.95,
            scheduledDay: "2026-08-03",
            thumbnailFilename: "thumb.jpg",
            source: WidgetSourceSnapshot(
                title: "Patent",
                publisher: "Google Patents",
                url: URL(string: "https://patents.google.com/patent/US4756039A/en")!
            )
        )
        let thumbnail = Data([0xff, 0xd8, 0xff, 0xd9])

        try store.replaceCards([card], thumbnails: [card.candidateToken: thumbnail])

        XCTAssertEqual(try store.load().cards, [card])
        XCTAssertEqual(try Data(contentsOf: store.thumbnailURL(for: card.candidateToken)), thumbnail)

        try store.clear()

        XCTAssertEqual(try store.load(), .empty)
        XCTAssertFalse(FileManager.default.fileExists(atPath: store.thumbnailDirectoryURL.path))
    }

    func testSharedWidgetStoreDoesNotRewriteUnchangedHistoryThumbnails() throws {
        let files = FileManager.default
        let root = files.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? files.removeItem(at: root) }
        let store = try SharedWidgetStore(baseURL: root)
        let cards = (0..<33).map { makeWidgetCard(index: $0, day: "2026-09-14", status: "scheduled") }
        let images = Dictionary(uniqueKeysWithValues: cards.enumerated().map {
            ($0.element.candidateToken, Data(repeating: UInt8($0.offset), count: 32_768))
        })
        try store.replaceCards(cards, thumbnails: images)
        let initial = try store.load()
        let oldDate = Date(timeIntervalSince1970: 1_700_000_000)
        for card in cards {
            try files.setAttributes([.modificationDate: oldDate],
                ofItemAtPath: store.thumbnailURL(for: card.candidateToken).path)
        }

        XCTAssertTrue(try store.replaceCards(cards, thumbnails: images))
        let rewritten = try cards.filter {
            try files.attributesOfItem(atPath: store.thumbnailURL(for: $0.candidateToken).path)[.modificationDate] as? Date != oldDate
        }
        XCTAssertEqual(rewritten.count, 0, "Repeated synchronization must not rewrite every historical image")
        XCTAssertEqual(try store.load().dailySelections, initial.dailySelections)
        XCTAssertEqual(try store.load().presentations, initial.presentations)
        for card in cards {
            XCTAssertEqual(try Data(contentsOf: store.thumbnailURL(for: card.candidateToken)), images[card.candidateToken])
        }
        print("JIANWEI_THUMBNAIL_REUSE total=33 rewritten=\(rewritten.count) payloadBytes=1081344")
    }

    func testSharedWidgetStoreOnlyWritesNewChangedOrMissingThumbnails() throws {
        let files = FileManager.default
        let root = files.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? files.removeItem(at: root) }
        let store = try SharedWidgetStore(baseURL: root)
        let cards = (0..<4).map { makeWidgetCard(index: $0, day: "2026-09-14", status: "scheduled") }
        let original = Data([1, 2, 3]), replacement = Data([4, 5, 6])
        try store.replaceCards(Array(cards.prefix(3)), thumbnails: Dictionary(uniqueKeysWithValues:
            cards.prefix(3).map { ($0.candidateToken, original) }))
        let unchangedURL = store.thumbnailURL(for: cards[0].candidateToken)
        let oldDate = Date(timeIntervalSince1970: 1_700_000_000)
        try files.setAttributes([.modificationDate: oldDate], ofItemAtPath: unchangedURL.path)
        try files.removeItem(at: store.thumbnailURL(for: cards[2].candidateToken))
        let orphan = store.thumbnailDirectoryURL.appendingPathComponent("orphan.jpg")
        try original.write(to: orphan)
        let images = [cards[0].candidateToken: original, cards[1].candidateToken: replacement,
                      cards[2].candidateToken: original, cards[3].candidateToken: replacement]

        XCTAssertTrue(try store.replaceCards(cards, thumbnails: images))
        XCTAssertEqual(try files.attributesOfItem(atPath: unchangedURL.path)[.modificationDate] as? Date, oldDate)
        for card in cards {
            XCTAssertEqual(try Data(contentsOf: store.thumbnailURL(for: card.candidateToken)), images[card.candidateToken])
        }
        XCTAssertFalse(files.fileExists(atPath: orphan.path), "Reuse must not skip privacy cleanup")
        XCTAssertEqual(Set(try store.load().cards.map(\.id)), Set(cards.map(\.id)))
    }

    func testSharedWidgetStoreReusesCompressionAcrossStoreInstances() throws {
        let files = FileManager.default
        let root = files.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? files.removeItem(at: root) }
        let store = try SharedWidgetStore(baseURL: root)
        var cards = (0..<33).map { makeWidgetCard(index: $0, day: "2026-09-14", status: "scheduled") }
        var renders = 0
        func synchronize(_ store: SharedWidgetStore) throws {
            let previous = try store.load().thumbnailReceipts
            var images: [UUID: Data] = [:]
            var receipts: [UUID: WidgetThumbnailReceipt] = [:]
            for (index, card) in cards.enumerated() {
                let prepared = try store.prepareThumbnail(
                    source: Data(repeating: UInt8(index), count: 32_768), candidateToken: card.candidateToken,
                    previousReceipt: previous[card.candidateToken], render: { data in
                        renders += 1
                        return Data(data.prefix(1_024))
                    }
                )
                images[card.candidateToken] = prepared.data
                receipts[card.candidateToken] = prepared.receipt
            }
            XCTAssertTrue(try store.replaceCards(cards, thumbnails: images, thumbnailReceipts: receipts))
        }
        try synchronize(store)
        XCTAssertEqual(renders, 33)
        let original = try store.load()
        // Simulate a new app process with no in-memory image cache.
        renders = 0
        try synchronize(SharedWidgetStore(baseURL: root))
        XCTAssertEqual(renders, 0, "Unchanged history must not invoke the image decoder/encoder again")
        XCTAssertEqual(try store.load().dailySelections, original.dailySelections)
        XCTAssertEqual(try store.load().presentations, original.presentations)
        XCTAssertEqual(try store.load().thumbnailReceipts, original.thumbnailReceipts)
        let repeatedRenders = renders
        cards.append(makeWidgetCard(index: 33, day: "2026-09-15", status: "scheduled"))
        renders = 0
        try synchronize(store)
        XCTAssertEqual(renders, 1, "Adding one card must not recompress the 33 historical photos")
        print("JIANWEI_COMPRESSION_REUSE history=33 repeatedRenders=\(repeatedRenders) addedCardRenders=\(renders)")
    }

    func testSharedWidgetStoreRecompressesChangedMissingDamagedAndLegacyImages() throws {
        let files = FileManager.default
        let root = files.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? files.removeItem(at: root) }
        let store = try SharedWidgetStore(baseURL: root)
        let card = makeWidgetCard(index: 0, day: "2026-09-14", status: "scheduled")
        let original = Data([1, 2, 3])
        let baseline = try store.prepareThumbnail(source: original, candidateToken: card.candidateToken,
            previousReceipt: nil, render: { Data($0.reversed()) })
        for scenario in ["changedSource", "missingFile", "damagedFile", "oldRecipe", "noReceipt", "staleOutputReceipt"] {
            try store.replaceCards([card], thumbnails: [card.candidateToken: baseline.data],
                thumbnailReceipts: [card.candidateToken: baseline.receipt])
            var source = original
            var receipt: WidgetThumbnailReceipt? = baseline.receipt
            switch scenario {
            case "changedSource": source = Data([1, 2, 4]) // Same length, different bytes.
            case "missingFile": try files.removeItem(at: store.thumbnailURL(for: card.candidateToken))
            case "damagedFile": try Data([9, 2, 1]).write(to: store.thumbnailURL(for: card.candidateToken), options: .atomic)
            case "oldRecipe":
                receipt = WidgetThumbnailReceipt(sourceDigest: baseline.receipt.sourceDigest,
                    thumbnailDigest: baseline.receipt.thumbnailDigest, renditionVersion: "old-recipe")
            case "noReceipt": receipt = nil
            default:
                receipt = WidgetThumbnailReceipt(sourceDigest: baseline.receipt.sourceDigest,
                    thumbnailDigest: "stale-output", renditionVersion: baseline.receipt.renditionVersion)
            }
            var renders = 0
            let repaired = try store.prepareThumbnail(source: source, candidateToken: card.candidateToken,
                previousReceipt: receipt, render: { data in
                    renders += 1
                    return Data(data.reversed())
                })
            XCTAssertEqual(renders, 1, scenario)
            XCTAssertEqual(repaired.data, Data(source.reversed()), scenario)
            try store.replaceCards([card], thumbnails: [card.candidateToken: repaired.data],
                thumbnailReceipts: [card.candidateToken: repaired.receipt])
            let cached = try store.prepareThumbnail(source: source, candidateToken: card.candidateToken,
                previousReceipt: try store.load().thumbnailReceipts[card.candidateToken], render: { data in
                    renders += 1
                    return data
                })
            XCTAssertEqual(renders, 1, "Repair must restore reuse: \(scenario)")
            XCTAssertEqual(cached.data, repaired.data, scenario)
        }
    }

    func testSharedWidgetStoreIgnoresMalformedOrMissingReceiptsWithoutLosingHistory() throws {
        let files = FileManager.default
        let root = files.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? files.removeItem(at: root) }
        let store = try SharedWidgetStore(baseURL: root)
        let day = "2026-09-14"
        let cards = (0..<3).map { makeWidgetCard(index: $0, day: day, status: "scheduled") }
        try store.replaceCards(cards, thumbnails: [:])
        _ = try store.advance(on: day)
        let original = try store.load()
        XCTAssertFalse(original.presentations.isEmpty)
        let stateURL = root.appendingPathComponent(SharedConstants.widgetStateFilename)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: stateURL)) as? [String: Any])
        for legacy in [true, false] {
            var changed = json
            if legacy { changed.removeValue(forKey: "thumbnailReceipts") }
            else { changed["thumbnailReceipts"] = "damaged optimization metadata" }
            try JSONSerialization.data(withJSONObject: changed).write(to: stateURL, options: .atomic)
            let restored = try store.load()
            XCTAssertEqual(restored.cards, original.cards)
            XCTAssertEqual(restored.dailySelections, original.dailySelections)
            XCTAssertEqual(restored.presentations, original.presentations)
            XCTAssertTrue(restored.thumbnailReceipts.isEmpty)
        }
    }

    func testSharedWidgetStoreDropsReceiptsForDeletedCardsAndUnverifiedReplacements() throws {
        let files = FileManager.default
        let root = files.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? files.removeItem(at: root) }
        let store = try SharedWidgetStore(baseURL: root)
        let card = makeWidgetCard(index: 0, day: "2026-09-14", status: "scheduled")
        let prepared = try store.prepareThumbnail(source: Data([1, 2, 3]), candidateToken: card.candidateToken,
            previousReceipt: nil, render: { $0 })
        let images = [card.candidateToken: prepared.data]
        let receipts = [card.candidateToken: prepared.receipt]
        try store.replaceCards([card], thumbnails: images, thumbnailReceipts: receipts)
        XCTAssertEqual(try store.load().thumbnailReceipts, receipts)
        // Existing callers do not accidentally vouch for a new rendition.
        try store.replaceCards([card], thumbnails: images)
        XCTAssertTrue(try store.load().thumbnailReceipts.isEmpty)
        try store.replaceCards([card], thumbnails: [card.candidateToken: Data([9, 8, 7])], thumbnailReceipts: receipts)
        XCTAssertTrue(try store.load().thumbnailReceipts.isEmpty)
        try store.replaceCards([card], thumbnails: images, thumbnailReceipts: receipts)
        try store.replaceCards([], thumbnails: [:])
        XCTAssertTrue(try store.load().thumbnailReceipts.isEmpty)
        XCTAssertFalse(files.fileExists(atPath: store.thumbnailURL(for: card.candidateToken).path))
        try store.replaceCards([card], thumbnails: images, thumbnailReceipts: receipts)
        try store.clear()
        XCTAssertEqual(try store.load(), .empty)
        XCTAssertFalse(files.fileExists(atPath: store.thumbnailDirectoryURL.path))
    }

    func testSharedWidgetStoreFailedCompressionDoesNotModifyCommittedCache() throws {
        let files = FileManager.default
        let root = files.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? files.removeItem(at: root) }
        let store = try SharedWidgetStore(baseURL: root)
        let card = makeWidgetCard(index: 0, day: "2026-09-14", status: "scheduled")
        let prepared = try store.prepareThumbnail(source: Data([1, 2, 3]), candidateToken: card.candidateToken,
            previousReceipt: nil, render: { $0 })
        try store.replaceCards([card], thumbnails: [card.candidateToken: prepared.data],
            thumbnailReceipts: [card.candidateToken: prepared.receipt])
        let original = try store.load()
        XCTAssertThrowsError(try store.prepareThumbnail(source: Data([3, 2, 1]), candidateToken: card.candidateToken,
            previousReceipt: prepared.receipt, render: { _ in throw CocoaError(.fileReadCorruptFile) }))
        XCTAssertEqual(try store.load(), original)
        XCTAssertEqual(try Data(contentsOf: store.thumbnailURL(for: card.candidateToken)), prepared.data)
    }

    func testSharedWidgetStoreRecoversFromUnreadableStateOnNextSynchronization() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let store = try SharedWidgetStore(baseURL: root)
        let stateURL = root.appendingPathComponent(SharedConstants.widgetStateFilename)
        try Data("not-json".utf8).write(to: stateURL, options: .atomic)

        XCTAssertEqual(try store.load(), .empty)

        let card = makeWidgetCard(index: 0, day: "2026-09-01", status: "scheduled")
        try store.replaceCards([card], thumbnails: [:])
        let rebuilt = try store.load()
        XCTAssertEqual(rebuilt.card(for: "2026-09-01")?.id, card.id)
    }

    func testSharedWidgetStoreRollsBackNewThumbnailWhenStateWriteFails() throws {
        let files = FileManager.default
        let root = files.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let stateURL = root.appendingPathComponent(SharedConstants.widgetStateFilename)
        defer {
            try? files.setAttributes([.immutable: false], ofItemAtPath: stateURL.path)
            try? files.removeItem(at: root)
        }
        let store = try SharedWidgetStore(baseURL: root)
        let existing = makeWidgetCard(index: 0, day: "2026-09-01", status: "scheduled")
        let card = makeWidgetCard(index: 99, day: "2026-09-01", status: "scheduled")
        let originalImage = Data([1, 2]), replacementImage = Data([3, 4])
        let originalReceipt = try store.prepareThumbnail(source: originalImage, candidateToken: existing.candidateToken,
            previousReceipt: nil, render: { $0 }).receipt
        let replacementReceipt = try store.prepareThumbnail(source: replacementImage, candidateToken: existing.candidateToken,
            previousReceipt: nil, render: { $0 }).receipt
        let addedReceipt = try store.prepareThumbnail(source: Data([5, 6]), candidateToken: card.candidateToken,
            previousReceipt: nil, render: { $0 }).receipt
        try store.replaceCards([existing], thumbnails: [existing.candidateToken: originalImage],
            thumbnailReceipts: [existing.candidateToken: originalReceipt])
        let originalState = try store.load()
        // Reading still succeeds; only the later atomic state commit fails.
        try files.setAttributes([.immutable: true], ofItemAtPath: stateURL.path)

        XCTAssertThrowsError(try store.replaceCards(
            [existing, card],
            thumbnails: [existing.candidateToken: replacementImage, card.candidateToken: Data([5, 6])],
            thumbnailReceipts: [existing.candidateToken: replacementReceipt, card.candidateToken: addedReceipt]
        ))
        XCTAssertEqual(try store.load(), originalState)
        XCTAssertEqual(try Data(contentsOf: store.thumbnailURL(for: existing.candidateToken)), originalImage)
        XCTAssertFalse(files.fileExists(atPath: store.thumbnailURL(for: card.candidateToken).path))
    }

    func testSharedWidgetStoreKeepsCommittedThumbnailsWhenOrphanCleanupFails() throws {
        let files = FileManager.default
        let root = files.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let store = try SharedWidgetStore(baseURL: root)
        let orphan = store.thumbnailDirectoryURL.appendingPathComponent("blocked-orphan.jpg")
        defer {
            try? files.setAttributes([.immutable: false], ofItemAtPath: orphan.path)
            try? files.removeItem(at: root)
        }
        let existing = makeWidgetCard(index: 0, day: "2026-09-01", status: "scheduled")
        let added = makeWidgetCard(index: 1, day: "2026-09-02", status: "scheduled")
        let originalImage = Data([1, 2]), updatedImage = Data([3, 4]), addedImage = Data([5, 6])
        try store.replaceCards([existing], thumbnails: [existing.candidateToken: originalImage])
        let existingSelection = try store.load().dailySelections[existing.scheduledDay]
        let receipts = [
            existing.candidateToken: try store.prepareThumbnail(source: updatedImage, candidateToken: existing.candidateToken,
                previousReceipt: nil, render: { $0 }).receipt,
            added.candidateToken: try store.prepareThumbnail(source: addedImage, candidateToken: added.candidateToken,
                previousReceipt: nil, render: { $0 }).receipt
        ]
        try Data([7, 8]).write(to: orphan)
        try files.setAttributes([.immutable: true], ofItemAtPath: orphan.path)

        // Real filesystem failure after atomic state commit, not a mocked write.
        XCTAssertThrowsError(try store.replaceCards(
            [existing, added], thumbnails: [existing.candidateToken: updatedImage, added.candidateToken: addedImage],
            thumbnailReceipts: receipts
        ))
        let committed = try store.load()
        XCTAssertEqual(committed.thumbnailReceipts, receipts)
        XCTAssertEqual(committed.card(for: added.scheduledDay)?.id, added.id)
        XCTAssertEqual(committed.dailySelections[existing.scheduledDay], existingSelection)
        XCTAssertEqual(try Data(contentsOf: store.thumbnailURL(for: existing.candidateToken)), updatedImage)
        XCTAssertEqual(try Data(contentsOf: store.thumbnailURL(for: added.candidateToken)), addedImage)
        XCTAssertTrue(files.fileExists(atPath: orphan.path), "Cleanup failure must not be reported as success")

        try files.setAttributes([.immutable: false], ofItemAtPath: orphan.path)
        XCTAssertTrue(try store.replaceCards(
            [existing, added], thumbnails: [existing.candidateToken: updatedImage, added.candidateToken: addedImage]
        ))
        XCTAssertFalse(files.fileExists(atPath: orphan.path))
        XCTAssertEqual(try store.load().cards, committed.cards)
        XCTAssertEqual(try Data(contentsOf: store.thumbnailURL(for: added.candidateToken)), addedImage)
    }

    func testManagedPhotoRetryKeepsReceiptOutOfPayloadAndUsesTheSameIdempotencyKey() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DirectQwenURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel(); DirectQwenURLProtocol.handler = nil }
        let api = try APIClient(baseURL: URL(string: "https://managed.synthetic.invalid")!, session: session)
        let candidate = UUID()
        let calls = TestAttemptCounter()
        let receipt = "synthetic.signed.receipt"
        DirectQwenURLProtocol.handler = { request in
            let index = calls.incrementAndRead()
            XCTAssertEqual(request.url?.host, "managed.synthetic.invalid")
            XCTAssertEqual(request.url?.path, "/v1/photo-insights")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer device-credential")
            XCTAssertEqual(request.value(forHTTPHeaderField: "X-Jianwei-App-Store-Transaction"), receipt)
            XCTAssertEqual(request.value(forHTTPHeaderField: "Idempotency-Key"), "photo-" + candidate.uuidString.lowercased())
            let body = try requestBodyData(request)
            XCTAssertFalse(String(decoding: body, as: UTF8.self).contains(receipt))
            let payload: [String: Any] = index == 1
                ? ["error": ["code": "subscription_verification_unavailable", "message": "Synthetic outage"]]
                : ["candidateId": candidate.uuidString.lowercased(), "status": "no_insight", "reason": "research_no_fact"]
            return (HTTPURLResponse(url: request.url!, statusCode: index == 1 ? 503 : 200, httpVersion: nil, headerFields: nil)!,
                    try JSONSerialization.data(withJSONObject: payload))
        }
        let card = try await api.photoInsight(bearer: "device-credential", candidateToken: candidate,
            jpeg: makeTestJPEG(), localLabels: [], interests: [], appStoreTransaction: receipt)
        XCTAssertNil(card)
        XCTAssertEqual(calls.value, 2)
    }

    func testManagedSubscriptionRejectionDoesNotRetryOrFallBackToAnotherCredential() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DirectQwenURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel(); DirectQwenURLProtocol.handler = nil }
        let api = try APIClient(baseURL: URL(string: "https://managed.synthetic.invalid")!, session: session)
        let calls = TestAttemptCounter()
        DirectQwenURLProtocol.handler = { request in
            _ = calls.incrementAndRead()
            return (HTTPURLResponse(url: request.url!, statusCode: 402, httpVersion: nil, headerFields: nil)!,
                    Data("{\"error\":{\"code\":\"subscription_invalid\",\"message\":\"Synthetic revoked subscription\"}}".utf8))
        }
        do {
            _ = try await api.photoInsight(bearer: "device-credential", candidateToken: UUID(),
                jpeg: makeTestJPEG(), localLabels: [], interests: [], appStoreTransaction: "synthetic.signed.receipt")
            XCTFail("Revoked subscription must not generate a card")
        } catch { XCTAssertEqual(error as? ProductError, .subscriptionRequired) }
        XCTAssertEqual(calls.value, 1)
    }

    func testBYOKModelKnowledgeCallsOnlyUserProviderWithoutSearchOrPaidModeration() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DirectQwenURLProtocol.self]
        let service = try DirectQwenService(session: URLSession(configuration: configuration))
        let counter = TestAttemptCounter()
        let key = "sk-only_user_12345678901234567890"
        DirectQwenURLProtocol.handler = { request in
            let index = counter.incrementAndRead()
            XCTAssertLessThanOrEqual(index, 2, "Generation must not start an unbounded repair loop")
            XCTAssertEqual(request.url?.host, "dashscope.aliyuncs.com")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer \(key)")
            XCTAssertNil(request.value(forHTTPHeaderField: "X-DashScope-DataInspection"))
            XCTAssertNil(request.value(forHTTPHeaderField: "X-Jianwei-App-Store-Transaction"))
            let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: requestBodyData(request)) as? [String: Any])
            XCTAssertNil(payload["tools"])
            XCTAssertNil(payload["enable_search"])
            XCTAssertEqual(payload["max_tokens"] as? Int, 2_048)
            XCTAssertEqual(payload["model"] as? String, index == 1 ? DirectQwenService.modelKnowledgeWriterModel : DirectQwenService.modelKnowledgeReviewModel)
            let messages = try XCTUnwrap(payload["messages"] as? [[String: Any]])
            let text: String
            if index == 1 {
                text = try XCTUnwrap(messages.first?["content"] as? String)
                XCTAssertFalse(text.contains("base64"), "Knowledge writer receives object names, not unverified visual detail")
            } else {
                let parts = try XCTUnwrap(messages.first?["content"] as? [[String: Any]])
                XCTAssertTrue(parts.contains { $0["type"] as? String == "image_url" })
                text = parts.compactMap { $0["text"] as? String }.joined()
            }
            XCTAssertTrue(text.lowercased().contains("json"),
                          "Qwen JSON mode rejects prompts lacking an explicit JSON instruction")
            let content = index == 1
                ? "{\"candidates\":[{\"subjectIndex\":0,\"title\":\"陀螺为什么转着就不容易倒\",\"body\":\"陀螺转起来后，旋转轴的方向不容易改变。重力让它倾斜时，它常常先绕着竖直方向慢慢摇头，而不是立即倒下。\"}]}"
                : "{\"winnerIndex\":0,\"reviews\":[{\"candidateIndex\":0,\"claimScope\":\"category\",\"decision\":\"accept\",\"reason\":\"合成响应只测试传输契约\",\"generalKnowledge\":true,\"noKnownError\":true,\"photoMatches\":true,\"scopeSupported\":true,\"notDuplicate\":true,\"surprise\":4,\"aha\":4,\"retellability\":4,\"imageConnection\":4}]}"
            let envelope = try JSONSerialization.data(withJSONObject: ["choices": [["finish_reason": "stop", "message": ["content": content]]]])
            return (HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 200, httpVersion: nil, headerFields: nil)!, envelope)
        }
        let draft = try await service.generateModelKnowledge(jpeg: makeTestJPEG(), subjects: [modelKnowledgeEntity()], recentCards: [], apiKey: key)
        let card = try XCTUnwrap(draft).makeCard(candidateToken: UUID(), capturedAt: nil)
        XCTAssertEqual(counter.value, 2)
        XCTAssertEqual(card.topicID, "spinning_top")
        XCTAssertTrue(card.sources.isEmpty)
        XCTAssertEqual(card.effectiveEvidenceKind, .modelKnowledge)
    }

    func testBYOKUnfinishedEmptyKnowledgeIsRetryableNotNoInsight() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DirectQwenURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel(); DirectQwenURLProtocol.handler = nil }
        let service = try DirectQwenService(session: session)
        for reason in ["length", "tool_calls", "unknown", "null", "missing", "wrong_type", "stop"] {
            let counter = TestAttemptCounter()
            DirectQwenURLProtocol.handler = { request in
                _ = counter.incrementAndRead()
                var choice: [String: Any] = ["message": ["content": "{\"candidates\":[]}"]]
                switch reason {
                case "missing": break
                case "null": choice["finish_reason"] = NSNull()
                case "wrong_type": choice["finish_reason"] = 42
                default: choice["finish_reason"] = reason
                }
                return (HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 200,
                                        httpVersion: nil, headerFields: nil)!,
                        try JSONSerialization.data(withJSONObject: ["choices": [choice]]))
            }
            do {
                let draft = try await service.generateModelKnowledge(jpeg: makeTestJPEG(),
                    subjects: [modelKnowledgeEntity()], recentCards: [], apiKey: "sk-test_12345678901234567890")
                XCTAssertEqual(reason, "stop", "Unfinished JSON must not become a terminal no-insight result")
                XCTAssertNil(draft)
            } catch let error as ProductError {
                XCTAssertNotEqual(reason, "stop", "A completed empty answer is a valid no-insight result")
                XCTAssertEqual(error, .invalidServerResponse)
                XCTAssertFalse(error.requiresModelAccessAction)
                XCTAssertTrue(BackgroundDiscoveryController.shouldReschedule(automaticDiscoveryEnabled: true, accessError: error))
            }
            XCTAssertEqual(counter.value, 1, "Do not add automatic paid retries or a reviewer call")
        }
    }

    func testBYOKUnfinishedPositiveReviewCannotPublish() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DirectQwenURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel(); DirectQwenURLProtocol.handler = nil }
        let service = try DirectQwenService(session: session)
        let counter = TestAttemptCounter()
        DirectQwenURLProtocol.handler = { request in
            let call = counter.incrementAndRead()
            let content: [String: Any] = call == 1
                ? ["candidates": [["subjectIndex": 0, "title": "这是一条合成测试知识",
                                    "body": "这段合成正文只验证未完成的模型审核不能发布，不代表真实知识或实际模型评测结果。"]]]
                : ["winnerIndex": 0, "reviews": [Self.modelKnowledgeReview(index: 0, accepted: true)]]
            return (HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 200,
                                    httpVersion: nil, headerFields: nil)!,
                    try JSONSerialization.data(withJSONObject: ["choices": [[
                        "finish_reason": call == 1 ? "stop" : "length",
                        "message": ["content": String(decoding: try JSONSerialization.data(withJSONObject: content), as: UTF8.self)]
                    ]]]))
        }
        do {
            _ = try await service.generateModelKnowledge(jpeg: makeTestJPEG(), subjects: [modelKnowledgeEntity()],
                recentCards: [], apiKey: "sk-test_12345678901234567890")
            XCTFail("An unfinished positive review is not publishable evidence")
        } catch { XCTAssertEqual(error as? ProductError, .invalidServerResponse) }
        XCTAssertEqual(counter.value, 2)
    }

    func testBYOKProviderAccountFailuresDoNotBlameKeyFormatOrRetryEveryPhoto() async throws {
        let cases: [(Int, String, String)] = [
            (400, "Arrearage", "余额"),
            (403, "Arrearage", "余额"),
            (403, "AllocationQuota.FreeTierOnly", "免费额度"),
            (403, "AccessDenied.Unpurchased", "权限"),
            (403, "Model.AccessDenied", "权限"),
            (401, "InvalidApiKey", "没有接受")
        ]
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DirectQwenURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel(); DirectQwenURLProtocol.handler = nil }
        let service = try DirectQwenService(session: session)
        for (status, code, hint) in cases {
            let counter = TestAttemptCounter()
            DirectQwenURLProtocol.handler = { request in
                _ = counter.incrementAndRead()
                let body = try JSONSerialization.data(withJSONObject: ["error": ["code": code,
                    "message": "sensitive provider diagnostics sk-do-not-display"]])
                return (HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: status,
                                        httpVersion: nil, headerFields: nil)!, body)
            }
            do {
                _ = try await service.detect(jpeg: makeTestJPEG(), localLabels: [],
                    preferredTopics: [], apiKey: "sk-test_12345678901234567890")
                XCTFail("Expected an account error")
            } catch let error as ProductError {
                XCTAssertNotEqual(error, .invalidAPIKey, "Provider rejection is not local format validation")
                XCTAssertTrue(error.requiresModelAccessAction)
                XCTAssertTrue(error.localizedDescription.contains(hint), error.localizedDescription)
                XCTAssertFalse(error.localizedDescription.contains("sk-do-not-display"))
                XCTAssertFalse(BackgroundDiscoveryController.shouldReschedule(automaticDiscoveryEnabled: true, accessError: error))
            }
            XCTAssertEqual(counter.value, 1, "No automatic recharge, extra request or platform credential fallback")
        }
    }

    func testBYOKTimeoutKeepsNetworkCauseAndRemainsRetryable() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DirectQwenURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel(); DirectQwenURLProtocol.handler = nil }
        let service = try DirectQwenService(session: session)
        DirectQwenURLProtocol.handler = { _ in throw URLError(.timedOut) }
        do {
            _ = try await service.detect(jpeg: makeTestJPEG(), localLabels: [],
                preferredTopics: [], apiKey: "sk-test_12345678901234567890")
            XCTFail("Expected timeout")
        } catch let error as ProductError {
            XCTAssertEqual(error, .requestFailed(URLError.timedOut.rawValue))
            XCTAssertTrue(error.localizedDescription.contains("超时"))
            XCTAssertFalse(error.requiresModelAccessAction)
            XCTAssertTrue(BackgroundDiscoveryController.shouldReschedule(automaticDiscoveryEnabled: true, accessError: error))
        }
    }

    func testTransientProviderMessagesDoNotAskForKeysOrShowRawCodes() {
        for (code, hint) in [(429, "限流"), (408, "超时"), (URLError.notConnectedToInternet.rawValue, "网络")] {
            let error = ProductError.requestFailed(code)
            XCTAssertFalse(error.requiresModelAccessAction)
            XCTAssertTrue(error.localizedDescription.contains(hint))
            XCTAssertFalse(error.localizedDescription.contains("（\(code)）"))
        }
    }

    func testBYOKCanSelectThirdKnowledgeWhenFirstTwoFailWithoutAnotherGenerationCall() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DirectQwenURLProtocol.self]
        let service = try DirectQwenService(session: URLSession(configuration: configuration))
        let counter = TestAttemptCounter()
        let candidates: [[String: Any]] = (0..<3).map { index in
            ["subjectIndex": 0, "title": "知识候选测试标题第\(index)条",
             "body": "第\(index)条合成知识正文用于验证前两条失败时仍能选择第三条，不代表真实事实或内容质量。"]
        }
        let generation = String(decoding: try JSONSerialization.data(withJSONObject: ["candidates": candidates]), as: UTF8.self)
        DirectQwenURLProtocol.handler = { request in
            let call = counter.incrementAndRead()
            XCTAssertLessThanOrEqual(call, 2)
            let response: [String: Any] = [
                "winnerIndex": NSNull(), "reviews": [Self.modelKnowledgeReview(index: 2, accepted: true),
                            Self.modelKnowledgeReview(index: 0, accepted: false),
                            Self.modelKnowledgeReview(index: 1, accepted: false)]
            ]
            let content = call == 1 ? generation : String(decoding: try JSONSerialization.data(
                withJSONObject: response), as: UTF8.self)
            return (HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 200, httpVersion: nil, headerFields: nil)!,
                    try JSONSerialization.data(withJSONObject: ["choices": [["finish_reason": "stop", "message": ["content": content]]]]))
        }
        let draft = try await service.generateModelKnowledge(jpeg: makeTestJPEG(), subjects: [modelKnowledgeEntity()],
            recentCards: [], apiKey: "sk-only_user_12345678901234567890")
        XCTAssertEqual(draft?.title, candidates[2]["title"] as? String)
        XCTAssertEqual(counter.value, 2)
    }

    func testBYOKDeduplicatesDraftsBeforeAssigningReviewIndices() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DirectQwenURLProtocol.self]
        let service = try DirectQwenService(session: URLSession(configuration: configuration))
        let counter = TestAttemptCounter()
        let oldBody = "这是一条已经展示过的合成知识，测试不能因为首项重复而将其余候选一起丢弃。"
        let newBody = "这是一条尚未展示过的合成知识，测试过滤之后的索引仍能准确对应原来的候选。"
        let oldCard = ModelKnowledgeDraft(entity: modelKnowledgeEntity(), title: "之前已经展示过的知识", body: oldBody)
            .makeCard(candidateToken: UUID(), capturedAt: nil)
        DirectQwenURLProtocol.handler = { request in
            let call = counter.incrementAndRead()
            XCTAssertLessThanOrEqual(call, 2)
            let response: [String: Any]
            if call == 1 {
                response = ["candidates": [
                    ["subjectIndex": 0, "title": "之前已经展示过的知识", "body": oldBody],
                    ["subjectIndex": 0, "title": "这次应该被展示的知识", "body": newBody],
                    ["subjectIndex": 0, "title": "换标题不能变成新的知识", "body": newBody]
                ]]
            } else {
                let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: requestBodyData(request)) as? [String: Any])
                let messages = try XCTUnwrap(payload["messages"] as? [[String: Any]])
                let parts = try XCTUnwrap(messages.first?["content"] as? [[String: Any]])
                let prompt = parts.compactMap { $0["text"] as? String }.joined()
                let candidateJSON = try XCTUnwrap(prompt.components(separatedBy: "候选：").last?
                    .components(separatedBy: "\n最近卡片").first?.data(using: .utf8))
                let reviewed = try XCTUnwrap(JSONSerialization.jsonObject(with: candidateJSON) as? [[String: Any]])
                XCTAssertEqual(reviewed.count, 1)
                XCTAssertEqual(reviewed.first?["candidateIndex"] as? Int, 0)
                XCTAssertEqual(reviewed.first?["body"] as? String, newBody)
                response = ["winnerIndex": NSNull(), "reviews": [Self.modelKnowledgeReview(index: 0, accepted: true)]]
            }
            let content = String(decoding: try JSONSerialization.data(withJSONObject: response), as: UTF8.self)
            return (HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 200, httpVersion: nil, headerFields: nil)!,
                    try JSONSerialization.data(withJSONObject: ["choices": [["finish_reason": "stop", "message": ["content": content]]]]))
        }
        let draft = try await service.generateModelKnowledge(jpeg: makeTestJPEG(), subjects: [modelKnowledgeEntity()],
            recentCards: [oldCard], apiKey: "sk-only_user_12345678901234567890")
        XCTAssertEqual(draft?.body, newBody)
        XCTAssertEqual(counter.value, 2)
    }

    func testBYOKOlderRelatedKnowledgeReachesWriterAndReviewerWithoutAnotherCall() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DirectQwenURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel(); DirectQwenURLProtocol.handler = nil }
        let service = try DirectQwenService(session: session)
        let counter = TestAttemptCounter()
        let entity = DirectDetectedEntity(canonicalTopicID: "paper_clip", displayName: "回形针",
                                          confidence: 0.98, boundingBox: nil, alternatives: [], sensitiveFlags: [])
        // Verbatim web-019 outputs from default-baseline4 / fact-first4. These
        // failed quality trials are repetition fixtures, not verified facts.
        let oldBody = "回形针通过扭转金属丝形成内外两个环。使用时，外环受力变形产生弹力，将纸张压在內环与底座之间。这种纯机械结构无需胶水即可反复拆装。"
        let repeatedBody = "回形针靠金属丝的弹性形变夹住纸张。外力撤去后，金属试图恢复原状，产生摩擦力固定纸页。这是一种无需穿孔或胶水的可逆物理连接方式。"
        let newBody = "这是另一条合成候选，只验证编辑拒绝旧知识之后仍能选择同图其他候选，不用于声称真实知识质量达标。"
        let oldCard = ModelKnowledgeDraft(entity: entity, title: "双环结构利用金属弹性夹纸", body: oldBody)
            .makeCard(candidateToken: UUID(), capturedAt: Date(timeIntervalSince1970: 0), now: Date(timeIntervalSince1970: 1))
        let unrelated = (0..<25).map { index in
            ModelKnowledgeDraft(entity: modelKnowledgeEntity(), title: "较近的无关历史第\(index)条",
                                body: "第\(index)条不相关合成历史，这些较新的记录不能把旧的回形针知识挤出上下文。")
                .makeCard(candidateToken: UUID(), capturedAt: nil, now: Date(timeIntervalSince1970: Double(index + 2)))
        }
        let excludedID = oldCard.id.uuidString.lowercased()
        let excludedPhotoID = oldCard.candidateToken.uuidString.lowercased()
        let excludedContext = oldCard.personalContext
        DirectQwenURLProtocol.handler = { request in
            let call = counter.incrementAndRead()
            XCTAssertLessThanOrEqual(call, 2, "History retrieval must not add a model or search request")
            XCTAssertEqual(request.url?.host, "dashscope.aliyuncs.com")
            let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: requestBodyData(request)) as? [String: Any])
            XCTAssertNil(payload["tools"])
            XCTAssertNil(payload["enable_search"])
            let messages = try XCTUnwrap(payload["messages"] as? [[String: Any]])
            let prompt: String
            if call == 1 {
                prompt = try XCTUnwrap(messages.first?["content"] as? String)
            } else {
                let parts = try XCTUnwrap(messages.first?["content"] as? [[String: Any]])
                prompt = parts.compactMap { $0["text"] as? String }.joined()
            }
            let contextJSON = call == 1 ? prompt.components(separatedBy: "\n").last
                : prompt.components(separatedBy: "最近卡片及物件：").last
            let contextData = Data(try XCTUnwrap(contextJSON).utf8)
            let context = try XCTUnwrap(JSONSerialization.jsonObject(with: contextData) as? [String: Any])
            let history = try XCTUnwrap(context["recentCards"] as? [[String: String]])
            XCTAssertEqual(history.count, 20, "Do not solve retrieval by sending the whole archive")
            XCTAssertEqual(history.first?["body"], oldBody,
                           "Same-topic knowledge older than 20 unrelated cards must reach both stages")
            XCTAssertTrue(history.allSatisfy { Set($0.keys) == ["object", "title", "body"] })
            XCTAssertFalse(prompt.lowercased().contains(excludedID))
            XCTAssertFalse(prompt.lowercased().contains(excludedPhotoID))
            XCTAssertFalse(prompt.contains(excludedContext))
            let response: [String: Any]
            if call == 1 {
                response = ["candidates": [
                    ["subjectIndex": 0, "title": "回形针靠弹性形变夹住纸张", "body": repeatedBody],
                    ["subjectIndex": 0, "title": "另一条没有讲过的合成知识", "body": newBody]
                ]]
            } else {
                var repeated = Self.modelKnowledgeReview(index: 0, accepted: false)
                repeated["notDuplicate"] = false
                response = ["winnerIndex": 1, "reviews": [repeated, Self.modelKnowledgeReview(index: 1, accepted: true)]]
            }
            let content = String(decoding: try JSONSerialization.data(withJSONObject: response), as: UTF8.self)
            return (HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 200, httpVersion: nil, headerFields: nil)!,
                    try JSONSerialization.data(withJSONObject: ["choices": [["finish_reason": "stop", "message": ["content": content]]]]))
        }
        let draft = try await service.generateModelKnowledge(jpeg: makeTestJPEG(), subjects: [entity],
            recentCards: unrelated + [oldCard], apiKey: "sk-only_user_12345678901234567890")
        XCTAssertEqual(draft?.body, newBody, "A rejected paraphrase must not discard another eligible candidate")
        XCTAssertEqual(counter.value, 2)
    }

    func testBYOKHistoryBalancesObjectsAndDeduplicatesBeforeApplyingContextLimit() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DirectQwenURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel(); DirectQwenURLProtocol.handler = nil }
        let service = try DirectQwenService(session: session)
        let subjects = (0..<3).map { index in
            DirectDetectedEntity(canonicalTopicID: "object_\(index)", displayName: "物件\(index)",
                                 confidence: 0.9, boundingBox: nil, alternatives: [], sensitiveFlags: [])
        }
        func historyCard(_ entity: DirectDetectedEntity, _ body: String, _ time: Int) -> KnowledgeCard {
            ModelKnowledgeDraft(entity: entity, title: String(repeating: "长", count: 50), body: body)
                .makeCard(candidateToken: UUID(), capturedAt: nil, now: Date(timeIntervalSince1970: Double(time)))
        }
        // One subject has many newer facts; a different legacy routing ID can
        // still match an exact object name. Neither needs fuzzy semantic claims.
        let renamed = DirectDetectedEntity(canonicalTopicID: "legacy-other", displayName: "物件2",
                                            confidence: 0.9, boundingBox: nil, alternatives: [], sensitiveFlags: [])
        let caseVariant = DirectDetectedEntity(canonicalTopicID: " OBJECT_1 ", displayName: "别名",
                                                confidence: 0.9, boundingBox: nil, alternatives: [], sensitiveFlags: [])
        let firstBody = "物件0最近的合成知识" + String(repeating: "长", count: 130)
        let latest = historyCard(subjects[0], firstBody, 100)
        var cards = (0..<25).map { historyCard(subjects[0], "物件0的第\($0)条不同历史正文", $0 + 10) }
        cards += (0..<25).map { _ in historyCard(subjects[0], firstBody, 100) }
        cards += [historyCard(caseVariant, "物件1很久之前的合成知识", 2), historyCard(renamed, "物件2更早的合成知识", 1)]
        let count = TestAttemptCounter()
        DirectQwenURLProtocol.handler = { request in
            _ = count.incrementAndRead()
            let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: requestBodyData(request)) as? [String: Any])
            let messages = try XCTUnwrap(payload["messages"] as? [[String: Any]])
            let prompt = try XCTUnwrap(messages.first?["content"] as? String)
            let context = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(
                try XCTUnwrap(prompt.components(separatedBy: "\n").last).utf8)) as? [String: Any])
            let history = try XCTUnwrap(context["recentCards"] as? [[String: String]])
            XCTAssertEqual(history.count, 20)
            XCTAssertEqual(history.prefix(3).compactMap { $0["body"] }, [String(firstBody.prefix(120)),
                "物件1很久之前的合成知识", "物件2更早的合成知识"])
            XCTAssertEqual(Set(history.compactMap { $0["body"] }).count, 20, "Duplicate records must not consume context slots")
            XCTAssertTrue(history.allSatisfy { ($0["title"]?.count ?? 0) <= 40 && ($0["body"]?.count ?? 0) <= 120 })
            let content = "{\"candidates\":[]}"
            return (HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 200, httpVersion: nil, headerFields: nil)!,
                    try JSONSerialization.data(withJSONObject: ["choices": [["finish_reason": "stop", "message": ["content": content]]]]))
        }
        let draft = try await service.generateModelKnowledge(jpeg: makeTestJPEG(), subjects: subjects,
            recentCards: cards + [latest], apiKey: "sk-only_user_12345678901234567890")
        XCTAssertNil(draft)
        XCTAssertEqual(count.value, 1)
    }

    func testBYOKNeverSelectsUnreviewedRejectedOrMalformedKnowledge() throws {
        let accepted = Self.modelKnowledgeReview(index: 0, accepted: true)
        let rejected = Self.modelKnowledgeReview(index: 1, accepted: false)
        XCTAssertEqual(try DirectQwenService.parseModelKnowledgeSelection(
            ["winnerIndex": NSNull(), "reviews": [accepted, rejected]], candidateCount: 2), 0)
        for malformed in [
            ["winnerIndex": NSNull(), "reviews": [accepted]],
            ["winnerIndex": NSNull(), "reviews": [accepted, accepted]],
            ["winnerIndex": NSNull(), "reviews": [accepted, rejected], "extra": true]
        ] as [[String: Any]] {
            XCTAssertThrowsError(try DirectQwenService.parseModelKnowledgeSelection(malformed, candidateCount: 2))
        }
        for (key, value) in [
            ("candidateIndex", true), ("candidateIndex", -1), ("candidateIndex", 2),
            ("noKnownError", "false"), ("aha", true), ("aha", 0), ("aha", 4.5),
            ("decision", "maybe")
        ] as [(String, Any)] {
            var malformedRejected = rejected
            malformedRejected[key] = value
            XCTAssertThrowsError(try DirectQwenService.parseModelKnowledgeSelection(
                ["winnerIndex": NSNull(), "reviews": [accepted, malformedRejected]], candidateCount: 2),
                "Malformed non-winning entries must not be silently ignored")
        }
        for badWinner in [true, -1, 2, "0"] as [Any] {
            XCTAssertThrowsError(try DirectQwenService.parseModelKnowledgeSelection(
                ["reviews": [accepted, rejected], "winnerIndex": badWinner], candidateCount: 2))
        }
        XCTAssertThrowsError(try DirectQwenService.parseModelKnowledgeSelection(
            ["reviews": [accepted, rejected]], candidateCount: 2))
        var verboseReview = accepted
        verboseReview["reason"] = String(repeating: "解释", count: 80)
        XCTAssertEqual(try DirectQwenService.parseModelKnowledgeSelection(
            ["winnerIndex": NSNull(), "reviews": [verboseReview]], candidateCount: 1), 0,
            "An internal explanation longer than the prompt target must not discard a valid card")
        verboseReview["reason"] = String(repeating: "解释", count: 300)
        XCTAssertThrowsError(try DirectQwenService.parseModelKnowledgeSelection(
            ["winnerIndex": NSNull(), "reviews": [verboseReview]], candidateCount: 1))
        XCTAssertNil(try DirectQwenService.parseModelKnowledgeSelection(
            ["winnerIndex": NSNull(), "reviews": [Self.modelKnowledgeReview(index: 0, accepted: false)]], candidateCount: 1))
        for count in [0, 4] {
            XCTAssertThrowsError(try DirectQwenService.parseModelKnowledgeSelection(
                ["winnerIndex": NSNull(), "reviews": [accepted]], candidateCount: count))
        }
        XCTAssertTrue(try DirectQwenService.parseModelKnowledgeCandidates(["candidates": []], subjects: [modelKnowledgeEntity()]).isEmpty)
        let malformed: [String: Any] = ["subjectIndex": 0, "title": "这是结构测试标题",
                                       "body": String(repeating: "结构测试", count: 10), "sources": []]
        XCTAssertThrowsError(try DirectQwenService.parseModelKnowledgeCandidates(
            ["candidates": [malformed]], subjects: [modelKnowledgeEntity()]))
        var valid = malformed
        valid.removeValue(forKey: "sources")
        XCTAssertThrowsError(try DirectQwenService.parseModelKnowledgeCandidates(
            ["candidates": Array(repeating: valid, count: 4)], subjects: [modelKnowledgeEntity()]))
    }

    private static func modelKnowledgeReview(index: Int, accepted: Bool) -> [String: Any] {
        ["candidateIndex": index, "claimScope": "category", "decision": accepted ? "accept" : "reject",
         "reason": "合成响应只验证选择与拒绝行为",
         "generalKnowledge": true, "noKnownError": accepted, "photoMatches": true, "scopeSupported": true,
         "notDuplicate": true, "surprise": 4, "aha": 4, "retellability": 4, "imageConnection": 4]
    }

    func testBYOKReviewRequiresExplicitScopeWithoutRelaxingPhotoAndFactGates() throws {
        for scope in ["category", "picturedItem"] {
            var review = Self.modelKnowledgeReview(index: 0, accepted: true)
            review["claimScope"] = scope
            XCTAssertEqual(try DirectQwenService.parseModelKnowledgeSelection(
                ["winnerIndex": NSNull(), "reviews": [review]], candidateCount: 1), 0)
            for flag in ["photoMatches", "scopeSupported", "noKnownError", "generalKnowledge", "notDuplicate"] {
                var failed = review
                failed[flag] = false
                XCTAssertNil(try DirectQwenService.parseModelKnowledgeSelection(
                    ["winnerIndex": NSNull(), "reviews": [failed]], candidateCount: 1))
            }
        }
        for scope in [NSNull(), true, "unknown", 0] as [Any] {
            var review = Self.modelKnowledgeReview(index: 0, accepted: true)
            review["claimScope"] = scope
            XCTAssertThrowsError(try DirectQwenService.parseModelKnowledgeSelection(
                ["winnerIndex": NSNull(), "reviews": [review]], candidateCount: 1))
        }
        var missing = Self.modelKnowledgeReview(index: 0, accepted: true)
        missing.removeValue(forKey: "claimScope")
        XCTAssertThrowsError(try DirectQwenService.parseModelKnowledgeSelection(
            ["winnerIndex": NSNull(), "reviews": [missing]], candidateCount: 1))
    }

    func testBYOKRepairsContradictorySummaryWithoutOverridingValidEditorialChoice() throws {
        // Reproduces the observed score pattern, not the model's factual correctness:
        // a banal first draft, an eligible second draft, and an erroneous third.
        var banal = Self.modelKnowledgeReview(index: 0, accepted: true)
        banal["surprise"] = 2
        banal["imageConnection"] = 5
        var eligible = Self.modelKnowledgeReview(index: 1, accepted: true)
        eligible["decision"] = "reject" // Redundant summary contradicted all mandatory flags in the live case.
        eligible["surprise"] = 3
        eligible["imageConnection"] = 3
        var erroneous = Self.modelKnowledgeReview(index: 2, accepted: false)
        for field in ["surprise", "aha", "retellability", "imageConnection"] { erroneous[field] = 5 }
        for reviews in [[banal, eligible, erroneous], [erroneous, eligible, banal]] {
            XCTAssertEqual(try DirectQwenService.parseModelKnowledgeSelection(
                ["winnerIndex": 0, "reviews": reviews], candidateCount: 3), 1)
        }
        let first = Self.modelKnowledgeReview(index: 0, accepted: true)
        var second = Self.modelKnowledgeReview(index: 1, accepted: true)
        XCTAssertEqual(try DirectQwenService.parseModelKnowledgeSelection(
            ["winnerIndex": NSNull(), "reviews": [second, first]], candidateCount: 2), 0, "Ties use original candidate order")
        second["surprise"] = 5
        XCTAssertEqual(try DirectQwenService.parseModelKnowledgeSelection(
            ["winnerIndex": NSNull(), "reviews": [first, second]], candidateCount: 2), 1)
        XCTAssertEqual(try DirectQwenService.parseModelKnowledgeSelection(
            ["winnerIndex": 0, "reviews": [first, second]], candidateCount: 2), 0,
            "A valid model choice must not change merely because another eligible item scored higher")
        for (field, below) in [("surprise", 2), ("aha", 3), ("retellability", 3), ("imageConnection", 2)] {
            var failed = second
            failed[field] = below
            XCTAssertEqual(try DirectQwenService.parseModelKnowledgeSelection(
                ["winnerIndex": NSNull(), "reviews": [failed, first]], candidateCount: 2), 0, "Total score cannot override any threshold")
        }
    }

    func testBYOKRejectsInventedSourceFieldsAndMalformedKnowledgeReviews() throws {
        let valid: [String: Any] = ["decision": "publish", "subjectIndex": 0,
                                   "title": "测试卡片的有效标题", "body": String(repeating: "仅供结构验证的测试文字", count: 4)]
        var withSource = valid
        withSource["sources"] = ["https://invented.invalid"]
        XCTAssertThrowsError(try DirectQwenService.parseModelKnowledge(withSource, subjects: [modelKnowledgeEntity()]))
        var withWrongObject = valid
        withWrongObject["subjectIndex"] = 1
        XCTAssertThrowsError(try DirectQwenService.parseModelKnowledge(withWrongObject, subjects: [modelKnowledgeEntity()]))
        var withClaim = valid
        withClaim["title"] = "已联网查证的测试标题"
        XCTAssertThrowsError(try DirectQwenService.parseModelKnowledge(withClaim, subjects: [modelKnowledgeEntity()]))
        let skip: [String: Any] = ["decision": "skip", "subjectIndex": NSNull(), "title": NSNull(), "body": NSNull()]
        XCTAssertNil(try DirectQwenService.parseModelKnowledge(skip, subjects: [modelKnowledgeEntity()]))
        var review: [String: Any] = ["decision": "accept", "generalKnowledge": true, "noKnownError": true,
                                    "photoMatches": true, "scopeSupported": true, "notDuplicate": true,
                                    "surprise": 4, "aha": 4, "retellability": 4, "imageConnection": 4]
        XCTAssertTrue(try DirectQwenService.parseModelKnowledgeReview(review))
        review["photoMatches"] = false
        XCTAssertFalse(try DirectQwenService.parseModelKnowledgeReview(review))
        review["photoMatches"] = true
        review["aha"] = 3
        XCTAssertFalse(try DirectQwenService.parseModelKnowledgeReview(review))
        review["aha"] = true
        XCTAssertThrowsError(try DirectQwenService.parseModelKnowledgeReview(review))
        review["aha"] = 4
        review["generalKnowledge"] = 1
        XCTAssertThrowsError(try DirectQwenService.parseModelKnowledgeReview(review))
    }

    func testBYOKChecksAccessBeforeSecondPhotoCall() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DirectQwenURLProtocol.self]
        let service = try DirectQwenService(session: URLSession(configuration: configuration))
        let calls = TestAttemptCounter()
        let checks = TestAttemptCounter()
        DirectQwenURLProtocol.handler = { request in
            _ = calls.incrementAndRead()
            let content = "{\"candidates\":[{\"subjectIndex\":0,\"title\":\"这是结构测试的标题\",\"body\":\"这里只验证权限撤销之后不能继续发送照片，不代表模型的真实产出效果或真实事实验证。\"}]}"
            return (HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 200, httpVersion: nil, headerFields: nil)!,
                    try JSONSerialization.data(withJSONObject: ["choices": [["finish_reason": "stop", "message": ["content": content]]]]))
        }
        do {
            _ = try await service.generateModelKnowledge(jpeg: makeTestJPEG(), subjects: [modelKnowledgeEntity()], recentCards: [],
                                                        apiKey: "sk-only_user_12345678901234567890", checkAccess: {
                if checks.incrementAndRead() > 1 { throw ProductError.permissionDenied }
            })
            XCTFail("Revocation should stop the second request")
        } catch { XCTAssertEqual(error as? ProductError, .permissionDenied) }
        XCTAssertEqual(calls.value, 1)
    }

    func testModelOnlyCardSurvivesPersistencePresentationAndSevenDayWidgetFallback() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let repository = try LocalRepository(rootURL: root)
        let start = ISO8601DateFormatter().date(from: "2026-09-07T04:00:00Z")!
        let draft = ModelKnowledgeDraft(entity: modelKnowledgeEntity(), title: "这是来源状态测试", body: "仅用于验证状态流转的合成卡片，不代表真实模型效果。")
        var cards: [KnowledgeCard] = []
        for offset in 0..<7 {
            let date = start.addingTimeInterval(Double(offset) * 86_400)
            let card = draft.makeCard(candidateToken: UUID(), capturedAt: nil, now: date)
                .withPresentation(status: "scheduled", scheduledDay: ChinaDay.string(from: date))
                .withPersonalContext("合成测试")
            cards.append(card)
            try await repository.upsert(card: card, sanitizedJPEG: nil)
        }
        let reopened = try LocalRepository(rootURL: root)
        let saved = await reopened.snapshot()
        XCTAssertEqual(saved.cards.count, 7)
        XCTAssertTrue(saved.cards.allSatisfy { $0.evidenceKind == .modelKnowledge && $0.sources.isEmpty })
        var queue = WidgetQueueState.empty
        queue.mergeCards(try cards.map { try XCTUnwrap($0.widgetSnapshot(isManualImport: false)) }, now: start)
        queue = try JSONDecoder().decode(WidgetQueueState.self, from: JSONEncoder().encode(queue))
        for offset in 0...8 {
            let date = start.addingTimeInterval(Double(offset) * 86_400)
            let shown = CurrentCardResolver.resolve(cards: saved.cards, widgetState: queue, activeCardID: nil, now: date)
            XCTAssertEqual(shown?.id, cards[min(offset, 6)].id)
            XCTAssertEqual(shown?.effectiveEvidenceKind, .modelKnowledge)
        }
        XCTAssertEqual(CardHistoryResolver.resolve(cards: saved.cards, presentations: [], now: start.addingTimeInterval(8 * 86_400)).count, 7)
    }

    func testLegacyCardAndWidgetDoNotAcquireFalseVerifiedBadges() throws {
        let old = makeCard(topic: "legacy")
        var json = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(old)) as? [String: Any])
        json.removeValue(forKey: "evidenceKind")
        let decoded = try JSONDecoder().decode(KnowledgeCard.self, from: JSONSerialization.data(withJSONObject: json))
        XCTAssertEqual(decoded.effectiveEvidenceKind, .referenced)
        let widget = try XCTUnwrap(decoded.widgetSnapshot(isManualImport: false))
        var widgetJSON = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(widget)) as? [String: Any])
        widgetJSON.removeValue(forKey: "evidenceKind")
        XCTAssertEqual(try JSONDecoder().decode(WidgetCardSnapshot.self, from: JSONSerialization.data(withJSONObject: widgetJSON)).effectiveEvidenceKind, .referenced)
        json["sources"] = []
        json["evidenceKind"] = "webVerified"
        let inconsistent = try JSONDecoder().decode(KnowledgeCard.self, from: JSONSerialization.data(withJSONObject: json))
        XCTAssertEqual(inconsistent.effectiveEvidenceKind, .modelKnowledge)
        XCTAssertEqual(inconsistent.widgetSnapshot(isManualImport: false)?.effectiveEvidenceKind, .modelKnowledge)
    }

    @MainActor
    func testModelKnowledgeCardVisualAttachmentsAtCompactWidth() throws {
        // Render the actual card view in the simulator without bootstrapping
        // discovery, reading a personal photo, or making model requests.
        let model = AppModel(environment: try AppEnvironment.live(), launchArguments: [])
        let card = ModelKnowledgeDraft(entity: modelKnowledgeEntity(), title: "陀螺为什么转着就不容易倒",
            body: "陀螺转起来后，旋转轴的方向不容易改变。重力让它倾斜时，它常常先绕着竖直方向慢慢摇头，而不是立即倒下。")
            .makeCard(candidateToken: UUID(), capturedAt: nil)
        for scheme in [ColorScheme.light, .dark] {
            let renderer = ImageRenderer(content: KnowledgeCardView(card: card)
                .environment(model)
                .frame(width: 320)
                .padding(12)
                .background(JianweiBrand.paper)
                .environment(\.colorScheme, scheme))
            renderer.scale = 2
            let rendered = try XCTUnwrap(renderer.uiImage)
            XCTAssertEqual(rendered.size.width, 344, accuracy: 0.5)
            let attachment = XCTAttachment(image: rendered)
            attachment.name = scheme == .light ? "byok-card-compact-light" : "byok-card-compact-dark"
            attachment.lifetime = .keepAlways
            add(attachment)
        }
    }

    private func modelKnowledgeEntity() -> DirectDetectedEntity {
        DirectDetectedEntity(canonicalTopicID: "spinning_top", displayName: "陀螺", confidence: 0.94,
                             boundingBox: nil, alternatives: [], sensitiveFlags: [])
    }

    private func makeWidgetCard(
        index: Int,
        day: String,
        status: String,
        isManualImport: Bool = false
    ) -> WidgetCardSnapshot {
        WidgetCardSnapshot(
            id: UUID(),
            candidateToken: UUID(),
            topicID: "topic-\(index)",
            objectName: "物件 \(index)",
            title: "标题 \(index)",
            body: "正文 \(index)",
            personalContext: "来自当天候选",
            confidence: 0.9,
            scheduledDay: day,
            presentationStatus: status,
            createdAt: Date(timeIntervalSince1970: TimeInterval(index)),
            isManualImport: isManualImport,
            thumbnailFilename: nil,
            source: WidgetSourceSnapshot(
                title: "来源",
                publisher: "发布者",
                url: URL(string: "https://example.com/\(index)")!
            )
        )
    }

    private func makeCandidate(state: CandidateAnalysisState) -> PhotoCandidateRecord {
        PhotoCandidateRecord(
            id: UUID(),
            localIdentifier: UUID().uuidString,
            capturedAt: Date(timeIntervalSince1970: 1_700_000_000),
            perceptualHash: nil,
            qualityScore: 0.9,
            localLabels: [],
            sensitiveFlags: [],
            state: state,
            updatedAt: Date(timeIntervalSince1970: 1_700_000_000)
        )
    }

    private func makeCard(topic: String, candidateToken: UUID = UUID()) -> KnowledgeCard {
        KnowledgeCard(
            id: UUID(),
            candidateToken: candidateToken,
            topicID: topic,
            factID: "\(topic)-fact",
            title: "日常物件里藏着的设计",
            objectName: topic,
            body: "这是一条只用于验证每日三选一结构化响应的已审核知识内容。",
            personalContext: "来自今天的候选照片",
            confidence: 0.9,
            boundingBox: nil,
            sources: [KnowledgeSource(
                id: "source-\(topic)",
                title: "Reference",
                url: URL(string: "https://example.com/\(topic)")!,
                publisher: "Example",
                authority: "general"
            )],
            status: "scheduled",
            scheduledDay: "2026-08-27",
            createdAt: Date(timeIntervalSince1970: 1_700_000_000)
        )
    }

    private func makeTestJPEG() -> Data {
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: 32, height: 32))
        return renderer.jpegData(withCompressionQuality: 0.8) { context in
            UIColor.systemBrown.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 32, height: 32))
        }
    }
}

private final class DirectQwenURLProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: (@Sendable (URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let handler = Self.handler else {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
            return
        }
        do {
            let (response, data) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}

private final class DeferredCardSyncURLProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: (@Sendable (DeferredCardSyncURLProtocol) -> Void)?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let handler = Self.handler else {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
            return
        }
        handler(self)
    }
    func finish(statusCode: Int, data: Data) {
        let response = HTTPURLResponse(url: request.url!, statusCode: statusCode, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

private final class DeferredCardSyncResponse: @unchecked Sendable {
    let received = XCTestExpectation(description: "first cloud card request is suspended locally")
    private let path: String
    private let lock = NSLock()
    private var pending: DeferredCardSyncURLProtocol?
    private var count = 0
    init(path: String = "/v1/cards") { self.path = path }
    var requestCount: Int { lock.withLock { count } }
    func receive(_ transport: DeferredCardSyncURLProtocol) {
        let shouldWait = lock.withLock {
            count += 1
            guard count == 1, transport.request.url?.path == path else { return false }
            pending = transport
            return true
        }
        if shouldWait { received.fulfill() }
        else { transport.finish(statusCode: 503, data: Data()) }
    }
    func complete(statusCode: Int, data: Data) {
        let transport = lock.withLock {
            defer { pending = nil }
            return pending
        }
        transport?.finish(statusCode: statusCode, data: data)
    }
}

private final class TestAttemptCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0

    func incrementAndRead() -> Int {
        lock.withLock {
            count += 1
            return count
        }
    }

    var value: Int {
        lock.withLock { count }
    }
}

private func requestBodyData(_ request: URLRequest) throws -> Data {
    if let body = request.httpBody { return body }
    let stream = try XCTUnwrap(request.httpBodyStream)
    stream.open()
    defer { stream.close() }
    var result = Data()
    var buffer = [UInt8](repeating: 0, count: 4_096)
    while stream.hasBytesAvailable {
        let count = stream.read(&buffer, maxLength: buffer.count)
        if count < 0 { throw try XCTUnwrap(stream.streamError) }
        if count == 0 { break }
        result.append(buffer, count: count)
    }
    return result
}

private final class TestSecretStore: SecretStore, @unchecked Sendable {
    private let lock = NSLock()
    private var values: [String: String] = [:]

    func string(for account: String) -> String? {
        lock.withLock { values[account] }
    }

    func set(_ value: String, for account: String) {
        lock.withLock { values[account] = value }
    }

    func remove(_ account: String) {
        _ = lock.withLock { values.removeValue(forKey: account) }
    }
}
