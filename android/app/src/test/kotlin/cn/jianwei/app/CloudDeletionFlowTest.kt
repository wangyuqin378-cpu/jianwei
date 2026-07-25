package cn.jianwei.app

import com.google.common.truth.Truth.assertThat
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.junit.Test

class CloudDeletionFlowTest {
    @Test
    fun `remote failure publishes paused state and preserves reminder work and local UI`() = runBlocking {
        val events = mutableListOf<String>()

        val failure = runCatching {
            completeCloudDeletionFromUi(
                pauseAndCancelAnalysis = { events += "pause" },
                publishPauseState = { events += "publish-paused" },
                deleteCloudData = {
                    events += "remote"
                    throw IOException("offline")
                },
                cancelReminderWork = { events += "cancel-reminders" },
                clearTransientUiState = { events += "clear-ui" }
            )
        }.exceptionOrNull()

        assertThat(failure).isInstanceOf(CloudDeletionIncompleteException::class.java)
        assertThat(failure?.message).contains("删除流程尚未完成")
        assertThat(events).containsExactly("pause", "publish-paused", "remote").inOrder()
    }

    @Test
    fun `successful deletion invalidates Room state before best effort reminder cleanup`() = runBlocking {
        val events = mutableListOf<String>()

        completeCloudDeletionFromUi(
            pauseAndCancelAnalysis = { events += "pause" },
            publishPauseState = { events += "publish-paused" },
            deleteCloudData = { events += "remote-room-identity" },
            cancelReminderWork = {
                events += "cancel-reminders"
                throw IOException("synthetic WorkManager failure")
            },
            clearTransientUiState = { events += "clear-ui" }
        )

        assertThat(events).containsExactly(
            "pause",
            "publish-paused",
            "remote-room-identity",
            "cancel-reminders",
            "clear-ui"
        ).inOrder()
    }

    @Test
    fun `pause failure still publishes the scheduler truth and never starts deletion`() = runBlocking {
        val events = mutableListOf<String>()

        val failure = runCatching {
            completeCloudDeletionFromUi(
                pauseAndCancelAnalysis = {
                    events += "pause"
                    throw IOException("cancellation confirmation failed")
                },
                publishPauseState = { events += "publish-pause-truth" },
                deleteCloudData = { events += "remote" },
                cancelReminderWork = { events += "cancel-reminders" },
                clearTransientUiState = { events += "clear-ui" }
            )
        }.exceptionOrNull()

        assertThat(failure).isInstanceOf(IOException::class.java)
        assertThat(events).containsExactly("pause", "publish-pause-truth").inOrder()
    }

    @Test
    fun `cancellation after deletion propagates after clearing stale UI state`() = runBlocking {
        val events = mutableListOf<String>()

        val failure = runCatching {
            completeCloudDeletionFromUi(
                pauseAndCancelAnalysis = { events += "pause" },
                publishPauseState = { events += "publish-paused" },
                deleteCloudData = { events += "remote-room-identity" },
                cancelReminderWork = {
                    events += "cancel-reminders"
                    throw CancellationException("scope stopped")
                },
                clearTransientUiState = { events += "clear-ui" }
            )
        }.exceptionOrNull()

        assertThat(failure).isInstanceOf(CancellationException::class.java)
        assertThat(events).containsExactly(
            "pause",
            "publish-paused",
            "remote-room-identity",
            "cancel-reminders",
            "clear-ui"
        ).inOrder()
    }
}
