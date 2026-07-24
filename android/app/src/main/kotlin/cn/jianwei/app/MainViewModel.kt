package cn.jianwei.app

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import cn.jianwei.domain.card.FocusedCardStatus
import cn.jianwei.domain.card.dailyCardPresentation
import cn.jianwei.domain.model.AnalysisProgress
import cn.jianwei.domain.model.CardFeedbackState
import cn.jianwei.domain.model.FeedbackAction
import cn.jianwei.domain.model.KnowledgeCard
import cn.jianwei.domain.model.PhotoAccess
import cn.jianwei.domain.model.TrackedItem
import cn.jianwei.domain.preferences.DEFAULT_INTEREST_SELECTION
import cn.jianwei.domain.repository.AnalysisScheduler
import cn.jianwei.domain.repository.AnalysisStatusRepository
import cn.jianwei.domain.repository.CardRepository
import cn.jianwei.domain.repository.InterestPreferencesRepository
import cn.jianwei.domain.repository.PhotoRepository
import cn.jianwei.domain.time.ChinaCalendar
import cn.jianwei.domain.usecase.ImportPhotosUseCase
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.time.LocalDate

data class MainUiState(
    val cards: List<KnowledgeCard> = emptyList(),
    val savedCards: List<KnowledgeCard> = emptyList(),
    val focusedCard: KnowledgeCard? = null,
    val focusedCardStatus: FocusedCardStatus = FocusedCardStatus.NONE,
    val trackedItems: Map<String, TrackedItem> = emptyMap(),
    val feedbackStates: Map<String, CardFeedbackState> = emptyMap(),
    val selectedInterests: Set<String> = DEFAULT_INTEREST_SELECTION,
    val activeOperation: UserOperation? = null,
    val message: String? = null,
    val analysisProgress: AnalysisProgress = AnalysisProgress(),
    val paused: Boolean = false,
    val currentDay: LocalDate = ChinaCalendar.today(),
    val focusedCardId: String? = null
) {
    val busy: Boolean get() = activeOperation != null
}

