import Foundation
import CryptoKit

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
    var evidenceKind: KnowledgeEvidenceKind? = nil
    var correction: KnowledgeCorrectionNotice? = nil

    var isWithdrawn: Bool { correction != nil }

    var effectiveEvidenceKind: KnowledgeEvidenceKind {
        .resolved(evidenceKind, hasSource: !sources.isEmpty)
    }

    var isPublished: Bool {
        status == "scheduled" || status == "shown"
    }

    var knowledgeIdentityKeys: Set<String> {
        // Legacy managed cards had random fact IDs. Match content too, without
        // migrating identifiers referenced by history, feedback and widgets.
        let topic = topicID.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let text = body.precomposedStringWithCompatibilityMapping
            .replacingOccurrences(of: "\\s*\\[ref_\\d+\\]", with: "", options: .regularExpression)
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        var keys: Set<String> = factID.isEmpty ? [] : ["fact:" + factID]
        if !topic.isEmpty && !text.isEmpty { keys.insert("text:" + topic + ":" + text) }
        return keys
    }

    func withPresentation(status: String, scheduledDay: String) -> KnowledgeCard {
        KnowledgeCard(
            id: id,
            candidateToken: candidateToken,
            topicID: topicID,
            factID: factID,
            title: title,
            objectName: objectName,
            body: body,
            personalContext: personalContext,
            confidence: confidence,
            boundingBox: boundingBox,
            sources: sources,
            status: status,
            scheduledDay: scheduledDay,
            createdAt: createdAt,
            evidenceKind: evidenceKind,
            correction: correction
        )
    }

    func withPersonalContext(_ personalContext: String) -> KnowledgeCard {
        KnowledgeCard(
            id: id,
            candidateToken: candidateToken,
            topicID: topicID,
            factID: factID,
            title: title,
            objectName: objectName,
            body: body,
            personalContext: personalContext,
            confidence: confidence,
            boundingBox: boundingBox,
            sources: sources,
            status: status,
            scheduledDay: scheduledDay,
            createdAt: createdAt,
            evidenceKind: evidenceKind,
            correction: correction
        )
    }

    func widgetSnapshot(isManualImport: Bool) -> WidgetCardSnapshot? {
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
            presentationStatus: status,
            createdAt: createdAt,
            isManualImport: isManualImport,
            thumbnailFilename: candidateToken.uuidString.lowercased() + ".jpg",
            source: sources.first.map {
                WidgetSourceSnapshot(title: $0.title, publisher: $0.publisher, url: $0.url)
            },
            evidenceKind: evidenceKind,
            correction: correction
        )
    }
}

// Offline, release-reviewed corrections to exact published text. This is not
// an object blacklist or an AI verdict. No photo, device ID or Key is needed.
// A corrected/new text has a different fingerprint and is not withdrawn.
enum KnowledgeCorrectionCatalog {
    static func fingerprint(for card: KnowledgeCard) -> String {
        let fields = [card.title, card.body] + card.sources.map { $0.url.absoluteString }.sorted()
        return SHA256.hash(data: Data(fields.joined(separator: "\n").utf8))
            .map { String(format: "%02x", $0) }.joined()
    }

    static func applying(to card: KnowledgeCard) -> KnowledgeCard {
        guard card.correction == nil, let notice = notices[fingerprint(for: card)] else { return card }
        var updated = card
        updated.correction = notice
        return updated
    }

    private static let notices: [String: KnowledgeCorrectionNotice] = [
        "c2e6c6dd3bb2b33fb7372fb496026c74279aecf52404f8c21501434c1e4a2716":
            KnowledgeCorrectionNotice(
                id: "source-scope-20260914-001",
                reason: "原文只说明颈部活动受限，不支持“无法转头”；也未证明船速越慢就越难听见。这张卡扩大了来源的结论，已停止推荐。",
                sourceURL: URL(string: "https://faculty.washington.edu/chudler/manat.html")!,
                issuedDay: "2026-09-14"
            )
    ]
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

enum DailyPreparationStatus: String, Codable, Sendable {
    case queued
    case preparing
    case ready
    case noNewCard
    case waitingForPhotos
    case waitingForAccess
    case retryableFailure

