package cn.jianwei.app

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.graphics.Bitmap
import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import cn.jianwei.app.widget.DailyWidgetReceiver
import cn.jianwei.data.local.CardEntity
import cn.jianwei.data.local.buildJianweiDatabase
import cn.jianwei.data.local.sourcesToJson
import cn.jianwei.domain.model.KnowledgeSource
import com.google.common.truth.Truth.assertThat
import java.io.File
import java.time.LocalDate
import kotlinx.coroutines.runBlocking
import org.junit.Assume.assumeTrue
import org.junit.Test

class WidgetInstallCompletionInstrumentedTest {
    @Test
    fun pinningWidgetClosesTheHomePromptAndKeepsARepeatManagementAction() = runBlocking {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val manager = AppWidgetManager.getInstance(context)
        val provider = ComponentName(context, DailyWidgetReceiver::class.java)
        val preferences = context.getSharedPreferences("onboarding", Context.MODE_PRIVATE)
        val wasOnboarded = preferences.getBoolean("completed", false)
        val database = buildJianweiDatabase(context)
        var scenario: ActivityScenario<MainActivity>? = null
        assumeTrue("Reference launcher pinning is required", manager.isRequestPinAppWidgetSupported)
        assumeTrue("Test requires a clean widget host", manager.getAppWidgetIds(provider).isEmpty())

        try {
            database.cards().clear()
            preferences.edit().putBoolean("completed", true).commit()
            database.cards().upsertAll(listOf(card()))

            scenario = ActivityScenario.launch(MainActivity::class.java)
            assertThat(awaitNode(instrumentation, CARD_BODY)).isNotNull()
            assertThat(awaitNodeWithScroll(instrumentation, CTA_TITLE)).isNotNull()
            clickNode(instrumentation, "添加桌面组件")
            clickAnyNode(instrumentation, listOf("Add to home screen", "添加到主屏幕"))

            awaitCondition("widget binding") { manager.getAppWidgetIds(provider).isNotEmpty() }
            awaitCondition("return to app") {
                instrumentation.uiAutomation.rootInActiveWindow?.packageName?.toString() == context.packageName
            }
            expandPrivacyCenter(instrumentation)
            assertThat(awaitNodeWithScroll(instrumentation, "再添加一个桌面组件")).isNotNull()

            val output = File(context.getExternalFilesDir(null), SCREENSHOT_NAME)
            output.outputStream().use { stream ->
                assertThat(instrumentation.uiAutomation.takeScreenshot()
                    .compress(Bitmap.CompressFormat.PNG, 100, stream)).isTrue()
            }
            assertThat(output.length()).isGreaterThan(0L)
        } finally {
            scenario?.close()
            database.cards().clear()
            database.close()
            preferences.edit().putBoolean("completed", wasOnboarded).commit()
            instrumentation.uiAutomation
                .executeShellCommand("pm clear com.google.android.apps.nexuslauncher")
                .close()
        }
    }

    private fun card() = CardEntity(
        cardId = "card-widget-install-completion",
        candidateToken = "candidate-widget-install-completion",
        photoUri = "",
        topicId = "bicycle",
        factId = "bicycle-widget-install-completion",
        title = "自行车",
        detectedObjectName = "自行车",
        body = CARD_BODY,
        personalContext = "因为你最近拍过它",
        confidence = 0.95,
        sources = sourcesToJson(listOf(
            KnowledgeSource(
                sourceId = "bicycle-source",
                title = "Bicycle gearing",
                url = "https://en.wikipedia.org/wiki/Bicycle_gearing",
                publisher = "Wikipedia",
                authority = "reference"
            )
        )),
        status = "scheduled",
        scheduledDate = LocalDate.now().toString(),
        createdAtMillis = System.currentTimeMillis()
    )

    private fun clickNode(instrumentation: android.app.Instrumentation, text: String) {
        click(awaitNodeWithScroll(instrumentation, text))
    }

    private fun clickAnyNode(instrumentation: android.app.Instrumentation, texts: List<String>) {
        val deadline = SystemClock.uptimeMillis() + 10_000
        while (SystemClock.uptimeMillis() < deadline) {
            val root = instrumentation.uiAutomation.rootInActiveWindow
            texts.firstNotNullOfOrNull { findTextNode(root, it) }?.let {
                click(it)
                return
            }
            SystemClock.sleep(100)
        }
        error("Timed out waiting for one of: $texts")
    }

    private fun expandPrivacyCenter(instrumentation: android.app.Instrumentation) {
        repeat(3) {
            click(awaitNodeWithScroll(instrumentation, "管理隐私与数据"))
            val deadline = SystemClock.uptimeMillis() + 2_000
            while (SystemClock.uptimeMillis() < deadline) {
                if (findTextNode(
                        instrumentation.uiAutomation.rootInActiveWindow,
                        "收起隐私与数据"
                    ) != null
                ) return
                SystemClock.sleep(100)
            }
        }
        error("Timed out expanding privacy center")
    }

    private fun click(node: AccessibilityNodeInfo) {
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
            instrumentation.uiAutomation
                .executeShellCommand("input swipe 540 1900 540 750 250")
                .close()
            SystemClock.sleep(250)
        }
        val root = instrumentation.uiAutomation.rootInActiveWindow
        error("Timed out waiting for accessibility node: $text; visible=${visibleText(root)}")
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

    private fun visibleText(root: AccessibilityNodeInfo?): List<String> = buildList {
        fun collect(node: AccessibilityNodeInfo?) {
            if (node == null || size >= 50) return
            node.text?.toString()?.takeIf(String::isNotBlank)?.let(::add)
            for (index in 0 until node.childCount) collect(node.getChild(index))
        }
        collect(root)
    }

    private fun awaitCondition(label: String, timeoutMillis: Long = 10_000, condition: () -> Boolean) {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        while (SystemClock.uptimeMillis() < deadline) {
            if (condition()) return
            SystemClock.sleep(100)
        }
        error("Timed out waiting for $label")
    }

    private companion object {
        const val CARD_BODY = "自行车链传动用不同大小的齿盘，在速度与省力之间切换。"
        const val CTA_TITLE = "每天在桌面遇见新知识"
        const val SCREENSHOT_NAME = "widget-install-completion.png"
    }
}
