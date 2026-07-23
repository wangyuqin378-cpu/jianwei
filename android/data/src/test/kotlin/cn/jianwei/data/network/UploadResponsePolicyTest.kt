package cn.jianwei.data.network

import com.google.common.truth.Truth.assertThat
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Test

class UploadResponsePolicyTest {
    @Test
    fun `successful raw upload response is accepted`() {
        response(204).use { requireSuccessfulUploadResponse(it) }
    }

    @Test
    fun `raw upload preserves every non-authentication HTTP status`() {
        listOf(400, 409, 410, 413, 415, 429, 500, 503).forEach { status ->
            val error = response(status).use { response ->
                runCatching { requireSuccessfulUploadResponse(response) }.exceptionOrNull()
            }

            assertThat(error).isInstanceOf(UploadHttpStatusException::class.java)
            assertThat((error as UploadHttpStatusException).statusCode).isEqualTo(status)
        }
    }

    @Test
    fun `raw upload 401 still requests one identity refresh`() {
        val error = response(401).use { response ->
            runCatching { requireSuccessfulUploadResponse(response) }.exceptionOrNull()
        }

        assertThat(error).isInstanceOf(AuthenticationExpiredException::class.java)
    }

    private fun response(code: Int): Response = Response.Builder()
        .request(Request.Builder().url("https://api.example.test/v1/analysis-jobs/00000000-0000-4000-8000-000000000000/image").build())
        .protocol(Protocol.HTTP_1_1)
        .code(code)
        .message("test")
        .body("body-must-not-be-read".toResponseBody())
        .build()
}
