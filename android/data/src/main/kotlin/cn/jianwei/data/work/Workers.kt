package cn.jianwei.data.work

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkerParameters
import androidx.work.WorkManager
import cn.jianwei.data.local.PhotoDao
import cn.jianwei.data.local.CardDao
import cn.jianwei.data.local.toDomain
import cn.jianwei.data.cards.LocalTopicAffinityStore
import cn.jianwei.data.control.AnalysisStoppedException
import cn.jianwei.data.network.AuthenticationExpiredException
import cn.jianwei.data.network.RemoteAnalysisClient
import cn.jianwei.data.network.UploadHttpStatusException
import cn.jianwei.data.photos.PrivacyFilter
import cn.jianwei.data.photos.PhotoPermissionGate
import cn.jianwei.data.preferences.SharedPreferencesAutomaticDailyUploadQuota
import cn.jianwei.domain.card.CardSupplyMode
import cn.jianwei.domain.card.DailyAutomaticUploadClaim
import cn.jianwei.domain.card.cardSupplyPlan
import cn.jianwei.domain.card.isAutomatic
import cn.jianwei.domain.card.privacyBatchPlan
import cn.jianwei.domain.card.privacySelectionLimit
import cn.jianwei.domain.card.shouldContinueCardSupply
import cn.jianwei.domain.card.shouldContinuePrivacyBatch
import cn.jianwei.domain.card.shouldRunPrivacyBatch
import cn.jianwei.domain.card.shouldSyncCardsImmediately
import cn.jianwei.domain.card.toSupplyMode
import cn.jianwei.domain.model.AnalysisPhase
import cn.jianwei.domain.model.AnalysisProgress
import cn.jianwei.domain.model.AnalysisProgressScope
import cn.jianwei.domain.model.AnalysisState
import cn.jianwei.domain.model.PhotoAccess
import cn.jianwei.domain.model.PhotoOrigin
import cn.jianwei.domain.model.ScanRequest
import cn.jianwei.domain.preferences.expandedInterestTerms
import cn.jianwei.domain.ranking.CandidateRanker
import cn.jianwei.domain.time.ChinaCalendar
import cn.jianwei.domain.repository.CardRepository
import cn.jianwei.domain.repository.AnalysisStatusRepository
import cn.jianwei.domain.repository.AutomaticCardModeRepository
import cn.jianwei.domain.repository.InterestPreferencesRepository
import cn.jianwei.domain.repository.PhotoRepository
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import java.io.IOException
import java.time.Duration
import java.time.Instant
import kotlinx.coroutines.CancellationException
import retrofit2.HttpException

@HiltWorker
class ScanWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val photos: PhotoRepository,
    private val permissionGate: PhotoPermissionGate,
    private val status: AnalysisStatusRepository
) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        if (applicationContext.analysisIsPaused()) return Result.success()
        status.publishProgress(AUTOMATIC_PROGRESS, AnalysisProgress(phase = AnalysisPhase.SCANNING))
        val requestedAccess = runCatching { PhotoAccess.valueOf(inputData.getString(KEY_ACCESS) ?: PhotoAccess.PICKER_ONLY.name) }
            .getOrDefault(PhotoAccess.PICKER_ONLY)
        val access = effectiveScanAccess(requestedAccess, permissionGate.currentAccess()) ?: run {
            status.publishProgress(AUTOMATIC_PROGRESS, AnalysisProgress(phase = AnalysisPhase.IDLE))
            return Result.success()
        }
        return runCatching {
            val result = photos.scanRecent(ScanRequest(Instant.now().minus(Duration.ofDays(90)), 500, access))
            status.publishProgress(
                AUTOMATIC_PROGRESS,
                AnalysisProgress(phase = AnalysisPhase.FILTERING, discoveredCount = result.discovered)
            )
            Result.success()
        }.getOrElse { error ->
            if (error is SecurityException) {
                status.publishProgress(AUTOMATIC_PROGRESS, AnalysisProgress(phase = AnalysisPhase.IDLE))
                Result.success()
            } else {
                val willRetry = runAttemptCount < MAX_WORK_ATTEMPTS - 1
                status.publishProgress(AUTOMATIC_PROGRESS, analysisFailureProgress(willRetry, null))
                if (willRetry) Result.retry() else Result.failure()
            }
        }
    }

    companion object { const val KEY_ACCESS = "photo_access" }
}

