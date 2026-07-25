package cn.jianwei.app

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import cn.jianwei.data.local.CardEntity
import cn.jianwei.data.local.JianweiDatabase
import cn.jianwei.data.local.TrackedItemEntity
import cn.jianwei.data.local.buildJianweiDatabase
import cn.jianwei.data.local.sourcesToJson
import cn.jianwei.domain.model.KnowledgeSource
import com.google.common.truth.Truth.assertThat
import java.io.File
import java.time.LocalDate
import kotlinx.coroutines.runBlocking
import org.junit.Test

class WrongObjectConfirmationInstrumentedTest {
    @Test
    fun wrongObjectRequiresConfirmationBeforeRemovingCardState() = runBlocking {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val preferences = context.getSharedPreferences("onboarding", Context.MODE_PRIVATE)
        val wasOnboarded = preferences.getBoolean("completed", false)
        val database = buildJianweiDatabase(context)
        val importResults = PendingImportResultStore(context)
        var scenario: ActivityScenario<MainActivity>? = null
        try {
            database.cards().clearPendingFeedback()
            database.cards().clearTrackedItems()
            database.cards().clear()
            importResults.clearAll()
            preferences.edit().putBoolean("completed", true).commit()
            val now = System.currentTimeMillis()
            database.cards().upsertAll(listOf(card(now)))
            database.cards().setCardSaved(CARD_ID, true, now + 1)
            database.cards().upsertTrackedItem(
                TrackedItemEntity(
                    cardId = CARD_ID,
                    startedOn = LocalDate.now().minusDays(5).toString(),
                    reminderDays = 30,
                    syncAction = "UPSERT",
                    updatedAtMillis = now + 2
                )
            )

            scenario = ActivityScenario.launch(
                Intent(context, MainActivity::class.java).addFlags(
                    Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
                )
            )
            click(awaitNodeWithScroll(instrumentation, "识错了"))
            awaitNode(instrumentation, DIALOG_TITLE)
            awaitNode(instrumentation, DIALOG_BODY)
            awaitNode(instrumentation, "确认识错并隐藏")
            screenshot(context, instrumentation, DIALOG_SCREENSHOT_NAME)

            assertCardStateIsUntouched(database)
            click(awaitNode(instrumentation, "保留卡片"))
            awaitNodeWithScroll(instrumentation, "这条知识怎么样？")
            assertCardStateIsUntouched(database)

            click(awaitNodeWithScroll(instrumentation, "识错了"))
            awaitNode(instrumentation, DIALOG_TITLE)
            click(awaitNode(instrumentation, "确认识错并隐藏"))
            awaitWrongObjectCommitted(database)
            awaitNodeWithBackwardScroll(instrumentation, "适合开始的照片")
            screenshot(context, instrumentation, RESULT_SCREENSHOT_NAME)
        } finally {
            scenario?.close()
            importResults.clearAll()
            database.cards().clearPendingFeedback()
            database.cards().clearTrackedItems()
            database.cards().clear()
            database.close()
            preferences.edit().putBoolean("completed", wasOnboarded).commit()
        }
    }

    private suspend fun assertCardStateIsUntouched(
        database: JianweiDatabase
    ) {
        assertThat(database.cards().findById(CARD_ID)?.status).isEqualTo("scheduled")
        assertThat(database.cards().findSavedCard(CARD_ID)?.isSaved).isTrue()
        assertThat(database.cards().findTrackedItem(CARD_ID)?.syncAction).isEqualTo("UPSERT")
        assertThat(database.cards().pendingFeedbackByAction("WRONG_OBJECT")).isEmpty()
    }

