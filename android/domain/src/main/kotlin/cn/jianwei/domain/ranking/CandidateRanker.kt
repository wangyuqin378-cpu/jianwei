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
        topicAffinities: Collection<TopicAffinitySignal> = emptyList(),
        serendipitySeed: String? = null
    ): List<PhotoCandidate> {
        require(limit >= 0)
        if (limit == 0) return emptyList()
        val scored = candidates
            .asSequence()
            .filter { it.sensitiveFlags.isEmpty() && it.qualityScore >= 0.35 }
            .map { ScoredCandidate(it, score(it, interests, now, topicAffinities)) }
            .sortedByDescending { it.score }
            .toList()
        val accepted = qualityBoundedSerendipity(scored, serendipitySeed)

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

    /**
     * Automatic discovery should feel surprising without letting randomness override quality,
     * explicit interests, or learned feedback. Only candidates inside a narrow score band can
     * change order, and the supplied day seed makes retries and process restarts deterministic.
     */
    private fun qualityBoundedSerendipity(
        ranked: List<ScoredCandidate>,
        seed: String?
    ): List<PhotoCandidate> {
        if (seed.isNullOrBlank()) return ranked.map { it.candidate }
        val result = ArrayList<PhotoCandidate>(ranked.size)
        var index = 0
        while (index < ranked.size) {
            val bestScore = ranked[index].score
            var endExclusive = index + 1
            while (
                endExclusive < ranked.size &&
                endExclusive - index < SERENDIPITY_BAND_SIZE &&
                bestScore - ranked[endExclusive].score <= SERENDIPITY_MAX_SCORE_GAP
            ) {
                endExclusive += 1
            }
            val band = ranked.subList(index, endExclusive)
            result += band
                .sortedBy { stableSerendipityKey(seed, it.candidate.candidateToken) }
                .map { it.candidate }
            index += band.size
        }
        return result
    }

    private fun stableSerendipityKey(seed: String, candidateToken: String): ULong {
        var hash = FNV_OFFSET_BASIS
        "$seed\u0000$candidateToken".forEach { character ->
            hash = (hash xor character.code.toULong()) * FNV_PRIME
        }
        return hash
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
        data class ScoredCandidate(val candidate: PhotoCandidate, val score: Double)

        const val MAX_HASH_DISTANCE = 5
        const val MIN_AFFINITY = -2.0
        const val MAX_AFFINITY = 2.0
        const val SERENDIPITY_BAND_SIZE = 3
        const val SERENDIPITY_MAX_SCORE_GAP = 0.04
        val FNV_OFFSET_BASIS = 14_695_981_039_346_656_037uL
        val FNV_PRIME = 1_099_511_628_211uL
        val TOPIC_SEPARATOR = Regex("[\\s_\\-/]+")
    }
}
