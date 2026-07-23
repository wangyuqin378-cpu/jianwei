package cn.jianwei.app

import cn.jianwei.domain.time.ChinaCalendar
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId

internal val ITEM_REMINDER_DAY_OPTIONS = listOf(30, 60, 90, 120, 180)

internal fun isValidItemReminderDraft(
    startedOn: LocalDate,
    reminderDays: Int,
    today: LocalDate = ChinaCalendar.today()
): Boolean = !startedOn.isAfter(today) && reminderDays in 7..730

internal fun itemReminderTriggerAt(
    startedOn: LocalDate,
    reminderDays: Int,
    zone: ZoneId = ChinaCalendar.zone,
    localTime: LocalTime = LocalTime.of(9, 0)
): Instant {
    require(reminderDays in 7..730) { "Reminder period must be between 7 and 730 days" }
    return startedOn.plusDays(reminderDays.toLong()).atTime(localTime).atZone(zone).toInstant()
}

internal fun itemReminderDelayMillis(
    startedOn: LocalDate,
    reminderDays: Int,
    now: Instant,
    zone: ZoneId = ChinaCalendar.zone
): Long = Duration.between(now, itemReminderTriggerAt(startedOn, reminderDays, zone))
    .toMillis()
    .coerceAtLeast(0L)
