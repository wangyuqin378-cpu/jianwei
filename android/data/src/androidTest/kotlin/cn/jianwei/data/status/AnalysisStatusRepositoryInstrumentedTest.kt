package cn.jianwei.data.status

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import cn.jianwei.domain.model.AnalysisPhase
import cn.jianwei.domain.model.AnalysisProgress
import com.google.common.truth.Truth.assertThat
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Test

class AnalysisStatusRepositoryInstrumentedTest {
    @Test
    fun structuredProgressSurvivesRepositoryRecreationWithoutPhotoMetadata() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        context.getSharedPreferences("analysis_status", Context.MODE_PRIVATE).edit().clear().commit()
        val expected = AnalysisProgress(
            phase = AnalysisPhase.RETRYING,
            discoveredCount = 37,
            eligibleCount = 8,
            cachedCardCount = 2,
            detail = "系统会自动重试"
        )

        SharedPreferencesAnalysisStatusRepository(context).publishProgress(expected)
        val restored = SharedPreferencesAnalysisStatusRepository(context).observeProgress().first()

        assertThat(restored).isEqualTo(expected)
        assertThat(context.getSharedPreferences("analysis_status", Context.MODE_PRIVATE).all.keys)
            .containsExactly(
                "phase",
                "discovered_count",
                "eligible_count",
                "cached_card_count",
                "detail"
            )
        Unit
    }
}
