package cn.jianwei.data.cards

import com.google.common.truth.Truth.assertThat
import kotlinx.coroutines.runBlocking
import org.junit.Test

class CloudDeletionOrderTest {
    @Test
    fun `remote then Room then identity is the only successful order`() = runBlocking {
        val events = mutableListOf<String>()

        completeCrashSafeCloudDeletion(
            deleteRemote = { events += "remote" },
            clearLocal = { events += "room" },
            resetIdentity = { events += "identity" }
        )

        assertThat(events).containsExactly("remote", "room", "identity").inOrder()
    }

    @Test
    fun `Room failure preserves confirmed identity recovery state`() = runBlocking {
        val events = mutableListOf<String>()

        val failure = runCatching {
            completeCrashSafeCloudDeletion(
                deleteRemote = { events += "remote" },
                clearLocal = {
                    events += "room"
                    error("simulated Room transaction failure")
                },
                resetIdentity = { events += "identity" }
            )
        }.exceptionOrNull()

        assertThat(failure).isInstanceOf(IllegalStateException::class.java)
        assertThat(events).containsExactly("remote", "room").inOrder()
    }
}
