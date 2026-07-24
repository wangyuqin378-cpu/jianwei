package cn.jianwei.app

import android.content.Context
import android.content.Intent
import android.os.SystemClock
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import cn.jianwei.data.local.CardEntity
import cn.jianwei.data.local.buildJianweiDatabase
import cn.jianwei.domain.model.FeedbackAction
import com.google.common.truth.Truth.assertThat
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Test

class BetaMetricsStoreInstrumentedTest {
    @Test
    fun reportSeparatesEngagementFromCardFeedback() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
        preferences.edit().clear().commit()
        try {
            val completedAt = System.currentTimeMillis()
            val store = BetaMetricsStore(context)
            store.markOnboardingCompleted(completedAt)
            store.markFirstCardObserved(completedAt + 89_999)
            store.markWidgetObserved()

            store.markEngaged(completedAt + 90_000)
            store.markFeedback(FeedbackAction.LIKE, completedAt + 91_000)
            val saveFailure = runCatching {
                store.markFeedback(FeedbackAction.SAVE, completedAt + 92_000)
            }.exceptionOrNull()

            val report = JSONObject(store.exportJson(completedAt + 93_000))
            assertThat(saveFailure).isInstanceOf(IllegalArgumentException::class.java)
            assertThat(report.getInt("feedbackCount")).isEqualTo(1)
            assertThat(report.getInt("likeCount")).isEqualTo(1)
            assertThat(report.getBoolean("widgetAdded")).isTrue()
            assertThat(report.getLong("firstCardSeconds")).isEqualTo(89)
            assertThat(report.getString("firstEngagedAt"))
                .isEqualTo(Instant.ofEpochMilli(completedAt + 90_000).toString())
            assertThat(report.getString("apkSha256")).matches("[a-f0-9]{64}")
            assertThat(report.has("photoPath")).isFalse()
            assertThat(report.has("contentUri")).isFalse()
            assertThat(report.has("candidateToken")).isFalse()
        } finally {
            preferences.edit().clear().commit()
        }
    }

    @Test
    fun validFocusedCardMarksClickEngagement() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val metricPreferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
        val onboardingPreferences = context.getSharedPreferences("onboarding", Context.MODE_PRIVATE)
        metricPreferences.edit().clear().commit()
        onboardingPreferences.edit()
            .putBoolean("completed", true)
            .putStringSet("interests", setOf("生活设计", "物件历史", "科学原理"))
            .commit()
        val database = buildJianweiDatabase(context)
        database.cards().clear()
        database.cards().upsertAll(
            listOf(
                CardEntity(
                    cardId = FOCUSED_CARD_ID,
                    candidateToken = "beta-metric-focused-candidate",
                    photoUri = "file:///not-present-beta-metric.jpg",
                    topicId = "broom",
                    factId = "broom-001",
                    title = "扫帚",
                    detectedObjectName = "扫帚",
                    body = "扫帚的刷束排列会影响聚拢灰尘时的接触面积。",
                    personalContext = "来自你选择的照片",
                    confidence = 0.92,
                    sources = """[{"sourceId":"test-source","title":"测试来源","url":"https://example.com/source","publisher":"测试发布者","authority":"reference"}]""",
                    status = "scheduled",
                    scheduledDate = LocalDate.now(ZoneId.of("Asia/Shanghai")).toString(),
                    createdAtMillis = System.currentTimeMillis()
                )
            )
        )
        database.close()

        val scenario = ActivityScenario.launch<MainActivity>(
            Intent(context, MainActivity::class.java).apply {
                putExtra(MainActivity.EXTRA_CARD_ID, FOCUSED_CARD_ID)
            }
        )
        try {
            val engagedAt = awaitMetric(metricPreferences, "first_engaged_at")
            assertThat(engagedAt).isGreaterThan(0L)
            val report = JSONObject(BetaMetricsStore(context).exportJson())
            assertThat(report.isNull("firstEngagedAt")).isFalse()
            assertThat(report.getInt("feedbackCount")).isEqualTo(0)
            assertThat(report.getInt("likeCount")).isEqualTo(0)
        } finally {
            scenario.close()
            val cleanup = buildJianweiDatabase(context)
            cleanup.cards().clear()
            cleanup.close()
            metricPreferences.edit().clear().commit()
            onboardingPreferences.edit().clear().commit()
        }
    }

    private fun awaitMetric(
        preferences: android.content.SharedPreferences,
        key: String,
        timeoutMillis: Long = 5_000
    ): Long {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        while (SystemClock.uptimeMillis() < deadline) {
            if (preferences.contains(key)) return preferences.getLong(key, 0L)
            SystemClock.sleep(100)
        }
        error("Timed out waiting for local Beta metric: $key")
    }

    private companion object {
        const val PREFERENCES = "local_beta_metrics"
        const val FOCUSED_CARD_ID = "beta-metric-focused-card"
    }
}
