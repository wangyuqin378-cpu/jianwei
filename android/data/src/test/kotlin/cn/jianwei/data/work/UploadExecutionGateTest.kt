package cn.jianwei.data.work

import com.google.common.truth.Truth.assertThat
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.junit.Test

class UploadExecutionGateTest {
    @Test
    fun serializesConcurrentCallers() = runBlocking {
        val gate = UploadExecutionGate()
        val active = AtomicInteger(0)
        val maximum = AtomicInteger(0)

        (1..20).map {
            async(Dispatchers.Default) {
                gate.runExclusive {
                    val nowActive = active.incrementAndGet()
                    maximum.accumulateAndGet(nowActive, ::maxOf)
                    delay(5)
                    active.decrementAndGet()
                }
            }
        }.awaitAll()

        assertThat(maximum.get()).isEqualTo(1)
        assertThat(active.get()).isEqualTo(0)
    }

    @Test
    fun cancellationWhileWaitingDoesNotEnterOrPoisonGate() = runBlocking {
        val gate = UploadExecutionGate()
        val firstEntered = CompletableDeferred<Unit>()
        val releaseFirst = CompletableDeferred<Unit>()
        val waitingCallerEntered = AtomicBoolean(false)

        val first = async(Dispatchers.Default) {
            gate.runExclusive {
                firstEntered.complete(Unit)
                releaseFirst.await()
            }
        }
        firstEntered.await()

        val waiting = async(Dispatchers.Default) {
            gate.runExclusive {
                waitingCallerEntered.set(true)
            }
        }
        delay(25)
        waiting.cancelAndJoin()

        assertThat(waitingCallerEntered.get()).isFalse()
        releaseFirst.complete(Unit)
        first.await()

        val subsequentResult = gate.runExclusive { "available" }
        assertThat(subsequentResult).isEqualTo("available")
    }

    @Test
    fun cancellationWhileHoldingPropagatesAndReleasesGate() = runBlocking {
        val gate = UploadExecutionGate()
        val entered = CompletableDeferred<Unit>()
        val hold = CompletableDeferred<Unit>()
        val cancellationReachedCaller = AtomicBoolean(false)

        val holder = async(Dispatchers.Default) {
            try {
                gate.runExclusive {
                    entered.complete(Unit)
                    hold.await()
                }
            } catch (error: CancellationException) {
                cancellationReachedCaller.set(true)
                throw error
            }
        }
        entered.await()
        holder.cancel()
        holder.cancelAndJoin()

        assertThat(cancellationReachedCaller.get()).isTrue()
        assertThat(gate.runExclusive { "released" }).isEqualTo("released")
    }
}
