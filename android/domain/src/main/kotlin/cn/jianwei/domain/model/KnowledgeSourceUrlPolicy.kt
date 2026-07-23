package cn.jianwei.domain.model

import java.net.URI

private val PRIVATE_KNOWLEDGE_SOURCE_SUFFIXES = listOf(
    ".localhost",
    ".local",
    ".internal",
    ".lan",
    ".home"
)

/** Returns a normalized public HTTPS URL, or null when the value must not be opened. */
fun normalizedSafeKnowledgeSourceUrl(value: String): String? {
    val candidate = value.trim()
    if (candidate.isEmpty() || candidate.length > 2_048) return null
    if (!candidate.startsWith("https://", ignoreCase = true)) return null
    if (candidate.any { it == '\\' || it.code < 0x20 || it.code == 0x7f }) return null

    return runCatching {
        val uri = URI(candidate)
        val hostname = uri.host
            ?.lowercase()
            ?.removeSuffix(".")
            ?: return null

        if (uri.isOpaque || !uri.scheme.equals("https", ignoreCase = true)) return null
        if (uri.rawUserInfo != null) return null
        if (uri.port != -1 && uri.port != 443) return null
        if (!hostname.contains('.')) return null
        if (hostname == "localhost" || PRIVATE_KNOWLEDGE_SOURCE_SUFFIXES.any(hostname::endsWith)) return null
        // URI host parsing keeps IPv6 colons. Numeric IPv4 forms are rejected even
        // when they are syntactically unusual, rather than trying to classify ranges.
        if (hostname.contains(':') || hostname.all { it.isDigit() || it == '.' }) return null

        uri.toASCIIString()
    }.getOrNull()
}
