package cn.jianwei.domain.card

import cn.jianwei.domain.model.KnowledgeCard
import java.time.LocalDate

enum class FocusedCardStatus {
    NONE,
    AVAILABLE,
    UNAVAILABLE
}

data class DailyCardPresentation(
    val dailyCards: List<KnowledgeCard>,
    val focusedCard: KnowledgeCard?,
    val focusedCardStatus: FocusedCardStatus
)

/**
 * Future scheduled cards are an offline delivery cache, never part of the ordinary in-app feed.
 * A widget or reminder deep-link may resolve one scheduled card into a separate focused-card mode;
 * it is deliberately not inserted into [dailyCards].
 */
fun dailyCardPresentation(
    cards: List<KnowledgeCard>,
    today: LocalDate,
    focusedCardId: String? = null
): DailyCardPresentation {
    val scheduled = cards.filter { it.status == SCHEDULED_STATUS }
    val focused = focusedCardId?.let { id -> scheduled.firstOrNull { it.cardId == id } }
    val due = scheduled
        .asSequence()
        .filter { !it.scheduledDate.isAfter(today) }
        .sortedWith(
            compareByDescending<KnowledgeCard> { it.scheduledDate }
                .thenByDescending { it.createdAt }
                .thenBy { it.cardId }
        )
        .toList()
    val focusStatus = when {
        focusedCardId == null -> FocusedCardStatus.NONE
        focused != null -> FocusedCardStatus.AVAILABLE
        else -> FocusedCardStatus.UNAVAILABLE
    }
    return DailyCardPresentation(
        dailyCards = due,
        focusedCard = focused,
        focusedCardStatus = focusStatus
    )
}

private const val SCHEDULED_STATUS = "scheduled"
