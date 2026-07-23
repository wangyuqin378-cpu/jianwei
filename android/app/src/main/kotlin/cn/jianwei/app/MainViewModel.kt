package cn.jianwei.app

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import cn.jianwei.domain.card.visibleDailyCards
import cn.jianwei.domain.model.AnalysisProgress
import cn.jianwei.domain.model.CardFeedbackState
import cn.jianwei.domain.model.FeedbackAction
import cn.jianwei.domain.model.KnowledgeCard
import cn.jianwei.domain.model.PhotoAccess
import cn.jianwei.domain.model.TrackedItem
import cn.jianwei.domain.repository.AnalysisScheduler
import cn.jianwei.domain.repository.AnalysisStatusRepository
import cn.jianwei.domain.repository.CardRepository
import cn.jianwei.domain.repository.PhotoRepository
import cn.jianwei.domain.time.ChinaCalendar
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.time.LocalDate

data class MainUiState(
    val cards: List<KnowledgeCard> = emptyList(),
    val savedCards: List<KnowledgeCard> = emptyList(),
    val trackedItems: Map<String, TrackedItem> = emptyMap(),
    val feedbackStates: Map<String, CardFeedbackState> = emptyMap(),
    val busy: Boolean = false,
    val message: String? = null,
    val analysisProgress: AnalysisProgress = AnalysisProgress(),
    val paused: Boolean = false,
    val currentDay: LocalDate = ChinaCalendar.today(),
    val focusedCardId: String? = null
)

@HiltViewModel
class MainViewModel @Inject constructor(
    private val photos: PhotoRepository,
    private val cards: CardRepository,
    private val scheduler: AnalysisScheduler,
    private val analysisStatus: AnalysisStatusRepository,
    private val betaMetrics: BetaMetricsStore,
    private val itemReminders: ItemReminderScheduler
) : ViewModel() {
    private val localState = MutableStateFlow(MainUiState(paused = scheduler.isPaused()))
    private val cardLocalState = combine(
        cards.observeTrackedItems(),
        cards.observeFeedbackStates()
    ) { tracked, feedback -> tracked to feedback }
    val uiState = combine(
        cards.observeCards(),
        cards.observeSavedCards(),
        cardLocalState,
        localState,
        analysisStatus.observeProgress()
    ) { cardList, savedCards, cardState, state, progress ->
        state.copy(
            cards = visibleDailyCards(cardList, state.currentDay, state.focusedCardId),
            savedCards = savedCards,
            trackedItems = cardState.first.associateBy(TrackedItem::cardId),
            feedbackStates = cardState.second.associateBy(CardFeedbackState::cardId),
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

    fun startDiscovery(access: PhotoAccess) = runBusy {
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
        runBusy {
            val imported = photos.importUris(uris)
            scheduler.scheduleImportedPhotos()
            "已导入 ${imported.size} 张照片，原图不会长期上云"
        }
    }

    fun retry(access: PhotoAccess) {
        if (scheduler.isPaused()) scheduler.setPaused(false)
        localState.value = localState.value.copy(paused = false)
        if (shouldScheduleAutomaticDiscovery(access)) {
            scheduler.scheduleAccessReconciliation(access)
            scheduler.scheduleDailyRefresh()
        } else {
            scheduler.scheduleImportedPhotos()
        }
    }

    fun feedback(cardId: String, action: FeedbackAction) = runBusy {
        val result = cards.sendFeedback(cardId, action)
        if (result.accepted) {
            if (action == FeedbackAction.TOO_PRIVATE) itemReminders.cancel(cardId)
            betaMetrics.markFeedback(action)
        }
        feedbackResultMessage(result)
    }

    fun setSaved(cardId: String, saved: Boolean) = runBusy {
        val newPreferenceSignal = cards.setSaved(cardId, saved)
        if (newPreferenceSignal) betaMetrics.markFeedback(FeedbackAction.SAVE) else betaMetrics.markEngaged()
        if (saved) "已收藏，可在收藏页查看" else "已取消收藏"
    }

    fun track(cardId: String, startedOn: LocalDate, reminderDays: Int) = runBusy {
        require(isValidItemReminderDraft(startedOn, reminderDays)) {
            "请选择不晚于今天的启用日期和有效提醒周期"
        }
        itemReminders.schedule(cardId, startedOn, reminderDays)
        cards.track(cardId, startedOn, reminderDays)
        betaMetrics.markEngaged()
        "已设置物品提醒；预计 ${startedOn.plusDays(reminderDays.toLong())} 上午送达，系统省电可能造成延迟"
    }

    fun cancelReminder(cardId: String) = runBusy {
        itemReminders.cancel(cardId)
        cards.cancelTracking(cardId)
        betaMetrics.markEngaged()
        "已取消物品提醒；云端记录会在联网且分析未暂停时撤销"
    }

    fun pauseAnalysis() = runBusy {
        scheduler.pauseAndCancel()
        localState.value = localState.value.copy(paused = true)
        "分析已暂停，进行中的网络任务已经退出"
    }

    fun resume(access: PhotoAccess) {
        scheduler.setPaused(false)
        localState.value = localState.value.copy(paused = false)
        startDiscovery(access)
        if (shouldScheduleAutomaticDiscovery(access)) {
            scheduler.scheduleDailyRefresh()
        } else {
            scheduler.scheduleImportedPhotos()
        }
    }

    fun clearLocalIndex() = runBusy {
        cards.clearLocalPhotoReferences()
        photos.clearIndex()
        "本地照片索引和卡片中的照片引用已清除"
    }

    fun deleteCloudData() = runBusy {
        scheduler.pauseAndCancel()
        itemReminders.cancelAllAndAwait()
        cards.clearCloudData()
        localState.value = localState.value.copy(paused = true)
        "云端设备数据和未完成任务已删除"
    }

    fun clearMessage() {
        localState.value = localState.value.copy(message = null)
    }

    private fun runBusy(block: suspend () -> String) {
        viewModelScope.launch {
            localState.value = localState.value.copy(busy = true, message = null)
            localState.value = try {
                localState.value.copy(busy = false, message = block())
            } catch (error: Exception) {
                localState.value.copy(busy = false, message = error.message ?: "操作失败，请稍后重试")
            }
        }
    }
}
