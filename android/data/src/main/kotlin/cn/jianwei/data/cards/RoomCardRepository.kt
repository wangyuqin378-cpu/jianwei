package cn.jianwei.data.cards

import cn.jianwei.data.local.CardDao
import cn.jianwei.data.local.CardEntity
import cn.jianwei.data.local.PendingFeedbackEntity
import cn.jianwei.data.local.PrivateCardCleanup
import cn.jianwei.data.local.TrackedItemEntity
import cn.jianwei.data.local.PhotoDao
import cn.jianwei.data.local.sourcesToJson
import cn.jianwei.data.local.toDomain
import cn.jianwei.data.control.AnalysisSessionGate
import cn.jianwei.data.control.AnalysisSessionToken
import cn.jianwei.data.network.DeviceIdentity
import cn.jianwei.data.network.FeedbackRequest
import cn.jianwei.data.network.FeedbackResponse
import cn.jianwei.data.network.JianweiApi
import cn.jianwei.data.network.SourceDto
import cn.jianwei.data.network.TrackRequest
import cn.jianwei.domain.model.AnalysisState
import cn.jianwei.domain.model.CardFeedbackState
import cn.jianwei.domain.metrics.FirstCardMetricRecorder
import cn.jianwei.domain.model.FeedbackAction
import cn.jianwei.domain.model.FeedbackSubmissionResult
import cn.jianwei.domain.model.KnowledgeCard
import cn.jianwei.domain.model.PendingReminderSchedule
import cn.jianwei.domain.model.KnowledgeSource
import cn.jianwei.domain.model.SavedCardUpdateResult
import cn.jianwei.domain.model.TrackedItem
import cn.jianwei.domain.model.isOrdinaryCardFeedback
import cn.jianwei.domain.model.normalizedSafeKnowledgeSourceUrl
import cn.jianwei.domain.repository.CardRepository
import cn.jianwei.domain.repository.PhotoRepository
import java.io.IOException
import java.time.Instant
import java.time.LocalDate
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import retrofit2.HttpException

