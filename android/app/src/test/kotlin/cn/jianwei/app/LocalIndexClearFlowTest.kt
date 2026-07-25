package cn.jianwei.app

import com.google.common.truth.Truth.assertThat
import java.io.IOException
import kotlinx.coroutines.runBlocking
import org.junit.Test

class LocalIndexClearFlowTest {
    @Test
    fun `analysis drains before photo references and index are cleared`() = runBlocking {
        val events = mutableListOf<String>()

        clearLocalIndexFromUi(
            pauseAndCancelAnalysis = { events += "pause-and-drain" },
            publishPauseState = { events += "publish-paused" },
            clearCardPhotoReferences = { events += "clear-card-photos" },
            clearPhotoIndex = { events += "clear-index-and-private-copies" },
            clearTransientUiState = { events += "clear-ui" }
        )

        assertThat(events).containsExactly(
            "pause-and-drain",
            "publish-paused",
            "clear-card-photos",
            "clear-index-and-private-copies",
            "clear-ui"
        ).inOrder()
    }

    @Test
    fun `pause failure publishes scheduler truth and leaves the index untouched`() = runBlocking {
        val events = mutableListOf<String>()

        val failure = runCatching {
            clearLocalIndexFromUi(
                pauseAndCancelAnalysis = {
                    events += "pause-and-drain"
                    throw IOException("worker cancellation failed")
                },
                publishPauseState = { events += "publish-pause-truth" },
                clearCardPhotoReferences = { events += "clear-card-photos" },
                clearPhotoIndex = { events += "clear-index" },
                clearTransientUiState = { events += "clear-ui" }
            )
        }.exceptionOrNull()

        assertThat(failure).isInstanceOf(IOException::class.java)
        assertThat(events).containsExactly("pause-and-drain", "publish-pause-truth").inOrder()
    }

    @Test
    fun `partial clear failure stays paused and remains retryable`() = runBlocking {
        val events = mutableListOf<String>()

        val failure = runCatching {
            clearLocalIndexFromUi(
                pauseAndCancelAnalysis = { events += "pause-and-drain" },
                publishPauseState = { events += "publish-paused" },
                clearCardPhotoReferences = { events += "clear-card-photos" },
                clearPhotoIndex = {
                    events += "clear-index"
                    throw IOException("disk unavailable")
                },
                clearTransientUiState = { events += "clear-ui" }
            )
        }.exceptionOrNull()

        assertThat(failure).isInstanceOf(LocalIndexClearIncompleteException::class.java)
        assertThat(failure?.message).contains("本地照片索引尚未完全清除")
        assertThat(events).containsExactly(
            "pause-and-drain",
            "publish-paused",
            "clear-card-photos",
            "clear-index"
        ).inOrder()
    }
}
