package cn.jianwei.data.network

import com.google.common.truth.Truth.assertThat
import java.io.IOException
import org.junit.Test

class AnalysisJobResponseBindingTest {
    private val apiBaseUrl = "http://10.0.2.2:8787/"

    @Test
    fun `accepts an upload response bound to the submitted candidate`() {
        val response = createResponse()

        val validated = response.validatedForCandidate(CANDIDATE_ID, apiBaseUrl)
        assertThat(validated.jobId).isEqualTo(JOB_ID)
        assertThat(validated.candidateToken).isEqualTo(CANDIDATE_ID)
        assertThat(validated.status).isEqualTo("awaiting_upload")
    }

    @Test
    fun `accepts terminal and already-uploaded create responses only without upload targets`() {
        for (status in listOf("uploaded", "completed", "needs_content", "rejected")) {
            val response = createResponse(status = status, uploadUrl = "")
            assertThat(response.validatedForCandidate(CANDIDATE_ID, apiBaseUrl).status).isEqualTo(status)
        }
        assertThat(createResponse(status = "completed", uploadUrl = null)
            .validatedForCandidate(CANDIDATE_ID, apiBaseUrl).uploadUrl).isNull()
    }

    @Test
    fun `rejects create responses that are not exactly bound and internally consistent`() {
        val invalid = listOf(
            createResponse(jobId = "not-a-uuid"),
            createResponse(jobId = null),
            createResponse(candidateToken = OTHER_CANDIDATE_ID),
            createResponse(candidateToken = null),
            createResponse(status = null),
            createResponse(status = "processing", uploadUrl = null),
            createResponse(uploadUrl = null),
            createResponse(uploadUrl = "https://attacker.example/upload"),
            createResponse(status = "completed"),
            createResponse(expiresAt = "tomorrow")
        )

        invalid.forEach { response ->
            assertThat(runCatching { response.validatedForCandidate(CANDIDATE_ID, apiBaseUrl) }.exceptionOrNull())
                .isInstanceOf(IOException::class.java)
        }
    }

    @Test
    fun `accepts completed response only when job candidate and card are bound`() {
        val response = completeResponse()

        val validated = response.validatedFor(JOB_ID, CANDIDATE_ID)
        assertThat(validated.jobId).isEqualTo(JOB_ID)
        assertThat(validated.candidateToken).isEqualTo(CANDIDATE_ID)
        assertThat(validated.status).isEqualTo("completed")
    }

    @Test
    fun `accepts no-card terminal outcomes`() {
        for (status in listOf("needs_content", "rejected")) {
            val response = completeResponse(status = status, card = null)
            assertThat(response.validatedFor(JOB_ID, CANDIDATE_ID).status).isEqualTo(status)
        }
    }

    @Test
    fun `rejects complete responses that can cross a job or candidate boundary`() {
        val invalid = listOf(
            completeResponse(jobId = OTHER_JOB_ID),
            completeResponse(jobId = null),
            completeResponse(candidateToken = OTHER_CANDIDATE_ID),
            completeResponse(candidateToken = null),
            completeResponse(status = null),
            completeResponse(card = validCard().copy(candidateToken = OTHER_CANDIDATE_ID)),
            completeResponse(card = validCard().copy(cardId = "not-a-uuid")),
            completeResponse(card = null),
            completeResponse(status = "processing"),
            completeResponse(status = "rejected"),
        )

        invalid.forEach { response ->
            assertThat(runCatching { response.validatedFor(JOB_ID, CANDIDATE_ID) }.exceptionOrNull())
                .isInstanceOf(IOException::class.java)
        }
    }

    private fun createResponse(
        jobId: String? = JOB_ID,
        candidateToken: String? = CANDIDATE_ID,
        status: String? = "awaiting_upload",
        uploadUrl: String? = "${apiBaseUrl}v1/analysis-jobs/$UPLOAD_SESSION_ID/image",
        expiresAt: String? = "2026-07-26T08:00:00Z"
    ) = CreateJobResponse(jobId, candidateToken, status, uploadUrl, expiresAt)

    private fun completeResponse(
        jobId: String? = JOB_ID,
        candidateToken: String? = CANDIDATE_ID,
        status: String? = "completed",
        card: CardDto? = validCard()
    ) = CompleteJobResponse(jobId, candidateToken, status, card)

    private fun validCard() = CardDto(
        cardId = CARD_ID,
        candidateToken = CANDIDATE_ID,
        topicId = "broom",
        factId = "broom-001",
        title = "扫帚为什么这样设计",
        detectedObjectName = "扫帚",
        body = "扫帚的刷毛角度会影响清扫时灰尘被聚拢的方向与效率。",
        personalContext = "来自你最近拍下的扫帚",
        confidence = 0.91,
        sources = listOf(
            SourceDto("source-1", "Source", "https://example.com/source", "Publisher", "reference")
        ),
        status = "scheduled",
        scheduledDate = "2026-07-27",
        createdAt = "2026-07-26T07:00:00Z"
    )

    private companion object {
        const val JOB_ID = "126820f9-8f55-4f30-888c-d5baab090b52"
        const val OTHER_JOB_ID = "226820f9-8f55-4f30-888c-d5baab090b52"
        const val UPLOAD_SESSION_ID = "326820f9-8f55-4f30-888c-d5baab090b52"
        const val CANDIDATE_ID = "7ff7a59e-2791-38b4-bdbe-3e8274eed084"
        const val OTHER_CANDIDATE_ID = "8ff7a59e-2791-38b4-bdbe-3e8274eed084"
        const val CARD_ID = "9ff7a59e-2791-48b4-bdbe-3e8274eed084"
    }
}
