package cn.jianwei.app

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.graphics.Bitmap
import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import cn.jianwei.domain.model.PhotoAccess
import com.google.common.truth.Truth.assertThat
import java.io.File
import org.junit.Assume.assumeTrue
import org.junit.Test

class AutomaticDiscoveryControlInstrumentedTest {
    @Test
    fun pickerOnlyUserCanRequestAutomaticDiscoveryAfterOnboarding() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val preferences = context.getSharedPreferences("onboarding", Context.MODE_PRIVATE)
        val schedulerPreferences = context.getSharedPreferences("analysis_scheduler", Context.MODE_PRIVATE)
        val wasOnboarded = preferences.getBoolean("completed", false)
        val previousMode = schedulerPreferences.getString(AUTOMATIC_CARD_MODE_KEY, null)
        assumeTrue(
            "System permission prompt evidence requires a picker-only installation",
            currentPhotoAccess(context) == PhotoAccess.PICKER_ONLY
        )
        var scenario: ActivityScenario<MainActivity>? = null
        try {
            preferences.edit().putBoolean("completed", true).commit()
            schedulerPreferences.edit().putString(AUTOMATIC_CARD_MODE_KEY, "DAILY_ONE").commit()

            scenario = ActivityScenario.launch(MainActivity::class.java)
            clickNode(instrumentation, "设置与隐私")
            assertThat(awaitNodeWithScroll(instrumentation, "管理隐私与数据")).isNotNull()
            clickNode(instrumentation, "管理隐私与数据")
            assertThat(awaitNodeWithScroll(instrumentation, "照片发现方式")).isNotNull()
            assertThat(awaitNodeWithScroll(
                instrumentation,
                "开启后先在本机筛选最近照片，每个自动周期最多上传分析 1 张；没有可靠命中时不会凑数。"
            )).isNotNull()
            assertThat(awaitNodeWithScroll(instrumentation, "开启自动发现")).isNotNull()

            val output = File(context.getExternalFilesDir(null), SCREENSHOT_NAME)
            output.outputStream().use { stream ->
                assertThat(instrumentation.uiAutomation.takeScreenshot()
                    .compress(Bitmap.CompressFormat.PNG, 100, stream)).isTrue()
            }
            assertThat(output.length()).isGreaterThan(0L)

            if (context.resources.configuration.fontScale >= 1.5f) {
                val enableNode = awaitNodeWithScroll(instrumentation, "开启自动发现")
                val clickable = clickableAncestor(enableNode)
                assertThat(clickable).isNotNull()
                assertThat(clickable!!.isEnabled).isTrue()
            } else {
                clickNode(instrumentation, "开启自动发现")
                awaitPermissionController(instrumentation)
            }
        } finally {
            instrumentation.uiAutomation.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
            scenario?.close()
            preferences.edit().putBoolean("completed", wasOnboarded).commit()
            schedulerPreferences.edit().apply {
                if (previousMode == null) remove(AUTOMATIC_CARD_MODE_KEY)
                else putString(AUTOMATIC_CARD_MODE_KEY, previousMode)
            }.commit()
        }
    }

    private fun clickNode(instrumentation: android.app.Instrumentation, text: String) {
        val node = awaitNodeWithScroll(instrumentation, text)
        val clickable = clickableAncestor(node)
        assertThat(clickable).isNotNull()
        assertThat(clickable!!.performAction(AccessibilityNodeInfo.ACTION_CLICK)).isTrue()
    }

    private fun clickableAncestor(node: AccessibilityNodeInfo): AccessibilityNodeInfo? =
        generateSequence(node) { current -> current.parent }
            .firstOrNull { current -> current.isClickable }

    private fun awaitNodeWithScroll(
        instrumentation: android.app.Instrumentation,
        text: String,
        timeoutMillis: Long = 10_000
    ): AccessibilityNodeInfo {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        while (SystemClock.uptimeMillis() < deadline) {
            val root = instrumentation.uiAutomation.rootInActiveWindow
            findTextNode(root, text)?.let { return it }
            swipeForward(instrumentation)
            SystemClock.sleep(250)
        }
        val root = instrumentation.uiAutomation.rootInActiveWindow
        error(
            "Timed out waiting for accessibility node: $text; " +
                "package=${root?.packageName}; visible=${visibleText(root)}"
        )
    }

    private fun findTextNode(root: AccessibilityNodeInfo?, text: String): AccessibilityNodeInfo? {
        if (root == null) return null
        if (
            root.isVisibleToUser &&
            (root.text?.toString() == text || root.contentDescription?.toString() == text)
        ) return root
        for (index in 0 until root.childCount) {
            findTextNode(root.getChild(index), text)?.let { return it }
        }
        return null
    }

    private fun swipeForward(instrumentation: android.app.Instrumentation) {
        val metrics = instrumentation.targetContext.resources.displayMetrics
        val centerX = metrics.widthPixels / 2
        instrumentation.uiAutomation.executeShellCommand(
            "input swipe $centerX ${(metrics.heightPixels * 0.78f).toInt()} " +
                "$centerX ${(metrics.heightPixels * 0.32f).toInt()} 250"
        ).close()
    }

    private fun visibleText(root: AccessibilityNodeInfo?): List<String> = buildList {
        fun collect(node: AccessibilityNodeInfo?) {
            if (node == null || size >= 50) return
            node.text?.toString()?.takeIf(String::isNotBlank)?.let(::add)
            for (index in 0 until node.childCount) collect(node.getChild(index))
        }
        collect(root)
    }

    private fun awaitPermissionController(
        instrumentation: android.app.Instrumentation,
        timeoutMillis: Long = 5_000
    ) {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        while (SystemClock.uptimeMillis() < deadline) {
            val packageName = instrumentation.uiAutomation.rootInActiveWindow
                ?.packageName
                ?.toString()
            if (packageName?.contains("permissioncontroller") == true) return
            SystemClock.sleep(100)
        }
        error("System photo permission UI did not appear")
    }

    private companion object {
        const val SCREENSHOT_NAME = "automatic-discovery-control.png"
        const val AUTOMATIC_CARD_MODE_KEY = "automatic_card_mode"
    }
}