internal fun effectiveScanAccess(requested: PhotoAccess, current: PhotoAccess): PhotoAccess? = when {
    requested == PhotoAccess.PICKER_ONLY || current == PhotoAccess.PICKER_ONLY -> null
    requested == PhotoAccess.PARTIAL || current == PhotoAccess.PARTIAL -> PhotoAccess.PARTIAL
    else -> PhotoAccess.FULL
}

@HiltWorker
class PrivacyScanWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val dao: PhotoDao,
    private val cardDao: CardDao,
    private val photos: PhotoRepository,
    private val privacyFilter: PrivacyFilter,
    private val permissionGate: PhotoPermissionGate,
    private val affinities: LocalTopicAffinityStore,
    private val interestPreferences: InterestPreferencesRepository,
    private val automaticCardMode: AutomaticCardModeRepository,
    private val automaticDailyUploadQuota: SharedPreferencesAutomaticDailyUploadQuota,
    private val status: AnalysisStatusRepository,
    private val privacyExecutionGate: PrivacyExecutionGate
) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val originScope = parseUploadOriginScope(inputData.getString(KEY_ORIGIN_SCOPE)) ?: run {
            status.publishInvalidScopeFailure()
            return Result.failure()
        }
        return privacyExecutionGate.run(originScope) { runPrivacyWork(originScope) }
    }

    private suspend fun runPrivacyWork(originScope: UploadOriginScope): Result {
        if (applicationContext.analysisIsPaused()) return Result.success()
        val progressScope = originScope.analysisProgressScope()
        val supplyMode = when (originScope) {
            UploadOriginScope.MEDIA_STORE -> automaticCardMode.mode().toSupplyMode()
            UploadOriginScope.EXPLICIT_IMPORT -> CardSupplyMode.EXPLICIT_IMPORT
        }
        val currentCachedCards = if (supplyMode.isAutomatic()) {
            cardDao.countFutureCards(ChinaCalendar.today().toString())
        } else {
            0
        }
        val dailyAutomaticUploadClaimed = supplyMode == CardSupplyMode.AUTOMATIC_DAILY_ONE &&
            automaticDailyUploadQuota.hasClaim(ChinaCalendar.today())
        if (!shouldRunPrivacyBatch(supplyMode, currentCachedCards, dailyAutomaticUploadClaimed)) {
            status.publishProgress(
                progressScope,
                completedAnalysisProgress(currentCachedCards, processedCount = 0)
            )
            return Result.success()
        }
        status.publishProgress(progressScope, AnalysisProgress(phase = AnalysisPhase.FILTERING))
        photos.purgeExpiredImportedCopies(Instant.now())
        val batchPlan = privacyBatchPlan(supplyMode)
        // Partial-photo grants are per item. Keep inaccessible rows out of the hot queue, while
        // opportunistically restoring rows that became readable after the user expanded access.
        if (originScope == UploadOriginScope.MEDIA_STORE) {
            dao.unavailableMediaForRecheck(MAX_ACCESS_RECHECKS).forEach { entity ->
                if (permissionGate.canReadMediaStoreItem(entity.contentUri)) {
                    photos.updateAnalysis(entity.localId, AnalysisState.DISCOVERED)
                }
            }
        }
        val ranker = CandidateRanker()
        val baselineHashes = dao.candidatesForDuplicateBaseline()
            .mapNotNull { it.perceptualHash }
        val analyzed = mutableListOf<cn.jianwei.domain.model.PhotoCandidate>()
        var inspectedCandidates = 0
        var uniqueEligibleCandidates = 0
        for (entity in dao.discoveredForPrivacy(MAX_PRIVACY_QUEUE_INSPECTIONS, originScope.name)) {
            if (!shouldContinuePrivacyBatch(batchPlan, inspectedCandidates, uniqueEligibleCandidates)) break
            inspectedCandidates += 1
            if (entity.origin == PhotoOrigin.MEDIA_STORE.name &&
                !permissionGate.canReadMediaStoreItem(entity.contentUri)
            ) {
                photos.updateAnalysis(entity.localId, AnalysisState.ACCESS_UNAVAILABLE)
                continue
            }
            val result = try {
                privacyFilter.analyze(entity.contentUri, entity.sensitiveFlags)
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                if (error is SecurityException && entity.origin == PhotoOrigin.MEDIA_STORE.name) {
                    photos.updateAnalysis(entity.localId, AnalysisState.ACCESS_UNAVAILABLE)
                    continue
                }
                if (shouldRetryPrivacyAnalysisFailure(runAttemptCount)) {
                    status.publishProgress(
                        progressScope,
                        analysisFailureProgress(retrying = true, statusCode = null)
                    )
                    return Result.retry()
                }
                photos.updateAnalysis(entity.localId, AnalysisState.FAILED)
                photos.discardImportedCopy(entity.localId)
                continue
            }
            run {
                val state = if (result.sensitiveFlags.isEmpty() && result.qualityScore >= 0.35) AnalysisState.READY else AnalysisState.FILTERED
                photos.updateAnalysis(
                    entity.localId,
                    state,
                    result.perceptualHash,
                    result.qualityScore,
                    result.labels,
                    result.sensitiveFlags
                )
                analyzed += entity.copy(
                    perceptualHash = result.perceptualHash,
                    qualityScore = result.qualityScore,
                    localLabels = result.labels,
                    sensitiveFlags = result.sensitiveFlags,
                    analysisState = state.name
                ).toDomain()
                if (state == AnalysisState.FILTERED) photos.discardImportedCopy(entity.localId)
                if (state == AnalysisState.READY) {
                    uniqueEligibleCandidates = ranker.uniqueEligibleCount(analyzed, baselineHashes)
                }
            }
        }
        val interests = expandedInterestTerms(interestPreferences.selected())
        val rankingNow = Instant.now()
        val duplicateIds = ranker.nearDuplicateIds(analyzed, baselineHashes)
        analyzed.filter { it.localId in duplicateIds }.forEach {
            photos.updateAnalysis(it.localId, AnalysisState.FILTERED)
            photos.discardImportedCopy(it.localId)
        }
        val unique = analyzed.filterNot { it.localId in duplicateIds }
        val selected = ranker.rank(
            unique,
            interests,
            now = rankingNow,
            limit = privacySelectionLimit(supplyMode),
            topicAffinities = affinities.signals(),
            serendipitySeed = automaticSerendipitySeed(originScope, rankingNow)
        ).map { it.localId }.toSet()
        unique.filter { it.analysisState == AnalysisState.READY && it.localId !in selected }
            .forEach { photos.updateAnalysis(it.localId, AnalysisState.DEFERRED) }
        status.publishProgress(
            progressScope,
            AnalysisProgress(phase = AnalysisPhase.SYNCING, eligibleCount = selected.size)
        )
        return Result.success()
    }

    companion object { const val KEY_ORIGIN_SCOPE = "origin_scope" }
}

