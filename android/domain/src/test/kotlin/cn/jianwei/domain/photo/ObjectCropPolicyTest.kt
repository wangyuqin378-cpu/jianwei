package cn.jianwei.domain.photo

import cn.jianwei.domain.model.NormalizedBoundingBox
import com.google.common.truth.Truth.assertThat
import org.junit.Test

class ObjectCropPolicyTest {
    @Test
    fun `portrait widget crop shifts toward an object near the right edge`() {
        val centered = objectAwareCropRect(1200, 1600, 0.52, null)!!
        val focused = objectAwareCropRect(
            1200,
            1600,
            0.52,
            NormalizedBoundingBox(x = 0.68, y = 0.08, width = 0.22, height = 0.84)
        )!!

        assertThat(centered).isEqualTo(PixelCropRect(left = 184, top = 0, width = 832, height = 1600))
        assertThat(focused.left).isGreaterThan(centered.left)
        assertThat(focused.left + focused.width).isEqualTo(1200)
    }

    @Test
    fun `landscape crop follows vertical object center and stays inside the image`() {
        val focused = objectAwareCropRect(
            1000,
            1400,
            16.0 / 9.0,
            NormalizedBoundingBox(x = 0.2, y = 0.75, width = 0.4, height = 0.2)
        )!!

        assertThat(focused.left).isEqualTo(0)
        assertThat(focused.top).isEqualTo(837)
        assertThat(focused.width).isEqualTo(1000)
        assertThat(focused.height).isEqualTo(563)
    }

    @Test
    fun `invalid bounds safely fall back to centered crop`() {
        val centered = objectAwareCropRect(1000, 1000, 1.0, null)
        val invalid = objectAwareCropRect(
            1000,
            1000,
            1.0,
            NormalizedBoundingBox(x = 0.9, y = 0.2, width = 0.2, height = 0.4)
        )

        assertThat(invalid).isEqualTo(centered)
        assertThat(objectAwareCropRect(0, 1000, 1.0, null)).isNull()
    }
}
