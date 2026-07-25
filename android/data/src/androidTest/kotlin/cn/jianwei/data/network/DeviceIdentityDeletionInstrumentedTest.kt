package cn.jianwei.data.network

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import cn.jianwei.domain.repository.CloudDeletionUnresolvedException
import java.io.IOException
import kotlinx.coroutines.runBlocking
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response

class DeviceIdentityDeletionInstrumentedTest {
    @Test
    fun staleToken_reclaimsSameInstallation_andDeletesOriginalDevice() = runBlocking {
        val api = RotatingTokenApi()
        val identity = freshIdentity(api)
        try {
            assertThat(identity.bearer()).isEqualTo("Bearer token-1")
            api.rotateServerToken()

            assertThat(identity.deleteExistingDeviceData()).isTrue()

            assertThat(api.registerCount).isEqualTo(2)
            assertThat(api.deletedDeviceId).isEqualTo(DEVICE_A)
        } finally {
            identity.reset()
        }
    }

    @Test
    fun changedDeviceBinding_failsClosed_andPreservesRecoveryIdentity() = runBlocking {
        val api = RotatingTokenApi()
        val identity = freshIdentity(api)
        try {
            assertThat(identity.bearer()).isEqualTo("Bearer token-1")
            api.rotateServerToken()
            api.registrationDeviceId = DEVICE_B

            val failure = runCatching { identity.deleteExistingDeviceData() }.exceptionOrNull()

            assertThat(failure).isInstanceOf(AuthenticationExpiredException::class.java)
            assertThat(api.deletedDeviceId).isNull()
            assertThat(identity.existingBearer()).isEqualTo("Bearer token-1")
        } finally {
            identity.reset()
        }
    }

    @Test
    fun deletedDeviceAndLostResponse_reclaimsNewEmptyRegistrationAndFinishes() = runBlocking {
        val api = RotatingTokenApi()
        val identity = freshIdentity(api)
        try {
            assertThat(identity.bearer()).isEqualTo("Bearer token-1")
            api.loseSuccessfulDeleteResponse = true

            val ambiguousFailure = runCatching { identity.deleteExistingDeviceData() }.exceptionOrNull()

            assertThat(ambiguousFailure).isInstanceOf(IOException::class.java)
            assertThat(api.deletedDeviceIds).containsExactly(DEVICE_A)

            assertThat(identity.deleteExistingDeviceData()).isTrue()

            assertThat(api.registerCount).isEqualTo(2)
            assertThat(api.deletedDeviceIds).containsExactly(DEVICE_A, DEVICE_B).inOrder()
            identity.reset()
            assertThat(identity.existingBearer()).isNull()
        } finally {
            identity.reset()
        }
    }

    @Test
    fun unresolvedDeletion_blocksOrdinaryAuthenticationUntilDeletionFinishesAndIdentityResets() = runBlocking {
        val api = RotatingTokenApi()
        val identity = freshIdentity(api)
        try {
            assertThat(identity.isUnresolved()).isFalse()
            assertThat(identity.bearer()).isEqualTo("Bearer token-1")
            api.loseSuccessfulDeleteResponse = true
            assertThat(runCatching { identity.deleteExistingDeviceData() }.exceptionOrNull())
                .isInstanceOf(IOException::class.java)
            assertThat(identity.isUnresolved()).isTrue()

            val registerCountAtBarrier = api.registerCount
            var authenticatedCalls = 0
            assertThat(runCatching { identity.bearer() }.exceptionOrNull())
                .isInstanceOf(CloudDeletionUnresolvedException::class.java)
            assertThat(runCatching {
                identity.authenticated<String> {
                    authenticatedCalls += 1
                    "unexpected"
                }
            }.exceptionOrNull()).isInstanceOf(CloudDeletionUnresolvedException::class.java)
            assertThat(authenticatedCalls).isEqualTo(0)
            assertThat(api.registerCount).isEqualTo(registerCountAtBarrier)

            assertThat(identity.deleteExistingDeviceData()).isTrue()
            assertThat(identity.isUnresolved()).isTrue()
            assertThat(runCatching { identity.bearer() }.exceptionOrNull())
                .isInstanceOf(CloudDeletionUnresolvedException::class.java)

            identity.reset()
            assertThat(identity.isUnresolved()).isFalse()
            assertThat(identity.bearer()).isEqualTo("Bearer token-3")
        } finally {
            identity.reset()
        }
    }

