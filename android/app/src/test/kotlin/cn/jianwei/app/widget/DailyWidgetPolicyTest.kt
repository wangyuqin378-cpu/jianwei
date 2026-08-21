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

    @Test
    fun `long factual headline gets two lines before supporting copy`() {
        val title = "自行车链传动用前后不同大小的齿盘改变转速与扭矩"

        assertThat(widgetKnowledgeTextLines(title, wide = false))
            .isEqualTo(WidgetKnowledgeTextLines(titleMaxLines = 3, bodyMaxLines = 1))
        assertThat(widgetKnowledgeTextLines(title, wide = true))
            .isEqualTo(WidgetKnowledgeTextLines(titleMaxLines = 2, bodyMaxLines = 1))
    }

    @Test
    fun `short headline keeps two lines for supporting copy`() {
        assertThat(widgetKnowledgeTextLines("扫帚为什么这样扎", wide = false))
            .isEqualTo(WidgetKnowledgeTextLines(titleMaxLines = 1, bodyMaxLines = 2))
        assertThat(widgetKnowledgeTextLines("  扫帚为什么这样扎  ", wide = true))
            .isEqualTo(WidgetKnowledgeTextLines(titleMaxLines = 1, bodyMaxLines = 2))
    }

    @Test
    fun `large text gives the factual headline priority over supporting copy`() {
        val title = "自行车链传动用前后不同大小的齿盘改变转速与扭矩"

        assertThat(widgetKnowledgeTextLines(title, wide = false, largeText = true))
            .isEqualTo(WidgetKnowledgeTextLines(titleMaxLines = 4, bodyMaxLines = 0))
        assertThat(widgetKnowledgeTextLines(title, wide = true, largeText = true))
            .isEqualTo(WidgetKnowledgeTextLines(titleMaxLines = 3, bodyMaxLines = 0))
    }

    @Test
    fun `large text still keeps supporting copy for short headlines`() {
        assertThat(widgetKnowledgeTextLines("扫帚为什么这样扎", wide = false, largeText = true))
            .isEqualTo(WidgetKnowledgeTextLines(titleMaxLines = 2, bodyMaxLines = 1))
    }
}
