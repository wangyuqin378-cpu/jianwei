package cn.jianwei.domain.card

import com.google.common.truth.Truth.assertThat
import java.time.LocalDate
import org.junit.Test

class CardDatePolicyTest {
    private val today = LocalDate.parse("2026-07-24")

    @Test
    fun `current card is identified as today`() {
        val presentation = cardDatePresentation(today, today)

        assertThat(presentation.visibleLabel).isEqualTo("今日一知")
        assertThat(presentation.accessibilityLabel).isEqualTo("卡片日期：今日一知")
        assertThat(presentation.section).isEqualTo(CardDateSection.TODAY)
    }

    @Test
    fun `yesterday remains explicit across a year boundary`() {
        val newYear = LocalDate.parse("2027-01-01")

        val presentation = cardDatePresentation(LocalDate.parse("2026-12-31"), newYear)

        assertThat(presentation.visibleLabel).isEqualTo("昨日一知")
        assertThat(presentation.section).isEqualTo(CardDateSection.HISTORY)
    }

    @Test
    fun `older card in the current year shows month and day`() {
        val presentation = cardDatePresentation(LocalDate.parse("2026-06-02"), today)

        assertThat(presentation.visibleLabel).isEqualTo("6月2日一知")
        assertThat(presentation.section).isEqualTo(CardDateSection.HISTORY)
    }

    @Test
    fun `older card from another year includes the year`() {
        val presentation = cardDatePresentation(LocalDate.parse("2025-12-31"), today)

        assertThat(presentation.visibleLabel).isEqualTo("2025年12月31日一知")
        assertThat(presentation.section).isEqualTo(CardDateSection.HISTORY)
    }

    @Test
    fun `focused future cache shows its scheduled date instead of today`() {
        val presentation = cardDatePresentation(LocalDate.parse("2026-07-25"), today)

        assertThat(presentation.visibleLabel).isEqualTo("7月25日一知")
        assertThat(presentation.accessibilityLabel).isEqualTo("卡片日期：7月25日一知")
        assertThat(presentation.section).isEqualTo(CardDateSection.UPCOMING)
    }
}
