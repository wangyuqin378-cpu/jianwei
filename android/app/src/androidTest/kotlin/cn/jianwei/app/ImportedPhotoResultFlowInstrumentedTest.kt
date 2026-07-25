package cn.jianwei.app

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
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
import java.io.File
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

            firstScenario = launchMain(context)
            awaitFocusedResult(resultStore)
            awaitNode(instrumentation, CARD_TITLE)
            awaitNode(instrumentation, "从你刚选的照片找到了知识")
            awaitNode(instrumentation, "下面是完整卡片；你可以核对识别对象、推荐原因和来源。")
            screenshot(context, instrumentation, SUCCESS_SCREENSHOT_NAME)
            assertThat(resultStore.snapshot().candidateTokens).isEmpty()
            assertThat(resultStore.snapshot().focusedCardId).isEqualTo(CARD_ID)
            firstScenario.close()
            firstScenario = null

            secondScenario = launchMain(context)
            awaitNode(instrumentation, CARD_TITLE)
            awaitNode(instrumentation, "从你刚选的照片找到了知识")
            clickNode(instrumentation, "返回每日卡片")
            awaitResultCleared(resultStore, clearFocusedCard = true)
        } finally {
            firstScenario?.close()
            secondScenario?.close()
            resultStore.clearAll()
            database.cards().clear()
            database.photos().clear()
            database.close()
        }
    }

    @Test
    fun noMatchExplainsWhyAndOffersAnotherPhoto() = runBlocking {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val database = buildJianweiDatabase(context)
        val resultStore = PendingImportResultStore(context)
        var scenario: ActivityScenario<MainActivity>? = null
        try {
            prepareEmptyHome(context, database, resultStore)
            resultStore.complete(null, ImportedPhotoResultNotice.NO_MATCH)

            scenario = launchMain(context)
            awaitNode(instrumentation, "这张照片暂时没有合适的知识")
            awaitNode(
                instrumentation,
                "它可能因隐私、画质或暂时没有可靠知识而被跳过。见微不会为了出卡而猜测。"
            )
            val pickAgain = awaitNode(instrumentation, "换一张照片")
            assertThat(clickableAncestorOrNull(pickAgain)?.isEnabled).isTrue()
            screenshot(context, instrumentation, NO_MATCH_SCREENSHOT_NAME)

            clickNode(instrumentation, "回到每日卡片")
            awaitResultCleared(resultStore)
            awaitNode(instrumentation, "适合开始的照片")
            Unit
        } finally {
            scenario?.close()
            resultStore.clearAll()
            database.cards().clear()
            database.photos().clear()
            database.close()
        }
    }

    @Test
    fun failedAnalysisOffersAnExplicitRetryWithoutPretendingThereIsAResult() = runBlocking {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val database = buildJianweiDatabase(context)
        val resultStore = PendingImportResultStore(context)
        var scenario: ActivityScenario<MainActivity>? = null
        try {
            prepareEmptyHome(context, database, resultStore)
            resultStore.complete(null, ImportedPhotoResultNotice.FAILED)

            scenario = launchMain(context)
            awaitNode(instrumentation, "分析暂时没有完成")
            awaitNode(
                instrumentation,
                "网络或服务暂时不可用。你可以立即重试，也可以稍后再回来。"
            )
            val retry = awaitNode(instrumentation, "立即重试")
            assertThat(clickableAncestorOrNull(retry)?.isEnabled).isTrue()
            screenshot(context, instrumentation, FAILED_SCREENSHOT_NAME)

            clickNode(instrumentation, "回到每日卡片")
            awaitResultCleared(resultStore)
            awaitNode(instrumentation, "适合开始的照片")
            Unit
        } finally {
            scenario?.close()
            resultStore.clearAll()
            database.cards().clear()
            database.photos().clear()
            database.close()
        }
    }

    private fun launchMain(context: Context): ActivityScenario<MainActivity> =
        ActivityScenario.launch(
            Intent(context, MainActivity::class.java).addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
            )
        )

    private suspend fun prepareEmptyHome(
        context: Context,
        database: cn.jianwei.data.local.JianweiDatabase,
        resultStore: PendingImportResultStore
    ) {
        database.cards().clear()
        database.photos().clear()
        resultStore.clearAll()
        context.getSharedPreferences("onboarding", Context.MODE_PRIVATE)
            .edit()
            .putBoolean("completed", true)
            .commit()
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
        val clickable = clickableAncestorOrNull(node)
        assertThat(clickable).isNotNull()
        assertThat(clickable!!.performAction(AccessibilityNodeInfo.ACTION_CLICK)).isTrue()
    }

    private fun clickableAncestorOrNull(node: AccessibilityNodeInfo): AccessibilityNodeInfo? =
        generateSequence(node) { current -> current.parent }
            .firstOrNull { current -> current.isClickable }

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

    private fun awaitResultCleared(
        store: PendingImportResultStore,
        clearFocusedCard: Boolean = false,
        timeoutMillis: Long = 5_000
    ) {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        while (SystemClock.uptimeMillis() < deadline) {
            val snapshot = store.snapshot()
            if (snapshot.notice == null && (!clearFocusedCard || snapshot.focusedCardId == null)) return
            SystemClock.sleep(100)
        }
        error("Timed out waiting for import result to clear: ${store.snapshot()}")
    }

    private companion object {
        const val CANDIDATE_TOKEN = "candidate-import-result-flow"
        const val CARD_ID = "card-import-result-flow"
        const val CARD_TITLE = "扫帚刷毛为什么是斜的"
        const val SUCCESS_SCREENSHOT_NAME = "imported-photo-success.png"
        const val NO_MATCH_SCREENSHOT_NAME = "imported-photo-no-match.png"
        const val FAILED_SCREENSHOT_NAME = "imported-photo-failed.png"
    }
}
