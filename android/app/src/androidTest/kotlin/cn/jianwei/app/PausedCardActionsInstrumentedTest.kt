package cn.jianwei.app

import android.content.Context
import android.view.accessibility.AccessibilityNodeInfo
import android.os.SystemClock
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import cn.jianwei.data.local.CardEntity
import cn.jianwei.data.local.buildJianweiDatabase
import cn.jianwei.data.local.sourcesToJson
import cn.jianwei.data.network.DeviceIdentity
import cn.jianwei.data.network.DeviceTokenCipher
import cn.jianwei.data.network.JianweiApi
import cn.jianwei.domain.model.FeedbackAction
import cn.jianwei.domain.model.KnowledgeSource
import com.google.common.truth.Truth.assertThat
import java.lang.reflect.Proxy
import java.time.LocalDate
import kotlinx.coroutines.runBlocking
import org.junit.Test

class PausedCardActionsInstrumentedTest {
    @Test
    fun pausedAnalysisKeepsSaveAndTooPrivateActionsFunctional() = runBlocking {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val database = buildJianweiDatabase(context)
        val onboarding = context.getSharedPreferences("onboarding", Context.MODE_PRIVATE)
        val scheduler = context.getSharedPreferences(SCHEDULER_PREFS, Context.MODE_PRIVATE)
        val identity = DeviceIdentity(context, unusedApi(), DeviceTokenCipher())
        val wasOnboarded = onboarding.getBoolean("completed", false)
        val wasPaused = scheduler.getBoolean(PAUSED_KEY, false)
        var scenario: ActivityScenario<MainActivity>? = null
        try {
            identity.reset()
            database.cards().clearPendingFeedback()
            database.cards().clearTrackedItems()
            database.cards().clear()
            onboarding.edit().putBoolean("completed", true).commit()
            scheduler.edit().putBoolean(PAUSED_KEY, false).commit()
            database.cards().upsertAll(listOf(card()))

            scenario = ActivityScenario.launch(MainActivity::class.java)
            awaitNode(instrumentation, "扫帚为什么常用成束的细条")
            click(awaitNode(instrumentation, "设置与隐私"))
            click(awaitNodeWithScroll(instrumentation, "管理隐私与数据"))
            click(awaitNodeWithScroll(instrumentation, "暂停分析"))
            awaitBooleanPreference(scheduler, PAUSED_KEY, true)
            click(awaitNode(instrumentation, "每日卡片"))
            awaitNode(instrumentation, "照片分析已暂停")

            click(awaitNodeWithScroll(instrumentation, "收藏"))
            awaitSaved(database)
            awaitNodeWithScroll(instrumentation, "取消收藏")

            click(awaitNodeWithScroll(instrumentation, "太私人"))
            awaitNode(instrumentation, "将这张照片标记为太私人？")
            click(awaitNode(instrumentation, "删除并停止分析"))
            awaitPrivateCleanup(database)
            awaitNode(instrumentation, "分析已暂停")

            assertThat(scheduler.getBoolean(PAUSED_KEY, false)).isTrue()
            click(awaitNode(instrumentation, "恢复分析"))
            awaitBooleanPreference(scheduler, PAUSED_KEY, false)
        } finally {
            scenario?.close()
            identity.reset()
            database.cards().clearPendingFeedback()
            database.cards().clearTrackedItems()
            database.cards().clear()
            database.close()
            onboarding.edit().putBoolean("completed", wasOnboarded).commit()
            scheduler.edit().putBoolean(PAUSED_KEY, wasPaused).commit()
        }
    }

    private suspend fun awaitSaved(
        database: cn.jianwei.data.local.JianweiDatabase,
        timeoutMillis: Long = 5_000
    ) {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        while (SystemClock.uptimeMillis() < deadline) {
            if (
                database.cards().findSavedCard(CARD_ID)?.isSaved == true &&
                database.cards().pendingFeedbackByAction(FeedbackAction.SAVE.name).size == 1
            ) return
            SystemClock.sleep(100)
        }
        error("Timed out waiting for paused save commit")
    }

    private suspend fun awaitPrivateCleanup(
        database: cn.jianwei.data.local.JianweiDatabase,
        timeoutMillis: Long = 5_000
    ) {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        while (SystemClock.uptimeMillis() < deadline) {
            if (
                database.cards().findById(CARD_ID) == null &&
                database.cards().findSavedCard(CARD_ID) == null &&
                database.cards().pendingFeedback().map { it.action } ==
                    listOf(FeedbackAction.TOO_PRIVATE.name) &&
                database.photos().isSuppressed(PRIVACY_PHOTO_ID)
            ) return
            SystemClock.sleep(100)
        }
        error("Timed out waiting for paused private cleanup")
    }

