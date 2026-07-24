package cn.jianwei.app

import cn.jianwei.domain.usecase.PhotoImportDisposition
import cn.jianwei.domain.usecase.PhotoImportOutcome
import com.google.common.truth.Truth.assertThat
import org.junit.Test

class PhotoImportUiPolicyTest {
    @Test
    fun `picker and share imports explain local privacy screening`() {
        val outcome = PhotoImportOutcome(PhotoImportDisposition.IMPORTED_AND_QUEUED, 2)

        assertThat(photoImportResultMessage(outcome, PhotoImportEntry.PHOTO_PICKER))
            .isEqualTo("已安全导入 2 张照片，正在等待本机隐私筛选")
        assertThat(photoImportResultMessage(outcome, PhotoImportEntry.ANDROID_SHARE))
            .isEqualTo("已从分享安全导入 2 张照片，正在等待本机隐私筛选")
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
}
