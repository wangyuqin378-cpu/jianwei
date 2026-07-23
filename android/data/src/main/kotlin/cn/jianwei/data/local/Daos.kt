package cn.jianwei.data.local

import cn.jianwei.data.cards.topicAliasTokens
import cn.jianwei.domain.feedback.feedbackAffinityDelta
import cn.jianwei.domain.feedback.replaceTopicAffinity
import cn.jianwei.domain.feedback.updatedTopicAffinity
import cn.jianwei.domain.model.FeedbackAction
import cn.jianwei.domain.model.isOrdinaryCardFeedback
import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

data class PrivateCardCleanup(
    val photoLocalId: Long?,
    val cardRemoved: Boolean
)

data class OrdinaryFeedbackCommit(
    val recorded: Boolean,
    val existingAction: String?,
    val cardFound: Boolean
)

@Dao
interface PhotoDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertAll(items: List<PhotoCandidateEntity>): List<Long>

    @Upsert
    suspend fun upsert(item: PhotoCandidateEntity)

    @Query("SELECT * FROM photo_candidates WHERE analysisState = 'READY' ORDER BY qualityScore DESC, capturedAtMillis DESC LIMIT :limit")
    suspend fun candidatesForAnalysis(limit: Int): List<PhotoCandidateEntity>

    @Query("SELECT * FROM photo_candidates WHERE analysisState = 'READY' AND (:includeMediaStore = 1 OR origin != 'MEDIA_STORE') AND ((:originScope = 'MEDIA_STORE' AND origin = 'MEDIA_STORE') OR (:originScope = 'EXPLICIT_IMPORT' AND origin != 'MEDIA_STORE')) ORDER BY qualityScore DESC, capturedAtMillis DESC LIMIT :limit")
    suspend fun eligibleCandidatesForAnalysis(limit: Int, includeMediaStore: Int, originScope: String): List<PhotoCandidateEntity>

    @Query("UPDATE photo_candidates SET analysisState = 'READY' WHERE localId IN (SELECT localId FROM photo_candidates WHERE analysisState = 'DEFERRED' AND (:includeMediaStore = 1 OR origin != 'MEDIA_STORE') AND ((:originScope = 'MEDIA_STORE' AND origin = 'MEDIA_STORE') OR (:originScope = 'EXPLICIT_IMPORT' AND origin != 'MEDIA_STORE')) ORDER BY qualityScore DESC, capturedAtMillis DESC LIMIT :limit)")
    suspend fun promoteDeferred(limit: Int, includeMediaStore: Int, originScope: String): Int

    @Query("SELECT * FROM photo_candidates WHERE analysisState = 'DISCOVERED' ORDER BY capturedAtMillis DESC LIMIT :limit")
    suspend fun discoveredForPrivacy(limit: Int): List<PhotoCandidateEntity>

    @Query("SELECT * FROM photo_candidates WHERE analysisState = 'ACCESS_UNAVAILABLE' AND origin = 'MEDIA_STORE' ORDER BY capturedAtMillis DESC LIMIT :limit")
    suspend fun unavailableMediaForRecheck(limit: Int): List<PhotoCandidateEntity>

    @Query("SELECT * FROM photo_candidates WHERE localId = :localId LIMIT 1")
    suspend fun findById(localId: Long): PhotoCandidateEntity?

    @Query("SELECT * FROM photo_candidates WHERE candidateToken = :candidateToken LIMIT 1")
    suspend fun findByToken(candidateToken: String): PhotoCandidateEntity?

    @Query("SELECT * FROM photo_candidates WHERE sourceDigest = :sourceDigest LIMIT 1")
    suspend fun findBySourceDigest(sourceDigest: String): PhotoCandidateEntity?

    @Query("SELECT * FROM photo_candidates WHERE perceptualHash IS NOT NULL AND analysisState IN ('READY', 'DEFERRED', 'QUEUED', 'COMPLETED', 'NEVER_ANALYZE')")
    suspend fun candidatesForDuplicateBaseline(): List<PhotoCandidateEntity>

    @Query("SELECT * FROM media_scan_cursors WHERE accessScope = :accessScope LIMIT 1")
    suspend fun mediaScanCursor(accessScope: String): MediaScanCursorEntity?

    @Upsert
    suspend fun upsertMediaScanCursor(cursor: MediaScanCursorEntity)

    @Query("DELETE FROM media_scan_cursors")
    suspend fun clearMediaScanCursors()

    @Query("UPDATE photo_candidates SET analysisState = :state, perceptualHash = :hash, qualityScore = :quality, localLabels = :labels, sensitiveFlags = :flags WHERE localId = :localId")
    suspend fun updateAnalysis(localId: Long, state: String, hash: Long?, quality: Double, labels: List<String>, flags: Set<String>)

    @Query("UPDATE photo_candidates SET analysisState = 'NEVER_ANALYZE' WHERE localId = :localId")
    suspend fun markNeverAnalyze(localId: Long)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun suppress(item: SuppressedPhotoEntity)

    @Query("SELECT EXISTS(SELECT 1 FROM suppressed_photos WHERE localId = :localId)")
    suspend fun isSuppressed(localId: Long): Boolean

    @Query("SELECT localId FROM suppressed_photos WHERE localId IN (:localIds)")
    suspend fun suppressedIds(localIds: List<Long>): List<Long>

    @Query("SELECT contentUri FROM photo_candidates WHERE origin != 'MEDIA_STORE'")
    suspend fun importedContentUris(): List<String>

    @Query("UPDATE photo_candidates SET contentUri = '' WHERE localId = :localId")
    suspend fun clearImportedContentUri(localId: Long)

    @Query("UPDATE photo_candidates SET modifiedAtMillis = :updatedAtMillis WHERE localId = :localId")
    suspend fun touchImportedCopy(localId: Long, updatedAtMillis: Long)

    @Query("SELECT * FROM photo_candidates WHERE origin != 'MEDIA_STORE' AND contentUri != '' AND ((analysisState = 'COMPLETED' AND modifiedAtMillis < :sanitizedCutoffMillis) OR (analysisState != 'COMPLETED' AND modifiedAtMillis < :rawCutoffMillis))")
    suspend fun expiredImportedCopies(rawCutoffMillis: Long, sanitizedCutoffMillis: Long): List<PhotoCandidateEntity>

    @Query("UPDATE photo_candidates SET contentUri = '', analysisState = 'FILTERED' WHERE localId IN (:localIds)")
    suspend fun expireImportedCopies(localIds: List<Long>)

    @Query("DELETE FROM photo_candidates")
    suspend fun clear()
}

