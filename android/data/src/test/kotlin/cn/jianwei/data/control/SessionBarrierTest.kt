package cn.jianwei.data.control

import com.google.common.truth.Truth.assertThat
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import org.junit.Test

class SessionBarrierTest {
    @Test
    fun pauseInvalidatesInFlightWorkAndWaitsUntilItExits() = runBlocking {
        val barrier = SessionBarrier()
        val entered = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val operation = async {
            runCatching {
                barrier.withActiveSession { token ->
                    entered.complete(Unit)
                    release.await()
                    token.requireActive()
                }
            }.exceptionOrNull()
        }
        entered.await()

        barrier.invalidate()
        val drain = async { barrier.awaitDrained() }
        yield()
        assertThat(drain.isCompleted).isFalse()

        release.complete(Unit)
        assertThat(operation.await()).isInstanceOf(AnalysisStoppedException::class.java)
        drain.await()
    }

    @Test
    fun pausedBarrierRejectsNewWorkUntilAFreshEpochResumes() = runBlocking {
        val barrier = SessionBarrier()
        barrier.invalidate()

        assertThat(runCatching { barrier.withActiveSession { "unexpected" } }.exceptionOrNull())
            .isInstanceOf(AnalysisStoppedException::class.java)

        barrier.resume()
        assertThat(barrier.withActiveSession { token -> token.requireActive(); "ok" }).isEqualTo("ok")
    }

    @Test
    fun pausedBarrierAllowsSerializedLocalMutationsWithoutResuming() = runBlocking {
        val barrier = SessionBarrier()
        barrier.invalidate()

        val result = barrier.withSerializedLocalMutation { "committed-locally" }

        assertThat(result).isEqualTo("committed-locally")
        assertThat(barrier.isPaused()).isTrue()
    }

    @Test
    fun localMutationWaitsForInvalidatedActiveWorkBeforeCommitting() = runBlocking {
        val barrier = SessionBarrier()
        val entered = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val activeWork = async {
            runCatching {
                barrier.withActiveSession { token ->
                    entered.complete(Unit)
                    release.await()
                    token.requireActive()
                }
            }.exceptionOrNull()
        }
        entered.await()

        barrier.invalidate()
        val localMutation = async {
            barrier.withSerializedLocalMutation { "committed-after-drain" }
        }
        yield()
        assertThat(localMutation.isCompleted).isFalse()

        release.complete(Unit)
        assertThat(activeWork.await()).isInstanceOf(AnalysisStoppedException::class.java)
        assertThat(localMutation.await()).isEqualTo("committed-after-drain")
        assertThat(barrier.isPaused()).isTrue()
    }
}
