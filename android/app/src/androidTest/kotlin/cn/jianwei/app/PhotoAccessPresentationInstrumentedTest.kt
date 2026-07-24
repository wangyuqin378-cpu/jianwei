package cn.jianwei.app

import android.content.Context
import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import cn.jianwei.domain.model.PhotoAccess
import com.google.common.truth.Truth.assertThat
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
            findScrollableNode(root)?.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)
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

    private fun findScrollableNode(root: AccessibilityNodeInfo?): AccessibilityNodeInfo? {
        if (root == null) return null
        if (root.isScrollable) return root
        for (index in 0 until root.childCount) {
            findScrollableNode(root.getChild(index))?.let { return it }
        }
        return null
    }

    private companion object {
        const val EXPECTED_ACCESS_ARGUMENT = "expectedAccess"
    }
}
