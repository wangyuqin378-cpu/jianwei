package cn.jianwei.domain.card

import com.google.common.truth.Truth.assertThat
import org.junit.Test

class CardRecognitionPolicyTest {
    @Test
    fun `canonical uncertain title does not repeat the object name`() {
        val presentation = cardRecognitionPresentation("这可能是牙刷", "牙刷", 0.68)

        assertThat(presentation.visibleLabel).isEqualTo("识别把握较低")
        assertThat(presentation.accessibilityLabel)
            .isEqualTo("识别对象可能是 牙刷，识别置信度 68%")
    }

    @Test
    fun `low confidence remains explicit when title does not carry identity`() {
        val presentation = cardRecognitionPresentation("刷毛为什么这样排列", "牙刷", 0.71)

        assertThat(presentation.visibleLabel).isEqualTo("可能是 牙刷 · 把握较低")
        assertThat(presentation.accessibilityLabel)
            .isEqualTo("识别对象可能是 牙刷，识别置信度 71%")
    }

    @Test
    fun `threshold confidence uses a medium qualitative label`() {
        val presentation = cardRecognitionPresentation(
            "刷毛为什么这样排列",
            "牙刷",
            UNCERTAIN_OBJECT_CONFIDENCE
        )

        assertThat(presentation.visibleLabel).isEqualTo("识别对象：牙刷 · 把握中等")
        assertThat(presentation.accessibilityLabel)
            .isEqualTo("识别对象是 牙刷，识别置信度 72%")
    }

    @Test
    fun `high confidence uses a high qualitative label`() {
        val presentation = cardRecognitionPresentation(
            "刷毛为什么这样排列",
            "牙刷",
            HIGH_OBJECT_CONFIDENCE
        )

        assertThat(presentation.visibleLabel).isEqualTo("识别对象：牙刷 · 把握较高")
    }

    @Test
    fun `blank legacy value fails closed without hiding recognition status`() {
        val presentation = cardRecognitionPresentation("旧卡片", " ", 0.9)

        assertThat(presentation.visibleLabel).isEqualTo("识别对象：未知物件")
        assertThat(presentation.accessibilityLabel)
            .isEqualTo("识别对象未知，识别置信度 90%")
    }

    @Test
    fun `invalid confidence fails closed as low confidence`() {
        val presentation = cardRecognitionPresentation("旧卡片", "牙刷", Double.NaN)

        assertThat(presentation.visibleLabel).isEqualTo("可能是 牙刷 · 把握较低")
        assertThat(presentation.accessibilityLabel)
            .isEqualTo("识别对象可能是 牙刷，识别置信度 0%")
    }
}
