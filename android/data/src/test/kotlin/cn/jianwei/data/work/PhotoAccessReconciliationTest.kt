package cn.jianwei.data.work

import cn.jianwei.domain.model.PhotoAccess
import com.google.common.truth.Truth.assertThat
import org.junit.Test

class PhotoAccessReconciliationTest {
    @Test
    fun `revoked current access stops even a previously full scan`() {
        assertThat(effectiveScanAccess(PhotoAccess.FULL, PhotoAccess.PICKER_ONLY)).isNull()
    }

    @Test
    fun `partial current access narrows a previously full scan`() {
        assertThat(effectiveScanAccess(PhotoAccess.FULL, PhotoAccess.PARTIAL))
            .isEqualTo(PhotoAccess.PARTIAL)
    }

    @Test
    fun `older partial work never widens itself after a full grant`() {
        assertThat(effectiveScanAccess(PhotoAccess.PARTIAL, PhotoAccess.FULL))
            .isEqualTo(PhotoAccess.PARTIAL)
    }

    @Test
    fun `full access remains full only when both sides allow it`() {
        assertThat(effectiveScanAccess(PhotoAccess.FULL, PhotoAccess.FULL))
            .isEqualTo(PhotoAccess.FULL)
    }
}