@Dao
interface CardDao {
    @Query("SELECT * FROM knowledge_cards ORDER BY scheduledDate ASC, createdAtMillis ASC")
    fun observeAll(): Flow<List<CardEntity>>

    @Query(
        "SELECT cards.* FROM knowledge_cards AS cards " +
            "INNER JOIN saved_cards AS saved ON saved.cardId = cards.cardId " +
            "WHERE saved.isSaved = 1 ORDER BY saved.savedAtMillis DESC, cards.cardId ASC"
    )
    fun observeSavedCards(): Flow<List<CardEntity>>

    @Query("SELECT * FROM knowledge_cards WHERE status = 'scheduled' AND scheduledDate <= :today ORDER BY scheduledDate DESC, createdAtMillis DESC LIMIT 1")
    suspend fun currentForWidget(today: String): CardEntity?

    @Query("SELECT * FROM knowledge_cards WHERE cardId = :cardId LIMIT 1")
    suspend fun findById(cardId: String): CardEntity?

    @Query("SELECT * FROM knowledge_cards WHERE status = 'scheduled' AND scheduledDate > :today ORDER BY scheduledDate ASC, createdAtMillis ASC, cardId ASC LIMIT :limit")
    suspend fun futureForWidget(today: String, limit: Int): List<CardEntity>

    @Query("SELECT COUNT(*) FROM knowledge_cards WHERE scheduledDate >= :today AND status = 'scheduled'")
    suspend fun countFutureCards(today: String): Int

    @Upsert
    suspend fun upsertAll(items: List<CardEntity>)

    @Query("SELECT * FROM card_feedback_states ORDER BY submittedAtMillis DESC, cardId ASC")
    fun observeFeedbackStates(): Flow<List<CardFeedbackStateEntity>>

    @Query("SELECT * FROM card_feedback_states WHERE cardId = :cardId LIMIT 1")
    suspend fun findFeedbackState(cardId: String): CardFeedbackStateEntity?

    @Upsert
    suspend fun upsertFeedbackState(item: CardFeedbackStateEntity)

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun enqueueFeedback(item: PendingFeedbackEntity)

