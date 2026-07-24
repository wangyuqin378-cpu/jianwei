package cn.jianwei.app.widget

import com.google.common.truth.Truth.assertThat
import org.junit.Test

class DailyWidgetPolicyTest {
    @Test
    fun `cache is depleted only after the selected card schedule date`() {
        assertThat(isWidgetCacheDepleted("2026-07-23", null)).isFalse()
        assertThat(isWidgetCacheDepleted("2026-07-23", "2026-07-24")).isFalse()
        assertThat(isWidgetCacheDepleted("2026-07-23", "2026-07-23")).isFalse()
        assertThat(isWidgetCacheDepleted("2026-07-23", "2026-07-22")).isTrue()
    }

    @Test
    fun `exact object title is not repeated as a recognition label`() {
        assertThat(shouldShowWidgetRecognitionLabel("自行车", "自行车")).isFalse()
        assertThat(shouldShowWidgetRecognitionLabel(" 自行车 ", "自行车")).isFalse()
    }

    @Test
    fun `confidence and richer recognition labels remain visible`() {
        assertThat(shouldShowWidgetRecognitionLabel("自行车", "自行车 · 中等把握")).isTrue()
        assertThat(shouldShowWidgetRecognitionLabel("齿轮如何帮你省力", "自行车")).isTrue()
        assertThat(shouldShowWidgetRecognitionLabel("这可能是牙刷", "把握较低")).isTrue()
    }
}
