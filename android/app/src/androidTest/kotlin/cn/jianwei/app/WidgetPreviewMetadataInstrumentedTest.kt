package cn.jianwei.app

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.view.LayoutInflater
import android.widget.ImageView
import android.widget.TextView
import androidx.test.platform.app.InstrumentationRegistry
import cn.jianwei.app.widget.DailyWidgetReceiver
import com.google.common.truth.Truth.assertThat
import org.junit.Test

class WidgetPreviewMetadataInstrumentedTest {
    @Test
    fun pickerUsesAnExplicitSampleWhileRuntimeKeepsTheHonestLoadingLayout() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val provider = ComponentName(context, DailyWidgetReceiver::class.java)
        val providerInfo = AppWidgetManager.getInstance(context)
            .installedProviders
            .first { it.provider == provider }

        assertThat(providerInfo.initialLayout).isEqualTo(R.layout.widget_loading)
        assertThat(providerInfo.previewLayout).isEqualTo(R.layout.widget_preview)

        val preview = LayoutInflater.from(context).inflate(R.layout.widget_preview, null)
        assertThat(preview.findViewById<TextView>(R.id.widget_preview_brand).text.toString())
            .isEqualTo("见微 · 示例")
        assertThat(preview.findViewById<TextView>(R.id.widget_preview_title).text.toString())
            .isEqualTo("扫帚为什么做成扇形？")
        assertThat(preview.findViewById<TextView>(R.id.widget_preview_body).text.toString())
            .isEqualTo("扇形刷毛更容易贴近墙角。")
        assertThat(preview.findViewById<ImageView>(R.id.widget_preview_image).drawable)
            .isNotNull()
    }
}
