package cn.jianwei.domain.time

import com.google.common.truth.Truth.assertThat
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import org.junit.Test

class ChinaCalendarTest {
    @Test
    fun `China day advances at 16 UTC`() {
        val before = Clock.fixed(Instant.parse("2026-07-18T15:59:59Z"), ZoneOffset.UTC)
        val after = Clock.fixed(Instant.parse("2026-07-18T16:00:00Z"), ZoneOffset.UTC)

        assertThat(ChinaCalendar.today(before).toString()).isEqualTo("2026-07-18")
        assertThat(ChinaCalendar.today(after).toString()).isEqualTo("2026-07-19")
    }

    @Test
    fun `captured instant uses the same China calendar`() {
        assertThat(ChinaCalendar.dateOf(Instant.parse("2026-07-18T16:30:00Z")).toString())
            .isEqualTo("2026-07-19")
    }
}
