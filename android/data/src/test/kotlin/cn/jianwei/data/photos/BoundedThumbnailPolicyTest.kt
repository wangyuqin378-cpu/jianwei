package cn.jianwei.data.photos

import com.google.common.truth.Truth.assertThat
import org.junit.Assert.assertThrows
import org.junit.Test

class BoundedThumbnailPolicyTest {
    @Test
    fun sampleSizeBoundsLargeAndExtremeAspectRatioImages() {
        val cases = listOf(
            Triple(8_000, 6_000, 1_280),
            Triple(8_000, 6_000, 320),
            Triple(48_000, 1_000, 320),
            Triple(1_000, 48_000, 320),
            Triple(512, 512, 512),
            Triple(513, 1, 512)
        )

        cases.forEach { (width, height, maximumSide) ->
            val sample = thumbnailSampleSizeFor(width, height, maximumSide)
            val sampledWidth = (width.toLong() + sample - 1L) / sample
            val sampledHeight = (height.toLong() + sample - 1L) / sample

            assertThat(sample).isAtLeast(1)
            assertThat(sample and (sample - 1)).isEqualTo(0)
            assertThat(sampledWidth).isAtMost(maximumSide.toLong())
            assertThat(sampledHeight).isAtMost(maximumSide.toLong())
        }
    }

    @Test
    fun sampleSizeRejectsInvalidBounds() {
        assertThrows(IllegalArgumentException::class.java) { thumbnailSampleSizeFor(0, 100, 320) }
        assertThrows(IllegalArgumentException::class.java) { thumbnailSampleSizeFor(100, 0, 320) }
        assertThrows(IllegalArgumentException::class.java) { thumbnailSampleSizeFor(100, 100, 0) }
    }
}
