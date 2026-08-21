package cn.jianwei.data.widget

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.SharedPreferencesMigration
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringSetPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

data class WidgetPersistentState(
    val day: String?,
    val currentCardId: String?,
    val switchCount: Int
)

data class WidgetAdvanceResult(
    val state: WidgetPersistentState,
    val switched: Boolean
)

/**
 * Owns the complete widget selection/quota transition. The process-wide mutex covers every widget
 * instance and DataStore persists each serialized update before returning, so rapid taps, refresh
 * work, and a later process cannot overwrite one another with stale state.
 */
class WidgetStateStore internal constructor(
    private val dataStore: DataStore<Preferences>
) {
    suspend fun selectForDisplay(
        today: String,
        orderedCardIds: List<String>,
        preferredCardId: String?
    ): WidgetPersistentState = widgetStateUpdateMutex.withLock {
        val eligible = orderedCardIds.distinct()
        var selected: WidgetPersistentState? = null
        dataStore.edit { preferences ->
            val persisted = preferences.toState()
            val normalized = if (persisted.isNewerThan(today)) {
                persisted
            } else {
                normalize(persisted, today, eligible, preferredCardId)
            }
            val seen = when {
                persisted.isNewerThan(today) -> preferences[KEY_SEEN_CARD_IDS].orEmpty()
                persisted.day != today -> setOfNotNull(normalized.currentCardId)
                else -> preferences[KEY_SEEN_CARD_IDS].orEmpty()
                    .intersect(eligible.toSet()) + setOfNotNull(normalized.currentCardId)
            }
            preferences.write(normalized, seen)
            selected = normalized
        }
        checkNotNull(selected)
    }

    suspend fun tryAdvance(
        today: String,
        orderedCardIds: List<String>,
        preferredCardId: String?
    ): WidgetAdvanceResult = widgetStateUpdateMutex.withLock {
        val eligible = orderedCardIds.distinct()
        var result: WidgetAdvanceResult? = null
        dataStore.edit { preferences ->
            val persisted = preferences.toState()
            if (persisted.isNewerThan(today)) {
                result = WidgetAdvanceResult(persisted, switched = false)
                return@edit
            }
            val current = normalize(persisted, today, eligible, preferredCardId)
            val seen = if (persisted.day != today) {
                setOfNotNull(current.currentCardId)
            } else {
                preferences[KEY_SEEN_CARD_IDS].orEmpty()
                    .intersect(eligible.toSet()) + setOfNotNull(current.currentCardId)
            }
            val next = if (current.switchCount < MAX_DAILY_WIDGET_SWITCHES) {
                eligible.firstOrNull { cardId -> cardId !in seen }
            } else {
                null
            }
            val updated = if (next == null) current else current.copy(
                currentCardId = next,
                switchCount = current.switchCount + 1
            )
            preferences.write(updated, if (next == null) seen else seen + next)
            result = WidgetAdvanceResult(updated, switched = next != null)
        }
        checkNotNull(result)
    }

    suspend fun read(): WidgetPersistentState = dataStore.data.first().toState()

    fun observe(): Flow<WidgetPersistentState> =
        dataStore.data.map(Preferences::toState).distinctUntilChanged()

    private fun normalize(
        state: WidgetPersistentState,
        today: String,
        orderedCardIds: List<String>,
        preferredCardId: String?
    ): WidgetPersistentState {
        val preferred = preferredCardId?.takeIf(orderedCardIds::contains) ?: orderedCardIds.firstOrNull()
        if (state.day != today) return WidgetPersistentState(today, preferred, 0)
        return WidgetPersistentState(
            day = today,
            currentCardId = state.currentCardId?.takeIf(orderedCardIds::contains) ?: preferred,
            switchCount = state.switchCount.coerceIn(0, MAX_DAILY_WIDGET_SWITCHES)
        )
    }
}

fun widgetStateStore(context: Context): WidgetStateStore = WidgetStateStore(context.dailyWidgetDataStore)

private fun Preferences.toState() = WidgetPersistentState(
    day = this[KEY_CARD_DAY],
    currentCardId = this[KEY_CARD_ID],
    switchCount = this[KEY_SWITCH_COUNT] ?: 0
)

// Widget callbacks can outlive midnight. ISO-8601 days sort chronologically, so an older callback
// must never roll persisted quota state backwards or open a second reset window for the new day.
private fun WidgetPersistentState.isNewerThan(requestedDay: String): Boolean =
    day != null && day > requestedDay

private fun androidx.datastore.preferences.core.MutablePreferences.write(
    state: WidgetPersistentState,
    seenCardIds: Set<String>
) {
    if (state.day == null) remove(KEY_CARD_DAY) else this[KEY_CARD_DAY] = state.day
    if (state.currentCardId == null) remove(KEY_CARD_ID) else this[KEY_CARD_ID] = state.currentCardId
    this[KEY_SWITCH_COUNT] = state.switchCount
    this[KEY_SEEN_CARD_IDS] = seenCardIds
}

private val Context.dailyWidgetDataStore by preferencesDataStore(
    name = "daily_widget_state",
    produceMigrations = { context -> listOf(SharedPreferencesMigration(context, LEGACY_WIDGET_PREFS)) }
)

internal val KEY_CARD_ID = stringPreferencesKey("card_id")
internal val KEY_CARD_DAY = stringPreferencesKey("card_day")
internal val KEY_SWITCH_COUNT = intPreferencesKey("switch_count")
internal val KEY_SEEN_CARD_IDS = stringSetPreferencesKey("seen_card_ids")

const val MAX_DAILY_WIDGET_SWITCHES = 2
private const val LEGACY_WIDGET_PREFS = "daily_widget"
private val widgetStateUpdateMutex = Mutex()