    @Test
    fun confirmedDeletion_replaysWithoutRegisteringAReplacementBeforeReset() = runBlocking {
        val api = RotatingTokenApi()
        val identity = freshIdentity(api)
        try {
            assertThat(identity.bearer()).isEqualTo("Bearer token-1")
            assertThat(identity.deleteExistingDeviceData()).isTrue()

            assertThat(identity.deleteExistingDeviceData()).isTrue()

            assertThat(api.registerCount).isEqualTo(1)
            assertThat(api.deletedDeviceIds).containsExactly(DEVICE_A)
            identity.reset()
            assertThat(identity.existingBearer()).isNull()
        } finally {
            identity.reset()
        }
    }

    @Test
    fun uploadAuthenticationExpiry_refreshesAndReplaysOnlyOnce() = runBlocking {
        val api = RotatingTokenApi()
        val identity = freshIdentity(api)
        try {
            var attempts = 0
            val failure = runCatching {
                identity.authenticated<String> {
                    attempts += 1
                    throw AuthenticationExpiredException()
                }
            }.exceptionOrNull()

            assertThat(failure).isInstanceOf(AuthenticationExpiredException::class.java)
            assertThat(attempts).isEqualTo(2)
            assertThat(api.registerCount).isEqualTo(2)
        } finally {
            identity.reset()
        }
    }

    private suspend fun freshIdentity(api: RotatingTokenApi): DeviceIdentity {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val identity = DeviceIdentity(context, api, DeviceTokenCipher())
        identity.reset()
        return identity
    }

    private class RotatingTokenApi : JianweiApi {
        var registerCount = 0
        var registrationDeviceId = DEVICE_A
        var registrationCreated = false
        var deletedDeviceId: String? = null
        val deletedDeviceIds = mutableListOf<String>()
        var loseSuccessfulDeleteResponse = false
        private var currentToken = ""

        override suspend fun register(request: RegisterRequest): RegisterResponse {
            registerCount += 1
            currentToken = "token-$registerCount"
            return RegisterResponse(
                registrationDeviceId,
                currentToken,
                created = registerCount == 1 || registrationCreated
            )
        }

        fun rotateServerToken() {
            currentToken = "server-rotated-token"
        }

        override suspend fun deleteDeviceData(authorization: String) {
            if (authorization != "Bearer $currentToken") throw unauthorized()
            deletedDeviceId = registrationDeviceId
            deletedDeviceIds += registrationDeviceId
            if (loseSuccessfulDeleteResponse) {
                loseSuccessfulDeleteResponse = false
                currentToken = "deleted-device-token"
                registrationDeviceId = DEVICE_B
                registrationCreated = true
                throw IOException("response lost after server deletion")
            }
        }

        override suspend fun createJob(authorization: String, request: CreateJobRequest): CreateJobResponse =
            error("not used")

        override suspend fun completeJob(authorization: String, jobId: String): CompleteJobResponse =
            error("not used")

        override suspend fun cards(authorization: String, cursor: String?, limit: Int): CardsResponse =
            error("not used")

        override suspend fun feedback(
            authorization: String,
            cardId: String,
            request: FeedbackRequest
        ): Response<FeedbackResponse> = error("not used")

        override suspend fun track(authorization: String, cardId: String, request: TrackRequest) =
            error("not used")

        override suspend fun cancelTracking(authorization: String, cardId: String) = error("not used")

        private fun unauthorized(): HttpException = HttpException(
            Response.error<Any>(401, "{}".toResponseBody("application/json".toMediaType()))
        )
    }

    private companion object {
        const val DEVICE_A = "00000000-0000-4000-8000-000000000001"
        const val DEVICE_B = "00000000-0000-4000-8000-000000000002"
    }
}
