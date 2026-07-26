package cn.jianwei.app

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import cn.jianwei.domain.card.FocusedCardStatus
import cn.jianwei.domain.card.AutomaticCardMode
import cn.jianwei.domain.card.dailyCardPresentation
import cn.jianwei.domain.model.AnalysisProgress
import cn.jianwei.domain.model.AnalysisProgressScope
import cn.jianwei.domain.model.CardFeedbackState
import cn.jianwei.domain.model.FeedbackAction
import cn.jianwei.domain.model.KnowledgeCard
import cn.jianwei.domain.model.PhotoAccess
import cn.jianwei.domain.model.PhotoCandidate
import cn.jianwei.domain.model.TrackedItem
import cn.jianwei.domain.preferences.DEFAULT_INTEREST_SELECTION
import cn.jianwei.domain.repository.AnalysisScheduler
import cn.jianwei.domain.repository.AnalysisStatusRepository
import cn.jianwei.domain.repository.AutomaticCardModeRepository
import cn.jianwei.domain.repository.CardRepository
import cn.jianwei.domain.repository.CloudDeletionStatusRepository
import cn.jianwei.domain.repository.CloudDeletionUnresolvedException
import cn.jianwei.domain.repository.InterestPreferencesRepository
import cn.jianwei.domain.repository.PhotoRepository
import cn.jianwei.domain.time.ChinaCalendar
import cn.jianwei.domain.usecase.ImportPhotosUseCase
import cn.jianwei.domain.usecase.ConfigurePhotoAccessUseCase
import cn.jianwei.domain.usecase.ImportedPhotoResultResolution
import cn.jianwei.domain.usecase.resolveImportedPhotoResult
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.time.LocalDate

data class MainUiState(
    val cards: List<KnowledgeCard> = emptyList(),
    val savedCards: List<KnowledgeCard> = emptyList(),
    val focusedCard: KnowledgeCard? = null,
    val focusedCardStatus: FocusedCardStatus = FocusedCardStatus.NONE,
    val trackedItems: Map<String, TrackedItem> = emptyMap(),
    val feedbackStates: Map<String, CardFeedbackState> = emptyMap(),
    val selectedInterests: Set<String> = DEFAULT_INTEREST_SELECTION,
    val automaticCardMode: AutomaticCardMode = AutomaticCardMode.PREPARED_POOL,
    val activeOperation: UserOperation? = null,
    val message: String? = null,
    val analysisProgress: AnalysisProgress = AnalysisProgress(),
    val paused: Boolean = false,
    val cloudDeletionUnresolved: Boolean = false,
    val currentDay: LocalDate = ChinaCalendar.today(),
    val focusedCardId: String? = null,
    val focusedCardFromRecentImport: Boolean = false,
    val pendingImportCount: Int = 0,
    val importedPhotoResultNotice: ImportedPhotoResultNotice? = null
) {
    val busy: Boolean get() = activeOperation != null
}

private data class PendingImportCandidateSnapshot(
    val candidateTokens: List<String>,
    val candidates: List<PhotoCandidate>
)

private data class PendingImportResolutionSnapshot(
    val candidateTokens: List<String>,
    val resolution: ImportedPhotoResultResolution
)

