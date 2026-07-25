package cn.jianwei.app

import android.content.Context
import android.graphics.Bitmap
import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import cn.jianwei.data.local.buildJianweiDatabase
import com.google.common.truth.Truth.assertThat
import java.io.File
import kotlinx.coroutines.runBlocking
import org.junit.Test

class SavedTabNavigationInstrumentedTest {
    @Test
    fun emptySavedTabExplainsTheCurrentActionAndReturnsToDailyCards() = runBlocking {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val preferences = context.getSharedPreferences("onboarding", Context.MODE_PRIVATE)
        val wasOnboarded = preferences.getBoolean("completed", false)
        val database = buildJianweiDatabase(context)
        var scenario: ActivityScenario<MainActivity>? = null
        try {
            database.cards().clear()
            preferences.edit().putBoolean("completed", true).commit()
            scenario = ActivityScenario.launch(MainActivity::class.java)

            click(awaitNode(instrumentation, "收藏 0"))
            assertThat(awaitNode(instrumentation, EMPTY_TITLE)).isNotNull()
            assertThat(awaitNodeWithScroll(instrumentation, "查看每日卡片")).isNotNull()
            repeat(3) { swipeForward(instrumentation) }
            assertThat(findTextNode(
                instrumentation.uiAutomation.rootInActiveWindow,
                "你的推荐偏好"
            )).isNull()

            val output = File(context.getExternalFilesDir(null), SCREENSHOT_NAME)
            output.outputStream().use { stream ->
                assertThat(
                    instrumentation.uiAutomation.takeScreenshot()
                        .compress(Bitmap.CompressFormat.PNG, 100, stream)
                ).isTrue()
            }
            assertThat(output.length()).isGreaterThan(0L)

            click(awaitNodeWithScroll(instrumentation, "查看每日卡片"))
            assertThat(awaitNodeWithScroll(instrumentation, "你的推荐偏好")).isNotNull()

            repeat(4) { swipeBackward(instrumentation) }
            click(awaitNode(instrumentation, "收藏 0"))
            assertThat(awaitNode(instrumentation, EMPTY_TITLE)).isNotNull()
            instrumentation.uiAutomation.executeShellCommand("input keyevent KEYCODE_BACK").close()
            assertThat(awaitNodeWithScroll(instrumentation, "你的推荐偏好")).isNotNull()
            assertThat(findTextNode(
                instrumentation.uiAutomation.rootInActiveWindow,
                EMPTY_TITLE
            )).isNull()
        } finally {
            scenario?.close()
            database.cards().clear()
            database.close()
            preferences.edit().putBoolean("completed", wasOnboarded).commit()
        }
    }

    private fun click(node: AccessibilityNodeInfo) {
        val clickable = generateSequence(node) { current -> current.parent }
            .firstOrNull { current -> current.isClickable }
        assertThat(clickable).isNotNull()
        assertThat(clickable!!.performAction(AccessibilityNodeInfo.ACTION_CLICK)).isTrue()
    }

    private fun awaitNode(
        instrumentation: android.app.Instrumentation,
        text: String,
        timeoutMillis: Long = 10_000
    ): AccessibilityNodeInfo {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        while (SystemClock.uptimeMillis() < deadline) {
            findTextNode(instrumentation.uiAutomation.rootInActiveWindow, text)?.let { return it }
            SystemClock.sleep(100)
        }
        error("Timed out waiting for accessibility node: $text")
    }

    private fun awaitNodeWithScroll(
        instrumentation: android.app.Instrumentation,
        text: String,
        timeoutMillis: Long = 10_000
    ): AccessibilityNodeInfo {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        while (SystemClock.uptimeMillis() < deadline) {
            findTextNode(instrumentation.uiAutomation.rootInActiveWindow, text)?.let { return it }
            swipeForward(instrumentation)
        }
        error("Timed out scrolling to accessibility node: $text")
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

    private fun swipeBackward(instrumentation: android.app.Instrumentation) {
        val metrics = instrumentation.targetContext.resources.displayMetrics
        val centerX = metrics.widthPixels / 2
        instrumentation.uiAutomation.executeShellCommand(
            "input swipe $centerX ${(metrics.heightPixels * 0.32f).toInt()} " +
                "$centerX ${(metrics.heightPixels * 0.78f).toInt()} 250"
        ).close()
        SystemClock.sleep(250)
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
        const val EMPTY_TITLE = "把想记住的知识留在这里"
        const val SCREENSHOT_NAME = "saved-empty-state.png"
    }
}
