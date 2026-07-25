package cn.jianwei.domain.model

import java.time.Instant
import java.time.LocalDate

enum class AnalysisState {
    DISCOVERED,
    FILTERED,
    READY,
    DEFERRED,
    QUEUED,
    COMPLETED,
    FAILED,
    ACCESS_UNAVAILABLE,
    NEVER_ANALYZE
}

enum class AnalysisPhase {
    IDLE,
    QUEUED,
    SCANNING,
    FILTERING,
    SYNCING,
    READY,
    NO_MATCH,
    RETRYING,
    FAILED
}

/** Independent user-facing pipelines whose durable progress must never overwrite each other. */
enum class AnalysisProgressScope {
    AUTOMATIC_DISCOVERY,
    EXPLICIT_IMPORT
}

/**
 * Durable, device-local product state for the photo-to-card pipeline.
 *
 * Counts are deliberately aggregate and contain no media identifiers, labels, filenames, or
 * model output. This lets the UI explain what is actually happening after process death without
 * creating another store of photo-derived personal data.
 */
data class AnalysisProgress(
    val phase: AnalysisPhase = AnalysisPhase.IDLE,
    val discoveredCount: Int = 0,
    val eligibleCount: Int = 0,
    val cachedCardCount: Int = 0,
    val detail: String? = null
)

enum class PhotoOrigin { MEDIA_STORE, PHOTO_PICKER, SHARED }

data class PhotoCandidate(
    val localId: Long,
    val candidateToken: String,
    val contentUri: String,
    val capturedAt: Instant,
    val modifiedAt: Instant,
    val perceptualHash: Long?,
    val qualityScore: Double,
    val localLabels: List<String>,
    val sensitiveFlags: Set<String>,
    val analysisState: AnalysisState,
    val origin: PhotoOrigin,
    val width: Int,
    val height: Int
)

data class KnowledgeSource(
    val sourceId: String,
    val title: String,
    val url: String,
    val publisher: String,
    val authority: String
)

data class KnowledgeCard(
    val cardId: String,
    val candidateToken: String,
    val photoUri: String,
    val topicId: String,
    val factId: String,
    val title: String,
    val detectedObjectName: String,
    val body: String,
    val personalContext: String,
    val confidence: Double,
    val sources: List<KnowledgeSource>,
    val status: String,
    val scheduledDate: LocalDate,
    val createdAt: Instant
)

data class TrackedItem(
    val cardId: String,
    val startedOn: LocalDate,
    val reminderDays: Int
) {
    val dueOn: LocalDate get() = startedOn.plusDays(reminderDays.toLong())
}

data class PendingReminderSchedule(
    val cardId: String,
    val startedOn: LocalDate,
    val reminderDays: Int,
    val version: Long
)

enum class FeedbackAction { LIKE, DISLIKE, WRONG_OBJECT, TOO_PRIVATE, SAVE }

data class CardFeedbackState(
    val cardId: String,
    val action: FeedbackAction,
    val submittedAtMillis: Long
)

data class FeedbackSubmissionResult(
    val accepted: Boolean,
    val effectiveAction: FeedbackAction,
    val cardRemoved: Boolean = false
)

data class SavedCardUpdateResult(
    val cardAvailable: Boolean,
    val changed: Boolean,
    val isSaved: Boolean
)

fun FeedbackAction.isCardFeedback(): Boolean =
    this != FeedbackAction.SAVE

fun FeedbackAction.isOrdinaryCardFeedback(): Boolean =
    this == FeedbackAction.LIKE || this == FeedbackAction.DISLIKE || this == FeedbackAction.WRONG_OBJECT

/**
 * PII-free, device-local preference signal learned from card feedback.
 * Aliases are limited to reviewed topic metadata and never contain photo or user text.
 */
data class TopicAffinitySignal(
    val topicId: String,
    val weight: Double,
    val aliases: Set<String>
)

enum class PhotoAccess { FULL, PARTIAL, PICKER_ONLY }

data class ScanRequest(
    val since: Instant,
    val maximum: Int = 500,
    val access: PhotoAccess
)

data class ScanResult(
    val discovered: Int,
    val inserted: Int,
    val candidates: List<PhotoCandidate>
)