@HiltWorker
class UploadWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val photos: PhotoRepository,
    private val photoDao: PhotoDao,
    private val cardDao: CardDao,
    private val remote: RemoteAnalysisClient,
    private val cards: CardRepository,
    private val permissionGate: PhotoPermissionGate,
    private val deferredCandidates: DeferredCandidateSelector,
    private val status: AnalysisStatusRepository,
    private val automaticCardMode: AutomaticCardModeRepository,
    private val automaticDailyUploadQuota: SharedPreferencesAutomaticDailyUploadQuota,
    private val uploadExecutionGate: UploadExecutionGate
) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = uploadExecutionGate.runExclusive {
        runUploadWork()
    }

    private suspend fun runUploadWork(): Result {
        if (applicationContext.analysisIsPaused()) return Result.success()
        photos.purgeExpiredImportedCopies(Instant.now())
        val originScope = parseUploadOriginScope(inputData.getString(KEY_ORIGIN_SCOPE)) ?: run {
            status.publishInvalidScopeFailure()
            return Result.failure()
        }
        val progressScope = originScope.analysisProgressScope()
        status.publishProgress(progressScope, AnalysisProgress(phase = AnalysisPhase.SYNCING))
        val includeMediaStore = if (permissionGate.canReadMediaStore()) 1 else 0
        return try {
            cards.syncCards()
            val today = ChinaCalendar.today().toString()
            val supplyMode = when (originScope) {
                UploadOriginScope.MEDIA_STORE -> automaticCardMode.mode().toSupplyMode()
                UploadOriginScope.EXPLICIT_IMPORT -> CardSupplyMode.EXPLICIT_IMPORT
            }
            val claimedDailyCandidateId = if (supplyMode == CardSupplyMode.AUTOMATIC_DAILY_ONE) {
                automaticDailyUploadQuota.claimedCandidate(ChinaCalendar.today())
            } else {
                null
            }
            val hadAnyLocalCardAtStart = cardDao.countCards() > 0
            var immediateSyncCompleted = false
            val supplyPlan = cardSupplyPlan(supplyMode, cardDao.countFutureCards(today))
            var processed = 0
            supplyLoop@ while (supplyPlan != null && shouldContinueCardSupply(
                    supplyPlan,
                    cardDao.countFutureCards(today),
                    processed
                )) {
                val remaining = supplyPlan.maxCandidates - processed
                var candidates = if (claimedDailyCandidateId != null) {
                    listOfNotNull(photoDao.eligibleCandidateForAnalysis(
                        claimedDailyCandidateId,
                        includeMediaStore,
                        originScope.name
                    )).map { it.toDomain() }
                } else {
                    photoDao.eligibleCandidatesForAnalysis(
                        minOf(BATCH_SIZE, remaining),
                        includeMediaStore,
                        originScope.name
                    ).map { it.toDomain() }
                }
                if (candidates.isEmpty()) {
                    if (claimedDailyCandidateId != null) break
                    val promoted = deferredCandidates.promote(
                        limit = minOf(BATCH_SIZE, remaining),
                        includeMediaStore = includeMediaStore,
                        originScope = originScope
                    )
                    if (promoted == 0) break
                    candidates = photoDao.eligibleCandidatesForAnalysis(
                        minOf(BATCH_SIZE, remaining),
                        includeMediaStore,
                        originScope.name
                    ).map { it.toDomain() }
                }
                for (candidate in candidates) {
                    if (candidate.origin == PhotoOrigin.MEDIA_STORE &&
                        !permissionGate.canReadMediaStoreItem(candidate.contentUri)
                    ) {
                        photos.updateAnalysis(candidate.localId, AnalysisState.ACCESS_UNAVAILABLE)
                        processed += 1
                        continue
                    }
                    if (supplyMode == CardSupplyMode.AUTOMATIC_DAILY_ONE &&
                        automaticDailyUploadQuota.claim(
                            day = ChinaCalendar.today(),
                            candidateLocalId = candidate.localId
                        ) ==
                        DailyAutomaticUploadClaim.EXHAUSTED
                    ) {
                        break@supplyLoop
                    }
                    try {
                        val analyzed = remote.analyze(candidate)
                        val response = analyzed.response
                        if (response.status == "completed") {
                            photos.replaceImportedCopyWithSanitized(candidate.localId, analyzed.sanitizedBytes)
                        } else {
                            photos.discardImportedCopy(candidate.localId)
                        }
                        photos.updateAnalysis(
                            candidate.localId,
                            if (response.status == "completed") AnalysisState.COMPLETED else AnalysisState.FILTERED
                        )
                        if (shouldSyncCardsImmediately(
                                mode = supplyMode,
                                hadAnyLocalCardAtStart = hadAnyLocalCardAtStart,
                                immediateSyncCompleted = immediateSyncCompleted,
                                candidateCompleted = response.status == "completed"
                            )) {
                            cards.syncCards()
                            immediateSyncCompleted = true
                        }
                    } catch (error: CancellationException) {
                        throw error
                    } catch (error: AnalysisStoppedException) {
                        photos.updateAnalysis(candidate.localId, AnalysisState.READY)
                        return Result.success()
                    } catch (error: Exception) {
                        val disposition = candidateUploadFailureDisposition(error, candidate.origin)
                        photos.updateAnalysis(candidate.localId, disposition.state)
                        if (!disposition.keepImportedCopy) photos.discardImportedCopy(candidate.localId)
                        if (disposition.terminateWork) {
                            val willRetry = disposition.retryWork &&
                                runAttemptCount < MAX_WORK_ATTEMPTS - 1
                            status.publishProgress(
                                progressScope,
                                candidateUploadFailureProgress(disposition, willRetry)
                            )
                            return if (willRetry) Result.retry() else Result.failure()
                        }
                    }
                    processed += 1
                }
                cards.syncCards()
            }
            val cachedCards = cardDao.countFutureCards(ChinaCalendar.today().toString())
            status.publishProgress(progressScope, completedAnalysisProgress(cachedCards, processed))
            Result.success()
        } catch (error: CancellationException) {
            throw error
        } catch (_: AnalysisStoppedException) {
            Result.success()
        } catch (_: IOException) {
            val willRetry = runAttemptCount < MAX_WORK_ATTEMPTS - 1
            status.publishProgress(progressScope, analysisFailureProgress(willRetry, null))
            if (willRetry) Result.retry() else Result.failure()
        } catch (error: HttpException) {
            if (shouldRetryHttpStatus(error.code())) {
                val willRetry = runAttemptCount < MAX_WORK_ATTEMPTS - 1
                status.publishProgress(progressScope, analysisFailureProgress(willRetry, error.code()))
                if (willRetry) Result.retry() else Result.failure()
            } else {
                status.publishProgress(
                    progressScope,
                    analysisFailureProgress(retrying = false, statusCode = error.code())
                )
                Result.failure()
            }
        } catch (_: Exception) {
            status.publishProgress(
                progressScope,
                analysisFailureProgress(retrying = false, statusCode = null)
            )
            Result.failure()
        }
    }

    companion object {
        const val KEY_ORIGIN_SCOPE = "origin_scope"
        private const val BATCH_SIZE = 12
    }
}

