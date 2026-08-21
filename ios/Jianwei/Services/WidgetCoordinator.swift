import Foundation
import WidgetKit

struct WidgetCoordinator: Sendable {
    static let maximumThumbnailSide: CGFloat = 800

    let repository: LocalRepository

    func synchronize(cards: [KnowledgeCard]) async throws {
        let store = try SharedWidgetStore()
        var thumbnails: [UUID: Data] = [:]
        for card in cards {
            if let data = await repository.imageData(candidateToken: card.candidateToken),
               let thumbnail = try? ImageSanitizer().sanitize(
                   data,
                   maximumSide: Self.maximumThumbnailSide
               ) {
                thumbnails[card.candidateToken] = thumbnail.jpeg
            }
        }
        try store.replaceCards(cards.compactMap(\.widgetSnapshot), thumbnails: thumbnails)
        WidgetCenter.shared.reloadTimelines(ofKind: SharedConstants.widgetKind)
    }
}
