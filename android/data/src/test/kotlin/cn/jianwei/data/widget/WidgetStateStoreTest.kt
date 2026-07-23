package cn.jianwei.data.widget

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.emptyPreferences
import com.google.common.truth.Truth.assertThat
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.junit.Test

class WidgetStateStoreTest {
    @Test
    fun `32 concurrent taps plus refreshes commit exactly two switches`() = runBlocking {
        val dataStore = InMemoryPreferencesDataStore()
        val store = WidgetStateStore(dataStore)
        store.selectForDisplay(DAY_ONE, CARDS, "first")

        val committed = raceTapsAndRefresh(store, DAY_ONE)

        assertThat(committed).isEqualTo(MAX_DAILY_WIDGET_SWITCHES)
        assertThat(store.read()).isEqualTo(WidgetPersistentState(DAY_ONE, "third", 2))
    }

    @Test
    fun `persisted quota survives store recreation`() = runBlocking {
        val firstDataStore = InMemoryPreferencesDataStore()
        val firstStore = WidgetStateStore(firstDataStore)
        firstStore.selectForDisplay(DAY_ONE, CARDS, "first")
        repeat(MAX_DAILY_WIDGET_SWITCHES) {
            assertThat(firstStore.tryAdvance(DAY_ONE, CARDS, "first").switched).isTrue()
        }

        val recreated = WidgetStateStore(InMemoryPreferencesDataStore(firstDataStore.snapshot()))

        assertThat(recreated.read()).isEqualTo(WidgetPersistentState(DAY_ONE, "third", 2))
        assertThat(recreated.tryAdvance(DAY_ONE, CARDS, "first").switched).isFalse()
    }

    @Test
    fun `switching never wraps back to a card already shown today`() = runBlocking {
        val store = WidgetStateStore(InMemoryPreferencesDataStore())
        val twoCards = listOf("first", "second")
        store.selectForDisplay(DAY_ONE, twoCards, "first")

        assertThat(store.tryAdvance(DAY_ONE, twoCards, "first").switched).isTrue()
        assertThat(store.read()).isEqualTo(WidgetPersistentState(DAY_ONE, "second", 1))

        assertThat(store.tryAdvance(DAY_ONE, twoCards, "first").switched).isFalse()
        assertThat(store.read()).isEqualTo(WidgetPersistentState(DAY_ONE, "second", 1))
    }

    @Test
    fun `next day resets once and still commits exactly two concurrent switches`() = runBlocking {
        val store = WidgetStateStore(InMemoryPreferencesDataStore())
        store.selectForDisplay(DAY_ONE, CARDS, "first")
        repeat(MAX_DAILY_WIDGET_SWITCHES) { store.tryAdvance(DAY_ONE, CARDS, "first") }

        val committed = raceTapsAndRefresh(store, DAY_TWO)

        assertThat(committed).isEqualTo(MAX_DAILY_WIDGET_SWITCHES)
        assertThat(store.read()).isEqualTo(WidgetPersistentState(DAY_TWO, "third", 2))
    }

    @Test
    fun `removed current card falls back without restoring same day quota`() = runBlocking {
        val store = WidgetStateStore(InMemoryPreferencesDataStore())
        store.selectForDisplay(DAY_ONE, CARDS, "first")
        repeat(MAX_DAILY_WIDGET_SWITCHES) { store.tryAdvance(DAY_ONE, CARDS, "first") }

        val normalized = store.selectForDisplay(DAY_ONE, listOf("first", "second"), "first")

        assertThat(normalized).isEqualTo(WidgetPersistentState(DAY_ONE, "first", 2))
        assertThat(store.tryAdvance(DAY_ONE, listOf("first", "second"), "first").switched).isFalse()
    }

    @Test
    fun `late previous-day callbacks cannot roll back the quota day`() = runBlocking {
        val store = WidgetStateStore(InMemoryPreferencesDataStore())
        store.selectForDisplay(DAY_TWO, CARDS, "first")
        repeat(MAX_DAILY_WIDGET_SWITCHES) { store.tryAdvance(DAY_TWO, CARDS, "first") }

        val staleRefresh = store.selectForDisplay(DAY_ONE, CARDS, "first")
        val staleTap = store.tryAdvance(DAY_ONE, CARDS, "first")
        val currentDayTap = store.tryAdvance(DAY_TWO, CARDS, "first")

        assertThat(staleRefresh).isEqualTo(WidgetPersistentState(DAY_TWO, "third", 2))
        assertThat(staleTap.switched).isFalse()
        assertThat(currentDayTap.switched).isFalse()
        assertThat(store.read()).isEqualTo(WidgetPersistentState(DAY_TWO, "third", 2))
    }

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
        const val DAY_ONE = "2026-07-20"
        const val DAY_TWO = "2026-07-21"
        val CARDS = listOf("first", "second", "third", "fourth")
    }
}

private class InMemoryPreferencesDataStore(
    initial: Preferences = emptyPreferences()
) : DataStore<Preferences> {
    private val mutex = Mutex()
    private val state = MutableStateFlow(initial)

    override val data: Flow<Preferences> = state

    override suspend fun updateData(transform: suspend (t: Preferences) -> Preferences): Preferences =
        mutex.withLock {
            transform(state.value).also { state.value = it }
        }

    fun snapshot(): Preferences = state.value
}
