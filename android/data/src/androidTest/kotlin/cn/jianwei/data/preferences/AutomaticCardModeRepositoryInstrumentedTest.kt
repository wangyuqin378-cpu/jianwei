package cn.jianwei.data.preferences

import androidx.test.core.app.ApplicationProvider
import cn.jianwei.domain.card.AutomaticCardMode
import com.google.common.truth.Truth.assertThat
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.yield
import org.junit.After
import org.junit.Before
import org.junit.Test

class AutomaticCardModeRepositoryInstrumentedTest {
    private val context = ApplicationProvider.getApplicationContext<android.content.Context>()

    @Before
    fun clearBefore() {
        preferences().edit().remove(SharedPreferencesAutomaticCardModeRepository.KEY_MODE).commit()
    }

    @After
    fun clearAfter() {
        preferences().edit().remove(SharedPreferencesAutomaticCardModeRepository.KEY_MODE).commit()
    }

    @Test
    fun preparedPoolIsDefaultAndDailyOnePersistsAndEmits() = runBlocking {
        val repository = SharedPreferencesAutomaticCardModeRepository(context)
        assertThat(repository.mode()).isEqualTo(AutomaticCardMode.PREPARED_POOL)
        val changed = async(start = CoroutineStart.UNDISPATCHED) {
            withTimeout(2_000) { repository.observeMode().drop(1).first() }
        }
        yield()

        repository.updateMode(AutomaticCardMode.DAILY_ONE)

        assertThat(changed.await()).isEqualTo(AutomaticCardMode.DAILY_ONE)
        assertThat(SharedPreferencesAutomaticCardModeRepository(context).mode())
            .isEqualTo(AutomaticCardMode.DAILY_ONE)
    }

    @Test
    fun unknownStoredValueFallsBackToPreparedPool() {
        preferences().edit()
            .putString(SharedPreferencesAutomaticCardModeRepository.KEY_MODE, "REMOVED_MODE")
            .commit()

        assertThat(SharedPreferencesAutomaticCardModeRepository(context).mode())
            .isEqualTo(AutomaticCardMode.PREPARED_POOL)
    }

    private fun preferences() = context.getSharedPreferences(
        SharedPreferencesAutomaticCardModeRepository.PREFERENCES,
        android.content.Context.MODE_PRIVATE
    )
}
