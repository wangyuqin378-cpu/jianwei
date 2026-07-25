package cn.jianwei.app

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Rect
import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import com.google.common.truth.Truth.assertThat
import java.io.File
import org.junit.Test

class OnboardingValuePreviewInstrumentedTest {
    @Test
    fun onboardingShowsARealExampleAndResetsEveryPageToTheTop() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val preferences = context.getSharedPreferences("onboarding", Context.MODE_PRIVATE)
        val wasOnboarded = preferences.getBoolean("completed", false)
        val requiresScroll = context.resources.configuration.screenWidthDp < 360 ||
            context.resources.configuration.fontScale >= 1.5f
        var scenario: ActivityScenario<MainActivity>? = null
        try {
            preferences.edit().putBoolean("completed", false).commit()
            scenario = ActivityScenario.launch(MainActivity::class.java)

            assertThat(awaitNode(instrumentation, "示例照片")).isNotNull()
            assertThat(awaitNode(instrumentation, "识别到 · 扫帚")).isNotNull()
            assertThat(awaitContentDescription(
                instrumentation,
                "示例照片：靠在墙边的一把扫帚"
            )).isNotNull()
            assertThat(reachableNode(
                instrumentation,
                "扫帚为什么用一束细长刷毛？",
                requiresScroll
            )).isNotNull()

            val output = File(context.getExternalFilesDir(null), SCREENSHOT_NAME)
            output.outputStream().use { stream ->
                assertThat(
                    instrumentation.uiAutomation.takeScreenshot()
                        .compress(Bitmap.CompressFormat.PNG, 100, stream)
                ).isTrue()
            }
            assertThat(output.length()).isGreaterThan(0L)

            click(reachableNode(instrumentation, "继续", requiresScroll))
            assertThat(awaitNode(instrumentation, "2 / 3")).isNotNull()
            assertThat(topOf(awaitNode(instrumentation, "见微"))).isLessThan(TOP_VISIBLE_BOUNDARY_PX)

            click(reachableNode(instrumentation, "继续", requiresScroll))
            assertThat(awaitNode(instrumentation, "3 / 3")).isNotNull()
            assertThat(topOf(awaitNode(instrumentation, "见微"))).isLessThan(TOP_VISIBLE_BOUNDARY_PX)
            if (requiresScroll) {
                assertThat(reachableNode(instrumentation, "自动发现（推荐）", true)).isNotNull()
                assertThat(reachableNode(instrumentation, "仅选择照片", true)).isNotNull()
            } else {
                assertThat(awaitNode(instrumentation, "自动发现（推荐）")).isNotNull()
                assertThat(awaitNode(instrumentation, "仅选择照片")).isNotNull()
            }

            val entryOutput = File(context.getExternalFilesDir(null), ENTRY_SCREENSHOT_NAME)
            entryOutput.outputStream().use { stream ->
                assertThat(
                    instrumentation.uiAutomation.takeScreenshot()
                        .compress(Bitmap.CompressFormat.PNG, 100, stream)
                ).isTrue()
            }
            assertThat(entryOutput.length()).isGreaterThan(0L)
        } finally {
            scenario?.close()
            preferences.edit().putBoolean("completed", wasOnboarded).commit()
        }
    }

    private fun click(node: AccessibilityNodeInfo) {
        val clickable = generateSequence(node) { current -> current.parent }
            .firstOrNull { current -> current.isClickable }
        assertThat(clickable).isNotNull()
        assertThat(clickable!!.performAction(AccessibilityNodeInfo.ACTION_CLICK)).isTrue()
    }

    private fun topOf(node: AccessibilityNodeInfo): Int = Rect().also(node::getBoundsInScreen).top

    private fun awaitNode(
        instrumentation: android.app.Instrumentation,
        text: String,
        timeoutMillis: Long = 10_000
    ): AccessibilityNodeInfo = awaitMatchingNode(instrumentation, timeoutMillis) { node ->
        node.text?.toString() == text
    } ?: error("Timed out waiting for accessibility node: $text")

    private fun awaitContentDescription(
        instrumentation: android.app.Instrumentation,
        description: String,
        timeoutMillis: Long = 10_000
    ): AccessibilityNodeInfo = awaitMatchingNode(instrumentation, timeoutMillis) { node ->
        node.contentDescription?.toString() == description
    } ?: error("Timed out waiting for content description: $description")

    private fun reachableNode(
        instrumentation: android.app.Instrumentation,
        text: String,
        requiresScroll: Boolean
    ): AccessibilityNodeInfo = if (requiresScroll) {
        awaitNodeWithScroll(instrumentation, text)
    } else {
        awaitNode(instrumentation, text)
    }

    private fun awaitNodeWithScroll(
        instrumentation: android.app.Instrumentation,
        text: String,
        timeoutMillis: Long = 10_000
    ): AccessibilityNodeInfo {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        while (SystemClock.uptimeMillis() < deadline) {
            findNode(instrumentation.uiAutomation.rootInActiveWindow) { node ->
                node.text?.toString() == text
            }?.let { return it }
            val metrics = instrumentation.targetContext.resources.displayMetrics
            val centerX = metrics.widthPixels / 2
            instrumentation.uiAutomation.executeShellCommand(
                "input swipe $centerX ${(metrics.heightPixels * 0.78f).toInt()} " +
                    "$centerX ${(metrics.heightPixels * 0.32f).toInt()} 250"
            ).close()
            SystemClock.sleep(250)
        }
        error("Timed out scrolling to accessibility node: $text")
    }

    private fun awaitMatchingNode(
        instrumentation: android.app.Instrumentation,
        timeoutMillis: Long,
        predicate: (AccessibilityNodeInfo) -> Boolean
    ): AccessibilityNodeInfo? {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        while (SystemClock.uptimeMillis() < deadline) {
            findNode(instrumentation.uiAutomation.rootInActiveWindow, predicate)?.let { return it }
            SystemClock.sleep(100)
        }
        return null
    }

    private fun findNode(
        root: AccessibilityNodeInfo?,
        predicate: (AccessibilityNodeInfo) -> Boolean
    ): AccessibilityNodeInfo? {
        if (root == null) return null
        if (predicate(root)) return root
        for (index in 0 until root.childCount) {
            findNode(root.getChild(index), predicate)?.let { return it }
        }
        return null
    }

    private companion object {
        const val TOP_VISIBLE_BOUNDARY_PX = 350
        const val SCREENSHOT_NAME = "onboarding-value-preview.png"
        const val ENTRY_SCREENSHOT_NAME = "onboarding-entry-choice.png"
    }
}
