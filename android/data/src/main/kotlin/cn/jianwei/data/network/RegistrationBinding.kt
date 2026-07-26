package cn.jianwei.data.network

import java.io.IOException
import java.security.MessageDigest

private const val INSTALLATION_BINDING_DOMAIN = "jianwei-installation-binding-v1\u0000"
private val DEVICE_ID_PATTERN = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
private val DEVICE_TOKEN_PATTERN = Regex("^[A-Za-z0-9_-]{43}$")
private val SHA256_PATTERN = Regex("^[a-f0-9]{64}$")
private val HEX = "0123456789abcdef".toCharArray()

internal data class ValidatedRegisterResponse(
    val deviceId: String,
    val deviceToken: String,
    val created: Boolean
)

fun installationBindingSha256(installationId: String): String {
    val digest = MessageDigest.getInstance("SHA-256")
        .digest((INSTALLATION_BINDING_DOMAIN + installationId).toByteArray(Charsets.UTF_8))
    return CharArray(digest.size * 2).also { output ->
        digest.forEachIndexed { index, byte ->
            val value = byte.toInt() and 0xff
            output[index * 2] = HEX[value ushr 4]
            output[index * 2 + 1] = HEX[value and 0x0f]
        }
    }.concatToString()
}

internal fun RegisterResponse.validatedForInstallation(installationId: String): ValidatedRegisterResponse {
    val validatedDeviceId = deviceId
    val validatedToken = deviceToken
    val validatedBinding = installationBindingSha256
    val validatedCreated = created
    if (
        validatedDeviceId == null || !DEVICE_ID_PATTERN.matches(validatedDeviceId) ||
        validatedToken == null || !DEVICE_TOKEN_PATTERN.matches(validatedToken) ||
        validatedBinding == null || !SHA256_PATTERN.matches(validatedBinding) ||
        validatedBinding != cn.jianwei.data.network.installationBindingSha256(installationId) ||
        validatedCreated == null
    ) {
        throw IOException("Registration response is invalid or crossed the installation boundary")
    }
    return ValidatedRegisterResponse(validatedDeviceId, validatedToken, validatedCreated)
}
