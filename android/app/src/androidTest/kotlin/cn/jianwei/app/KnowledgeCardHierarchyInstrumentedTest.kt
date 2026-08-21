package cn.jianwei.app

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Rect
import android.net.Uri
import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.platform.io.PlatformTestStorageRegistry
import cn.jianwei.data.local.CardEntity
import cn.jianwei.data.local.buildJianweiDatabase
import cn.jianwei.data.local.sourcesToJson
import cn.jianwei.domain.model.KnowledgeSource
import com.google.common.truth.Truth.assertThat
import java.io.File
import java.time.LocalDate
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Test

class KnowledgeCardHierarchyInstrumentedTest {
    @Test
    fun knowledgeLeadsRecognitionAndPhotoProvenance() = runBlocking {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val database = buildJianweiDatabase(context)
        val photo = File(context.filesDir, REAL_PHOTO_FILE_NAME)
        var scenario: ActivityScenario<MainActivity>? = null
        try {
            context.resources.openRawResource(R.drawable.onboarding_broom_example).use { input ->
                photo.outputStream().use(input::copyTo)
            }
            database.cards().clear()
            context.getSharedPreferences("onboarding", Context.MODE_PRIVATE)
                .edit()
                .putBoolean("completed", true)
                .commit()
            database.cards().upsertAll(listOf(card(Uri.fromFile(photo).toString())))

            scenario = ActivityScenario.launch(MainActivity::class.java)
            val photoNode = awaitNodeByDescription(instrumentation, PHOTO_DESCRIPTION)
            val photoBounds = bounds(photoNode)
            val windowBounds = bounds(instrumentation.uiAutomation.rootInActiveWindow)
            val body = awaitNode(instrumentation, DISPLAY_BODY)
            assertThat(awaitNode(instrumentation, TITLE)).isNotNull()
            assertThat(findTextNode(instrumentation.uiAutomation.rootInActiveWindow, BODY)).isNull()
            assertThat(findTextNode(instrumentation.uiAutomation.rootInActiveWindow, PHOTO_UNAVAILABLE)).isNull()
            assertThat(photoBounds.height()).isGreaterThan(windowBounds.height() / 6)
            assertThat(awaitNode(instrumentation, "今日一知")).isNotNull()
            assertThat(awaitNode(instrumentation, "见微")).isNotNull()
            assertThat(findTextNode(instrumentation.uiAutomation.rootInActiveWindow, BRAND_PROMISE)).isNull()
            assertThat(findTextNode(instrumentation.uiAutomation.rootInActiveWindow, "今天")).isNull()
            assertThat(findTextNode(instrumentation.uiAutomation.rootInActiveWindow, "照片权限：仅手动选择")).isNull()
            val evidenceSuffix = if (context.resources.configuration.fontScale >= 1.5f) "font-1.6" else "standard"
            screenshot(instrumentation, "real-photo-knowledge-card-headline-$evidenceSuffix.png")
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
            assertThat(awaitNodeWithScroll(instrumentation, SOURCE_LABEL)).isNotNull()
            assertThat(awaitNodeWithScroll(instrumentation, SOURCE_TITLE)).isNotNull()

            if (!requiresScroll) {
                assertThat(topOf(body)).isLessThan(topOf(recognition))
                assertThat(topOf(recognition)).isLessThan(topOf(provenance))
            } else {
                assertThat(awaitNodeWithScroll(instrumentation, SAVE_ACTION)).isNotNull()
            }
            assertThat(awaitNodeWithScroll(instrumentation, REMINDER_ACTION)).isNotNull()
            assertThat(awaitNodeWithScroll(instrumentation, WIDGET_ACTION)).isNotNull()

            screenshot(instrumentation, "real-photo-knowledge-card-provenance-$evidenceSuffix.png")

            val feedbackTitle = awaitNodeWithScroll(instrumentation, FEEDBACK_TITLE)
            listOf("有意思", "没意思", "识错了", "太私人").forEach { choice ->
                assertThat(awaitNodeWithScroll(instrumentation, choice)).isNotNull()
            }
            val visibleFeedbackTitle = findTextNode(
                instrumentation.uiAutomation.rootInActiveWindow,
                FEEDBACK_TITLE
            ) ?: feedbackTitle
            alignNodeBelowNavigation(instrumentation, visibleFeedbackTitle)
            assertThat(awaitNode(instrumentation, FEEDBACK_TITLE)).isNotNull()
            screenshot(instrumentation, "real-photo-knowledge-card-feedback-$evidenceSuffix.png")
            PlatformTestStorageRegistry.getInstance()
                .openOutputFile("real-photo-knowledge-card-layout-$evidenceSuffix.json")
                .use { stream ->
                    stream.writer().use { writer ->
                        writer.write(
                            JSONObject()
                                .put("schemaVersion", 1)
                                .put("releaseEvidence", false)
                                .put("fontScale", context.resources.configuration.fontScale.toDouble())
                                .put("photoFixture", "bundled-no-person-broom")
                                .put("factId", "broom-001")
                                .put("realPhotoVisible", true)
                                .put("missingPhotoFallbackVisible", false)
                                .put("photoHeightPx", photoBounds.height())
                                .put("windowHeightPx", windowBounds.height())
                                .put("reviewedSourceVisible", true)
                                .put("widgetActionReachable", true)
                                .put("reminderActionReachable", true)
                                .put("allFeedbackActionsReachable", true)
                                .toString(2)
                        )
                    }
                }
            click(awaitNodeWithScroll(instrumentation, "太私人"))
            assertThat(awaitNode(instrumentation, PRIVATE_DIALOG_TITLE)).isNotNull()
            click(awaitNode(instrumentation, "保留卡片"))
            assertThat(awaitNodeWithScroll(instrumentation, FEEDBACK_TITLE)).isNotNull()
        } finally {
            scenario?.close()
            database.cards().clear()
            database.close()
            photo.delete()
        }
    }

