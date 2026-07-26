package cn.jianwei.app.widget

import android.content.Context
import androidx.glance.appwidget.updateAll
import androidx.work.BackoffPolicy
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import cn.jianwei.domain.coroutines.throwIfCancellation
import cn.jianwei.domain.time.ChinaCalendar
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZonedDateTime

/** Refreshes the local-only widget even while analysis is paused or the device is offline. */
class DailyWidgetRefreshWorker(
    context: Context,
    parameters: WorkerParameters
) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result = runCatching {
        DailyWidget().updateAll(applicationContext)
        scheduleFutureDailyWidgetRefreshes(applicationContext)
        Result.success()
    }.getOrElse { error ->
        error.throwIfCancellation()
        Result.retry()
    }
}

internal fun scheduleDailyWidgetRefresh(
    context: Context,
    clock: Clock = Clock.systemUTC()
) {
    val manager = WorkManager.getInstance(context)
    manager.cancelUniqueWork(LEGACY_DAILY_WIDGET_REFRESH_WORK)
    manager.enqueueUniqueWork(
        IMMEDIATE_WIDGET_REFRESH_WORK,
        widgetRefreshExistingWorkPolicy(),
        widgetRefreshRequest(Duration.ZERO)
    )
    scheduleFutureDailyWidgetRefreshes(context, clock)
}

internal fun scheduleFutureDailyWidgetRefreshes(
    context: Context,
    clock: Clock = Clock.systemUTC()
) {
    val manager = WorkManager.getInstance(context)
    nextDailyWidgetRefreshSlots(clock.instant()).forEach { slot ->
        manager.enqueueUniqueWork(
            widgetRefreshWorkName(slot.day),
            widgetRefreshExistingWorkPolicy(),
            widgetRefreshRequest(slot.delay)
        )
    }
}

internal data class DailyWidgetRefreshSlot(
    val day: LocalDate,
    val delay: Duration
)

/**
 * WorkManager is intentionally inexact, but each Chinese calendar day receives an independent,
 * durable request. A delayed OEM job therefore cannot move every later refresh to the wrong side
 * of midnight, and any job that does run replenishes the following seven-day window.
 */
internal fun nextDailyWidgetRefreshSlots(
    now: Instant,
    count: Int = FUTURE_REFRESH_DAYS
): List<DailyWidgetRefreshSlot> {
    require(count in 1..MAX_FUTURE_REFRESH_DAYS)
    val zonedNow = now.atZone(ChinaCalendar.zone)
    val firstDay = if (zonedNow.toLocalTime() < DAILY_REFRESH_TIME) {
        zonedNow.toLocalDate()
    } else {
        zonedNow.toLocalDate().plusDays(1)
    }
    return List(count) { offset ->
        val day = firstDay.plusDays(offset.toLong())
        val target = ZonedDateTime.of(day, DAILY_REFRESH_TIME, ChinaCalendar.zone).toInstant()
        DailyWidgetRefreshSlot(day, Duration.between(now, target).coerceAtLeast(Duration.ZERO))
    }
}

internal fun widgetRefreshWorkName(day: LocalDate): String = "$DAILY_WIDGET_REFRESH_PREFIX$day"

internal fun widgetRefreshExistingWorkPolicy(): ExistingWorkPolicy = ExistingWorkPolicy.KEEP

private fun widgetRefreshRequest(delay: Duration) =
    OneTimeWorkRequestBuilder<DailyWidgetRefreshWorker>()
        .setInitialDelay(delay)
        .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, Duration.ofMinutes(15))
        .addTag(DAILY_WIDGET_REFRESH_TAG)
        .build()

private fun Duration.coerceAtLeast(minimum: Duration): Duration = if (this < minimum) minimum else this

internal const val DAILY_WIDGET_REFRESH_TAG = "jianwei-daily-widget-refresh"
internal const val LEGACY_DAILY_WIDGET_REFRESH_WORK = "jianwei-daily-widget-refresh"
internal const val IMMEDIATE_WIDGET_REFRESH_WORK = "jianwei-widget-refresh-now-v2"
private const val DAILY_WIDGET_REFRESH_PREFIX = "jianwei-widget-refresh-day-v2-"
private const val FUTURE_REFRESH_DAYS = 7
private const val MAX_FUTURE_REFRESH_DAYS = 31
private val DAILY_REFRESH_TIME: LocalTime = LocalTime.of(0, 5)
