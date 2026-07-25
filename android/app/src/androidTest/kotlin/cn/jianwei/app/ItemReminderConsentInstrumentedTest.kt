package cn.jianwei.app

import android.Manifest
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Rect
import android.os.Build
import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import androidx.work.WorkManager
import cn.jianwei.data.local.CardEntity
import cn.jianwei.data.local.buildJianweiDatabase
import cn.jianwei.domain.time.ChinaCalendar
import com.google.common.truth.Truth.assertThat
import java.io.File
import java.time.LocalDate
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.runBlocking
import org.junit.Test

class ItemReminderConsentInstrumentedTest {
    @Test
    fun reminderRequiresConfirmedTimingBeforeSchedulingAndShowsHumanReadableState() = runBlocking {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val preferences = context.getSharedPreferences("onboarding", Context.MODE_PRIVATE)
        val wasOnboarded = preferences.getBoolean("completed", false)
        val database = buildJianweiDatabase(context)
        val workManager = WorkManager.getInstance(context)
        var scenario: ActivityScenario<MainActivity>? = null
        val today = ChinaCalendar.today()
        try {
            if (Build.VERSION.SDK_INT >= 33) {
                instrumentation.uiAutomation.grantRuntimePermission(
                    context.packageName,
                    Manifest.permission.POST_NOTIFICATIONS
                )
            }
            ensureItemReminderChannel(context)
            assertThat(canPostItemReminder(context)).isTrue()
            workManager.cancelUniqueWork(itemReminderWorkName(CARD_ID)).result.get(5, TimeUnit.SECONDS)
            database.cards().clear()
            preferences.edit().putBoolean("completed", true).commit()
            database.cards().upsertAll(listOf(reminderCard(today)))
            scenario = ActivityScenario.launch(MainActivity::class.java)

            click(awaitNodeWithScroll(instrumentation, "物品提醒"))
            assertThat(awaitNode(instrumentation, "为「牙刷」设复查提醒")).isNotNull()
            assertThat(awaitNode(instrumentation, "时间由你确认")).isNotNull()
            assertThat(awaitNodeWithScroll(
                instrumentation,
                "我确认以上开始使用日和复查周期"
            )).isNotNull()
            assertThat(awaitNodeWithScroll(
                instrumentation,
                "这是自定义复查提醒，不代表专业更换建议；请优先遵循产品说明或专业建议。若尚未授权，确认后再由系统请求通知权限。"
            )).isNotNull()

            val disabledConfirm = awaitNode(instrumentation, "确认并开启提醒")
            assertThat(clickableAncestorOrNull(disabledConfirm)?.isEnabled).isFalse()
            click(awaitNode(instrumentation, "我确认以上开始使用日和复查周期"))
            val enabledConfirm = awaitEnabledNodeWithScroll(instrumentation, "确认并开启提醒")
            assertThat(clickableAncestorOrNull(enabledConfirm)?.isEnabled).isTrue()

            val output = File(context.getExternalFilesDir(null), SCREENSHOT_NAME)
            output.outputStream().use { stream ->
                assertThat(
                    instrumentation.uiAutomation.takeScreenshot()
                        .compress(Bitmap.CompressFormat.PNG, 100, stream)
                ).isTrue()
            }
            assertThat(output.length()).isGreaterThan(0L)

            click(enabledConfirm)
            val tracked = awaitTrackedItem(database, CARD_ID)
            assertThat(tracked.startedOn).isEqualTo(today.toString())
            assertThat(tracked.reminderDays).isEqualTo(90)
            assertThat(awaitNodeWithScroll(instrumentation, "物品提醒已开启")).isNotNull()
            assertThat(awaitNodeWithScroll(
                instrumentation,
                "开始使用：${today.chineseDateLabelForTest()}"
            )).isNotNull()

            click(awaitEnabledNodeWithScroll(instrumentation, "更新提醒"))
            assertThat(awaitNode(instrumentation, "更新「牙刷」的复查提醒")).isNotNull()
            val disabledSave = awaitNode(instrumentation, "保存提醒")
            assertThat(clickableAncestorOrNull(disabledSave)?.isEnabled).isFalse()
            click(awaitNode(instrumentation, "取消"))
        } finally {
            scenario?.close()
            workManager.cancelUniqueWork(itemReminderWorkName(CARD_ID)).result.get(5, TimeUnit.SECONDS)
            database.cards().removeTrackedItem(CARD_ID)
            database.cards().clear()
            database.close()
            preferences.edit().putBoolean("completed", wasOnboarded).commit()
        }
    }

    private suspend fun awaitTrackedItem(
        database: cn.jianwei.data.local.JianweiDatabase,
        cardId: String
    ): cn.jianwei.data.local.TrackedItemEntity {
        repeat(100) {
            database.cards().findTrackedItem(cardId)?.let { return it }
            SystemClock.sleep(50)
        }
        error("Timed out waiting for tracked item: $cardId")
    }

