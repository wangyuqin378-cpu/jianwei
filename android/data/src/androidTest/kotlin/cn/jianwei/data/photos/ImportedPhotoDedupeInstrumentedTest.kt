package cn.jianwei.data.photos

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.provider.MediaStore
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import cn.jianwei.data.local.JianweiDatabase
import cn.jianwei.domain.model.AnalysisState
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

    @Test
    fun sameProviderUriWithChangedBytesCreatesANewCandidate() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val resolver = context.contentResolver
        val database = Room.inMemoryDatabaseBuilder(context, JianweiDatabase::class.java).build()
        val firstBytes = jpegBytes(1)
        val secondBytes = jpegBytes(9)
        val uri = insertImage(context, "reused-${UUID.randomUUID()}.jpg", firstBytes)
        val repository = MediaPhotoRepository(context, resolver, database.photos())

        try {
            val first = repository.importUris(listOf(uri.toString())).single()
            resolver.openOutputStream(uri, "wt").use { output ->
                checkNotNull(output).write(secondBytes)
            }

            val second = repository.importUris(listOf(uri.toString())).single()

            assertThat(second.localId).isNotEqualTo(first.localId)
            assertThat(database.photos().findById(second.localId)?.sourceDigest)
                .isNotEqualTo(database.photos().findById(first.localId)?.sourceDigest)
            assertThat(database.photos().importedContentUris().filter(String::isNotBlank)).hasSize(2)
        } finally {
            repository.clearIndex()
            resolver.delete(uri, null, null)
            database.close()
        }
    }

    @Test
    fun suppressedBytesCannotBeReimportedThroughAnotherUri() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val resolver = context.contentResolver
        val database = Room.inMemoryDatabaseBuilder(context, JianweiDatabase::class.java).build()
        val bytes = jpegBytes(4)
        val first = insertImage(context, "private-a-${UUID.randomUUID()}.jpg", bytes)
        val alias = insertImage(context, "private-b-${UUID.randomUUID()}.jpg", bytes)
        val repository = MediaPhotoRepository(context, resolver, database.photos())

        try {
            val privateCandidate = repository.importUris(listOf(first.toString())).single()
            repository.markNeverAnalyze(privateCandidate.localId)

            val reimported = repository.importUris(listOf(alias.toString()))

            assertThat(reimported).isEmpty()
            assertThat(database.photos().findById(privateCandidate.localId)?.analysisState)
                .isEqualTo(AnalysisState.NEVER_ANALYZE.name)
            assertThat(database.photos().isSuppressed(privateCandidate.localId)).isTrue()
            assertThat(database.photos().importedContentUris().filter(String::isNotBlank)).isEmpty()
        } finally {
            repository.clearIndex()
            resolver.delete(first, null, null)
            resolver.delete(alias, null, null)
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

    private fun jpegBytes(marker: Int) =
        byteArrayOf(0xFF.toByte(), 0xD8.toByte(), marker.toByte(), 2, 3, 0xFF.toByte(), 0xD9.toByte())
}
