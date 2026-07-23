package cn.jianwei.data.di

import com.google.common.truth.Truth.assertThat
import org.junit.Test

class DataModuleTest {
    @Test
    fun `upload transport never follows redirects`() {
        val client = DataProviders.buildJianweiHttpClient()

        assertThat(client.followRedirects).isFalse()
        assertThat(client.followSslRedirects).isFalse()
    }
}
