import Foundation
import UIKit
import XCTest
@testable import Jianwei

final class JianweiCoreTests: XCTestCase {
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

        XCTAssertEqual(state.schemaVersion, 1)
        XCTAssertEqual(state.cards.count, 0)
        XCTAssertEqual(state.interests, PersistedAppState.empty.interests)
        XCTAssertEqual(state.preparationMode, .weeklyCache)
        XCTAssertFalse(state.onboardingCompleted)
        XCTAssertFalse(state.automaticDiscoveryEnabled)
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

        XCTAssertTrue(state.advance(on: "2026-08-03"))
        XCTAssertTrue(state.advance(on: "2026-08-03"))
        XCTAssertFalse(state.advance(on: "2026-08-03"))
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
        XCTAssertFalse(state.advance(on: "2026-08-03"))
        XCTAssertNil(state.swapCounts["2026-08-03"])
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
    }
}
