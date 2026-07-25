package cn.jianwei.app

import cn.jianwei.domain.model.PendingReminderSchedule
import com.google.common.truth.Truth.assertThat
import java.io.IOException
import java.time.LocalDate
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.junit.Test

class ReminderSchedulingFlowTest {
    private val schedule = PendingReminderSchedule(
        cardId = "card-1",
        startedOn = LocalDate.of(2026, 7, 20),
        reminderDays = 90,
        version = 42L
    )

    @Test
    fun `durable reminder commits before replacing local Work`(): Unit = runBlocking {
        val events = mutableListOf<String>()

        val outcome = scheduleReminderFromUi(
            commitDurableReminder = { events += "room-pending"; schedule },
            scheduleLocalWork = { events += "enqueue-work" },
            acknowledgeLocalSchedule = { events += "room-ack"; true }
        )

        assertThat(outcome).isEqualTo(ReminderSchedulingOutcome.SCHEDULED)
        assertThat(events).containsExactly("room-pending", "enqueue-work", "room-ack").inOrder()
    }

    @Test
    fun `Room failure never replaces the previous Work`(): Unit = runBlocking {
        val events = mutableListOf<String>()

        val failure = runCatching {
            scheduleReminderFromUi(
                commitDurableReminder = {
                    events += "room-pending"
                    throw IOException("synthetic Room failure")
                },
                scheduleLocalWork = { events += "enqueue-work" },
                acknowledgeLocalSchedule = { events += "room-ack"; true }
            )
        }.exceptionOrNull()

        assertThat(failure).isInstanceOf(IOException::class.java)
        assertThat(events).containsExactly("room-pending")
    }

    @Test
    fun `Work failure leaves durable outbox pending and reports partial truth`(): Unit = runBlocking {
        val events = mutableListOf<String>()

        val outcome = scheduleReminderFromUi(
            commitDurableReminder = { events += "room-pending"; schedule },
            scheduleLocalWork = {
                events += "enqueue-work"
                throw IOException("synthetic WorkManager failure")
            },
            acknowledgeLocalSchedule = { events += "room-ack"; true }
        )

        assertThat(outcome).isEqualTo(ReminderSchedulingOutcome.SAVED_PENDING_SCHEDULE)
        assertThat(events).containsExactly("room-pending", "enqueue-work").inOrder()
        assertThat(reminderSchedulingMessage(outcome, schedule)).contains("调度暂未确认")
    }

    @Test
    fun `ack failure does not turn accepted Work into a false error`(): Unit = runBlocking {
        val outcome = scheduleReminderFromUi(
            commitDurableReminder = { schedule },
            scheduleLocalWork = {},
            acknowledgeLocalSchedule = { throw IOException("synthetic ack failure") }
        )

        assertThat(outcome).isEqualTo(ReminderSchedulingOutcome.SCHEDULED)
    }

    @Test
    fun `coroutine cancellation propagates with durable outbox left for recovery`(): Unit = runBlocking {
        val failure = runCatching {
            scheduleReminderFromUi(
                commitDurableReminder = { schedule },
                scheduleLocalWork = { throw CancellationException("scope stopped") },
                acknowledgeLocalSchedule = { true }
            )
        }.exceptionOrNull()

        assertThat(failure).isInstanceOf(CancellationException::class.java)
    }

    @Test
    fun `stale startup recovery cannot replace a newer reminder Work`(): Unit = runBlocking {
        val events = mutableListOf<String>()

        val outcome = reconcilePendingReminderScheduleIfCurrent(
            schedule = schedule,
            isStillPending = { events += "check-version"; false },
            scheduleLocalWork = { events += "enqueue-stale-work" },
            acknowledgeLocalSchedule = { events += "ack-stale-version"; true }
        )

        assertThat(outcome).isNull()
        assertThat(events).containsExactly("check-version")
    }
}
