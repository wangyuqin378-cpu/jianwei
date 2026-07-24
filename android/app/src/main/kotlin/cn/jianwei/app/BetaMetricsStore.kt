package cn.jianwei.app

import android.content.Context
import android.os.Build
import androidx.core.content.edit
import cn.jianwei.domain.model.FeedbackAction
import cn.jianwei.domain.model.isCardFeedback
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.File
import java.security.MessageDigest
import java.time.Instant
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class BetaMetricsStore @Inject constructor(@ApplicationContext context: Context) {
    private val appContext = context.applicationContext
    private val preferences = appContext.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

    init {
        val now = System.currentTimeMillis()
        preferences.edit {
            if (!preferences.contains(KEY_EVIDENCE_ID)) putString(KEY_EVIDENCE_ID, UUID.randomUUID().toString())
            if (!preferences.contains(KEY_ONBOARDING_STARTED)) putLong(KEY_ONBOARDING_STARTED, now)
        }
    }

    fun markOnboardingCompleted(now: Long = System.currentTimeMillis()) {
        if (!preferences.contains(KEY_ONBOARDING_COMPLETED)) {
            preferences.edit { putLong(KEY_ONBOARDING_COMPLETED, now) }
        }
    }

    fun markWidgetObserved() = preferences.edit { putBoolean(KEY_WIDGET_ADDED, true) }

    fun markFirstCardObserved(now: Long = System.currentTimeMillis()) {
        if (preferences.contains(KEY_FIRST_CARD_SECONDS)) return
        val completedAt = preferences.getLong(KEY_ONBOARDING_COMPLETED, 0L)
        if (completedAt <= 0L) return
        preferences.edit { putLong(KEY_FIRST_CARD_SECONDS, ((now - completedAt) / 1000L).coerceAtLeast(0L)) }
    }

    fun markEngaged(now: Long = System.currentTimeMillis()) {
        if (!preferences.contains(KEY_FIRST_ENGAGED)) preferences.edit { putLong(KEY_FIRST_ENGAGED, now) }
    }

    fun markFeedback(action: FeedbackAction, now: Long = System.currentTimeMillis()) {
        require(action.isCardFeedback()) { "SAVE is engagement, not card feedback" }
        markEngaged(now)
        preferences.edit {
            putInt(KEY_FEEDBACK_COUNT, preferences.getInt(KEY_FEEDBACK_COUNT, 0) + 1)
            if (action == FeedbackAction.LIKE) putInt(KEY_LIKE_COUNT, preferences.getInt(KEY_LIKE_COUNT, 0) + 1)
        }
    }

    fun exportJson(now: Long = System.currentTimeMillis()): String = BetaMetricsReport(
        evidenceId = preferences.getString(KEY_EVIDENCE_ID, null) ?: error("Missing local evidence ID"),
        exportedAt = now.iso(),
        appVersion = runCatching {
            @Suppress("DEPRECATION")
            appContext.packageManager.getPackageInfo(appContext.packageName, 0).versionName
        }.getOrNull() ?: "unknown",
        apkSha256 = installedApkSha256(),
        manufacturer = Build.MANUFACTURER,
        model = Build.MODEL,
        apiLevel = Build.VERSION.SDK_INT,
        buildFingerprint = Build.FINGERPRINT,
        onboardingStartedAt = preferences.getLong(KEY_ONBOARDING_STARTED, now).iso(),
        onboardingCompletedAt = preferences.optionalInstant(KEY_ONBOARDING_COMPLETED),
        widgetAdded = preferences.getBoolean(KEY_WIDGET_ADDED, false),
        firstCardSeconds = preferences.optionalLong(KEY_FIRST_CARD_SECONDS),
        firstEngagedAt = preferences.optionalInstant(KEY_FIRST_ENGAGED),
        feedbackCount = preferences.getInt(KEY_FEEDBACK_COUNT, 0),
        likeCount = preferences.getInt(KEY_LIKE_COUNT, 0)
    ).toJson()

    private fun android.content.SharedPreferences.optionalInstant(key: String): String? =
        optionalLong(key)?.iso()

    private fun android.content.SharedPreferences.optionalLong(key: String): Long? =
        if (contains(key)) getLong(key, 0L) else null

    private fun Long.iso(): String = Instant.ofEpochMilli(this).toString()

    private fun installedApkSha256(): String {
        val digest = MessageDigest.getInstance("SHA-256")
        File(appContext.applicationInfo.sourceDir).inputStream().buffered().use { input ->
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    private companion object {
        const val PREFERENCES = "local_beta_metrics"
        const val KEY_EVIDENCE_ID = "evidence_id"
        const val KEY_ONBOARDING_STARTED = "onboarding_started_at"
        const val KEY_ONBOARDING_COMPLETED = "onboarding_completed_at"
        const val KEY_WIDGET_ADDED = "widget_added"
        const val KEY_FIRST_CARD_SECONDS = "first_card_seconds"
        const val KEY_FIRST_ENGAGED = "first_engaged_at"
        const val KEY_FEEDBACK_COUNT = "feedback_count"
        const val KEY_LIKE_COUNT = "like_count"
    }
}
