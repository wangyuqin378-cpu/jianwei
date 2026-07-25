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
                "扫帚为什么做成扇形？",
                requiresScroll
            )).isNotNull()
            assertThat(reachableNode(
                instrumentation,
                ONBOARDING_EXAMPLE_BODY,
                true
            )).isNotNull()
            val source = reachableNode(
                instrumentation,
                "查看示例来源 · Google Patents",
                true
            )
            assertThat(
                generateSequence(source) { current -> current.parent }
                    .any { current -> current.isClickable }
            ).isTrue()

            val output = File(context.getExternalFilesDir(null), SCREENSHOT_NAME)
            output.outputStream().use { stream ->
                assertThat(
                    instrumentation.uiAutomation.takeScreenshot()
                        .compress(Bitmap.CompressFormat.PNG, 100, stream)
                ).isTrue()
            }
            assertThat(output.length()).isGreaterThan(0L)

            clickTextWithScroll(instrumentation, "查看示例来源 · Google Patents")
            awaitExternalWindow(instrumentation, context.packageName)
            instrumentation.uiAutomation.executeShellCommand("input keyevent KEYCODE_BACK").close()
            awaitPackage(instrumentation, context.packageName)

            clickTextAndAwaitText(instrumentation, "继续", "2 / 3")
            assertThat(topOf(awaitNode(instrumentation, "见微"))).isLessThan(TOP_VISIBLE_BOUNDARY_PX)

            clickTextAndAwaitText(instrumentation, "继续", "3 / 3")
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

            clickTextAndAwaitText(instrumentation, "继续", "2 / 3")
            clickTextAndAwaitText(instrumentation, "继续", "3 / 3")
            clickTextWithScroll(instrumentation, "生活设计")
            awaitChoiceState(instrumentation, "生活设计", false)
            clickTextWithScroll(instrumentation, "实用技巧")
            awaitChoiceState(instrumentation, "实用技巧", true)
            clickDescriptionPrefixWithScroll(instrumentation, "每天一张。")

            requireNotNull(scenario).recreate()
            assertThat(awaitNode(instrumentation, "3 / 3")).isNotNull()
            awaitChoiceState(instrumentation, "生活设计", false)
            awaitChoiceState(instrumentation, "实用技巧", true)
            assertThat(awaitDescriptionPrefixWithScroll(
                instrumentation,
                "每天一张。"
            ).stateDescription?.toString()).isEqualTo("已选择")

            clickTextWithScroll(instrumentation, "仅选择照片")
            awaitPreference(onboarding, "completed", true)
            assertThat(scheduler.getString(AUTOMATIC_CARD_MODE_KEY, null)).isEqualTo("DAILY_ONE")
            awaitExternalWindow(instrumentation, context.packageName)
            instrumentation.uiAutomation.executeShellCommand("input keyevent KEYCODE_BACK").close()
            awaitPackage(instrumentation, context.packageName)
        } finally {
            scenario?.close()
            onboarding.edit().putBoolean("completed", wasOnboarded).commit()
            scheduler.edit().apply {
                if (previousMode == null) remove(AUTOMATIC_CARD_MODE_KEY)
                else putString(AUTOMATIC_CARD_MODE_KEY, previousMode)
            }.commit()
        }
    }

    private fun clickTextWithScroll(
        instrumentation: android.app.Instrumentation,
        text: String
    ) = clickMatchingNodeWithScroll(instrumentation, text) { node ->
        node.text?.toString() == text
    }

    private fun clickTextAndAwaitText(
        instrumentation: android.app.Instrumentation,
        clickedText: String,
        expectedText: String,
        timeoutMillis: Long = 12_000
    ) {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        while (SystemClock.uptimeMillis() < deadline) {
            val remaining = deadline - SystemClock.uptimeMillis()
            clickMatchingNodeWithScroll(
                instrumentation = instrumentation,
                label = clickedText,
                timeoutMillis = minOf(remaining, 3_000)
            ) { node -> node.text?.toString() == clickedText }
            if (awaitMatchingNode(instrumentation, minOf(remaining, 1_000)) { node ->
                    node.text?.toString() == expectedText
                } != null
            ) return
        }
        error("Timed out after clicking $clickedText while waiting for $expectedText")
    }

    private fun clickDescriptionPrefixWithScroll(
        instrumentation: android.app.Instrumentation,
        prefix: String
    ) = clickMatchingNodeWithScroll(instrumentation, prefix) { node ->
        node.contentDescription?.toString()?.startsWith(prefix) == true
    }

    private fun clickMatchingNodeWithScroll(
        instrumentation: android.app.Instrumentation,
        label: String,
        timeoutMillis: Long = 10_000,
        predicate: (AccessibilityNodeInfo) -> Boolean
    ) {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        var lastOffscreenBounds: Rect? = null
        while (SystemClock.uptimeMillis() < deadline) {
            val node = findNode(instrumentation.uiAutomation.rootInActiveWindow) { candidate ->
                predicate(candidate) &&
                    generateSequence(candidate) { current -> current.parent }
                        .any { current -> current.isClickable }
            }
            val clickable = node?.let {
                generateSequence(it) { current -> current.parent }
                    .firstOrNull { current -> current.isClickable }
            }
            if (clickable != null) {
                if (!clickable.isActuallyOnScreen(instrumentation)) {
                    val bounds = Rect().also(clickable::getBoundsInScreen)
                    val stalled = bounds == lastOffscreenBounds
                    val requested = clickable.performAction(
                            AccessibilityNodeInfo.AccessibilityAction.ACTION_SHOW_ON_SCREEN.id
                        )
                    if (!requested || stalled) swipeTowardNode(instrumentation, clickable)
                    lastOffscreenBounds = Rect(bounds)
                    SystemClock.sleep(150)
                    continue
                }
                lastOffscreenBounds = null
                instrumentation.waitForIdleSync()
                val settledNode = findNode(
                    instrumentation.uiAutomation.rootInActiveWindow
                ) { candidate ->
                    predicate(candidate) &&
                        generateSequence(candidate) { current -> current.parent }
                            .any { current -> current.isClickable }
                }
                val settledClickable = settledNode?.let {
                    generateSequence(it) { current -> current.parent }
                        .firstOrNull { current -> current.isClickable }
                }
                if (
                    settledClickable?.isActuallyOnScreen(instrumentation) == true &&
                    settledClickable.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                ) return
                SystemClock.sleep(100)
            } else {
                swipeForward(instrumentation)
            }
        }
        error(
            "Timed out clicking accessibility node: $label; visible=" +
                visibleText(instrumentation.uiAutomation.rootInActiveWindow) +
                "; matches=" + describeMatchingNodes(
                    instrumentation.uiAutomation.rootInActiveWindow,
                    predicate
                )
        )
    }

    private fun AccessibilityNodeInfo.isActuallyOnScreen(
        instrumentation: android.app.Instrumentation
    ): Boolean {
        if (!isVisibleToUser) return false
        val bounds = Rect()
        getBoundsInScreen(bounds)
        val windowBounds = Rect().also { visibleBounds ->
            instrumentation.uiAutomation.rootInActiveWindow?.getBoundsInScreen(visibleBounds)
        }
        return bounds.width() > 0 &&
            bounds.height() > 0 &&
            windowBounds.contains(bounds.centerX(), bounds.centerY())
    }

    private fun swipeTowardNode(
        instrumentation: android.app.Instrumentation,
        node: AccessibilityNodeInfo
    ) {
        val bounds = Rect()
        node.getBoundsInScreen(bounds)
        val metrics = instrumentation.targetContext.resources.displayMetrics
        val centerX = metrics.widthPixels / 2
        val targetIsAbove = bounds.bottom <= 0
        val startY = if (targetIsAbove) 0.32f else 0.78f
        val endY = if (targetIsAbove) 0.78f else 0.32f
        instrumentation.uiAutomation.executeShellCommand(
            "input swipe $centerX ${(metrics.heightPixels * startY).toInt()} " +
                "$centerX ${(metrics.heightPixels * endY).toInt()} 250"
        ).close()
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

    private fun awaitExternalWindow(
        instrumentation: android.app.Instrumentation,
        targetPackage: String,
        timeoutMillis: Long = 5_000
    ) {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        while (SystemClock.uptimeMillis() < deadline) {
            val packageName = instrumentation.uiAutomation.rootInActiveWindow
                ?.packageName
                ?.toString()
            if (packageName != null && packageName != targetPackage) return
            SystemClock.sleep(100)
        }
        error("Timed out waiting for the system photo picker")
    }

    private fun awaitPackage(
        instrumentation: android.app.Instrumentation,
        expectedPackage: String,
        timeoutMillis: Long = 5_000
    ) {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        while (SystemClock.uptimeMillis() < deadline) {
            val packageName = instrumentation.uiAutomation.rootInActiveWindow
                ?.packageName
                ?.toString()
            if (packageName == expectedPackage) return
            SystemClock.sleep(100)
        }
        error("Timed out returning from the system photo picker")
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

    private fun visibleText(root: AccessibilityNodeInfo?): List<String> = buildList {
        fun collect(node: AccessibilityNodeInfo?) {
            if (node == null || size >= 60) return
            node.text?.toString()?.takeIf(String::isNotBlank)?.let(::add)
            node.contentDescription
                ?.toString()
                ?.takeIf(String::isNotBlank)
                ?.let(::add)
            for (index in 0 until node.childCount) collect(node.getChild(index))
        }
        collect(root)
    }

    private fun describeMatchingNodes(
        root: AccessibilityNodeInfo?,
        predicate: (AccessibilityNodeInfo) -> Boolean
    ): List<String> = buildList {
        fun collect(node: AccessibilityNodeInfo?) {
            if (node == null || size >= 12) return
            if (predicate(node)) {
                val bounds = Rect().also(node::getBoundsInScreen)
                val clickable = generateSequence(node) { current -> current.parent }
                    .firstOrNull { current -> current.isClickable }
                val clickableBounds = clickable?.let { Rect().also(it::getBoundsInScreen) }
                add(
                    "node=$bounds visible=${node.isVisibleToUser} clickable=" +
                        "${clickable != null} clickableBounds=$clickableBounds " +
                        "clickableVisible=${clickable?.isVisibleToUser}"
                )
            }
            for (index in 0 until node.childCount) collect(node.getChild(index))
        }
        collect(root)
    }

    private companion object {
        const val TOP_VISIBLE_BOUNDARY_PX = 350
        const val SCREENSHOT_NAME = "onboarding-value-preview.png"
        const val ENTRY_SCREENSHOT_NAME = "onboarding-entry-choice.png"
        const val AUTOMATIC_CARD_MODE_KEY = "automatic_card_mode"
        const val ONBOARDING_EXAMPLE_BODY =
            "现代扫帚常把刷毛设计成略带角度的扇形，让边缘更容易贴近墙角和家具边缘。"
    }
}
