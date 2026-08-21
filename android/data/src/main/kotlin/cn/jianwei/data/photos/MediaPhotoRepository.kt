package cn.jianwei.data.photos

import android.content.ContentResolver
import android.content.ContentUris
import android.content.Context
import android.database.Cursor
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import cn.jianwei.data.local.PhotoCandidateEntity
import cn.jianwei.data.local.PhotoDao
import cn.jianwei.data.local.MediaScanCursorEntity
import cn.jianwei.data.local.SuppressedPhotoEntity
import cn.jianwei.data.local.toDomain
import cn.jianwei.domain.model.AnalysisState
import cn.jianwei.domain.model.PhotoAccess
import cn.jianwei.domain.model.PhotoCandidate
import cn.jianwei.domain.model.PhotoOrigin
import cn.jianwei.domain.model.ScanRequest
import cn.jianwei.domain.model.ScanResult
import cn.jianwei.domain.repository.PhotoRepository
import cn.jianwei.domain.usecase.shouldRestartExplicitImport
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.time.Instant
import java.time.Duration
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.DigestInputStream
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.withContext

@Singleton
class MediaPhotoRepository @Inject constructor(
    @param:ApplicationContext private val context: Context,
    private val resolver: ContentResolver,
    private val dao: PhotoDao
) : PhotoRepository {
    override suspend fun scanRecent(request: ScanRequest): ScanResult {
        if (request.access == PhotoAccess.PICKER_ONLY) return ScanResult(0, 0, emptyList())
        val accessScope = request.access.name
        val storedCursor = dao.mediaScanCursor(accessScope)
        val cursor = mediaStoreCursorForAccess(
            request.access,
            storedCursor?.let { MediaStoreWatermark(it.freshnessSeconds, it.mediaId) }
        )
        val discovered = try {
            if (cursor == null) queryInitialMediaStore(request.since.toEpochMilli(), request.maximum)
            else queryMediaStoreAfter(cursor, request.since.toEpochMilli(), request.maximum)
        } catch (_: SecurityException) {
            return ScanResult(0, 0, emptyList())
        }
        val suppressed = dao.suppressedIds(discovered.map { it.localId }).toHashSet()
        val items = discovered.filterNot { it.localId in suppressed }
        var inserted = 0
        val changed = buildList {
            items.forEach { item ->
                when (mediaStoreIndexAction(dao.findById(item.localId), item)) {
                    MediaStoreIndexAction.INSERT -> {
                        if (dao.insertAll(listOf(item)).single() != -1L) {
                            inserted += 1
                            add(item)
                        } else if (mediaStoreIndexAction(dao.findById(item.localId), item) == MediaStoreIndexAction.REFRESH) {
                            // Defensive conflict handling if another scan indexed this ID first.
                            dao.upsert(item)
                            add(item)
                        }
                    }
                    MediaStoreIndexAction.REFRESH -> {
                        dao.upsert(item)
                        add(item)
                    }
                    MediaStoreIndexAction.IGNORE -> Unit
                }
            }
        }
        // Advance only after every candidate write succeeds. A crash before this point repeats an
        // idempotent page; advancing first could permanently skip an older change.
        val nextCursor = advanceMediaStoreWatermark(
            current = cursor,
            discovered = discovered,
            initialFloor = MediaStoreWatermark(request.since.epochSecond, 0L)
        )
        dao.upsertMediaScanCursor(
            MediaScanCursorEntity(
                accessScope = accessScope,
                freshnessSeconds = nextCursor.freshnessSeconds,
                mediaId = nextCursor.mediaId,
                updatedAtMillis = System.currentTimeMillis()
            )
        )
        return ScanResult(items.size, inserted, changed.map { it.toDomain() })
    }

    override suspend fun importUris(uris: List<String>): List<PhotoCandidate> = withContext(Dispatchers.IO) {
        val now = System.currentTimeMillis()
        val imported = linkedMapOf<Long, PhotoCandidateEntity>()
        var remainingImportBytes = MAX_IMPORT_BATCH_BYTES
        for (value in uris.distinct()) {
            if (remainingImportBytes <= 0) break
            val originalUri = runCatching { Uri.parse(value) }.getOrNull() ?: continue
            val metadata = queryUriMetadata(originalUri)
            val privateCopy = copyIntoPrivateStorage(
                originalUri,
                stableId("staging:$value"),
                minOf(MAX_IMPORT_SOURCE_BYTES, remainingImportBytes)
            ) ?: continue
            remainingImportBytes -= privateCopy.byteCount
            val contentDuplicate = dao.findBySourceDigest(privateCopy.sourceDigest)
            if (contentDuplicate != null) {
                reuseOrRestartExplicitImport(contentDuplicate, privateCopy, metadata, now)
                    ?.let { imported[it.localId] = it }
                continue
            }
            val localId = availableImportedLocalId(privateCopy.sourceDigest)
            if (localId == null || dao.isSuppressed(localId)) {
                deletePrivateCopy(privateCopy.uri.toString())
                continue
            }
            val entity = PhotoCandidateEntity(
                localId = localId,
                candidateToken = UUID.randomUUID().toString(),
                contentUri = privateCopy.uri.toString(),
                capturedAtMillis = metadata.capturedAtMillis ?: now,
                // For private imports this field is the local retention clock, not source metadata.
                modifiedAtMillis = now,
                sourceDigest = privateCopy.sourceDigest,
                perceptualHash = null,
                qualityScore = 0.0,
                localLabels = emptyList(),
                sensitiveFlags = metadata.initialFlags,
                analysisState = AnalysisState.DISCOVERED.name,
                origin = PhotoOrigin.PHOTO_PICKER.name,
                width = metadata.width,
                height = metadata.height
            )
            if (dao.insertAll(listOf(entity)).single() == -1L) {
                val winner = dao.findBySourceDigest(privateCopy.sourceDigest)
                if (winner == null) {
                    deletePrivateCopy(privateCopy.uri.toString())
                } else {
                    reuseOrRestartExplicitImport(winner, privateCopy, metadata, now)
                        ?.let { imported[it.localId] = it }
                }
            } else {
                imported[entity.localId] = entity
            }
        }
        imported.values.map { it.toDomain() }
    }

    private suspend fun reuseOrRestartExplicitImport(
        existing: PhotoCandidateEntity,
        privateCopy: PrivateCopy,
        metadata: UriMetadata,
        now: Long
    ): PhotoCandidateEntity? {
        if (
            existing.analysisState == AnalysisState.NEVER_ANALYZE.name ||
            dao.isSuppressed(existing.localId)
        ) {
            deletePrivateCopy(privateCopy.uri.toString())
            return null
        }
        val state = AnalysisState.valueOf(existing.analysisState)
        if (!shouldRestartExplicitImport(state)) {
            deletePrivateCopy(privateCopy.uri.toString())
            return existing
        }

        val restarted = existing.copy(
            candidateToken = UUID.randomUUID().toString(),
            contentUri = privateCopy.uri.toString(),
            capturedAtMillis = metadata.capturedAtMillis ?: existing.capturedAtMillis,
            modifiedAtMillis = now,
            sourceDigest = privateCopy.sourceDigest,
            perceptualHash = null,
            qualityScore = 0.0,
            localLabels = emptyList(),
            sensitiveFlags = metadata.initialFlags,
            analysisState = AnalysisState.DISCOVERED.name,
            width = metadata.width.takeIf { it > 0 } ?: existing.width,
            height = metadata.height.takeIf { it > 0 } ?: existing.height
        )
        try {
            dao.upsert(restarted)
        } catch (error: Exception) {
            deletePrivateCopy(privateCopy.uri.toString())
            throw error
        }
        if (existing.contentUri != restarted.contentUri) deletePrivateCopy(existing.contentUri)
        return restarted
    }

    /**
     * Explicit-import identity belongs to the selected bytes, not to a provider-controlled URI.
     * Photo providers may recycle a URI for different content, while the same bytes can arrive
     * through Photo Picker and Sharesheet aliases. Negative IDs keep this namespace separate from
     * positive MediaStore IDs. Additional seeds only handle the vanishingly unlikely 63-bit clash.
     */
    private suspend fun availableImportedLocalId(sourceDigest: String): Long? {
        repeat(MAX_IMPORTED_ID_ATTEMPTS) { attempt ->
            val suffix = if (attempt == 0) "" else ":$attempt"
            val localId = stableId("content:$sourceDigest$suffix")
            val conflict = dao.findById(localId)
            if (conflict == null || conflict.sourceDigest == sourceDigest) return localId
        }
        return null
    }

    override fun observeCandidatesByTokens(candidateTokens: Set<String>): Flow<List<PhotoCandidate>> {
        require(candidateTokens.isNotEmpty())
        return dao.observeByTokens(candidateTokens).map { candidates -> candidates.map { it.toDomain() } }
    }

    override suspend fun candidatesForAnalysis(limit: Int): List<PhotoCandidate> =
        dao.candidatesForAnalysis(limit.coerceIn(1, 500)).map { it.toDomain() }

    override suspend fun updateAnalysis(
        localId: Long,
        state: AnalysisState,
        perceptualHash: Long?,
        qualityScore: Double?,
        labels: List<String>?,
        sensitiveFlags: Set<String>?
    ) {
        val current = dao.findById(localId) ?: return
        dao.updateAnalysis(
            localId = localId,
            state = state.name,
            hash = perceptualHash ?: current.perceptualHash,
            quality = qualityScore ?: current.qualityScore,
            labels = labels ?: current.localLabels,
            flags = sensitiveFlags ?: current.sensitiveFlags
        )
    }

    override suspend fun markNeverAnalyze(localId: Long) = withContext(Dispatchers.IO) {
        val entity = dao.findById(localId)
        dao.suppress(SuppressedPhotoEntity(localId, System.currentTimeMillis()))
        if (entity != null && entity.origin != PhotoOrigin.MEDIA_STORE.name) {
            deletePrivateCopy(entity.contentUri)
            dao.clearImportedContentUri(localId)
        }
        dao.markNeverAnalyze(localId)
    }

    override suspend fun replaceImportedCopyWithSanitized(localId: Long, bytes: ByteArray) = withContext(Dispatchers.IO) {
        val entity = dao.findById(localId) ?: return@withContext
        if (entity.origin == PhotoOrigin.MEDIA_STORE.name) return@withContext
        val target = privateCopyFile(entity.contentUri) ?: return@withContext
        val temporary = java.io.File(target.parentFile, ".${target.name}.${UUID.randomUUID()}.tmp")
        val replaced = runCatching {
            temporary.outputStream().use { it.write(bytes) }
            runCatching {
                Files.move(
                    temporary.toPath(),
                    target.toPath(),
                    StandardCopyOption.ATOMIC_MOVE,
                    StandardCopyOption.REPLACE_EXISTING
                )
            }.getOrElse {
                Files.move(temporary.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING)
            }
        }.isSuccess
        temporary.delete()
        if (replaced) dao.touchImportedCopy(localId, System.currentTimeMillis())
        else {
            target.delete()
            dao.clearImportedContentUri(localId)
        }
    }

    override suspend fun discardImportedCopy(localId: Long) = withContext(Dispatchers.IO) {
        val entity = dao.findById(localId) ?: return@withContext
        if (entity.origin == PhotoOrigin.MEDIA_STORE.name) return@withContext
        deletePrivateCopy(entity.contentUri)
        dao.clearImportedContentUri(localId)
    }

    override suspend fun purgeExpiredImportedCopies(now: Instant): Int = withContext(Dispatchers.IO) {
        val expired = dao.expiredImportedCopies(
            rawCutoffMillis = now.minus(RAW_IMPORT_TTL).toEpochMilli(),
            sanitizedCutoffMillis = now.minus(SANITIZED_IMPORT_TTL).toEpochMilli()
        )
        expired.forEach { deletePrivateCopy(it.contentUri) }
        if (expired.isNotEmpty()) dao.expireImportedCopies(expired.map { it.localId })
        expired.size
    }

    override suspend fun clearIndex() = withContext(Dispatchers.IO) {
        dao.importedContentUris().forEach(::deletePrivateCopyOrThrow)
        dao.clear()
        dao.clearMediaScanCursors()
    }

    private fun deletePrivateCopyOrThrow(value: String) {
        val file = privateCopyFile(value) ?: return
        check(file.delete() || !file.exists()) {
            "应用内照片副本删除失败；本地索引仍保留，请重试"
        }
    }

    private fun deletePrivateCopy(value: String) {
        privateCopyFile(value)?.delete()
    }

    private fun privateCopyFile(value: String): java.io.File? = runCatching {
        val importRoot = java.io.File(context.filesDir, IMPORT_DIRECTORY).canonicalFile
        val uri = Uri.parse(value)
        if (uri.scheme != "file") return@runCatching null
        val file = java.io.File(uri.path.orEmpty()).canonicalFile
        file.takeIf { it.isFile && it.toPath().startsWith(importRoot.toPath()) }
    }.getOrNull()

    private fun copyIntoPrivateStorage(uri: Uri, localId: Long, maximumBytes: Long): PrivateCopy? {
        val directory = java.io.File(context.filesDir, IMPORT_DIRECTORY).apply { mkdirs() }
        val target = java.io.File(directory, "${localId.toULong().toString(16)}-${UUID.randomUUID()}.image")
        return runCatching {
            val digest = MessageDigest.getInstance("SHA-256")
            val copied = resolver.openInputStream(uri)?.use { input ->
                val digestingInput = DigestInputStream(input, digest)
                target.outputStream().use { output -> copyWithLimit(digestingInput, output, maximumBytes) }
            } ?: error("Unable to read the selected image")
            PrivateCopy(Uri.fromFile(target), copied, digest.digest().toHex())
        }.getOrElse {
            target.delete()
            null
        }
    }

    private fun queryInitialMediaStore(
        capturedSinceMillis: Long,
        maximum: Int
    ): List<PhotoCandidateEntity> = queryMediaStore(
        selection = mediaRecencySelection(),
        selectionArgs = mediaRecencySelectionArgs(capturedSinceMillis),
        sortOrder = "$MEDIA_FRESHNESS_EXPRESSION DESC, ${MediaStore.Images.Media._ID} DESC",
        maximum = maximum
    )

    private fun queryMediaStoreAfter(
        cursor: MediaStoreWatermark,
        capturedSinceMillis: Long,
        maximum: Int
    ): List<PhotoCandidateEntity> = queryMediaStore(
        selection = "${mediaRecencySelection()} AND (" +
            "${MediaStore.Images.Media.DATE_ADDED} > ? OR " +
            "${MediaStore.Images.Media.DATE_MODIFIED} > ? OR " +
            "(((${MediaStore.Images.Media.DATE_ADDED} = ? AND ${MediaStore.Images.Media.DATE_MODIFIED} <= ?) OR " +
            "(${MediaStore.Images.Media.DATE_MODIFIED} = ? AND ${MediaStore.Images.Media.DATE_ADDED} <= ?)) AND " +
            "${MediaStore.Images.Media._ID} > ?))",
        selectionArgs = arrayOf(
            *mediaRecencySelectionArgs(capturedSinceMillis),
            cursor.freshnessSeconds.toString(),
            cursor.freshnessSeconds.toString(),
            cursor.freshnessSeconds.toString(),
            cursor.freshnessSeconds.toString(),
            cursor.freshnessSeconds.toString(),
            cursor.freshnessSeconds.toString(),
            cursor.mediaId.toString()
        ),
        sortOrder = "$MEDIA_FRESHNESS_EXPRESSION ASC, ${MediaStore.Images.Media._ID} ASC",
        maximum = maximum
    )

    private fun queryMediaStore(
        selection: String,
        selectionArgs: Array<String>,
        sortOrder: String,
        maximum: Int
    ): List<PhotoCandidateEntity> {
        val collection = MediaStore.Images.Media.EXTERNAL_CONTENT_URI
        val projection = buildList {
            add(MediaStore.Images.Media._ID)
            add(MediaStore.Images.Media.DATE_TAKEN)
            add(MediaStore.Images.Media.DATE_ADDED)
            add(MediaStore.Images.Media.DATE_MODIFIED)
            add(MediaStore.Images.Media.WIDTH)
            add(MediaStore.Images.Media.HEIGHT)
            add(MediaStore.Images.Media.DISPLAY_NAME)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                add(MediaStore.Images.Media.RELATIVE_PATH)
            }
        }.toTypedArray()
        val items = mutableListOf<PhotoCandidateEntity>()
        resolver.query(
            collection,
            projection,
            selection,
            selectionArgs,
            sortOrder
        )?.use { cursor ->
            while (cursor.moveToNext() && items.size < maximum.coerceIn(0, 500)) {
                items += cursor.toEntity(collection)
            }
        }
        return items
    }

    private fun mediaRecencySelection(): String =
        "(${MediaStore.Images.Media.DATE_TAKEN} >= ? OR " +
            "((${MediaStore.Images.Media.DATE_TAKEN} IS NULL OR ${MediaStore.Images.Media.DATE_TAKEN} <= 0) AND " +
            "(${MediaStore.Images.Media.DATE_ADDED} >= ? OR ${MediaStore.Images.Media.DATE_MODIFIED} >= ?)))"

    private fun mediaRecencySelectionArgs(capturedSinceMillis: Long): Array<String> {
        val capturedSinceSeconds = capturedSinceMillis.floorDiv(1_000L)
        return arrayOf(
            capturedSinceMillis.toString(),
            capturedSinceSeconds.toString(),
            capturedSinceSeconds.toString()
        )
    }

    private fun Cursor.toEntity(collection: Uri): PhotoCandidateEntity {
        val id = getLong(getColumnIndexOrThrow(MediaStore.Images.Media._ID))
        val dateAdded = longOrNull(MediaStore.Images.Media.DATE_ADDED)?.coerceAtLeast(0L) ?: 0L
        val dateModified = longOrNull(MediaStore.Images.Media.DATE_MODIFIED)?.coerceAtLeast(0L) ?: 0L
        // This is the incremental-index freshness clock, not EXIF source metadata.
        val modified = mediaStoreFreshnessMillis(dateAdded, dateModified)
        val dateTakenIndex = getColumnIndex(MediaStore.Images.Media.DATE_TAKEN)
        val captured = if (dateTakenIndex >= 0) getLong(dateTakenIndex).takeIf { it > 0 } ?: modified else modified
        val name = stringOrEmpty(MediaStore.Images.Media.DISPLAY_NAME)
        val path = stringOrEmpty(MediaStore.Images.Media.RELATIVE_PATH)
        val screenshot = name.contains("screenshot", true) || path.contains("screenshot", true) || name.contains("截屏")
        return PhotoCandidateEntity(
            localId = id,
            candidateToken = UUID.randomUUID().toString(),
            contentUri = ContentUris.withAppendedId(collection, id).toString(),
            capturedAtMillis = captured,
            modifiedAtMillis = modified,
            sourceDigest = null,
            perceptualHash = null,
            qualityScore = 0.0,
            localLabels = emptyList(),
            sensitiveFlags = if (screenshot) setOf("screenshot") else emptySet(),
            analysisState = AnalysisState.DISCOVERED.name,
            origin = PhotoOrigin.MEDIA_STORE.name,
            width = intOrZero(MediaStore.Images.Media.WIDTH),
            height = intOrZero(MediaStore.Images.Media.HEIGHT)
        )
    }

    private fun queryUriMetadata(uri: Uri): UriMetadata {
        val projection = arrayOf(
            MediaStore.Images.Media.DATE_TAKEN,
            MediaStore.Images.Media.DATE_MODIFIED,
            MediaStore.Images.Media.WIDTH,
            MediaStore.Images.Media.HEIGHT,
            MediaStore.Images.Media.DISPLAY_NAME
        )
        return resolver.query(uri, projection, null, null, null)?.use { cursor ->
            if (!cursor.moveToFirst()) return@use UriMetadata()
            val name = cursor.stringOrEmpty(MediaStore.Images.Media.DISPLAY_NAME)
            UriMetadata(
                capturedAtMillis = cursor.longOrNull(MediaStore.Images.Media.DATE_TAKEN),
                modifiedAtMillis = cursor.longOrNull(MediaStore.Images.Media.DATE_MODIFIED)?.times(1000),
                width = cursor.intOrZero(MediaStore.Images.Media.WIDTH),
                height = cursor.intOrZero(MediaStore.Images.Media.HEIGHT),
                initialFlags = if (name.contains("screenshot", true) || name.contains("截屏")) setOf("screenshot") else emptySet()
            )
        } ?: UriMetadata()
    }

    private fun Cursor.stringOrEmpty(column: String): String = getColumnIndex(column).takeIf { it >= 0 }?.let(::getString).orEmpty()
    private fun Cursor.intOrZero(column: String): Int = getColumnIndex(column).takeIf { it >= 0 }?.let(::getInt) ?: 0
    private fun Cursor.longOrNull(column: String): Long? = getColumnIndex(column).takeIf { it >= 0 }?.let(::getLong)?.takeIf { it > 0 }

    private fun stableId(value: String): Long {
        val digest = MessageDigest.getInstance("SHA-256").digest(value.toByteArray())
        return ByteBuffer.wrap(digest, 0, Long.SIZE_BYTES).long or Long.MIN_VALUE
    }

    private data class UriMetadata(
        val capturedAtMillis: Long? = null,
        val modifiedAtMillis: Long? = null,
        val width: Int = 0,
        val height: Int = 0,
        val initialFlags: Set<String> = emptySet()
    )

    private data class PrivateCopy(val uri: Uri, val byteCount: Long, val sourceDigest: String)

    private fun ByteArray.toHex(): String = joinToString(separator = "") { byte -> "%02x".format(byte.toInt() and 0xff) }

    private companion object {
        const val IMPORT_DIRECTORY = "jianwei-imports"
        const val MAX_IMPORTED_ID_ATTEMPTS = 8
        const val MAX_IMPORT_SOURCE_BYTES = 25L * 1024 * 1024
        const val MAX_IMPORT_BATCH_BYTES = 100L * 1024 * 1024
        val RAW_IMPORT_TTL: Duration = Duration.ofHours(24)
        val SANITIZED_IMPORT_TTL: Duration = Duration.ofDays(30)
        val MEDIA_FRESHNESS_EXPRESSION =
            "CASE WHEN ${MediaStore.Images.Media.DATE_ADDED} > ${MediaStore.Images.Media.DATE_MODIFIED} " +
                "THEN ${MediaStore.Images.Media.DATE_ADDED} ELSE ${MediaStore.Images.Media.DATE_MODIFIED} END"
    }
}
