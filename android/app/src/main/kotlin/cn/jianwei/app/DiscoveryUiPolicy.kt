package cn.jianwei.app

import cn.jianwei.domain.model.AnalysisPhase
import cn.jianwei.domain.model.AnalysisProgress
import cn.jianwei.domain.model.PhotoAccess

internal enum class EmptyDiscoveryAction { PICK, RESUME, RETRY }

internal data class EmptyDiscoveryCopy(
    val title: String,
    val body: String,
    val actionLabel: String,
    val action: EmptyDiscoveryAction
)

internal data class HomeActivityIndicator(
    val contentDescription: String,
    val stateDescription: String
)

internal fun shouldScheduleAutomaticDiscovery(access: PhotoAccess): Boolean =
    access != PhotoAccess.PICKER_ONLY

internal fun shouldShowWidgetCallToAction(showSavedCards: Boolean, cardIndex: Int): Boolean =
    !showSavedCards && cardIndex == 0

internal fun shouldStackWidgetCallToAction(availableWidthDp: Float, fontScale: Float): Boolean =
    availableWidthDp < 360f || fontScale >= 1.5f

internal fun shouldUseCompactTabLabels(availableWidthDp: Float, fontScale: Float): Boolean =
    availableWidthDp < 360f || fontScale >= 1.5f

internal fun shouldStackKnowledgeCardActions(availableWidthDp: Float, fontScale: Float): Boolean =
    availableWidthDp < 340f || fontScale >= 1.5f

internal fun shouldStackOnboardingInterests(availableWidthDp: Float, fontScale: Float): Boolean =
    availableWidthDp < 360f || fontScale >= 1.5f

internal fun discoveryStartMessage(access: PhotoAccess): String =
    if (shouldScheduleAutomaticDiscovery(access)) {
        "已开始扫描近 90 天照片；端侧筛选将在后台继续"
    } else {
        "没有相册访问权限，因此不会自动扫描；你仍可选择或分享照片"
    }

internal fun isAnalysisActive(progress: AnalysisProgress): Boolean = progress.phase in setOf(
    AnalysisPhase.QUEUED,
    AnalysisPhase.SCANNING,
    AnalysisPhase.FILTERING,
    AnalysisPhase.SYNCING
)

internal fun areUserMutationsEnabled(activeOperation: UserOperation?): Boolean =
    activeOperation == null

internal fun homeActivityIndicator(
    activeOperation: UserOperation?,
    progress: AnalysisProgress
): HomeActivityIndicator? = when {
    activeOperation != null -> HomeActivityIndicator("操作进度", activeOperation.progressLabel)
    isAnalysisActive(progress) -> HomeActivityIndicator("照片分析", "正在处理")
    else -> null
}

internal fun analysisStatusBanner(progress: AnalysisProgress, hasCards: Boolean): String? = when {
    !hasCards -> null
    progress.phase == AnalysisPhase.RETRYING -> progress.detail
    progress.phase == AnalysisPhase.FAILED -> progress.detail
    else -> null
}

internal fun emptyDiscoveryCopy(
    paused: Boolean,
    access: PhotoAccess,
    progress: AnalysisProgress
): EmptyDiscoveryCopy = when {
    paused -> EmptyDiscoveryCopy(
        title = "分析已暂停",
        body = "恢复后才会继续筛选照片、上传候选和同步卡片；暂停期间已有缓存仍可在桌面组件查看。",
        actionLabel = "恢复分析",
        action = EmptyDiscoveryAction.RESUME
    )
    progress.phase == AnalysisPhase.QUEUED -> EmptyDiscoveryCopy(
        title = "照片已进入处理队列",
        body = "系统会在网络可用且电量不低时继续。原图不会建立云端照片库。",
        actionLabel = "继续选择照片",
        action = EmptyDiscoveryAction.PICK
    )
    progress.phase == AnalysisPhase.SCANNING -> EmptyDiscoveryCopy(
        title = "正在查看最近的照片",
        body = "只读取你授权的范围，首次最多检查 500 张；照片仍先留在本机。",
        actionLabel = "继续选择照片",
        action = EmptyDiscoveryAction.PICK
    )
    progress.phase == AnalysisPhase.FILTERING -> EmptyDiscoveryCopy(
        title = "正在本机筛选照片",
        body = "人脸、截图、证件、高文字和模糊照片会先被排除，只有少量候选进入下一步。",
        actionLabel = "继续选择照片",
        action = EmptyDiscoveryAction.PICK
    )
    progress.phase == AnalysisPhase.SYNCING -> EmptyDiscoveryCopy(
        title = "正在匹配审核过的知识",
        body = "候选会去除 EXIF 后上传识别；没有可靠物件或审核事实时不会勉强生成。",
        actionLabel = "继续选择照片",
        action = EmptyDiscoveryAction.PICK
    )
    progress.phase == AnalysisPhase.RETRYING -> EmptyDiscoveryCopy(
        title = "暂时无法完成分析",
        body = progress.detail ?: "候选仍保留在本机，系统会自动重试。",
        actionLabel = "立即再试",
        action = EmptyDiscoveryAction.RETRY
    )
    progress.phase == AnalysisPhase.FAILED -> EmptyDiscoveryCopy(
        title = "这次处理没有完成",
        body = progress.detail ?: "照片候选没有被发布为知识卡，你可以重新尝试。",
        actionLabel = "重新尝试",
        action = EmptyDiscoveryAction.RETRY
    )
    progress.phase == AnalysisPhase.NO_MATCH -> EmptyDiscoveryCopy(
        title = "这批照片暂时没有合适卡片",
        body = "可能是照片被隐私规则排除、物件不够明确，或知识库还没有可靠事实。你可以再选择一些日常物件照片。",
        actionLabel = "选择其他照片",
        action = EmptyDiscoveryAction.PICK
    )
    access == PhotoAccess.PICKER_ONLY -> EmptyDiscoveryCopy(
        title = "先选择一张照片",
        body = "见微不会自动读取相册。你可以使用系统照片选择器，或从相册、微信、浏览器等 App 分享图片到见微。",
        actionLabel = "选择照片",
        action = EmptyDiscoveryAction.PICK
    )
    else -> EmptyDiscoveryCopy(
        title = "准备寻找第一张卡片",
        body = "开始后会在后台检查近 90 天照片；没有可靠物件或审核事实时不会勉强生成。",
        actionLabel = "再选择一些照片",
        action = EmptyDiscoveryAction.PICK
    )
}
