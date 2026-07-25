package cn.jianwei.data.preferences

import android.content.Context
import cn.jianwei.domain.card.DailyAutomaticUploadClaim
import dagger.hilt.android.qualifiers.ApplicationContext
import java.time.LocalDate
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SharedPreferencesAutomaticDailyUploadQuota @Inject constructor(
    @ApplicationContext context: Context
) {
    private val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

    @Synchronized
    fun hasClaim(day: LocalDate): Boolean =
        preferences.getString(KEY_DAY, null) == day.toString()

    @Synchronized
    fun claimedCandidate(day: LocalDate): Long? = if (
        preferences.getString(KEY_DAY, null) == day.toString() &&
        preferences.contains(KEY_CANDIDATE_LOCAL_ID)
    ) {
        preferences.getLong(KEY_CANDIDATE_LOCAL_ID, Long.MIN_VALUE)
            .takeUnless { it == Long.MIN_VALUE }
    } else {
        null
    }

    @Synchronized
    fun claim(day: LocalDate, candidateLocalId: Long): DailyAutomaticUploadClaim {
        require(candidateLocalId >= 0) { "自动候选 ID 无效" }
        val encodedDay = day.toString()
        if (preferences.getString(KEY_DAY, null) == encodedDay) {
            if (!preferences.contains(KEY_CANDIDATE_LOCAL_ID)) {
                return DailyAutomaticUploadClaim.EXHAUSTED
            }
            return if (preferences.getLong(KEY_CANDIDATE_LOCAL_ID, Long.MIN_VALUE) == candidateLocalId) {
                DailyAutomaticUploadClaim.SAME_CANDIDATE
            } else {
                DailyAutomaticUploadClaim.EXHAUSTED
            }
        }
        check(
            preferences.edit()
                .putString(KEY_DAY, encodedDay)
                .putLong(KEY_CANDIDATE_LOCAL_ID, candidateLocalId)
                .commit()
        ) { "每天一张配额保存失败" }
        return DailyAutomaticUploadClaim.NEW_CLAIM
    }

    internal companion object {
        const val PREFERENCES = "analysis_scheduler"
        const val KEY_DAY = "daily_one_claimed_day"
        const val KEY_CANDIDATE_LOCAL_ID = "daily_one_candidate_local_id"
    }
}
