package cn.jianwei.domain.card

private const val MIN_REMAINING_BODY_CODE_POINTS = 4
private val LEADING_BODY_PUNCTUATION = setOf('，', ',', '；', ';', '。', '.', '！', '!', '？', '?', '：', ':')

/**
 * New cards can use the first reviewed fact clause as their headline. Avoid
 * repeating that exact clause immediately below it while preserving the full
 * source-bound body for old, uncertain, or non-matching cards.
 */
fun cardBodyForDisplay(title: String, body: String): String {
    val normalizedTitle = title.trim()
    val normalizedBody = body.trim()
    if (normalizedTitle.isEmpty() || !normalizedBody.startsWith(normalizedTitle)) return normalizedBody

    val remainder = normalizedBody
        .removePrefix(normalizedTitle)
        .trimStart { character -> character.isWhitespace() || character in LEADING_BODY_PUNCTUATION }
    return if (remainder.codePointCount() >= MIN_REMAINING_BODY_CODE_POINTS) remainder else normalizedBody
}

private fun String.codePointCount(): Int = codePoints().count().toInt()
