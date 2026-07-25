package cn.jianwei.app

import cn.jianwei.domain.card.AutomaticCardMode
import cn.jianwei.domain.model.AnalysisPhase
import cn.jianwei.domain.model.AnalysisProgress
import cn.jianwei.domain.model.PhotoAccess
import com.google.common.truth.Truth.assertThat
import org.junit.Test

class DiscoveryUiPolicyTest {
    @Test
    fun `denied broad access never claims or schedules automatic scanning`() {
        assertThat(shouldScheduleAutomaticDiscovery(PhotoAccess.PICKER_ONLY)).isFalse()
        assertThat(discoveryStartMessage(PhotoAccess.PICKER_ONLY, AutomaticCardMode.DAILY_ONE))
            .contains("不会自动扫描")
        assertThat(discoveryStartMessage(PhotoAccess.PICKER_ONLY, AutomaticCardMode.PREPARED_POOL))
            .doesNotContain("已开始扫描")

        val copy = emptyDiscoveryCopy(
            paused = false,
            access = PhotoAccess.PICKER_ONLY,
            mode = AutomaticCardMode.DAILY_ONE,
            progress = AnalysisProgress()
        )
        assertThat(copy.title).isEqualTo("从一件日常物品开始")
        assertThat(copy.actionLabel).isEqualTo("选择一张照片")
        assertThat(copy.starterSuggestions).containsExactly("杯子与餐具", "清洁工具", "数码小物").inOrder()
        assertThat(copy.footnote).contains("分享图片到见微")
    }

    @Test
    fun `full and partial access can schedule automatic discovery`() {
        assertThat(shouldScheduleAutomaticDiscovery(PhotoAccess.FULL)).isTrue()
        assertThat(shouldScheduleAutomaticDiscovery(PhotoAccess.PARTIAL)).isTrue()
        assertThat(discoveryStartMessage(PhotoAccess.FULL, AutomaticCardMode.PREPARED_POOL))
            .contains("已开始本机扫描")
    }

    @Test
    fun `photo access summary explains behavior without sounding like a permission screen`() {
        assertThat(photoAccessSummary(PhotoAccess.FULL, AutomaticCardMode.PREPARED_POOL))
            .isEqualTo("自动发现已开启 · 提前准备 · 全部授权照片")
        assertThat(photoAccessSummary(PhotoAccess.PARTIAL, AutomaticCardMode.DAILY_ONE))
            .isEqualTo("自动发现已开启 · 每天一张 · 仅限你选中的照片")
        assertThat(photoAccessSummary(PhotoAccess.PICKER_ONLY, AutomaticCardMode.DAILY_ONE))
            .isEqualTo("仅分析你选择或分享的照片")
    }

    @Test
    fun `automatic discovery can be enabled or adjusted after onboarding`() {
        assertThat(automaticDiscoveryControl(PhotoAccess.FULL, AutomaticCardMode.DAILY_ONE)).isNull()
        assertThat(automaticDiscoveryControl(
            PhotoAccess.PARTIAL,
            AutomaticCardMode.PREPARED_POOL
        )?.actionLabel)
            .isEqualTo("调整可访问照片")
        assertThat(automaticDiscoveryControl(
            PhotoAccess.PICKER_ONLY,
            AutomaticCardMode.DAILY_ONE
        )?.actionLabel)
            .isEqualTo("开启自动发现")
        assertThat(automaticDiscoveryControl(
            PhotoAccess.PICKER_ONLY,
            AutomaticCardMode.DAILY_ONE
        )?.explanation).contains("最多上传分析 1 张")
        assertThat(automaticDiscoveryControl(
            PhotoAccess.PICKER_ONLY,
            AutomaticCardMode.DAILY_ONE
        )?.emphasized).isTrue()
        assertThat(automaticDiscoveryControl(
            PhotoAccess.PARTIAL,
            AutomaticCardMode.PREPARED_POOL
        )?.emphasized).isFalse()
    }

    @Test
    fun `paused analysis is surfaced when existing cards would otherwise hide it`() {
        assertThat(shouldShowPausedAnalysisBanner(paused = true, hasCards = true)).isTrue()
        assertThat(shouldShowPausedAnalysisBanner(paused = true, hasCards = false)).isFalse()
        assertThat(shouldShowPausedAnalysisBanner(paused = false, hasCards = true)).isFalse()
    }

    @Test
    fun `paused empty state takes priority over permission state`() {
        val copy = emptyDiscoveryCopy(
            paused = true,
            access = PhotoAccess.PICKER_ONLY,
            mode = AutomaticCardMode.DAILY_ONE,
            progress = AnalysisProgress(phase = AnalysisPhase.FAILED)
        )

        assertThat(copy.title).isEqualTo("分析已暂停")
        assertThat(copy.actionLabel).isEqualTo("恢复分析")
    }

    @Test
    fun `unresolved cloud deletion replaces every resume path with deletion recovery`() {
        val copy = emptyDiscoveryCopy(
            paused = true,
            access = PhotoAccess.FULL,
            mode = AutomaticCardMode.PREPARED_POOL,
            progress = AnalysisProgress(phase = AnalysisPhase.FAILED),
            cloudDeletionUnresolved = true
        )

        assertThat(copy.title).isEqualTo("云端删除尚未完成")
        assertThat(copy.actionLabel).isEqualTo("继续删除云端数据")
        assertThat(copy.action).isEqualTo(EmptyDiscoveryAction.CONTINUE_CLOUD_DELETION)
        assertThat(copy.body).contains("不会接收新照片")
        assertThat(areAnalysisMutationsEnabled(null, cloudDeletionUnresolved = true)).isFalse()
        assertThat(areUserMutationsEnabled(null)).isTrue()
    }

