package cn.jianwei.data.network

import com.google.common.truth.Truth.assertThat
import okhttp3.MediaType.Companion.toMediaType
import okio.Buffer
import org.junit.Test

class PermissionCheckedRequestBodyTest {
    @Test
    fun `aborts an in flight media upload when exact item access is revoked`() {
        val payload = ByteArray(3 * 64 * 1024)
        val sink = Buffer()
        var checks = 0
        val body = PermissionCheckedRequestBody(payload, "image/jpeg".toMediaType()) {
            checks += 1
            if (checks == 3) throw SecurityException("revoked")
        }

        val error = runCatching { body.writeTo(sink) }.exceptionOrNull()

        assertThat(error).isInstanceOf(SecurityException::class.java)
        assertThat(sink.size).isEqualTo((2L * 64 * 1024))
    }

    @Test
    fun `writes exactly the sanitized byte array while permission checks only gate progress`() {
        val payload = ByteArray(2 * 64 * 1024 + 17) { index -> (index % 251).toByte() }
        val expectedDigest = payloadDigest(payload)
        val sink = Buffer()
        var checks = 0
        val body = PermissionCheckedRequestBody(payload, "image/jpeg".toMediaType()) { checks += 1 }

        body.writeTo(sink)
        val written = sink.readByteArray()

        assertThat(written).isEqualTo(payload)
        assertThat(payloadMatchesDigest(written, expectedDigest)).isTrue()
        assertThat(checks).isEqualTo(4)
    }
}
