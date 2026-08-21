package cn.jianwei.app

import cn.jianwei.domain.model.CardFeedbackState
import cn.jianwei.domain.model.FeedbackAction
import cn.jianwei.domain.model.FeedbackSubmissionResult
import cn.jianwei.domain.model.KnowledgeCard
import cn.jianwei.domain.model.KnowledgeSource
import cn.jianwei.domain.model.SavedCardUpdateResult
import cn.jianwei.domain.model.TopicAffinitySignal
import com.google.common.truth.Truth.assertThat
import java.time.Instant
import java.time.LocalDate
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

    @Test
    fun `ordinary feedback explains the visible recommendation effect`() {
        assertThat(
            feedbackResultMessage(FeedbackSubmissionResult(true, FeedbackAction.LIKE))
        ).contains("更常留意")
        assertThat(
            feedbackResultMessage(FeedbackSubmissionResult(true, FeedbackAction.DISLIKE))
        ).contains("降低这类内容的推荐权重")

        val liked = feedbackLearningPresentation(FeedbackAction.LIKE, "扫帚")
        val disliked = feedbackLearningPresentation(FeedbackAction.DISLIKE, "充电线")
        assertThat(liked.title).isEqualTo("已记住 · 有意思")
        assertThat(liked.body).contains("扫帚")
        assertThat(liked.body).contains("本次安装")
        assertThat(disliked.body).contains("充电线")
        assertThat(disliked.body).contains("降低")
    }

    @Test
    fun `learned preference summary only exposes retained scheduled card objects`() {
        val summary = learnedPreferenceSummary(
            affinities = listOf(
                TopicAffinitySignal("broom", 0.7, setOf("扫帚")),
                TopicAffinitySignal("cable", -0.4, setOf("充电线")),
                TopicAffinitySignal("private", -0.75, setOf("私人对象")),
                TopicAffinitySignal("wrong", 1.0, setOf("识错对象"))
            ),
            cards = listOf(
                card("broom-card", "broom", "扫帚", status = "scheduled"),
                card("cable-card", "cable", "充电线", status = "scheduled"),
                card("wrong-card", "wrong", "错误对象", status = "archived")
            )
        )

        assertThat(summary.moreOften).containsExactly("扫帚")
        assertThat(summary.lessOften).containsExactly("充电线")
        assertThat(summary.moreOften).doesNotContain("错误对象")
        assertThat(summary.lessOften).doesNotContain("私人对象")
    }

    private fun card(
        cardId: String,
        topicId: String,
        detectedObjectName: String,
        status: String
    ) = KnowledgeCard(
        cardId = cardId,
        candidateToken = "candidate-$cardId",
        photoUri = "",
        topicId = topicId,
        factId = "fact-$cardId",
        title = "$detectedObjectName 的知识",
        detectedObjectName = detectedObjectName,
        body = "经过审核的测试正文",
        personalContext = "来自授权照片",
        confidence = 0.9,
        sources = listOf(KnowledgeSource("source-$cardId", "来源", "https://example.com/$cardId", "Example", "reference")),
        status = status,
        scheduledDate = LocalDate.of(2026, 7, 29),
        createdAt = Instant.parse("2026-07-29T00:00:00Z")
    )
}
