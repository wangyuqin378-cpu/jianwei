package cn.jianwei.data.photos

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.provider.MediaStore
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import cn.jianwei.data.local.JianweiDatabase
import com.google.common.truth.Truth.assertThat
import java.util.UUID
import kotlinx.coroutines.runBlocking
import org.junit.Test

class ImportedPhotoDedupeInstrumentedTest {
    @Test
    fun identicalBytesFromDifferentUrisCreateOnePrivateCandidate() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val resolver = context.contentResolver
        val database = Room.inMemoryDatabaseBuilder(context, JianweiDatabase::class.java).build()
        val bytes = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 1, 2, 3, 0xFF.toByte(), 0xD9.toByte())
        val first = insertImage(context, "dedupe-a-${UUID.randomUUID()}.jpg", bytes)
        val second = insertImage(context, "dedupe-b-${UUID.randomUUID()}.jpg", bytes)
        val repository = MediaPhotoRepository(context, resolver, database.photos())

        try {
            val imported = repository.importUris(listOf(first.toString(), second.toString()))

            assertThat(imported).hasSize(1)
            assertThat(database.photos().importedContentUris()).hasSize(1)
            val stored = database.photos().findById(imported.single().localId)
            assertThat(stored?.sourceDigest).hasLength(64)
            assertThat(stored?.candidateToken).isNotEqualTo(
                UUID.nameUUIDFromBytes(first.toString().toByteArray()).toString()
            )
        } finally {
            repository.clearIndex()
            resolver.delete(first, null, null)
            resolver.delete(second, null, null)
            database.close()
        }
    }

    private fun insertImage(context: Context, name: String, bytes: ByteArray): Uri {
        val resolver = context.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, name)
            put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
            put(MediaStore.Images.Media.IS_PENDING, 1)
        }
        val uri = checkNotNull(resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values))
        resolver.openOutputStream(uri).use { output -> checkNotNull(output).write(bytes) }
        resolver.update(uri, ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }, null, null)
        return uri
    }
}
