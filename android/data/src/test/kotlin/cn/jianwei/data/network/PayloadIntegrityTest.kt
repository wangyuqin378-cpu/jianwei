package cn.jianwei.data.network

import com.google.common.truth.Truth.assertThat
import org.junit.Test

class PayloadIntegrityTest {
    @Test
    fun `detects any mutation between final privacy analysis and upload`() {
        val bytes = "sanitized-jpeg-payload".encodeToByteArray()
        val digest = payloadDigest(bytes)

        assertThat(payloadMatchesDigest(bytes, digest)).isTrue()
        bytes[4] = (bytes[4].toInt() xor 0x01).toByte()
        assertThat(payloadMatchesDigest(bytes, digest)).isFalse()
    }
}
