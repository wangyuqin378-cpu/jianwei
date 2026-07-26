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
import cn.jianwei.domain.time.ChinaCalendar
import com.google.common.truth.Truth.assertThat
import java.io.File
import java.time.LocalDate
import kotlinx.coroutines.runBlocking
import org.junit.Test

class DailyHistoryNavigationInstrumentedTest {
    @Test
    fun todayStaysFullWhileHistoryUsesCompactCardsAndReturnsToItsPosition() = runBlocking {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val database = buildJianweiDatabase(context)
        val preferences = context.getSharedPreferences("onboarding", Context.MODE_PRIVATE)
        val wasOnboarded = preferences.getBoolean("completed", false)
        val today = ChinaCalendar.today()
        var scenario: ActivityScenario<MainActivity>? = null
        try {
            database.cards().clear()
            preferences.edit().putBoolean("completed", true).commit()
            database.cards().upsertAll(
                listOf(
                    card(
                        cardId = "daily-history-today",
                        title = "杯子把手为什么留出一个圆环",
                        objectName = "杯子",
                        body = TODAY_BODY,
                        personalContext = "你今天拍下了杯子，所以今天从它讲起。",
                        scheduledDate = today
                    ),
                    card(
                        cardId = HISTORY_CARD_ID,
                        title = HISTORY_TITLE,
                        objectName = "雨伞",
                        body = "弧形伞面会让雨水更快向边缘流动，也为伞骨留下受力空间。",
                        personalContext = HISTORY_CONTEXT,
                        scheduledDate = today.minusDays(1)
                    ),
                    card(
                        cardId = "daily-history-older",
                        title = "拉链为什么能反复咬合",
                        objectName = "拉链",
                        body = "交错的链牙借助拉头改变进入角度，从而依次扣合或分离。",
                        personalContext = "你前天拍下了拉链，所以从它讲起。",
                        scheduledDate = today.minusDays(2)
                    )
                )
            )

            scenario = ActivityScenario.launch(MainActivity::class.java)
            assertThat(awaitNodeWithScroll(instrumentation, TODAY_BODY)).isNotNull()
            assertThat(awaitNodeWithScroll(instrumentation, HISTORY_SECTION_DESCRIPTION)).isNotNull()
            val historyEntry = awaitNodeWithScroll(
                instrumentation,
                "打开往日知识卡：$HISTORY_TITLE"
            )
            assertThat(historyEntry.isClickable || clickableAncestorOrNull(historyEntry) != null).isTrue()
            assertThat(findNode(instrumentation.uiAutomation.rootInActiveWindow, HISTORY_CONTEXT)).isNull()

            screenshot(context, instrumentation, COLLECTION_SCREENSHOT_NAME)
            click(
                awaitNodeWithScroll(
                    instrumentation,
                    "打开往日知识卡：$HISTORY_TITLE"
                )
            )
            assertThat(awaitNode(instrumentation, "从往日一知打开")).isNotNull()
            assertThat(awaitNode(instrumentation, "返回每日卡片")).isNotNull()
            assertThat(awaitNodeWithScroll(instrumentation, HISTORY_CONTEXT)).isNotNull()
            assertThat(
                awaitNodeWithScroll(
                    instrumentation,
                    "查看来源：Wikipedia，Everyday object design"
                )
            ).isNotNull()
            assertThat(awaitNodeWithScroll(instrumentation, "来源 · Wikipedia")).isNotNull()
            assertThat(awaitNodeWithScroll(instrumentation, "Everyday object design")).isNotNull()
            screenshot(context, instrumentation, DETAIL_SCREENSHOT_NAME)
            instrumentation.uiAutomation.executeShellCommand("input keyevent 4").close()
            assertThat(awaitNode(instrumentation, HISTORY_TITLE)).isNotNull()
            assertThat(database.cards().findById(HISTORY_CARD_ID)?.cardId).isEqualTo(HISTORY_CARD_ID)
        } finally {
            scenario?.close()
            database.cards().clear()
            database.close()
            preferences.edit().putBoolean("completed", wasOnboarded).commit()
        }
    }