internal enum class UploadOriginScope { MEDIA_STORE, EXPLICIT_IMPORT }

internal fun UploadOriginScope.analysisProgressScope(): AnalysisProgressScope = when (this) {
    UploadOriginScope.MEDIA_STORE -> AnalysisProgressScope.AUTOMATIC_DISCOVERY
    UploadOriginScope.EXPLICIT_IMPORT -> AnalysisProgressScope.EXPLICIT_IMPORT
}

internal fun automaticSerendipitySeed(originScope: UploadOriginScope, now: Instant): String? =
    if (originScope == UploadOriginScope.MEDIA_STORE) ChinaCalendar.dateOf(now).toString() else null

internal fun invalidScopeFailureProgress(): Map<AnalysisProgressScope, AnalysisProgress> =
    AnalysisProgressScope.entries.associateWith {
        analysisFailureProgress(retrying = false, statusCode = null)
    }

private fun AnalysisStatusRepository.publishInvalidScopeFailure() {
    invalidScopeFailureProgress().forEach { (scope, progress) -> publishProgress(scope, progress) }
}

internal fun parseUploadOriginScope(value: String?): UploadOriginScope? = value?.let {
    runCatching { UploadOriginScope.valueOf(it) }.getOrNull()
}

internal fun shouldRetryHttpStatus(statusCode: Int): Boolean =
    statusCode == 409 || statusCode == 429 || statusCode >= 500

