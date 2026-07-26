package cn.jianwei.data.cards

import cn.jianwei.data.network.CardDto
import cn.jianwei.data.network.SourceDto
import com.google.common.truth.Truth.assertThat
import java.io.IOException
import java.time.Instant
import org.junit.Assert.assertThrows
import org.junit.Test

class CardPayloadValidationTest {
    @Test
    fun `valid card is normalized before Room persistence`() {
        val payload = validCard().copy(
            title = "  扫帚为什么更容易贴近墙角  ",
            body = "  现代扫帚常把刷毛设计成略带角度的扇形，让边缘更容易贴近墙角和家具边缘。  "
        ).validatedForPersistence()

        assertThat(payload.title).isEqualTo("扫帚为什么更容易贴近墙角")
        assertThat(payload.body).isEqualTo("现代扫帚常把刷毛设计成略带角度的扇形，让边缘更容易贴近墙角和家具边缘。")
        assertThat(payload.scheduledDate).isEqualTo("2026-07-26")
        assertThat(payload.createdAtMillis).isEqualTo(Instant.parse("2026-07-26T00:00:00.000Z").toEpochMilli())
        assertThat(payload.sources).hasSize(1)
    }

    @Test
    fun `malformed remote card is rejected before it can poison Room`() {
        val invalidCards = listOf(
            validCard().copy(cardId = "not-a-uuid"),
            validCard().copy(candidateToken = "not-a-uuid"),
            validCard().copy(topicId = "topic/with/path"),
            validCard().copy(title = " "),
            validCard().copy(detectedObjectName = "物".repeat(61)),
            validCard().copy(body = "知".repeat(241)),
            validCard().copy(personalContext = ""),
            validCard().copy(confidence = Double.NaN),
            validCard().copy(confidence = 1.01),
            validCard().copy(status = "scheduled "),
            validCard().copy(scheduledDate = "2026-02-30"),
            validCard().copy(createdAt = "not-an-instant")
        )

        invalidCards.forEach { card ->
            assertThrows(IOException::class.java) { card.validatedForPersistence() }
        }
    }

    private fun validCard() = CardDto(
        cardId = "2a7d8040-f311-4e83-a38c-1bcd09f21961",
        candidateToken = "7ff7a59e-2791-38b4-bdbe-3e8274eed084",
        topicId = "broom",
        factId = "broom-001",
        title = "扫帚为什么更容易贴近墙角",
        detectedObjectName = "扫帚",
        body = "现代扫帚常把刷毛设计成略带角度的扇形，让边缘更容易贴近墙角和家具边缘。",
        personalContext = "它来自你主动授权的照片，所以今天从「扫帚」讲起。",
        confidence = 0.91,
        sources = listOf(
            SourceDto(
                sourceId = "source-001",
                title = "Broom construction",
                url = "https://patents.google.com/patent/US4756039A/en",
                publisher = "Google Patents",
                authority = "reference"
            )
        ),
        status = "scheduled",
        scheduledDate = "2026-07-26",
        createdAt = "2026-07-26T00:00:00.000Z"
    )
}
