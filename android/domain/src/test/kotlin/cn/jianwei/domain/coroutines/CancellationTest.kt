package cn.jianwei.domain.coroutines

import com.google.common.truth.Truth.assertThat
import kotlinx.coroutines.CancellationException
import org.junit.Test

class CancellationTest {
    @Test
    fun `coroutine cancellation is rethrown unchanged`() {
        val cancellation = CancellationException("cancel worker")

        val thrown = runCatching { cancellation.throwIfCancellation() }.exceptionOrNull()

        assertThat(thrown).isSameInstanceAs(cancellation)
    }

    @Test
    fun `ordinary failures remain available to product retry policy`() {
        val failure = IllegalStateException("service unavailable")

        assertThat(runCatching { failure.throwIfCancellation() }.exceptionOrNull()).isNull()
    }
}
