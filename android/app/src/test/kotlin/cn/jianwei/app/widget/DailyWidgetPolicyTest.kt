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
}