@HiltViewModel
class MainViewModel @Inject constructor(
    private val photos: PhotoRepository,
    private val cards: CardRepository,
    private val scheduler: AnalysisScheduler,
    private val analysisStatus: AnalysisStatusRepository,
    private val interestPreferences: InterestPreferencesRepository,
    private val betaMetrics: BetaMetricsStore,
    private val itemReminders: ItemReminderScheduler,
    private val importPhotos: ImportPhotosUseCase,
    private val operationGate: UserOperationGate
) : ViewModel() {
    private val localState = MutableStateFlow(MainUiState(paused = scheduler.isPaused()))
    private val cardLocalState = combine(
        cards.observeTrackedItems(),
        cards.observeFeedbackStates(),
        interestPreferences.observeSelected()
    ) { tracked, feedback, interests -> Triple(tracked, feedback, interests) }
    val uiState = combine(
        cards.observeCards(),
        cards.observeSavedCards(),
        cardLocalState,
        localState,
        analysisStatus.observeProgress()
    ) { cardList, savedCards, cardState, state, progress ->
        val presentation = dailyCardPresentation(cardList, state.currentDay, state.focusedCardId)
        state.copy(
            cards = presentation.dailyCards,
            savedCards = savedCards,
            focusedCard = presentation.focusedCard,
            focusedCardStatus = presentation.focusedCardStatus,
            trackedItems = cardState.first.associateBy(TrackedItem::cardId),
            feedbackStates = cardState.second.associateBy(CardFeedbackState::cardId),
            selectedInterests = cardState.third,
            analysisProgress = progress
        )
    }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), MainUiState())

    fun focusCard(cardId: String?) {
        val safeId = cardId?.trim()?.takeIf { value ->
            value.length in 1..128 && value.none(Char::isISOControl)
        }
        localState.value = localState.value.copy(focusedCardId = safeId)
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

    fun startDiscovery(access: PhotoAccess) = runBusy(UserOperation.START_DISCOVERY) {
        if (shouldScheduleAutomaticDiscovery(access)) scheduler.scheduleInitialScan(access)
        discoveryStartMessage(access)
    }

    fun ensureDailyRefresh(access: PhotoAccess) {
        if (!scheduler.isPaused() && shouldScheduleAutomaticDiscovery(access)) {
            scheduler.scheduleDailyRefresh()
        }
    }

    fun reconcilePhotoAccess(access: PhotoAccess) {
        if (scheduler.isPaused()) return
        if (shouldScheduleAutomaticDiscovery(access)) {
            scheduler.scheduleAccessReconciliation(access)
            scheduler.scheduleDailyRefresh()
        } else {
            viewModelScope.launch { scheduler.stopAutomaticDiscovery() }
        }
    }

    fun importUris(uris: List<String>) {
        if (uris.isEmpty()) return
        runBusy(UserOperation.IMPORT_PHOTOS) {
            photoImportResultMessage(importPhotos(uris), PhotoImportEntry.PHOTO_PICKER)
        }
    }

    fun retry(access: PhotoAccess) = runBusy(UserOperation.RETRY_ANALYSIS) {
        if (scheduler.isPaused()) scheduler.setPaused(false)
        localState.update { it.copy(paused = false) }
        scheduleAvailableAnalysis(access)
        "已重新安排分析；系统会在条件允许时继续"
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
        val result = cards.sendFeedback(cardId, action)
        if (result.accepted) {
            if (action == FeedbackAction.TOO_PRIVATE) itemReminders.cancel(cardId)
            betaMetrics.markFeedback(action)
        }
        feedbackResultMessage(result)
    }

    fun setSaved(cardId: String, saved: Boolean) = runBusy(UserOperation.UPDATE_SAVED) {
        val newPreferenceSignal = cards.setSaved(cardId, saved)
        if (newPreferenceSignal) betaMetrics.markFeedback(FeedbackAction.SAVE) else betaMetrics.markEngaged()
        if (saved) "已收藏，可在收藏页查看" else "已取消收藏"
    }

    fun track(cardId: String, startedOn: LocalDate, reminderDays: Int) = runBusy(UserOperation.SET_REMINDER) {
        require(isValidItemReminderDraft(startedOn, reminderDays)) {
            "请选择不晚于今天的启用日期和有效提醒周期"
        }
        itemReminders.schedule(cardId, startedOn, reminderDays)
        cards.track(cardId, startedOn, reminderDays)
        betaMetrics.markEngaged()
        "已设置物品提醒；预计 ${startedOn.plusDays(reminderDays.toLong())} 上午送达，系统省电可能造成延迟"
    }

    fun cancelReminder(cardId: String) = runBusy(UserOperation.CANCEL_REMINDER) {
        itemReminders.cancel(cardId)
        cards.cancelTracking(cardId)
        betaMetrics.markEngaged()
        "已取消物品提醒；云端记录会在联网且分析未暂停时撤销"
    }

    fun pauseAnalysis() = runBusy(UserOperation.PAUSE_ANALYSIS) {
        scheduler.pauseAndCancel()
        localState.update { it.copy(paused = true) }
        "分析已暂停，进行中的网络任务已经退出"
    }

    fun resume(access: PhotoAccess) = runBusy(UserOperation.RESUME_ANALYSIS) {
        scheduler.setPaused(false)
        localState.update { it.copy(paused = false) }
        if (shouldScheduleAutomaticDiscovery(access)) scheduler.scheduleInitialScan(access)
        scheduleAvailableAnalysis(access)
        discoveryStartMessage(access)
    }

    fun clearLocalIndex() = runBusy(UserOperation.CLEAR_LOCAL_INDEX) {
        cards.clearLocalPhotoReferences()
        photos.clearIndex()
        "本地照片索引和卡片中的照片引用已清除"
    }

    fun deleteCloudData() = runBusy(UserOperation.DELETE_CLOUD_DATA) {
        scheduler.pauseAndCancel()
        itemReminders.cancelAllAndAwait()
        cards.clearCloudData()
        localState.update { it.copy(paused = true) }
        "云端设备数据和未完成任务已删除"
    }

    fun clearMessage() {
        localState.value = localState.value.copy(message = null)
    }

    fun announceMessage(message: String) {
        localState.update { it.copy(message = message) }
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
