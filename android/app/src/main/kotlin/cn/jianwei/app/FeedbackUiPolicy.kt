package cn.jianwei.app

import cn.jianwei.domain.model.CardFeedbackState
import cn.jianwei.domain.model.FeedbackAction
import cn.jianwei.domain.model.FeedbackSubmissionResult
import cn.jianwei.domain.model.KnowledgeCard
import cn.jianwei.domain.model.SavedCardUpdateResult
import cn.jianwei.domain.model.TopicAffinitySignal
import kotlin.math.abs

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
    result.effectiveAction == FeedbackAction.LIKE ->
        "已记住「有意思」；之后会更常留意这类内容"
    result.effectiveAction == FeedbackAction.DISLIKE ->
        "已记住「没意思」；之后会降低这类内容的推荐权重"
    else -> "已记录「${result.effectiveAction.userLabel()}」"
}

internal data class FeedbackLearningPresentation(
    val title: String,
    val body: String
)

internal fun feedbackLearningPresentation(
    action: FeedbackAction,
    detectedObjectName: String
): FeedbackLearningPresentation {
    val objectLabel = detectedObjectName.trim().takeIf {
        it.isNotEmpty() && it.length <= 24 && it.none(Char::isISOControl)
    } ?: "这类物件"
    return when (action) {
        FeedbackAction.LIKE -> FeedbackLearningPresentation(
            title = "已记住 · 有意思",
            body = "之后会更常留意“$objectLabel”这类内容。只影响本次安装。"
        )
        FeedbackAction.DISLIKE -> FeedbackLearningPresentation(
            title = "已记住 · 没意思",
            body = "之后会降低“$objectLabel”这类内容的推荐权重。只影响本次安装。"
        )
        FeedbackAction.WRONG_OBJECT -> FeedbackLearningPresentation(
            title = "已记住 · 识错了",
            body = "这张卡不会作为兴趣信号。"
        )
        FeedbackAction.TOO_PRIVATE -> FeedbackLearningPresentation(
            title = "已记住 · 太私人",
            body = "这张照片不会继续用于分析。"
        )
        FeedbackAction.SAVE -> FeedbackLearningPresentation(
            title = "已记住 · 收藏",
            body = "之后会更常留意这类内容。只影响本次安装。"
        )
    }
}

data class LearnedPreferenceSummary(
    val moreOften: List<String> = emptyList(),
    val lessOften: List<String> = emptyList()
) {
    val isEmpty: Boolean get() = moreOften.isEmpty() && lessOften.isEmpty()
}

internal fun learnedPreferenceSummary(
    affinities: Collection<TopicAffinitySignal>,
    cards: Collection<KnowledgeCard>,
    maximumPerDirection: Int = 3
): LearnedPreferenceSummary {
    if (maximumPerDirection <= 0) return LearnedPreferenceSummary()
    val labelsByTopic = cards
        .asSequence()
        .filter { it.status == "scheduled" }
        .mapNotNull { card ->
            card.detectedObjectName.trim().takeIf { label ->
                label.isNotEmpty() && label.length <= 24 && label.none(Char::isISOControl)
            }?.let { label -> card.topicId to label }
        }
        .groupBy({ it.first }, { it.second })
        .mapValues { (_, labels) -> labels.first() }
    val ranked = affinities
        .asSequence()
        .filter { it.weight.isFinite() && it.weight != 0.0 && it.topicId in labelsByTopic }
        .sortedWith(compareByDescending<TopicAffinitySignal> { abs(it.weight) }.thenBy { it.topicId })
        .map { signal -> signal to requireNotNull(labelsByTopic[signal.topicId]) }
        .toList()

    fun labels(positive: Boolean): List<String> = ranked
        .asSequence()
        .filter { (signal) -> if (positive) signal.weight > 0.0 else signal.weight < 0.0 }
        .map { it.second }
        .distinct()
        .take(maximumPerDirection)
        .toList()

    return LearnedPreferenceSummary(
        moreOften = labels(positive = true),
        lessOften = labels(positive = false)
    )
}

internal fun savedCardUpdateMessage(result: SavedCardUpdateResult): String = when {
    !result.cardAvailable -> "这张卡已不可用，收藏没有更改"
    result.changed && result.isSaved -> "已收藏，可在收藏页查看"
    result.changed -> "已取消收藏"
    result.isSaved -> "这张卡已在收藏中"
    else -> "这张卡已经不在收藏中"
}
