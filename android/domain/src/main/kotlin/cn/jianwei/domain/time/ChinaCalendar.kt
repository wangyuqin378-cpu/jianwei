package cn.jianwei.domain.time

import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

object ChinaCalendar {
    val zone: ZoneId = ZoneId.of("Asia/Shanghai")

    fun today(clock: Clock = Clock.systemUTC()): LocalDate = LocalDate.now(clock.withZone(zone))

    fun dateOf(instant: Instant): LocalDate = instant.atZone(zone).toLocalDate()
}
