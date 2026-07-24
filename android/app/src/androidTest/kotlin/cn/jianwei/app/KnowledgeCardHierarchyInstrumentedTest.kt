package cn.jianwei.app

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Rect
import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import cn.jianwei.data.local.CardEntity
import cn.jianwei.data.local.buildJianweiDatabase
import cn.jianwei.data.local.sourcesToJson
import cn.jianwei.domain.model.KnowledgeSource
import com.google.common.truth.Truth.assertThat
import java.io.File
import java.time.LocalDate
import kotlinx.coroutines.runBlocking
import org.junit.Test

class KnowledgeCardHierarchyInstrumentedTest {
    @Test
    fun knowledgeLeadsRecognitionAndPhotoProvenance() = runBlocking {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val database = buildJianweiDatabase(context)
        var scenario: ActivityScenario<MainActivity>? = null
        try {
            database.cards().clear()
            context.getSharedPreferences("onboarding", Context.MODE_PRIVATE)
                .edit()
                .putBoolean("completed", true)
                .commit()
            database.cards().upsertAll(listOf(card()))

            scenario = ActivityScenario.launch(MainActivity::class.java)
            val body = awaitNode(instrumentation, BODY)
            assertThat(awaitNode(instrumentation, "今日一知")).isNotNull()
            assertThat(awaitNode(instrumentation, BRAND_PROMISE)).isNotNull()
            assertThat(findTextNode(instrumentation.uiAutomation.rootInActiveWindow, "照片权限：仅手动选择")).isNull()
            val requiresScroll = context.resources.configuration.screenWidthDp < 360 ||
                context.resources.configuration.fontScale >= 1.5f
            val recognition = if (requiresScroll) {
                awaitNodeWithScroll(instrumentation, RECOGNITION)
            } else {
                awaitNode(instrumentation, RECOGNITION)
            }
            val provenance = if (requiresScroll) {
                awaitNodeWithScroll(instrumentation, PROVENANCE_TITLE)
            } else {
                awaitNode(instrumentation, PROVENANCE_TITLE)
            }
            if (context.resources.configuration.screenWidthDp >= 360) {
                assertThat(awaitNode(instrumentation, PERSONAL_CONTEXT)).isNotNull()
            }

            if (!requiresScroll) {
                assertThat(topOf(body)).isLessThan(topOf(recognition))
                assertThat(topOf(recognition)).isLessThan(topOf(provenance))
            } else {
                assertThat(awaitNodeWithScroll(instrumentation, SAVE_ACTION)).isNotNull()
            }

            val output = File(context.getExternalFilesDir(null), SCREENSHOT_NAME)
            output.outputStream().use { stream ->
                assertThat(instrumentation.uiAutomation.takeScreenshot()
                    .compress(Bitmap.CompressFormat.PNG, 100, stream)).isTrue()
            }
            assertThat(output.length()).isGreaterThan(0L)

            assertThat(awaitNodeWithScroll(instrumentation, FEEDBACK_TITLE)).isNotNull()
            listOf("有意思", "没意思", "识错了", "太私人").forEach { choice ->
                assertThat(awaitNodeWithScroll(instrumentation, choice)).isNotNull()
            }
            val feedbackOutput = File(context.getExternalFilesDir(null), FEEDBACK_SCREENSHOT_NAME)
            feedbackOutput.outputStream().use { stream ->
                assertThat(instrumentation.uiAutomation.takeScreenshot()
                    .compress(Bitmap.CompressFormat.PNG, 100, stream)).isTrue()
            }
            assertThat(feedbackOutput.length()).isGreaterThan(0L)
            click(awaitNodeWithScroll(instrumentation, "太私人"))
            assertThat(awaitNode(instrumentation, PRIVATE_DIALOG_TITLE)).isNotNull()
            click(awaitNode(instrumentation, "保留卡片"))
            assertThat(awaitNodeWithScroll(instrumentation, FEEDBACK_TITLE)).isNotNull()
        } finally {
            scenario?.close()
            database.cards().clear()
            database.close()
        }
    }

    private fun card() = CardEntity(
        cardId = "card-knowledge-hierarchy",
        candidateToken = "candidate-knowledge-hierarchy",
        photoUri = "",
        topicId = "bicycle",
        factId = "bicycle-knowledge-hierarchy",
        title = "自行车",
        detectedObjectName = "自行车",
        body = BODY,
        personalContext = PERSONAL_CONTEXT,
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

    private fun topOf(node: AccessibilityNodeInfo): Int = Rect().also(node::getBoundsInScreen).top

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
            val root = instrumentation.uiAutomation.rootInActiveWindow
            findTextNode(root, text)?.let { return it }
            val metrics = instrumentation.targetContext.resources.displayMetrics
            val centerX = metrics.widthPixels / 2
            val startY = (metrics.heightPixels * 0.78f).toInt()
            val endY = (metrics.heightPixels * 0.32f).toInt()
            instrumentation.uiAutomation
                .executeShellCommand("input swipe $centerX $startY $centerX $endY 250")
                .close()
            SystemClock.sleep(250)
        }
        error("Timed out scrolling to accessibility node: $text")
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
        const val BODY = "自行车链传动用前后不同大小的齿盘改变转速与扭矩，让骑手在速度和省力之间选择。"
        const val RECOGNITION = "识别对象：自行车 · 把握较高"
        const val PROVENANCE_TITLE = "为什么推给你"
        const val SAVE_ACTION = "收藏"
        const val PERSONAL_CONTEXT = "你在 2026 年 7 月 23 日拍下了「自行车」，所以今天从它讲起。"
        const val BRAND_PROMISE = "从你的照片里，每天认识一件小事"
        const val FEEDBACK_TITLE = "这条知识怎么样？"
        const val PRIVATE_DIALOG_TITLE = "将这张照片标记为太私人？"
        const val SCREENSHOT_NAME = "knowledge-card-hierarchy.png"
        const val FEEDBACK_SCREENSHOT_NAME = "knowledge-card-feedback.png"
    }
}
