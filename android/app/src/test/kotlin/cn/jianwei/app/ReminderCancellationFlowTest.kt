package cn.jianwei.app

import com.google.common.truth.Truth.assertThat
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.junit.Test

class ReminderCancellationFlowTest {
    @Test
    fun `durable cancellation commits before local Work cleanup`(): Unit = runBlocking {
        val events = mutableListOf<String>()

        cancelReminderFromUi(
            commitDurableCancellation = { events += "room-delete" },
            cancelLocalWork = { events += "cancel-work" }
        )

        assertThat(events).containsExactly("room-delete", "cancel-work").inOrder()
    }

    @Test
    fun `durable failure leaves local Work untouched`(): Unit = runBlocking {
        val events = mutableListOf<String>()

        val failure = runCatching {
            cancelReminderFromUi(
                commitDurableCancellation = {
                    events += "room-delete"
                    throw IOException("synthetic Room failure")
                },
                cancelLocalWork = { events += "cancel-work" }
            )
        }.exceptionOrNull()

        assertThat(failure).isInstanceOf(IOException::class.java)
        assertThat(events).containsExactly("room-delete")
    }

    @Test
    fun `Work cleanup failure does not undo committed cancellation`(): Unit = runBlocking {
        val events = mutableListOf<String>()

        val failure = runCatching {
            cancelReminderFromUi(
                commitDurableCancellation = { events += "room-delete" },
                cancelLocalWork = {
                    events += "cancel-work"
                    throw IOException("synthetic WorkManager failure")
                }
            )
        }.exceptionOrNull()

        assertThat(failure).isNull()
        assertThat(events).containsExactly("room-delete", "cancel-work").inOrder()
    }

    @Test
    fun `coroutine cancellation still propagates after durable commit`(): Unit = runBlocking {
        val events = mutableListOf<String>()

        val failure = runCatching {
            cancelReminderFromUi(
                commitDurableCancellation = { events += "room-delete" },
                cancelLocalWork = {
                    events += "cancel-work"
                    throw CancellationException("scope stopped")
                }
            )
        }.exceptionOrNull()

        assertThat(failure).isInstanceOf(CancellationException::class.java)
        assertThat(events).containsExactly("room-delete", "cancel-work").inOrder()
    }
}
