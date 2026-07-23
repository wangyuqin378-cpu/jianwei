package cn.jianwei.app.widget

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.work.WorkInfo
import androidx.work.WorkManager
import com.google.common.truth.Truth.assertThat
import java.time.Instant
import java.time.LocalDate
import kotlinx.coroutines.runBlocking
import org.junit.Test

class DailyWidgetRefreshInstrumentedTest {
    @Test
    fun schedulesSevenIndependentCalendarDayRefreshes() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val manager = WorkManager.getInstance(context)
        manager.cancelAllWorkByTag(DAILY_WIDGET_REFRESH_TAG).result.get()
        manager.cancelUniqueWork(IMMEDIATE_WIDGET_REFRESH_WORK).result.get()
        manager.pruneWork().result.get()
        val now = Instant.parse("2099-07-20T16:06:00Z")
        val days = (0L..6L).map { LocalDate.of(2099, 7, 22).plusDays(it) }

        try {
            scheduleFutureDailyWidgetRefreshes(
                context,
                java.time.Clock.fixed(now, java.time.ZoneOffset.UTC)
            )

            val active = setOf(WorkInfo.State.ENQUEUED, WorkInfo.State.RUNNING, WorkInfo.State.BLOCKED)
            val firstIds = days.associateWith { day ->
                manager.getWorkInfosForUniqueWork(widgetRefreshWorkName(day)).get()
                    .single { it.state in active }
                    .id
            }
            scheduleFutureDailyWidgetRefreshes(
                context,
                java.time.Clock.fixed(now, java.time.ZoneOffset.UTC)
            )
            days.forEach { day ->
                val work = manager.getWorkInfosForUniqueWork(widgetRefreshWorkName(day)).get()
                assertThat(work.count { it.state in active }).isEqualTo(1)
                assertThat(work.single { it.state in active }.id).isEqualTo(firstIds.getValue(day))
            }
            val tagged = manager.getWorkInfosByTag(DAILY_WIDGET_REFRESH_TAG).get()
                .filter { it.state in active }
            assertThat(tagged).hasSize(7)
        } finally {
            manager.cancelAllWorkByTag(DAILY_WIDGET_REFRESH_TAG).result.get()
            manager.cancelUniqueWork(IMMEDIATE_WIDGET_REFRESH_WORK).result.get()
            days.forEach { manager.cancelUniqueWork(widgetRefreshWorkName(it)).result.get() }
        }
    }
}
