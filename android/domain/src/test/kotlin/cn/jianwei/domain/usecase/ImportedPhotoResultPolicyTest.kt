package cn.jianwei.domain.usecase

import cn.jianwei.domain.model.AnalysisPhase
import cn.jianwei.domain.model.AnalysisState
import cn.jianwei.domain.model.KnowledgeCard
import cn.jianwei.domain.model.PhotoCandidate
import cn.jianwei.domain.model.PhotoOrigin
import com.google.common.truth.Truth.assertThat
import java.time.Instant
import java.time.LocalDate
import org.junit.Test

class ImportedPhotoResultPolicyTest {
    @Test
    fun `explicit reselection restarts only recoverable terminal attempts`() {
        val restartable = AnalysisState.entries.filter(::shouldRestartExplicitImport)

        assertThat(restartable).containsExactly(
            AnalysisState.FILTERED,
            AnalysisState.FAILED,
            AnalysisState.ACCESS_UNAVAILABLE
        )
    }

    @Test
    fun `generated card wins even when another requested photo is still processing`() {
        val result = resolveImportedPhotoResult(
            candidateTokens = listOf("first", "second"),
            candidates = listOf(candidate("first", AnalysisState.COMPLETED), candidate("second", AnalysisState.READY)),
            cards = listOf(card("card-first", "first")),
            analysisPhase = AnalysisPhase.SYNCING
        )

        assertThat(result).isEqualTo(ImportedPhotoResultResolution.CardReady("card-first"))
    }

    @Test
    fun `completed candidate waits for the final card sync`() {
        val candidate = candidate("first", AnalysisState.COMPLETED)

        assertThat(resolveImportedPhotoResult(listOf("first"), listOf(candidate), emptyList(), AnalysisPhase.SYNCING))
            .isEqualTo(ImportedPhotoResultResolution.Pending)
        assertThat(resolveImportedPhotoResult(listOf("first"), listOf(candidate), emptyList(), AnalysisPhase.NO_MATCH))
            .isEqualTo(ImportedPhotoResultResolution.NoMatch)
    }

    @Test
    fun `filtered and failed requests have distinct terminal outcomes`() {
        assertThat(resolveImportedPhotoResult(
            listOf("filtered"),
            listOf(candidate("filtered", AnalysisState.FILTERED)),
            emptyList(),
            AnalysisPhase.FILTERING
        )).isEqualTo(ImportedPhotoResultResolution.NoMatch)
        assertThat(resolveImportedPhotoResult(
            listOf("failed"),
            listOf(candidate("failed", AnalysisState.FAILED)),
            emptyList(),
            AnalysisPhase.FAILED
        )).isEqualTo(ImportedPhotoResultResolution.Failed(canRetry = false))
    }

    @Test
    fun `terminal service failure makes retained candidates retryable`() {
        assertThat(resolveImportedPhotoResult(
            listOf("ready"),
            listOf(candidate("ready", AnalysisState.READY)),
            emptyList(),
            AnalysisPhase.FAILED
        )).isEqualTo(ImportedPhotoResultResolution.Failed(canRetry = true))
        assertThat(resolveImportedPhotoResult(
            listOf("completed"),
            listOf(candidate("completed", AnalysisState.COMPLETED)),
            emptyList(),
            AnalysisPhase.FAILED
        )).isEqualTo(ImportedPhotoResultResolution.Failed(canRetry = true))
    }

    @Test
    fun `unreadable candidate asks for a fresh selection instead of retry`() {
        assertThat(resolveImportedPhotoResult(
            listOf("unavailable"),
            listOf(candidate("unavailable", AnalysisState.ACCESS_UNAVAILABLE)),
            emptyList(),
            AnalysisPhase.FAILED
        )).isEqualTo(ImportedPhotoResultResolution.Failed(canRetry = false))
    }

    @Test
    fun `missing candidate asks for a fresh selection instead of waiting forever`() {
        assertThat(resolveImportedPhotoResult(
            listOf("first", "second"),
            listOf(candidate("first", AnalysisState.FILTERED)),
            emptyList(),
            AnalysisPhase.FILTERING
        )).isEqualTo(ImportedPhotoResultResolution.Failed(canRetry = false))
    }

    @Test
    fun `active candidate remains pending`() {
        assertThat(resolveImportedPhotoResult(
            listOf("first"),
            listOf(candidate("first", AnalysisState.DISCOVERED)),
            emptyList(),
            AnalysisPhase.FILTERING
        )).isEqualTo(ImportedPhotoResultResolution.Pending)
    }

    private fun candidate(token: String, state: AnalysisState) = PhotoCandidate(
        localId = token.hashCode().toLong(),
        candidateToken = token,
        contentUri = "content://private/$token",
        capturedAt = Instant.EPOCH,
        modifiedAt = Instant.EPOCH,
        perceptualHash = null,
        qualityScore = 0.8,
        localLabels = emptyList(),
        sensitiveFlags = emptySet(),
        analysisState = state,
        origin = PhotoOrigin.PHOTO_PICKER,
        width = 100,
        height = 100
    )

    private fun card(id: String, token: String) = KnowledgeCard(
        cardId = id,
        candidateToken = token,
        photoUri = "content://private/$token",
        topicId = "broom",
        factId = "fact",
        title = "扫帚的设计",
        detectedObjectName = "扫帚",
        body = "知识正文",
        personalContext = "来自你刚选的照片",
        confidence = 0.9,
        sources = emptyList(),
        status = "scheduled",
        scheduledDate = LocalDate.of(2026, 7, 25),
        createdAt = Instant.EPOCH
    )
}
