package cn.jianwei.app

import cn.jianwei.domain.model.AnalysisPhase
import cn.jianwei.domain.usecase.PhotoImportDisposition
import cn.jianwei.domain.usecase.PhotoImportOutcome
import com.google.common.truth.Truth.assertThat
import org.junit.Test

class PhotoImportUiPolicyTest {
    @Test
    fun `no match recovery teaches the next photo without weakening the no guess promise`() {
        val presentation = importedPhotoNoMatchPresentation()

        assertThat(presentation.title).isEqualTo("暂时没找到可靠知识")
        assertThat(presentation.body).contains("不会为了出卡而猜测")
        assertThat(presentation.guidanceTitle).isEqualTo("下一张可以这样选")
        assertThat(presentation.guidanceBody).contains("占画面主要位置")
        assertThat(presentation.guidanceBody).contains("少文字、无人脸")
        assertThat(presentation.actionLabel).isEqualTo("换一张日常物品照片")
    }

    @Test
    fun `explicit import progress exposes three truthful stages`() {
        val preparing = importedPhotoProgressPresentation(
            paused = false,
            cloudDeletionUnresolved = false,
            phase = AnalysisPhase.QUEUED
        )
        val filtering = importedPhotoProgressPresentation(
            paused = false,
            cloudDeletionUnresolved = false,
            phase = AnalysisPhase.FILTERING
        )
        val syncing = importedPhotoProgressPresentation(
            paused = false,
            cloudDeletionUnresolved = false,
            phase = AnalysisPhase.SYNCING
        )

        assertThat(preparing.activeStage).isEqualTo(1)
        assertThat(preparing.stageLabel).contains("第 1 / 3 步")
        assertThat(filtering.activeStage).isEqualTo(2)
        assertThat(filtering.detail).contains("本机")
        assertThat(filtering.detail).contains("不会上传")
        assertThat(syncing.activeStage).isEqualTo(3)
        assertThat(syncing.stageLabel).contains("识别并匹配知识")
        assertThat(syncing.detail).contains("去除位置等元数据")
    }

    @Test
    fun `paused and deletion states do not pretend pipeline progress continues`() {
        val paused = importedPhotoProgressPresentation(
            paused = true,
            cloudDeletionUnresolved = false,
            phase = AnalysisPhase.SYNCING
        )
        val deleting = importedPhotoProgressPresentation(
            paused = false,
            cloudDeletionUnresolved = true,
            phase = AnalysisPhase.SYNCING
        )

        assertThat(paused.activeStage).isNull()
        assertThat(paused.stageLabel).isNull()
        assertThat(paused.title).contains("等待")
        assertThat(deleting.activeStage).isNull()
        assertThat(deleting.stageLabel).isNull()
        assertThat(deleting.detail).contains("不会继续分析")
    }

    @Test
    fun `retry copy acknowledges possible temporary cloud processing`() {
        val retrying = importedPhotoProgressPresentation(
            paused = false,
            cloudDeletionUnresolved = false,
            phase = AnalysisPhase.RETRYING
        )
        val failed = retryableImportedPhotoFailureBody()

        assertThat(retrying.detail).contains("如已进入云端")
        assertThat(retrying.detail).contains("最长保留 24 小时")
        assertThat(failed).contains("如已进入云端")
        assertThat(failed).doesNotContain("照片仍安全保留在本机")
    }

    @Test
    fun `picker and share imports explain local privacy screening`() {
        val outcome = PhotoImportOutcome(PhotoImportDisposition.IMPORTED_AND_QUEUED, 2)

        assertThat(photoImportResultMessage(outcome, PhotoImportEntry.PHOTO_PICKER))
            .isEqualTo("已安全导入 2 张照片，正在从画面里找一条可靠知识")
        assertThat(photoImportResultMessage(outcome, PhotoImportEntry.ANDROID_SHARE))
            .isEqualTo("已从分享安全导入 2 张照片，正在从画面里找一条可靠知识")
    }

    @Test
    fun `paused import message does not claim analysis was queued`() {
        val message = photoImportResultMessage(
            PhotoImportOutcome(PhotoImportDisposition.IMPORTED_WHILE_PAUSED, 1),
            PhotoImportEntry.ANDROID_SHARE
        )

        assertThat(message).contains("安全导入 1 张照片")
        assertThat(message).contains("分析仍处于暂停状态")
        assertThat(message).contains("恢复后继续")
        assertThat(message).doesNotContain("正在等待")
    }

    @Test
    fun `exported activity notice accepts only bounded known outcomes`() {
        assertThat(
            sharedImportNotice(PhotoImportDisposition.IMPORTED_AND_QUEUED.name, 20)
        ).contains("安全导入 20 张照片")
        assertThat(
            sharedImportNotice(PhotoImportDisposition.NO_READABLE_PHOTOS.name, 0)
        ).contains("未能读取")

        assertThat(
            sharedImportNotice(PhotoImportDisposition.IMPORTED_AND_QUEUED.name, 0)
        ).isNull()
        assertThat(
            sharedImportNotice(PhotoImportDisposition.IMPORTED_AND_QUEUED.name, 21)
        ).isNull()
        assertThat(
            sharedImportNotice(PhotoImportDisposition.NO_READABLE_PHOTOS.name, 1)
        ).isNull()
        assertThat(sharedImportNotice("INJECTED_MESSAGE", 1)).isNull()
        assertThat(sharedImportNotice(null, 1)).isNull()
    }

    @Test
    fun `pending result tokens accept only bounded opaque identifiers`() {
        val values = (1..24).map { "candidate-$it" } + listOf(
            "candidate-1",
            "  candidate-trimmed  ",
            "candidate/injected",
            "x".repeat(129)
        )

        val normalized = normalizedPendingImportTokens(values)

        assertThat(normalized).hasSize(20)
        assertThat(normalized.first()).isEqualTo("candidate-1")
        assertThat(normalized).doesNotContain("candidate/injected")
        assertThat(normalized).containsNoDuplicates()
    }
}
