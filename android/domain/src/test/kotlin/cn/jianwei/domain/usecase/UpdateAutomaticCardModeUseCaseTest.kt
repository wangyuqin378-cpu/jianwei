package cn.jianwei.domain.usecase

import cn.jianwei.domain.card.AutomaticCardMode
import cn.jianwei.domain.model.PhotoAccess
import cn.jianwei.domain.repository.AnalysisScheduler
import cn.jianwei.domain.repository.AutomaticCardModeRepository
import com.google.common.truth.Truth.assertThat
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.runBlocking
import org.junit.Test

class UpdateAutomaticCardModeUseCaseTest {
    @Test
    fun `active automatic discovery cancels old work and restarts with the new mode`() = runBlocking {
        val preferences = FakePreferences(AutomaticCardMode.PREPARED_POOL, true)
        val scheduler = RecordingScheduler(paused = false)
        val useCase = UpdateAutomaticCardModeUseCase(preferences, scheduler)

        val changed = useCase(AutomaticCardMode.DAILY_ONE, PhotoAccess.PARTIAL)

        assertThat(changed).isTrue()
        assertThat(preferences.mode()).isEqualTo(AutomaticCardMode.DAILY_ONE)
        assertThat(scheduler.restartAccesses).containsExactly(PhotoAccess.PARTIAL)
        Unit
    }

    @Test
    fun `picker only saves the future mode without starting automatic work`() = runBlocking {
        val preferences = FakePreferences(AutomaticCardMode.PREPARED_POOL, true)
        val scheduler = RecordingScheduler(paused = false)

        UpdateAutomaticCardModeUseCase(preferences, scheduler)(
            AutomaticCardMode.DAILY_ONE,
            PhotoAccess.PICKER_ONLY
        )

        assertThat(preferences.mode()).isEqualTo(AutomaticCardMode.DAILY_ONE)
        assertThat(scheduler.restartAccesses).isEmpty()
        Unit
    }

    @Test
    fun `paused discovery saves the mode and waits for an explicit resume`() = runBlocking {
        val preferences = FakePreferences(AutomaticCardMode.PREPARED_POOL, true)
        val scheduler = RecordingScheduler(paused = true)

        UpdateAutomaticCardModeUseCase(preferences, scheduler)(
            AutomaticCardMode.DAILY_ONE,
            PhotoAccess.FULL
        )

        assertThat(preferences.mode()).isEqualTo(AutomaticCardMode.DAILY_ONE)
        assertThat(scheduler.restartAccesses).isEmpty()
        Unit
    }

    @Test
    fun `selecting the current mode is idempotent`() = runBlocking {
        val preferences = FakePreferences(AutomaticCardMode.DAILY_ONE, true)
        val scheduler = RecordingScheduler(paused = false)

        val changed = UpdateAutomaticCardModeUseCase(preferences, scheduler)(
            AutomaticCardMode.DAILY_ONE,
            PhotoAccess.FULL
        )

        assertThat(changed).isFalse()
        assertThat(preferences.updates).isEmpty()
        assertThat(scheduler.restartAccesses).isEmpty()
        Unit
    }

    @Test
    fun `disabled automatic discovery saves mode without restarting retained photo access`() = runBlocking {
        val preferences = FakePreferences(AutomaticCardMode.PREPARED_POOL, false)
        val scheduler = RecordingScheduler(paused = false)

        UpdateAutomaticCardModeUseCase(preferences, scheduler)(
            AutomaticCardMode.DAILY_ONE,
            PhotoAccess.FULL
        )

        assertThat(preferences.mode()).isEqualTo(AutomaticCardMode.DAILY_ONE)
        assertThat(scheduler.restartAccesses).isEmpty()
        Unit
    }

    private class FakePreferences(
        initial: AutomaticCardMode,
        private var discoveryEnabled: Boolean
    ) : AutomaticCardModeRepository {
        private var value = initial
        val updates = mutableListOf<AutomaticCardMode>()

        override fun observeMode(): Flow<AutomaticCardMode> = flowOf(value)
        override fun mode(): AutomaticCardMode = value
        override fun updateMode(mode: AutomaticCardMode) {
            updates += mode
            value = mode
        }
        override fun observeDiscoveryEnabled(): Flow<Boolean> = flowOf(discoveryEnabled)
        override fun discoveryEnabled(): Boolean = discoveryEnabled
        override fun updateDiscoveryEnabled(enabled: Boolean) {
            discoveryEnabled = enabled
        }
    }

    private class RecordingScheduler(
        private var paused: Boolean
    ) : AnalysisScheduler {
        val restartAccesses = mutableListOf<PhotoAccess>()

        override suspend fun restartAutomaticDiscovery(access: PhotoAccess) {
            restartAccesses += access
        }

        override fun isPaused(): Boolean = paused
        override fun setPaused(paused: Boolean) {
            this.paused = paused
        }

        override fun scheduleInitialScan(access: PhotoAccess) = Unit
        override fun scheduleAccessReconciliation(access: PhotoAccess) = Unit
        override fun scheduleImportedPhotos() = Unit
        override fun scheduleDailyRefresh() = Unit
        override suspend fun stopAutomaticDiscovery() = Unit
        override suspend fun pauseAndCancel() = Unit
        override fun cancelAll() = Unit
    }
}