internal fun shouldRetryPrivacyAnalysisFailure(runAttemptCount: Int): Boolean =
    runAttemptCount < MAX_WORK_ATTEMPTS - 1

fun shouldRetryAuthorizedEvaluationError(error: Exception): Boolean {
    val httpCode = httpStatusCode(error)
    return error is IOException || error is AnalysisStoppedException ||
        httpCode == 429 || (httpCode != null && httpCode >= 500)
}

internal data class CandidateUploadFailureDisposition(
    val state: AnalysisState,
    val retryWork: Boolean,
    val terminateWork: Boolean,
    val keepImportedCopy: Boolean,
    val statusCode: Int?
)

internal fun candidateUploadFailureDisposition(
    error: Exception,
    origin: PhotoOrigin
): CandidateUploadFailureDisposition {
    val statusCode = httpStatusCode(error)
    val permissionRevoked = error is SecurityException
    val retryable = !permissionRevoked && (
        error is IOException || (statusCode != null && shouldRetryHttpStatus(statusCode))
    )
    val authenticationOrAuthorizationFailure =
        error is AuthenticationExpiredException || statusCode == 401 || statusCode == 403
    val accessUnavailable = permissionRevoked && origin == PhotoOrigin.MEDIA_STORE
    return CandidateUploadFailureDisposition(
        state = when {
            accessUnavailable -> AnalysisState.ACCESS_UNAVAILABLE
            retryable || authenticationOrAuthorizationFailure -> AnalysisState.READY
            else -> AnalysisState.FILTERED
        },
        retryWork = retryable,
        terminateWork = retryable || authenticationOrAuthorizationFailure,
        keepImportedCopy = retryable || accessUnavailable || authenticationOrAuthorizationFailure,
        statusCode = statusCode
    )
}

