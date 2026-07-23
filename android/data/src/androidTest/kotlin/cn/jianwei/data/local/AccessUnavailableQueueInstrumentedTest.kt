package cn.jianwei.data.local

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import cn.jianwei.data.work.UploadOriginScope
import cn.jianwei.domain.model.AnalysisState
import cn.jianwei.domain.model.PhotoOrigin
import com.google.common.truth.Truth.assertThat
import java.util.UUID
import kotlinx.coroutines.runBlocking
import org.junit.Test

class AccessUnavailableQueueInstrumentedTest {
    @Test
    fun inaccessibleMediaRowsDoNotStarveReadableCandidates() {
        runBlocking {
            val database = Room.inMemoryDatabaseBuilder(
                ApplicationProvider.getApplicationContext(),
                JianweiDatabase::class.java
            ).build()
            try {
                val dao = database.photos()
                (1L..12L).forEach { id -> dao.upsert(candidate(id, AnalysisState.ACCESS_UNAVAILABLE)) }
                dao.upsert(candidate(13L, AnalysisState.READY))
                dao.upsert(candidate(14L, AnalysisState.DISCOVERED))

                assertThat(
                    dao.eligibleCandidatesForAnalysis(
                        12,
                        includeMediaStore = 1,
                        originScope = UploadOriginScope.MEDIA_STORE.name
                    ).map { it.localId }
                )
                    .containsExactly(13L)
                assertThat(dao.discoveredForPrivacy(60).map { it.localId }).containsExactly(14L)
                assertThat(dao.unavailableMediaForRecheck(500).map { it.localId })
                    .containsExactlyElementsIn(1L..12L)
            } finally {
                database.close()
            }
        }
    }

    private fun candidate(id: Long, state: AnalysisState) = PhotoCandidateEntity(
        localId = id,
        candidateToken = UUID.randomUUID().toString(),
        contentUri = "content://media/external/images/media/$id",
        capturedAtMillis = id,
        modifiedAtMillis = id,
        sourceDigest = null,
        perceptualHash = null,
        qualityScore = 0.9,
        localLabels = emptyList(),
        sensitiveFlags = emptySet(),
        analysisState = state.name,
        origin = PhotoOrigin.MEDIA_STORE.name,
        width = 100,
        height = 100
    )
}