    private fun card(
        cardId: String,
        title: String,
        objectName: String,
        body: String,
        personalContext: String,
        scheduledDate: LocalDate
    ) = CardEntity(
        cardId = cardId,
        candidateToken = "candidate-$cardId",
        photoUri = "",
        topicId = objectName,
        factId = "fact-$cardId",
        title = title,
        detectedObjectName = objectName,
        body = body,
        personalContext = personalContext,
        confidence = 0.95,
        sources = sourcesToJson(
            listOf(
                KnowledgeSource(
                    sourceId = "source-$cardId",
                    title = "Everyday object design",
                    url = "https://en.wikipedia.org/wiki/Umbrella",
                    publisher = "Wikipedia",
                    authority = "reference"
                )
            )
        ),
        status = "scheduled",
        scheduledDate = scheduledDate.toString(),
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

    private fun click(node: AccessibilityNodeInfo) {
        val clickable = clickableAncestorOrNull(node) ?: node.takeIf { it.isClickable }
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
        value: String,
        timeoutMillis: Long = 10_000
    ): AccessibilityNodeInfo {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        while (SystemClock.uptimeMillis() < deadline) {
            findNode(instrumentation.uiAutomation.rootInActiveWindow, value)?.let { node ->
                if (node.isActuallyOnScreen(instrumentation)) return node
            }
            SystemClock.sleep(100)
        }
        error("Timed out waiting for accessibility node: $value")
    }

    private fun awaitNodeWithScroll(
        instrumentation: android.app.Instrumentation,
        value: String,
        timeoutMillis: Long = 12_000
    ): AccessibilityNodeInfo {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        while (SystemClock.uptimeMillis() < deadline) {
            val node = findNode(instrumentation.uiAutomation.rootInActiveWindow, value)
            node?.let {
                if (node.isActuallyOnScreen(instrumentation)) return node
            }
            scrollTowardNode(instrumentation, node)
            SystemClock.sleep(250)
        }
        error(
            "Timed out scrolling to accessibility node: $value; visible=" +
                visibleText(instrumentation.uiAutomation.rootInActiveWindow) +
                "; matches=" + describeMatchingNodes(
                    instrumentation.uiAutomation.rootInActiveWindow,
                    value
                )
        )
    }

    private fun AccessibilityNodeInfo.isActuallyOnScreen(
        instrumentation: android.app.Instrumentation
    ): Boolean {
        if (!isVisibleToUser) return false
        val bounds = Rect()
        getBoundsInScreen(bounds)
        val windowBounds = Rect().also { visibleBounds ->
            instrumentation.uiAutomation.rootInActiveWindow?.getBoundsInScreen(visibleBounds)
        }
        return bounds.width() > 0 &&
            bounds.height() > 0 &&
            windowBounds.contains(bounds.centerX(), bounds.centerY())
    }

    private fun scrollTowardNode(
        instrumentation: android.app.Instrumentation,
        node: AccessibilityNodeInfo?
    ) {
        if (
            node != null &&
            node.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_SHOW_ON_SCREEN.id)
        ) return

        val bounds = Rect()
        node?.getBoundsInScreen(bounds)
        val targetIsAbove = node != null && bounds.bottom <= 0
        val metrics = instrumentation.targetContext.resources.displayMetrics
        val startY = if (targetIsAbove) 0.52f else 0.68f
        val endY = if (targetIsAbove) 0.68f else 0.52f
        val centerX = metrics.widthPixels / 2
        instrumentation.uiAutomation.executeShellCommand(
            "input swipe $centerX ${(metrics.heightPixels * startY).toInt()} " +
                "$centerX ${(metrics.heightPixels * endY).toInt()} 250"
        ).close()
    }

    private fun findNode(root: AccessibilityNodeInfo?, value: String): AccessibilityNodeInfo? {
        if (root == null) return null
        val text = root.text?.toString().orEmpty()
        val description = root.contentDescription?.toString().orEmpty()
        if (text == value || description == value || text.contains(value) || description.contains(value)) {
            return root
        }
        for (index in 0 until root.childCount) {
            findNode(root.getChild(index), value)?.let { return it }
        }
        return null
    }

    private fun visibleText(root: AccessibilityNodeInfo?): List<String> = buildList {
        fun collect(node: AccessibilityNodeInfo?) {
            if (node == null || size >= 60) return
            node.text?.toString()?.takeIf(String::isNotBlank)?.let(::add)
            node.contentDescription
                ?.toString()
                ?.takeIf(String::isNotBlank)
                ?.let(::add)
            for (index in 0 until node.childCount) collect(node.getChild(index))
        }
        collect(root)
    }

    private fun describeMatchingNodes(
        root: AccessibilityNodeInfo?,
        value: String
    ): List<String> = buildList {
        fun collect(node: AccessibilityNodeInfo?) {
            if (node == null || size >= 12) return
            val text = node.text?.toString().orEmpty()
            val description = node.contentDescription?.toString().orEmpty()
            if (text.contains(value) || description.contains(value)) {
                val bounds = Rect().also(node::getBoundsInScreen)
                add("bounds=$bounds visible=${node.isVisibleToUser}")
            }
            for (index in 0 until node.childCount) collect(node.getChild(index))
        }
        collect(root)
    }

    private companion object {
        const val HISTORY_CARD_ID = "daily-history-yesterday"
        const val HISTORY_TITLE = "雨伞为什么有弧形伞面"
        const val HISTORY_CONTEXT = "你昨天拍下了雨伞，所以今天从它讲起。"
        const val HISTORY_SECTION_DESCRIPTION =
            "过去的 2 张卡片收在这里。点开可查看来源、提醒和反馈。"
        const val TODAY_BODY = "杯把让手指与高温杯壁保持距离，也为抓握提供稳定的受力位置。"
        const val COLLECTION_SCREENSHOT_NAME = "daily-history-collection.png"
        const val DETAIL_SCREENSHOT_NAME = "daily-history-detail.png"
    }
}