internal fun candidateUploadFailureProgress(
    disposition: CandidateUploadFailureDisposition,
    retrying: Boolean
): AnalysisProgress = if (
    !retrying &&
    disposition.state == AnalysisState.READY &&
    disposition.keepImportedCopy
) {
    AnalysisProgress(
        phase = AnalysisPhase.FAILED,
        detail = "这次处理未完成，照片候选仍保留在本机；服务恢复后可以再次尝试。"
    )
} else {
    analysisFailureProgress(retrying, disposition.statusCode)
}

internal fun httpStatusCode(error: Throwable): Int? = when (error) {
    is HttpException -> error.code()
    is UploadHttpStatusException -> error.statusCode
    else -> null
}

internal fun completedAnalysisProgress(cachedCardCount: Int, processedCount: Int): AnalysisProgress = AnalysisProgress(
    phase = if (cachedCardCount > 0) AnalysisPhase.READY else AnalysisPhase.NO_MATCH,
    eligibleCount = processedCount.coerceAtLeast(0),
    cachedCardCount = cachedCardCount.coerceAtLeast(0)
)

internal fun analysisFailureProgress(retrying: Boolean, statusCode: Int?): AnalysisProgress = AnalysisProgress(
    phase = if (retrying) AnalysisPhase.RETRYING else AnalysisPhase.FAILED,
    detail = if (statusCode == 429) {
        "分析请求暂时受限，候选仍保留在本机；后续周期会再试。"
    } else if (retrying) {
        "网络或服务暂时不可用，候选仍保留在本机；系统会自动重试。"
    } else {
        "这次处理未完成，照片候选不会被当作知识卡发布。"
    }
)

internal fun userMessageForHttpStatus(statusCode: Int?): String? =
    analysisFailureProgress(retrying = true, statusCode = statusCode).detail.takeIf { statusCode == 429 }

@HiltWorker
class CardSyncWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val cards: CardRepository
) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        if (applicationContext.analysisIsPaused()) return Result.success()
        return runCatching { cards.syncCards(); Result.success() }.getOrElse {
            if (it is AnalysisStoppedException) Result.success()
            else if (runAttemptCount < MAX_WORK_ATTEMPTS - 1) Result.retry() else Result.failure()
        }
    }
}

