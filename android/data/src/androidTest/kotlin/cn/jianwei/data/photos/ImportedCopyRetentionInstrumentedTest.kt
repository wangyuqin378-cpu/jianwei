package cn.jianwei.data.photos

import android.net.Uri
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import cn.jianwei.data.local.JianweiDatabase
import cn.jianwei.data.local.PhotoCandidateEntity
import cn.jianwei.domain.model.AnalysisState
import cn.jianwei.domain.model.PhotoOrigin
import com.google.common.truth.Truth.assertThat
import java.io.File
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.runBlocking
import org.junit.Test

class ImportedCopyRetentionInstrumentedTest {
    @Test
    fun replacesRawImportAndPurgesExpiredCopies() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val database = Room.inMemoryDatabaseBuilder(context, JianweiDatabase::class.java).build()
        val directory = File(context.filesDir, "jianwei-imports").apply { mkdirs() }
        val retained = File(directory, "retention-${UUID.randomUUID()}.image")
        val expired = File(directory, "expired-${UUID.randomUUID()}.image")
        try {
            val repository = MediaPhotoRepository(context, context.contentResolver, database.photos())
            retained.writeBytes("raw-private-copy".toByteArray())
            database.photos().upsert(candidate(-10L, retained, System.currentTimeMillis()))

            val sanitized = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xD9.toByte())
            repository.replaceImportedCopyWithSanitized(-10L, sanitized)
            assertThat(retained.readBytes()).isEqualTo(sanitized)

            repository.discardImportedCopy(-10L)
            assertThat(retained.exists()).isFalse()
            assertThat(database.photos().findById(-10L)?.contentUri).isEmpty()

            expired.writeBytes("stale-raw-private-copy".toByteArray())
            database.photos().upsert(candidate(-11L, expired, 0L))
            assertThat(repository.purgeExpiredImportedCopies(Instant.now())).isEqualTo(1)
            assertThat(expired.exists()).isFalse()
            assertThat(database.photos().findById(-11L)?.analysisState).isEqualTo(AnalysisState.FILTERED.name)
            assertThat(database.photos().findById(-11L)?.contentUri).isEmpty()
        } finally {
            retained.delete()
            expired.delete()
            database.close()
        }
    }

    private fun candidate(localId: Long, file: File, modifiedAtMillis: Long) = PhotoCandidateEntity(
        localId = localId,
        candidateToken = UUID.randomUUID().toString(),
        contentUri = Uri.fromFile(file).toString(),
        capturedAtMillis = modifiedAtMillis,
        modifiedAtMillis = modifiedAtMillis,
        sourceDigest = null,
        perceptualHash = null,
        qualityScore = 0.9,
        localLabels = listOf("object"),
        sensitiveFlags = emptySet(),
        analysisState = AnalysisState.READY.name,
        origin = PhotoOrigin.PHOTO_PICKER.name,
        width = 100,
        height = 100
    )
}
