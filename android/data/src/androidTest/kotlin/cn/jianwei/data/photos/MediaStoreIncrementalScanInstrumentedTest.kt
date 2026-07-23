package cn.jianwei.data.photos

import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.provider.MediaStore
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import cn.jianwei.data.local.JianweiDatabase
import cn.jianwei.data.local.MediaScanCursorEntity
import cn.jianwei.domain.model.AnalysisState
import cn.jianwei.domain.model.PhotoAccess
import cn.jianwei.domain.model.ScanRequest
import com.google.common.truth.Truth.assertThat
import java.time.Instant
import java.time.Duration
import java.util.UUID
import kotlinx.coroutines.runBlocking
import org.junit.Test

class MediaStoreIncrementalScanInstrumentedTest {
    @Test
    fun missingTakenDateFallsBackToRecentMediaTimestampsWithoutEscapingScanWindow() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val resolver = context.contentResolver
        val database = Room.inMemoryDatabaseBuilder(context, JianweiDatabase::class.java).build()
        val repository = MediaPhotoRepository(context, resolver, database.photos())
        val prefix = "jianwei-recency-${UUID.randomUUID()}-"
        // MediaProvider normalizes stale DATE_MODIFIED values written by a test app to the current
        // time. A near-future boundary keeps both sides deterministic while exercising the exact
        // same selection used with the production 90-day boundary.
        val cutoff = Instant.now().plus(Duration.ofHours(1))
        val oldSeconds = Instant.now().epochSecond
        val recentSeconds = cutoff.plus(Duration.ofDays(1)).epochSecond
        val created = mutableListOf<Uri>()