    var isFinal: Bool {
        self == .ready || self == .noNewCard
    }
}

struct AdvancePreparationAttempt: Codable, Hashable, Sendable {
    let inspectedPhotoCount: Int
    let aiPhotoCount: Int
    let lastAttemptAt: Date
    let recoveredAt: Date
}

struct DailyPreparationRecord: Codable, Hashable, Identifiable, Sendable {
    var id: String { day }
    let day: String
    var status: DailyPreparationStatus
    var inspectedPhotoCount: Int
    var aiPhotoCount: Int
    var qualifiedCardIDs: [UUID]
    var selectedCardID: UUID?
    var lastAttemptAt: Date?
    // Older builds could exhaust a future date before it arrived. Keep those
    // already-spent attempts separate from the actual day's fresh allowance.
    var previousAdvanceAttempt: AdvancePreparationAttempt?
    var earlierAdvanceAttempts: [AdvancePreparationAttempt]?
    // Only explicit pre-dispatch rejections may release one of these slots.
    // Absent in older state: existing counts remain conservatively charged.
    var cloudPhotoReservationIDs: Set<UUID>?

    init(
        day: String,
        status: DailyPreparationStatus = .queued,
        inspectedPhotoCount: Int = 0,
        aiPhotoCount: Int = 0,
        qualifiedCardIDs: [UUID] = [],
        selectedCardID: UUID? = nil,
        lastAttemptAt: Date? = nil,
        previousAdvanceAttempt: AdvancePreparationAttempt? = nil,
        earlierAdvanceAttempts: [AdvancePreparationAttempt]? = nil,
        cloudPhotoReservationIDs: Set<UUID>? = nil
    ) {
        self.day = day
        self.status = status
        self.inspectedPhotoCount = max(0, inspectedPhotoCount)
        self.aiPhotoCount = max(0, aiPhotoCount)
        self.qualifiedCardIDs = Array(qualifiedCardIDs.prefix(3))
        self.selectedCardID = selectedCardID
        self.lastAttemptAt = lastAttemptAt
        self.previousAdvanceAttempt = previousAdvanceAttempt
        self.earlierAdvanceAttempts = earlierAdvanceAttempts
        self.cloudPhotoReservationIDs = cloudPhotoReservationIDs
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
    case knowledgeReady
    case selected
    case exhausted
    // Kept only so existing on-device state can migrate without data loss.
    case completed
    case noMatch
    case failed
    case neverAnalyze

    var isTerminalKnowledgeDecision: Bool {
        switch self {
        case .knowledgeReady, .selected, .exhausted, .completed, .noMatch:
            true
        default:
            false
        }
    }
}

struct ManagedPhotoDispatch: Codable, Hashable, Sendable {
    let day: String
    let reservationID: UUID
    let createdAt: Date

    // The gateway retains completed responses for seven days. Use a shorter
    // replay window; an expired request must reserve a new analysis allowance.
    func isReplayable(at now: Date) -> Bool {
        (0..<(6 * 24 * 60 * 60)).contains(now.timeIntervalSince(createdAt))
    }
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
    var managedDispatch: ManagedPhotoDispatch? = nil

    var hasPendingManagedDispatch: Bool {
        managedDispatch != nil && (state == .uploaded || state == .failed)
    }
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
    // Candidate records are a bounded working set, while this compact index is
    // the durable answer to “has this MediaStore/Photos asset ever been tried?”.
    // Keeping the two concerns separate prevents an old photo from becoming
    // eligible again when the working set is trimmed.
    var processedLocalIdentifiers: Set<String>
    // Keep terminal no-card decisions separately so a newer reviewed catalog
    // can reconsider them without reprocessing successful, filtered, or
    // explicitly private photos.
    var exhaustedLocalIdentifiers: Set<String>
    var knowledgeCatalogRevision: String?
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
    var dailyPreparations: [String: DailyPreparationRecord]
    var managedDispatchResumeAt: Date? = nil

