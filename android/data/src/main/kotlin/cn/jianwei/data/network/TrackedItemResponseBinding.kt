package cn.jianwei.data.network

import java.io.IOException
import java.time.Instant
import java.time.LocalDate

private val TRACK_UUID_PATTERN = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
private val TRACK_DATE_PATTERN = Regex("^\\d{4}-\\d{2}-\\d{2}$")
private val TRACK_INSTANT_PATTERN = Regex("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$")

internal fun TrackItemResponse.requireBoundTo(
    expectedCardId: String,
    expectedStartedOn: String,
    expectedReminderDays: Int
) {
    val responseId = id
    val responseCardId = cardId
    val responseStartedOn = startedOn
    val responseReminderDays = reminderDays
    val responseCreatedAt = createdAt
    if (
        responseId == null || !TRACK_UUID_PATTERN.matches(responseId) ||
        responseCardId == null || !TRACK_UUID_PATTERN.matches(responseCardId) || responseCardId != expectedCardId ||
        responseStartedOn == null || responseStartedOn != expectedStartedOn || !isStrictDate(responseStartedOn) ||
        responseReminderDays == null || responseReminderDays != expectedReminderDays || responseReminderDays !in 7..730 ||
        responseCreatedAt == null || !TRACK_INSTANT_PATTERN.matches(responseCreatedAt) ||
        runCatching { Instant.parse(responseCreatedAt) }.isFailure
    ) {
        throw IOException("Tracked-item response is invalid or crossed the reminder boundary")
    }
}

internal fun UntrackItemResponse.requireBoundTo(expectedCardId: String) {
    val responseCardId = cardId
    if (
        responseCardId == null || !TRACK_UUID_PATTERN.matches(responseCardId) ||
        responseCardId != expectedCardId || status != "untracked"
    ) {
        throw IOException("Untrack response is invalid or crossed the reminder boundary")
    }
}

private fun isStrictDate(value: String): Boolean =
    TRACK_DATE_PATTERN.matches(value) && runCatching { LocalDate.parse(value) }.getOrNull()?.toString() == value
