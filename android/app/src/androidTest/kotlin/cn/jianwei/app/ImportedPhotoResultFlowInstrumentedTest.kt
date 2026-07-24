package cn.jianwei.app

import android.content.Context
import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import cn.jianwei.data.local.CardEntity
import cn.jianwei.data.local.PhotoCandidateEntity
import cn.jianwei.data.local.buildJianweiDatabase
import cn.jianwei.data.local.sourcesToJson
import cn.jianwei.domain.model.KnowledgeSource
import com.google.common.truth.Truth.assertThat
import java.time.LocalDate
import kotlinx.coroutines.runBlocking
import org.junit.Test

class ImportedPhotoResultFlowInstrumentedTest {
    @Test
    fun importedCardOpensImmediatelyAndSurvivesANewActivitySession() = runBlocking {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val database = buildJianweiDatabase(context)
        val resultStore = PendingImportResultStore(context)
        var firstScenario: ActivityScenario<MainActivity>? = null
        var secondScenario: ActivityScenario<MainActivity>? = null
        try {
            database.cards().clear()
            database.photos().clear()
            resultStore.clearAll()
            context.getSharedPreferences("onboarding", Context.MODE_PRIVATE)
                .edit()
                .putBoolean("completed", true)
                .commit()
            database.photos().upsert(candidate())
            database.cards().upsertAll(listOf(card()))
            resultStore.remember(listOf(CANDIDATE_TOKEN))
            assertThat(database.cards().findById(CARD_ID)).isNotNull()
            assertThat(resultStore.snapshot().candidateTokens).containsExactly(CANDIDATE_TOKEN)

            firstScenario = ActivityScenario.launch(MainActivity::class.java)
            awaitFocusedResult(resultStore)
            awaitNode(instrumentation, CARD_TITLE)
            awaitNode(instrumentation, "打开的知识卡")
            assertThat(resultStore.snapshot().candidateTokens).isEmpty()
            assertThat(resultStore.snapshot().focusedCardId).isEqualTo(CARD_ID)
            firstScenario.close()
            firstScenario = null

            secondScenario = ActivityScenario.launch(MainActivity::class.java)
            awaitNode(instrumentation, CARD_TITLE)
            awaitNode(instrumentation, "打开的知识卡")
            clickNode(instrumentation, "返回每日卡片")
            assertThat(resultStore.snapshot().focusedCardId).isNull()
        } finally {
            firstScenario?.close()
            secondScenario?.close()
            resultStore.clearAll()
            database.cards().clear()
            database.photos().clear()
            database.close()
        }
    }

    private fun candidate() = PhotoCandidateEntity(
        localId = 901L,
        candidateToken = CANDIDATE_TOKEN,
        contentUri = "",
        capturedAtMillis = 1L,
        modifiedAtMillis = 1L,
        sourceDigest = "import-result-test-digest",
        perceptualHash = 10L,
        qualityScore = 0.9,
        localLabels = listOf("broom"),
        sensitiveFlags = emptySet(),
        analysisState = "COMPLETED",
        origin = "PHOTO_PICKER",
        width = 100,
        height = 100
    )

    private fun card() = CardEntity(
        cardId = CARD_ID,
        candidateToken = CANDIDATE_TOKEN,
        photoUri = "",
        topicId = "broom",
        factId = "broom-test-fact",
        title = CARD_TITLE,
        detectedObjectName = "扫帚",
        body = "扫帚刷毛的倾斜排列，更容易贴近墙角。",
        personalContext = "来自你刚选的照片",
        confidence = 0.95,
        sources = sourcesToJson(listOf(
            KnowledgeSource(
                sourceId = "test-source",
                title = "测试来源",
                url = "https://example.com/broom",
                publisher = "Jianwei test",
                authority = "reference"
            )
        )),
        status = "scheduled",
        scheduledDate = LocalDate.now().plusDays(10).toString(),
        createdAtMillis = 1L
    )

    private fun clickNode(instrumentation: android.app.Instrumentation, text: String) {
        val node = awaitNode(instrumentation, text)
        val clickable = generateSequence(node) { current -> current.parent }
            .firstOrNull { current -> current.isClickable }
        assertThat(clickable).isNotNull()
        assertThat(clickable!!.performAction(AccessibilityNodeInfo.ACTION_CLICK)).isTrue()
    }

    private fun awaitNode(
        instrumentation: android.app.Instrumentation,
        text: String,
        timeoutMillis: Long = 5_000
    ): AccessibilityNodeInfo {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        while (SystemClock.uptimeMillis() < deadline) {
            val root = instrumentation.uiAutomation.rootInActiveWindow
            val match = findTextNode(root, text)
            if (match != null) return match
            SystemClock.sleep(100)
        }
        val visible = buildList {
            fun collect(node: AccessibilityNodeInfo?) {
                if (node == null || size >= 40) return
                node.text?.toString()?.takeIf(String::isNotBlank)?.let(::add)
                for (index in 0 until node.childCount) collect(node.getChild(index))
            }
            collect(instrumentation.uiAutomation.rootInActiveWindow)
        }
        error("Timed out waiting for accessibility node: $text; visible=$visible")
    }

    private fun findTextNode(root: AccessibilityNodeInfo?, text: String): AccessibilityNodeInfo? {
        if (root == null) return null
        if (root.text?.toString() == text) return root
        for (index in 0 until root.childCount) {
            findTextNode(root.getChild(index), text)?.let { return it }
        }
        return null
    }

    private fun awaitFocusedResult(
        store: PendingImportResultStore,
        timeoutMillis: Long = 5_000
    ) {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        while (SystemClock.uptimeMillis() < deadline) {
            if (store.snapshot().focusedCardId == CARD_ID) return
            SystemClock.sleep(100)
        }
        error("Timed out waiting for persisted import result: ${store.snapshot()}")
    }

    private companion object {
        const val CANDIDATE_TOKEN = "candidate-import-result-flow"
        const val CARD_ID = "card-import-result-flow"
        const val CARD_TITLE = "扫帚刷毛为什么是斜的"
    }
}
