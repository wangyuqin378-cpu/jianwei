package cn.jianwei.data.status

import android.content.Context
import android.content.SharedPreferences
import cn.jianwei.domain.model.AnalysisPhase
import cn.jianwei.domain.model.AnalysisProgress
import cn.jianwei.domain.model.AnalysisProgressScope
import cn.jianwei.domain.repository.AnalysisStatusRepository
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.distinctUntilChanged

@Singleton
class SharedPreferencesAnalysisStatusRepository @Inject constructor(
    @ApplicationContext context: Context
) : AnalysisStatusRepository {
    private val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

    init {
        migrateLegacyProgress()
    }

    override fun observeProgress(scope: AnalysisProgressScope): Flow<AnalysisProgress> = callbackFlow {
        val statusKeys = statusKeys(scope)
        val listener = SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
            if (key in statusKeys) trySend(readProgress(scope))
        }
        trySend(readProgress(scope))
        preferences.registerOnSharedPreferenceChangeListener(listener)
        awaitClose { preferences.unregisterOnSharedPreferenceChangeListener(listener) }
    }.distinctUntilChanged()

    override fun publishProgress(scope: AnalysisProgressScope, progress: AnalysisProgress) {
        preferences.edit()
            .putString(key(scope, KEY_PHASE), progress.phase.name)
            .putInt(key(scope, KEY_DISCOVERED), progress.discoveredCount.coerceAtLeast(0))
            .putInt(key(scope, KEY_ELIGIBLE), progress.eligibleCount.coerceAtLeast(0))
            .putInt(key(scope, KEY_CACHED_CARDS), progress.cachedCardCount.coerceAtLeast(0))
            .apply {
                if (progress.detail == null) remove(key(scope, KEY_DETAIL))
                else putString(key(scope, KEY_DETAIL), progress.detail)
            }
            .apply()
    }

    private fun readProgress(scope: AnalysisProgressScope): AnalysisProgress {
        val phase = preferences.getString(key(scope, KEY_PHASE), null)
            ?.let { runCatching { AnalysisPhase.valueOf(it) }.getOrNull() }
            ?: AnalysisPhase.IDLE
        return AnalysisProgress(
            phase = phase,
            discoveredCount = preferences.getInt(key(scope, KEY_DISCOVERED), 0).coerceAtLeast(0),
            eligibleCount = preferences.getInt(key(scope, KEY_ELIGIBLE), 0).coerceAtLeast(0),
            cachedCardCount = preferences.getInt(key(scope, KEY_CACHED_CARDS), 0).coerceAtLeast(0),
            detail = preferences.getString(key(scope, KEY_DETAIL), null)
        )
    }

    /** Existing installs had one unscoped status. Preserve it as automatic discovery only. */
    private fun migrateLegacyProgress() = synchronized(preferences) {
        if (!preferences.contains(KEY_PHASE)) return@synchronized
        val scope = AnalysisProgressScope.AUTOMATIC_DISCOVERY
        val editor = preferences.edit()
        if (!preferences.contains(key(scope, KEY_PHASE))) {
            editor
                .putString(key(scope, KEY_PHASE), preferences.getString(KEY_PHASE, AnalysisPhase.IDLE.name))
                .putInt(key(scope, KEY_DISCOVERED), preferences.getInt(KEY_DISCOVERED, 0).coerceAtLeast(0))
                .putInt(key(scope, KEY_ELIGIBLE), preferences.getInt(KEY_ELIGIBLE, 0).coerceAtLeast(0))
                .putInt(key(scope, KEY_CACHED_CARDS), preferences.getInt(KEY_CACHED_CARDS, 0).coerceAtLeast(0))
            val detail = preferences.getString(KEY_DETAIL, null)
                ?: preferences.getString(LEGACY_KEY_MESSAGE, null)
            if (detail != null) editor.putString(key(scope, KEY_DETAIL), detail)
        }
        LEGACY_STATUS_KEYS.forEach(editor::remove)
        editor.commit()
    }

    private fun key(scope: AnalysisProgressScope, field: String): String =
        "${scope.name.lowercase()}.$field"

    private fun statusKeys(scope: AnalysisProgressScope): Set<String> =
        STATUS_FIELDS.mapTo(mutableSetOf()) { key(scope, it) }

    private companion object {
        const val PREFERENCES = "analysis_status"
        const val KEY_PHASE = "phase"
        const val KEY_DISCOVERED = "discovered_count"
        const val KEY_ELIGIBLE = "eligible_count"
        const val KEY_CACHED_CARDS = "cached_card_count"
        const val KEY_DETAIL = "detail"
        const val LEGACY_KEY_MESSAGE = "user_message"
        val STATUS_FIELDS = setOf(KEY_PHASE, KEY_DISCOVERED, KEY_ELIGIBLE, KEY_CACHED_CARDS, KEY_DETAIL)
        val LEGACY_STATUS_KEYS = STATUS_FIELDS + LEGACY_KEY_MESSAGE
    }
}