/**
 * Local privacy retention must not depend on analysis being enabled. Android force-stop can defer
 * all app work, so this runs both at the next app start and periodically whenever the OS permits.
 * Uninstall remains stronger: Android removes the complete app-private directory.
 */
@HiltWorker
class ImportedCopyCleanupWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val photos: PhotoRepository
) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = runCatching {
        photos.purgeExpiredImportedCopies(Instant.now())
        Result.success()
    }.getOrElse { Result.retry() }
}

fun scheduleImportedCopyCleanup(context: Context) {
    val manager = WorkManager.getInstance(context)
    manager.enqueueUniqueWork(
        IMPORTED_COPY_CLEANUP_NOW,
        ExistingWorkPolicy.KEEP,
        OneTimeWorkRequestBuilder<ImportedCopyCleanupWorker>()
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, Duration.ofMinutes(15))
            .build()
    )
    manager.enqueueUniquePeriodicWork(
        IMPORTED_COPY_CLEANUP_PERIODIC,
        ExistingPeriodicWorkPolicy.KEEP,
        PeriodicWorkRequestBuilder<ImportedCopyCleanupWorker>(Duration.ofHours(12)).build()
    )
}

private const val MAX_WORK_ATTEMPTS = 3
private const val IMPORTED_COPY_CLEANUP_NOW = "jianwei-imported-copy-cleanup-now"
private const val IMPORTED_COPY_CLEANUP_PERIODIC = "jianwei-imported-copy-cleanup-periodic"
private const val MAX_PRIVACY_QUEUE_INSPECTIONS = 500
private const val MAX_ACCESS_RECHECKS = 500
private val AUTOMATIC_PROGRESS = AnalysisProgressScope.AUTOMATIC_DISCOVERY
/**
 * Periodic work cannot be chained directly. This small worker starts an idempotent one-time
 * scan -> privacy -> upload chain so MediaStore changes are picked up even when the app is closed.
 */
class DailyPipelineKickWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        if (applicationContext.analysisIsPaused()) return Result.success()
        val preferences = applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val access = runCatching {
            PhotoAccess.valueOf(preferences.getString(KEY_ACCESS, PhotoAccess.PICKER_ONLY.name).orEmpty())
        }.getOrDefault(PhotoAccess.PICKER_ONLY)
        val manager = WorkManager.getInstance(applicationContext)
        if (access == PhotoAccess.PICKER_ONLY) {
            manager.enqueueUniqueWork(
                DAILY_PIPELINE,
                ExistingWorkPolicy.KEEP,
                OneTimeWorkRequestBuilder<CardSyncWorker>()
                    .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                    .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, Duration.ofMinutes(1))
                    .build()
            )
            return Result.success()
        }
        val scan = OneTimeWorkRequestBuilder<ScanWorker>()
            .setInputData(Data.Builder().putString(ScanWorker.KEY_ACCESS, access.name).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, Duration.ofMinutes(1))
            .build()
        val privacy = privacyScanRequest(UploadOriginScope.MEDIA_STORE)
        val upload = OneTimeWorkRequestBuilder<UploadWorker>()
            .setInputData(Data.Builder().putString(UploadWorker.KEY_ORIGIN_SCOPE, UploadOriginScope.MEDIA_STORE.name).build())
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .setRequiresBatteryNotLow(true)
                    .build()
            )
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, Duration.ofMinutes(1))
            .build()
        manager.beginUniqueWork(DAILY_PIPELINE, ExistingWorkPolicy.KEEP, scan)
            .then(privacy)
            .then(upload)
            .enqueue()
        return Result.success()
    }

    companion object {
        const val PREFS = "analysis_scheduler"
        const val KEY_ACCESS = "photo_access"
        const val KEY_PAUSED = "analysis_paused"
        const val DAILY_PIPELINE = "jianwei-daily-analysis-pipeline"
    }
}

internal fun Context.analysisIsPaused(): Boolean =
    getSharedPreferences(DailyPipelineKickWorker.PREFS, Context.MODE_PRIVATE)
        .getBoolean(DailyPipelineKickWorker.KEY_PAUSED, false)
