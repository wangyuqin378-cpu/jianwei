package cn.jianwei.app

data class BetaMetricsReport(
    val evidenceId: String,
    val exportedAt: String,
    val appVersion: String,
    val apkSha256: String,
    val manufacturer: String,
    val model: String,
    val apiLevel: Int,
    val buildFingerprint: String,
    val onboardingStartedAt: String,
    val onboardingCompletedAt: String?,
    val widgetAdded: Boolean,
    val firstCardSeconds: Long?,
    val firstEngagedAt: String?,
    val feedbackCount: Int,
    val likeCount: Int
)

internal fun BetaMetricsReport.toJson(): String = buildString {
    append("{\n")
    appendJson("schemaVersion", "1", quoted = false)
    appendJson("evidenceKind", "local_beta_device_metrics")
    appendJson("evidenceId", evidenceId)
    appendJson("exportedAt", exportedAt)
    appendJson("appVersion", appVersion)
    appendJson("apkSha256", apkSha256)
    appendJson("manufacturer", manufacturer)
    appendJson("model", model)
    appendJson("apiLevel", apiLevel.toString(), quoted = false)
    appendJson("buildFingerprint", buildFingerprint)
    appendJson("onboardingStartedAt", onboardingStartedAt)
    appendNullableJson("onboardingCompletedAt", onboardingCompletedAt)
    appendJson("widgetAdded", widgetAdded.toString(), quoted = false)
    appendNullableJson("firstCardSeconds", firstCardSeconds?.toString(), quoted = false)
    appendNullableJson("firstEngagedAt", firstEngagedAt)
    appendJson("feedbackCount", feedbackCount.toString(), quoted = false)
    appendJson("likeCount", likeCount.toString(), quoted = false, trailingComma = false)
    append("}\n")
}

private fun StringBuilder.appendJson(
    name: String,
    value: String,
    quoted: Boolean = true,
    trailingComma: Boolean = true
) {
    append("  \"").append(name).append("\": ")
    if (quoted) append('"').append(value.jsonEscape()).append('"') else append(value)
    if (trailingComma) append(',')
    append('\n')
}

private fun StringBuilder.appendNullableJson(
    name: String,
    value: String?,
    quoted: Boolean = true
) {
    if (value == null) appendJson(name, "null", quoted = false)
    else appendJson(name, value, quoted = quoted)
}

private fun String.jsonEscape(): String = buildString(length) {
    this@jsonEscape.forEach { character ->
        when (character) {
            '\\' -> append("\\\\")
            '"' -> append("\\\"")
            '\n' -> append("\\n")
            '\r' -> append("\\r")
            '\t' -> append("\\t")
            else -> if (character.code < 0x20) append("\\u%04x".format(character.code)) else append(character)
        }
    }
}
