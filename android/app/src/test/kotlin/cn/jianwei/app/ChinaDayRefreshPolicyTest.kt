package cn.jianwei.app

import com.google.common.truth.Truth.assertThat
import java.time.Instant
import org.junit.Test

class ChinaDayRefreshPolicyTest {
    @Test
    fun `foreground refresh waits until the next Shanghai midnight`() {
        val noonInShanghai = Instant.parse("2026-07-29T04:00:00Z")

        assertThat(millisUntilNextChinaDay(noonInShanghai))
            .isEqualTo(12 * 60 * 60 * 1_000L + 250L)
    }

    @Test
    fun `refresh delay crosses UTC date boundaries using Shanghai time`() {
        val oneSecondBeforeShanghaiMidnight = Instant.parse("2026-07-29T15:59:59Z")

        assertThat(millisUntilNextChinaDay(oneSecondBeforeShanghaiMidnight))
            .isEqualTo(1_250L)
    }
}
