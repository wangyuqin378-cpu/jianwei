package cn.jianwei.app

import cn.jianwei.domain.model.AnalysisPhase
import cn.jianwei.domain.usecase.PhotoImportDisposition
import cn.jianwei.domain.usecase.PhotoImportOutcome

internal enum class PhotoImportEntry {
    PHOTO_PICKER,
    ANDROID_SHARE
}

internal data class ImportedPhotoProgressPresentation(
    val stageLabel: String?,
    val activeStage: Int?,
    val title: String,
    val detail: String
)

internal data class ImportedPhotoNoMatchPresentation(
    val title: String,
    val body: String,
    val guidanceTitle: String,
    val guidanceBody: String,
    val actionLabel: String
)

internal fun importedPhotoNoMatchPresentation(): ImportedPhotoNoMatchPresentation =
    ImportedPhotoNoMatchPresentation(
        title = "暂时没找到可靠知识",
        body = "可能是主体不够清楚、包含隐私内容，或知识库没有可靠事实。见微不会为了出卡而猜测。",
        guidanceTitle = "下一张可以这样选",
        guidanceBody = "让一个杯子、雨伞、扫帚或充电线占画面主要位置；尽量光线清楚、少文字、无人脸。",
        actionLabel = "换一张日常物品照片"
    )

internal fun importedPhotoProgressPresentation(
    paused: Boolean,
    cloudDeletionUnresolved: Boolean,
    phase: AnalysisPhase
): ImportedPhotoProgressPresentation = when {
    cloudDeletionUnresolved -> ImportedPhotoProgressPresentation(
        stageLabel = null,
        activeStage = null,
        title = "云端删除正在等待完成",
        detail = "云端删除尚未完成；这些本地照片不会继续分析，完成删除后请重新选择。"
    )
    paused -> ImportedPhotoProgressPresentation(
        stageLabel = null,
        activeStage = null,
        title = "你刚选的照片正在等待",
        detail = "照片已保存在见微的应用私有空间。恢复分析后，会继续寻找可靠知识。"
    )
    phase == AnalysisPhase.FILTERING -> ImportedPhotoProgressPresentation(
        stageLabel = "第 2 / 3 步 · 本机隐私筛选",
        activeStage = 2,
        title = "正在检查这张照片",
        detail = "正在本机检查画质和隐私；不合适的照片不会上传。"
    )
    phase == AnalysisPhase.SYNCING -> ImportedPhotoProgressPresentation(
        stageLabel = "第 3 / 3 步 · 识别并匹配知识",
        activeStage = 3,
        title = "正在从画面里寻找知识",
        detail = "候选图会先去除位置等元数据，再用于识别和匹配审核过的事实。"
    )
    phase == AnalysisPhase.RETRYING -> ImportedPhotoProgressPresentation(
        stageLabel = "等待重试",
        activeStage = null,
        title = "网络暂时不稳定",
        detail = "系统会保留本机进度并自动重试；如已进入云端，临时图片最长保留 24 小时。"
    )
    else -> ImportedPhotoProgressPresentation(
        stageLabel = "第 1 / 3 步 · 准备照片",
        activeStage = 1,
        title = "正在读你刚选的照片",
        detail = "先准备可分析的照片，再在本机检查画质和隐私。"
    )
}

internal fun retryableImportedPhotoFailureBody(): String =
    "网络或服务暂时不可用。本机仍保留重试所需副本；如已进入云端，临时图片最长保留 24 小时。"

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
            "已从分享安全导入 ${outcome.importedCount} 张照片，正在从画面里找一条可靠知识"
        } else {
            "已安全导入 ${outcome.importedCount} 张照片，正在从画面里找一条可靠知识"
        }
    PhotoImportDisposition.IMPORTED_WHILE_PAUSED ->
        if (entry == PhotoImportEntry.ANDROID_SHARE) {
            "已从分享安全导入 ${outcome.importedCount} 张照片；分析仍处于暂停状态，恢复后继续"
        } else {
            "已安全导入 ${outcome.importedCount} 张照片；分析仍处于暂停状态，恢复后继续"
        }
}

internal fun normalizedPendingImportTokens(values: List<String>?): List<String> = values
    .orEmpty()
    .asSequence()
    .map(String::trim)
    .filter { it.length in 1..128 && IMPORT_TOKEN_PATTERN.matches(it) }
    .distinct()
    .take(MAX_PENDING_IMPORT_RESULTS)
    .toList()

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

private val IMPORT_TOKEN_PATTERN = Regex("[A-Za-z0-9-]+")
private const val MAX_PENDING_IMPORT_RESULTS = 20