    @Transaction
    suspend fun commitOrdinaryFeedback(
        cardId: String,
        action: String,
        nowMillis: Long
    ): OrdinaryFeedbackCommit {
        val ordinaryAction = runCatching { FeedbackAction.valueOf(action) }
            .getOrNull()
            ?.takeIf { it.isOrdinaryCardFeedback() }
            ?: throw IllegalArgumentException(
                "Only LIKE, DISLIKE or WRONG_OBJECT can be stored as ordinary card feedback"
            )
        val card = findById(cardId)
            ?: return OrdinaryFeedbackCommit(recorded = false, existingAction = null, cardFound = false)
        val existing = findFeedbackState(cardId)
        if (existing != null) {
            return OrdinaryFeedbackCommit(
                recorded = false,
                existingAction = existing.action,
                cardFound = true
            )
        }
        upsertFeedbackState(CardFeedbackStateEntity(cardId, action, nowMillis))
        enqueueFeedback(PendingFeedbackEntity(cardId = cardId, action = action, createdAtMillis = nowMillis))
        if (feedbackAffinityDelta(ordinaryAction) != 0.0) {
            val current = findTopicAffinity(card.topicId)
            upsertTopicAffinity(
                TopicAffinityEntity(
                    topicId = card.topicId,
                    weight = updatedTopicAffinity(current?.weight ?: 0.0, ordinaryAction),
                    aliases = (current?.aliases.orEmpty() + topicAliasTokens(card.topicId, card.title))
                        .distinct()
                        .take(12),
                    updatedAtMillis = nowMillis
                )
            )
        }
        return OrdinaryFeedbackCommit(recorded = true, existingAction = action, cardFound = true)
    }

    @Query("SELECT * FROM photo_candidates WHERE candidateToken = :candidateToken LIMIT 1")
    suspend fun findPhotoForPrivateCleanup(candidateToken: String): PhotoCandidateEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun suppressPhotoForPrivateCleanup(item: SuppressedPhotoEntity)

    @Query("UPDATE photo_candidates SET analysisState = 'NEVER_ANALYZE' WHERE localId = :localId")
    suspend fun markPhotoNeverAnalyzeForPrivateCleanup(localId: Long)

    @Query("SELECT * FROM saved_cards WHERE cardId = :cardId LIMIT 1")
    suspend fun findSavedCard(cardId: String): SavedCardEntity?

    @Upsert
    suspend fun upsertSavedCard(item: SavedCardEntity)

    @Transaction
    suspend fun setCardSaved(cardId: String, saved: Boolean, nowMillis: Long): Boolean {
        val card = findById(cardId) ?: return false
        val current = findSavedCard(cardId)
        if (!saved && current == null) return false
        val shouldSignal = saved && current?.feedbackSignaled != true
        upsertSavedCard(
            SavedCardEntity(
                cardId = cardId,
                isSaved = saved,
                feedbackSignaled = current?.feedbackSignaled == true || shouldSignal,
                savedAtMillis = if (saved && current?.isSaved != true) nowMillis else current?.savedAtMillis ?: nowMillis,
                updatedAtMillis = nowMillis
            )
        )
        if (shouldSignal) {
            enqueueFeedback(
                PendingFeedbackEntity(
                    cardId = cardId,
                    action = "SAVE",
                    createdAtMillis = nowMillis
                )
            )
            val affinity = findTopicAffinity(card.topicId)
            upsertTopicAffinity(
                TopicAffinityEntity(
                    topicId = card.topicId,
                    weight = updatedTopicAffinity(
                        affinity?.weight ?: 0.0,
                        FeedbackAction.SAVE
                    ),
                    aliases = (affinity?.aliases.orEmpty() + topicAliasTokens(card.topicId, card.title))
                        .distinct()
                        .take(12),
                    updatedAtMillis = nowMillis
                )
            )
        }
        return shouldSignal
    }

    @Query("SELECT * FROM pending_feedback ORDER BY createdAtMillis ASC LIMIT :limit")
    suspend fun pendingFeedback(limit: Int = 50): List<PendingFeedbackEntity>

    @Query("SELECT * FROM pending_feedback WHERE action = :action ORDER BY createdAtMillis ASC, id ASC")
    suspend fun pendingFeedbackByAction(action: String): List<PendingFeedbackEntity>

    @Query("SELECT * FROM pending_feedback WHERE action != 'TOO_PRIVATE' ORDER BY createdAtMillis ASC LIMIT :limit")
    suspend fun pendingNonPrivateFeedback(limit: Int = 50): List<PendingFeedbackEntity>

    @Query("DELETE FROM pending_feedback WHERE id = :id")
    suspend fun removeFeedback(id: Long)

    @Query("DELETE FROM pending_feedback WHERE cardId = :cardId AND action != 'TOO_PRIVATE'")
    suspend fun removeNonPrivateFeedbackForCard(cardId: String): Int

    @Query("DELETE FROM pending_feedback")
    suspend fun clearPendingFeedback()

    @Upsert
    suspend fun upsertTrackedItem(item: TrackedItemEntity)

    @Query("SELECT * FROM local_tracked_items WHERE syncAction != 'DELETE' ORDER BY updatedAtMillis DESC")
    fun observeTrackedItems(): Flow<List<TrackedItemEntity>>

