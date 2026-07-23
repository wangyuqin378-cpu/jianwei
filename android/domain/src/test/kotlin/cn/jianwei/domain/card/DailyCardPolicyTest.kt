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

        val presentation = dailyCardPresentation(cards, LocalDate.parse("2026-07-23"))

        assertThat(presentation.dailyCards.map { it.cardId }).containsExactly("today", "past").inOrder()
        assertThat(presentation.focusedCard).isNull()
        assertThat(presentation.focusedCardStatus).isEqualTo(FocusedCardStatus.NONE)
    }

    @Test
    fun `widget focused future card opens separately without entering daily history`() {
        val cards = listOf(
            card("past", "2026-07-21", 1),
            card("today", "2026-07-23", 3),
            card("future", "2026-07-24", 4)
        )

        val presentation = dailyCardPresentation(
            cards = cards,
            today = LocalDate.parse("2026-07-23"),
            focusedCardId = "future"
        )

        assertThat(presentation.focusedCard?.cardId).isEqualTo("future")
        assertThat(presentation.focusedCardStatus).isEqualTo(FocusedCardStatus.AVAILABLE)
        assertThat(presentation.dailyCards.map { it.cardId }).containsExactly("today", "past").inOrder()
        assertThat(presentation.dailyCards.map { it.cardId }).doesNotContain("future")
    }

    @Test
    fun `unknown or unscheduled focus becomes an unavailable entry without revealing future content`() {
        val cards = listOf(
            card("today", "2026-07-23", 3),
            card("future", "2026-07-24", 4),
            card("draft", "2026-07-24", 5, status = "draft")
        )

        val missing = dailyCardPresentation(cards, LocalDate.parse("2026-07-23"), "missing")
        val draft = dailyCardPresentation(cards, LocalDate.parse("2026-07-23"), "draft")

        assertThat(missing.focusedCard).isNull()
        assertThat(missing.focusedCardStatus).isEqualTo(FocusedCardStatus.UNAVAILABLE)
        assertThat(missing.dailyCards.map { it.cardId }).containsExactly("today")
        assertThat(draft.focusedCard).isNull()
        assertThat(draft.focusedCardStatus).isEqualTo(FocusedCardStatus.UNAVAILABLE)
        assertThat(draft.dailyCards.map { it.cardId }).containsExactly("today")
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
