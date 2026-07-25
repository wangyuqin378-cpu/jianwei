package cn.jianwei.app

import android.content.Context
import android.graphics.Bitmap
import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import cn.jianwei.domain.model.PhotoAccess
import com.google.common.truth.Truth.assertThat
import java.io.File
import org.junit.Test

class PhotoAccessPresentationInstrumentedTest {
    @Test
    fun currentSystemPhotoAccessHasATruthfulReversiblePresentation() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val preferences = context.getSharedPreferences("onboarding", Context.MODE_PRIVATE)
        val wasOnboarded = preferences.getBoolean("completed", false)
        val expectedAccess = InstrumentationRegistry.getArguments()
            .getString(EXPECTED_ACCESS_ARGUMENT)
            ?.let(PhotoAccess::valueOf)
        val actualAccess = currentPhotoAccess(context)
        if (expectedAccess != null) assertThat(actualAccess).isEqualTo(expectedAccess)

        var scenario: ActivityScenario<MainActivity>? = null
        try {
            preferences.edit().putBoolean("completed", true).commit()
            scenario = ActivityScenario.launch(MainActivity::class.java)
            when (actualAccess) {
                PhotoAccess.PICKER_ONLY -> {
                    assertThat(awaitNodeWithScroll(instrumentation, "从一件日常物品开始")).isNotNull()
                    listOf("杯子与餐具", "清洁工具", "数码小物").forEach { suggestion ->
                        assertThat(awaitNodeWithScroll(instrumentation, suggestion)).isNotNull()
                    }
                    assertThat(awaitNodeWithScroll(instrumentation, "选择一张照片")).isNotNull()
                    val output = File(context.getExternalFilesDir(null), PICKER_EMPTY_SCREENSHOT_NAME)
                    output.outputStream().use { stream ->
                        assertThat(
                            instrumentation.uiAutomation.takeScreenshot()
                                .compress(Bitmap.CompressFormat.PNG, 100, stream)
                        ).isTrue()
                    }
                    assertThat(output.length()).isGreaterThan(0L)
                    clickNode(instrumentation, "管理隐私与数据")
                    assertThat(awaitNodeWithScroll(instrumentation, "开启自动发现")).isNotNull()
                }
                PhotoAccess.PARTIAL -> {
                    assertThat(awaitNodeWithScroll(
                        instrumentation,
                        "自动发现已开启 · 仅限你选中的照片"
                    )).isNotNull()
                    clickNode(instrumentation, "管理隐私与数据")
                    assertThat(awaitNodeWithScroll(instrumentation, "调整可访问照片")).isNotNull()
                }
                PhotoAccess.FULL -> {
                    assertThat(awaitNodeWithScroll(
                        instrumentation,
                        "自动发现已开启 · 全部授权照片"
                    )).isNotNull()
                    assertThat(findTextNode(
                        instrumentation.uiAutomation.rootInActiveWindow,
                        "开启自动发现"
                    )).isNull()
                    assertThat(findTextNode(
                        instrumentation.uiAutomation.rootInActiveWindow,
                        "调整可访问照片"
                    )).isNull()
                }
            }
        } finally {
            scenario?.close()
            preferences.edit().putBoolean("completed", wasOnboarded).commit()
        }
    }

    private fun clickNode(instrumentation: android.app.Instrumentation, text: String) {
        val node = awaitNodeWithScroll(instrumentation, text)
        val clickable = generateSequence(node) { current -> current.parent }
            .firstOrNull { current -> current.isClickable }
        assertThat(clickable).isNotNull()
        assertThat(clickable!!.performAction(AccessibilityNodeInfo.ACTION_CLICK)).isTrue()
    }

    private fun awaitNodeWithScroll(
        instrumentation: android.app.Instrumentation,
        text: String,
        timeoutMillis: Long = 10_000
    ): AccessibilityNodeInfo {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        while (SystemClock.uptimeMillis() < deadline) {
            val root = instrumentation.uiAutomation.rootInActiveWindow
            findTextNode(root, text)?.let { return it }
            val metrics = instrumentation.targetContext.resources.displayMetrics
            val centerX = metrics.widthPixels / 2
            instrumentation.uiAutomation.executeShellCommand(
                "input swipe $centerX ${(metrics.heightPixels * 0.78f).toInt()} " +
                    "$centerX ${(metrics.heightPixels * 0.32f).toInt()} 250"
            ).close()
            SystemClock.sleep(250)
        }
        error("Timed out waiting for accessibility node: $text")
    }

    private fun findTextNode(root: AccessibilityNodeInfo?, text: String): AccessibilityNodeInfo? {
        if (root == null) return null
        if (root.text?.toString() == text) return root
        for (index in 0 until root.childCount) {
            findTextNode(root.getChild(index), text)?.let { return it }
        }
        return null
    }

    private companion object {
        const val EXPECTED_ACCESS_ARGUMENT = "expectedAccess"
        const val PICKER_EMPTY_SCREENSHOT_NAME = "picker-only-empty-state.png"
    }
}
