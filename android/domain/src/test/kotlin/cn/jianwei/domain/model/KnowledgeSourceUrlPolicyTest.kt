package cn.jianwei.domain.model

import com.google.common.truth.Truth.assertThat
import org.junit.Test

class KnowledgeSourceUrlPolicyTest {
    @Test
    fun acceptsAndNormalizesPublicHttpsSources() {
        assertThat(normalizedSafeKnowledgeSourceUrl("https://example.com/fact")).isEqualTo("https://example.com/fact")
        assertThat(normalizedSafeKnowledgeSourceUrl("HTTPS://EXAMPLE.COM/reference"))
            .isEqualTo("HTTPS://EXAMPLE.COM/reference")
        assertThat(normalizedSafeKnowledgeSourceUrl(" https://example.com:443/fact "))
            .isEqualTo("https://example.com:443/fact")
    }

    @Test
    fun rejectsNonWebDeepLinksCredentialsAndCustomPorts() {
        listOf(
            "http://example.com/fact",
            "javascript:alert(1)",
            "file:///etc/passwd",
            "intent://scan/#Intent;scheme=zxing;end",
            "https://user:password@example.com/fact",
            "https://example.com:8443/fact",
            "https:\\example.com\\fact"
        ).forEach { assertThat(normalizedSafeKnowledgeSourceUrl(it)).isNull() }
    }

    @Test
    fun rejectsLocalNamesAndDirectIpAddresses() {
        listOf(
            "https://localhost/fact",
            "https://api.internal/fact",
            "https://router.local/fact",
            "https://127.0.0.1/fact",
            "https://10.0.0.1/fact",
            "https://192.168.1.10/fact",
            "https://[::1]/fact",
            "https://example/fact"
        ).forEach { assertThat(normalizedSafeKnowledgeSourceUrl(it)).isNull() }
    }
}
