package cn.jianwei.data.preferences

import android.content.Context
import android.content.SharedPreferences
import cn.jianwei.domain.card.AutomaticCardMode
import cn.jianwei.domain.repository.AutomaticCardModeRepository
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.distinctUntilChanged

@Singleton
class SharedPreferencesAutomaticCardModeRepository @Inject constructor(
    @ApplicationContext context: Context
) : AutomaticCardModeRepository {
    private val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

    override fun observeMode(): Flow<AutomaticCardMode> = callbackFlow {
        val listener = SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
            if (key == KEY_MODE) trySend(mode())
        }
        preferences.registerOnSharedPreferenceChangeListener(listener)
        trySend(mode())
        awaitClose { preferences.unregisterOnSharedPreferenceChangeListener(listener) }
    }.distinctUntilChanged()

    override fun mode(): AutomaticCardMode = preferences.getString(KEY_MODE, null)
        ?.let { stored -> runCatching { AutomaticCardMode.valueOf(stored) }.getOrNull() }
        ?: AutomaticCardMode.PREPARED_POOL

    override fun updateMode(mode: AutomaticCardMode) {
        check(preferences.edit().putString(KEY_MODE, mode.name).commit()) {
            "照片处理节奏保存失败，请重试"
        }
    }

    override fun observeDiscoveryEnabled(): Flow<Boolean> = callbackFlow {
        val listener = SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
            if (key == KEY_DISCOVERY_ENABLED) trySend(discoveryEnabled())
        }
        preferences.registerOnSharedPreferenceChangeListener(listener)
        trySend(discoveryEnabled())
        awaitClose { preferences.unregisterOnSharedPreferenceChangeListener(listener) }
    }.distinctUntilChanged()

    override fun discoveryEnabled(): Boolean =
        preferences.getBoolean(KEY_DISCOVERY_ENABLED, false)

    override fun updateDiscoveryEnabled(enabled: Boolean) {
        check(preferences.edit().putBoolean(KEY_DISCOVERY_ENABLED, enabled).commit()) {
            "自动发现偏好保存失败，请重试"
        }
    }

    internal companion object {
        const val PREFERENCES = "analysis_scheduler"
        const val KEY_MODE = "automatic_card_mode"
        const val KEY_DISCOVERY_ENABLED = "automatic_discovery_enabled"
    }
}
