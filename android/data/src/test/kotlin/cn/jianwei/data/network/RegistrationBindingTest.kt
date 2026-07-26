package cn.jianwei.data.network

import com.google.common.truth.Truth.assertThat
import java.io.IOException
import org.junit.Test

class RegistrationBindingTest {
    @Test
    fun binding_matchesCrossLanguageFixedVector() {
        assertThat(installationBindingSha256(INSTALLATION_ID)).isEqualTo(EXPECTED_BINDING)
    }

    @Test
    fun response_requiresCanonicalIdentityTokenAndExactInstallationBinding() {
        val valid = RegisterResponse(DEVICE_ID, TOKEN, EXPECTED_BINDING, created = true)

        assertThat(valid.validatedForInstallation(INSTALLATION_ID)).isEqualTo(
            ValidatedRegisterResponse(DEVICE_ID, TOKEN, created = true)
        )
        assertInvalid(valid.copy(deviceId = null))
        assertInvalid(valid.copy(deviceId = "device"))
        assertInvalid(valid.copy(deviceToken = null))
        assertInvalid(valid.copy(deviceToken = "short"))
        assertInvalid(valid.copy(installationBindingSha256 = null))
        assertInvalid(valid.copy(installationBindingSha256 = "f".repeat(64)))
        assertInvalid(valid.copy(created = null))
    }

    private fun assertInvalid(response: RegisterResponse) {
        assertThat(runCatching { response.validatedForInstallation(INSTALLATION_ID) }.exceptionOrNull())
            .isInstanceOf(IOException::class.java)
    }

    private companion object {
        const val INSTALLATION_ID = "00000000-0000-4000-8000-000000000001"
        const val DEVICE_ID = "10000000-0000-4000-8000-000000000001"
        const val TOKEN = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
        const val EXPECTED_BINDING = "12ac0636afd3b4cd29a7a645eb2c234d52bf7e9f574c596c6e83fe37797a8c73"
    }
}
