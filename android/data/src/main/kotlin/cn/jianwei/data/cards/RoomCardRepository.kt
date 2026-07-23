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
import cn.jianwei.domain.model.FeedbackAction
import cn.jianwei.domain.model.FeedbackSubmissionResult
import cn.jianwei.domain.model.KnowledgeCard
import cn.jianwei.domain.model.KnowledgeSource
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
    private val affinities: LocalTopicAffinityStore
) : CardRepository {
    private val trackedItemMutex = Mutex()
    override fun observeCards(): Flow<List<KnowledgeCard>> = cards.observeAll().map { list -> list.map { it.toDomain() } }
    override fun observeSavedCards(): Flow<List<KnowledgeCard>> = cards.observeSavedCards().map { list ->
        list.map { it.toDomain() }
    }
    override fun observeTrackedItems(): Flow<List<TrackedItem>> = cards.observeTrackedItems().map { items ->
        items.map { TrackedItem(it.cardId, LocalDate.parse(it.startedOn), it.reminderDays) }
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
                    if (dto.cardId in privacyCardIds) return@forEach
                    val candidate = photos.findByToken(dto.candidateToken)
                    if (candidate?.analysisState == AnalysisState.NEVER_ANALYZE.name) return@forEach
                    val photoUri = candidate?.contentUri.orEmpty()
                    val sources = dto.sources.validatedSources()
                    val entity = CardEntity(
                        cardId = dto.cardId,
                        candidateToken = dto.candidateToken,
                        photoUri = photoUri,
                        topicId = dto.topicId,
                        factId = dto.factId,
                        title = dto.title,
                        detectedObjectName = dto.detectedObjectName,
                        body = dto.body,
                        personalContext = dto.personalContext,
                        confidence = dto.confidence,
                        sources = sourcesToJson(sources),
                        status = dto.status,
                        scheduledDate = dto.scheduledDate,
                        createdAtMillis = Instant.parse(dto.createdAt).toEpochMilli()
                    )
                    if (entitiesById.putIfAbsent(dto.cardId, entity) != null) {
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
        acknowledgePrivacyFeedback(privacyFeedback)
        flushFeedback(session)
        flushTrackedItems(session)
    }

    override suspend fun sendFeedback(
        cardId: String,
        action: FeedbackAction
    ): FeedbackSubmissionResult = sessionGate.withActiveSession { session ->
        session.requireActive()
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

    override suspend fun setSaved(cardId: String, saved: Boolean): Boolean =
        sessionGate.withActiveSession { session ->
            session.requireActive()
            cards.setCardSaved(cardId, saved, System.currentTimeMillis())
        }

    private suspend fun markPhotoNeverAnalyzeLocally(cardId: String): PrivateCardCleanup {
        // Room atomically commits the feedback state, affinity replacement, privacy outbox,
        // suppression and card deletion. Only the private file cleanup remains as an idempotent
        // follow-up, so process death cannot reopen display, scanning or upload.
        val cleanup = cards.stagePrivateFeedbackAndDelete(cardId, System.currentTimeMillis())
        cleanup.photoLocalId?.let { photoRepository.markNeverAnalyze(it) }
        return cleanup
    }

    override suspend fun track(cardId: String, startedOn: LocalDate, reminderDays: Int) = trackedItemMutex.withLock {
        require(reminderDays in 7..730)
        val previousVersion = cards.findTrackedItem(cardId)?.updatedAtMillis ?: 0L
        cards.upsertTrackedItem(
            TrackedItemEntity(
                cardId = cardId,
                startedOn = startedOn.toString(),
                reminderDays = reminderDays,
                syncAction = TRACK_UPSERT,
                updatedAtMillis = maxOf(System.currentTimeMillis(), previousVersion + 1)
            )
        )
    }

    override suspend fun cancelTracking(cardId: String) = trackedItemMutex.withLock {
        val existing = cards.findTrackedItem(cardId) ?: return
        cards.upsertTrackedItem(
            existing.copy(
                syncAction = TRACK_DELETE,
                updatedAtMillis = maxOf(System.currentTimeMillis(), existing.updatedAtMillis + 1)
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

    private suspend fun acknowledgePrivacyFeedback(pending: List<PendingFeedbackEntity>) {
        pending.forEach { item ->
            markPhotoNeverAnalyzeLocally(item.cardId)
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
