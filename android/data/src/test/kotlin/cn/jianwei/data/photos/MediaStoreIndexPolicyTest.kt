package cn.jianwei.data.photos

import cn.jianwei.data.local.PhotoCandidateEntity
import cn.jianwei.domain.model.AnalysisState
import cn.jianwei.domain.model.PhotoAccess
import cn.jianwei.domain.model.PhotoOrigin
import com.google.common.truth.Truth.assertThat
import org.junit.Test

class MediaStoreIndexPolicyTest {
    @Test
    fun unseenMediaStoreRowIsInserted() {
        assertThat(mediaStoreIndexAction(null, candidate())).isEqualTo(MediaStoreIndexAction.INSERT)
    }

    @Test
    fun overlapAtWatermarkIsIdempotent() {
        val existing = candidate(state = AnalysisState.COMPLETED)

        assertThat(mediaStoreIndexAction(existing, candidate())).isEqualTo(MediaStoreIndexAction.IGNORE)
    }

    @Test
    fun newerMediaStoreRevisionIsRefreshedForPrivacyAnalysis() {
        val existing = candidate(modifiedAtMillis = 1_000, state = AnalysisState.COMPLETED)
        val edited = candidate(modifiedAtMillis = 2_000)

        assertThat(mediaStoreIndexAction(existing, edited)).isEqualTo(MediaStoreIndexAction.REFRESH)
    }

    @Test
    fun sameSecondMetadataChangeIsRefreshed() {
        val existing = candidate(width = 100, height = 100, state = AnalysisState.COMPLETED)
        val edited = candidate(width = 120, height = 100)

        assertThat(mediaStoreIndexAction(existing, edited)).isEqualTo(MediaStoreIndexAction.REFRESH)
    }

    @Test
    fun accessibleDiscoveryRestoresPreviouslyUnavailableRow() {
        val unavailable = candidate(state = AnalysisState.ACCESS_UNAVAILABLE)

        assertThat(mediaStoreIndexAction(unavailable, candidate())).isEqualTo(MediaStoreIndexAction.REFRESH)
    }

    @Test
    fun mediaStoreDiscoveryCannotOverwritePrivateImport() {
        val imported = candidate(origin = PhotoOrigin.PHOTO_PICKER, modifiedAtMillis = 1_000)
        val mediaStore = candidate(origin = PhotoOrigin.MEDIA_STORE, modifiedAtMillis = 2_000)

        assertThat(mediaStoreIndexAction(imported, mediaStore)).isEqualTo(MediaStoreIndexAction.IGNORE)
    }

    @Test
    fun freshnessUsesAddedOrModifiedClock() {
        assertThat(mediaStoreFreshnessMillis(dateAddedSeconds = 12, dateModifiedSeconds = 10)).isEqualTo(12_000)
        assertThat(mediaStoreFreshnessMillis(dateAddedSeconds = 8, dateModifiedSeconds = 11)).isEqualTo(11_000)
    }

    @Test
    fun persistentCompositeWatermarkPagesMoreThanFiveHundredChangesWithoutSkipping() {
        val floor = MediaStoreWatermark(100, 0)
        val rows = (1L..1_201L).map { id ->
            candidate(
                localId = id,
                modifiedAtMillis = (101L + (id - 1L) / 3L) * 1_000L
            )
        }
        var cursor = floor
        val seen = mutableListOf<Long>()
        val pageSizes = mutableListOf<Int>()
        while (true) {
            val page = rows.asSequence()
                .filter { it.mediaStoreWatermark() > cursor }
                .sortedBy(PhotoCandidateEntity::mediaStoreWatermark)
                .take(500)
                .toList()
            if (page.isEmpty()) break
            seen += page.map { it.localId }
            pageSizes += page.size
            cursor = advanceMediaStoreWatermark(cursor, page, floor)
        }

        assertThat(pageSizes).containsExactly(500, 500, 201).inOrder()
        assertThat(seen).containsExactlyElementsIn(1L..1_201L).inOrder()
    }

    @Test
    fun fullAccessUsesStoredIncrementalWatermark() {
        val stored = MediaStoreWatermark(200, 42)

        assertThat(mediaStoreCursorForAccess(PhotoAccess.FULL, stored)).isEqualTo(stored)
    }

    @Test
    fun partialAccessReconcilesBoundedPageInsteadOfTrustingStaleAuthorizationWatermark() {
        val stored = MediaStoreWatermark(200, 42)

        assertThat(mediaStoreCursorForAccess(PhotoAccess.PARTIAL, stored)).isNull()
        assertThat(mediaStoreCursorForAccess(PhotoAccess.PICKER_ONLY, stored)).isNull()
    }

    private fun candidate(
        localId: Long = 42,
        origin: PhotoOrigin = PhotoOrigin.MEDIA_STORE,
        modifiedAtMillis: Long = 1_000,
        width: Int = 100,
        height: Int = 100,
        state: AnalysisState = AnalysisState.DISCOVERED
    ) = PhotoCandidateEntity(
        localId = localId,
        candidateToken = "candidate-token",
        contentUri = "content://media/external/images/media/$localId",
        capturedAtMillis = 500,
        modifiedAtMillis = modifiedAtMillis,
        sourceDigest = null,
        perceptualHash = null,
        qualityScore = 0.0,
        localLabels = emptyList(),
        sensitiveFlags = emptySet(),
        analysisState = state.name,
        origin = origin.name,
        width = width,
        height = height
    )
}
