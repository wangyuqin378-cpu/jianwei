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
import java.time.LocalDate
import kotlinx.coroutines.runBlocking
import org.junit.Test

class SettingsNavigationInstrumentedTest {
    @Test
    fun settingsStaySeparateAndPersistentNavigationReturnsToDailyContent() = runBlocking {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val database = buildJianweiDatabase(context)
        val preferences = context.getSharedPreferences("onboarding", Context.MODE_PRIVATE)
        val schedulerPreferences = context.getSharedPreferences("analysis_scheduler", Context.MODE_PRIVATE)
        val wasOnboarded = preferences.getBoolean("completed", false)
        val previousMode = schedulerPreferences.getString(AUTOMATIC_CARD_MODE_KEY, null)
        var scenario: ActivityScenario<MainActivity>? = null
        try {
            database.cards().clear()
            preferences.edit().putBoolean("completed", true).commit()
            schedulerPreferences.edit().remove(AUTOMATIC_CARD_MODE_KEY).commit()
            database.cards().upsertAll(listOf(todayCard()))

            scenario = ActivityScenario.launch(MainActivity::class.java)
            assertThat(awaitSelectedNode(instrumentation, "每日卡片").isSelected).isTrue()
            assertThat(awaitTextNode(instrumentation, TODAY_TITLE)).isNotNull()
            assertThat(findTextNode(
                instrumentation.uiAutomation.rootInActiveWindow,
                "你的推荐偏好"
            )).isNull()

            click(awaitNode(instrumentation, "设置与隐私"))
            assertThat(awaitSelectedNode(instrumentation, "设置与隐私").isSelected).isTrue()
            assertThat(awaitTextNode(instrumentation, "设置与隐私")).isNotNull()
            assertThat(awaitTextNode(instrumentation, "照片处理节奏")).isNotNull()
            assertThat(awaitDescriptionPrefix(instrumentation, "提前准备（推荐）。").stateDescription)
                .isEqualTo("已选择")
            click(awaitDescriptionPrefix(instrumentation, "每天一张。"))
            assertThat(awaitDescriptionPrefixWithState(
                instrumentation,
                "每天一张。",
                "已选择"
            ).stateDescription).isEqualTo("已选择")
            assertThat(schedulerPreferences.getString(AUTOMATIC_CARD_MODE_KEY, null))
                .isEqualTo("DAILY_ONE")
            screenshot(context, instrumentation, SETTINGS_SCREENSHOT_NAME)
            requireNotNull(scenario).recreate()
            assertThat(awaitSelectedNode(instrumentation, "设置与隐私").isSelected).isTrue()
            assertThat(awaitDescriptionPrefixWithState(
                instrumentation,
                "每天一张。",
                "已选择"
            ).stateDescription).isEqualTo("已选择")
            assertThat(awaitTextNodeWithScroll(instrumentation, "你的推荐偏好")).isNotNull()
            assertThat(findTextNode(
                instrumentation.uiAutomation.rootInActiveWindow,
                TODAY_TITLE
            )).isNull()

            assertThat(awaitTextNodeWithScroll(instrumentation, "你的数据与隐私")).isNotNull()
            click(awaitTextNodeWithScroll(instrumentation, "管理隐私与数据"))
            assertThat(awaitTextNodeWithScroll(instrumentation, "导出内测报告")).isNotNull()
            val persistentDailyTab = awaitVisibleNode(instrumentation, "每日卡片")
            click(persistentDailyTab)
            assertThat(awaitSelectedNode(instrumentation, "每日卡片").isSelected).isTrue()
            assertThat(awaitTextNode(instrumentation, TODAY_TITLE)).isNotNull()

            click(awaitNode(instrumentation, "设置与隐私"))
            assertThat(awaitSelectedNode(instrumentation, "设置与隐私").isSelected).isTrue()
            assertThat(awaitTextNode(instrumentation, "导出内测报告")).isNotNull()
            instrumentation.uiAutomation.executeShellCommand("input keyevent KEYCODE_BACK").close()
            assertThat(awaitSelectedNode(instrumentation, "每日卡片").isSelected).isTrue()
            assertThat(awaitTextNode(instrumentation, TODAY_TITLE)).isNotNull()
            assertThat(database.cards().findById(TODAY_CARD_ID)?.cardId).isEqualTo(TODAY_CARD_ID)
        } finally {
            scenario?.close()
            database.cards().clear()
            database.close()
            preferences.edit().putBoolean("completed", wasOnboarded).commit()
            schedulerPreferences.edit().apply {
                if (previousMode == null) remove(AUTOMATIC_CARD_MODE_KEY)
                else putString(AUTOMATIC_CARD_MODE_KEY, previousMode)
            }.commit()
        }
    }

