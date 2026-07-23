package cn.jianwei.app

import cn.jianwei.domain.model.CardFeedbackState
import cn.jianwei.domain.model.FeedbackAction
import cn.jianwei.domain.model.FeedbackSubmissionResult
import com.google.common.truth.Truth.assertThat
import org.junit.Test

class FeedbackUiPolicyTest {
    @Test
    fun `ordinary choices disappear after one persisted selection`() {
        assertThat(shouldOfferOrdinaryFeedback(null)).isTrue()
        assertThat(
            shouldOfferOrdinaryFeedback(
                CardFeedbackState("card", FeedbackAction.LIKE, submittedAtMillis = 1L)
            )
        ).isFalse()
    }

    @Test
    fun `duplicate result names the effective persisted choice`() {
        val message = feedbackResultMessage(
            FeedbackSubmissionResult(
                accepted = false,
                effectiveAction = FeedbackAction.LIKE
            )
        )

        assertThat(message).contains("已记录「有意思」")
        assertThat(message).contains("不会重复计入推荐")
    }

    @Test
    fun `private result explains deletion and future suppression`() {
        val message = feedbackResultMessage(
            FeedbackSubmissionResult(true, FeedbackAction.TOO_PRIVATE, cardRemoved = true)
        )

        assertThat(message).contains("已删除")
        assertThat(message).contains("停止分析")
    }
}
