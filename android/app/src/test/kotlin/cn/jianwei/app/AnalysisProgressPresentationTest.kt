package cn.jianwei.app

import cn.jianwei.domain.model.AnalysisPhase
import cn.jianwei.domain.model.AnalysisProgress
import com.google.common.truth.Truth.assertThat
import org.junit.Test

class AnalysisProgressPresentationTest {
    @Test
    fun `pending explicit import owns the visible progress without mutating automatic progress`() {
        val automatic = AnalysisProgress(
            phase = AnalysisPhase.FILTERING,
            discoveredCount = 120
        )
        val explicitImport = AnalysisProgress(
            phase = AnalysisPhase.SYNCING,
            eligibleCount = 2
        )

        assertThat(analysisProgressForPresentation(automatic, explicitImport, pendingImportCount = 2))
            .isEqualTo(explicitImport)
        assertThat(analysisProgressForPresentation(automatic, explicitImport, pendingImportCount = 0))
            .isEqualTo(automatic)
    }
}
