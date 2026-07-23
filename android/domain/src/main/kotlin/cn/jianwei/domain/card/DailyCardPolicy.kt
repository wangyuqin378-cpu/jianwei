package cn.jianwei.domain.card

import cn.jianwei.domain.model.KnowledgeCard
import java.time.LocalDate

/**
 * Future scheduled cards are an offline delivery cache, not an in-app feed.
 * A widget-selected future card is the only exception so tapping the widget can open what it showed.
 */
fun visibleDailyCards(
    cards: List<KnowledgeCard>,
    today: LocalDate,
    focusedCardId: String? = null
): List<KnowledgeCard> {
    val scheduled = cards.filter { it.status == SCHEDULED_STATUS }
    val focused = focusedCardId?.let { id -> scheduled.firstOrNull { it.cardId == id } }
    val due = scheduled
        .asSequence()
        .filter { !it.scheduledDate.isAfter(today) }
        .filterNot { it.cardId == focused?.cardId }
        .sortedWith(
            compareByDescending<KnowledgeCard> { it.scheduledDate }
                .thenByDescending { it.createdAt }
                .thenBy { it.cardId }
        )
        .toList()
    return listOfNotNull(focused) + due
}

private const val SCHEDULED_STATUS = "scheduled"
