package cn.jianwei.data.local

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import kotlinx.coroutines.runBlocking
import org.junit.Test

class PhotoSuppressionInstrumentedTest {
    @Test
    fun suppressionSurvivesClearingThePhotoIndex() {
        runBlocking {
            val database = Room.inMemoryDatabaseBuilder(
                ApplicationProvider.getApplicationContext(),
                JianweiDatabase::class.java
            ).build()

            try {
                val photos = database.photos()
                photos.suppress(SuppressedPhotoEntity(localId = 42L, suppressedAtMillis = 1L))
                photos.clear()

                assertThat(photos.isSuppressed(42L)).isTrue()
                assertThat(photos.suppressedIds(listOf(41L, 42L, 43L))).containsExactly(42L)
            } finally {
                database.close()
            }
        }
    }
}
