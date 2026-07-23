package cn.jianwei.data.status

import android.content.Context
import android.content.SharedPreferences
import cn.jianwei.domain.model.AnalysisPhase
import cn.jianwei.domain.model.AnalysisProgress
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

    override fun observeProgress(): Flow<AnalysisProgress> = callbackFlow {
        val listener = SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
            if (key in STATUS_KEYS) trySend(readProgress())
        }
        trySend(readProgress())
        preferences.registerOnSharedPreferenceChangeListener(listener)
        awaitClose { preferences.unregisterOnSharedPreferenceChangeListener(listener) }
    }.distinctUntilChanged()

    override fun publishProgress(progress: AnalysisProgress) {
        preferences.edit()
            .putString(KEY_PHASE, progress.phase.name)
            .putInt(KEY_DISCOVERED, progress.discoveredCount.coerceAtLeast(0))
            .putInt(KEY_ELIGIBLE, progress.eligibleCount.coerceAtLeast(0))
            .putInt(KEY_CACHED_CARDS, progress.cachedCardCount.coerceAtLeast(0))
            .apply {
                if (progress.detail == null) remove(KEY_DETAIL) else putString(KEY_DETAIL, progress.detail)
                remove(LEGACY_KEY_MESSAGE)
            }
            .apply()
    }

    private fun readProgress(): AnalysisProgress {
        val phase = preferences.getString(KEY_PHASE, null)
            ?.let { runCatching { AnalysisPhase.valueOf(it) }.getOrNull() }
            ?: AnalysisPhase.IDLE
        return AnalysisProgress(
            phase = phase,
            discoveredCount = preferences.getInt(KEY_DISCOVERED, 0).coerceAtLeast(0),
            eligibleCount = preferences.getInt(KEY_ELIGIBLE, 0).coerceAtLeast(0),
            cachedCardCount = preferences.getInt(KEY_CACHED_CARDS, 0).coerceAtLeast(0),
            detail = preferences.getString(KEY_DETAIL, null) ?: preferences.getString(LEGACY_KEY_MESSAGE, null)
        )
    }

    private companion object {
        const val PREFERENCES = "analysis_status"
        const val KEY_PHASE = "phase"
        const val KEY_DISCOVERED = "discovered_count"
        const val KEY_ELIGIBLE = "eligible_count"
        const val KEY_CACHED_CARDS = "cached_card_count"
        const val KEY_DETAIL = "detail"
        const val LEGACY_KEY_MESSAGE = "user_message"
        val STATUS_KEYS = setOf(KEY_PHASE, KEY_DISCOVERED, KEY_ELIGIBLE, KEY_CACHED_CARDS, KEY_DETAIL, LEGACY_KEY_MESSAGE)
    }
}
