package cn.jianwei.domain.usecase

import cn.jianwei.domain.repository.AnalysisScheduler
import cn.jianwei.domain.repository.PhotoRepository

enum class PhotoImportDisposition {
    NO_READABLE_PHOTOS,
    IMPORTED_AND_QUEUED,
    IMPORTED_WHILE_PAUSED
}

data class PhotoImportOutcome(
    val disposition: PhotoImportDisposition,
    val importedCount: Int
) {
    init {
        require(importedCount >= 0)
        require(
            (disposition == PhotoImportDisposition.NO_READABLE_PHOTOS && importedCount == 0) ||
                (disposition != PhotoImportDisposition.NO_READABLE_PHOTOS && importedCount > 0)
        )
    }
}

/**
 * One business boundary for both Photo Picker and Android Sharesheet imports.
 *
 * Copying into private storage is allowed while analysis is paused because it is an explicit,
 * per-image user action. Scheduling remains fail-closed until the user resumes analysis.
 */
class ImportPhotosUseCase(
    private val photos: PhotoRepository,
    private val scheduler: AnalysisScheduler
) {
    suspend operator fun invoke(uris: List<String>): PhotoImportOutcome {
        val importedCount = photos.importUris(uris).size
        if (importedCount == 0) {
            return PhotoImportOutcome(PhotoImportDisposition.NO_READABLE_PHOTOS, 0)
        }
        if (scheduler.isPaused()) {
            return PhotoImportOutcome(PhotoImportDisposition.IMPORTED_WHILE_PAUSED, importedCount)
        }
        scheduler.scheduleImportedPhotos()
        return PhotoImportOutcome(PhotoImportDisposition.IMPORTED_AND_QUEUED, importedCount)
    }
}