@Singleton
class RoomCardRepository @Inject constructor(
    private val cards: CardDao,
    private val photos: PhotoDao,
    private val photoRepository: PhotoRepository,
    private val api: JianweiApi,
    private val identity: DeviceIdentity,
    private val sessionGate: AnalysisSessionGate,
    private val affinities: LocalTopicAffinityStore,
    private val firstCardMetrics: FirstCardMetricRecorder
) : CardRepository {
    private val trackedItemMutex = Mutex()
    override fun observeCards(): Flow<List<KnowledgeCard>> = cards.observeAll().map { list -> list.map { it.toDomain() } }
    override fun observeSavedCards(): Flow<List<KnowledgeCard>> = cards.observeSavedCards().map { list ->
        list.map { it.toDomain() }
    }
    override fun observeTrackedItems(): Flow<List<TrackedItem>> = cards.observeTrackedItems().map { items ->
        items.map { TrackedItem(it.cardId, LocalDate.parse(it.startedOn), it.reminderDays) }
    }
    override fun observePendingReminderSchedules(): Flow<List<PendingReminderSchedule>> =
        cards.observePendingReminderSchedules().map { items ->
            items.map { item ->
                PendingReminderSchedule(
                    cardId = item.cardId,
                    startedOn = LocalDate.parse(item.startedOn),
                    reminderDays = item.reminderDays,
                    version = item.updatedAtMillis
                )
            }
        }
    override fun observeFeedbackStates(): Flow<List<CardFeedbackState>> =
        cards.observeFeedbackStates().map { items ->
            items.mapNotNull { item ->
                runCatching { FeedbackAction.valueOf(item.action) }
                    .getOrNull()
                    ?.takeIf(FeedbackAction::isOrdinaryCardFeedback)
                    ?.let { action ->
                        CardFeedbackState(item.cardId, action, item.submittedAtMillis)
                    }
            }
        }

    override suspend fun syncCards() = sessionGate.withActiveSession { session ->
        // A privacy deletion is a barrier: never download cards while one is unacknowledged.
        val privacyFeedback = flushPrivacyFeedback(session)
        val privacyCardIds = privacyFeedback.mapTo(mutableSetOf()) { it.cardId }
        // A wrong-object report is also a display barrier. Confirm it before downloading and
        // keep its outbox until the complete page set commits, so a stale page cannot revive
        // a card the user has already rejected.
        val wrongObjectFeedback = flushWrongObjectFeedback(session)
        val wrongObjectCardIds = wrongObjectFeedback.mapTo(mutableSetOf()) { it.cardId }
        val downloaded = identity.authenticated(session::requireActive) { bearer ->
            val entitiesById = linkedMapOf<String, CardEntity>()
            val seenCursors = mutableSetOf<String>()
            var cursor: String? = null
            var pageCount = 0
            do {
                if (++pageCount > MAX_CARD_SYNC_PAGES) {
                    throw IOException("Card pagination exceeded the safety limit")
                }
                session.requireActive()
                val page = api.cards(bearer, cursor)
                session.requireActive()
                if (page.items.size > MAX_CARD_PAGE_SIZE) {
                    throw IOException("Card page exceeded the requested size")
                }
                page.items.forEach { dto ->
                    val cardIdentity = dto.validatedIdentity()
                    if (cardIdentity.cardId in privacyCardIds) return@forEach
                    val candidate = photos.findByToken(cardIdentity.candidateToken)
                    if (candidate?.analysisState == AnalysisState.NEVER_ANALYZE.name) return@forEach
                    val payload = dto.validatedForPersistence(cardIdentity)
                    val photoUri = candidate?.contentUri.orEmpty()
                    val privacyPhotoLocalId = candidate?.localId
                        ?: cards.findById(payload.cardId)?.privacyPhotoLocalId
                    val entity = CardEntity(
                        cardId = payload.cardId,
                        candidateToken = payload.candidateToken,
                        photoUri = photoUri,
                        privacyPhotoLocalId = privacyPhotoLocalId,
                        topicId = payload.topicId,
                        factId = payload.factId,
                        title = payload.title,
                        detectedObjectName = payload.detectedObjectName,
                        body = payload.body,
                        personalContext = payload.personalContext,
                        confidence = payload.confidence,
                        sources = sourcesToJson(payload.sources),
                        status = if (payload.cardId in wrongObjectCardIds) "archived" else payload.status,
                        scheduledDate = payload.scheduledDate,
                        createdAtMillis = payload.createdAtMillis
                    )
                    if (entitiesById.putIfAbsent(payload.cardId, entity) != null) {
                        throw IOException("Duplicate card ID across paginated response")
                    }
                }
                val nextCursor = page.nextCursor
                if (nextCursor != null && !seenCursors.add(nextCursor)) {
                    throw IOException("Repeated card pagination cursor")
                }
                cursor = nextCursor
            } while (cursor != null)
            entitiesById.values.toList()
        }
        // Commit only after every page has passed validation. A later malformed page
        // must not leave the cache half-updated or acknowledge a privacy barrier.
        cards.upsertAll(downloaded)
        if (downloaded.any { it.status == "scheduled" }) {
            try {
                firstCardMetrics.recordFirstCardAvailable(System.currentTimeMillis())
            } catch (_: Exception) {
                // Product metrics must never turn a committed card sync into a retry or failure.
            }
        }
        acknowledgePrivacyFeedback(privacyFeedback)
        acknowledgeWrongObjectFeedback(wrongObjectFeedback)
        flushFeedback(session)
        flushTrackedItems(session)
    }

    override suspend fun sendFeedback(
        cardId: String,
        action: FeedbackAction
    ): FeedbackSubmissionResult = sessionGate.withSerializedLocalMutation {
        when {
            action == FeedbackAction.TOO_PRIVATE -> {
                val cleanup = markPhotoNeverAnalyzeLocally(cardId)
                FeedbackSubmissionResult(
                    accepted = cleanup.cardRemoved,
                    effectiveAction = action,
                    cardRemoved = true
                )
            }
            action.isOrdinaryCardFeedback() -> {
                val commit = cards.commitOrdinaryFeedback(cardId, action.name, System.currentTimeMillis())
                require(commit.cardFound) { "Knowledge card is no longer available" }
                val effectiveAction = commit.existingAction
                    ?.let { FeedbackAction.valueOf(it) }
                    ?: action
                FeedbackSubmissionResult(
                    accepted = commit.recorded,
                    effectiveAction = effectiveAction
                )
            }
            else -> throw IllegalArgumentException("SAVE feedback is managed by the saved-card flow")
        }
    }

    override suspend fun setSaved(cardId: String, saved: Boolean): SavedCardUpdateResult =
        sessionGate.withSerializedLocalMutation {
            val commit = cards.setCardSaved(cardId, saved, System.currentTimeMillis())
            SavedCardUpdateResult(
                cardAvailable = commit.cardAvailable,
                changed = commit.changed,
                isSaved = commit.isSaved
            )
        }

    private suspend fun markPhotoNeverAnalyzeLocally(cardId: String): PrivateCardCleanup {
        // Room atomically commits the feedback state, affinity replacement, privacy outbox,
        // suppression and card deletion. Only the private file cleanup remains as an idempotent
        // follow-up, so process death cannot reopen display, scanning or upload.
        val cleanup = cards.stagePrivateFeedbackAndDelete(cardId, System.currentTimeMillis())
        cleanup.photoLocalId?.let { photoRepository.markNeverAnalyze(it) }
        return cleanup
    }

    override suspend fun track(
        cardId: String,
        startedOn: LocalDate,
        reminderDays: Int
    ): PendingReminderSchedule = trackedItemMutex.withLock {
        require(reminderDays in 7..730)
        val previousVersion = cards.findTrackedItem(cardId)?.updatedAtMillis ?: 0L
        val version = maxOf(System.currentTimeMillis(), previousVersion + 1)
        val schedule = PendingReminderSchedule(cardId, startedOn, reminderDays, version)
        cards.upsertTrackedItem(
            TrackedItemEntity(
                cardId = schedule.cardId,
                startedOn = schedule.startedOn.toString(),
                reminderDays = schedule.reminderDays,
                syncAction = TRACK_UPSERT,
                updatedAtMillis = schedule.version,
                localSchedulePending = true
            )
        )
        schedule
    }

    override suspend fun markReminderScheduled(schedule: PendingReminderSchedule): Boolean =
        trackedItemMutex.withLock {
            cards.markReminderScheduled(
                cardId = schedule.cardId,
                startedOn = schedule.startedOn.toString(),
                reminderDays = schedule.reminderDays,
                expectedVersion = schedule.version
            ) == 1
        }

    override suspend fun isReminderSchedulePending(schedule: PendingReminderSchedule): Boolean =
        trackedItemMutex.withLock {
            cards.isReminderSchedulePending(
                cardId = schedule.cardId,
                startedOn = schedule.startedOn.toString(),
                reminderDays = schedule.reminderDays,
                expectedVersion = schedule.version
            )
        }

    override suspend fun isTrackedReminderCurrent(
        cardId: String,
        startedOn: LocalDate,
        reminderDays: Int
    ): Boolean {
        return cards.isTrackedReminderCurrent(
            cardId = cardId,
            startedOn = startedOn.toString(),
            reminderDays = reminderDays
        )
    }

    override suspend fun cancelTracking(cardId: String) = trackedItemMutex.withLock {
        val existing = cards.findTrackedItem(cardId) ?: return
        cards.upsertTrackedItem(
            existing.copy(
                syncAction = TRACK_DELETE,
                updatedAtMillis = maxOf(System.currentTimeMillis(), existing.updatedAtMillis + 1),
                localSchedulePending = false
            )
        )
    }

    override suspend fun clearCloudData() {
        // Preserve cards and outboxes until the server has acknowledged deletion. DeviceIdentity
        // retains crash-recovery material until reset, and Room clears all cloud-derived state in
        // one transaction only after that acknowledgement.
        completeCrashSafeCloudDeletion(
            deleteRemote = { identity.deleteExistingDeviceData(); Unit },
            clearLocal = cards::clearCloudState,
            resetIdentity = identity::reset
        )
    }

    override suspend fun clearLocalCards() = cards.clear()

    override suspend fun clearLocalPhotoReferences() {
        cards.clearPhotoUris()
    }

    private suspend fun flushFeedback(session: AnalysisSessionToken) {
        cards.pendingNonPrivateFeedback().forEach { pending ->
            sendPendingFeedback(session, pending)
            cards.removeFeedback(pending.id)
        }
    }

    private suspend fun flushPrivacyFeedback(
        session: AnalysisSessionToken
    ): List<PendingFeedbackEntity> {
        val pending = cards.pendingFeedbackByAction(FeedbackAction.TOO_PRIVATE.name)
        pending.forEach { item ->
            sendPendingFeedback(session, item)
            // Remove any card resurrected by an older build, but retain the outbox row as a
            // crash-safe stale-page barrier until every card page has synchronized.
            markPhotoNeverAnalyzeLocally(item.cardId)
        }
        return pending
    }

    private suspend fun flushWrongObjectFeedback(
        session: AnalysisSessionToken
    ): List<PendingFeedbackEntity> {
        val pending = cards.pendingFeedbackByAction(FeedbackAction.WRONG_OBJECT.name)
        pending.forEach { item ->
            cards.archiveCard(item.cardId)
            sendPendingFeedback(session, item)
        }
        return pending
    }

    private suspend fun acknowledgePrivacyFeedback(pending: List<PendingFeedbackEntity>) {
        pending.forEach { item ->
            markPhotoNeverAnalyzeLocally(item.cardId)
            cards.removeFeedback(item.id)
        }
    }

    private suspend fun acknowledgeWrongObjectFeedback(pending: List<PendingFeedbackEntity>) {
        pending.forEach { item ->
            cards.archiveCard(item.cardId)
            cards.removeFeedback(item.id)
        }
    }

    private suspend fun sendPendingFeedback(
        session: AnalysisSessionToken,
        pending: PendingFeedbackEntity
    ) {
        session.requireActive()
        identity.authenticated(session::requireActive) {
            session.requireActive()
            feedbackBodyOrThrow(api.feedback(it, pending.cardId, FeedbackRequest(pending.action)))
                .topicAffinities
                ?.map { affinity -> ServerTopicAffinity(affinity.topicId, affinity.weight, affinity.aliases) }
                ?.let { weights -> affinities.applyServerWeights(weights) }
        }
    }

    private suspend fun flushTrackedItems(session: AnalysisSessionToken) {
        cards.pendingTrackedItems().forEach { pending ->
            session.requireActive()
            identity.authenticated(session::requireActive) { bearer ->
                session.requireActive()
                when (pending.syncAction) {
                    TRACK_UPSERT -> api.track(
                        bearer,
                        pending.cardId,
                        TrackRequest(pending.startedOn, pending.reminderDays)
                    )
                    TRACK_DELETE -> api.cancelTracking(bearer, pending.cardId)
                    else -> error("未知物品提醒同步动作")
                }
            }
            when (pending.syncAction) {
                TRACK_UPSERT -> cards.markTrackedItemSynced(pending.cardId, pending.updatedAtMillis)
                TRACK_DELETE -> cards.removeTrackedItemIfMatches(
                    pending.cardId,
                    TRACK_DELETE,
                    pending.updatedAtMillis
                )
            }
        }
    }
}

