package cn.jianwei.app

import kotlinx.coroutines.CancellationException

/**
 * Clears photo-derived local state only after every analysis worker has stopped. Keeping analysis
 * paused makes the user's deletion stable until they explicitly choose to rebuild the index.
 */
internal suspend fun clearLocalIndexFromUi(
    pauseAndCancelAnalysis: suspend () -> Unit,
    publishPauseState: () -> Unit,
    clearCardPhotoReferences: suspend () -> Unit,
    clearPhotoIndex: suspend () -> Unit,
    clearTransientUiState: () -> Unit
) {
    pauseAndPublishAnalysisState(pauseAndCancelAnalysis, publishPauseState)
    try {
        clearCardPhotoReferences()
        clearPhotoIndex()
    } catch (cancellation: CancellationException) {
        throw cancellation
    } catch (error: Exception) {
        throw LocalIndexClearIncompleteException(error)
    }
    clearTransientUiState()
}

internal class LocalIndexClearIncompleteException(cause: Throwable) : Exception(
    "分析已暂停；本地照片索引尚未完全清除，请重试",
    cause
)
