package cn.jianwei.data.work

import cn.jianwei.data.cards.LocalTopicAffinityStore
import cn.jianwei.data.local.PhotoDao
import cn.jianwei.data.local.toDomain
import cn.jianwei.domain.preferences.expandedInterestTerms
import cn.jianwei.domain.ranking.CandidateRanker
import cn.jianwei.domain.repository.InterestPreferencesRepository
import java.time.Instant
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class DeferredCandidateSelector @Inject constructor(
    private val photos: PhotoDao,
    private val affinities: LocalTopicAffinityStore,
    private val interests: InterestPreferencesRepository
) {
    internal suspend fun promote(
        limit: Int,
        includeMediaStore: Int,
        originScope: UploadOriginScope,
        now: Instant = Instant.now()
    ): Int {
        if (limit <= 0) return 0
        val deferred = photos.deferredCandidatesForAnalysis(
            limit = MAX_RANKING_POOL,
            includeMediaStore = includeMediaStore,
            originScope = originScope.name
        ).map { it.toDomain() }
        if (deferred.isEmpty()) return 0
        val selectedIds = CandidateRanker().rank(
            candidates = deferred,
            interests = expandedInterestTerms(interests.selected()),
            now = now,
            limit = limit.coerceAtMost(MAX_PROMOTION_BATCH),
            topicAffinities = affinities.signals()
        ).map { it.localId }
        if (selectedIds.isEmpty()) return 0
        return photos.promoteDeferredById(selectedIds)
    }

    private companion object {
        const val MAX_RANKING_POOL = 100
        const val MAX_PROMOTION_BATCH = 12
    }
}
