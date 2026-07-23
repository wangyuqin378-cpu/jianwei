package cn.jianwei.app.widget

import com.google.common.truth.Truth.assertThat
import androidx.work.ExistingWorkPolicy
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import org.junit.Test

class DailyWidgetRefreshPolicyTest {
    @Test
    fun `before daily boundary includes the current China day`() {
        val slots = nextDailyWidgetRefreshSlots(Instant.parse("2026-07-20T16:02:00Z"))

        assertThat(slots).hasSize(7)
        assertThat(slots.first()).isEqualTo(
            DailyWidgetRefreshSlot(LocalDate.of(2026, 7, 21), Duration.ofMinutes(3))
        )
        assertThat(slots.last().day).isEqualTo(LocalDate.of(2026, 7, 27))
    }

    @Test
    fun `after daily boundary starts with the next China day`() {
        val slots = nextDailyWidgetRefreshSlots(Instant.parse("2026-07-20T16:06:00Z"))

        assertThat(slots.first()).isEqualTo(
            DailyWidgetRefreshSlot(
                LocalDate.of(2026, 7, 22),
                Duration.ofHours(23).plusMinutes(59)
            )
        )
        assertThat(slots.map { it.day }).containsExactly(
            LocalDate.of(2026, 7, 22),
            LocalDate.of(2026, 7, 23),
            LocalDate.of(2026, 7, 24),
            LocalDate.of(2026, 7, 25),
            LocalDate.of(2026, 7, 26),
            LocalDate.of(2026, 7, 27),
            LocalDate.of(2026, 7, 28)
        ).inOrder()
    }

    @Test
    fun `work name is stable and calendar scoped`() {
        assertThat(widgetRefreshWorkName(LocalDate.of(2026, 7, 21)))
            .isEqualTo("jianwei-widget-refresh-day-v2-2026-07-21")
    }

    @Test
    fun `unfinished immediate or calendar refresh is never replaced`() {
        assertThat(widgetRefreshExistingWorkPolicy()).isEqualTo(ExistingWorkPolicy.KEEP)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `refuses an unbounded future queue`() {
        nextDailyWidgetRefreshSlots(Instant.EPOCH, count = 32)
    }
}
