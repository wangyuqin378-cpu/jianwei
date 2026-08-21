package cn.jianwei.domain.feedback

import cn.jianwei.domain.model.FeedbackAction

const val MIN_TOPIC_AFFINITY = -2.0
const val MAX_TOPIC_AFFINITY = 2.0

fun feedbackAffinityDelta(action: FeedbackAction): Double = when (action) {
    FeedbackAction.LIKE -> 0.35
    FeedbackAction.SAVE -> 0.50
    FeedbackAction.DISLIKE -> -0.40
    FeedbackAction.TOO_PRIVATE -> -0.75
    FeedbackAction.WRONG_OBJECT -> 0.0
}

fun updatedTopicAffinity(current: Double, action: FeedbackAction): Double =
    (current + feedbackAffinityDelta(action)).coerceIn(MIN_TOPIC_AFFINITY, MAX_TOPIC_AFFINITY)

fun appliedFeedbackAffinityDelta(current: Double, action: FeedbackAction): Double =
    updatedTopicAffinity(current, action) - current

fun replaceAppliedTopicAffinity(
    current: Double,
    previousAppliedDelta: Double,
    nextAction: FeedbackAction
): Double =
    (current - previousAppliedDelta + feedbackAffinityDelta(nextAction))
        .coerceIn(MIN_TOPIC_AFFINITY, MAX_TOPIC_AFFINITY)

fun replaceTopicAffinity(
    current: Double,
    previousActions: Collection<FeedbackAction>,
    nextAction: FeedbackAction
): Double {
    val previousDelta = previousActions.distinct().sumOf(::feedbackAffinityDelta)
    return (current - previousDelta + feedbackAffinityDelta(nextAction))
        .coerceIn(MIN_TOPIC_AFFINITY, MAX_TOPIC_AFFINITY)
}
