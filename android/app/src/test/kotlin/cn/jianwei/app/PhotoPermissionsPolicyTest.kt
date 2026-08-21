package cn.jianwei.app

import cn.jianwei.domain.model.PhotoAccess
import com.google.common.truth.Truth.assertThat
import org.junit.Test

class PhotoPermissionsPolicyTest {
    @Test
    fun `first automatic discovery request still uses the system permission dialog`() {
        assertThat(shouldOpenPhotoPermissionSettings(PhotoAccess.PICKER_ONLY, 0, false)).isFalse()
    }

    @Test
    fun `permanently denied permission recovers through app settings`() {
        assertThat(shouldOpenPhotoPermissionSettings(PhotoAccess.PICKER_ONLY, 2, false)).isTrue()
    }

    @Test
    fun `rationale-capable denial retries the system permission dialog`() {
        assertThat(shouldOpenPhotoPermissionSettings(PhotoAccess.PICKER_ONLY, 1, true)).isFalse()
    }

    @Test
    fun `existing partial or full access never requires settings recovery`() {
        assertThat(shouldOpenPhotoPermissionSettings(PhotoAccess.PARTIAL, 2, false)).isFalse()
        assertThat(shouldOpenPhotoPermissionSettings(PhotoAccess.FULL, 2, false)).isFalse()
    }
}
