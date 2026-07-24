package cn.jianwei.app

import cn.jianwei.domain.model.AnalysisPhase
import cn.jianwei.domain.model.AnalysisProgress
import cn.jianwei.domain.model.PhotoAccess
import com.google.common.truth.Truth.assertThat
import org.junit.Test

class DiscoveryUiPolicyTest {
    @Test
    fun `denied broad access never claims or schedules automatic scanning`() {
        assertThat(shouldScheduleAutomaticDiscovery(PhotoAccess.PICKER_ONLY)).isFalse()
        assertThat(discoveryStartMessage(PhotoAccess.PICKER_ONLY)).contains("不会自动扫描")
        assertThat(discoveryStartMessage(PhotoAccess.PICKER_ONLY)).doesNotContain("已开始扫描")

        val copy = emptyDiscoveryCopy(paused = false, access = PhotoAccess.PICKER_ONLY, progress = AnalysisProgress())
        assertThat(copy.title).isEqualTo("先选择一张照片")
        assertThat(copy.actionLabel).isEqualTo("选择照片")
    }

    @Test
    fun `full and partial access can schedule automatic discovery`() {
        assertThat(shouldScheduleAutomaticDiscovery(PhotoAccess.FULL)).isTrue()
        assertThat(shouldScheduleAutomaticDiscovery(PhotoAccess.PARTIAL)).isTrue()
        assertThat(discoveryStartMessage(PhotoAccess.FULL)).contains("已开始扫描")
    }

    @Test
    fun `photo access summary explains behavior without sounding like a permission screen`() {
        assertThat(photoAccessSummary(PhotoAccess.FULL)).isEqualTo("自动发现已开启 · 全部授权照片")
        assertThat(photoAccessSummary(PhotoAccess.PARTIAL)).contains("仅限你选中的照片")
        assertThat(photoAccessSummary(PhotoAccess.PICKER_ONLY)).isEqualTo("仅分析你选择或分享的照片")
    }

    @Test
    fun `paused analysis is surfaced when existing cards would otherwise hide it`() {
        assertThat(shouldShowPausedAnalysisBanner(paused = true, hasCards = true)).isTrue()
        assertThat(shouldShowPausedAnalysisBanner(paused = true, hasCards = false)).isFalse()
        assertThat(shouldShowPausedAnalysisBanner(paused = false, hasCards = true)).isFalse()
    }

    @Test
    fun `paused empty state takes priority over permission state`() {
        val copy = emptyDiscoveryCopy(paused = true, access = PhotoAccess.PICKER_ONLY, progress = AnalysisProgress(phase = AnalysisPhase.FAILED))

        assertThat(copy.title).isEqualTo("分析已暂停")
        assertThat(copy.actionLabel).isEqualTo("恢复分析")
    }

    @Test
    fun `widget prompt follows first daily card without repeating in saved collection`() {
        assertThat(shouldShowWidgetCallToAction(showSavedCards = false, cardIndex = 0)).isTrue()
        assertThat(shouldShowWidgetCallToAction(showSavedCards = false, cardIndex = 1)).isFalse()
        assertThat(shouldShowWidgetCallToAction(showSavedCards = true, cardIndex = 0)).isFalse()
    }

    @Test
    fun `widget prompt stacks for narrow screens or enlarged text`() {
        assertThat(shouldStackWidgetCallToAction(availableWidthDp = 320f, fontScale = 1f)).isTrue()
        assertThat(shouldStackWidgetCallToAction(availableWidthDp = 411f, fontScale = 2f)).isTrue()
        assertThat(shouldStackWidgetCallToAction(availableWidthDp = 411f, fontScale = 1f)).isFalse()
    }

    @Test
    fun `tabs use compact labels only when reflow needs them`() {
        assertThat(shouldUseCompactTabLabels(availableWidthDp = 320f, fontScale = 1f)).isTrue()
        assertThat(shouldUseCompactTabLabels(availableWidthDp = 411f, fontScale = 2f)).isTrue()
        assertThat(shouldUseCompactTabLabels(availableWidthDp = 411f, fontScale = 1f)).isFalse()
    }

