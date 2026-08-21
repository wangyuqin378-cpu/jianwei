package cn.jianwei.app

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Rect
import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import androidx.work.WorkManager
import cn.jianwei.data.local.CardEntity
import cn.jianwei.data.local.PhotoCandidateEntity
import cn.jianwei.data.local.buildJianweiDatabase
import cn.jianwei.data.local.sourcesToJson
import cn.jianwei.data.status.SharedPreferencesAnalysisStatusRepository
import cn.jianwei.domain.model.AnalysisPhase
import cn.jianwei.domain.model.AnalysisProgress
import cn.jianwei.domain.model.AnalysisProgressScope
import cn.jianwei.domain.model.KnowledgeSource
import com.google.common.truth.Truth.assertThat
import java.io.File
import java.time.LocalDate
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlin.math.abs
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Test

class ImportedPhotoResultFlowInstrumentedTest {
    @Test
    fun pendingImportShowsCurrentPrivacyAndKnowledgeStages() = runBlocking {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val database = buildJianweiDatabase(context)
        val resultStore = PendingImportResultStore(context)
        val analysisStatus = SharedPreferencesAnalysisStatusRepository(context)
        var scenario: ActivityScenario<MainActivity>? = null
        try {
            prepareEmptyHome(context, database, resultStore)
            database.photos().upsert(candidate(analysisState = "READY"))
            resultStore.remember(listOf(CANDIDATE_TOKEN))
            analysisStatus.publishProgress(
                AnalysisProgressScope.EXPLICIT_IMPORT,
                AnalysisProgress(phase = AnalysisPhase.FILTERING)
            )

            scenario = launchMain(context)
            awaitNode(instrumentation, "第 2 / 3 步 · 本机隐私筛选")
            awaitNode(instrumentation, "正在检查这张照片")
            awaitNode(instrumentation, "正在本机检查画质和隐私；不合适的照片不会上传。")
            assertThat(progressIndicatorCount(instrumentation)).isEqualTo(1)
            screenshot(context, instrumentation, FILTERING_PROGRESS_SCREENSHOT_NAME)

            analysisStatus.publishProgress(
                AnalysisProgressScope.EXPLICIT_IMPORT,
                AnalysisProgress(phase = AnalysisPhase.SYNCING)
            )
            awaitNode(instrumentation, "第 3 / 3 步 · 识别并匹配知识")
            awaitNode(instrumentation, "正在从画面里寻找知识")
            awaitNode(
                instrumentation,
                "候选图会先去除位置等元数据，再用于识别和匹配审核过的事实。"
            )
            assertThat(progressIndicatorCount(instrumentation)).isEqualTo(1)
            screenshot(context, instrumentation, SYNCING_PROGRESS_SCREENSHOT_NAME)
            Unit
        } finally {
            scenario?.close()
            analysisStatus.publishProgress(
                AnalysisProgressScope.EXPLICIT_IMPORT,
                AnalysisProgress()
            )
            resultStore.clearAll()
            database.cards().clear()
            database.photos().clear()
            database.close()
        }
    }

    @Test
    fun missingPersistedCandidateStopsWaitingAndAsksForAFreshPhoto() = runBlocking {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val database = buildJianweiDatabase(context)
        val resultStore = PendingImportResultStore(context)
        var scenario: ActivityScenario<MainActivity>? = null
        try {
            prepareEmptyHome(context, database, resultStore)
            resultStore.remember(listOf("candidate-cleared-before-result-handoff"))

            scenario = launchMain(context)
            awaitCannotRetry(resultStore)
            awaitNode(instrumentation, "这张照片需要重新选择")
            assertThat(resultStore.snapshot().candidateTokens).isEmpty()
        } finally {
            scenario?.close()
            resultStore.clearAll()
            database.cards().clear()
            database.photos().clear()
            database.close()
        }
    }

