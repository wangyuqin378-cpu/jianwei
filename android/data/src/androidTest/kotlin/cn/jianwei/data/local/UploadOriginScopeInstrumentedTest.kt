package cn.jianwei.data.local

import androidx.room.Room
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import cn.jianwei.data.work.UploadOriginScope
import cn.jianwei.domain.model.AnalysisState
import cn.jianwei.domain.model.PhotoOrigin
import com.google.common.truth.Truth.assertThat
import java.util.UUID
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import org.junit.Test

class UploadOriginScopeInstrumentedTest {
    @Test
    fun automaticAndExplicitUploadQueuesCannotConsumeEachOther() = runBlocking {
        val database = Room.inMemoryDatabaseBuilder(
            ApplicationProvider.getApplicationContext(),
            JianweiDatabase::class.java
        ).build()
        try {
            val dao = database.photos()
            dao.upsert(candidate(1, PhotoOrigin.MEDIA_STORE, AnalysisState.READY))
            dao.upsert(candidate(2, PhotoOrigin.PHOTO_PICKER, AnalysisState.READY))
            dao.upsert(candidate(3, PhotoOrigin.SHARED, AnalysisState.READY))

            val automatic = async {
                dao.eligibleCandidatesForAnalysis(10, 1, UploadOriginScope.MEDIA_STORE.name)
            }
            val explicit = async {
                dao.eligibleCandidatesForAnalysis(10, 0, UploadOriginScope.EXPLICIT_IMPORT.name)
            }
            assertThat(automatic.await().map { it.localId })
                .containsExactly(1L)
            assertThat(explicit.await().map { it.localId })
                .containsExactly(2L, 3L)
            assertThat(dao.eligibleCandidatesForAnalysis(10, 0, UploadOriginScope.MEDIA_STORE.name)).isEmpty()
        } finally {
            database.close()
        }
    }

    @Test
    fun readyCandidatesRemainScopedAfterDatabaseReopen() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val databaseName = "upload-origin-reopen.db"
        context.deleteDatabase(databaseName)
        var database = Room.databaseBuilder(context, JianweiDatabase::class.java, databaseName).build()
        try {
            database.photos().upsert(candidate(11, PhotoOrigin.MEDIA_STORE, AnalysisState.READY))
            database.photos().upsert(candidate(12, PhotoOrigin.PHOTO_PICKER, AnalysisState.READY))
            database.close()

            database = Room.databaseBuilder(context, JianweiDatabase::class.java, databaseName).build()
            assertThat(
                database.photos().eligibleCandidatesForAnalysis(
                    10,
                    1,
                    UploadOriginScope.MEDIA_STORE.name
                ).map { it.localId }
            ).containsExactly(11L)
            assertThat(
                database.photos().eligibleCandidatesForAnalysis(
                    10,
                    0,
                    UploadOriginScope.EXPLICIT_IMPORT.name
                ).map { it.localId }
            ).containsExactly(12L)
        } finally {
            database.close()
            context.deleteDatabase(databaseName)
        }
        Unit
    }

    private fun candidate(id: Long, origin: PhotoOrigin, state: AnalysisState) = PhotoCandidateEntity(
        localId = id,
        candidateToken = UUID.randomUUID().toString(),
        contentUri = if (origin == PhotoOrigin.MEDIA_STORE) {
            "content://media/external/images/media/$id"
        } else {
            "file:///private/import-$id.jpg"
        },
        capturedAtMillis = id,
        modifiedAtMillis = id,
        sourceDigest = if (origin == PhotoOrigin.MEDIA_STORE) null else "digest-$id",
        perceptualHash = id,
        qualityScore = 0.9,
        localLabels = emptyList(),
        sensitiveFlags = emptySet(),
        analysisState = state.name,
        origin = origin.name,
        width = 100,
        height = 100
    )
}
