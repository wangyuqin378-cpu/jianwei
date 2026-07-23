package cn.jianwei.data.photos

import cn.jianwei.data.local.PhotoCandidateEntity
import cn.jianwei.domain.model.AnalysisState
import cn.jianwei.domain.model.PhotoAccess
import cn.jianwei.domain.model.PhotoOrigin

internal enum class MediaStoreIndexAction {
    INSERT,
    REFRESH,
    IGNORE
}

/**
 * MediaStore timestamps have second-level precision on older Android releases. Scans therefore
 * deliberately overlap the last indexed second and need an idempotent decision at the database
 * boundary. A real metadata change resets the candidate so the privacy filter runs again.
 */
internal fun mediaStoreIndexAction(
    existing: PhotoCandidateEntity?,
    discovered: PhotoCandidateEntity
): MediaStoreIndexAction {
    if (existing == null) return MediaStoreIndexAction.INSERT
    if (existing.origin != PhotoOrigin.MEDIA_STORE.name || discovered.origin != PhotoOrigin.MEDIA_STORE.name) {
        return MediaStoreIndexAction.IGNORE
    }
    val changed = existing.analysisState == AnalysisState.ACCESS_UNAVAILABLE.name ||
        discovered.modifiedAtMillis > existing.modifiedAtMillis ||
        discovered.capturedAtMillis != existing.capturedAtMillis ||
        discovered.contentUri != existing.contentUri ||
        discovered.width != existing.width ||
        discovered.height != existing.height ||
        discovered.sensitiveFlags != existing.sensitiveFlags
    return if (changed) MediaStoreIndexAction.REFRESH else MediaStoreIndexAction.IGNORE
}

internal fun mediaStoreFreshnessMillis(dateAddedSeconds: Long, dateModifiedSeconds: Long): Long =
    maxOf(dateAddedSeconds, dateModifiedSeconds).coerceAtLeast(0L) * 1_000L

internal data class MediaStoreWatermark(val freshnessSeconds: Long, val mediaId: Long) : Comparable<MediaStoreWatermark> {
    override fun compareTo(other: MediaStoreWatermark): Int =
        compareValuesBy(this, other, MediaStoreWatermark::freshnessSeconds, MediaStoreWatermark::mediaId)
}

internal fun PhotoCandidateEntity.mediaStoreWatermark(): MediaStoreWatermark =
    MediaStoreWatermark(modifiedAtMillis / 1_000L, localId)

/**
 * A FULL grant exposes a stable MediaStore view, so a composite timestamp/id watermark can make
 * daily scans incremental. A PARTIAL grant is mutable authorization state: the user can expose an
 * older photo without changing that photo's MediaStore timestamps. Re-running the bounded newest
 * page is therefore required for partial access; database indexing remains idempotent and avoids
 * repeating privacy analysis for unchanged rows.
 */
internal fun mediaStoreCursorForAccess(
    access: PhotoAccess,
    stored: MediaStoreWatermark?
): MediaStoreWatermark? = if (access == PhotoAccess.FULL) stored else null

internal fun advanceMediaStoreWatermark(
    current: MediaStoreWatermark?,
    discovered: List<PhotoCandidateEntity>,
    initialFloor: MediaStoreWatermark
): MediaStoreWatermark = discovered.maxOfOrNull(PhotoCandidateEntity::mediaStoreWatermark)
    ?.let { discoveredMaximum -> maxOf(current ?: initialFloor, discoveredMaximum) }
    ?: current
    ?: initialFloor
