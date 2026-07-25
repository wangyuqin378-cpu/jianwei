package cn.jianwei.data.local

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Test

class TrackedItemLifecycleInstrumentedTest {
    @Test
    fun activeReminderSurvivesSyncAndCancellationRemainsQueuedUntilAcknowledged() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val database = Room.inMemoryDatabaseBuilder(context, JianweiDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        try {
            val cards = database.cards()
            cards.upsertTrackedItem(
                TrackedItemEntity("card-1", "2026-07-18", 90, "UPSERT", 1)
            )
            assertThat(cards.observeTrackedItems().first().single().reminderDays).isEqualTo(90)
            assertThat(cards.pendingTrackedItems().single().syncAction).isEqualTo("UPSERT")

            cards.markTrackedItemSynced("card-1", 1)
            assertThat(cards.pendingTrackedItems()).isEmpty()
            assertThat(cards.observeTrackedItems().first().single().syncAction).isEqualTo("NONE")

            val active = cards.findTrackedItem("card-1")!!
            cards.upsertTrackedItem(active.copy(syncAction = "DELETE", updatedAtMillis = 2))
            assertThat(cards.observeTrackedItems().first()).isEmpty()
            assertThat(cards.pendingTrackedItems().single().syncAction).isEqualTo("DELETE")

            cards.removeTrackedItem("card-1")
            assertThat(cards.pendingTrackedItems()).isEmpty()
        } finally {
            database.close()
        }
    }

    @Test
    fun staleNetworkAcknowledgementsCannotOverwriteNewerReminderChoices() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val database = Room.inMemoryDatabaseBuilder(context, JianweiDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        try {
            val cards = database.cards()
            cards.upsertTrackedItem(
                TrackedItemEntity("card-1", "2026-07-18", 90, "UPSERT", 1)
            )
            cards.upsertTrackedItem(
                TrackedItemEntity("card-1", "2026-07-19", 120, "UPSERT", 2)
            )
            assertThat(cards.markTrackedItemSynced("card-1", 1)).isEqualTo(0)
            assertThat(cards.findTrackedItem("card-1")!!.reminderDays).isEqualTo(120)
            assertThat(cards.findTrackedItem("card-1")!!.syncAction).isEqualTo("UPSERT")

            cards.upsertTrackedItem(
                TrackedItemEntity("card-1", "2026-07-19", 120, "DELETE", 3)
            )
            cards.upsertTrackedItem(
                TrackedItemEntity("card-1", "2026-07-20", 180, "UPSERT", 4)
            )
            assertThat(cards.removeTrackedItemIfMatches("card-1", "DELETE", 3)).isEqualTo(0)
            assertThat(cards.findTrackedItem("card-1")!!.reminderDays).isEqualTo(180)
        } finally {
            database.close()
        }
    }

    @Test
    fun localScheduleOutboxOnlyAcknowledgesTheExactDurableReminderVersion() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val database = Room.inMemoryDatabaseBuilder(context, JianweiDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        try {
            val cards = database.cards()
            cards.upsertTrackedItem(
                TrackedItemEntity(
                    cardId = "card-1",
                    startedOn = "2026-07-20",
                    reminderDays = 90,
                    syncAction = "UPSERT",
                    updatedAtMillis = 10,
                    localSchedulePending = true
                )
            )
            assertThat(cards.observePendingReminderSchedules().first().single().updatedAtMillis)
                .isEqualTo(10L)

            cards.upsertTrackedItem(
                TrackedItemEntity(
                    cardId = "card-1",
                    startedOn = "2026-07-21",
                    reminderDays = 120,
                    syncAction = "UPSERT",
                    updatedAtMillis = 11,
                    localSchedulePending = true
                )
            )
            assertThat(
                cards.markReminderScheduled("card-1", "2026-07-20", 90, 10)
            ).isEqualTo(0)
            assertThat(
                cards.isReminderSchedulePending("card-1", "2026-07-20", 90, 10)
            ).isFalse()
            assertThat(
                cards.isReminderSchedulePending("card-1", "2026-07-21", 120, 11)
            ).isTrue()
            assertThat(cards.observePendingReminderSchedules().first().single().updatedAtMillis)
                .isEqualTo(11L)

            assertThat(
                cards.markReminderScheduled("card-1", "2026-07-21", 120, 11)
            ).isEqualTo(1)
            assertThat(cards.observePendingReminderSchedules().first()).isEmpty()
            assertThat(cards.findTrackedItem("card-1")!!.localSchedulePending).isFalse()
        } finally {
            database.close()
        }
    }
}
