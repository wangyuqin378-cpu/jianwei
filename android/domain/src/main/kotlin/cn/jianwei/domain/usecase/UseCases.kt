package cn.jianwei.domain.usecase

import cn.jianwei.domain.card.AutomaticCardMode
import cn.jianwei.domain.model.FeedbackAction
import cn.jianwei.domain.model.PhotoAccess
import cn.jianwei.domain.model.ScanRequest
import cn.jianwei.domain.repository.AnalysisScheduler
import cn.jianwei.domain.repository.AutomaticCardModeRepository
import cn.jianwei.domain.repository.CardRepository
import cn.jianwei.domain.repository.PhotoRepository
import java.time.Clock
import java.time.Duration

class StartDiscoveryUseCase(
    private val photos: PhotoRepository,
    private val scheduler: AnalysisScheduler,
    private val clock: Clock = Clock.systemUTC()
) {
    suspend operator fun invoke(access: PhotoAccess) =
        photos.scanRecent(ScanRequest(clock.instant().minus(Duration.ofDays(90)), 500, access)).also {
            scheduler.scheduleInitialScan(access)
        }
}

class ConfigurePhotoAccessUseCase(
    private val scheduler: AnalysisScheduler
) {
    suspend operator fun invoke(access: PhotoAccess) {
        if (access == PhotoAccess.PICKER_ONLY) {
            scheduler.stopAutomaticDiscovery()
            return
        }
        scheduler.scheduleInitialScan(access)
        scheduler.scheduleDailyRefresh()
    }
}

class UpdateAutomaticCardModeUseCase(
    private val preferences: AutomaticCardModeRepository,
    private val scheduler: AnalysisScheduler
) {
    suspend operator fun invoke(mode: AutomaticCardMode, access: PhotoAccess): Boolean {
        if (preferences.mode() == mode) return false
        preferences.updateMode(mode)
        if (preferences.discoveryEnabled() && !scheduler.isPaused() && access != PhotoAccess.PICKER_ONLY) {
            scheduler.restartAutomaticDiscovery(access)
        }
        return true
    }
}

class SubmitFeedbackUseCase(private val cards: CardRepository) {
    suspend operator fun invoke(cardId: String, action: FeedbackAction) = cards.sendFeedback(cardId, action)
}
