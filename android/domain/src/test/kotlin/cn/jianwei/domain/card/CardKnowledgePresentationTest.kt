package cn.jianwei.domain.card

import com.google.common.truth.Truth.assertThat
import org.junit.Test

class CardKnowledgePresentationTest {
    @Test
    fun `reviewed fact lead is not repeated below the headline`() {
        assertThat(
            cardBodyForDisplay(
                title = "拉链头并不是把两排齿硬压在一起",
                body = "拉链头并不是把两排齿硬压在一起，而是用内部的 Y 形通道让齿逐步啮合或分开。"
            )
        ).isEqualTo("而是用内部的 Y 形通道让齿逐步啮合或分开。")
    }

    @Test
    fun `uncertain and legacy titles keep the complete reviewed fact`() {
        val body = "牙刷刷毛尖端磨圆有助于减少刷牙时对牙龈的机械刺激。"
        assertThat(cardBodyForDisplay("这可能是牙刷", body)).isEqualTo(body)
        assertThat(cardBodyForDisplay("关于牙刷，你可能不知道", body)).isEqualTo(body)
    }

    @Test
    fun `a title that consumes almost the whole fact does not erase the body`() {
        assertThat(cardBodyForDisplay("杯把隔热", "杯把隔热。好。")).isEqualTo("杯把隔热。好。")
    }
}