    private fun reminderCard(today: LocalDate) = CardEntity(
        cardId = CARD_ID,
        candidateToken = "candidate-$CARD_ID",
        photoUri = "",
        topicId = "toothbrush",
        factId = "toothbrush-reminder-consent",
        title = "牙刷刷毛为什么会逐渐弯曲",
        detectedObjectName = "牙刷",
        body = "刷毛会在反复弯折和受力后逐渐变形，因此使用状态比固定天数更值得观察。",
        personalContext = "你拍下过牙刷，所以从它讲起。",
        confidence = 0.96,
        sources = "[]",
        status = "scheduled",
        scheduledDate = today.toString(),
        createdAtMillis = System.currentTimeMillis()
    )

    private fun click(node: AccessibilityNodeInfo) {
        val clickable = clickableAncestorOrNull(node)
        assertThat(clickable).isNotNull()
        clickable!!.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_SHOW_ON_SCREEN.id)
        SystemClock.sleep(150)
        assertThat(clickable.performAction(AccessibilityNodeInfo.ACTION_CLICK)).isTrue()
    }

    private fun clickableAncestorOrNull(node: AccessibilityNodeInfo): AccessibilityNodeInfo? =
        generateSequence(node) { current -> current.parent }
            .firstOrNull { current -> current.isClickable }

    private fun awaitNode(
        instrumentation: android.app.Instrumentation,
        text: String,
        timeoutMillis: Long = 10_000
    ): AccessibilityNodeInfo {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        while (SystemClock.uptimeMillis() < deadline) {
            findTextNode(instrumentation.uiAutomation.rootInActiveWindow, text)?.let { node ->
                if (node.isActuallyOnScreen(instrumentation)) return node
            }
            SystemClock.sleep(100)
        }
        error("Timed out waiting for accessibility node: $text")
    }

    private fun awaitNodeWithScroll(
        instrumentation: android.app.Instrumentation,
        text: String,
        timeoutMillis: Long = 12_000
    ): AccessibilityNodeInfo {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        while (SystemClock.uptimeMillis() < deadline) {
            val node = findTextNode(instrumentation.uiAutomation.rootInActiveWindow, text)
            node?.let {
                if (node.isActuallyOnScreen(instrumentation)) return node
            }
            scrollTowardNode(instrumentation, node)
            SystemClock.sleep(250)
        }
        error("Timed out scrolling to accessibility node: $text")
    }

    private fun AccessibilityNodeInfo.isActuallyOnScreen(
        instrumentation: android.app.Instrumentation
    ): Boolean {
        if (!isVisibleToUser) return false
        val bounds = Rect()
        getBoundsInScreen(bounds)
        val metrics = instrumentation.targetContext.resources.displayMetrics
        return bounds.width() > 0 &&
            bounds.height() > 0 &&
            bounds.centerX() in 0 until metrics.widthPixels &&
            bounds.centerY() in 0 until metrics.heightPixels
    }

    private fun awaitEnabledNodeWithScroll(
        instrumentation: android.app.Instrumentation,
        text: String,
        timeoutMillis: Long = 12_000
    ): AccessibilityNodeInfo {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        while (SystemClock.uptimeMillis() < deadline) {
            val node = findTextNode(instrumentation.uiAutomation.rootInActiveWindow, text)
            node?.let {
                if (clickableAncestorOrNull(node)?.isEnabled == true &&
                    node.isActuallyOnScreen(instrumentation)
                ) return node
            }
            scrollTowardNode(instrumentation, node)
            SystemClock.sleep(250)
        }
        error("Timed out waiting for enabled accessibility node: $text")
    }

    private fun scrollTowardNode(
        instrumentation: android.app.Instrumentation,
        node: AccessibilityNodeInfo?
    ) {
        val metrics = instrumentation.targetContext.resources.displayMetrics
        val centerX = metrics.widthPixels / 2
        val bounds = Rect()
        node?.getBoundsInScreen(bounds)
        val targetIsAbove = node != null && bounds.centerY() < 0
        val startY = if (targetIsAbove) 0.32f else 0.78f
        val endY = if (targetIsAbove) 0.78f else 0.32f
        instrumentation.uiAutomation.executeShellCommand(
            "input swipe $centerX ${(metrics.heightPixels * startY).toInt()} " +
                "$centerX ${(metrics.heightPixels * endY).toInt()} 250"
        ).close()
    }

    private fun findTextNode(root: AccessibilityNodeInfo?, text: String): AccessibilityNodeInfo? {
        if (root == null) return null
        if (root.text?.toString() == text) return root
        for (index in 0 until root.childCount) {
            findTextNode(root.getChild(index), text)?.let { return it }
        }
        return null
    }

    private fun LocalDate.chineseDateLabelForTest(): String =
        "$year 年 $monthValue 月 $dayOfMonth 日"

    private companion object {
        const val CARD_ID = "item-reminder-consent-card"
        const val SCREENSHOT_NAME = "item-reminder-consent.png"
    }
}
