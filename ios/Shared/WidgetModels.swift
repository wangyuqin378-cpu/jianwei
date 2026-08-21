import Foundation

struct WidgetSourceSnapshot: Codable, Hashable, Sendable {
    let title: String
    let publisher: String
    let url: URL
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
    let thumbnailFilename: String?
    let source: WidgetSourceSnapshot

    var deepLink: URL {
        URL(string: "jianwei://card/\(id.uuidString.lowercased())")!
    }
}

struct WidgetQueueState: Codable, Equatable, Sendable {
    var cards: [WidgetCardSnapshot]
    var manuallyConsumedCardIDs: Set<UUID>
    var manualOverrides: [String: UUID]
    var swapCounts: [String: Int]
    var generatedAt: Date

    static let empty = WidgetQueueState(
        cards: [],
        manuallyConsumedCardIDs: [],
        manualOverrides: [:],
        swapCounts: [:],
        generatedAt: .distantPast
    )

    mutating func mergeCards(_ newCards: [WidgetCardSnapshot], now: Date = Date()) {
        let validIDs = Set(newCards.map(\.id))
        cards = newCards.sorted {
            if $0.scheduledDay == $1.scheduledDay { return $0.id.uuidString < $1.id.uuidString }
            return $0.scheduledDay < $1.scheduledDay
        }
        manuallyConsumedCardIDs.formIntersection(validIDs)
        manualOverrides = manualOverrides.filter { validIDs.contains($0.value) }
        generatedAt = now
    }

    func card(for day: String) -> WidgetCardSnapshot? {
        if let override = manualOverrides[day], let card = cards.first(where: { $0.id == override }) {
            return card
        }
        if let exact = cards.first(where: {
            $0.scheduledDay == day && !manuallyConsumedCardIDs.contains($0.id)
        }) {
            return exact
        }
        return cards.first(where: {
            $0.scheduledDay <= day && !manuallyConsumedCardIDs.contains($0.id)
        }) ?? cards.last
    }

    func canAdvance(
        on day: String,
        maximumSwaps: Int = SharedConstants.maximumDailySwaps
    ) -> Bool {
        guard swapCounts[day, default: 0] < maximumSwaps,
              let current = card(for: day) else { return false }
        return cards.contains {
            $0.id != current.id &&
                !manuallyConsumedCardIDs.contains($0.id) &&
                manualOverrides.values.contains($0.id) == false
        }
    }

    mutating func advance(on day: String, maximumSwaps: Int = SharedConstants.maximumDailySwaps) -> Bool {
        let count = swapCounts[day, default: 0]
        guard canAdvance(on: day, maximumSwaps: maximumSwaps),
              let current = card(for: day) else { return false }
        let next = cards.first {
            $0.id != current.id &&
                !manuallyConsumedCardIDs.contains($0.id) &&
                manualOverrides.values.contains($0.id) == false
        }
        guard let next else { return false }
        manuallyConsumedCardIDs.insert(current.id)
        manuallyConsumedCardIDs.insert(next.id)
        manualOverrides[day] = next.id
        swapCounts[day] = count + 1
        return true
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
