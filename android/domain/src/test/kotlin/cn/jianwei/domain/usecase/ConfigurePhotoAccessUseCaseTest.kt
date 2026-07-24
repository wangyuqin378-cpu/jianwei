package cn.jianwei.domain.usecase

import cn.jianwei.domain.model.PhotoAccess
import cn.jianwei.domain.repository.AnalysisScheduler
import com.google.common.truth.Truth.assertThat
import kotlinx.coroutines.runBlocking
import org.junit.Test

class ConfigurePhotoAccessUseCaseTest {
    @Test
    fun `enabling automatic discovery starts initial and daily work`() = runBlocking {
        val scheduler = RecordingScheduler()
        val useCase = ConfigurePhotoAccessUseCase(scheduler)

        useCase(PhotoAccess.PARTIAL)

        assertThat(scheduler.initialAccesses).containsExactly(PhotoAccess.PARTIAL)
        assertThat(scheduler.dailyRefreshes).isEqualTo(1)
        assertThat(scheduler.stopCalls).isEqualTo(0)
    }

    @Test
    fun `returning to picker only cancels every automatic discovery chain`() = runBlocking {
        val scheduler = RecordingScheduler()
        val useCase = ConfigurePhotoAccessUseCase(scheduler)

        useCase(PhotoAccess.PICKER_ONLY)

        assertThat(scheduler.initialAccesses).isEmpty()
        assertThat(scheduler.dailyRefreshes).isEqualTo(0)
        assertThat(scheduler.stopCalls).isEqualTo(1)
    }

    private class RecordingScheduler : AnalysisScheduler {
        val initialAccesses = mutableListOf<PhotoAccess>()
        var dailyRefreshes = 0
        var stopCalls = 0

        override fun scheduleInitialScan(access: PhotoAccess) {
            initialAccesses += access
        }

        override fun scheduleAccessReconciliation(access: PhotoAccess) = Unit
        override fun scheduleImportedPhotos() = Unit
        override fun scheduleDailyRefresh() {
            dailyRefreshes++
        }

        override suspend fun stopAutomaticDiscovery() {
            stopCalls++
        }

        override fun isPaused(): Boolean = false
        override fun setPaused(paused: Boolean) = Unit
        override suspend fun pauseAndCancel() = Unit
        override fun cancelAll() = Unit
    }
}