    @Test
    fun `knowledge card actions stack before labels become cramped`() {
        assertThat(shouldStackKnowledgeCardActions(availableWidthDp = 320f, fontScale = 1f)).isTrue()
        assertThat(shouldStackKnowledgeCardActions(availableWidthDp = 411f, fontScale = 2f)).isTrue()
        assertThat(shouldStackKnowledgeCardActions(availableWidthDp = 411f, fontScale = 1f)).isFalse()
    }

    @Test
    fun `onboarding interests reflow before choices become cramped`() {
        assertThat(shouldStackOnboardingInterests(availableWidthDp = 320f, fontScale = 1f)).isTrue()
        assertThat(shouldStackOnboardingInterests(availableWidthDp = 411f, fontScale = 2f)).isTrue()
        assertThat(shouldStackOnboardingInterests(availableWidthDp = 411f, fontScale = 1f)).isFalse()
    }

    @Test
    fun `pipeline phases produce truthful empty states and actions`() {
        val filtering = emptyDiscoveryCopy(
            paused = false,
            access = PhotoAccess.FULL,
            progress = AnalysisProgress(phase = AnalysisPhase.FILTERING)
        )
        val noMatch = emptyDiscoveryCopy(
            paused = false,
            access = PhotoAccess.FULL,
            progress = AnalysisProgress(phase = AnalysisPhase.NO_MATCH)
        )
        val failed = emptyDiscoveryCopy(
            paused = false,
            access = PhotoAccess.PICKER_ONLY,
            progress = AnalysisProgress(phase = AnalysisPhase.FAILED, detail = "候选未发布")
        )

        assertThat(filtering.title).contains("本机筛选")
        assertThat(isAnalysisActive(AnalysisProgress(phase = AnalysisPhase.FILTERING))).isTrue()
        assertThat(noMatch.title).contains("没有合适卡片")
        assertThat(noMatch.action).isEqualTo(EmptyDiscoveryAction.PICK)
        assertThat(failed.body).isEqualTo("候选未发布")
        assertThat(failed.action).isEqualTo(EmptyDiscoveryAction.RETRY)
        assertThat(isAnalysisActive(AnalysisProgress(phase = AnalysisPhase.FAILED))).isFalse()
    }

    @Test
    fun `retry and failure remain visible even when cached cards exist`() {
        val retry = AnalysisProgress(phase = AnalysisPhase.RETRYING, detail = "系统会自动重试")
        val ready = AnalysisProgress(phase = AnalysisPhase.READY, cachedCardCount = 7)

        assertThat(analysisStatusBanner(retry, hasCards = true)).isEqualTo("系统会自动重试")
        assertThat(analysisStatusBanner(ready, hasCards = true)).isNull()
    }

    @Test
    fun `user mutation status takes priority and disables conflicting mutations`() {
        val active = homeActivityIndicator(
            UserOperation.DELETE_CLOUD_DATA,
            AnalysisProgress(phase = AnalysisPhase.FILTERING)
        )

        assertThat(active?.contentDescription).isEqualTo("操作进度")
        assertThat(active?.stateDescription).isEqualTo("正在删除云端数据")
        assertThat(areUserMutationsEnabled(UserOperation.DELETE_CLOUD_DATA)).isFalse()
        assertThat(areUserMutationsEnabled(null)).isTrue()
    }

    @Test
    fun `photo analysis indicator remains truthful when no user mutation is active`() {
        val active = homeActivityIndicator(null, AnalysisProgress(phase = AnalysisPhase.SYNCING))
        val idle = homeActivityIndicator(null, AnalysisProgress(phase = AnalysisPhase.READY))

        assertThat(active?.contentDescription).isEqualTo("照片分析")
        assertThat(active?.stateDescription).isEqualTo("正在处理")
        assertThat(idle).isNull()
    }
}
