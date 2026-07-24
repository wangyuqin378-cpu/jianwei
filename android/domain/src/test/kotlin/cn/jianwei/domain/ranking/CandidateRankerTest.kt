package cn.jianwei.domain.ranking

import cn.jianwei.domain.model.AnalysisState
import cn.jianwei.domain.model.PhotoCandidate
import cn.jianwei.domain.model.PhotoOrigin
import cn.jianwei.domain.model.TopicAffinitySignal
import com.google.common.truth.Truth.assertThat
import java.time.Instant
import org.junit.Test

class CandidateRankerTest {
    private val now = Instant.parse("2026-07-18T00:00:00Z")

    @Test
    fun `filters sensitive and near duplicate photos`() {
        val original = candidate(1, hash = 0b1010, quality = 0.9)
        val duplicate = candidate(2, hash = 0b1011, quality = 0.95)
        val private = candidate(3, hash = 0b11110000, quality = 1.0, flags = setOf("face"))

        val result = CandidateRanker().rank(listOf(duplicate, private, original), emptySet(), now, 12)

        assertThat(result.map { it.localId }).containsExactly(2L)
    }

    @Test
    fun `limits each capture day to two photos`() {
        val result = CandidateRanker().rank(
            (1L..5L).map { candidate(it, hash = 0xFFL shl ((it.toInt() - 1) * 8), quality = 0.9) },
            emptySet(),
            now,
            12
        )
        assertThat(result).hasSize(2)
    }

    @Test
    fun `marks lower-quality duplicates across batches and within the current batch`() {
        val best = candidate(1, hash = 0b1010, quality = 0.95)
        val currentDuplicate = candidate(2, hash = 0b1011, quality = 0.9)
        val previousBatchDuplicate = candidate(3, hash = 0b1111_0001, quality = 0.99)

        val duplicates = CandidateRanker().nearDuplicateIds(
            listOf(currentDuplicate, best, previousBatchDuplicate),
            existingHashes = listOf(0b1111_0000L)
        )

        assertThat(duplicates).containsExactly(2L, 3L)
    }

    @Test
    fun `unique eligible count excludes historical and current batch duplicates`() {
        val previousBatchDuplicate = candidate(1, hash = 0b1111_0001, quality = 0.99)
        val currentBest = candidate(2, hash = 0b1010, quality = 0.95)
        val currentDuplicate = candidate(3, hash = 0b1011, quality = 0.9)
        val unique = candidate(4, hash = 0b1111_0000_0000, quality = 0.8)

        val count = CandidateRanker().uniqueEligibleCount(
            listOf(previousBatchDuplicate, currentDuplicate, unique, currentBest),
            existingHashes = listOf(0b1111_0000L)
        )

        assertThat(count).isEqualTo(2)
    }

    @Test
    fun `positive local topic affinity promotes matching labels`() {
        val preferred = candidate(1, hash = 0xFF, quality = 0.80, labels = listOf("toothbrush"))
        val other = candidate(2, hash = 0xFF00, quality = 0.90, labels = listOf("kettle"))

        val result = CandidateRanker().rank(
            listOf(other, preferred),
            emptySet(),
            now,
            12,
            listOf(TopicAffinitySignal("toothbrush", 2.0, setOf("toothbrush")))
        )

        assertThat(result.first().localId).isEqualTo(preferred.localId)
    }

    @Test
    fun `negative local topic affinity demotes matching labels`() {
        val disliked = candidate(1, hash = 0xFF, quality = 0.95, labels = listOf("toothbrush"))
        val other = candidate(2, hash = 0xFF00, quality = 0.80, labels = listOf("kettle"))

        val result = CandidateRanker().rank(
            listOf(disliked, other),
            emptySet(),
            now,
            12,
            listOf(TopicAffinitySignal("toothbrush", -2.0, setOf("toothbrush")))
        )

        assertThat(result.first().localId).isEqualTo(other.localId)
    }

    @Test
    fun `multi word topic affinity matches labels across separators`() {
        val preferred = candidate(1, hash = 0xFF, quality = 0.80, labels = listOf("Traffic light"))
        val other = candidate(2, hash = 0xFF00, quality = 0.90, labels = listOf("Kettle"))

        val result = CandidateRanker().rank(
            listOf(other, preferred),
            emptySet(),
            now,
            12,
            listOf(TopicAffinitySignal("traffic_light", 2.0, emptySet()))
        )

        assertThat(result.first().localId).isEqualTo(preferred.localId)
    }

    private fun candidate(
        id: Long,
        hash: Long,
        quality: Double,
        flags: Set<String> = emptySet(),
        labels: List<String> = listOf("object")
    ) = PhotoCandidate(
        localId = id,
        candidateToken = "candidate-$id",
        contentUri = "content://photo/$id",
        capturedAt = now.minusSeconds(86_400),
        modifiedAt = now,
        perceptualHash = hash,
        qualityScore = quality,
        localLabels = labels,
        sensitiveFlags = flags,
        analysisState = AnalysisState.READY,
        origin = PhotoOrigin.MEDIA_STORE,
        width = 1200,
        height = 900
    )
}
