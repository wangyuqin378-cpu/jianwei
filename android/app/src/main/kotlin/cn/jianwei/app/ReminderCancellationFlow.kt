package cn.jianwei.app

import kotlinx.coroutines.CancellationException

/**
 * Makes Room the authority for reminder cancellation. Once the durable row is marked for
 * deletion, an old WorkManager request is harmless because the worker rechecks that row before
 * notifying. A WorkManager cleanup failure must therefore not turn a committed cancellation into
 * a false UI error.
 */
internal suspend fun cancelReminderFromUi(
    commitDurableCancellation: suspend () -> Unit,
    cancelLocalWork: () -> Unit
) {
    commitDurableCancellation()
    bestEffortCancelLocalReminderWork(cancelLocalWork)
}

internal fun bestEffortCancelLocalReminderWork(cancelLocalWork: () -> Unit) {
    try {
        cancelLocalWork()
    } catch (cancellation: CancellationException) {
        throw cancellation
    } catch (_: Exception) {
        // The durable tracked-item state is the notification authority.
    }
}
