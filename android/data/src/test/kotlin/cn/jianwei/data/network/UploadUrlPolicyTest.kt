package cn.jianwei.data.network

import com.google.common.truth.Truth.assertThat
import okio.Buffer
import org.junit.Test

class UploadUrlPolicyTest {
    private val api = "http://10.0.2.2:8787/"
    private val uploadSessionId = "126820f9-8f55-4f30-888c-d5baab090b52"

    @Test
    fun `allows only the api one-time image endpoint`() {
        assertThat(isAllowedUploadUrl("http://10.0.2.2:8787/v1/analysis-jobs/$uploadSessionId/image", api)).isTrue()
        assertThat(isAllowedUploadUrl("https://bucket.oss-cn-beijing.aliyuncs.com/key?signature=x", api)).isFalse()
        assertThat(isAllowedUploadUrl("https://attacker.example/upload", api)).isFalse()
    }

    @Test
    fun `rejects authority and suffix bypasses`() {
        assertThat(isAllowedUploadUrl("http://token@10.0.2.2:8787/v1/analysis-jobs/$uploadSessionId/image", api)).isFalse()
        assertThat(isAllowedUploadUrl("http://evil.com@10.0.2.2:8787/v1/analysis-jobs/$uploadSessionId/image", api)).isFalse()
        assertThat(isAllowedUploadUrl("http://10.0.2.2.evil.com:8787/v1/analysis-jobs/$uploadSessionId/image", api)).isFalse()
        assertThat(isAllowedUploadUrl("http://10.0.2.2:444/v1/analysis-jobs/$uploadSessionId/image", api)).isFalse()
    }

    @Test
    fun `rejects unicode scheme fragment and query variants`() {
        assertThat(isAllowedUploadUrl("http://10.0.2.眉:8787/v1/analysis-jobs/$uploadSessionId/image", api)).isFalse()
        assertThat(isAllowedUploadUrl("https://10.0.2.2:8787/v1/analysis-jobs/$uploadSessionId/image", api)).isFalse()
        assertThat(isAllowedUploadUrl("http://10.0.2.2:8787/v1/analysis-jobs/$uploadSessionId/image#https://evil.example", api)).isFalse()
        assertThat(isAllowedUploadUrl("http://10.0.2.2:8787/v1/analysis-jobs/$uploadSessionId/image?Signature=x", api)).isFalse()
    }

    @Test
    fun `api origin permits only the exact upload-session image path`() {
        assertThat(isAllowedUploadUrl("http://10.0.2.2:8787/admin/delete", api)).isFalse()
        assertThat(isAllowedUploadUrl("http://10.0.2.2:8787/v1/analysis-jobs/not-a-uuid/image", api)).isFalse()
        assertThat(isAllowedUploadUrl("http://10.0.2.2:8787/v1/analysis-jobs/$uploadSessionId/../image", api)).isFalse()
    }

    @Test
    fun `external upload is rejected before a request can be built`() {
        val result = runCatching {
            buildUploadRequest(
                uploadUrl = "https://bucket.oss-cn-beijing.aliyuncs.com/key?Signature=x",
                contentType = "image/jpeg",
                bytes = "sanitized-payload".encodeToByteArray(),
                apiBaseUrl = api,
                bearer = "Bearer private-device-token"
            ) {}
        }
        assertThat(result.isFailure).isTrue()
    }

    @Test
    fun `same-origin upload carries bearer and exact sanitized bytes`() {
        val bytes = byteArrayOf(1, 2, 3)
        val request = buildUploadRequest(
            uploadUrl = "http://10.0.2.2:8787/v1/analysis-jobs/$uploadSessionId/image",
            contentType = "image/jpeg",
            bytes = bytes,
            apiBaseUrl = api,
            bearer = "Bearer private-device-token"
        ) {}
        val sink = Buffer()
        request.body!!.writeTo(sink)

        assertThat(request.header("Authorization")).isEqualTo("Bearer private-device-token")
        assertThat(sink.readByteArray()).isEqualTo(bytes)
    }
}
