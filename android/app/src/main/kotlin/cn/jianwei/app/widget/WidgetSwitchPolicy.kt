package cn.jianwei.app.widget

import cn.jianwei.data.widget.MAX_DAILY_WIDGET_SWITCHES

internal data class WidgetSwitchAffordance(
    val label: String,
    val canSwitch: Boolean
)

internal fun wideWidgetFooter(
    cacheDepleted: Boolean,
    switchAffordance: WidgetSwitchAffordance
): WidgetSwitchAffordance = if (cacheDepleted) {
    WidgetSwitchAffordance("缓存用完 · 点按更新", canSwitch = false)
} else if (!switchAffordance.canSwitch && switchAffordance.label == "暂无更多卡片") {
    WidgetSwitchAffordance("查看照片与来源 →", canSwitch = false)
} else {
    switchAffordance
}

internal fun widgetSwitchAffordance(
    switchCount: Int,
    orderedCardIds: List<String>,
    currentCardId: String?
): WidgetSwitchAffordance {
    val eligible = orderedCardIds.distinct()
    val remainingQuota = (MAX_DAILY_WIDGET_SWITCHES - switchCount)
        .coerceIn(0, MAX_DAILY_WIDGET_SWITCHES)
    if (remainingQuota == 0) {
        return WidgetSwitchAffordance("今天已换 2 次", canSwitch = false)
    }

    val currentIndex = eligible.indexOf(currentCardId)
    val remainingCards = when {
        currentIndex < 0 -> 0
        else -> (eligible.lastIndex - currentIndex).coerceAtLeast(0)
    }
    val remaining = minOf(remainingQuota, remainingCards)

    return if (remaining == 0) {
        WidgetSwitchAffordance("暂无更多卡片", canSwitch = false)
    } else if (switchCount >= MAX_DAILY_WIDGET_SWITCHES) {
        WidgetSwitchAffordance("今天已换 2 次", canSwitch = false)
    } else {
        WidgetSwitchAffordance("换一条 · 剩 $remaining 次", canSwitch = true)
    }
}
