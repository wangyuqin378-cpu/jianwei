package cn.jianwei.domain.usecase

import cn.jianwei.domain.model.AnalysisState
import cn.jianwei.domain.model.PhotoCandidate
import cn.jianwei.domain.model.PhotoOrigin
import cn.jianwei.domain.model.ScanRequest
import cn.jianwei.domain.model.ScanResult
import cn.jianwei.domain.repository.AnalysisScheduler
import cn.jianwei.domain.repository.PhotoRepository
import com.google.common.truth.Truth.assertThat
import java.time.Instant
import kotlinx.coroutines.runBlocking
import org.junit.Test

class ImportPhotosUseCaseTest {
    @Test
    fun `readable imports are queued exactly once when analysis is active`() = runBlocking {
        val photos = FakePhotoRepository(importedCount = 2)
        val scheduler = FakeAnalysisScheduler(paused = false)

        val outcome = ImportPhotosUseCase(photos, scheduler)(listOf("content://one", "content://two"))

        assertThat(outcome).isEqualTo(
            PhotoImportOutcome(
                PhotoImportDisposition.IMPORTED_AND_QUEUED,
                2,
                listOf("candidate-1", "candidate-2")
            )
        )
        assertThat(scheduler.importSchedules).isEqualTo(1)
    }

    @Test
    fun `explicit imports remain local and explain paused analysis`() = runBlocking {
        val photos = FakePhotoRepository(importedCount = 1)
        val scheduler = FakeAnalysisScheduler(paused = true)

        val outcome = ImportPhotosUseCase(photos, scheduler)(listOf("content://one"))

        assertThat(outcome).isEqualTo(
            PhotoImportOutcome(
                PhotoImportDisposition.IMPORTED_WHILE_PAUSED,
                1,
                listOf("candidate-1")
            )
        )
        assertThat(scheduler.importSchedules).isEqualTo(0)
    }

    @Test
    fun `unreadable inputs do not create an analysis job`() = runBlocking {
        val scheduler = FakeAnalysisScheduler(paused = false)

        val outcome = ImportPhotosUseCase(
            FakePhotoRepository(importedCount = 0),
            scheduler
        )(listOf("content://expired"))

        assertThat(outcome).isEqualTo(
            PhotoImportOutcome(PhotoImportDisposition.NO_READABLE_PHOTOS, 0)
        )
        assertThat(scheduler.importSchedules).isEqualTo(0)
    }

    private class FakePhotoRepository(
        private val importedCount: Int
    ) : PhotoRepository {
        override suspend fun importUris(uris: List<String>): List<PhotoCandidate> =
            (1..importedCount).map(::candidate)

        override fun observeCandidatesByTokens(candidateTokens: Set<String>) =
            error("not used")

        override suspend fun scanRecent(request: ScanRequest): ScanResult =
            error("not used")

        override suspend fun candidatesForAnalysis(limit: Int): List<PhotoCandidate> =
            error("not used")

        override suspend fun updateAnalysis(
            localId: Long,
            state: AnalysisState,
            perceptualHash: Long?,
            qualityScore: Double?,
            labels: List<String>?,
            sensitiveFlags: Set<String>?
        ) = error("not used")

        override suspend fun markNeverAnalyze(localId: Long) = error("not used")
        override suspend fun replaceImportedCopyWithSanitized(localId: Long, bytes: ByteArray) =
            error("not used")
        override suspend fun discardImportedCopy(localId: Long) = error("not used")
        override suspend fun purgeExpiredImportedCopies(now: Instant): Int = error("not used")
        override suspend fun clearIndex() = error("not used")

        private fun candidate(index: Int) = PhotoCandidate(
            localId = index.toLong(),
            candidateToken = "candidate-$index",
            contentUri = "content://private/$index",
            capturedAt = Instant.EPOCH,
            modifiedAt = Instant.EPOCH,
            perceptualHash = null,
            qualityScore = 0.0,
            localLabels = emptyList(),
            sensitiveFlags = emptySet(),
            analysisState = AnalysisState.DISCOVERED,
            origin = PhotoOrigin.PHOTO_PICKER,
            width = 1,
            height = 1
        )
    }

    private class FakeAnalysisScheduler(
        private var paused: Boolean
    ) : AnalysisScheduler {
        var importSchedules = 0

        override fun scheduleImportedPhotos() {
            importSchedules += 1
        }

        override fun isPaused(): Boolean = paused
        override fun setPaused(paused: Boolean) {
            this.paused = paused
        }

        override fun scheduleInitialScan(access: cn.jianwei.domain.model.PhotoAccess) = error("not used")
        override fun scheduleAccessReconciliation(access: cn.jianwei.domain.model.PhotoAccess) =
            error("not used")
        override fun scheduleDailyRefresh() = error("not used")
        override suspend fun stopAutomaticDiscovery() = error("not used")
        override suspend fun pauseAndCancel() = error("not used")
        override fun cancelAll() = error("not used")
    }
}
