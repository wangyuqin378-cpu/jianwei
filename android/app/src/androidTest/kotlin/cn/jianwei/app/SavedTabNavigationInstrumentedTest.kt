package cn.jianwei.app

import android.content.Context
import android.graphics.Bitmap
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

            click(awaitNodeWithBackwardScroll(instrumentation, "收藏 0"))
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

    @Test
    fun savedCollectionUsesCompactPreviewsAndOpensFullKnowledgeInContext() = runBlocking {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val preferences = context.getSharedPreferences("onboarding", Context.MODE_PRIVATE)
        val wasOnboarded = preferences.getBoolean("completed", false)
        val database = buildJianweiDatabase(context)
        var scenario: ActivityScenario<MainActivity>? = null
        try {
            database.cards().clear()
            preferences.edit().putBoolean("completed", true).commit()
            val now = System.currentTimeMillis()
            database.cards().upsertAll(listOf(savedCard(PRIMARY_CARD_ID, PRIMARY_TITLE), savedCard(SECONDARY_CARD_ID, SECONDARY_TITLE)))
            database.cards().setCardSaved(SECONDARY_CARD_ID, true, now)
            database.cards().setCardSaved(PRIMARY_CARD_ID, true, now + 1_000)
            scenario = ActivityScenario.launch(MainActivity::class.java)

            click(awaitNode(instrumentation, "收藏 2"))
            assertThat(awaitNode(instrumentation, "收藏的知识")).isNotNull()
            assertThat(awaitNode(instrumentation, "共 2 张，按最近收藏排序。点开卡片查看来源、提醒和反馈。")).isNotNull()
            assertThat(awaitNode(instrumentation, PRIMARY_TITLE)).isNotNull()
            val openPrimary = awaitNodeWithScroll(instrumentation, "查看完整知识")
            assertThat(findTextNode(
                instrumentation.uiAutomation.rootInActiveWindow,
                "为什么推给你"
            )).isNull()

            val output = File(context.getExternalFilesDir(null), COLLECTION_SCREENSHOT_NAME)
            output.outputStream().use { stream ->
                assertThat(
                    instrumentation.uiAutomation.takeScreenshot()
                        .compress(Bitmap.CompressFormat.PNG, 100, stream)
                ).isTrue()
            }
            assertThat(output.length()).isGreaterThan(0L)

            click(openPrimary)
            assertThat(awaitNode(instrumentation, "从收藏打开")).isNotNull()
            assertThat(awaitNode(instrumentation, "返回收藏")).isNotNull()
            assertThat(awaitNodeWithScroll(instrumentation, "为什么推给你")).isNotNull()

            instrumentation.uiAutomation.executeShellCommand("input keyevent KEYCODE_BACK").close()
            val reopenedPrimary = awaitNode(instrumentation, "查看完整知识")
            assertThat(findTextNode(
                instrumentation.uiAutomation.rootInActiveWindow,
                "从收藏打开"
            )).isNull()

            click(reopenedPrimary)
            assertThat(awaitNode(instrumentation, "从收藏打开")).isNotNull()
            SystemClock.sleep(300)
            click(awaitNodeWithScroll(instrumentation, "取消收藏"))
            assertThat(awaitNodeWithBackwardScroll(instrumentation, "收藏 1")).isNotNull()
            assertThat(awaitNodeWithScroll(instrumentation, SECONDARY_TITLE)).isNotNull()
            assertThat(database.cards().findSavedCard(PRIMARY_CARD_ID)?.isSaved).isFalse()
        } finally {
            scenario?.close()
            database.cards().clear()
            database.close()
            preferences.edit().putBoolean("completed", wasOnboarded).commit()
        }
    }

    private fun savedCard(cardId: String, title: String) = CardEntity(
        cardId = cardId,
        candidateToken = "candidate-$cardId",
        photoUri = "",
        topicId = "bicycle",
        factId = "fact-$cardId",
        title = title,
        detectedObjectName = "自行车",
        body = "不同大小的齿盘会改变转速与扭矩，让骑行者在速度和省力之间选择。",
        personalContext = "你拍下过自行车，所以从它讲起。",
        confidence = 0.95,
        sources = sourcesToJson(listOf(
            KnowledgeSource(
                sourceId = "source-$cardId",
                title = "Bicycle gearing",
                url = "https://en.wikipedia.org/wiki/Bicycle_gearing",
                publisher = "Wikipedia",
                authority = "reference"
            )
        )),
        status = "scheduled",
        scheduledDate = java.time.LocalDate.now().toString(),
        createdAtMillis = System.currentTimeMillis()
    )

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

    private fun awaitNodeWithBackwardScroll(
        instrumentation: android.app.Instrumentation,
        text: String,
        timeoutMillis: Long = 10_000
    ): AccessibilityNodeInfo {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        while (SystemClock.uptimeMillis() < deadline) {
            findTextNode(instrumentation.uiAutomation.rootInActiveWindow, text)?.let { return it }
            swipeBackward(instrumentation)
        }
        error("Timed out scrolling backward to accessibility node: $text")
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
        const val COLLECTION_SCREENSHOT_NAME = "saved-collection.png"
        const val PRIMARY_CARD_ID = "saved-primary"
        const val PRIMARY_TITLE = "自行车的齿轮为什么大小不同"
        const val SECONDARY_CARD_ID = "saved-secondary"
        const val SECONDARY_TITLE = "车轮为什么需要辐条"
    }
}
