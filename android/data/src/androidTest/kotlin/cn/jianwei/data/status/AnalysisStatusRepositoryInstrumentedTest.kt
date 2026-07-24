package cn.jianwei.data.status

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import cn.jianwei.domain.model.AnalysisPhase
import cn.jianwei.domain.model.AnalysisProgress
import cn.jianwei.domain.model.AnalysisProgressScope
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

        SharedPreferencesAnalysisStatusRepository(context).publishProgress(
            AnalysisProgressScope.AUTOMATIC_DISCOVERY,
            expected
        )
        val restored = SharedPreferencesAnalysisStatusRepository(context)
            .observeProgress(AnalysisProgressScope.AUTOMATIC_DISCOVERY)
            .first()

        assertThat(restored).isEqualTo(expected)
        assertThat(context.getSharedPreferences("analysis_status", Context.MODE_PRIVATE).all.keys)
            .containsExactly(
                "automatic_discovery.phase",
                "automatic_discovery.discovered_count",
                "automatic_discovery.eligible_count",
                "automatic_discovery.cached_card_count",
                "automatic_discovery.detail"
            )
        Unit
    }

    @Test
    fun automaticAndExplicitImportProgressSurviveRecreationWithoutOverwritingEachOther() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        context.getSharedPreferences("analysis_status", Context.MODE_PRIVATE).edit().clear().commit()
        val repository = SharedPreferencesAnalysisStatusRepository(context)
        val automatic = AnalysisProgress(
            phase = AnalysisPhase.FILTERING,
            discoveredCount = 120,
            eligibleCount = 9
        )
        val explicitImport = AnalysisProgress(
            phase = AnalysisPhase.RETRYING,
            discoveredCount = 2,
            eligibleCount = 1,
            detail = "主动选图稍后重试"
        )

        repository.publishProgress(AnalysisProgressScope.AUTOMATIC_DISCOVERY, automatic)
        repository.publishProgress(AnalysisProgressScope.EXPLICIT_IMPORT, explicitImport)
        val recreated = SharedPreferencesAnalysisStatusRepository(context)

        assertThat(recreated.observeProgress(AnalysisProgressScope.AUTOMATIC_DISCOVERY).first())
            .isEqualTo(automatic)
        assertThat(recreated.observeProgress(AnalysisProgressScope.EXPLICIT_IMPORT).first())
            .isEqualTo(explicitImport)
        Unit
    }

    @Test
    fun legacyUnscopedProgressMigratesOnlyToAutomaticDiscovery() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        context.getSharedPreferences("analysis_status", Context.MODE_PRIVATE).edit()
            .clear()
            .putString("phase", AnalysisPhase.SCANNING.name)
            .putInt("discovered_count", 42)
            .putString("user_message", "旧版状态")
            .commit()

        val repository = SharedPreferencesAnalysisStatusRepository(context)

        assertThat(repository.observeProgress(AnalysisProgressScope.AUTOMATIC_DISCOVERY).first())
            .isEqualTo(AnalysisProgress(
                phase = AnalysisPhase.SCANNING,
                discoveredCount = 42,
                detail = "旧版状态"
            ))
        assertThat(repository.observeProgress(AnalysisProgressScope.EXPLICIT_IMPORT).first())
            .isEqualTo(AnalysisProgress())
        assertThat(context.getSharedPreferences("analysis_status", Context.MODE_PRIVATE).all)
            .doesNotContainKey("phase")
        Unit
    }
}
