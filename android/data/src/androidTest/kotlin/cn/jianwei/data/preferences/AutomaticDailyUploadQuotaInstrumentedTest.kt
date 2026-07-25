package cn.jianwei.data.preferences

import androidx.test.core.app.ApplicationProvider
import cn.jianwei.domain.card.DailyAutomaticUploadClaim
import com.google.common.truth.Truth.assertThat
import java.time.LocalDate
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import org.junit.After
import org.junit.Before
import org.junit.Test

class AutomaticDailyUploadQuotaInstrumentedTest {
    private val context = ApplicationProvider.getApplicationContext<android.content.Context>()

    @Before
    fun clearBefore() {
        preferences().edit().remove(SharedPreferencesAutomaticDailyUploadQuota.KEY_DAY)
            .remove(SharedPreferencesAutomaticDailyUploadQuota.KEY_CANDIDATE_LOCAL_ID)
            .commit()
    }

    @After
    fun clearAfter() {
        preferences().edit().remove(SharedPreferencesAutomaticDailyUploadQuota.KEY_DAY)
            .remove(SharedPreferencesAutomaticDailyUploadQuota.KEY_CANDIDATE_LOCAL_ID)
            .commit()
    }

    @Test
    fun oneCandidatePerChinaDaySurvivesStoreRecreationAndAllowsItsOwnRetry() {
        val day = LocalDate.of(2026, 7, 25)
        val repository = SharedPreferencesAutomaticDailyUploadQuota(context)

        assertThat(repository.hasClaim(day)).isFalse()
        assertThat(repository.claim(day, 41L)).isEqualTo(DailyAutomaticUploadClaim.NEW_CLAIM)
        assertThat(repository.claim(day, 41L)).isEqualTo(DailyAutomaticUploadClaim.SAME_CANDIDATE)
        assertThat(repository.claimedCandidate(day)).isEqualTo(41L)

        val recreated = SharedPreferencesAutomaticDailyUploadQuota(context)
        assertThat(recreated.hasClaim(day)).isTrue()
        assertThat(recreated.claimedCandidate(day)).isEqualTo(41L)
        assertThat(recreated.claim(day, 42L)).isEqualTo(DailyAutomaticUploadClaim.EXHAUSTED)
        assertThat(recreated.claim(day.plusDays(1), 42L)).isEqualTo(DailyAutomaticUploadClaim.NEW_CLAIM)
        assertThat(recreated.claimedCandidate(day.plusDays(1))).isEqualTo(42L)
    }

    @Test
    fun concurrentDifferentCandidatesProduceExactlyOneNewClaim() {
        val day = LocalDate.of(2026, 7, 25)
        val repository = SharedPreferencesAutomaticDailyUploadQuota(context)
        val executor = Executors.newFixedThreadPool(8)
        try {
            val results = executor.invokeAll((1L..24L).map { candidateId ->
                Callable { repository.claim(day, candidateId) }
            }).map { it.get() }

            assertThat(results.count { it == DailyAutomaticUploadClaim.NEW_CLAIM }).isEqualTo(1)
            assertThat(results.count { it == DailyAutomaticUploadClaim.EXHAUSTED }).isEqualTo(23)
        } finally {
            executor.shutdownNow()
        }
    }

    @Test
    fun incompleteSameDayStateFailsClosed() {
        val day = LocalDate.of(2026, 7, 25)
        preferences().edit()
            .putString(SharedPreferencesAutomaticDailyUploadQuota.KEY_DAY, day.toString())
            .remove(SharedPreferencesAutomaticDailyUploadQuota.KEY_CANDIDATE_LOCAL_ID)
            .commit()

        val repository = SharedPreferencesAutomaticDailyUploadQuota(context)

        assertThat(repository.hasClaim(day)).isTrue()
        assertThat(repository.claimedCandidate(day)).isNull()
        assertThat(repository.claim(day, 99L)).isEqualTo(DailyAutomaticUploadClaim.EXHAUSTED)
    }

    private fun preferences() = context.getSharedPreferences(
        SharedPreferencesAutomaticDailyUploadQuota.PREFERENCES,
        android.content.Context.MODE_PRIVATE
    )
}
