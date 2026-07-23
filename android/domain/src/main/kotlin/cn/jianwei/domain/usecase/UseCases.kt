package cn.jianwei.domain.usecase

import cn.jianwei.domain.model.FeedbackAction
import cn.jianwei.domain.model.PhotoAccess
import cn.jianwei.domain.model.ScanRequest
import cn.jianwei.domain.repository.AnalysisScheduler
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

class SubmitFeedbackUseCase(private val cards: CardRepository) {
    suspend operator fun invoke(cardId: String, action: FeedbackAction) = cards.sendFeedback(cardId, action)
}
