package cn.jianwei.data.local

import cn.jianwei.domain.model.AnalysisState
import cn.jianwei.domain.model.KnowledgeCard
import cn.jianwei.domain.model.KnowledgeSource
import cn.jianwei.domain.model.NormalizedBoundingBox
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
    createdAt = Instant.ofEpochMilli(createdAtMillis),
    objectBounds = normalizedObjectBoundsOrNull()
)

private fun CardEntity.normalizedObjectBoundsOrNull(): NormalizedBoundingBox? {
    val x = objectBoxX ?: return null
    val y = objectBoxY ?: return null
    val width = objectBoxWidth ?: return null
    val height = objectBoxHeight ?: return null
    return NormalizedBoundingBox(x, y, width, height).takeIf { bounds ->
        bounds.x.isFinite() && bounds.y.isFinite() &&
            bounds.width.isFinite() && bounds.height.isFinite() &&
            bounds.x >= 0.0 && bounds.y >= 0.0 &&
            bounds.width > 0.0 && bounds.height > 0.0 &&
            bounds.x + bounds.width <= 1.0 && bounds.y + bounds.height <= 1.0
    }
}

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
