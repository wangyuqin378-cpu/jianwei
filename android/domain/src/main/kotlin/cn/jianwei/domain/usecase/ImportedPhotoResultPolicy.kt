package cn.jianwei.domain.usecase

import cn.jianwei.domain.model.AnalysisPhase
import cn.jianwei.domain.model.AnalysisState
import cn.jianwei.domain.model.KnowledgeCard
import cn.jianwei.domain.model.PhotoCandidate

sealed interface ImportedPhotoResultResolution {
    data object Pending : ImportedPhotoResultResolution
    data class CardReady(val cardId: String) : ImportedPhotoResultResolution
    data object NoMatch : ImportedPhotoResultResolution
    data class Failed(val canRetry: Boolean) : ImportedPhotoResultResolution
}

/**
 * A fresh Picker/Sharesheet selection is explicit consent to retry a terminal local attempt.
 * Active work and completed candidates retain their identity so retries remain idempotent and do
 * not create another model charge. NEVER_ANALYZE is an installation-level privacy stop and is
 * rejected by the repository before this policy is considered.
 */
fun shouldRestartExplicitImport(state: AnalysisState): Boolean = when (state) {
    AnalysisState.FILTERED,
    AnalysisState.FAILED,
    AnalysisState.ACCESS_UNAVAILABLE -> true
    else -> false
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
        // Tokens are only exposed after their Room candidates commit. Once the paired Room query
        // has emitted, a missing token cannot become analyzable again; it was cleared or replaced
        // across a crash boundary and the user must select the photo again.
        return ImportedPhotoResultResolution.Failed(canRetry = false)
    }
    val states = requestedCandidates.map { it.analysisState }
    if (analysisPhase == AnalysisPhase.FAILED) {
        if (states.any { it in RETRYABLE_IMPORT_STATES }) {
            return ImportedPhotoResultResolution.Failed(canRetry = true)
        }
        if (states.any { it == AnalysisState.FAILED || it == AnalysisState.ACCESS_UNAVAILABLE }) {
            return ImportedPhotoResultResolution.Failed(canRetry = false)
        }
    }
    if (states.any { it in ACTIVE_IMPORT_STATES }) {
        return ImportedPhotoResultResolution.Pending
    }
    if (states.any { it == AnalysisState.COMPLETED }) {
        return when (analysisPhase) {
            AnalysisPhase.READY, AnalysisPhase.NO_MATCH -> ImportedPhotoResultResolution.NoMatch
            else -> ImportedPhotoResultResolution.Pending
        }
    }
    if (states.any { it == AnalysisState.FAILED || it == AnalysisState.ACCESS_UNAVAILABLE }) {
        return ImportedPhotoResultResolution.Failed(canRetry = false)
    }
    return ImportedPhotoResultResolution.NoMatch
}

private val ACTIVE_IMPORT_STATES = setOf(
    AnalysisState.DISCOVERED,
    AnalysisState.READY,
    AnalysisState.DEFERRED,
    AnalysisState.QUEUED
)

private val RETRYABLE_IMPORT_STATES = ACTIVE_IMPORT_STATES + AnalysisState.COMPLETED
