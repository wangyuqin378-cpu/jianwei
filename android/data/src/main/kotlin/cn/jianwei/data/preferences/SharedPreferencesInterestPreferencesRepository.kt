package cn.jianwei.data.preferences

import android.content.Context
import android.content.SharedPreferences
import cn.jianwei.domain.preferences.canonicalInterestSelection
import cn.jianwei.domain.preferences.isValidInterestSelection
import cn.jianwei.domain.repository.InterestPreferencesRepository
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.distinctUntilChanged

@Singleton
class SharedPreferencesInterestPreferencesRepository @Inject constructor(
    @ApplicationContext context: Context
) : InterestPreferencesRepository {
    private val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

    override fun observeSelected(): Flow<Set<String>> = callbackFlow {
        val listener = SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
            if (key == KEY_INTERESTS) trySend(selected())
        }
        preferences.registerOnSharedPreferenceChangeListener(listener)
        trySend(selected())
        awaitClose { preferences.unregisterOnSharedPreferenceChangeListener(listener) }
    }.distinctUntilChanged()

    override fun selected(): Set<String> =
        canonicalInterestSelection(preferences.getStringSet(KEY_INTERESTS, null))

    override fun updateSelected(selection: Set<String>) {
        require(isValidInterestSelection(selection)) {
            "请正好选择 3 个推荐兴趣"
        }
        val canonical = canonicalInterestSelection(selection)
        check(preferences.edit().putStringSet(KEY_INTERESTS, canonical).commit()) {
            "推荐兴趣保存失败，请重试"
        }
    }

    internal companion object {
        const val PREFERENCES = "onboarding"
        const val KEY_INTERESTS = "interests"
    }
}