    static let empty = PersistedAppState(
        schemaVersion: 6,
        cards: [],
        candidates: [],
        processedLocalIdentifiers: [],
        exhaustedLocalIdentifiers: [],
        knowledgeCatalogRevision: nil,
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
        dailyPreparations: [:]
    )
}

extension PersistedAppState {
    private enum CodingKeys: String, CodingKey {
        case schemaVersion
        case cards
        case candidates
        case processedLocalIdentifiers
        case exhaustedLocalIdentifiers
        case knowledgeCatalogRevision
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
        case dailyPreparations
        case managedDispatchResumeAt
        // Schema 1-5 compatibility. This value is migrated into
        // `dailyPreparations` and is never written again.
        case lastDailySelectionDay
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = max(6, try container.decodeIfPresent(Int.self, forKey: .schemaVersion) ?? 1)
        cards = try container.decodeIfPresent([KnowledgeCard].self, forKey: .cards) ?? []
        candidates = try container.decodeIfPresent([PhotoCandidateRecord].self, forKey: .candidates) ?? []
        for index in candidates.indices {
            switch candidates[index].state {
            case .completed:
                candidates[index].state = .knowledgeReady
            case .noMatch:
                candidates[index].state = .exhausted
            default:
                break
            }
        }
        processedLocalIdentifiers = try container.decodeIfPresent(
            Set<String>.self,
            forKey: .processedLocalIdentifiers
        ) ?? Set(candidates.compactMap(\.localIdentifier))
        exhaustedLocalIdentifiers = try container.decodeIfPresent(
            Set<String>.self,
            forKey: .exhaustedLocalIdentifiers
        ) ?? Set(candidates.compactMap { candidate in
            guard candidate.state == .exhausted || candidate.state == .noMatch else { return nil }
            return candidate.localIdentifier
        })
        knowledgeCatalogRevision = try container.decodeIfPresent(
            String.self,
            forKey: .knowledgeCatalogRevision
        )
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
        dailyPreparations = try container.decodeIfPresent(
            [String: DailyPreparationRecord].self,
            forKey: .dailyPreparations
        ) ?? [:]
        managedDispatchResumeAt = try container.decodeIfPresent(Date.self, forKey: .managedDispatchResumeAt)
        if let legacyDay = try container.decodeIfPresent(String.self, forKey: .lastDailySelectionDay),
           dailyPreparations[legacyDay] == nil {
            let dayCards = cards.filter { $0.scheduledDay == legacyDay }
            let selected = dayCards.first(where: \.isPublished)
            dailyPreparations[legacyDay] = DailyPreparationRecord(
                day: legacyDay,
                status: selected == nil ? .noNewCard : .ready,
                aiPhotoCount: min(9, dayCards.count),
                qualifiedCardIDs: dayCards.map(\.id),
                selectedCardID: selected?.id,
                lastAttemptAt: lastIncrementalScanAt
            )
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(schemaVersion, forKey: .schemaVersion)
        try container.encode(cards, forKey: .cards)
        try container.encode(candidates, forKey: .candidates)
        try container.encode(processedLocalIdentifiers, forKey: .processedLocalIdentifiers)
        try container.encode(exhaustedLocalIdentifiers, forKey: .exhaustedLocalIdentifiers)
        try container.encodeIfPresent(knowledgeCatalogRevision, forKey: .knowledgeCatalogRevision)
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
        try container.encode(dailyPreparations, forKey: .dailyPreparations)
        try container.encodeIfPresent(managedDispatchResumeAt, forKey: .managedDispatchResumeAt)
    }
}

enum ProductError: LocalizedError, Equatable, Sendable {
    case apiNotConfigured
    case apiKeyRequired
    case invalidAPIKey
    case apiKeyRejected
    case modelAccountBillingUnavailable
    case modelFreeQuotaExhausted
    case modelAccessUnavailable
    case managedServiceUnavailable
    case subscriptionUnavailable
    case subscriptionVerificationFailed
    case subscriptionPending
    case subscriptionRequired
    case secureStorageUnavailable
    case localStorageUnavailable
    case widgetSyncUnavailable
    case invalidServerResponse
    case photoUnavailable
    case photoReadTimedOut
    case localPhotoAnalysisUnavailable
    case sensitivePhoto(Set<String>)
    case lowQualityPhoto
    case duplicatePhoto
    case noReliableKnowledge
    case knowledgeSourceUnavailable
    case permissionDenied
    case requestThrottled
    case managedDailyDispatchLimitReached
    case dailyAnalysisLimitReached
    case monthlyAnalysisLimitReached
    case serverCredentialExpired
    case managedIdentityRecoveryRequired
    case requestFailed(Int)

    var requiresModelAccessAction: Bool {
        switch self {
        case .apiNotConfigured, .apiKeyRequired, .invalidAPIKey, .apiKeyRejected,
             .modelAccountBillingUnavailable, .modelFreeQuotaExhausted, .modelAccessUnavailable, .subscriptionUnavailable,
             .subscriptionVerificationFailed, .subscriptionPending, .subscriptionRequired, .managedIdentityRecoveryRequired:
            true
        default:
            false
        }
    }

