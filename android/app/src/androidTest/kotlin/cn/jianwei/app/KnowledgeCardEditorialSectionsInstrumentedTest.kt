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
import kotlin.math.abs
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Test

class KnowledgeCardEditorialSectionsInstrumentedTest {
    @Test
    fun provenanceAndFeedbackReadAsFlatSectionsOfTheKnowledgeCard() = runBlocking {
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
            val recognition = awaitNode(instrumentation, RECOGNITION)
            val provenance = awaitNode(instrumentation, PROVENANCE_TITLE)
            val contentLeft = bounds(body).left
            val recognitionLeft = bounds(recognition).left
            val provenanceLeft = bounds(provenance).left

            assertThat(abs(recognitionLeft - contentLeft)).isAtMost(8)
            assertThat(abs(provenanceLeft - contentLeft)).isAtMost(8)
            assertThat(bounds(body).top).isLessThan(bounds(recognition).top)
            assertThat(bounds(recognition).top).isLessThan(bounds(provenance).top)
            screenshot(context, instrumentation, PROVENANCE_SCREENSHOT)

            val feedback = awaitNodeWithScroll(instrumentation, FEEDBACK_TITLE)
            val feedbackLeft = bounds(feedback).left
            assertThat(abs(feedbackLeft - contentLeft)).isAtMost(8)
            listOf("有意思", "没意思", "识错了", "太私人").forEach { label ->
                val choice = awaitNodeWithScroll(instrumentation, label)
                assertThat(clickableAncestor(choice)).isNotNull()
            }
            scrollForward(instrumentation)
            SystemClock.sleep(300)
            screenshot(context, instrumentation, FEEDBACK_SCREENSHOT)

            val like = awaitNodeWithScroll(instrumentation, "有意思")
            assertThat(clickableAncestor(like)?.performAction(AccessibilityNodeInfo.ACTION_CLICK)).isTrue()
            awaitNode(instrumentation, "见微学到了什么")
            awaitNode(instrumentation, "已记住 · 有意思")
            awaitNode(
                instrumentation,
                "之后会更常留意“自行车”这类内容。只影响本次安装。"
            )
            awaitStoredLearning(database)
            screenshot(context, instrumentation, LEARNED_CARD_SCREENSHOT)

            val settingsTab = awaitNodeByValue(instrumentation, "设置与隐私")
            assertThat(clickableAncestor(settingsTab)?.performAction(AccessibilityNodeInfo.ACTION_CLICK)).isTrue()
            awaitNodeWithScroll(instrumentation, "见微正在学习")
            awaitNodeWithScroll(instrumentation, "更常留意：自行车")
            awaitNodeWithScroll(
                instrumentation,
                "只显示仍保留卡片的物件名称和本机反馈，不显示照片内容。"
            )
            awaitTextGone(
                instrumentation,
                "已记住「有意思」；之后会更常留意这类内容"
            )
            screenshot(context, instrumentation, LEARNED_SETTINGS_SCREENSHOT)
            File(context.getExternalFilesDir(null), LAYOUT_AUDIT).writeText(
                JSONObject()
                    .put("schemaVersion", 1)
                    .put("releaseEvidence", false)
                    .put("contentLeftPx", contentLeft)
                    .put("recognitionLeftPx", recognitionLeft)
                    .put("recognitionAlignmentDeltaPx", abs(recognitionLeft - contentLeft))
                    .put("provenanceLeftPx", provenanceLeft)
                    .put("provenanceAlignmentDeltaPx", abs(provenanceLeft - contentLeft))
                    .put("feedbackLeftPx", feedbackLeft)
                    .put("feedbackAlignmentDeltaPx", abs(feedbackLeft - contentLeft))
                    .put("feedbackActionsClickable", true)
                    .put("learningEffectVisibleOnCard", true)
                    .put("learnedPreferenceVisibleInSettings", true)
                    .toString(2)
            )
        } finally {
            scenario?.close()
            database.cards().clear()
            database.close()
        }
    }

    private fun card() = CardEntity(
        cardId = "card-editorial-sections",
        candidateToken = "candidate-editorial-sections",
        photoUri = "",
        topicId = "bicycle",
        factId = "bicycle-editorial-sections",
        title = "自行车",
        detectedObjectName = "自行车",
        body = FULL_BODY,
        personalContext = "因为你最近拍过它",
        confidence = 0.95,
        sources = sourcesToJson(
            listOf(
                KnowledgeSource(
                    sourceId = "bicycle-source",
                    title = "Bicycle gearing",
                    url = "https://en.wikipedia.org/wiki/Bicycle_gearing",
                    publisher = "Wikipedia",
                    authority = "reference"
                )
            )
        ),
        status = "scheduled",
        scheduledDate = LocalDate.now().toString(),
        createdAtMillis = System.currentTimeMillis()
    )

    private fun screenshot(
        context: Context,
        instrumentation: android.app.Instrumentation,
        name: String
    ) {
        val output = File(context.getExternalFilesDir(null), name)
        output.outputStream().use { stream ->
            assertThat(
                instrumentation.uiAutomation.takeScreenshot()
                    .compress(Bitmap.CompressFormat.PNG, 100, stream)
            ).isTrue()
        }
        assertThat(output.length()).isGreaterThan(0L)
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
            scrollForward(instrumentation)
            SystemClock.sleep(250)
        }
        error("Timed out scrolling to accessibility node: $text")
    }

    private fun awaitNodeByValue(
        instrumentation: android.app.Instrumentation,
        value: String,
        timeoutMillis: Long = 10_000
    ): AccessibilityNodeInfo {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        while (SystemClock.uptimeMillis() < deadline) {
            findNode(instrumentation.uiAutomation.rootInActiveWindow, value)?.let { return it }
            SystemClock.sleep(100)
        }
        error("Timed out waiting for accessibility value: $value")
    }

    private fun awaitTextGone(
        instrumentation: android.app.Instrumentation,
        text: String,
        timeoutMillis: Long = 8_000
    ) {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        while (SystemClock.uptimeMillis() < deadline) {
            if (findTextNode(instrumentation.uiAutomation.rootInActiveWindow, text) == null) return
            SystemClock.sleep(100)
        }
        error("Timed out waiting for transient message to disappear: $text")
    }

    private suspend fun awaitStoredLearning(
        database: cn.jianwei.data.local.JianweiDatabase,
        timeoutMillis: Long = 10_000
    ) {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        while (SystemClock.uptimeMillis() < deadline) {
            val feedback = database.cards().findFeedbackState("card-editorial-sections")
            val affinity = database.cards().findTopicAffinity("bicycle")
            if (feedback?.action == "LIKE" && affinity?.weight?.let { it > 0.0 } == true) return
            SystemClock.sleep(100)
        }
        error("Timed out waiting for persisted LIKE feedback and a positive topic affinity")
    }

    private fun findNode(root: AccessibilityNodeInfo?, value: String): AccessibilityNodeInfo? {
        if (root == null) return null
        if (root.text?.toString() == value || root.contentDescription?.toString() == value) return root
        for (index in 0 until root.childCount) {
            findNode(root.getChild(index), value)?.let { return it }
        }
        return null
    }

    private fun findTextNode(root: AccessibilityNodeInfo?, text: String): AccessibilityNodeInfo? {
        if (root == null) return null
        if (root.text?.toString() == text) return root
        for (index in 0 until root.childCount) {
            findTextNode(root.getChild(index), text)?.let { return it }
        }
        return null
    }

    private fun scrollForward(instrumentation: android.app.Instrumentation) {
        val metrics = instrumentation.targetContext.resources.displayMetrics
        val centerX = metrics.widthPixels / 2
        instrumentation.uiAutomation.executeShellCommand(
            "input swipe $centerX ${(metrics.heightPixels * 0.78f).toInt()} " +
                "$centerX ${(metrics.heightPixels * 0.32f).toInt()} 250"
        ).close()
    }

    private fun clickableAncestor(node: AccessibilityNodeInfo): AccessibilityNodeInfo? =
        generateSequence(node) { current -> current.parent }
            .firstOrNull { current -> current.isClickable }

    private fun bounds(node: AccessibilityNodeInfo): Rect = Rect().also(node::getBoundsInScreen)

    private companion object {
        const val FULL_BODY = "自行车链传动用不同大小的齿盘，在速度与省力之间切换。"
        const val BODY = "链传动用不同大小的齿盘，在速度与省力之间切换。"
        const val RECOGNITION = "识别对象：自行车 · 把握较高"
        const val PROVENANCE_TITLE = "为什么推给你"
        const val FEEDBACK_TITLE = "这条知识怎么样？"
        const val PROVENANCE_SCREENSHOT = "knowledge-card-editorial-provenance.png"
        const val FEEDBACK_SCREENSHOT = "knowledge-card-editorial-feedback.png"
        const val LEARNED_CARD_SCREENSHOT = "feedback-learning-card.png"
        const val LEARNED_SETTINGS_SCREENSHOT = "feedback-learning-settings.png"
        const val LAYOUT_AUDIT = "knowledge-card-editorial-layout.json"
    }
}