    @Test
    fun `widget prompt follows first daily card until installation is complete`() {
        assertThat(
            shouldShowWidgetCallToAction(
                showSavedCards = false,
                cardIndex = 0,
                widgetInstalled = false
            )
        ).isTrue()
        assertThat(
            shouldShowWidgetCallToAction(
                showSavedCards = false,
                cardIndex = 1,
                widgetInstalled = false
            )
        ).isFalse()
        assertThat(
            shouldShowWidgetCallToAction(
                showSavedCards = true,
                cardIndex = 0,
                widgetInstalled = false
            )
        ).isFalse()
        assertThat(
            shouldShowWidgetCallToAction(
                showSavedCards = false,
                cardIndex = 0,
                widgetInstalled = true
            )
        ).isFalse()
        assertThat(widgetManagementActionLabel(widgetInstalled = false)).isEqualTo("添加桌面组件")
        assertThat(widgetManagementActionLabel(widgetInstalled = true)).isEqualTo("再添加一个桌面组件")
    }

    @Test
    fun `widget prompt stacks for narrow screens or enlarged text`() {
        assertThat(shouldStackWidgetCallToAction(availableWidthDp = 320f, fontScale = 1f)).isTrue()
        assertThat(shouldStackWidgetCallToAction(availableWidthDp = 411f, fontScale = 2f)).isTrue()
        assertThat(shouldStackWidgetCallToAction(availableWidthDp = 411f, fontScale = 1f)).isFalse()
    }

    @Test
    fun `knowledge card actions stack before labels become cramped`() {
        assertThat(shouldStackKnowledgeCardActions(availableWidthDp = 320f, fontScale = 1f)).isTrue()
        assertThat(shouldStackKnowledgeCardActions(availableWidthDp = 411f, fontScale = 2f)).isTrue()
        assertThat(shouldStackKnowledgeCardActions(availableWidthDp = 411f, fontScale = 1f)).isFalse()
    }

    @Test
    fun `onboarding interests reflow before choices become cramped`() {
        assertThat(shouldStackOnboardingInterests(availableWidthDp = 339f, fontScale = 1f)).isFalse()
        assertThat(shouldStackOnboardingInterests(availableWidthDp = 299f, fontScale = 1f)).isTrue()
        assertThat(shouldStackOnboardingInterests(availableWidthDp = 339f, fontScale = 1.5f)).isTrue()
    }

    @Test
    fun `starter suggestions use the empty card net width`() {
        assertThat(shouldStackStarterSuggestions(availableWidthDp = 339f, fontScale = 1f)).isFalse()
        assertThat(shouldStackStarterSuggestions(availableWidthDp = 299f, fontScale = 1f)).isTrue()
        assertThat(shouldStackStarterSuggestions(availableWidthDp = 339f, fontScale = 1.5f)).isTrue()
    }

    @Test
    fun `pipeline phases produce truthful empty states and actions`() {
        val filtering = emptyDiscoveryCopy(
            paused = false,
            access = PhotoAccess.FULL,
            mode = AutomaticCardMode.PREPARED_POOL,
            progress = AnalysisProgress(phase = AnalysisPhase.FILTERING)
        )
        val noMatch = emptyDiscoveryCopy(
            paused = false,
            access = PhotoAccess.FULL,
            mode = AutomaticCardMode.PREPARED_POOL,
            progress = AnalysisProgress(phase = AnalysisPhase.NO_MATCH)
        )
        val failed = emptyDiscoveryCopy(
            paused = false,
            access = PhotoAccess.PICKER_ONLY,
            mode = AutomaticCardMode.PREPARED_POOL,
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
    fun `daily one status copy preserves its hard limits without promising a card pool`() {
        val start = discoveryStartMessage(PhotoAccess.FULL, AutomaticCardMode.DAILY_ONE)
        val control = automaticDiscoveryControl(
            PhotoAccess.PICKER_ONLY,
            AutomaticCardMode.DAILY_ONE
        )
        val scanning = emptyDiscoveryCopy(
            paused = false,
            access = PhotoAccess.FULL,
            mode = AutomaticCardMode.DAILY_ONE,
            progress = AnalysisProgress(phase = AnalysisPhase.SCANNING)
        )
        val filtering = emptyDiscoveryCopy(
            paused = false,
            access = PhotoAccess.FULL,
            mode = AutomaticCardMode.DAILY_ONE,
            progress = AnalysisProgress(phase = AnalysisPhase.FILTERING)
        )
        val syncing = emptyDiscoveryCopy(
            paused = false,
            access = PhotoAccess.FULL,
            mode = AutomaticCardMode.DAILY_ONE,
            progress = AnalysisProgress(phase = AnalysisPhase.SYNCING)
        )
        val noMatch = emptyDiscoveryCopy(
            paused = false,
            access = PhotoAccess.FULL,
            mode = AutomaticCardMode.DAILY_ONE,
            progress = AnalysisProgress(phase = AnalysisPhase.NO_MATCH)
        )

        assertThat(start).contains("每个自然日最多上传分析 1 张")
        assertThat(control?.explanation).contains("每个自然日最多上传分析 1 张")
        assertThat(scanning.body).contains("最多深入筛选 4 张")
        assertThat(filtering.body).contains("最多选择 1 张")
        assertThat(syncing.body).contains("最多上传分析 1 张")
        assertThat(noMatch.title).isEqualTo("今天没有生成新卡片")
        assertThat(noMatch.body).contains("不会为了凑数生成")
        listOf(start, control?.explanation.orEmpty(), scanning.body, filtering.body, syncing.body, noMatch.body)
            .forEach { copy -> assertThat(copy).doesNotContain("7–14") }
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