    var errorDescription: String? {
        switch self {
        case .apiNotConfigured: "见微托管服务尚未开放；Beta 阶段请先使用自己的 Qwen API Key。"
        case .apiKeyRequired: "请先在设置中保存有效的 Qwen API Key。"
        case .invalidAPIKey: "Qwen API Key 格式不正确。"
        case .apiKeyRejected: "Qwen 没有接受这个 API Key，请检查 Key 是否有效及所属地域。"
        case .modelAccountBillingUnavailable: "Qwen 提示账号余额或计费状态异常，请在百炼核对；现有卡片仍可查看。"
        case .modelFreeQuotaExhausted: "Qwen 的免费额度已用完，请在百炼核对额度设置；见微不会替你开启付费。"
        case .modelAccessUnavailable: "Qwen 拒绝了模型访问，请在百炼核对模型权限和账号状态；这不代表 Key 格式错误。"
        case .managedServiceUnavailable: "见微的模型服务暂时无法使用，已有卡片仍可查看；无需修改你的 Key，稍后运行时会继续尝试准备。"
        case .subscriptionUnavailable: "暂时无法从 App Store 获取见微 Pro。"
        case .subscriptionVerificationFailed: "App Store 购买凭证无法验证，请稍后重试。"
        case .subscriptionPending: "购买仍在等待 App Store 确认。"
        case .subscriptionRequired: "需要有效的见微 Pro 订阅，或在设置中改用自己的 Qwen API Key。"
        case .secureStorageUnavailable: "暂时无法使用本机安全存储，请解锁设备后重试。"
        case .localStorageUnavailable: "本机暂时无法安全保存分析结果，请确认储存空间后重试。"
        case .widgetSyncUnavailable: "暂时无法同步桌面组件，将在下次运行时重试；已保存的知识卡无需重新生成，也不需要更换 Key。"
        case .invalidServerResponse: "服务返回的数据无法安全验证。"
        case .photoUnavailable: "有照片暂时无法读取，自动准备会继续检查其他候选。"
        case .photoReadTimedOut: "读取照片超时，可能仍在从 iCloud 下载；照片保留了重试资格，稍后会重试。"
        case .localPhotoAnalysisUnavailable: "本机暂时无法完成照片隐私检查，这张照片没有上传；稍后可重试。"
        case .sensitivePhoto: "这张照片可能包含人物、证件或较多文字，已留在设备上。"
        case .lowQualityPhoto: "这张照片主体不够清楚，已自动跳过。"
        case .duplicatePhoto: "这张照片已经处理过，已自动跳过。"
        case .noReliableKnowledge: "暂时没有找到可靠知识，今天会继续显示最近一张。"
        case .knowledgeSourceUnavailable: "部分知识来源暂时打不开，已保留照片稍后重试，并继续寻找其他照片中的知识。"
        case .permissionDenied: "需要照片权限才能自动准备新知识卡。"
        case .requestThrottled: "操作得有点快，请稍等片刻再试；这不是照片或网络的问题。"
        case .managedDailyDispatchLimitReached: "今天的云端分析额度已用完，将在明天继续准备；已有卡片照常展示。"
        case .dailyAnalysisLimitReached: "今天的体验分析次数已经用完，明天可以继续；已选照片仍只保留在本机。"
        case .monthlyAnalysisLimitReached: "本月的体验分析额度已经用完；已选照片仍只保留在本机。"
        case .serverCredentialExpired: "服务身份已过期，正在重新连接。"
        case .managedIdentityRecoveryRequired: "服务身份需要恢复，请在设置中点“恢复购买”；现有卡片仍可查看。"
        case let .requestFailed(code):
            switch code {
            case 408, URLError.timedOut.rawValue:
                "这次 AI 响应超时，照片已保留，稍后会重试；现有卡片仍可查看。"
            case 429:
                "AI 服务暂时限流，稍后会重试；不需要重新填写 Key。"
            case URLError.notConnectedToInternet.rawValue:
                "当前没有网络，恢复连接后会继续准备；现有卡片仍可查看。"
            default:
                "服务暂时不可用，照片已保留，稍后会重试。"
            }
        }
    }
}
