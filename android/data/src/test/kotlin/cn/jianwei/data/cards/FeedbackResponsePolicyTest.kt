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

        val error = assertThrows(HttpException::class.java) { feedbackBodyOrThrow(response) }

        assertEquals(401, error.code())
    }

    @Test
    fun `successful feedback requires and returns its response body`() {
        val expected = FeedbackResponse(
            topicAffinities = listOf(TopicAffinityDto("broom", 0.7, listOf("扫帚")))
        )

        assertEquals(expected, feedbackBodyOrThrow(Response.success(expected)))
        assertThrows(java.io.IOException::class.java) {
            feedbackBodyOrThrow(Response.success<FeedbackResponse>(null))
        }
    }
}
