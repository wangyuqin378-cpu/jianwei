package cn.jianwei.data.cards

import cn.jianwei.data.local.CardDao
import cn.jianwei.data.local.TopicAffinityEntity
import cn.jianwei.domain.model.FeedbackAction
import cn.jianwei.domain.model.TopicAffinitySignal
import java.io.IOException
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
        // Validate and normalize the complete response before the first Room write. A malformed
        // later item must not leave a partially applied preference snapshot.
        validatedServerTopicAffinities(weights).forEach { remote ->
            val current = cards.findTopicAffinity(remote.topicId)
            cards.upsertTopicAffinity(
                TopicAffinityEntity(
                    topicId = remote.topicId,
                    weight = remote.weight,
                    aliases = (current?.aliases.orEmpty() + remote.aliases)
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

internal fun validatedServerTopicAffinities(
    weights: Collection<ServerTopicAffinity>
): List<ServerTopicAffinity> {
    if (weights.size > MAX_SERVER_TOPIC_AFFINITIES) {
        throw IOException("Feedback response contains too many topic affinities")
    }
    val seenTopicIds = mutableSetOf<String>()
    return weights.map { remote ->
        if (!SERVER_TOPIC_ID.matches(remote.topicId) || !seenTopicIds.add(remote.topicId)) {
            throw IOException("Feedback response contains an invalid topic ID")
        }
        if (
            !remote.weight.isFinite() ||
            remote.weight !in MIN_TOPIC_AFFINITY..MAX_TOPIC_AFFINITY
        ) {
            throw IOException("Feedback response contains an invalid topic weight")
        }
        if (remote.aliases.size > MAX_SERVER_TOPIC_ALIASES) {
            throw IOException("Feedback response contains too many topic aliases")
        }
        val aliases = remote.aliases.map { rawAlias ->
            val alias = rawAlias.trim().lowercase()
            val codePoints = alias.codePointCount(0, alias.length)
            if (
                codePoints !in MIN_TOPIC_ALIAS_CODE_POINTS..MAX_TOPIC_ALIAS_CODE_POINTS ||
                alias.any(Char::isISOControl)
            ) {
                throw IOException("Feedback response contains an invalid topic alias")
            }
            alias
        }.distinct()
        ServerTopicAffinity(remote.topicId, remote.weight, aliases)
    }
}

private val SERVER_TOPIC_ID = Regex("^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$")
private const val MAX_SERVER_TOPIC_AFFINITIES = 20
private const val MAX_SERVER_TOPIC_ALIASES = 12
private const val MIN_TOPIC_ALIAS_CODE_POINTS = 2
private const val MAX_TOPIC_ALIAS_CODE_POINTS = 48
