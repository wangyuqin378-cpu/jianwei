package cn.jianwei.data.preferences

import androidx.test.core.app.ApplicationProvider
import cn.jianwei.domain.preferences.DEFAULT_INTEREST_SELECTION
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

class InterestPreferencesRepositoryInstrumentedTest {
    private val context = ApplicationProvider.getApplicationContext<android.content.Context>()

    @Before
    fun clearBefore() {
        preferences().edit().clear().commit()
    }

    @After
    fun clearAfter() {
        preferences().edit().clear().commit()
    }

    @Test
    fun selectionPersistsAcrossRepositoryRecreationAndEmitsChanges() = runBlocking {
        val repository = SharedPreferencesInterestPreferencesRepository(context)
        assertThat(repository.selected())
            .containsExactlyElementsIn(DEFAULT_INTEREST_SELECTION)
            .inOrder()
        val changed = async(start = CoroutineStart.UNDISPATCHED) {
            withTimeout(2_000) { repository.observeSelected().drop(1).first() }
        }
        yield()

        repository.updateSelected(setOf("科学原理", "实用技巧", "制造工艺"))

        assertThat(changed.await())
            .containsExactly("科学原理", "实用技巧", "制造工艺")
            .inOrder()
        assertThat(SharedPreferencesInterestPreferencesRepository(context).selected())
            .containsExactly("科学原理", "实用技巧", "制造工艺")
            .inOrder()
    }

    @Test
    fun incompleteSelectionIsRejectedWithoutOverwritingStoredState() {
        val repository = SharedPreferencesInterestPreferencesRepository(context)
        val valid = setOf("科学原理", "实用技巧", "制造工艺")
        repository.updateSelected(valid)

        val failure = runCatching {
            repository.updateSelected(setOf("生活设计", "科学原理"))
        }

        assertThat(failure.exceptionOrNull()).isInstanceOf(IllegalArgumentException::class.java)
        assertThat(repository.selected()).containsExactlyElementsIn(valid)
    }

    private fun preferences() = context.getSharedPreferences(
        SharedPreferencesInterestPreferencesRepository.PREFERENCES,
        android.content.Context.MODE_PRIVATE
    )
}
