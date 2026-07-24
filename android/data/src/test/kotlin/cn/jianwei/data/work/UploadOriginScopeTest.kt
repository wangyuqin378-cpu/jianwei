package cn.jianwei.data.work

import cn.jianwei.domain.model.AnalysisPhase
import cn.jianwei.domain.model.AnalysisProgressScope
import com.google.common.truth.Truth.assertThat
import java.time.Instant
import org.junit.Test

class UploadOriginScopeTest {
    @Test
    fun missingOrInvalidScopeFailsClosed() {
        assertThat(parseUploadOriginScope(null)).isNull()
        assertThat(parseUploadOriginScope("")).isNull()
        assertThat(parseUploadOriginScope("ALL")).isNull()
        assertThat(parseUploadOriginScope("BROKEN")).isNull()
    }

    @Test
    fun acceptsOnlyProductionScopes() {
        assertThat(parseUploadOriginScope("MEDIA_STORE")).isEqualTo(UploadOriginScope.MEDIA_STORE)
        assertThat(parseUploadOriginScope("EXPLICIT_IMPORT")).isEqualTo(UploadOriginScope.EXPLICIT_IMPORT)
    }

    @Test
    fun invalidWorkerInputFailsBothDurableProgressScopesClosed() {
        val failures = invalidScopeFailureProgress()

        assertThat(failures.keys).containsExactlyElementsIn(AnalysisProgressScope.entries)
        assertThat(failures.values.map { it.phase }.distinct()).containsExactly(AnalysisPhase.FAILED)
    }

    @Test
    fun automaticDiscoveryUsesChinaDaySeedWhileExplicitImportsStayQualityOrdered() {
        val instant = Instant.parse("2026-07-24T16:30:00Z")

        assertThat(automaticSerendipitySeed(UploadOriginScope.MEDIA_STORE, instant))
            .isEqualTo("2026-07-25")
        assertThat(automaticSerendipitySeed(UploadOriginScope.EXPLICIT_IMPORT, instant)).isNull()
    }
}
