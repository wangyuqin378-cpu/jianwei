package cn.jianwei.domain.usecase

import cn.jianwei.domain.model.AnalysisPhase
import cn.jianwei.domain.model.AnalysisState
import cn.jianwei.domain.model.KnowledgeCard
import cn.jianwei.domain.model.PhotoCandidate

sealed interface ImportedPhotoResultResolution {
    data object Pending : ImportedPhotoResultResolution
    data class CardReady(val cardId: String) : ImportedPhotoResultResolution
    data object NoMatch : ImportedPhotoResultResolution
    data object Failed : ImportedPhotoResultResolution
}

/**
 * Resolves one explicit Photo Picker or Sharesheet request without exposing its tokens to UI.
 * A COMPLETED candidate is kept pending until card synchronization reaches a terminal phase,
 * because the upload worker commits the candidate state immediately before its final card sync.
 */
fun resolveImportedPhotoResult(
    candidateTokens: List<String>,
    candidates: List<PhotoCandidate>,
    cards: List<KnowledgeCard>,
    analysisPhase: AnalysisPhase
): ImportedPhotoResultResolution {
    require(candidateTokens.isNotEmpty())
    val requested = candidateTokens.toSet()
    cards.firstOrNull { it.candidateToken in requested }?.let {
        return ImportedPhotoResultResolution.CardReady(it.cardId)
    }

    val requestedCandidates = candidates.filter { it.candidateToken in requested }
    if (requestedCandidates.mapTo(mutableSetOf()) { it.candidateToken }.size < requested.size) {
        return ImportedPhotoResultResolution.Pending
    }
    val states = requestedCandidates.map { it.analysisState }
    if (states.any { it in ACTIVE_IMPORT_STATES }) {
        return ImportedPhotoResultResolution.Pending
    }
    if (states.any { it == AnalysisState.COMPLETED }) {
        return when (analysisPhase) {
            AnalysisPhase.READY, AnalysisPhase.NO_MATCH -> ImportedPhotoResultResolution.NoMatch
            AnalysisPhase.FAILED -> ImportedPhotoResultResolution.Failed
            else -> ImportedPhotoResultResolution.Pending
        }
    }
    if (states.any { it == AnalysisState.FAILED || it == AnalysisState.ACCESS_UNAVAILABLE }) {
        return ImportedPhotoResultResolution.Failed
    }
    return ImportedPhotoResultResolution.NoMatch
}

private val ACTIVE_IMPORT_STATES = setOf(
    AnalysisState.DISCOVERED,
    AnalysisState.READY,
    AnalysisState.DEFERRED,
    AnalysisState.QUEUED
)
