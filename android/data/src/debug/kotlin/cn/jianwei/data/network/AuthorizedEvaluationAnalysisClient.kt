package cn.jianwei.data.network

import cn.jianwei.domain.model.PhotoCandidate
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Inject
import javax.inject.Singleton
import retrofit2.Retrofit
import retrofit2.http.Body
import retrofit2.http.Header
import retrofit2.http.POST

data class AuthorizedEvaluationRequest(
    val leaseToken: String,
    val datasetId: String,
    val runId: String,
    val labelsSha256: String,
    val sampleId: String
)

interface AuthorizedEvaluationJianweiApi {
    @POST("v1/analysis-jobs")
    suspend fun createJob(
        @Header("Authorization") authorization: String,
        @Header("X-Jianwei-Evaluation-Lease") evaluationLease: String,
        @Body request: CreateJobRequest
    ): CreateJobResponse
}

@Singleton
class AuthorizedEvaluationAnalysisClient @Inject internal constructor(
    private val remote: RemoteAnalysisClient,
    private val api: AuthorizedEvaluationJianweiApi
) {
    suspend fun analyze(
        candidate: PhotoCandidate,
        authorization: AuthorizedEvaluationRequest
    ): AnalyzedCandidate {
        require(authorization.leaseToken.matches(Regex("^[A-Za-z0-9_-]{43}$"))) {
            "Evaluation lease token is invalid"
        }
        return remote.analyzeWithJobCreator(candidate) { bearer, request ->
            api.createJob(
                bearer,
                authorization.leaseToken,
                request.copy(
                    evaluationContext = EvaluationContextRequest(
                        authorization.datasetId,
                        authorization.runId,
                        authorization.labelsSha256,
                        authorization.sampleId
                    )
                )
            )
        }
    }
}

@Module
@InstallIn(SingletonComponent::class)
object AuthorizedEvaluationNetworkModule {
    @Provides
    @Singleton
    fun authorizedEvaluationApi(retrofit: Retrofit): AuthorizedEvaluationJianweiApi =
        retrofit.create(AuthorizedEvaluationJianweiApi::class.java)
}
