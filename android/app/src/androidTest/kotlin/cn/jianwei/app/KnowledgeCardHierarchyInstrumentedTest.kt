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
            val recognition = awaitNode(instrumentation, RECOGNITION)
            val provenance = awaitNode(instrumentation, PROVENANCE_TITLE)

            assertThat(topOf(body)).isLessThan(topOf(recognition))
            assertThat(topOf(recognition)).isLessThan(topOf(provenance))
            assertThat(awaitNode(instrumentation, "今日一知")).isNotNull()
            assertThat(awaitNode(instrumentation, PERSONAL_CONTEXT)).isNotNull()

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

    private companion object {
        const val BODY = "自行车链传动用前后不同大小的齿盘改变转速与扭矩，让骑手在速度和省力之间选择。"
        const val RECOGNITION = "识别对象：自行车 · 把握较高"
        const val PROVENANCE_TITLE = "从你的照片说起"
        const val PERSONAL_CONTEXT = "你在 2026 年 7 月 23 日拍下了「自行车」，所以今天从它讲起。"
        const val SCREENSHOT_NAME = "knowledge-card-hierarchy.png"
    }
}
