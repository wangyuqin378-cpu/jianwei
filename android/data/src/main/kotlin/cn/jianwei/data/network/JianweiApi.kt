package cn.jianwei.data.network

import retrofit2.http.Body
import retrofit2.Response
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

interface JianweiApi {
    @POST("v1/devices/register")
    suspend fun register(@Body request: RegisterRequest): RegisterResponse

    @POST("v1/analysis-jobs")
    suspend fun createJob(
        @Header("Authorization") authorization: String,
        @Body request: CreateJobRequest
    ): CreateJobResponse

    @POST("v1/analysis-jobs/{id}/complete")
    suspend fun completeJob(@Header("Authorization") authorization: String, @Path("id") jobId: String): CompleteJobResponse

    @GET("v1/cards")
    suspend fun cards(
        @Header("Authorization") authorization: String,
        @Query("cursor") cursor: String? = null,
        @Query("limit") limit: Int = 50
    ): CardsResponse

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
    ): TrackItemResponse

    @DELETE("v1/items/{cardId}/track")
    suspend fun cancelTracking(
        @Header("Authorization") authorization: String,
        @Path("cardId") cardId: String
    ): UntrackItemResponse

    @DELETE("v1/device-data")
    suspend fun deleteDeviceData(@Header("Authorization") authorization: String)
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
data class CardsResponse(val items: List<CardDto>, val nextCursor: String?)
data class SourceDto(val sourceId: String, val title: String, val url: String, val publisher: String, val authority: String)
data class CardDto(
    val cardId: String,
    val candidateToken: String,
    val topicId: String,
    val factId: String,
    val title: String,
    val detectedObjectName: String,
    val body: String,
    val personalContext: String,
    val confidence: Double,
    val sources: List<SourceDto>,
    val status: String,
    val scheduledDate: String,
    val createdAt: String
)
data class FeedbackRequest(val action: String)
data class FeedbackResponse(
    val id: String,
    val cardId: String,
    val action: String,
    val createdAt: String,
    val topicAffinities: List<TopicAffinityDto>
)
data class TopicAffinityDto(val topicId: String, val weight: Double, val aliases: List<String> = emptyList())
data class TrackRequest(val startedOn: String, val reminderDays: Int)
data class TrackItemResponse(
    val id: String?,
    val cardId: String?,
    val startedOn: String?,
    val reminderDays: Int?,
    val createdAt: String?
)
data class UntrackItemResponse(val cardId: String?, val status: String?)
