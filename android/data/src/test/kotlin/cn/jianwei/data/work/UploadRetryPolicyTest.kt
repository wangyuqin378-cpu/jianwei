package cn.jianwei.data.work

import cn.jianwei.data.control.AnalysisStoppedException
import cn.jianwei.data.network.AuthenticationExpiredException
import cn.jianwei.data.network.UploadHttpStatusException
import cn.jianwei.domain.model.AnalysisPhase
import cn.jianwei.domain.model.AnalysisState
import cn.jianwei.domain.model.PhotoOrigin
import com.google.common.truth.Truth.assertThat
import java.io.IOException
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response

class UploadRetryPolicyTest {
    @Test
    fun `privacy suppression is terminal while transient failures retry`() {
        assertThat(shouldRetryHttpStatus(410)).isFalse()
        assertThat(shouldRetryHttpStatus(400)).isFalse()
        assertThat(shouldRetryHttpStatus(409)).isTrue()
        assertThat(shouldRetryHttpStatus(429)).isTrue()
        assertThat(shouldRetryHttpStatus(503)).isTrue()
        assertThat(userMessageForHttpStatus(429)).contains("候选仍保留在本机")
        assertThat(userMessageForHttpStatus(503)).isNull()
    }

    @Test
    fun `privacy analysis keeps candidate bytes until bounded retries are exhausted`() {
        assertThat(shouldRetryPrivacyAnalysisFailure(0)).isTrue()
        assertThat(shouldRetryPrivacyAnalysisFailure(1)).isTrue()
        assertThat(shouldRetryPrivacyAnalysisFailure(2)).isFalse()
    }

    @Test
    fun `upload retry budget reaches beyond the server processing lease`() {
        assertThat(shouldRetryUploadWork(0)).isTrue()
        assertThat(shouldRetryUploadWork(1)).isTrue()
        assertThat(shouldRetryUploadWork(2)).isTrue()
        assertThat(shouldRetryUploadWork(3)).isFalse()
        assertThat(UPLOAD_RETRY_BACKOFF).isEqualTo(java.time.Duration.ofMinutes(1))
    }

    @Test
    fun `authorized evaluation retries only interruptions throttling and server failures`() {
        assertThat(shouldRetryAuthorizedEvaluationError(IOException("offline"))).isTrue()
        assertThat(shouldRetryAuthorizedEvaluationError(AnalysisStoppedException())).isTrue()
        assertThat(shouldRetryAuthorizedEvaluationError(http(429))).isTrue()
        assertThat(shouldRetryAuthorizedEvaluationError(http(503))).isTrue()
        assertThat(shouldRetryAuthorizedEvaluationError(http(401))).isFalse()
        assertThat(shouldRetryAuthorizedEvaluationError(http(403))).isFalse()
        assertThat(shouldRetryAuthorizedEvaluationError(http(410))).isFalse()
        assertThat(shouldRetryAuthorizedEvaluationError(IllegalStateException("invalid input"))).isFalse()
    }

    @Test
    fun `raw upload transient statuses retain explicit import and retry`() {
        listOf(409, 429, 503).forEach { status ->
            val disposition = candidateUploadFailureDisposition(
                UploadHttpStatusException(status),
                PhotoOrigin.PHOTO_PICKER
            )

            assertThat(disposition.statusCode).isEqualTo(status)
            assertThat(disposition.state).isEqualTo(AnalysisState.READY)
            assertThat(disposition.retryWork).isTrue()
            assertThat(disposition.terminateWork).isTrue()
            assertThat(disposition.keepImportedCopy).isTrue()
        }
    }

    @Test
    fun `raw upload terminal statuses filter explicit import and allow cleanup`() {
        listOf(400, 410, 413, 415).forEach { status ->
            val disposition = candidateUploadFailureDisposition(
                UploadHttpStatusException(status),
                PhotoOrigin.SHARED
            )

            assertThat(disposition.statusCode).isEqualTo(status)
            assertThat(disposition.state).isEqualTo(AnalysisState.FILTERED)
            assertThat(disposition.retryWork).isFalse()
            assertThat(disposition.terminateWork).isFalse()
            assertThat(disposition.keepImportedCopy).isFalse()
        }
    }

    @Test
    fun `authentication and authorization failures preserve explicit import and stop the batch`() {
        listOf(
            AuthenticationExpiredException(),
            http(401),
            http(403)
        ).forEach { error ->
            val disposition = candidateUploadFailureDisposition(error, PhotoOrigin.PHOTO_PICKER)

            assertThat(disposition.state).isEqualTo(AnalysisState.READY)
            assertThat(disposition.retryWork).isFalse()
            assertThat(disposition.terminateWork).isTrue()
            assertThat(disposition.keepImportedCopy).isTrue()
            assertThat(candidateUploadFailureProgress(disposition, retrying = false).detail)
                .contains("仍保留在本机")
        }
    }

    @Test
    fun `retrofit and raw upload status extraction share one policy`() {
        assertThat(httpStatusCode(http(429))).isEqualTo(429)
        assertThat(httpStatusCode(UploadHttpStatusException(429))).isEqualTo(429)
        assertThat(httpStatusCode(IOException("offline"))).isNull()
    }

    @Test
    fun `terminal progress distinguishes ready cache from honest no match`() {
        val ready = completedAnalysisProgress(cachedCardCount = 7, processedCount = 9)
        val noMatch = completedAnalysisProgress(cachedCardCount = 0, processedCount = 12)

        assertThat(ready.phase).isEqualTo(AnalysisPhase.READY)
        assertThat(ready.cachedCardCount).isEqualTo(7)
        assertThat(noMatch.phase).isEqualTo(AnalysisPhase.NO_MATCH)
        assertThat(noMatch.eligibleCount).isEqualTo(12)
    }

    @Test
    fun `bounded retry becomes visible terminal failure without claiming publication`() {
        val retrying = analysisFailureProgress(retrying = true, statusCode = 503)
        val failed = analysisFailureProgress(retrying = false, statusCode = 503)

        assertThat(retrying.phase).isEqualTo(AnalysisPhase.RETRYING)
        assertThat(retrying.detail).contains("自动重试")
        assertThat(failed.phase).isEqualTo(AnalysisPhase.FAILED)
        assertThat(failed.detail).contains("不会被当作知识卡发布")
    }

    private fun http(code: Int): HttpException = HttpException(Response.error<Any>(code, "error".toResponseBody()))
}
