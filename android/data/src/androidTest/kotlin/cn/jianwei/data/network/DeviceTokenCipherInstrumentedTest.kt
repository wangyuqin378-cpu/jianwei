package cn.jianwei.data.network

import com.google.common.truth.Truth.assertThat
import org.junit.Test

class DeviceTokenCipherInstrumentedTest {
    @Test
    fun encrypts_roundTrips_and_invalidates_ciphertext_after_key_deletion() {
        val cipher = DeviceTokenCipher()
        cipher.deleteKey()
        val encrypted = cipher.encrypt("server-issued-secret")

        assertThat(encrypted).startsWith(DeviceTokenCipher.VERSION_PREFIX)
        assertThat(encrypted).doesNotContain("server-issued-secret")
        assertThat(cipher.decrypt(encrypted)).isEqualTo("server-issued-secret")

        cipher.deleteKey()
        assertThat(cipher.decrypt(encrypted)).isNull()
    }
}
