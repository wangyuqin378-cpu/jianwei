package cn.jianwei.data.network

import com.google.common.truth.Truth.assertThat
import java.io.IOException
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Test
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory

class ApiResponseBodyPolicyTest {
    @Test
    fun `successful response body is returned unchanged`() {
        val response = RegisterResponse(
            deviceId = "device",
            deviceToken = "token",
            installationBindingSha256 = "binding",
            created = true
        )

        assertThat(retrofit2.Response.success(response).requireApiResponseBody("POST /v1/devices/register"))
            .isSameInstanceAs(response)
    }

    @Test
    fun `successful response without body fails closed with endpoint context`() {
        val error = runCatching {
            val response = retrofit2.Response.success<RegisterResponse>(null)
            response.requireApiResponseBody("POST /v1/devices/register")
        }.exceptionOrNull()

        assertThat(error).isInstanceOf(IOException::class.java)
        assertThat(error).hasMessageThat()
            .isEqualTo("POST /v1/devices/register returned a successful response without a body")
    }

    @Test
    fun `http error remains available to authentication refresh policy`() {
        val response = retrofit2.Response.error<RegisterResponse>(
            401,
            "{}".toResponseBody("application/json".toMediaType())
        )

        val error = runCatching {
            response.requireApiResponseBody("POST /v1/devices/register")
        }.exceptionOrNull()

        assertThat(error).isInstanceOf(retrofit2.HttpException::class.java)
        assertThat((error as retrofit2.HttpException).code()).isEqualTo(401)
    }

    @Test
    fun `retrofit no-content response reaches explicit body policy`() = runBlocking {
        val http = OkHttpClient.Builder()
            .addInterceptor { chain ->
                okhttp3.Response.Builder()
                    .request(chain.request())
                    .protocol(Protocol.HTTP_1_1)
                    .code(204)
                    .message("No Content")
                    .body(ByteArray(0).toResponseBody(null))
                    .build()
            }
            .build()
        val wireApi = Retrofit.Builder()
            .baseUrl("https://example.invalid/")
            .client(http)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            .create(RetrofitJianweiApi::class.java)
        val api = StrictJianweiApi(wireApi)

        val error = runCatching {
            api.register(RegisterRequest("installation"))
        }.exceptionOrNull()

        assertThat(error).isInstanceOf(IOException::class.java)
        assertThat(error).hasMessageThat()
            .isEqualTo("POST /v1/devices/register returned a successful response without a body")
    }
}
