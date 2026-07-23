package cn.jianwei.data.cards

import cn.jianwei.domain.model.FeedbackAction
import com.google.common.truth.Truth.assertThat
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
}