internal suspend fun completeCrashSafeCloudDeletion(
    deleteRemote: suspend () -> Unit,
    clearLocal: suspend () -> Unit,
    resetIdentity: suspend () -> Unit
) {
    deleteRemote()
    clearLocal()
    resetIdentity()
}

private const val TRACK_UPSERT = "UPSERT"
private const val TRACK_DELETE = "DELETE"
private const val MAX_CARD_PAGE_SIZE = 50
private const val MAX_CARD_SYNC_PAGES = 200

internal fun feedbackBodyOrThrow(response: retrofit2.Response<FeedbackResponse>): FeedbackResponse {
    if (!response.isSuccessful) throw retrofit2.HttpException(response)
    return response.body() ?: throw java.io.IOException("反馈接口成功响应缺少正文")
}

internal data class ValidatedCardPayload(
    val cardId: String,
    val candidateToken: String,
    val topicId: String,
    val factId: String,
    val title: String,
    val detectedObjectName: String,
    val body: String,
    val personalContext: String,
    val confidence: Double,
    val sources: List<KnowledgeSource>,
    val status: String,
    val scheduledDate: String,
    val createdAtMillis: Long
)

internal data class ValidatedCardIdentity(val cardId: String, val candidateToken: String)

internal fun cn.jianwei.data.network.CardDto.validatedIdentity(): ValidatedCardIdentity {
    fun uuid(value: String, field: String): String {
        if (!UUID_VALUE.matches(value)) throw IOException("Card contains an invalid $field")
        return value
    }

    return ValidatedCardIdentity(
        cardId = uuid(cardId, "ID"),
        candidateToken = uuid(candidateToken, "candidate token")
    )
}

