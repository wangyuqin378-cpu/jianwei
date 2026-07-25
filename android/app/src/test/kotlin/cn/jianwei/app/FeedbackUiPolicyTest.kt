package cn.jianwei.app

import cn.jianwei.domain.model.CardFeedbackState
import cn.jianwei.domain.model.FeedbackAction
import cn.jianwei.domain.model.FeedbackSubmissionResult
import cn.jianwei.domain.model.SavedCardUpdateResult
import com.google.common.truth.Truth.assertThat
import org.junit.Test

class FeedbackUiPolicyTest {

    @Test
    fun `saved-card messages reflect availability change and final state`() {
        assertThat(savedCardUpdateMessage(SavedCardUpdateResult(false, false, false)))
            .isEqualTo("这张卡已不可用，收藏没有更改")
        assertThat(savedCardUpdateMessage(SavedCardUpdateResult(true, true, true)))
            .isEqualTo("已收藏，可在收藏页查看")
        assertThat(savedCardUpdateMessage(SavedCardUpdateResult(true, true, false)))
            .isEqualTo("已取消收藏")
        assertThat(savedCardUpdateMessage(SavedCardUpdateResult(true, false, true)))
            .isEqualTo("这张卡已在收藏中")
        assertThat(savedCardUpdateMessage(SavedCardUpdateResult(true, false, false)))
            .isEqualTo("这张卡已经不在收藏中")
    }

    @Test
    fun `feedback choices use a compact grid until width or text scale needs stacking`() {
        assertThat(shouldStackFeedbackChoices(availableWidthDp = 315f, fontScale = 1f)).isFalse()
        assertThat(shouldStackFeedbackChoices(availableWidthDp = 259f, fontScale = 1f)).isTrue()
        assertThat(shouldStackFeedbackChoices(availableWidthDp = 315f, fontScale = 1.5f)).isTrue()
    }

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

    @Test
    fun `wrong object result explains immediate hiding without an interest penalty`() {
        val message = feedbackResultMessage(
            FeedbackSubmissionResult(true, FeedbackAction.WRONG_OBJECT)
        )

        assertThat(message).contains("已隐藏")
        assertThat(message).contains("不会把它当作兴趣信号")
    }
}
