package cn.jianwei.data.work

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import cn.jianwei.data.cards.LocalTopicAffinityStore
import cn.jianwei.data.local.JianweiDatabase
import cn.jianwei.data.local.PhotoCandidateEntity
import cn.jianwei.data.local.TopicAffinityEntity
import cn.jianwei.domain.model.AnalysisState
import cn.jianwei.domain.model.PhotoOrigin
import cn.jianwei.domain.repository.InterestPreferencesRepository
import com.google.common.truth.Truth.assertThat
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.runBlocking
import org.junit.Test

class DeferredCandidateSelectorInstrumentedTest {
    @Test
    fun latestFeedbackReordersExistingDeferredPhotosBeforeRefill() = runBlocking {
        val database = Room.inMemoryDatabaseBuilder(
            ApplicationProvider.getApplicationContext(),
            JianweiDatabase::class.java
        ).build()
        try {
            val photos = database.photos()
            photos.upsert(candidate(1, 0.80, "Traffic light"))
            photos.upsert(candidate(2, 0.95, "Kettle"))
            database.cards().upsertTopicAffinity(
                TopicAffinityEntity(
                    topicId = "traffic_light",
                    weight = 2.0,
                    aliases = emptyList(),
                    updatedAtMillis = 1L
                )
            )
            val selector = DeferredCandidateSelector(
                photos,
                LocalTopicAffinityStore(database.cards()),
                FakeInterestPreferences(
                    setOf("生活设计", "物件历史", "制造工艺")
                )
            )

            assertThat(selector.promote(
                limit = 1,
                includeMediaStore = 1,
                originScope = UploadOriginScope.MEDIA_STORE,
                now = Instant.parse("2026-07-25T00:00:00Z")
            )).isEqualTo(1)
            assertThat(
                photos.eligibleCandidatesForAnalysis(
                    10,
                    1,
                    UploadOriginScope.MEDIA_STORE.name
                ).map { it.localId }
            ).containsExactly(1L)
            assertThat(
                photos.deferredCandidatesForAnalysis(
                    10,
                    1,
                    UploadOriginScope.MEDIA_STORE.name
                ).map { it.localId }
            ).containsExactly(2L)
        } finally {
            database.close()
        }
        Unit
    }

    @Test
    fun sameDayDeferredPoolFillsOnePromotionBatchAfterDiversityPass() = runBlocking {
        val database = Room.inMemoryDatabaseBuilder(
            ApplicationProvider.getApplicationContext(),
            JianweiDatabase::class.java
        ).build()
        try {
            val photos = database.photos()
            (1L..12L).forEach { id ->
                photos.upsert(candidate(id, 0.90, "Object", perceptualHash = null))
            }
            val selector = DeferredCandidateSelector(
                photos,
                LocalTopicAffinityStore(database.cards()),
                FakeInterestPreferences(setOf("生活设计", "物件历史", "制造工艺"))
            )

            assertThat(selector.promote(
                limit = 12,
                includeMediaStore = 1,
                originScope = UploadOriginScope.MEDIA_STORE,
                now = Instant.parse("2026-07-25T00:00:00Z")
            )).isEqualTo(12)
            assertThat(
                photos.eligibleCandidatesForAnalysis(
                    20,
                    1,
                    UploadOriginScope.MEDIA_STORE.name
                )
            ).hasSize(12)
        } finally {
            database.close()
        }
        Unit
    }

    private fun candidate(
        id: Long,
        quality: Double,
        label: String,
        perceptualHash: Long? = 0xFFL shl (id.toInt() * 8)
    ) = PhotoCandidateEntity(
        localId = id,
        candidateToken = UUID.randomUUID().toString(),
        contentUri = "content://media/external/images/media/$id",
        capturedAtMillis = Instant.parse("2026-07-20T00:00:00Z").toEpochMilli() + id,
        modifiedAtMillis = id,
        sourceDigest = null,
        perceptualHash = perceptualHash,
        qualityScore = quality,
        localLabels = listOf(label),
        sensitiveFlags = emptySet(),
        analysisState = AnalysisState.DEFERRED.name,
        origin = PhotoOrigin.MEDIA_STORE.name,
        width = 1200,
        height = 900
    )

    private class FakeInterestPreferences(initial: Set<String>) : InterestPreferencesRepository {
        private val state = MutableStateFlow(initial)

        override fun observeSelected(): Flow<Set<String>> = state

        override fun selected(): Set<String> = state.value

        override fun updateSelected(selection: Set<String>) {
            state.value = selection
        }
    }
}