@HiltViewModel
@OptIn(ExperimentalCoroutinesApi::class)
class MainViewModel @Inject constructor(
    private val photos: PhotoRepository,
    private val cards: CardRepository,
    private val cloudDeletionStatus: CloudDeletionStatusRepository,
    private val scheduler: AnalysisScheduler,
    private val analysisStatus: AnalysisStatusRepository,
    private val interestPreferences: InterestPreferencesRepository,
    private val automaticCardModePreferences: AutomaticCardModeRepository,
    private val betaMetrics: BetaMetricsStore,
    private val itemReminders: ItemReminderScheduler,
    private val importPhotos: ImportPhotosUseCase,
    private val configurePhotoAccess: ConfigurePhotoAccessUseCase,
    private val operationGate: UserOperationGate,
    private val pendingImportResults: PendingImportResultStore
) : ViewModel() {
    private val reminderSchedulingMutex = Mutex()
    private val restoredImportResult = pendingImportResults.snapshot()
    private val pendingImportTokens = MutableStateFlow(
        restoredImportResult.candidateTokens
    )
    private val pendingImportCandidates = pendingImportTokens.flatMapLatest { tokens ->
        if (tokens.isEmpty()) {
            flowOf(PendingImportCandidateSnapshot(emptyList(), emptyList()))
        } else {
            photos.observeCandidatesByTokens(tokens.toSet()).map { candidates ->
                PendingImportCandidateSnapshot(tokens, candidates)
            }
        }
    }
    private val localState = MutableStateFlow(
        MainUiState(
            paused = scheduler.isPaused(),
            pendingImportCount = pendingImportTokens.value.size,
            focusedCardId = restoredImportResult.focusedCardId,
            focusedCardFromRecentImport = restoredImportResult.focusedCardId != null,
            importedPhotoResultNotice = restoredImportResult.notice
        )
    )
    private val cardLocalState = combine(
        cards.observeTrackedItems(),
        cards.observeFeedbackStates(),
        interestPreferences.observeSelected(),
        automaticCardModePreferences.observeMode(),
        cloudDeletionStatus.observeUnresolved()
    ) { tracked, feedback, interests, automaticCardMode, cloudDeletionUnresolved ->
        CardLocalState(
            tracked,
            feedback,
            interests,
            automaticCardMode,
            cloudDeletionUnresolved
        )
    }
    private val scopedAnalysisProgress = combine(
        analysisStatus.observeProgress(AnalysisProgressScope.AUTOMATIC_DISCOVERY),
        analysisStatus.observeProgress(AnalysisProgressScope.EXPLICIT_IMPORT)
    ) { automatic, explicitImport -> ScopedAnalysisProgress(automatic, explicitImport) }
    val uiState = combine(
        cards.observeCards(),
        cards.observeSavedCards(),
        cardLocalState,
        localState,
        scopedAnalysisProgress
    ) { cardList, savedCards, cardState, state, progress ->
        val presentation = dailyCardPresentation(cardList, state.currentDay, state.focusedCardId)
        state.copy(
            cards = presentation.dailyCards,
            savedCards = savedCards,
            focusedCard = presentation.focusedCard,
            focusedCardStatus = presentation.focusedCardStatus,
            trackedItems = cardState.tracked.associateBy(TrackedItem::cardId),
            feedbackStates = cardState.feedback.associateBy(CardFeedbackState::cardId),
            selectedInterests = cardState.interests,
            automaticCardMode = cardState.automaticCardMode,
            cloudDeletionUnresolved = cardState.cloudDeletionUnresolved,
            analysisProgress = analysisProgressForPresentation(
                automatic = progress.automatic,
                explicitImport = progress.explicitImport,
                pendingImportCount = state.pendingImportCount
            )
        )
    }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), MainUiState())

    init {
        // Reconcile only the durable outbox inherited at process start. Fresh UI submissions
        // schedule directly after their Room commit, avoiding duplicate REPLACE operations.
        viewModelScope.launch {
            cards.observePendingReminderSchedules().first().forEach { pending ->
                reminderSchedulingMutex.withLock {
                    reconcilePendingReminderScheduleIfCurrent(
                        schedule = pending,
                        isStillPending = cards::isReminderSchedulePending,
                        scheduleLocalWork = { schedule ->
                            itemReminders.schedule(
                                schedule.cardId,
                                schedule.startedOn,
                                schedule.reminderDays
                            )
                        },
                        acknowledgeLocalSchedule = cards::markReminderScheduled
                    )
                }
            }
        }
        viewModelScope.launch {
            combine(
                cards.observeCards(),
                pendingImportCandidates,
                analysisStatus.observeProgress(AnalysisProgressScope.EXPLICIT_IMPORT)
            ) { cardList, snapshot, progress ->
                if (snapshot.candidateTokens.isEmpty()) null else PendingImportResolutionSnapshot(
                    candidateTokens = snapshot.candidateTokens,
                    resolution = resolveImportedPhotoResult(
                        candidateTokens = snapshot.candidateTokens,
                        candidates = snapshot.candidates,
                        cards = cardList,
                        analysisPhase = progress.phase
                    )
                )
            }.collect { snapshot ->
                when (val resolution = snapshot?.resolution) {
                    null, ImportedPhotoResultResolution.Pending -> Unit
                    is ImportedPhotoResultResolution.CardReady -> completePendingImport(
                        expectedCandidateTokens = snapshot.candidateTokens,
                        focusedCardId = resolution.cardId,
                        message = "已经从你刚选的照片找到一张知识卡"
                    )
                    ImportedPhotoResultResolution.NoMatch -> completePendingImport(
                        expectedCandidateTokens = snapshot.candidateTokens,
                        notice = ImportedPhotoResultNotice.NO_MATCH
                    )
                    is ImportedPhotoResultResolution.Failed -> completePendingImport(
                        expectedCandidateTokens = snapshot.candidateTokens,
                        notice = if (resolution.canRetry) {
                            ImportedPhotoResultNotice.FAILED
                        } else {
                            ImportedPhotoResultNotice.CANNOT_RETRY
                        },
                        retryCandidateTokens = if (resolution.canRetry) {
                            snapshot.candidateTokens
                        } else {
                            emptyList()
                        }
                    )
                }
            }
        }
    }

    fun focusCard(cardId: String?) {
        val safeId = normalizedFocusedCardId(cardId)
        if (safeId == null) pendingImportResults.setFocusedCard(null)
        localState.value = localState.value.copy(
            focusedCardId = safeId,
            focusedCardFromRecentImport = false
        )
    }

    fun refreshCurrentDay() {
        val today = ChinaCalendar.today()
        if (localState.value.currentDay != today) {
            localState.value = localState.value.copy(currentDay = today)
        }
    }

    fun updateInterests(interests: Set<String>, announce: Boolean = true): Boolean = try {
        interestPreferences.updateSelected(interests)
        if (announce) {
            localState.value = localState.value.copy(
                message = "推荐兴趣已更新；从下一批新照片开始用于候选排序"
            )
        }
        true
    } catch (error: Exception) {
        localState.value = localState.value.copy(
            message = error.message ?: "推荐兴趣保存失败，请重试"
        )
        false
    }

    fun saveOnboardingPreferences(
        interests: Set<String>,
        automaticCardMode: AutomaticCardMode
    ): Boolean = try {
        interestPreferences.updateSelected(interests)
        automaticCardModePreferences.updateMode(automaticCardMode)
        true
    } catch (error: Exception) {
        localState.value = localState.value.copy(
            message = error.message ?: "首次设置保存失败，请重试"
        )
        false
    }

    fun updateAutomaticCardMode(mode: AutomaticCardMode, access: PhotoAccess) {
        if (automaticCardModePreferences.mode() == mode) return
        runBusy(UserOperation.UPDATE_CARD_MODE) {
            requireCloudDeletionResolved()
            automaticCardModePreferences.updateMode(mode)
            if (!scheduler.isPaused() && shouldScheduleAutomaticDiscovery(access)) {
                scheduler.scheduleAccessReconciliation(access)
                scheduler.scheduleDailyRefresh()
            }
            when (mode) {
                AutomaticCardMode.PREPARED_POOL ->
                    "已改为提前准备；联网时会逐步补足 7–14 张卡片"
                AutomaticCardMode.DAILY_ONE ->
                    "已改为每天一张；已准备卡片保留，每个自然日最多分析 1 张"
            }
        }
    }

    fun startDiscovery(access: PhotoAccess) = runBusy(UserOperation.START_DISCOVERY) {
        requireCloudDeletionResolved()
        configurePhotoAccess(access)
        if (scheduler.isPaused()) {
            if (shouldScheduleAutomaticDiscovery(access)) {
                "照片访问范围已更新；恢复分析后才会继续自动发现"
            } else {
                "自动发现已关闭；分析仍处于暂停状态"
            }
        } else {
            discoveryStartMessage(access, automaticCardModePreferences.mode())
        }
    }

    fun ensureDailyRefresh(access: PhotoAccess) {
        viewModelScope.launch {
            if (
                !cloudDeletionStatus.isUnresolved() &&
                !scheduler.isPaused() &&
                shouldScheduleAutomaticDiscovery(access)
            ) {
                scheduler.scheduleDailyRefresh()
            }
        }
    }

    fun reconcilePhotoAccess(access: PhotoAccess) {
        viewModelScope.launch {
            if (cloudDeletionStatus.isUnresolved() || scheduler.isPaused()) return@launch
            if (shouldScheduleAutomaticDiscovery(access)) {
                scheduler.scheduleAccessReconciliation(access)
                scheduler.scheduleDailyRefresh()
            } else {
                scheduler.stopAutomaticDiscovery()
            }
        }
    }

    fun importUris(uris: List<String>) {
        if (uris.isEmpty()) return
        runBusy(UserOperation.IMPORT_PHOTOS) {
            requireCloudDeletionResolved()
            val outcome = importPhotos(uris)
            rememberPendingImport(outcome.candidateTokens)
            photoImportResultMessage(outcome, PhotoImportEntry.PHOTO_PICKER)
        }
    }

    fun trackSharedImportResults(candidateTokens: List<String>?) {
        rememberPendingImport(candidateTokens.orEmpty())
    }

    fun retry(access: PhotoAccess) = runBusy(UserOperation.RETRY_ANALYSIS) {
        requireCloudDeletionResolved()
        if (scheduler.isPaused()) scheduler.setPaused(false)
        localState.update { it.copy(paused = false) }
        scheduleAvailableAnalysis(access)
        "已重新安排分析；系统会在条件允许时继续"
    }

    fun retryImportedPhoto() = runBusy(UserOperation.RETRY_IMPORTED_PHOTO) {
        requireCloudDeletionResolved()
        val retrySnapshot = pendingImportResults.snapshot()
        val candidateTokens = retrySnapshot.retryCandidateTokens
        if (candidateTokens.isEmpty()) {
            return@runBusy "这张照片无法继续重试，请重新选择照片"
        }
        if (scheduler.isPaused()) scheduler.setPaused(false)
        scheduler.scheduleImportedPhotos()
        val activatedTokens = pendingImportResults.retryFailed()
        if (activatedTokens.isEmpty()) {
            return@runBusy "重试状态已经变化，请重新选择照片"
        }
        localState.update {
            it.copy(
                paused = false,
                focusedCardId = null,
                focusedCardFromRecentImport = false,
                pendingImportCount = activatedTokens.size,
                importedPhotoResultNotice = null
            )
        }
        pendingImportTokens.value = activatedTokens
        "已重新分析刚才选择的照片；找到后会直接打开结果"
    }

    private fun scheduleAvailableAnalysis(access: PhotoAccess) {
        when {
            shouldScheduleAutomaticDiscovery(access) -> {
                scheduler.scheduleAccessReconciliation(access)
                scheduler.scheduleDailyRefresh()
            }
            else -> scheduler.scheduleImportedPhotos()
        }
    }

    fun feedback(cardId: String, action: FeedbackAction) = runBusy(UserOperation.RECORD_FEEDBACK) {
        requireCloudDeletionResolved()
        val result = cards.sendFeedback(cardId, action)
        if (result.accepted) {
            if (action == FeedbackAction.TOO_PRIVATE || action == FeedbackAction.WRONG_OBJECT) {
                bestEffortCancelLocalReminderWork { itemReminders.cancel(cardId) }
            }
            betaMetrics.markFeedback(action)
        }
        feedbackResultMessage(result)
    }

    fun setSaved(cardId: String, saved: Boolean) = runBusy(UserOperation.UPDATE_SAVED) {
        requireCloudDeletionResolved()
        val result = cards.setSaved(cardId, saved)
        if (result.cardAvailable && result.changed) betaMetrics.markEngaged()
        savedCardUpdateMessage(result)
    }

    fun track(cardId: String, startedOn: LocalDate, reminderDays: Int) = runBusy(UserOperation.SET_REMINDER) {
        requireCloudDeletionResolved()
        require(isValidItemReminderDraft(startedOn, reminderDays)) {
            "请选择不晚于今天的启用日期和有效提醒周期"
        }
        lateinit var committedSchedule: cn.jianwei.domain.model.PendingReminderSchedule
        val outcome = reminderSchedulingMutex.withLock {
            scheduleReminderFromUi(
                commitDurableReminder = {
                    cards.track(cardId, startedOn, reminderDays).also { committedSchedule = it }
                },
                scheduleLocalWork = { schedule ->
                    itemReminders.schedule(schedule.cardId, schedule.startedOn, schedule.reminderDays)
                },
                acknowledgeLocalSchedule = cards::markReminderScheduled
            )
        }
        betaMetrics.markEngaged()
        reminderSchedulingMessage(outcome, committedSchedule)
    }

    fun cancelReminder(cardId: String) = runBusy(UserOperation.CANCEL_REMINDER) {
        requireCloudDeletionResolved()
        cancelReminderFromUi(
            commitDurableCancellation = { cards.cancelTracking(cardId) },
            cancelLocalWork = { itemReminders.cancel(cardId) }
        )
        betaMetrics.markEngaged()
        "已取消物品提醒；云端记录会在联网且分析未暂停时撤销"
    }

    fun pauseAnalysis() = runBusy(UserOperation.PAUSE_ANALYSIS) {
        pauseAndPublishAnalysisState(
            pauseAndCancelAnalysis = scheduler::pauseAndCancel,
            publishPauseState = {
                localState.update { it.copy(paused = scheduler.isPaused()) }
            }
        )
        "分析已暂停，进行中的网络任务已经退出"
    }

    fun resume(access: PhotoAccess) = runBusy(UserOperation.RESUME_ANALYSIS) {
        requireCloudDeletionResolved()
        scheduler.setPaused(false)
        localState.update { it.copy(paused = false) }
        if (shouldScheduleAutomaticDiscovery(access)) scheduler.scheduleInitialScan(access)
        scheduleAvailableAnalysis(access)
        discoveryStartMessage(access, automaticCardModePreferences.mode())
    }

    fun clearLocalIndex() = runBusy(UserOperation.CLEAR_LOCAL_INDEX) {
        requireCloudDeletionResolved()
        clearLocalIndexFromUi(
            pauseAndCancelAnalysis = scheduler::pauseAndCancel,
            publishPauseState = {
                localState.update { it.copy(paused = scheduler.isPaused()) }
            },
            clearCardPhotoReferences = cards::clearLocalPhotoReferences,
            clearPhotoIndex = photos::clearIndex,
            clearTransientUiState = {
                pendingImportResults.clearAll()
                pendingImportTokens.value = emptyList()
                localState.update {
                    it.copy(
                        paused = scheduler.isPaused(),
                        focusedCardId = null,
                        focusedCardFromRecentImport = false,
                        pendingImportCount = 0,
                        importedPhotoResultNotice = null
                    )
                }
            }
        )
        "分析已暂停；本地照片索引、导入副本和卡片照片引用已清除"
    }

    fun deleteCloudData() = runBusy(UserOperation.DELETE_CLOUD_DATA) {
        completeCloudDeletionFromUi(
            pauseAndCancelAnalysis = scheduler::pauseAndCancel,
            publishPauseState = {
                localState.update { it.copy(paused = scheduler.isPaused()) }
            },
            deleteCloudData = cards::clearCloudData,
            cancelReminderWork = itemReminders::cancelAllAndAwait,
            clearTransientUiState = {
                pendingImportResults.clearAll()
                pendingImportTokens.value = emptyList()
                localState.update {
                    it.copy(
                        paused = scheduler.isPaused(),
                        focusedCardId = null,
                        focusedCardFromRecentImport = false,
                        pendingImportCount = 0,
                        importedPhotoResultNotice = null
                    )
                }
            }
        )
        "云端设备数据和未完成任务已删除"
    }

    fun clearMessage() {
        localState.value = localState.value.copy(message = null)
    }

    fun clearImportedPhotoResultNotice() {
        pendingImportResults.clearNotice()
        localState.update { it.copy(importedPhotoResultNotice = null) }
    }

    fun announceMessage(message: String) {
        localState.update { it.copy(message = message) }
    }

    private suspend fun requireCloudDeletionResolved() {
        if (cloudDeletionStatus.isUnresolved()) throw CloudDeletionUnresolvedException()
    }

    private fun rememberPendingImport(candidateTokens: List<String>) {
        val normalized = pendingImportResults.remember(candidateTokens)
        if (normalized.isEmpty()) return
        pendingImportTokens.value = normalized
        localState.update {
            it.copy(
                focusedCardId = null,
                focusedCardFromRecentImport = false,
                pendingImportCount = normalized.size,
                importedPhotoResultNotice = null
            )
        }
    }

    private fun completePendingImport(
        expectedCandidateTokens: List<String>,
        focusedCardId: String? = null,
        message: String? = null,
        notice: ImportedPhotoResultNotice? = null,
        retryCandidateTokens: List<String> = emptyList()
    ) {
        if (!pendingImportResults.completeIfCurrent(
                expectedCandidateTokens,
                focusedCardId,
                notice,
                retryCandidateTokens
            )) return
        pendingImportTokens.value = emptyList()
        localState.update { state ->
            state.copy(
                focusedCardId = focusedCardId,
                focusedCardFromRecentImport = focusedCardId != null,
                pendingImportCount = 0,
                message = message,
                importedPhotoResultNotice = notice
            )
        }
    }

    private fun runBusy(operation: UserOperation, block: suspend () -> String) {
        if (!operationGate.tryStart(operation)) return
        localState.update { it.copy(activeOperation = operation, message = null) }
        viewModelScope.launch {
            var completionMessage: String? = null
            try {
                completionMessage = block()
            } catch (cancellation: CancellationException) {
                throw cancellation
            } catch (error: Exception) {
                completionMessage = error.message ?: "操作失败，请稍后重试"
            } finally {
                operationGate.finish(operation)
                localState.update { state ->
                    state.copy(
                        activeOperation = operationGate.current(),
                        message = completionMessage ?: state.message
                    )
                }
            }
        }
    }

}

private data class ScopedAnalysisProgress(
    val automatic: AnalysisProgress,
    val explicitImport: AnalysisProgress
)

private data class CardLocalState(
    val tracked: List<TrackedItem>,
    val feedback: List<CardFeedbackState>,
    val interests: Set<String>,
    val automaticCardMode: AutomaticCardMode,
    val cloudDeletionUnresolved: Boolean
)

internal fun analysisProgressForPresentation(
    automatic: AnalysisProgress,
    explicitImport: AnalysisProgress,
    pendingImportCount: Int
): AnalysisProgress = if (pendingImportCount > 0) explicitImport else automatic
