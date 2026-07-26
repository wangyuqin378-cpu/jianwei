package cn.jianwei.data.network

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton
import cn.jianwei.domain.repository.CloudDeletionStatusRepository
import cn.jianwei.domain.repository.CloudDeletionUnresolvedException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import retrofit2.HttpException

private val Context.identityStore by preferencesDataStore("anonymous_device")

@Singleton
class DeviceIdentity @Inject constructor(
    @param:ApplicationContext private val context: Context,
    private val api: JianweiApi,
    private val cipher: DeviceTokenCipher
) : CloudDeletionStatusRepository {
    private val mutex = Mutex()

    suspend fun bearer(beforeRegister: () -> Unit = {}): String = mutex.withLock { bearerLocked(beforeRegister) }

    suspend fun <T> authenticated(
        requireActive: () -> Unit = {},
        block: suspend (String) -> T
    ): T {
        requireActive()
        val initial = bearer(requireActive)
        return try {
            requireActive()
            block(initial)
        } catch (error: Exception) {
            val unauthorized = (error is HttpException && error.code() == 401) || error is AuthenticationExpiredException
            if (!unauthorized) throw error
            requireActive()
            val refreshed = refreshAfterUnauthorized(initial, requireActive)
            requireActive()
            block(refreshed)
        }
    }

    suspend fun existingBearer(): String? = mutex.withLock {
        val stored = context.identityStore.data.first()[TOKEN] ?: return@withLock null
        stored.let(cipher::decrypt)?.let { "Bearer $it" }
    }

    override fun observeUnresolved(): Flow<Boolean> = context.identityStore.data
        .map { preferences -> preferences[DELETION_STATE] != null }
        .distinctUntilChanged()

    override suspend fun isUnresolved(): Boolean =
        context.identityStore.data.first()[DELETION_STATE] != null

    /**
     * Deletes only an identity that already exists on this installation. The persistent deletion
     * state closes the crash window between a successful server response and local reset. A stale
     * bearer can rotate only to the expected existing device; a different device is accepted only
     * when the registration response atomically proves that it was newly created for an installation
     * whose old device no longer exists. On every failure the encrypted recovery material remains.
     */
    suspend fun deleteExistingDeviceData(): Boolean = mutex.withLock {
        var preferences = context.identityStore.data.first()
        val storedToken = preferences[TOKEN]
        val storedInstallation = preferences[INSTALLATION]
        val deletionState = preferences[DELETION_STATE]
        if (deletionState == DELETION_CONFIRMED) return@withLock true
        if (storedToken == null && storedInstallation == null && deletionState == null) return@withLock false
        if (deletionState == null) {
            context.identityStore.edit { it[DELETION_STATE] = DELETION_PENDING }
            preferences = context.identityStore.data.first()
        }
        val token = storedToken?.let(cipher::decrypt)
        val storedDeviceId = preferences[DEVICE_ID]?.let(cipher::decrypt)
        if (token != null && storedDeviceId != null) {
            try {
                api.deleteDeviceData("Bearer $token").requireDeletedDevice(storedDeviceId)
                markDeletionConfirmedLocked()
                return@withLock true
            } catch (error: HttpException) {
                if (error.code() != 401) throw error
            }
        }

        val installationId = storedInstallation?.let(cipher::decrypt)
            ?: throw AuthenticationExpiredException()
        val registered = api.register(RegisterRequest(installationId)).validatedForInstallation(installationId)
        if (storedDeviceId != null && storedDeviceId != registered.deviceId && !registered.created) {
            throw AuthenticationExpiredException()
        }
        context.identityStore.edit {
            it[TOKEN] = cipher.encrypt(registered.deviceToken)
            it[DEVICE_ID] = cipher.encrypt(registered.deviceId)
        }
        api.deleteDeviceData("Bearer ${registered.deviceToken}")
            .requireDeletedDevice(registered.deviceId)
        markDeletionConfirmedLocked()
        true
    }

    private suspend fun markDeletionConfirmedLocked() {
        context.identityStore.edit { it[DELETION_STATE] = DELETION_CONFIRMED }
    }

    private suspend fun bearerLocked(requireActive: () -> Unit): String {
        requireActive()
        val preferences = context.identityStore.data.first()
        if (preferences[DELETION_STATE] != null) throw CloudDeletionUnresolvedException()
        val stored = preferences[TOKEN]
        val existing = stored?.let(cipher::decrypt)
        if (existing != null) {
            if (!stored.startsWith(DeviceTokenCipher.VERSION_PREFIX)) {
                context.identityStore.edit { it[TOKEN] = cipher.encrypt(existing) }
            }
            return "Bearer $existing"
        }
        if (stored != null) context.identityStore.edit { it.remove(TOKEN) }
        val storedInstallation = preferences[INSTALLATION]
        val decryptedInstallation = storedInstallation?.let(cipher::decrypt)
        val installationId = decryptedInstallation ?: UUID.randomUUID().toString().also { value ->
            context.identityStore.edit { it[INSTALLATION] = cipher.encrypt(value) }
        }
        if (decryptedInstallation != null && !storedInstallation.startsWith(DeviceTokenCipher.VERSION_PREFIX)) {
            context.identityStore.edit { it[INSTALLATION] = cipher.encrypt(decryptedInstallation) }
        }
        requireActive()
        val registered = api.register(RegisterRequest(installationId)).validatedForInstallation(installationId)
        requireActive()
        context.identityStore.edit {
            it[TOKEN] = cipher.encrypt(registered.deviceToken)
            it[DEVICE_ID] = cipher.encrypt(registered.deviceId)
        }
        return "Bearer ${registered.deviceToken}"
    }

    private suspend fun refreshAfterUnauthorized(
        failedBearer: String,
        requireActive: () -> Unit
    ): String = mutex.withLock {
        requireActive()
        val preferences = context.identityStore.data.first()
        val current = preferences[TOKEN]?.let(cipher::decrypt)?.let { "Bearer $it" }
        if (current != null && current != failedBearer) return@withLock current
        context.identityStore.edit { it.remove(TOKEN) }
        bearerLocked(requireActive)
    }

    suspend fun reset() = mutex.withLock {
        context.identityStore.edit { it.clear() }
        cipher.deleteKey()
    }

    private companion object {
        val INSTALLATION = stringPreferencesKey("installation_id")
        val TOKEN = stringPreferencesKey("device_token")
        val DEVICE_ID = stringPreferencesKey("device_id")
        val DELETION_STATE = stringPreferencesKey("deletion_state")
        const val DELETION_PENDING = "DELETE_PENDING"
        const val DELETION_CONFIRMED = "DELETE_CONFIRMED"
    }
}

