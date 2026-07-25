package cn.jianwei.app

import kotlinx.coroutines.CancellationException

/**
 * Orders the UI-owned parts of cloud deletion around the repository's crash-safe remote/Room
 * transaction. A failed remote deletion must leave local reminder work intact, while a successful
 * deletion makes any stale reminder harmless through the worker's durable Room check.
 */
internal suspend fun completeCloudDeletionFromUi(
    pauseAndCancelAnalysis: suspend () -> Unit,
    publishPauseState: () -> Unit,
    deleteCloudData: suspend () -> Unit,
    cancelReminderWork: suspend () -> Unit,
    clearTransientUiState: () -> Unit
) {
    pauseAndPublishAnalysisState(pauseAndCancelAnalysis, publishPauseState)
    try {
        deleteCloudData()
    } catch (cancellation: CancellationException) {
        throw cancellation
    } catch (error: Exception) {
        throw CloudDeletionIncompleteException(error)
    }
    // Room no longer contains an active tracked item after successful deletion, so the worker's
    // final durable check suppresses any stale request even if WorkManager cancellation fails.
    try {
        cancelReminderWork()
    } catch (cancellation: CancellationException) {
        throw cancellation
    } catch (_: Exception) {
        // The deleted Room row is the notification authority; stale Work is already harmless.
    } finally {
        clearTransientUiState()
    }
}

internal suspend fun pauseAndPublishAnalysisState(
    pauseAndCancelAnalysis: suspend () -> Unit,
    publishPauseState: () -> Unit
) {
    try {
        pauseAndCancelAnalysis()
    } finally {
        publishPauseState()
    }
}

internal class CloudDeletionIncompleteException(cause: Throwable) : Exception(
    "分析已暂停；删除流程尚未完成，请检查网络后重试。未确认前不会继续分析",
    cause
)
