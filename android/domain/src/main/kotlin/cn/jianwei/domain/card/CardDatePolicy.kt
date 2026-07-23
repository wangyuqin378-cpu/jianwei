package cn.jianwei.domain.card

import java.time.LocalDate

enum class CardDateSection {
    TODAY,
    HISTORY,
    UPCOMING
}

data class CardDatePresentation(
    val visibleLabel: String,
    val accessibilityLabel: String,
    val section: CardDateSection
)

/**
 * A card's scheduled day is part of its meaning. Historical and pre-cached cards must never be
 * presented as today's card merely because the user is looking at them now.
 */
fun cardDatePresentation(
    scheduledDate: LocalDate,
    today: LocalDate
): CardDatePresentation {
    val section = when {
        scheduledDate.isBefore(today) -> CardDateSection.HISTORY
        scheduledDate.isAfter(today) -> CardDateSection.UPCOMING
        else -> CardDateSection.TODAY
    }
    val visibleLabel = when {
        scheduledDate == today -> "今日识物"
        scheduledDate == today.minusDays(1) -> "昨日识物"
        scheduledDate.year == today.year -> "${scheduledDate.monthValue}月${scheduledDate.dayOfMonth}日识物"
        else -> "${scheduledDate.year}年${scheduledDate.monthValue}月${scheduledDate.dayOfMonth}日识物"
    }
    return CardDatePresentation(visibleLabel, "卡片日期：$visibleLabel", section)
}
