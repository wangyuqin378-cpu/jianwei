package cn.jianwei.domain.repository

import cn.jianwei.domain.model.AnalysisProgress
import cn.jianwei.domain.model.AnalysisState
import cn.jianwei.domain.model.CardFeedbackState
import cn.jianwei.domain.model.FeedbackAction
import cn.jianwei.domain.model.FeedbackSubmissionResult
import cn.jianwei.domain.model.KnowledgeCard
import cn.jianwei.domain.model.PhotoCandidate
import cn.jianwei.domain.model.ScanRequest
import cn.jianwei.domain.model.ScanResult
import cn.jianwei.domain.model.TrackedItem
import java.time.LocalDate
import kotlinx.coroutines.flow.Flow

interface PhotoRepository {
    suspend fun scanRecent(request: ScanRequest): ScanResult
    suspend fun importUris(uris: List<String>): List<PhotoCandidate>
    suspend fun candidatesForAnalysis(limit: Int): List<PhotoCandidate>
    suspend fun updateAnalysis(
        localId: Long,
        state: AnalysisState,
        perceptualHash: Long? = null,
        qualityScore: Double? = null,
        labels: List<String>? = null,
        sensitiveFlags: Set<String>? = null
    )
    suspend fun markNeverAnalyze(localId: Long)
    suspend fun replaceImportedCopyWithSanitized(localId: Long, bytes: ByteArray)
    suspend fun discardImportedCopy(localId: Long)
    suspend fun purgeExpiredImportedCopies(now: java.time.Instant): Int
    suspend fun clearIndex()
}

interface CardRepository {
    fun observeCards(): Flow<List<KnowledgeCard>>
    fun observeSavedCards(): Flow<List<KnowledgeCard>>
    fun observeTrackedItems(): Flow<List<TrackedItem>>
    fun observeFeedbackStates(): Flow<List<CardFeedbackState>>
    suspend fun syncCards()
    suspend fun sendFeedback(cardId: String, action: FeedbackAction): FeedbackSubmissionResult
    suspend fun setSaved(cardId: String, saved: Boolean): Boolean
    suspend fun track(cardId: String, startedOn: LocalDate, reminderDays: Int)
    suspend fun isTrackedReminderCurrent(
        cardId: String,
        startedOn: LocalDate,
        reminderDays: Int
    ): Boolean
    suspend fun cancelTracking(cardId: String)
    suspend fun clearCloudData()
    suspend fun clearLocalCards()
    suspend fun clearLocalPhotoReferences()
}

interface AnalysisScheduler {
    fun scheduleInitialScan(access: cn.jianwei.domain.model.PhotoAccess)
    fun scheduleAccessReconciliation(access: cn.jianwei.domain.model.PhotoAccess)
    fun scheduleImportedPhotos()
    fun scheduleDailyRefresh()
    suspend fun stopAutomaticDiscovery()
    fun isPaused(): Boolean
    fun setPaused(paused: Boolean)
    suspend fun pauseAndCancel()
    fun cancelAll()
}

interface AnalysisStatusRepository {
    fun observeProgress(): Flow<AnalysisProgress>
    fun publishProgress(progress: AnalysisProgress)
}
