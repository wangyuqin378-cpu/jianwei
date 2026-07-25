package cn.jianwei.app

import com.google.common.truth.Truth.assertThat
import org.junit.Test

class WidgetResizeDiscoveryCopyTest {
    @Test
    fun widgetPromptExposesWideModeAndValue() {
        assertThat(WIDGET_RESIZE_DISCOVERY_COPY).contains("4×2")
        assertThat(WIDGET_RESIZE_DISCOVERY_COPY).contains("来源")
        assertThat(WIDGET_RESIZE_DISCOVERY_COPY).contains("换一条")
    }
}
