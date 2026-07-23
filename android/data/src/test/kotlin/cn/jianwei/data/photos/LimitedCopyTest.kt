package cn.jianwei.data.photos

import com.google.common.truth.Truth.assertThat
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import org.junit.Test

class LimitedCopyTest {
    @Test
    fun `copies within budget and rejects empty or oversized providers`() {
        val output = ByteArrayOutputStream()
        val copied = copyWithLimit(ByteArrayInputStream(ByteArray(32) { it.toByte() }), output, 32)
        assertThat(copied).isEqualTo(32)
        assertThat(output.size()).isEqualTo(32)

        assertThat(runCatching {
            copyWithLimit(ByteArrayInputStream(ByteArray(33)), ByteArrayOutputStream(), 32)
        }.exceptionOrNull()).isInstanceOf(IllegalArgumentException::class.java)
        assertThat(runCatching {
            copyWithLimit(ByteArrayInputStream(ByteArray(0)), ByteArrayOutputStream(), 32)
        }.exceptionOrNull()).isInstanceOf(IllegalArgumentException::class.java)
    }
}
