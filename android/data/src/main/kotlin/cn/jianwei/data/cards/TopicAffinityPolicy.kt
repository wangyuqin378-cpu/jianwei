package cn.jianwei.data.cards

import cn.jianwei.domain.model.FeedbackAction

internal const val MIN_TOPIC_AFFINITY = -2.0
internal const val MAX_TOPIC_AFFINITY = 2.0

internal fun affinityDelta(action: FeedbackAction): Double = when (action) {
    FeedbackAction.LIKE -> 0.35
    FeedbackAction.SAVE -> 0.50
    FeedbackAction.DISLIKE -> -0.40
    FeedbackAction.TOO_PRIVATE -> -0.75
    FeedbackAction.WRONG_OBJECT -> 0.0
}

internal fun updatedAffinity(current: Double, action: FeedbackAction): Double =
    (current + affinityDelta(action)).coerceIn(MIN_TOPIC_AFFINITY, MAX_TOPIC_AFFINITY)

internal fun topicAliasTokens(topicId: String, title: String): List<String> =
    sequenceOf(topicId, title)
        .flatMap { it.split(ALIAS_SEPARATOR).asSequence() }
        .map { it.trim().lowercase() }
        .filter { it.length >= 2 && it.length <= 48 }
        .distinct()
        .take(12)
        .toList()

private val ALIAS_SEPARATOR = Regex("[^\\p{L}\\p{N}]+")
