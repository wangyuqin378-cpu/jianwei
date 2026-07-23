package cn.jianwei.app

import com.google.common.truth.Truth.assertThat
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Test

class UserOperationGateTest {
    @Test
    fun `second mutation is rejected until the active one finishes`() {
        val gate = UserOperationGate()

        assertThat(gate.tryStart(UserOperation.UPDATE_SAVED)).isTrue()
        assertThat(gate.current()).isEqualTo(UserOperation.UPDATE_SAVED)
        assertThat(gate.tryStart(UserOperation.DELETE_CLOUD_DATA)).isFalse()
        assertThat(gate.finish(UserOperation.DELETE_CLOUD_DATA)).isFalse()
        assertThat(gate.current()).isEqualTo(UserOperation.UPDATE_SAVED)

        assertThat(gate.finish(UserOperation.UPDATE_SAVED)).isTrue()
        assertThat(gate.current()).isNull()
        assertThat(gate.tryStart(UserOperation.DELETE_CLOUD_DATA)).isTrue()
    }

    @Test
    fun `concurrent taps admit exactly one mutation`() {
        val gate = UserOperationGate()
        val workers = 16
        val ready = CountDownLatch(workers)
        val start = CountDownLatch(1)
        val accepted = AtomicInteger(0)
        val executor = Executors.newFixedThreadPool(workers)

        try {
            val futures = (1..workers).map {
                executor.submit {
                    ready.countDown()
                    check(start.await(2, TimeUnit.SECONDS))
                    if (gate.tryStart(UserOperation.RECORD_FEEDBACK)) accepted.incrementAndGet()
                }
            }
            assertThat(ready.await(2, TimeUnit.SECONDS)).isTrue()
            start.countDown()
            futures.forEach { it.get(2, TimeUnit.SECONDS) }
        } finally {
            executor.shutdownNow()
        }

        assertThat(accepted.get()).isEqualTo(1)
        assertThat(gate.current()).isEqualTo(UserOperation.RECORD_FEEDBACK)
    }
}