    private fun todayCard() = CardEntity(
        cardId = TODAY_CARD_ID,
        candidateToken = "candidate-$TODAY_CARD_ID",
        photoUri = "",
        topicId = "cup",
        factId = "fact-$TODAY_CARD_ID",
        title = TODAY_TITLE,
        detectedObjectName = "杯子",
        body = "杯把让手指与高温杯壁保持距离，也为抓握提供稳定的受力位置。",
        personalContext = "你今天拍下了杯子，所以今天从它讲起。",
        confidence = 0.95,
        sources = sourcesToJson(
            listOf(
                KnowledgeSource(
                    sourceId = "source-$TODAY_CARD_ID",
                    title = "Cup",
                    url = "https://en.wikipedia.org/wiki/Cup",
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

    private fun click(node: AccessibilityNodeInfo) {
        val clickable = generateSequence(node) { current -> current.parent }
            .firstOrNull { current -> current.isClickable }
        assertThat(clickable).isNotNull()
        assertThat(clickable!!.performAction(AccessibilityNodeInfo.ACTION_CLICK)).isTrue()
        SystemClock.sleep(200)
    }

    private fun awaitNode(
        instrumentation: android.app.Instrumentation,
        value: String,
        timeoutMillis: Long = 10_000
    ): AccessibilityNodeInfo = awaitMatchingNode(instrumentation, timeoutMillis) { root ->
        findNode(root, value)
    }

    private fun awaitVisibleNode(
        instrumentation: android.app.Instrumentation,
        value: String,
        timeoutMillis: Long = 10_000
    ): AccessibilityNodeInfo = awaitMatchingNode(instrumentation, timeoutMillis) { root ->
        findNode(root, value)?.takeIf { it.isVisibleToUser }
    }

    private fun awaitSelectedNode(
        instrumentation: android.app.Instrumentation,
        value: String,
        timeoutMillis: Long = 10_000
    ): AccessibilityNodeInfo = awaitMatchingNode(instrumentation, timeoutMillis) { root ->
        findNode(root, value)?.takeIf { it.isSelected }
    }

    private fun awaitTextNode(
        instrumentation: android.app.Instrumentation,
        text: String,
        timeoutMillis: Long = 10_000
    ): AccessibilityNodeInfo = awaitMatchingNode(instrumentation, timeoutMillis) { root ->
        findTextNode(root, text)
    }

    private fun awaitDescriptionPrefix(
        instrumentation: android.app.Instrumentation,
        prefix: String,
        timeoutMillis: Long = 10_000
    ): AccessibilityNodeInfo = awaitMatchingNode(instrumentation, timeoutMillis) { root ->
        findDescriptionPrefix(root, prefix)
    }

    private fun awaitDescriptionPrefixWithState(
        instrumentation: android.app.Instrumentation,
        prefix: String,
        state: String,
        timeoutMillis: Long = 10_000
    ): AccessibilityNodeInfo = awaitMatchingNode(instrumentation, timeoutMillis) { root ->
        findDescriptionPrefix(root, prefix)?.takeIf { it.stateDescription?.toString() == state }
    }

    private fun awaitTextNodeWithScroll(
        instrumentation: android.app.Instrumentation,
        text: String,
        timeoutMillis: Long = 10_000
    ): AccessibilityNodeInfo {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        while (SystemClock.uptimeMillis() < deadline) {
            findTextNode(instrumentation.uiAutomation.rootInActiveWindow, text)?.let { return it }
            swipeForward(instrumentation)
        }
        error("Timed out scrolling to text node: $text")
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

    private fun awaitMatchingNode(
        instrumentation: android.app.Instrumentation,
        timeoutMillis: Long,
        finder: (AccessibilityNodeInfo?) -> AccessibilityNodeInfo?
    ): AccessibilityNodeInfo {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        while (SystemClock.uptimeMillis() < deadline) {
            finder(instrumentation.uiAutomation.rootInActiveWindow)?.let { return it }
            SystemClock.sleep(100)
        }
        error(
            "Timed out waiting for accessibility node; visible=" +
                visibleNodeSummary(instrumentation.uiAutomation.rootInActiveWindow)
        )
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

    private fun findDescriptionPrefix(root: AccessibilityNodeInfo?, prefix: String): AccessibilityNodeInfo? {
        if (root == null) return null
        if (root.contentDescription?.toString()?.startsWith(prefix) == true) return root
        for (index in 0 until root.childCount) {
            findDescriptionPrefix(root.getChild(index), prefix)?.let { return it }
        }
        return null
    }

    private fun visibleNodeSummary(root: AccessibilityNodeInfo?): List<String> = buildList {
        fun collect(node: AccessibilityNodeInfo?) {
            if (node == null || size >= 60) return
            val text = node.text?.toString().orEmpty()
            val description = node.contentDescription?.toString().orEmpty()
            if (text.isNotBlank() || description.isNotBlank() || node.isSelected) {
                add("text=$text desc=$description selected=${node.isSelected} state=${node.stateDescription}")
            }
            for (index in 0 until node.childCount) collect(node.getChild(index))
        }
        collect(root)
    }

    private companion object {
        const val TODAY_CARD_ID = "settings-navigation-today"
        const val TODAY_TITLE = "杯子把手为什么留出一个圆环"
        const val SETTINGS_SCREENSHOT_NAME = "settings-overview.png"
        const val AUTOMATIC_CARD_MODE_KEY = "automatic_card_mode"
    }
}