    @Test
    fun lateResultCannotEraseANewerImportRequest() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val resultStore = PendingImportResultStore(context)
        try {
            resultStore.clearAll()
            resultStore.remember(listOf("candidate-old-request"))
            resultStore.remember(listOf("candidate-new-request"))

            assertThat(resultStore.completeIfCurrent(
                expectedCandidateTokens = listOf("candidate-old-request"),
                focusedCardId = null,
                notice = ImportedPhotoResultNotice.NO_MATCH
            )).isFalse()
            assertThat(resultStore.snapshot().candidateTokens)
                .containsExactly("candidate-new-request")
            assertThat(resultStore.snapshot().notice).isNull()
        } finally {
            resultStore.clearAll()
        }
    }

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
            val cardTitle = awaitNode(instrumentation, CARD_TITLE)
            val cardBody = awaitNode(instrumentation, CARD_BODY)
            val widgetPrompt = awaitNode(instrumentation, WIDGET_PROMPT_TITLE)
            val addToDesktop = awaitNode(instrumentation, "添加到桌面")
            val entryLabel = awaitNode(instrumentation, "刚刚从照片生成")
            val returnAction = awaitNode(instrumentation, "返回每日卡片")
            val entryBounds = boundsInScreen(entryLabel)
            val returnBounds = boundsInScreen(returnAction)
            val titleBounds = boundsInScreen(cardTitle)
            val cardBodyBounds = boundsInScreen(cardBody)
            val widgetPromptBounds = boundsInScreen(widgetPrompt)
            val windowBounds = boundsInScreen(instrumentation.uiAutomation.rootInActiveWindow)
            val entryActionCenterDeltaPx = abs(entryBounds.centerY() - returnBounds.centerY())
            assertThat(entryActionCenterDeltaPx).isLessThan(80)
            assertThat(titleBounds.top).isLessThan(windowBounds.height() * 55 / 100)
            assertThat(widgetPromptBounds.top).isAtLeast(cardBodyBounds.bottom)
            assertThat(clickableAncestorOrNull(addToDesktop)?.isEnabled).isTrue()
            assertThat(findTextNode(instrumentation.uiAutomation.rootInActiveWindow, LEGACY_ENTRY_EXPLANATION)).isNull()
            screenshot(context, instrumentation, SUCCESS_SCREENSHOT_NAME)
            File(context.getExternalFilesDir(null), LAYOUT_AUDIT_NAME).writeText(
                JSONObject()
                    .put("schemaVersion", 1)
                    .put("releaseEvidence", false)
                    .put("windowHeightPx", windowBounds.height())
                    .put("entryActionCenterDeltaPx", entryActionCenterDeltaPx)
                    .put("cardTitleTopPx", titleBounds.top)
                    .put("cardTitleTopPercent", titleBounds.top * 100.0 / windowBounds.height())
                    .put("widgetPromptTopPx", widgetPromptBounds.top)
                    .put("widgetPromptAfterCoreKnowledge", widgetPromptBounds.top >= cardBodyBounds.bottom)
                    .put("widgetPromptAvailableOnImportedResult", true)
                    .put("legacyExplanationPresent", false)
                    .toString(2)
            )
            assertThat(resultStore.snapshot().candidateTokens).isEmpty()
            assertThat(resultStore.snapshot().focusedCardId).isEqualTo(CARD_ID)
            firstScenario.close()
            firstScenario = null

            secondScenario = launchMain(context)
            awaitNode(instrumentation, CARD_TITLE)
            awaitNode(instrumentation, "刚刚从照片生成")
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
            awaitNode(instrumentation, "暂时没找到可靠知识")
            awaitNode(
                instrumentation,
                "可能是主体不够清楚、包含隐私内容，或知识库没有可靠事实。见微不会为了出卡而猜测。"
            )
            awaitNode(instrumentation, "下一张可以这样选")
            awaitNode(
                instrumentation,
                "让一个杯子、雨伞、扫帚或充电线占画面主要位置；尽量光线清楚、少文字、无人脸。"
            )
            val pickAgain = awaitNode(instrumentation, "换一张日常物品照片")
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
    fun retryableFailureStartsANewTrackedAttemptAndShowsItsCurrentState() = runBlocking {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val database = buildJianweiDatabase(context)
        val resultStore = PendingImportResultStore(context)
        var scenario: ActivityScenario<MainActivity>? = null
        try {
            prepareEmptyHome(context, database, resultStore)
            database.photos().upsert(candidate(
                localId = 902L,
                candidateToken = RETRY_CANDIDATE_TOKEN,
                sourceDigest = "import-result-retry-digest",
                analysisState = "READY"
            ))
            resultStore.complete(
                null,
                ImportedPhotoResultNotice.FAILED,
                retryCandidateTokens = listOf(RETRY_CANDIDATE_TOKEN)
            )

            scenario = launchMain(context)
            awaitNode(instrumentation, "分析暂时没有完成")
            awaitNode(
                instrumentation,
                "网络或服务暂时不可用。本机仍保留重试所需副本；如已进入云端，临时图片最长保留 24 小时。"
            )
            val retry = awaitNode(instrumentation, "立即重试")
            assertThat(clickableAncestorOrNull(retry)?.isEnabled).isTrue()
            val workManager = WorkManager.getInstance(context)
            val previousWorkIds = workManager
                .getWorkInfosForUniqueWork(IMPORTED_ANALYSIS_WORK)
                .get(5, TimeUnit.SECONDS)
                .mapTo(mutableSetOf()) { it.id }

            clickNode(instrumentation, "立即重试")
            awaitNewImportedWork(workManager, previousWorkIds)
            awaitAnyNode(
                instrumentation,
                setOf(
                    "正在读你刚选的照片",
                    "正在检查这张照片",
                    "正在从画面里寻找知识",
                    "网络暂时不稳定",
                    "分析暂时没有完成"
                )
            )
            workManager
                .cancelUniqueWork(IMPORTED_ANALYSIS_WORK)
                .result
                .get(5, TimeUnit.SECONDS)
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
    fun nonRetryableFailureAsksForAFreshPhoto() = runBlocking {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val database = buildJianweiDatabase(context)
        val resultStore = PendingImportResultStore(context)
        var scenario: ActivityScenario<MainActivity>? = null
        try {
            prepareEmptyHome(context, database, resultStore)
            resultStore.complete(null, ImportedPhotoResultNotice.CANNOT_RETRY)

            scenario = launchMain(context)
            awaitNode(instrumentation, "这张照片需要重新选择")
            awaitNode(
                instrumentation,
                "照片读取权限可能已失效，或本机处理没有完成。为保护隐私，见微没有保留可继续分析的中间文件。"
            )
            val chooseAgain = awaitNode(instrumentation, "重新选择照片")
            assertThat(clickableAncestorOrNull(chooseAgain)?.isEnabled).isTrue()
            screenshot(context, instrumentation, CANNOT_RETRY_SCREENSHOT_NAME)

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

    private fun candidate(
        localId: Long = 901L,
        candidateToken: String = CANDIDATE_TOKEN,
        sourceDigest: String = "import-result-test-digest",
        analysisState: String = "COMPLETED"
    ) = PhotoCandidateEntity(
        localId = localId,
        candidateToken = candidateToken,
        contentUri = "",
        capturedAtMillis = 1L,
        modifiedAtMillis = 1L,
        sourceDigest = sourceDigest,
        perceptualHash = 10L,
        qualityScore = 0.9,
        localLabels = listOf("broom"),
        sensitiveFlags = emptySet(),
        analysisState = analysisState,
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
        body = CARD_BODY,
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

    private fun boundsInScreen(node: AccessibilityNodeInfo): Rect =
        Rect().also(node::getBoundsInScreen)

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

    private fun progressIndicatorCount(instrumentation: android.app.Instrumentation): Int {
        fun count(node: AccessibilityNodeInfo?): Int {
            if (node == null) return 0
            var total = if (node.className?.toString() == "android.widget.ProgressBar") 1 else 0
            for (index in 0 until node.childCount) total += count(node.getChild(index))
            return total
        }
        return count(instrumentation.uiAutomation.rootInActiveWindow)
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

    private fun awaitNewImportedWork(
        workManager: WorkManager,
        previousWorkIds: Set<UUID>,
        timeoutMillis: Long = 10_000
    ) {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        while (SystemClock.uptimeMillis() < deadline) {
            val currentWork = workManager
                .getWorkInfosForUniqueWork(IMPORTED_ANALYSIS_WORK)
                .get(5, TimeUnit.SECONDS)
            if (currentWork.any { it.id !in previousWorkIds }) return
            SystemClock.sleep(100)
        }
        error("Timed out waiting for a new imported-photo analysis work request")
    }

    private fun awaitAnyNode(
        instrumentation: android.app.Instrumentation,
        texts: Set<String>,
        timeoutMillis: Long = 5_000
    ): AccessibilityNodeInfo {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        while (SystemClock.uptimeMillis() < deadline) {
            val root = instrumentation.uiAutomation.rootInActiveWindow
            texts.forEach { text ->
                findTextNode(root, text)?.let { return it }
            }
            SystemClock.sleep(100)
        }
        error("Timed out waiting for one of these accessibility nodes: $texts")
    }

    private fun awaitCannotRetry(
        store: PendingImportResultStore,
        timeoutMillis: Long = 5_000
    ) {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        while (SystemClock.uptimeMillis() < deadline) {
            if (store.snapshot().notice == ImportedPhotoResultNotice.CANNOT_RETRY) return
            SystemClock.sleep(100)
        }
        error("Timed out waiting for stale import recovery: ${store.snapshot()}")
    }

    private companion object {
        const val CANDIDATE_TOKEN = "candidate-import-result-flow"
        const val RETRY_CANDIDATE_TOKEN = "candidate-import-result-retry"
        const val CARD_ID = "card-import-result-flow"
        const val CARD_TITLE = "扫帚刷毛为什么是斜的"
        const val CARD_BODY = "扫帚刷毛的倾斜排列，更容易贴近墙角。"
        const val WIDGET_PROMPT_TITLE = "每天在桌面看一张"
        const val LEGACY_ENTRY_EXPLANATION = "下面是完整卡片；你可以核对识别对象、推荐原因和来源。"
        const val SUCCESS_SCREENSHOT_NAME = "imported-photo-success.png"
        const val LAYOUT_AUDIT_NAME = "imported-photo-entry-layout.json"
        const val NO_MATCH_SCREENSHOT_NAME = "imported-photo-no-match.png"
        const val CANNOT_RETRY_SCREENSHOT_NAME = "imported-photo-cannot-retry.png"
        const val FILTERING_PROGRESS_SCREENSHOT_NAME = "imported-photo-progress-filtering.png"
        const val SYNCING_PROGRESS_SCREENSHOT_NAME = "imported-photo-progress-syncing.png"
        const val IMPORTED_ANALYSIS_WORK = "jianwei-imported-analysis"
    }
}