    private fun card() = CardEntity(
        cardId = CARD_ID,
        candidateToken = "candidate-paused-card-actions",
        photoUri = "",
        privacyPhotoLocalId = PRIVACY_PHOTO_ID,
        topicId = "broom",
        factId = "fact-paused-card-actions",
        title = "扫帚为什么常用成束的细条",
        detectedObjectName = "扫帚",
        body = "成束细条能增加与地面的接触点，也能顺着缝隙变形，把细小灰尘聚到一起。",
        personalContext = "你拍下过扫帚，所以今天从它讲起。",
        confidence = 0.95,
        sources = sourcesToJson(
            listOf(
                KnowledgeSource(
                    sourceId = "source-paused-card-actions",
                    title = "Broom",
                    url = "https://en.wikipedia.org/wiki/Broom",
                    publisher = "Wikipedia",
                    authority = "reference"
                )
            )
        ),
        status = "scheduled",
        scheduledDate = LocalDate.now().toString(),
        createdAtMillis = System.currentTimeMillis()
    )

    private fun click(node: AccessibilityNodeInfo) {
        val clickable = generateSequence(node) { current -> current.parent }
            .firstOrNull { current -> current.isClickable }
        assertThat(clickable).isNotNull()
        assertThat(clickable!!.performAction(AccessibilityNodeInfo.ACTION_CLICK)).isTrue()
        SystemClock.sleep(200)
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

    private fun awaitBooleanPreference(
        preferences: android.content.SharedPreferences,
        key: String,
        expected: Boolean,
        timeoutMillis: Long = 5_000
    ) {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        while (SystemClock.uptimeMillis() < deadline) {
            if (preferences.getBoolean(key, !expected) == expected) return
            SystemClock.sleep(100)
        }
        error("Timed out waiting for $key=$expected")
    }

    private fun awaitNodeWithScroll(
        instrumentation: android.app.Instrumentation,
        text: String,
        timeoutMillis: Long = 10_000
    ): AccessibilityNodeInfo = awaitNodeByScrolling(instrumentation, text, true, timeoutMillis)

    private fun awaitNodeByScrolling(
        instrumentation: android.app.Instrumentation,
        text: String,
        forward: Boolean = true,
        timeoutMillis: Long
    ): AccessibilityNodeInfo {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        var scrollForward = forward
        var swipesInDirection = 0
        while (SystemClock.uptimeMillis() < deadline) {
            findTextNode(instrumentation.uiAutomation.rootInActiveWindow, text)?.let { return it }
            val metrics = instrumentation.targetContext.resources.displayMetrics
            val centerX = metrics.widthPixels / 2
            val low = (metrics.heightPixels * 0.78f).toInt()
            val high = (metrics.heightPixels * 0.32f).toInt()
            val startY = if (scrollForward) low else high
            val endY = if (scrollForward) high else low
            instrumentation.uiAutomation.executeShellCommand(
                "input swipe $centerX $startY $centerX $endY 250"
            ).close()
            SystemClock.sleep(250)
            swipesInDirection += 1
            if (swipesInDirection == SWIPES_BEFORE_REVERSING) {
                scrollForward = !scrollForward
                swipesInDirection = 0
            }
        }
        error("Timed out scrolling to accessibility node: $text")
    }

    private fun findTextNode(root: AccessibilityNodeInfo?, text: String): AccessibilityNodeInfo? {
        if (root == null) return null
        if (root.text?.toString() == text || root.contentDescription?.toString() == text) return root
        for (index in 0 until root.childCount) {
            findTextNode(root.getChild(index), text)?.let { return it }
        }
        return null
    }

    private fun unusedApi(): JianweiApi = Proxy.newProxyInstance(
        JianweiApi::class.java.classLoader,
        arrayOf(JianweiApi::class.java)
    ) { _, method, _ -> error("Unexpected API call from paused local action test: ${method.name}") } as JianweiApi

    private companion object {
        const val CARD_ID = "card-paused-actions"
        const val PRIVACY_PHOTO_ID = 9_876_543_210L
        const val SCHEDULER_PREFS = "analysis_scheduler"
        const val PAUSED_KEY = "analysis_paused"
        const val SWIPES_BEFORE_REVERSING = 4
    }
}
