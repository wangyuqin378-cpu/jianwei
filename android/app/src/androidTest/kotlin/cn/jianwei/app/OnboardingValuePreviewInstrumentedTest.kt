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

            click(awaitNodeWithScroll(instrumentation, "继续"))
            assertThat(awaitNode(instrumentation, "2 / 3")).isNotNull()
            assertThat(topOf(awaitNode(instrumentation, "见微"))).isLessThan(TOP_VISIBLE_BOUNDARY_PX)

            click(awaitNodeWithScroll(instrumentation, "继续"))
            assertThat(awaitNode(instrumentation, "3 / 3")).isNotNull()
            assertThat(topOf(awaitNode(instrumentation, "见微"))).isLessThan(TOP_VISIBLE_BOUNDARY_PX)
            assertThat(awaitDescriptionPrefixWithScroll(
                instrumentation,
                "提前准备（推荐）。"
            ).stateDescription?.toString()).isEqualTo("已选择")
            assertThat(reachableNode(instrumentation, "开启自动发现", true)).isNotNull()
            assertThat(reachableNode(instrumentation, "仅选择照片", true)).isNotNull()

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

    @Test
    fun onboardingKeepsChoicesAcrossRecreationAndPersistsModeForPickerOnly() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val onboarding = context.getSharedPreferences("onboarding", Context.MODE_PRIVATE)
        val scheduler = context.getSharedPreferences("analysis_scheduler", Context.MODE_PRIVATE)
        val wasOnboarded = onboarding.getBoolean("completed", false)
        val previousMode = scheduler.getString(AUTOMATIC_CARD_MODE_KEY, null)
        var scenario: ActivityScenario<MainActivity>? = null
        try {
            onboarding.edit().putBoolean("completed", false).commit()
            scheduler.edit().remove(AUTOMATIC_CARD_MODE_KEY).commit()
            scenario = ActivityScenario.launch(MainActivity::class.java)

            click(awaitNodeWithScroll(instrumentation, "继续"))
            assertThat(awaitNode(instrumentation, "2 / 3")).isNotNull()
            click(awaitNodeWithScroll(instrumentation, "继续"))
            assertThat(awaitNode(instrumentation, "3 / 3")).isNotNull()
            click(awaitNodeWithScroll(instrumentation, "生活设计"))
            awaitChoiceState(instrumentation, "生活设计", false)
            click(awaitNodeWithScroll(instrumentation, "实用技巧"))
            awaitChoiceState(instrumentation, "实用技巧", true)
            click(awaitDescriptionPrefixWithScroll(instrumentation, "每天一张。"))

            requireNotNull(scenario).recreate()
            assertThat(awaitNode(instrumentation, "3 / 3")).isNotNull()
            awaitChoiceState(instrumentation, "生活设计", false)
            awaitChoiceState(instrumentation, "实用技巧", true)
            assertThat(awaitDescriptionPrefixWithScroll(
                instrumentation,
                "每天一张。"
            ).stateDescription?.toString()).isEqualTo("已选择")

            click(awaitClickableNodeWithScroll(instrumentation, "仅选择照片"))
            awaitPreference(onboarding, "completed", true)
            assertThat(scheduler.getString(AUTOMATIC_CARD_MODE_KEY, null)).isEqualTo("DAILY_ONE")
            instrumentation.uiAutomation.executeShellCommand("input keyevent KEYCODE_BACK").close()
        } finally {
            scenario?.close()
            onboarding.edit().putBoolean("completed", wasOnboarded).commit()
            scheduler.edit().apply {
                if (previousMode == null) remove(AUTOMATIC_CARD_MODE_KEY)
                else putString(AUTOMATIC_CARD_MODE_KEY, previousMode)
            }.commit()
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

    private fun awaitClickableNodeWithScroll(
        instrumentation: android.app.Instrumentation,
        text: String,
        timeoutMillis: Long = 10_000
    ): AccessibilityNodeInfo {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        while (SystemClock.uptimeMillis() < deadline) {
            findNode(instrumentation.uiAutomation.rootInActiveWindow) { node ->
                node.text?.toString() == text &&
                    generateSequence(node) { current -> current.parent }.any { it.isClickable }
            }?.let { return it }
            swipeForward(instrumentation)
        }
        error("Timed out scrolling to clickable accessibility node: $text")
    }

    private fun awaitDescriptionPrefixWithScroll(
        instrumentation: android.app.Instrumentation,
        prefix: String,
        timeoutMillis: Long = 10_000
    ): AccessibilityNodeInfo {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        while (SystemClock.uptimeMillis() < deadline) {
            findNode(instrumentation.uiAutomation.rootInActiveWindow) { node ->
                node.contentDescription?.toString()?.startsWith(prefix) == true
            }?.let { return it }
            swipeForward(instrumentation)
        }
        error("Timed out scrolling to content description: $prefix")
    }

    private fun swipeForward(instrumentation: android.app.Instrumentation) {
        val metrics = instrumentation.targetContext.resources.displayMetrics
        val centerX = metrics.widthPixels / 2
        instrumentation.uiAutomation.executeShellCommand(
            "input swipe $centerX ${(metrics.heightPixels * 0.78f).toInt()} " +
                "$centerX ${(metrics.heightPixels * 0.32f).toInt()} 250"
        ).close()
        SystemClock.sleep(250)
    }

    private fun isCheckedChoice(node: AccessibilityNodeInfo): Boolean =
        generateSequence(node) { current -> current.parent }
            .firstOrNull { current -> current.isCheckable }
            ?.isChecked
            ?: error("Choice is missing checkable semantics: ${node.text}")

    private fun awaitChoiceState(
        instrumentation: android.app.Instrumentation,
        text: String,
        expected: Boolean,
        timeoutMillis: Long = 5_000
    ) {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        while (SystemClock.uptimeMillis() < deadline) {
            val node = findNode(instrumentation.uiAutomation.rootInActiveWindow) { candidate ->
                candidate.text?.toString() == text
            }
            if (node != null && isCheckedChoice(node) == expected) return
            if (node == null) swipeForward(instrumentation) else SystemClock.sleep(50)
        }
        error("Timed out waiting for choice state: $text=$expected")
    }

    private fun awaitPreference(
        preferences: android.content.SharedPreferences,
        key: String,
        expected: Boolean,
        timeoutMillis: Long = 5_000
    ) {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        while (SystemClock.uptimeMillis() < deadline) {
            if (preferences.getBoolean(key, !expected) == expected) return
            SystemClock.sleep(50)
        }
        error("Timed out waiting for preference: $key=$expected")
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
        const val AUTOMATIC_CARD_MODE_KEY = "automatic_card_mode"
    }
}
