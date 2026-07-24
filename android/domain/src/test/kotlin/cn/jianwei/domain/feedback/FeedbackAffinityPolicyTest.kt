package cn.jianwei.domain.feedback

import cn.jianwei.domain.model.FeedbackAction
import cn.jianwei.domain.model.isCardFeedback
import cn.jianwei.domain.model.isOrdinaryCardFeedback
import com.google.common.truth.Truth.assertThat
import org.junit.Test

class FeedbackAffinityPolicyTest {
    @Test
    fun `only visible non-destructive card choices are ordinary feedback`() {
        assertThat(FeedbackAction.LIKE.isOrdinaryCardFeedback()).isTrue()
        assertThat(FeedbackAction.DISLIKE.isOrdinaryCardFeedback()).isTrue()
        assertThat(FeedbackAction.WRONG_OBJECT.isOrdinaryCardFeedback()).isTrue()
        assertThat(FeedbackAction.TOO_PRIVATE.isOrdinaryCardFeedback()).isFalse()
        assertThat(FeedbackAction.SAVE.isOrdinaryCardFeedback()).isFalse()
    }

    @Test
    fun `save is an engagement signal but not card feedback`() {
        assertThat(FeedbackAction.LIKE.isCardFeedback()).isTrue()
        assertThat(FeedbackAction.DISLIKE.isCardFeedback()).isTrue()
        assertThat(FeedbackAction.WRONG_OBJECT.isCardFeedback()).isTrue()
        assertThat(FeedbackAction.TOO_PRIVATE.isCardFeedback()).isTrue()
        assertThat(FeedbackAction.SAVE.isCardFeedback()).isFalse()
    }

    @Test
    fun `privacy replacement removes prior ordinary and save signals`() {
        val current = feedbackAffinityDelta(FeedbackAction.LIKE) +
            feedbackAffinityDelta(FeedbackAction.SAVE)

        val replaced = replaceTopicAffinity(
            current = current,
            previousActions = listOf(FeedbackAction.LIKE, FeedbackAction.SAVE),
            nextAction = FeedbackAction.TOO_PRIVATE
        )

        assertThat(replaced).isEqualTo(feedbackAffinityDelta(FeedbackAction.TOO_PRIVATE))
    }

    @Test
    fun `affinity remains bounded after replacement`() {
        assertThat(updatedTopicAffinity(1.9, FeedbackAction.SAVE)).isEqualTo(MAX_TOPIC_AFFINITY)
        assertThat(replaceTopicAffinity(-1.9, emptyList(), FeedbackAction.TOO_PRIVATE))
            .isEqualTo(MIN_TOPIC_AFFINITY)
    }
}
