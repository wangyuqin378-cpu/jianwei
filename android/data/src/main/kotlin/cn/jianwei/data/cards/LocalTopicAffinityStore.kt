package cn.jianwei.data.cards

import cn.jianwei.data.local.CardDao
import cn.jianwei.data.local.TopicAffinityEntity
import cn.jianwei.domain.model.FeedbackAction
import cn.jianwei.domain.model.TopicAffinitySignal
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class LocalTopicAffinityStore @Inject constructor(
    private val cards: CardDao
) {
    suspend fun applyFeedback(cardId: String, action: FeedbackAction) {
        if (action == FeedbackAction.WRONG_OBJECT) return
        val card = cards.findById(cardId) ?: return
        applyTopicFeedback(card.topicId, card.title, action)
    }

    suspend fun applyTopicFeedback(topicId: String, title: String, action: FeedbackAction) {
        if (action == FeedbackAction.WRONG_OBJECT) return
        val current = cards.findTopicAffinity(topicId)
        cards.upsertTopicAffinity(
            TopicAffinityEntity(
                topicId = topicId,
                weight = updatedAffinity(current?.weight ?: 0.0, action),
                aliases = (current?.aliases.orEmpty() + topicAliasTokens(topicId, title)).distinct().take(12),
                updatedAtMillis = System.currentTimeMillis()
            )
        )
    }

    suspend fun applyServerWeights(weights: Collection<ServerTopicAffinity>) {
        weights.forEach { remote ->
            if (remote.topicId.isBlank()) return@forEach
            val current = cards.findTopicAffinity(remote.topicId)
            cards.upsertTopicAffinity(
                TopicAffinityEntity(
                    topicId = remote.topicId,
                    weight = remote.weight.coerceIn(MIN_TOPIC_AFFINITY, MAX_TOPIC_AFFINITY),
                    aliases = (current?.aliases.orEmpty() + remote.aliases)
                        .map { it.trim().lowercase() }
                        .filter { it.length in 2..48 }
                        .distinct()
                        .take(12),
                    updatedAtMillis = System.currentTimeMillis()
                )
            )
        }
    }

    suspend fun signals(): List<TopicAffinitySignal> = cards.topicAffinities().map {
        TopicAffinitySignal(it.topicId, it.weight, it.aliases.toSet())
    }
}

data class ServerTopicAffinity(
    val topicId: String,
    val weight: Double,
    val aliases: List<String>
)