        try {
            val oldWithoutTaken = insertMetadataOnlyImage(
                context, "${prefix}old-no-taken.jpg", null, oldSeconds, oldSeconds
            ).also(created::add)
            val recentWithoutTaken = insertMetadataOnlyImage(
                context, "${prefix}recent-no-taken.jpg", null, recentSeconds, recentSeconds
            ).also(created::add)
            val oldTakenButRecentlyAdded = insertMetadataOnlyImage(
                context,
                "${prefix}old-taken-recent-added.jpg",
                cutoff.minus(Duration.ofHours(1)).toEpochMilli(),
                recentSeconds,
                recentSeconds
            ).also(created::add)
            val recentTakenButOldMetadata = insertMetadataOnlyImage(
                context,
                "${prefix}recent-taken-old-metadata.jpg",
                cutoff.plus(Duration.ofHours(1)).toEpochMilli(),
                oldSeconds,
                oldSeconds
            ).also(created::add)

            val result = repository.scanRecent(
                ScanRequest(cutoff, maximum = 500, access = PhotoAccess.FULL)
            )

            assertThat(result.candidates.map { it.localId }).containsExactly(
                ContentUris.parseId(recentWithoutTaken),
                ContentUris.parseId(recentTakenButOldMetadata)
            )
            assertThat(result.candidates.map { it.localId }).doesNotContain(ContentUris.parseId(oldWithoutTaken))
            assertThat(result.candidates.map { it.localId }).doesNotContain(ContentUris.parseId(oldTakenButRecentlyAdded))
        } finally {
            repository.clearIndex()
            created.forEach { resolver.delete(it, null, null) }
            database.close()
        }
    }

    @Test
    fun realMediaStoreEnforcesFiveHundredCapAndOnlyReturnsNewOrModifiedRowsAfterward() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val resolver = context.contentResolver
        val database = Room.inMemoryDatabaseBuilder(context, JianweiDatabase::class.java).build()
        val repository = MediaPhotoRepository(context, resolver, database.photos())
        val prefix = "jianwei-scan-${UUID.randomUUID()}-"
        val now = Instant.now()
        val scanSince = now.minusSeconds(60)
        val takenAt = now.toEpochMilli()
        val created = mutableListOf<Uri>()

        try {
            repeat(501) { index ->
                created += insertImage(
                    context = context,
                    name = "$prefix${index.toString().padStart(3, '0')}.jpg",
                    takenAtMillis = takenAt
                )
            }

            val initial = repository.scanRecent(
                ScanRequest(scanSince, maximum = 900, access = PhotoAccess.FULL)
            )

            assertThat(initial.discovered).isEqualTo(500)
            assertThat(initial.inserted).isEqualTo(500)
            assertThat(initial.candidates).hasSize(500)
            assertThat(initial.candidates.map { it.localId })
                .doesNotContain(ContentUris.parseId(created.first()))
            assertThat(initial.candidates.map { it.localId })
                .contains(ContentUris.parseId(created.last()))

            val unchanged = repository.scanRecent(
                ScanRequest(scanSince, maximum = 900, access = PhotoAccess.FULL)
            )
            assertThat(unchanged.discovered).isEqualTo(0)
            assertThat(unchanged.inserted).isEqualTo(0)
            assertThat(unchanged.candidates).isEmpty()

            val newUri = insertImage(
                context = context,
                name = "${prefix}new.jpg",
                takenAtMillis = takenAt
            )
            created += newUri
            val cursorBeforeInsertScan = checkNotNull(database.photos().mediaScanCursor(PhotoAccess.FULL.name))
            assertThat(readWatermark(context, newUri)).isGreaterThan(
                MediaStoreWatermark(cursorBeforeInsertScan.freshnessSeconds, cursorBeforeInsertScan.mediaId)
            )
            val added = repository.scanRecent(
                ScanRequest(scanSince, maximum = 900, access = PhotoAccess.FULL)
            )
            assertThat(added.discovered).isEqualTo(1)
            assertThat(added.inserted).isEqualTo(1)
            assertThat(added.candidates.map { it.localId })
                .containsExactly(ContentUris.parseId(newUri))

            val edited = added.candidates.single()
            database.photos().updateAnalysis(
                localId = edited.localId,
                state = AnalysisState.COMPLETED.name,
                hash = 123L,
                quality = 0.9,
                labels = listOf("object"),
                flags = emptySet()
            )
            val editedUri = newUri
            val cursorAfterInsert = checkNotNull(database.photos().mediaScanCursor(PhotoAccess.FULL.name))
            Thread.sleep(1_100)
            val markedPending = resolver.update(
                editedUri,
                ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 1) },
                null,
                null
            )
            assertThat(markedPending).isEqualTo(1)
            resolver.openOutputStream(editedUri, "w").use { output ->
                checkNotNull(output).write(
                    byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 1, 2, 3, 0xFF.toByte(), 0xD9.toByte())
                )
            }
            val republished = resolver.update(
                editedUri,
                ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) },
                null,
                null
            )
            assertThat(republished).isEqualTo(1)
            assertThat(readWatermark(context, editedUri)).isGreaterThan(
                MediaStoreWatermark(cursorAfterInsert.freshnessSeconds, cursorAfterInsert.mediaId)
            )

            val refreshed = repository.scanRecent(
                ScanRequest(scanSince, maximum = 900, access = PhotoAccess.FULL)
            )
            assertThat(refreshed.discovered).isEqualTo(1)
            assertThat(refreshed.inserted).isEqualTo(0)
            assertThat(refreshed.candidates.map { it.localId }).containsExactly(edited.localId)
            assertThat(database.photos().findById(edited.localId)?.analysisState)
                .isEqualTo(AnalysisState.DISCOVERED.name)

            database.photos().upsertMediaScanCursor(
                MediaScanCursorEntity(
                    accessScope = PhotoAccess.PARTIAL.name,
                    freshnessSeconds = now.plusSeconds(86_400).epochSecond,
                    mediaId = 0,
                    updatedAtMillis = System.currentTimeMillis()
                )
            )
            val newlyAuthorizedOldPhoto = insertImage(
                context = context,
                name = "${prefix}partial-newly-visible.jpg",
                takenAtMillis = takenAt
            )
            created += newlyAuthorizedOldPhoto
            val partialReconciliation = repository.scanRecent(
                ScanRequest(scanSince, maximum = 900, access = PhotoAccess.PARTIAL)
            )
            assertThat(partialReconciliation.discovered).isEqualTo(500)
            assertThat(partialReconciliation.inserted).isEqualTo(1)
            assertThat(partialReconciliation.candidates.map { it.localId })
                .containsExactly(ContentUris.parseId(newlyAuthorizedOldPhoto))
            Unit
        } finally {
            repository.clearIndex()
            resolver.delete(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                "${MediaStore.Images.Media.DISPLAY_NAME} LIKE ?",
                arrayOf("$prefix%")
            )
            database.close()
        }
    }

    private fun insertImage(
        context: Context,
        name: String,
        takenAtMillis: Long
    ): Uri {
        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, name)
            put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
            put(MediaStore.Images.Media.DATE_TAKEN, takenAtMillis)
            put(MediaStore.Images.Media.IS_PENDING, 1)
        }
        val resolver = context.contentResolver
        val uri = checkNotNull(resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values))
        resolver.openOutputStream(uri, "w").use { output ->
            checkNotNull(output).write(byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xD9.toByte()))
        }
        val published = resolver.update(
            uri,
            ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) },
            null,
            null
        )
        check(published == 1) { "Test media row was not published" }
        return uri
    }

    private fun insertMetadataOnlyImage(
        context: Context,
        name: String,
        takenAtMillis: Long?,
        addedAtSeconds: Long,
        modifiedAtSeconds: Long
    ): Uri {
        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, name)
            put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
            if (takenAtMillis != null) put(MediaStore.Images.Media.DATE_TAKEN, takenAtMillis)
            put(MediaStore.Images.Media.DATE_ADDED, addedAtSeconds)
            put(MediaStore.Images.Media.DATE_MODIFIED, modifiedAtSeconds)
            put(MediaStore.Images.Media.IS_PENDING, 0)
        }
        return checkNotNull(
            context.contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
        )
    }

    private fun readWatermark(context: Context, uri: Uri): MediaStoreWatermark =
        checkNotNull(
            context.contentResolver.query(
                uri,
                arrayOf(
                    MediaStore.Images.Media._ID,
                    MediaStore.Images.Media.DATE_ADDED,
                    MediaStore.Images.Media.DATE_MODIFIED
                ),
                null,
                null,
                null
            )?.use { cursor ->
                if (!cursor.moveToFirst()) return@use null
                val id = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.Images.Media._ID))
                val added = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_ADDED))
                val modified = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_MODIFIED))
                MediaStoreWatermark(maxOf(added, modified), id)
            }
        )
}