    @Query("SELECT * FROM local_tracked_items WHERE cardId = :cardId LIMIT 1")
    suspend fun findTrackedItem(cardId: String): TrackedItemEntity?

    @Query("SELECT * FROM local_tracked_items WHERE syncAction != 'NONE' ORDER BY updatedAtMillis ASC LIMIT :limit")
    suspend fun pendingTrackedItems(limit: Int = 50): List<TrackedItemEntity>

    @Query("UPDATE local_tracked_items SET syncAction = 'NONE' WHERE cardId = :cardId AND syncAction = 'UPSERT' AND updatedAtMillis = :expectedUpdatedAtMillis")
    suspend fun markTrackedItemSynced(cardId: String, expectedUpdatedAtMillis: Long): Int

    @Query("DELETE FROM local_tracked_items WHERE cardId = :cardId AND syncAction = :expectedAction AND updatedAtMillis = :expectedUpdatedAtMillis")
    suspend fun removeTrackedItemIfMatches(cardId: String, expectedAction: String, expectedUpdatedAtMillis: Long): Int

    @Query("DELETE FROM local_tracked_items WHERE cardId = :cardId")
    suspend fun removeTrackedItem(cardId: String)

    @Query("DELETE FROM local_tracked_items")
    suspend fun clearTrackedItems()

    @Query("DELETE FROM knowledge_cards")
    suspend fun clear()

    @Transaction
    suspend fun clearCloudState() {
        clearPendingFeedback()
        clearTrackedItems()
        clear()
    }

    @Query("UPDATE knowledge_cards SET photoUri = '' WHERE photoUri != ''")
    suspend fun clearPhotoUris(): Int

    @Query("DELETE FROM knowledge_cards WHERE cardId = :cardId")
    suspend fun deleteById(cardId: String)

    @Transaction
    suspend fun stagePrivateFeedbackAndDelete(cardId: String, nowMillis: Long): PrivateCardCleanup {
        val card = findById(cardId)
        val priorFeedback = findFeedbackState(cardId)
        val priorSave = findSavedCard(cardId)
        val photo = card?.let { findPhotoForPrivateCleanup(it.candidateToken) }
        // This transaction is the local privacy commit point. After it returns, a process death
        // can leave only a private-storage file awaiting cleanup; the photo cannot be scanned or
        // uploaded, the card cannot be displayed, and the server barrier cannot be lost.
        if (card != null) {
            val previousActions = buildList {
                val ordinaryAction = priorFeedback?.action
                    ?.let { stored -> runCatching { FeedbackAction.valueOf(stored) }.getOrNull() }
                if (ordinaryAction?.isOrdinaryCardFeedback() == true) {
                    add(ordinaryAction)
                }
                if (priorSave?.feedbackSignaled == true) add(FeedbackAction.SAVE)
            }
            val current = findTopicAffinity(card.topicId)
            upsertTopicAffinity(
                TopicAffinityEntity(
                    topicId = card.topicId,
                    weight = replaceTopicAffinity(
                        current = current?.weight ?: 0.0,
                        previousActions = previousActions,
                        nextAction = FeedbackAction.TOO_PRIVATE
                    ),
                    aliases = (current?.aliases.orEmpty() + topicAliasTokens(card.topicId, card.title))
                        .distinct()
                        .take(12),
                    updatedAtMillis = nowMillis
                )
            )
        }
        enqueueFeedback(
            PendingFeedbackEntity(
                cardId = cardId,
                action = "TOO_PRIVATE",
                createdAtMillis = nowMillis
            )
        )
        if (photo != null) {
            suppressPhotoForPrivateCleanup(SuppressedPhotoEntity(photo.localId, nowMillis))
            markPhotoNeverAnalyzeForPrivateCleanup(photo.localId)
        }
        removeTrackedItem(cardId)
        removeNonPrivateFeedbackForCard(cardId)
        deleteById(cardId)
        return PrivateCardCleanup(photo?.localId, cardRemoved = card != null)
    }

    @Transaction
    suspend fun deletePrivateCardState(cardId: String) {
        removeTrackedItem(cardId)
        removeNonPrivateFeedbackForCard(cardId)
        deleteById(cardId)
    }

    @Query("SELECT * FROM topic_affinities WHERE topicId = :topicId LIMIT 1")
    suspend fun findTopicAffinity(topicId: String): TopicAffinityEntity?

    @Query("SELECT * FROM topic_affinities ORDER BY topicId ASC")
    suspend fun topicAffinities(): List<TopicAffinityEntity>

    @Upsert
    suspend fun upsertTopicAffinity(affinity: TopicAffinityEntity)
}
