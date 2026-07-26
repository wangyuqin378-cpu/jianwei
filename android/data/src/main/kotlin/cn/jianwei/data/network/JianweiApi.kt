package cn.jianwei.data.network

import java.io.IOException
import retrofit2.http.Body
import retrofit2.Response
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

interface JianweiApi {
    suspend fun register(request: RegisterRequest): RegisterResponse

    suspend fun createJob(
        authorization: String,
        request: CreateJobRequest
    ): CreateJobResponse

    suspend fun completeJob(authorization: String, jobId: String): CompleteJobResponse

    suspend fun cards(
        authorization: String,
        cursor: String? = null,
        limit: Int = 50
    ): CardsResponse

    suspend fun feedback(
        authorization: String,
        cardId: String,
        request: FeedbackRequest
    ): Response<FeedbackResponse>

    suspend fun track(
        authorization: String,
        cardId: String,
        request: TrackRequest
    ): TrackItemResponse

    suspend fun cancelTracking(
        authorization: String,
        cardId: String
    ): UntrackItemResponse

    suspend fun deleteDeviceData(authorization: String): DeleteDeviceDataResponse
}

internal interface RetrofitJianweiApi {
    @POST("v1/devices/register")
    suspend fun register(@Body request: RegisterRequest): Response<RegisterResponse>

    @POST("v1/analysis-jobs")
    suspend fun createJob(
        @Header("Authorization") authorization: String,
        @Body request: CreateJobRequest
    ): Response<CreateJobResponse>

    @POST("v1/analysis-jobs/{id}/complete")
    suspend fun completeJob(
        @Header("Authorization") authorization: String,
        @Path("id") jobId: String
    ): Response<CompleteJobResponse>

    @GET("v1/cards")
    suspend fun cards(
        @Header("Authorization") authorization: String,
        @Query("cursor") cursor: String? = null,
        @Query("limit") limit: Int = 50
    ): Response<CardsResponse>

    @POST("v1/cards/{id}/feedback")
    suspend fun feedback(
        @Header("Authorization") authorization: String,
        @Path("id") cardId: String,
        @Body request: FeedbackRequest
    ): Response<FeedbackResponse>

    @POST("v1/items/{cardId}/track")
    suspend fun track(
        @Header("Authorization") authorization: String,
        @Path("cardId") cardId: String,
        @Body request: TrackRequest
    ): Response<TrackItemResponse>

    @DELETE("v1/items/{cardId}/track")
    suspend fun cancelTracking(
        @Header("Authorization") authorization: String,
        @Path("cardId") cardId: String
    ): Response<UntrackItemResponse>

    @DELETE("v1/device-data")
    suspend fun deleteDeviceData(
        @Header("Authorization") authorization: String
    ): Response<DeleteDeviceDataResponse>
}

internal class StrictJianweiApi(
    private val delegate: RetrofitJianweiApi
) : JianweiApi {
    override suspend fun register(request: RegisterRequest): RegisterResponse =
        delegate.register(request).requireApiResponseBody("POST /v1/devices/register")

    override suspend fun createJob(
        authorization: String,
        request: CreateJobRequest
    ): CreateJobResponse = delegate.createJob(authorization, request)
        .requireApiResponseBody("POST /v1/analysis-jobs")

    override suspend fun completeJob(
        authorization: String,
        jobId: String
    ): CompleteJobResponse = delegate.completeJob(authorization, jobId)
        .requireApiResponseBody("POST /v1/analysis-jobs/{id}/complete")

    override suspend fun cards(
        authorization: String,
        cursor: String?,
        limit: Int
    ): CardsResponse = delegate.cards(authorization, cursor, limit)
        .requireApiResponseBody("GET /v1/cards")

    override suspend fun feedback(
        authorization: String,
        cardId: String,
        request: FeedbackRequest
    ): Response<FeedbackResponse> = delegate.feedback(authorization, cardId, request)

    override suspend fun track(
        authorization: String,
        cardId: String,
        request: TrackRequest
    ): TrackItemResponse = delegate.track(authorization, cardId, request)
        .requireApiResponseBody("POST /v1/items/{cardId}/track")

    override suspend fun cancelTracking(
        authorization: String,
        cardId: String
    ): UntrackItemResponse = delegate.cancelTracking(authorization, cardId)
        .requireApiResponseBody("DELETE /v1/items/{cardId}/track")

    override suspend fun deleteDeviceData(authorization: String): DeleteDeviceDataResponse =
        delegate.deleteDeviceData(authorization)
            .requireApiResponseBody("DELETE /v1/device-data")
}

internal fun <T : Any> Response<T>.requireApiResponseBody(endpoint: String): T {
    if (!isSuccessful) throw retrofit2.HttpException(this)
    return body() ?: throw IOException("$endpoint returned a successful response without a body")
}

data class RegisterRequest(val installationId: String)
data class RegisterResponse(
    val deviceId: String?,
    val deviceToken: String?,
    val installationBindingSha256: String?,
    val created: Boolean?
)
data class CreateJobRequest(
    val candidateToken: String,
    val capturedAtBucket: String?,
    val localLabels: List<String>,
    val qualityScore: Double,
    val sensitiveFlags: List<String>,
    val contentType: String,
    val evaluationContext: EvaluationContextRequest? = null
)
data class EvaluationContextRequest(
    val datasetId: String,
    val runId: String,
    val labelsSha256: String,
    val sampleId: String
)
data class CreateJobResponse(
    val jobId: String?,
    val candidateToken: String?,
    val status: String?,
    val uploadUrl: String?,
    val uploadSessionId: String?,
    val expiresAt: String?
)
data class CompleteJobResponse(
    val jobId: String?,
    val candidateToken: String?,
    val status: String?,
    val card: CardDto?
)
data class CardsResponse(val items: List<CardDto?>?, val nextCursor: String?)
data class SourceDto(
    val sourceId: String?,
    val title: String?,
    val url: String?,
    val publisher: String?,
    val authority: String?
)
data class CardDto(
    val cardId: String?,
    val candidateToken: String?,
    val topicId: String?,
    val factId: String?,
    val title: String?,
    val detectedObjectName: String?,
    val body: String?,
    val personalContext: String?,
    val confidence: Double?,
    val sources: List<SourceDto?>?,
    val status: String?,
    val scheduledDate: String?,
    val createdAt: String?
)
data class FeedbackRequest(val action: String)
data class FeedbackResponse(
    val id: String?,
    val cardId: String?,
    val action: String?,
    val createdAt: String?,
    val topicAffinities: List<TopicAffinityDto?>?
)
data class TopicAffinityDto(
    val topicId: String?,
    val weight: Double?,
    val aliases: List<String?>? = emptyList()
)
data class TrackRequest(val startedOn: String, val reminderDays: Int)
data class TrackItemResponse(
    val id: String?,
    val cardId: String?,
    val startedOn: String?,
    val reminderDays: Int?,
    val createdAt: String?
)
data class UntrackItemResponse(val cardId: String?, val status: String?)
data class DeleteDeviceDataResponse(val deviceId: String?, val status: String?)