class AuthenticationExpiredException : Exception("Anonymous device authentication expired")

@Singleton
class DeviceTokenCipher @Inject constructor() {
    fun encrypt(value: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        return listOf(
            VERSION_PREFIX.removeSuffix(":"),
            Base64.encodeToString(cipher.iv, Base64.NO_WRAP),
            Base64.encodeToString(cipher.doFinal(value.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
        ).joinToString(":")
    }

    fun decrypt(value: String): String? {
        if (!value.startsWith(VERSION_PREFIX)) return value
        return runCatching {
            val parts = value.split(":", limit = 3)
            require(parts.size == 3)
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(
                Cipher.DECRYPT_MODE,
                secretKey(),
                GCMParameterSpec(128, Base64.decode(parts[1], Base64.NO_WRAP))
            )
            cipher.doFinal(Base64.decode(parts[2], Base64.NO_WRAP)).toString(Charsets.UTF_8)
        }.getOrNull()
    }

    fun deleteKey() {
        keyStore().deleteEntry(KEY_ALIAS)
    }

    private fun secretKey(): SecretKey {
        val store = keyStore()
        (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE).run {
            init(
                KeyGenParameterSpec.Builder(
                    KEY_ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
                )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setRandomizedEncryptionRequired(true)
                    .build()
            )
            generateKey()
        }
    }

    private fun keyStore(): KeyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }

    companion object {
        const val VERSION_PREFIX = "v1:"
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val KEY_ALIAS = "jianwei.device-token.v1"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
    }
}