    private fun card(photoUri: String) = CardEntity(
        cardId = "card-knowledge-hierarchy",
        candidateToken = "candidate-knowledge-hierarchy",
        photoUri = photoUri,
        topicId = "broom",
        factId = "broom-001",
        title = TITLE,
        detectedObjectName = "扫帚",
        body = BODY,
        personalContext = PERSONAL_CONTEXT,
        confidence = 0.95,
        sources = sourcesToJson(listOf(
            KnowledgeSource(
                sourceId = "src-broom",
                title = SOURCE_TITLE,
                url = "https://patents.google.com/patent/US4756039A/en",
                publisher = "Google Patents",
                authority = "reference"
            )
        )),
        status = "scheduled",
        scheduledDate = LocalDate.now().toString(),
        createdAtMillis = System.currentTimeMillis()
    )

    private fun topOf(node: AccessibilityNodeInfo): Int = Rect().also(node::getBoundsInScreen).top

    private fun bounds(node: AccessibilityNodeInfo): Rect = Rect().also(node::getBoundsInScreen)

    private fun screenshot(instrumentation: android.app.Instrumentation, name: String) {
        PlatformTestStorageRegistry.getInstance().openOutputFile(name).use { stream ->
            assertThat(
                instrumentation.uiAutomation.takeScreenshot()
                    .compress(Bitmap.CompressFormat.PNG, 100, stream)
            ).isTrue()
        }
    }

    private fun alignNodeBelowNavigation(
        instrumentation: android.app.Instrumentation,
        node: AccessibilityNodeInfo
    ) {
        val metrics = instrumentation.targetContext.resources.displayMetrics
        val nodeTop = bounds(node).top
        val targetTop = (metrics.heightPixels * 0.18f).toInt()
        val distance = if (nodeTop > targetTop) {
            (nodeTop - targetTop).coerceAtLeast(240)
        } else {
            0
        }
        if (distance == 0) return
        val centerX = metrics.widthPixels / 2
        val startY = (metrics.heightPixels * 0.78f).toInt()
        val endY = (startY - distance).coerceAtLeast((metrics.heightPixels * 0.28f).toInt())
        instrumentation.uiAutomation
            .executeShellCommand("input swipe $centerX $startY $centerX $endY 300")
            .close()
        SystemClock.sleep(350)
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

    private fun awaitNodeByDescription(
        instrumentation: android.app.Instrumentation,
        description: String,
        timeoutMillis: Long = 10_000
    ): AccessibilityNodeInfo {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        while (SystemClock.uptimeMillis() < deadline) {
            findDescriptionNode(instrumentation.uiAutomation.rootInActiveWindow, description)?.let { return it }
            SystemClock.sleep(100)
        }
        error("Timed out waiting for accessibility description: $description")
    }

    private fun findTextNode(root: AccessibilityNodeInfo?, text: String): AccessibilityNodeInfo? {
        if (root == null) return null
        if (root.text?.toString() == text) return root
        for (index in 0 until root.childCount) {
            findTextNode(root.getChild(index), text)?.let { return it }
        }
        return null
    }

    private fun findDescriptionNode(root: AccessibilityNodeInfo?, description: String): AccessibilityNodeInfo? {
        if (root == null) return null
        if (root.contentDescription?.toString() == description) return root
        for (index in 0 until root.childCount) {
            findDescriptionNode(root.getChild(index), description)?.let { return it }
        }
        return null
    }

    private companion object {
        const val TITLE = "现代扫帚常把刷毛设计成略带角度的扇形"
        const val BODY = "$TITLE，让边缘更容易贴近墙角和家具边缘。"
        const val DISPLAY_BODY = "让边缘更容易贴近墙角和家具边缘。"
        const val RECOGNITION = "识别对象：扫帚 · 把握较高"
        const val PROVENANCE_TITLE = "为什么推给你"
        const val SAVE_ACTION = "收藏"
        const val REMINDER_ACTION = "物品提醒"
        const val WIDGET_ACTION = "添加到桌面"
        const val PERSONAL_CONTEXT = "你在 2026 年 7 月 23 日拍下了「扫帚」，所以今天从它讲起。"
        const val SOURCE_LABEL = "来源 · Google Patents"
        const val SOURCE_TITLE = "US4756039A: angled-cut bristle broom"
        const val PHOTO_DESCRIPTION = "$TITLE\u7684原照片缩略图"
        const val PHOTO_UNAVAILABLE = "原图暂不可显示"
        const val REAL_PHOTO_FILE_NAME = "knowledge-card-real-broom.webp"
        const val BRAND_PROMISE = "从你的照片里，每天认识一件小事"
        const val FEEDBACK_TITLE = "这条知识怎么样？"
        const val PRIVATE_DIALOG_TITLE = "将这张照片标记为太私人？"
    }
}
