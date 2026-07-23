package cn.jianwei.domain.card

import cn.jianwei.domain.model.KnowledgeCard
import com.google.common.truth.Truth.assertThat
import java.time.Instant
import java.time.LocalDate
import org.junit.Test

class DailyCardPolicyTest {
    @Test
    fun `future cache stays hidden while current card leads history`() {
        val cards = listOf(
            card("past", "2026-07-21", 1),
            card("future", "2026-07-24", 4),
            card("today", "2026-07-23", 3),
            card("draft", "2026-07-22", 2, status = "draft")
        )

        val visible = visibleDailyCards(cards, LocalDate.parse("2026-07-23"))

        assertThat(visible.map { it.cardId }).containsExactly("today", "past").inOrder()
    }

    @Test
    fun `widget focused future card is visible once and first`() {
        val cards = listOf(
            card("past", "2026-07-21", 1),
            card("today", "2026-07-23", 3),
            card("future", "2026-07-24", 4)
        )

        val visible = visibleDailyCards(
            cards = cards,
            today = LocalDate.parse("2026-07-23"),
            focusedCardId = "future"
        )

        assertThat(visible.map { it.cardId }).containsExactly("future", "today", "past").inOrder()
    }

    @Test
    fun `unknown or unscheduled focus cannot reveal hidden content`() {
        val cards = listOf(
            card("future", "2026-07-24", 4),
            card("draft", "2026-07-24", 5, status = "draft")
        )

        assertThat(visibleDailyCards(cards, LocalDate.parse("2026-07-23"), "missing")).isEmpty()
        assertThat(visibleDailyCards(cards, LocalDate.parse("2026-07-23"), "draft")).isEmpty()
    }

    private fun card(id: String, date: String, createdSecond: Long, status: String = "scheduled") = KnowledgeCard(
        cardId = id,
        candidateToken = "candidate-$id",
        photoUri = "content://photo/$id",
        topicId = "topic",
        factId = "fact",
        title = id,
        detectedObjectName = id,
        body = "body",
        personalContext = "context",
        confidence = 0.9,
        sources = emptyList(),
        status = status,
        scheduledDate = LocalDate.parse(date),
        createdAt = Instant.ofEpochSecond(createdSecond)
    )
}
