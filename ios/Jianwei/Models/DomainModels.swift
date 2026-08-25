import Foundation

struct KnowledgeSource: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let title: String
    let url: URL
    let publisher: String
    let authority: String
}

struct ObjectBoundingBox: Codable, Hashable, Sendable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double

    var isValid: Bool {
        [x, y, width, height].allSatisfy { $0.isFinite && $0 >= 0 && $0 <= 1 } &&
            width > 0 && height > 0 && x + width <= 1.000_001 && y + height <= 1.000_001
    }
}

struct KnowledgeCard: Codable, Hashable, Identifiable, Sendable {
    let id: UUID
    let candidateToken: UUID
    let topicID: String
    let factID: String
    let title: String
    let objectName: String
    let body: String
    let personalContext: String
    let confidence: Double
    let boundingBox: ObjectBoundingBox?
    let sources: [KnowledgeSource]
    let status: String
    let scheduledDay: String
    let createdAt: Date

    var widgetSnapshot: WidgetCardSnapshot? {
        guard let source = sources.first else { return nil }
        return WidgetCardSnapshot(
            id: id,
            candidateToken: candidateToken,
            topicID: topicID,
            objectName: objectName,
            title: title,
            body: body,
            personalContext: personalContext,
            confidence: confidence,
            scheduledDay: scheduledDay,
            thumbnailFilename: candidateToken.uuidString.lowercased() + ".jpg",
            source: WidgetSourceSnapshot(
                title: source.title,
                publisher: source.publisher,
                url: source.url
            )
        )
    }
}

enum FeedbackAction: String, Codable, CaseIterable, Sendable {
    case like = "LIKE"
    case dislike = "DISLIKE"
    case wrongObject = "WRONG_OBJECT"
    case tooPrivate = "TOO_PRIVATE"
    case save = "SAVE"
}

enum AutomaticPreparationMode: String, Codable, CaseIterable, Sendable {
    case weeklyCache
    case dailySingle

    var title: String {
        switch self {
        case .weeklyCache: "旧版一周缓存"
        case .dailySingle: "每天三选一"
        }
    }
}

enum ModelAccessMode: String, Codable, CaseIterable, Sendable {
    case managed
    case qwenUserKey

    var title: String {
        switch self {
        case .managed: "见微托管服务"
        case .qwenUserKey: "使用自己的 Qwen Key"
        }
    }
}

enum KnowledgeInterest: String, Codable, CaseIterable, Identifiable, Sendable {
    case everydayDesign
    case objectHistory
    case science
    case practicalTips
    case manufacturing

    var id: String { rawValue }

    var title: String {
        switch self {
        case .everydayDesign: "生活设计"
        case .objectHistory: "物件历史"
        case .science: "科学原理"
        case .practicalTips: "实用技巧"
        case .manufacturing: "制造工艺"
        }
    }
}

enum CandidateAnalysisState: String, Codable, Sendable {
    case discovered
    case filtered
    case uploaded
    case completed
    case noMatch
    case failed
    case neverAnalyze
}

struct PhotoCandidateRecord: Codable, Hashable, Identifiable, Sendable {
    let id: UUID
    let localIdentifier: String?
    let capturedAt: Date?
    var perceptualHash: UInt64?
    var qualityScore: Double
    var localLabels: [String]
    var sensitiveFlags: Set<String>
    var state: CandidateAnalysisState
    var updatedAt: Date
}

struct PendingFeedback: Codable, Hashable, Identifiable, Sendable {
    let id: UUID
    let cardID: UUID
    let action: FeedbackAction
    let createdAt: Date
}

struct PersistedAppState: Codable, Sendable {
    var schemaVersion: Int
    var cards: [KnowledgeCard]
    var candidates: [PhotoCandidateRecord]
    var savedCardIDs: Set<UUID>
    var hiddenCardIDs: Set<UUID>
    var interests: Set<KnowledgeInterest>
    var preparationMode: AutomaticPreparationMode
    var modelAccessMode: ModelAccessMode
    var feedbackByCardID: [UUID: FeedbackAction]
    var pendingFeedback: [PendingFeedback]
    var onboardingCompleted: Bool
    var automaticDiscoveryEnabled: Bool
    var lastIncrementalScanAt: Date?
    var lastDailySelectionDay: String?

    static let empty = PersistedAppState(
        schemaVersion: 2,
        cards: [],
        candidates: [],
        savedCardIDs: [],
        hiddenCardIDs: [],
        interests: [.everydayDesign, .objectHistory, .science],
        preparationMode: .dailySingle,
        modelAccessMode: .managed,
        feedbackByCardID: [:],
        pendingFeedback: [],
        onboardingCompleted: false,
        automaticDiscoveryEnabled: false,
        lastIncrementalScanAt: nil,
        lastDailySelectionDay: nil
    )
}