    private suspend fun awaitWrongObjectCommitted(
        database: JianweiDatabase,
        timeoutMillis: Long = 5_000
    ) {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        while (SystemClock.uptimeMillis() < deadline) {
            val card = database.cards().findById(CARD_ID)
            val saved = database.cards().findSavedCard(CARD_ID)
            val tracked = database.cards().findTrackedItem(CARD_ID)
            val wrongFeedback = database.cards().pendingFeedbackByAction("WRONG_OBJECT")
            val staleSave = database.cards().pendingFeedbackByAction("SAVE")
            if (
                card?.status == "archived" &&
                saved == null &&
                tracked?.syncAction == "DELETE" &&
                wrongFeedback.size == 1 &&
                staleSave.isEmpty()
            ) return
            SystemClock.sleep(100)
        }
        error(
            "Timed out waiting for wrong-object commit: " +
                "card=${database.cards().findById(CARD_ID)}, " +
                "saved=${database.cards().findSavedCard(CARD_ID)}, " +
                "tracked=${database.cards().findTrackedItem(CARD_ID)}, " +
                "wrong=${database.cards().pendingFeedbackByAction("WRONG_OBJECT")}, " +
                "save=${database.cards().pendingFeedbackByAction("SAVE")}"
        )
    }

    private fun card(now: Long) = CardEntity(
        cardId = CARD_ID,
        candidateToken = "candidate-wrong-object-confirmation",
        photoUri = "",
        topicId = "bicycle",
        factId = "fact-wrong-object-confirmation",
        title = "自行车的链条为什么连接两组齿盘",
        detectedObjectName = "自行车",
        body = "不同大小的齿盘会改变转速与扭矩，让骑行者在速度和省力之间选择。",
        personalContext = "你拍下过自行车，所以从它讲起。",
        confidence = 0.95,
        sources = sourcesToJson(
            listOf(
                KnowledgeSource(
                    sourceId = "source-wrong-object-confirmation",
                    title = "Bicycle gearing",
                    url = "https://en.wikipedia.org/wiki/Bicycle_gearing",
                    publisher = "Wikipedia",
                    authority = "reference"
                )
            )
        ),
        status = "scheduled",
        scheduledDate = LocalDate.now().toString(),
        createdAtMillis = now
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
            swipe(instrumentation, forward = true)
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
            swipe(instrumentation, forward = false)
        }
        error("Timed out scrolling backward to accessibility node: $text")
    }

    private fun swipe(instrumentation: android.app.Instrumentation, forward: Boolean) {
        val metrics = instrumentation.targetContext.resources.displayMetrics
        val centerX = metrics.widthPixels / 2
        val low = (metrics.heightPixels * 0.78f).toInt()
        val high = (metrics.heightPixels * 0.32f).toInt()
        val startY = if (forward) low else high
        val endY = if (forward) high else low
        instrumentation.uiAutomation.executeShellCommand(
            "input swipe $centerX $startY $centerX $endY 250"
        ).close()
        SystemClock.sleep(250)
    }

    private fun screenshot(
        context: Context,
        instrumentation: android.app.Instrumentation,
        name: String
    ) {
        SystemClock.sleep(300)
        val output = File(context.getExternalFilesDir(null), name)
        output.outputStream().use { stream ->
            assertThat(
                instrumentation.uiAutomation.takeScreenshot()
                    .compress(Bitmap.CompressFormat.PNG, 100, stream)
            ).isTrue()
        }
        assertThat(output.length()).isGreaterThan(0L)
    }

    private fun findTextNode(root: AccessibilityNodeInfo?, text: String): AccessibilityNodeInfo? {
        if (root == null) return null
        if (root.text?.toString() == text || root.contentDescription?.toString() == text) return root
        for (index in 0 until root.childCount) {
            findTextNode(root.getChild(index), text)?.let { return it }
        }
        return null
    }

    private companion object {
        const val CARD_ID = "card-wrong-object-confirmation"
        const val DIALOG_TITLE = "确认这张卡识错了？"
        const val DIALOG_BODY =
            "确认后会隐藏这张卡、取消它的收藏和物品提醒，并把“识错了”同步给见微。这个判断不会作为兴趣信号。"
        const val DIALOG_SCREENSHOT_NAME = "wrong-object-confirmation.png"
        const val RESULT_SCREENSHOT_NAME = "wrong-object-confirmed-result.png"
    }
}
