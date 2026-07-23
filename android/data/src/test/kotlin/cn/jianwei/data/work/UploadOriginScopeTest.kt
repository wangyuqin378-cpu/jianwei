package cn.jianwei.data.work

import com.google.common.truth.Truth.assertThat
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
}
