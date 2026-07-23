package cn.jianwei.app

import com.google.common.truth.Truth.assertThat
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import org.junit.Test

class ItemReminderPolicyTest {
    private val china = ZoneId.of("Asia/Shanghai")

    @Test
    fun `requires a user-confirmed non-future start date and bounded period`() {
        val today = LocalDate.of(2026, 7, 18)

        assertThat(isValidItemReminderDraft(today, 90, today)).isTrue()
        assertThat(isValidItemReminderDraft(today.minusDays(20), 120, today)).isTrue()
        assertThat(isValidItemReminderDraft(today.plusDays(1), 90, today)).isFalse()
        assertThat(isValidItemReminderDraft(today, 6, today)).isFalse()
        assertThat(isValidItemReminderDraft(today, 731, today)).isFalse()
    }

    @Test
    fun `schedules at nine in China on the confirmed due date`() {
        val trigger = itemReminderTriggerAt(LocalDate.of(2026, 7, 18), 90, china)

        assertThat(trigger).isEqualTo(Instant.parse("2026-10-16T01:00:00Z"))
    }

    @Test
    fun `overdue reminders run immediately instead of using a negative delay`() {
        val delay = itemReminderDelayMillis(
            startedOn = LocalDate.of(2026, 1, 1),
            reminderDays = 30,
            now = Instant.parse("2026-07-18T00:00:00Z"),
            zone = china
        )

        assertThat(delay).isEqualTo(0L)
    }

    @Test
    fun `unique work name is stable per card without using the title`() {
        assertThat(itemReminderWorkName("card-123")).isEqualTo("item-reminder-card-123")
        assertThat(stableReminderNotificationId("card-123"))
            .isEqualTo(stableReminderNotificationId("card-123"))
    }
}
