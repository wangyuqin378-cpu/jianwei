package cn.jianwei.data.network

import com.google.common.truth.Truth.assertThat
import java.io.IOException
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Test

class UploadResponsePolicyTest {
    @Test
    fun `successful raw upload acknowledgement is accepted only when every identity is bound`() {
        response(200, validBody()).use(::validate)
    }

    @Test
    fun `malformed successful acknowledgements are rejected as retryable protocol failures`() {
        val malformed = listOf(
            "",
            "not-json",
            "[]",
            validBody(jobId = OTHER_JOB_ID),
            validBody(candidateToken = OTHER_CANDIDATE_ID),
            validBody(uploadSessionId = OTHER_UPLOAD_SESSION_ID),
            validBody(status = "completed"),
            validBody().removeSuffix("}") + ",\"extra\":true}",
            validBody().replaceFirst("{", "{\"jobId\":\"$OTHER_JOB_ID\","),
            validBody().replace("\"status\":\"uploaded\"", "\"status\":true"),
            "{\"jobId\":\"$JOB_ID\"}",
            "x".repeat(4 * 1024 + 1)
        )

        malformed.forEach { body ->
            val error = response(200, body).use { runCatching { validate(it) }.exceptionOrNull() }
            assertThat(error).isInstanceOf(IOException::class.java)
        }
        val wrongSuccessCode = response(204, validBody()).use {
            runCatching { validate(it) }.exceptionOrNull()
        }
        assertThat(wrongSuccessCode).isInstanceOf(IOException::class.java)
    }

    @Test
    fun `raw upload preserves every non-authentication HTTP status without trusting its body`() {
        listOf(400, 409, 410, 413, 415, 429, 500, 503).forEach { status ->
            val error = response(status, "body-must-not-be-read").use { response ->
                runCatching { validate(response) }.exceptionOrNull()
            }

            assertThat(error).isInstanceOf(UploadHttpStatusException::class.java)
            assertThat((error as UploadHttpStatusException).statusCode).isEqualTo(status)
        }
    }

    @Test
    fun `raw upload 401 still requests one identity refresh`() {
        val error = response(401, "body-must-not-be-read").use { response ->
            runCatching { validate(response) }.exceptionOrNull()
        }

        assertThat(error).isInstanceOf(AuthenticationExpiredException::class.java)
    }

    private fun validate(response: Response) = requireSuccessfulUploadResponse(
        response = response,
        expectedJobId = JOB_ID,
        expectedCandidateToken = CANDIDATE_ID,
        expectedUploadSessionId = UPLOAD_SESSION_ID
    )

    private fun validBody(
        jobId: String = JOB_ID,
        candidateToken: String = CANDIDATE_ID,
        uploadSessionId: String = UPLOAD_SESSION_ID,
        status: String = "uploaded"
    ): String = """{"jobId":"$jobId","candidateToken":"$candidateToken","uploadSessionId":"$uploadSessionId","status":"$status"}"""

    private fun response(code: Int, body: String): Response = Response.Builder()
        .request(Request.Builder().url("https://api.example.test/v1/analysis-jobs/$UPLOAD_SESSION_ID/image").build())
        .protocol(Protocol.HTTP_1_1)
        .code(code)
        .message("test")
        .body(body.toResponseBody())
        .build()

    private companion object {
        const val JOB_ID = "126820f9-8f55-4f30-888c-d5baab090b52"
        const val OTHER_JOB_ID = "226820f9-8f55-4f30-888c-d5baab090b52"
        const val UPLOAD_SESSION_ID = "326820f9-8f55-4f30-888c-d5baab090b52"
        const val OTHER_UPLOAD_SESSION_ID = "426820f9-8f55-4f30-888c-d5baab090b52"
        const val CANDIDATE_ID = "7ff7a59e-2791-38b4-bdbe-3e8274eed084"
        const val OTHER_CANDIDATE_ID = "8ff7a59e-2791-38b4-bdbe-3e8274eed084"
    }
}
