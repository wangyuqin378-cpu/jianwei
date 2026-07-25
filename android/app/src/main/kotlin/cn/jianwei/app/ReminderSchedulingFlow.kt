package cn.jianwei.app

import cn.jianwei.domain.model.PendingReminderSchedule
import kotlinx.coroutines.CancellationException

internal enum class ReminderSchedulingOutcome {
    SCHEDULED,
    SAVED_PENDING_SCHEDULE
}

/**
 * Commits the desired reminder before replacing any existing WorkManager request. The pending
 * bit is a durable local outbox: a crash or scheduling failure leaves enough state for the next
 * app process to retry without guessing which reminder parameters are authoritative.
 */
internal suspend fun scheduleReminderFromUi(
    commitDurableReminder: suspend () -> PendingReminderSchedule,
    scheduleLocalWork: (PendingReminderSchedule) -> Unit,
    acknowledgeLocalSchedule: suspend (PendingReminderSchedule) -> Boolean
): ReminderSchedulingOutcome {
    val schedule = commitDurableReminder()
    return reconcilePendingReminderSchedule(
        schedule = schedule,
        scheduleLocalWork = scheduleLocalWork,
        acknowledgeLocalSchedule = acknowledgeLocalSchedule
    )
}

internal suspend fun reconcilePendingReminderSchedule(
    schedule: PendingReminderSchedule,
    scheduleLocalWork: (PendingReminderSchedule) -> Unit,
    acknowledgeLocalSchedule: suspend (PendingReminderSchedule) -> Boolean
): ReminderSchedulingOutcome {
    try {
        scheduleLocalWork(schedule)
    } catch (cancellation: CancellationException) {
        throw cancellation
    } catch (_: Exception) {
        return ReminderSchedulingOutcome.SAVED_PENDING_SCHEDULE
    }

    try {
        acknowledgeLocalSchedule(schedule)
    } catch (cancellation: CancellationException) {
        throw cancellation
    } catch (_: Exception) {
        // WorkManager has durably accepted the unique request. Leaving the Room outbox pending
        // is safe: recovery may replace it with the same absolute due date and then acknowledge.
    }
    return ReminderSchedulingOutcome.SCHEDULED
}

internal suspend fun reconcilePendingReminderScheduleIfCurrent(
    schedule: PendingReminderSchedule,
    isStillPending: suspend (PendingReminderSchedule) -> Boolean,
    scheduleLocalWork: (PendingReminderSchedule) -> Unit,
    acknowledgeLocalSchedule: suspend (PendingReminderSchedule) -> Boolean
): ReminderSchedulingOutcome? {
    if (!isStillPending(schedule)) return null
    return reconcilePendingReminderSchedule(
        schedule = schedule,
        scheduleLocalWork = scheduleLocalWork,
        acknowledgeLocalSchedule = acknowledgeLocalSchedule
    )
}

internal fun reminderSchedulingMessage(
    outcome: ReminderSchedulingOutcome,
    schedule: PendingReminderSchedule
): String = when (outcome) {
    ReminderSchedulingOutcome.SCHEDULED ->
        "已设置物品提醒；预计 ${schedule.startedOn.plusDays(schedule.reminderDays.toLong())} 上午送达，系统省电可能造成延迟"
    ReminderSchedulingOutcome.SAVED_PENDING_SCHEDULE ->
        "提醒设置已保存；本地调度暂未确认，重新打开见微时会自动补齐"
}