extension PersistedAppState {
    private enum CodingKeys: String, CodingKey {
        case schemaVersion
        case cards
        case candidates
        case savedCardIDs
        case hiddenCardIDs
        case interests
        case preparationMode
        case modelAccessMode
        case feedbackByCardID
        case pendingFeedback
        case onboardingCompleted
        case automaticDiscoveryEnabled
        case lastIncrementalScanAt
        case lastDailySelectionDay
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = max(2, try container.decodeIfPresent(Int.self, forKey: .schemaVersion) ?? 1)
        cards = try container.decodeIfPresent([KnowledgeCard].self, forKey: .cards) ?? []
        candidates = try container.decodeIfPresent([PhotoCandidateRecord].self, forKey: .candidates) ?? []
        savedCardIDs = try container.decodeIfPresent(Set<UUID>.self, forKey: .savedCardIDs) ?? []
        hiddenCardIDs = try container.decodeIfPresent(Set<UUID>.self, forKey: .hiddenCardIDs) ?? []
        interests = try container.decodeIfPresent(
            Set<KnowledgeInterest>.self,
            forKey: .interests
        ) ?? Self.empty.interests
        preparationMode = try container.decodeIfPresent(
            AutomaticPreparationMode.self,
            forKey: .preparationMode
        ) ?? .dailySingle
        modelAccessMode = try container.decodeIfPresent(
            ModelAccessMode.self,
            forKey: .modelAccessMode
        ) ?? .managed
        feedbackByCardID = try container.decodeIfPresent(
            [UUID: FeedbackAction].self,
            forKey: .feedbackByCardID
        ) ?? [:]
        pendingFeedback = try container.decodeIfPresent(
            [PendingFeedback].self,
            forKey: .pendingFeedback
        ) ?? []
        onboardingCompleted = try container.decodeIfPresent(
            Bool.self,
            forKey: .onboardingCompleted
        ) ?? false
        automaticDiscoveryEnabled = try container.decodeIfPresent(
            Bool.self,
            forKey: .automaticDiscoveryEnabled
        ) ?? false
        lastIncrementalScanAt = try container.decodeIfPresent(
            Date.self,
            forKey: .lastIncrementalScanAt
        )
        lastDailySelectionDay = try container.decodeIfPresent(
            String.self,
            forKey: .lastDailySelectionDay
        )
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(schemaVersion, forKey: .schemaVersion)
        try container.encode(cards, forKey: .cards)
        try container.encode(candidates, forKey: .candidates)
        try container.encode(savedCardIDs, forKey: .savedCardIDs)
        try container.encode(hiddenCardIDs, forKey: .hiddenCardIDs)
        try container.encode(interests, forKey: .interests)
        try container.encode(preparationMode, forKey: .preparationMode)
        try container.encode(modelAccessMode, forKey: .modelAccessMode)
        try container.encode(feedbackByCardID, forKey: .feedbackByCardID)
        try container.encode(pendingFeedback, forKey: .pendingFeedback)
        try container.encode(onboardingCompleted, forKey: .onboardingCompleted)
        try container.encode(automaticDiscoveryEnabled, forKey: .automaticDiscoveryEnabled)
        try container.encodeIfPresent(lastIncrementalScanAt, forKey: .lastIncrementalScanAt)
        try container.encodeIfPresent(lastDailySelectionDay, forKey: .lastDailySelectionDay)
    }
}

enum ProductError: LocalizedError, Equatable {
    case apiNotConfigured
    case apiKeyRequired
    case invalidAPIKey
    case subscriptionUnavailable
    case subscriptionVerificationFailed
    case subscriptionPending
    case subscriptionRequired
    case invalidServerResponse
    case photoUnavailable
    case sensitivePhoto(Set<String>)
    case lowQualityPhoto
    case duplicatePhoto
    case noReliableKnowledge
    case permissionDenied
    case requestFailed(Int)

    var errorDescription: String? {
        switch self {
        case .apiNotConfigured: "云端服务尚未配置，请先使用本地开发地址或生产 HTTPS 地址。"
        case .apiKeyRequired: "请先在设置中保存有效的 Qwen API Key。"
        case .invalidAPIKey: "Qwen API Key 格式不正确。"
        case .subscriptionUnavailable: "暂时无法从 App Store 获取见微 Pro。"
        case .subscriptionVerificationFailed: "App Store 购买凭证无法验证，请稍后重试。"
        case .subscriptionPending: "购买仍在等待 App Store 确认。"
        case .subscriptionRequired: "需要有效的见微 Pro 订阅，或在设置中改用自己的 Qwen API Key。"
        case .invalidServerResponse: "服务返回的数据无法安全验证。"
        case .photoUnavailable: "这张照片暂时无法读取，可以换一张试试。"
        case .sensitivePhoto: "这张照片可能包含人物、证件或较多文字，已留在设备上。"
        case .lowQualityPhoto: "照片主体不够清楚，换一张光线更好、主体更明确的照片吧。"
        case .duplicatePhoto: "这张照片已经理解过了，换一张会得到新的知识。"
        case .noReliableKnowledge: "暂时没有找到可靠知识，没有为了出卡而猜测。"
        case .permissionDenied: "没有可用的照片权限；仍可使用系统照片选择器。"
        case let .requestFailed(code): "服务暂时不可用（\(code)），稍后会保留照片重试。"
        }
    }
}