internal fun cn.jianwei.data.network.CardDto.validatedForPersistence(
    identity: ValidatedCardIdentity = validatedIdentity()
): ValidatedCardPayload {

    fun identifier(value: String, field: String): String {
        if (!CARD_IDENTIFIER.matches(value)) throw IOException("Card contains an invalid $field")
        return value
    }

    fun text(value: String, field: String, maxCodePoints: Int): String {
        val normalized = value.trim()
        val length = normalized.codePointCount(0, normalized.length)
        if (length !in 1..maxCodePoints) throw IOException("Card contains an invalid $field")
        return normalized
    }

    val parsedDate = runCatching { LocalDate.parse(scheduledDate) }.getOrNull()
    if (parsedDate == null || parsedDate.toString() != scheduledDate) {
        throw IOException("Card contains an invalid scheduled date")
    }
    val createdAtMillis = runCatching { Instant.parse(createdAt).toEpochMilli() }.getOrNull()
        ?: throw IOException("Card contains an invalid creation time")
    if (!confidence.isFinite() || confidence !in 0.0..1.0) {
        throw IOException("Card contains an invalid confidence")
    }
    if (status !in CARD_STATUSES) throw IOException("Card contains an invalid status")

    return ValidatedCardPayload(
        cardId = identity.cardId,
        candidateToken = identity.candidateToken,
        topicId = identifier(topicId, "topic ID"),
        factId = identifier(factId, "fact ID"),
        title = text(title, "title", MAX_CARD_TITLE_CODE_POINTS),
        detectedObjectName = text(detectedObjectName, "object name", MAX_OBJECT_NAME_CODE_POINTS),
        body = text(body, "body", MAX_CARD_BODY_CODE_POINTS),
        personalContext = text(personalContext, "personal context", MAX_PERSONAL_CONTEXT_CODE_POINTS),
        confidence = confidence,
        sources = sources.validatedSources(),
        status = status,
        scheduledDate = scheduledDate,
        createdAtMillis = createdAtMillis
    )
}

