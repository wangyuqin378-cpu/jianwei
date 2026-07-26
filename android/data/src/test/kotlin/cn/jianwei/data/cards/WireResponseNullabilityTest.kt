package cn.jianwei.data.cards

import cn.jianwei.data.network.CardDto
import cn.jianwei.data.network.CardsResponse
import cn.jianwei.data.network.FeedbackResponse
import com.google.gson.Gson
import java.io.IOException
import org.junit.Assert.assertThrows
import org.junit.Test
import retrofit2.Response

class WireResponseNullabilityTest {
    private val gson = Gson()

    @Test
    fun `missing and null card fields deserialize but fail as IOException before persistence`() {
        val missingFields = gson.fromJson("""{"cardId":"$CARD_ID"}""", CardDto::class.java)
        val nullPageItem = gson.fromJson(
            """{"items":[null],"nextCursor":null}""",
            CardsResponse::class.java
        )

        assertThrows(IOException::class.java) { missingFields.validatedForPersistence() }
        assertThrows(IOException::class.java) { nullPageItem.validatedForCursor(null) }
    }

    @Test
    fun `missing feedback fields deserialize but cannot acknowledge an outbox`() {
        val missingFields = gson.fromJson(
            """{"id":"$FEEDBACK_ID","cardId":"$CARD_ID","action":"LIKE"}""",
            FeedbackResponse::class.java
        )

        assertThrows(IOException::class.java) {
            feedbackAcknowledgementOrThrow(
                Response.success(missingFields),
                CARD_ID,
                "LIKE",
                "broom"
            )
        }
    }

    private companion object {
        const val CARD_ID = "2a7d8040-f311-4e83-a38c-1bcd09f21961"
        const val FEEDBACK_ID = "16d3e259-3ec1-4232-b542-f9a7d8719464"
    }
}
