package cn.jianwei.domain.ranking

import cn.jianwei.domain.model.PhotoCandidate
import cn.jianwei.domain.model.TopicAffinitySignal
import cn.jianwei.domain.time.ChinaCalendar
import java.time.Duration
import java.time.Instant
import kotlin.math.max

class CandidateRanker {
    fun uniqueEligibleCount(candidates: List<PhotoCandidate>, existingHashes: Collection<Long>): Int {
        val eligible = candidates.filter { it.sensitiveFlags.isEmpty() && it.qualityScore >= 0.35 }
        return eligible.size - nearDuplicateIds(eligible, existingHashes).size
    }

    fun nearDuplicateIds(candidates: List<PhotoCandidate>, existingHashes: Collection<Long>): Set<Long> {
        val acceptedHashes = existingHashes.toMutableList()
        val duplicates = mutableSetOf<Long>()
        candidates
            .filter { it.sensitiveFlags.isEmpty() && it.qualityScore >= 0.35 && it.perceptualHash != null }
            .sortedByDescending { it.qualityScore }
            .forEach { candidate ->
                val hash = requireNotNull(candidate.perceptualHash)
                if (acceptedHashes.any { other -> java.lang.Long.bitCount(hash xor other) <= MAX_HASH_DISTANCE }) {
                    duplicates += candidate.localId
                } else {
                    acceptedHashes += hash
                }
            }
        return duplicates
    }

    fun rank(
        candidates: List<PhotoCandidate>,
        interests: Set<String>,
        now: Instant = Instant.now(),
        limit: Int = 12,
        topicAffinities: Collection<TopicAffinitySignal> = emptyList()
    ): List<PhotoCandidate> {
        require(limit >= 0)
        if (limit == 0) return emptyList()
        val accepted = candidates
            .asSequence()
            .filter { it.sensitiveFlags.isEmpty() && it.qualityScore >= 0.35 }
            .sortedByDescending { score(it, interests, now, topicAffinities) }
            .toList()

        val selected = mutableListOf<PhotoCandidate>()
        val diversityOverflow = mutableListOf<PhotoCandidate>()
        for (candidate in accepted) {
            val duplicate = selected.any { other -> isNearDuplicate(candidate, other) }
            val sameDayOverrepresented = selected.count {
                ChinaCalendar.dateOf(it.capturedAt) == ChinaCalendar.dateOf(candidate.capturedAt)
            } >= 2
            val labelKey = diversityLabelKey(candidate)
            val sameLabelGroupOverrepresented = labelKey != null && selected.count {
                diversityLabelKey(it) == labelKey
            } >= 2
            val overrepresented = sameDayOverrepresented || sameLabelGroupOverrepresented
            if (!duplicate && overrepresented) diversityOverflow += candidate
            if (!duplicate && !overrepresented) selected += candidate
            if (selected.size == limit) break
        }
        if (selected.size < limit) {
            for (candidate in diversityOverflow) {
                if (selected.none { other -> isNearDuplicate(candidate, other) }) selected += candidate
                if (selected.size == limit) break
            }
        }
        return selected
    }

    private fun isNearDuplicate(candidate: PhotoCandidate, other: PhotoCandidate): Boolean =
        candidate.perceptualHash != null && other.perceptualHash != null &&
            java.lang.Long.bitCount(candidate.perceptualHash xor other.perceptualHash) <= MAX_HASH_DISTANCE

    private fun diversityLabelKey(candidate: PhotoCandidate): String? {
        val labels = candidate.localLabels
            .asSequence()
            .map(::normalize)
            .filter { it.length >= 2 }
            .distinct()
            .take(2)
            .sorted()
            .toList()
        return labels.takeIf { it.size == 2 }?.joinToString("|")
    }

    private fun score(
        candidate: PhotoCandidate,
        interests: Set<String>,
        now: Instant,
        topicAffinities: Collection<TopicAffinitySignal>
    ): Double {
        val ageDays = max(0, Duration.between(candidate.capturedAt, now).toDays()).coerceAtMost(90)
        val recency = 1.0 - ageDays / 90.0
        val interestHit = candidate.localLabels.count { label -> interests.any { interest -> label.contains(interest, ignoreCase = true) } }
        val learnedPreference = topicAffinityScore(candidate.localLabels, topicAffinities)
        return candidate.qualityScore * 0.55 + recency * 0.25 +
            interestHit.coerceAtMost(2) * 0.10 + learnedPreference * 0.12
    }

    private fun topicAffinityScore(
        labels: Collection<String>,
        affinities: Collection<TopicAffinitySignal>
    ): Double {
        val normalizedLabels = labels.map(::normalize).filter { it.length >= 2 }
        if (normalizedLabels.isEmpty()) return 0.0
        return affinities.sumOf { affinity ->
            val aliases = (affinity.aliases + affinity.topicId).map(::normalize).filter { it.length >= 2 }
            if (aliases.any { alias -> normalizedLabels.any { label -> label == alias || label.contains(alias) || alias.contains(label) } }) {
                affinity.weight.coerceIn(MIN_AFFINITY, MAX_AFFINITY)
            } else {
                0.0
            }
        }.coerceIn(MIN_AFFINITY, MAX_AFFINITY)
    }

    private fun normalize(value: String): String = value
        .trim()
        .lowercase()
        .replace(TOPIC_SEPARATOR, "")

    private companion object {
        const val MAX_HASH_DISTANCE = 5
        const val MIN_AFFINITY = -2.0
        const val MAX_AFFINITY = 2.0
        val TOPIC_SEPARATOR = Regex("[\\s_\\-/]+")
    }
}
