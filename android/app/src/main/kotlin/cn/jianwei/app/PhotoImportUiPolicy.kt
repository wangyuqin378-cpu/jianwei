package cn.jianwei.app

import cn.jianwei.domain.usecase.PhotoImportDisposition
import cn.jianwei.domain.usecase.PhotoImportOutcome

internal enum class PhotoImportEntry {
    PHOTO_PICKER,
    ANDROID_SHARE
}

internal fun photoImportResultMessage(
    outcome: PhotoImportOutcome,
    entry: PhotoImportEntry
): String = when (outcome.disposition) {
    PhotoImportDisposition.NO_READABLE_PHOTOS ->
        if (entry == PhotoImportEntry.ANDROID_SHARE) {
            "未能读取分享的图片；访问可能已被撤销，或图片格式不受支持"
        } else {
            "未能读取所选照片；请重新选择一张受支持的图片"
        }
    PhotoImportDisposition.IMPORTED_AND_QUEUED ->
        if (entry == PhotoImportEntry.ANDROID_SHARE) {
            "已从分享安全导入 ${outcome.importedCount} 张照片，正在等待本机隐私筛选"
        } else {
            "已安全导入 ${outcome.importedCount} 张照片，正在等待本机隐私筛选"
        }
    PhotoImportDisposition.IMPORTED_WHILE_PAUSED ->
        if (entry == PhotoImportEntry.ANDROID_SHARE) {
            "已从分享安全导入 ${outcome.importedCount} 张照片；分析仍处于暂停状态，恢复后继续"
        } else {
            "已安全导入 ${outcome.importedCount} 张照片；分析仍处于暂停状态，恢复后继续"
        }
}

internal fun sharedImportNotice(
    dispositionName: String?,
    importedCount: Int
): String? {
    val disposition = runCatching {
        PhotoImportDisposition.valueOf(dispositionName.orEmpty())
    }.getOrNull() ?: return null
    val validCount = when (disposition) {
        PhotoImportDisposition.NO_READABLE_PHOTOS -> importedCount == 0
        else -> importedCount in 1..ShareReceiverActivity.MAX_SHARED_IMAGES
    }
    if (!validCount) return null
    return photoImportResultMessage(
        PhotoImportOutcome(disposition, importedCount),
        PhotoImportEntry.ANDROID_SHARE
    )
}
