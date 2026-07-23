package cn.jianwei.data.widget

import android.content.Context
import androidx.datastore.preferences.SharedPreferencesMigration
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import java.io.File
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.runBlocking
import org.junit.Test

class WidgetStateStoreInstrumentedTest {
    @Test
    fun legacyStateMigratesAndAtomicQuotaSurvivesFileRecreationAndNextDay() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val suffix = System.nanoTime().toString()
        val legacyName = "widget-state-legacy-$suffix"
        val dataFile = File(context.filesDir, "datastore/widget-state-$suffix.preferences_pb")
        context.getSharedPreferences(legacyName, Context.MODE_PRIVATE).edit()
            .putString("card_day", DAY_ZERO)
            .putString("card_id", "second")
            .putInt("switch_count", 1)
            .commit()

        val firstJob = SupervisorJob()
        val firstStore = open(context, legacyName, dataFile, firstJob)
        try {
            assertThat(firstStore.read()).isEqualTo(WidgetPersistentState(DAY_ZERO, "second", 1))

            val firstDayCommitted = raceTapsAndRefresh(firstStore, DAY_ONE)
            assertThat(firstDayCommitted).isEqualTo(MAX_DAILY_WIDGET_SWITCHES)
            assertThat(firstStore.read()).isEqualTo(WidgetPersistentState(DAY_ONE, "third", 2))
        } finally {
            firstJob.cancelAndJoin()
        }

        val recreatedJob = SupervisorJob()
        val recreated = open(context, legacyName, dataFile, recreatedJob)
        try {
            assertThat(recreated.read()).isEqualTo(WidgetPersistentState(DAY_ONE, "third", 2))
            assertThat(recreated.tryAdvance(DAY_ONE, CARDS, "first").switched).isFalse()

            val nextDayCommitted = raceTapsAndRefresh(recreated, DAY_TWO)
            assertThat(nextDayCommitted).isEqualTo(MAX_DAILY_WIDGET_SWITCHES)
            assertThat(recreated.read()).isEqualTo(WidgetPersistentState(DAY_TWO, "third", 2))

            assertThat(recreated.selectForDisplay(DAY_ONE, CARDS, "first"))
                .isEqualTo(WidgetPersistentState(DAY_TWO, "third", 2))
            assertThat(recreated.tryAdvance(DAY_ONE, CARDS, "first").switched).isFalse()
            assertThat(recreated.tryAdvance(DAY_TWO, CARDS, "first").switched).isFalse()
            assertThat(recreated.read()).isEqualTo(WidgetPersistentState(DAY_TWO, "third", 2))
        } finally {
            recreatedJob.cancelAndJoin()
            context.deleteSharedPreferences(legacyName)
            dataFile.delete()
        }
    }

    private fun open(
        context: Context,
        legacyName: String,
        dataFile: File,
        job: Job
    ): WidgetStateStore = WidgetStateStore(
        PreferenceDataStoreFactory.create(
            migrations = listOf(SharedPreferencesMigration(context, legacyName)),
            scope = CoroutineScope(job + Dispatchers.IO),
            produceFile = { dataFile }
        )
    )

    private suspend fun raceTapsAndRefresh(store: WidgetStateStore, today: String): Int = coroutineScope {
        val start = CompletableDeferred<Unit>()
        val taps = (0 until 32).map {
            async(Dispatchers.Default) {
                start.await()
                store.tryAdvance(today, CARDS, "first").switched
            }
        }
        val refreshes = (0 until 32).map {
            async(Dispatchers.Default) {
                start.await()
                store.selectForDisplay(today, CARDS, "first")
            }
        }
        start.complete(Unit)
        val committed = taps.awaitAll().count { it }
        refreshes.awaitAll()
        committed
    }

    private companion object {
        const val DAY_ZERO = "2026-07-19"
        const val DAY_ONE = "2026-07-20"
        const val DAY_TWO = "2026-07-21"
        val CARDS = listOf("first", "second", "third", "fourth")
    }
}
