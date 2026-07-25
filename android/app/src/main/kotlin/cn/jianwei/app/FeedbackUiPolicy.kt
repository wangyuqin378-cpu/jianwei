package cn.jianwei.app

import cn.jianwei.domain.model.CardFeedbackState
import cn.jianwei.domain.model.FeedbackAction
import cn.jianwei.domain.model.FeedbackSubmissionResult
import cn.jianwei.domain.model.SavedCardUpdateResult

internal fun FeedbackAction.userLabel(): String = when (this) {
    FeedbackAction.LIKE -> "有意思"
    FeedbackAction.DISLIKE -> "没意思"
    FeedbackAction.WRONG_OBJECT -> "识错了"
    FeedbackAction.TOO_PRIVATE -> "太私人"
    FeedbackAction.SAVE -> "收藏"
}

internal fun shouldOfferOrdinaryFeedback(state: CardFeedbackState?): Boolean = state == null

internal fun shouldStackFeedbackChoices(availableWidthDp: Float, fontScale: Float): Boolean =
    availableWidthDp < 260f || fontScale >= 1.5f

internal fun feedbackResultMessage(result: FeedbackSubmissionResult): String = when {
    !result.accepted && result.cardRemoved -> "这张卡已经删除，不会再次分析对应照片"
    !result.accepted -> "这张卡已记录「${result.effectiveAction.userLabel()}」，不会重复计入推荐"
    result.effectiveAction == FeedbackAction.TOO_PRIVATE ->
        "已删除这张卡，并停止分析对应照片"
    result.effectiveAction == FeedbackAction.WRONG_OBJECT ->
        "已隐藏这张识别有误的卡片；不会把它当作兴趣信号"
    else ->
        "已记录「${result.effectiveAction.userLabel()}」，用于改进本次安装的推荐"
}

internal fun savedCardUpdateMessage(result: SavedCardUpdateResult): String = when {
    !result.cardAvailable -> "这张卡已不可用，收藏没有更改"
    result.changed && result.isSaved -> "已收藏，可在收藏页查看"
    result.changed -> "已取消收藏"
    result.isSaved -> "这张卡已在收藏中"
    else -> "这张卡已经不在收藏中"
}
