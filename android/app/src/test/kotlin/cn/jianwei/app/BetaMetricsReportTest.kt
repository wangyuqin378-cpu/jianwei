package cn.jianwei.app

import com.google.common.truth.Truth.assertThat
import org.junit.Test

class BetaMetricsReportTest {
    @Test
    fun `exports bounded non-photo device evidence as valid JSON text`() {
        val output = BetaMetricsReport(
            evidenceId = "00000000-0000-4000-8000-000000000001",
            exportedAt = "2026-07-18T10:00:00Z",
            appVersion = "0.1.0-beta01",
            apkSha256 = "a".repeat(64),
            manufacturer = "Example",
            model = "Model \"A\"",
            apiLevel = 34,
            buildFingerprint = "example/device/build:14/release-keys",
            onboardingStartedAt = "2026-07-18T09:59:00Z",
            onboardingCompletedAt = "2026-07-18T09:59:20Z",
            widgetAdded = true,
            firstCardSeconds = 40,
            firstEngagedAt = "2026-07-18T10:00:30Z",
            feedbackCount = 2,
            likeCount = 1
        ).toJson()

        assertThat(output).contains("\"evidenceKind\": \"local_beta_device_metrics\"")
        assertThat(output).contains("Model \\\"A\\\"")
        assertThat(output).contains("\"firstCardSeconds\": 40")
        assertThat(output).doesNotContain("photo")
        assertThat(output).doesNotContain("candidateToken")
        assertThat(output).doesNotContain("installationId")
        assertThat(output).doesNotContain("deviceToken")
        assertThat(output).doesNotContain("location")
    }
}
