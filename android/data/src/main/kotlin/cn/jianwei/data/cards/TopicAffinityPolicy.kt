package cn.jianwei.data.cards

import cn.jianwei.domain.feedback.MAX_TOPIC_AFFINITY as DOMAIN_MAX_TOPIC_AFFINITY
import cn.jianwei.domain.feedback.MIN_TOPIC_AFFINITY as DOMAIN_MIN_TOPIC_AFFINITY
import cn.jianwei.domain.feedback.feedbackAffinityDelta
import cn.jianwei.domain.feedback.updatedTopicAffinity
import cn.jianwei.domain.model.FeedbackAction

internal const val MIN_TOPIC_AFFINITY = DOMAIN_MIN_TOPIC_AFFINITY
internal const val MAX_TOPIC_AFFINITY = DOMAIN_MAX_TOPIC_AFFINITY

internal fun affinityDelta(action: FeedbackAction): Double = feedbackAffinityDelta(action)

internal fun updatedAffinity(current: Double, action: FeedbackAction): Double =
    updatedTopicAffinity(current, action)

internal fun topicAliasTokens(topicId: String, title: String): List<String> =
    sequenceOf(topicId, title)
        .flatMap { it.split(ALIAS_SEPARATOR).asSequence() }
        .map { it.trim().lowercase() }
        .filter { it.length >= 2 && it.length <= 48 }
        .distinct()
        .take(12)
        .toList()

private val ALIAS_SEPARATOR = Regex("[^\\p{L}\\p{N}]+")
