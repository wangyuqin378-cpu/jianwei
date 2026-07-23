package cn.jianwei.data.local

import cn.jianwei.domain.model.AnalysisState
import cn.jianwei.domain.model.KnowledgeCard
import cn.jianwei.domain.model.KnowledgeSource
import cn.jianwei.domain.model.PhotoCandidate
import cn.jianwei.domain.model.PhotoOrigin
import cn.jianwei.domain.model.normalizedSafeKnowledgeSourceUrl
import java.time.Instant
import java.time.LocalDate
import org.json.JSONArray

fun PhotoCandidateEntity.toDomain() = PhotoCandidate(
    localId = localId,
    candidateToken = candidateToken,
    contentUri = contentUri,
    capturedAt = Instant.ofEpochMilli(capturedAtMillis),
    modifiedAt = Instant.ofEpochMilli(modifiedAtMillis),
    perceptualHash = perceptualHash,
    qualityScore = qualityScore,
    localLabels = localLabels,
    sensitiveFlags = sensitiveFlags,
    analysisState = AnalysisState.valueOf(analysisState),
    origin = PhotoOrigin.valueOf(origin),
    width = width,
    height = height
)

fun CardEntity.toDomain() = KnowledgeCard(
    cardId = cardId,
    candidateToken = candidateToken,
    photoUri = photoUri,
    topicId = topicId,
    factId = factId,
    title = title,
    detectedObjectName = detectedObjectName.ifBlank { title },
    body = body,
    personalContext = personalContext,
    confidence = confidence,
    sources = sourcesFromJson(sources),
    status = status,
    scheduledDate = LocalDate.parse(scheduledDate),
    createdAt = Instant.ofEpochMilli(createdAtMillis)
)

fun sourcesToJson(sources: List<KnowledgeSource>): String = JSONArray().apply {
    sources.forEach { source ->
        put(org.json.JSONObject().apply {
            put("sourceId", source.sourceId)
            put("title", source.title)
            put("url", source.url)
            put("publisher", source.publisher)
            put("authority", source.authority)
        })
    }
}.toString()

fun sourcesFromJson(value: String): List<KnowledgeSource> {
    return runCatching {
        val array = JSONArray(value)
        buildList {
            val seenIds = mutableSetOf<String>()
            for (index in 0 until minOf(array.length(), 3)) {
                val item = array.optJSONObject(index) ?: continue
                val sourceId = item.optString("sourceId").trim()
                val title = item.optString("title").trim()
                val publisher = item.optString("publisher").trim()
                val authority = item.optString("authority")
                val safeUrl = normalizedSafeKnowledgeSourceUrl(item.optString("url"))
                if (
                    sourceId.isEmpty() || sourceId.length > 100 || !seenIds.add(sourceId) ||
                    title.isEmpty() || title.length > 200 ||
                    publisher.isEmpty() || publisher.length > 120 ||
                    authority !in SAFE_SOURCE_AUTHORITIES || safeUrl == null
                ) continue
                add(KnowledgeSource(sourceId, title, safeUrl, publisher, authority))
            }
        }
    }.getOrDefault(emptyList())
}

private val SAFE_SOURCE_AUTHORITIES = setOf("reference", "official", "professional")
