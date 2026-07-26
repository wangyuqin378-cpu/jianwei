package cn.jianwei.data.cards

import cn.jianwei.data.network.FeedbackResponse
import cn.jianwei.data.network.TopicAffinityDto
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response

class FeedbackResponsePolicyTest {
    @Test
    fun `non-success feedback is thrown so identity recovery or worker retry can run`() {
        val response = Response.error<FeedbackResponse>(
            401,
            "unauthorized".toResponseBody("application/json".toMediaType())
        )

        val error = assertThrows(HttpException::class.java) {
            feedbackAcknowledgementOrThrow(response, CARD_ID, "LIKE", "broom")
        }

        assertEquals(401, error.code())
    }

    @Test
    fun `successful feedback is bound to the pending card and action`() {
        val response = FeedbackResponse(
            id = FEEDBACK_ID,
            cardId = CARD_ID,
            action = "LIKE",
            createdAt = "2026-07-26T00:00:00.000Z",
            topicAffinities = listOf(TopicAffinityDto("broom", 0.7, listOf("扫帚")))
        )

        val acknowledgement = feedbackAcknowledgementOrThrow(Response.success(response), CARD_ID, "LIKE", "broom")

        assertEquals(FEEDBACK_ID, acknowledgement.feedbackId)
        assertEquals(CARD_ID, acknowledgement.cardId)
        assertEquals("LIKE", acknowledgement.action)
        assertEquals(1, acknowledgement.topicAffinities.size)
        assertThrows(java.io.IOException::class.java) {
            feedbackAcknowledgementOrThrow(Response.success<FeedbackResponse>(null), CARD_ID, "LIKE", "broom")
        }
    }

    @Test
    fun `mismatched or malformed acknowledgement cannot consume an outbox row`() {
        val valid = FeedbackResponse(
            id = FEEDBACK_ID,
            cardId = CARD_ID,
            action = "LIKE",
            createdAt = "2026-07-26T00:00:00.000Z",
            topicAffinities = listOf(TopicAffinityDto("broom", 0.7, emptyList()))
        )
        val invalid = listOf(
            valid.copy(id = "not-a-uuid"),
            valid.copy(cardId = OTHER_CARD_ID),
            valid.copy(action = "DISLIKE"),
            valid.copy(createdAt = "not-an-instant"),
            valid.copy(topicAffinities = emptyList()),
            valid.copy(topicAffinities = listOf(
                TopicAffinityDto("broom", 0.7, emptyList()),
                TopicAffinityDto("toothbrush", 0.2, emptyList())
            )),
            valid.copy(topicAffinities = listOf(TopicAffinityDto("broom", Double.NaN, emptyList())))
        )

        invalid.forEach { body ->
            assertThrows(java.io.IOException::class.java) {
                feedbackAcknowledgementOrThrow(Response.success(body), CARD_ID, "LIKE", "broom")
            }
        }
    }

    @Test
    fun `topic snapshot must match pending topic while legacy unbound rows skip the snapshot`() {
        val response = FeedbackResponse(
            id = FEEDBACK_ID,
            cardId = CARD_ID,
            action = "LIKE",
            createdAt = "2026-07-26T00:00:00.000Z",
            topicAffinities = listOf(TopicAffinityDto("toothbrush", -2.0, emptyList()))
        )

        assertThrows(java.io.IOException::class.java) {
            feedbackAcknowledgementOrThrow(Response.success(response), CARD_ID, "LIKE", "broom")
        }
        val legacy = feedbackAcknowledgementOrThrow(Response.success(response), CARD_ID, "LIKE", null)
        assertEquals(emptyList<ServerTopicAffinity>(), legacy.topicAffinities)
    }

    private companion object {
        const val FEEDBACK_ID = "16d3e259-3ec1-4232-b542-f9a7d8719464"
        const val CARD_ID = "2a7d8040-f311-4e83-a38c-1bcd09f21961"
        const val OTHER_CARD_ID = "f8dd6a8b-5d4a-4c5a-881d-cddad8fd52c5"
    }
}
