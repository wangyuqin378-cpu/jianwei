package cn.jianwei.data.cards

import cn.jianwei.domain.model.FeedbackAction
import com.google.common.truth.Truth.assertThat
import java.io.IOException
import org.junit.Assert.assertThrows
import org.junit.Test

class TopicAffinityPolicyTest {
    @Test
    fun `feedback actions have deliberate bounded effects`() {
        assertThat(affinityDelta(FeedbackAction.LIKE)).isGreaterThan(0.0)
        assertThat(affinityDelta(FeedbackAction.SAVE)).isGreaterThan(affinityDelta(FeedbackAction.LIKE))
        assertThat(affinityDelta(FeedbackAction.DISLIKE)).isLessThan(0.0)
        assertThat(affinityDelta(FeedbackAction.TOO_PRIVATE)).isLessThan(affinityDelta(FeedbackAction.DISLIKE))
        assertThat(affinityDelta(FeedbackAction.WRONG_OBJECT)).isEqualTo(0.0)
        assertThat(updatedAffinity(1.9, FeedbackAction.SAVE)).isEqualTo(MAX_TOPIC_AFFINITY)
        assertThat(updatedAffinity(-1.9, FeedbackAction.TOO_PRIVATE)).isEqualTo(MIN_TOPIC_AFFINITY)
    }

    @Test
    fun `aliases contain only bounded topic metadata tokens`() {
        val aliases = topicAliasTokens("cleaning/toothbrush", "牙刷的设计原理")

        assertThat(aliases).containsAtLeast("cleaning", "toothbrush", "牙刷的设计原理")
        assertThat(aliases).doesNotContain("")
        assertThat(aliases).hasSize(3)
    }

    @Test
    fun `server topic affinities are normalized only after the whole payload is valid`() {
        val validated = validatedServerTopicAffinities(
            listOf(ServerTopicAffinity("broom", 0.7, listOf("  扫帚  ", "BROOM", "broom")))
        )

        assertThat(validated).containsExactly(
            ServerTopicAffinity("broom", 0.7, listOf("扫帚", "broom"))
        )

        val invalidPayloads = listOf(
            listOf(ServerTopicAffinity("topic/with/path", 0.0, emptyList())),
            listOf(
                ServerTopicAffinity("broom", 0.0, emptyList()),
                ServerTopicAffinity("broom", 0.5, emptyList())
            ),
            listOf(ServerTopicAffinity("broom", Double.NaN, emptyList())),
            listOf(ServerTopicAffinity("broom", Double.POSITIVE_INFINITY, emptyList())),
            listOf(ServerTopicAffinity("broom", MAX_TOPIC_AFFINITY + 0.01, emptyList())),
            listOf(ServerTopicAffinity("broom", 0.0, List(13) { "alias-$it" })),
            listOf(ServerTopicAffinity("broom", 0.0, listOf("x"))),
            listOf(ServerTopicAffinity("broom", 0.0, listOf("知".repeat(49)))),
            listOf(ServerTopicAffinity("broom", 0.0, listOf("bad\u0000alias"))),
            List(21) { index -> ServerTopicAffinity("topic-$index", 0.0, emptyList()) }
        )

        invalidPayloads.forEach { payload ->
            assertThrows(IOException::class.java) { validatedServerTopicAffinities(payload) }
        }
    }
}
