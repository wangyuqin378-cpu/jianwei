package cn.jianwei.app.widget

import com.google.common.truth.Truth.assertThat
import org.junit.Test

class WidgetSwitchPolicyTest {
    @Test
    fun `wide stale card keeps cache guidance in the footer`() {
        val switch = WidgetSwitchAffordance("暂无更多卡片", canSwitch = false)

        assertThat(wideWidgetFooter(cacheDepleted = true, switch)).isEqualTo(
            WidgetSwitchAffordance("缓存用完 · 点按更新", canSwitch = false)
        )
        assertThat(wideWidgetFooter(cacheDepleted = false, switch)).isEqualTo(
            WidgetSwitchAffordance("查看照片与来源 →", canSwitch = false)
        )
    }

    @Test
    fun `single card never offers a dead switch action`() {
        val state = widgetSwitchAffordance(
            switchCount = 0,
            orderedCardIds = listOf("today"),
            currentCardId = "today"
        )

        assertThat(state.canSwitch).isFalse()
        assertThat(state.label).isEqualTo("暂无更多卡片")
    }

    @Test
    fun `remaining label reflects both quota and unseen cards`() {
        val cards = listOf("today", "tomorrow", "later")
        val initial = widgetSwitchAffordance(0, cards, "today")
        val once = widgetSwitchAffordance(1, cards, "tomorrow")
        val exhausted = widgetSwitchAffordance(2, cards, "later")

        assertThat(initial.label).isEqualTo("换一条 · 剩 2 次")
        assertThat(initial.canSwitch).isTrue()
        assertThat(once.label).isEqualTo("换一条 · 剩 1 次")
        assertThat(once.canSwitch).isTrue()
        assertThat(exhausted.label).isEqualTo("今天已换 2 次")
        assertThat(exhausted.canSwitch).isFalse()

        val onlyOneUnseen = widgetSwitchAffordance(0, listOf("today", "tomorrow"), "today")
        assertThat(onlyOneUnseen.label).isEqualTo("换一条 · 剩 1 次")
    }

    @Test
    fun `end of list and invalid current card fail closed`() {
        val cards = listOf("today", "tomorrow")
        assertThat(widgetSwitchAffordance(1, cards, "tomorrow").canSwitch).isFalse()
        assertThat(widgetSwitchAffordance(1, cards, "tomorrow").label)
            .isEqualTo("暂无更多卡片")

        assertThat(widgetSwitchAffordance(0, cards, "missing").canSwitch).isFalse()
        assertThat(widgetSwitchAffordance(99, cards, "today").label)
            .isEqualTo("今天已换 2 次")
    }
}