private fun List<SourceDto>.validatedSources(): List<KnowledgeSource> {
    if (size !in 1..3) throw IOException("Card must contain between one and three sources")
    val seenIds = mutableSetOf<String>()
    return map { source ->
        val sourceId = source.sourceId.trim()
        val title = source.title.trim()
        val publisher = source.publisher.trim()
        val safeUrl = normalizedSafeKnowledgeSourceUrl(source.url)
        if (
            sourceId.isEmpty() || sourceId.length > 100 || !seenIds.add(sourceId) ||
            title.isEmpty() || title.length > 200 ||
            publisher.isEmpty() || publisher.length > 120 ||
            source.authority !in SAFE_SOURCE_AUTHORITIES ||
            safeUrl == null
        ) {
            throw IOException("Card contains an invalid knowledge source")
        }
        KnowledgeSource(sourceId, title, safeUrl, publisher, source.authority)
    }
}

private val SAFE_SOURCE_AUTHORITIES = setOf("reference", "official", "professional")
private val CARD_STATUSES = setOf("scheduled", "shown", "archived")
private val UUID_VALUE = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$")
private val CARD_IDENTIFIER = Regex("^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$")
private const val MAX_CARD_TITLE_CODE_POINTS = 60
private const val MAX_OBJECT_NAME_CODE_POINTS = 60
private const val MAX_CARD_BODY_CODE_POINTS = 240
private const val MAX_PERSONAL_CONTEXT_CODE_POINTS = 500
