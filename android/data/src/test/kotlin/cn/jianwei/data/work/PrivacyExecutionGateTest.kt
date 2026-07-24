package cn.jianwei.data.work

import com.google.common.truth.Truth.assertThat
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.junit.Test

class PrivacyExecutionGateTest {
    @Test
    fun serializesConcurrentAutomaticBatches() = runBlocking {
        val gate = PrivacyExecutionGate()
        val active = AtomicInteger(0)
        val maximum = AtomicInteger(0)

        (1..20).map {
            async(Dispatchers.Default) {
                gate.run(UploadOriginScope.MEDIA_STORE) {
                    val nowActive = active.incrementAndGet()
                    maximum.accumulateAndGet(nowActive, ::maxOf)
                    delay(5)
                    active.decrementAndGet()
                }
            }
        }.awaitAll()

        assertThat(maximum.get()).isEqualTo(1)
        assertThat(active.get()).isEqualTo(0)
        Unit
    }

    @Test
    fun explicitImportDoesNotWaitForAutomaticBatch() = runBlocking {
        val gate = PrivacyExecutionGate()
        val automaticEntered = CompletableDeferred<Unit>()
        val releaseAutomatic = CompletableDeferred<Unit>()
        val explicitEntered = CompletableDeferred<Unit>()

        val automatic = async {
            gate.run(UploadOriginScope.MEDIA_STORE) {
                automaticEntered.complete(Unit)
                releaseAutomatic.await()
            }
        }
        automaticEntered.await()
        val explicit = async {
            gate.run(UploadOriginScope.EXPLICIT_IMPORT) { explicitEntered.complete(Unit) }
        }

        explicitEntered.await()
        releaseAutomatic.complete(Unit)
        automatic.await()
        explicit.await()
        Unit
    }

    @Test
    fun cancelledAutomaticWaiterNeverEntersAndGateRemainsUsable() = runBlocking {
        val gate = PrivacyExecutionGate()
        val firstEntered = CompletableDeferred<Unit>()
        val releaseFirst = CompletableDeferred<Unit>()
        val waitingEntered = AtomicBoolean(false)

        val first = async {
            gate.run(UploadOriginScope.MEDIA_STORE) {
                firstEntered.complete(Unit)
                releaseFirst.await()
            }
        }
        firstEntered.await()
        val waiting = async {
            gate.run(UploadOriginScope.MEDIA_STORE) { waitingEntered.set(true) }
        }
        delay(25)
        waiting.cancelAndJoin()

        assertThat(waitingEntered.get()).isFalse()
        releaseFirst.complete(Unit)
        first.await()
        assertThat(gate.run(UploadOriginScope.MEDIA_STORE) { "released" }).isEqualTo("released")
        Unit
    }
}
