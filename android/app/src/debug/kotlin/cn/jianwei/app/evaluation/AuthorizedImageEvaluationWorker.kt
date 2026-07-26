package cn.jianwei.app.evaluation

import android.content.Context
import android.net.Uri
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import cn.jianwei.data.network.AuthorizedEvaluationAnalysisClient
import cn.jianwei.data.network.AuthorizedEvaluationRequest
import cn.jianwei.data.photos.PrivacyFilter
import cn.jianwei.data.work.shouldRetryAuthorizedEvaluationError
import cn.jianwei.domain.model.AnalysisState
import cn.jianwei.domain.coroutines.throwIfCancellation
import cn.jianwei.domain.model.PhotoCandidate
import cn.jianwei.domain.model.PhotoOrigin
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.components.SingletonComponent
import java.time.Duration
import java.time.Instant
import java.util.UUID

@EntryPoint
@InstallIn(SingletonComponent::class)
interface AuthorizedImageEvaluationDependencies {
    fun privacyFilter(): PrivacyFilter
    fun authorizedEvaluationAnalysisClient(): AuthorizedEvaluationAnalysisClient
}

internal class AuthorizedImageEvaluationWorker(
    context: Context,
    parameters: WorkerParameters
) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result {
        val runId = inputData.getString(KEY_RUN_ID)?.takeIf(RUN_ID::matches)
            ?: return Result.failure(failure("invalid_run_id"))
        return try {
            val loaded = EvaluationArtifacts.loadPrepared(applicationContext, runId)
            val prepared = loaded.prepared
            val approval = loaded.approval
            val progress = loaded.progress
            val completedIds = progress.results.mapTo(mutableSetOf()) { it.sampleId }
            val next = prepared.samples.firstOrNull { it.sampleId !in completedIds }
            if (next == null) {
                EvaluationArtifacts.ensureFinalResult(applicationContext, prepared, approval, progress)
                return Result.success(Data.Builder().putBoolean("complete", true).build())
            }
            val file = EvaluationArtifacts.verifySampleFile(prepared, next)
            val dependencies = EntryPointAccessors.fromApplication(
                applicationContext,
                AuthorizedImageEvaluationDependencies::class.java
            )
            val initialFlags = if (file.name.contains("screenshot", true) || file.name.contains("截屏")) setOf("screenshot") else emptySet()
            val privacy = dependencies.privacyFilter().analyze(Uri.fromFile(file).toString(), initialFlags)
            val localPassed = privacy.sensitiveFlags.isEmpty() && privacy.qualityScore >= 0.35
            val result = if (!localPassed) {
                EvaluationSampleResult(next.sampleId, next.sampleSha256, true, false, null)
            } else {
                val candidate = PhotoCandidate(
                    localId = next.sampleSha256.take(16).toULong(16).toLong(),
                    candidateToken = UUID.nameUUIDFromBytes(
                        "jianwei-authorized-evaluation-v1:$runId:${next.sampleId}".toByteArray(Charsets.UTF_8)
                    ).toString(),
                    contentUri = Uri.fromFile(file).toString(),
                    capturedAt = Instant.parse(prepared.manifest.createdAt),
                    modifiedAt = Instant.ofEpochMilli(next.lastModified.coerceAtLeast(0L)),
                    perceptualHash = privacy.perceptualHash,
                    qualityScore = privacy.qualityScore,
                    localLabels = privacy.labels,
                    sensitiveFlags = privacy.sensitiveFlags,
                    analysisState = AnalysisState.READY,
                    origin = PhotoOrigin.PHOTO_PICKER,
                    width = 0,
                    height = 0
                )
                val analyzed = dependencies.authorizedEvaluationAnalysisClient().analyze(
                    candidate,
                    AuthorizedEvaluationRequest(
                        leaseToken = loaded.lease.leaseToken,
                        datasetId = loaded.lease.datasetId,
                        runId = loaded.lease.runId,
                        labelsSha256 = loaded.lease.labelsSha256,
                        sampleId = next.sampleId
                    )
                )
                require(analyzed.response.status in setOf("completed", "needs_content", "rejected")) {
                    "云端没有返回评测终态"
                }
                // This records the production egress decision. For a sensitive ground-truth image,
                // a local false negative is therefore counted even if a later server gate rejects it.
                EvaluationSampleResult(
                    next.sampleId,
                    next.sampleSha256,
                    true,
                    true,
                    analyzed.response.card?.topicId
                )
            }
            val nextProgress = progress.copy(results = progress.results + result)
            EvaluationArtifacts.saveProgress(applicationContext, nextProgress)
            if (nextProgress.results.size == prepared.samples.size) {
                EvaluationArtifacts.ensureFinalResult(applicationContext, prepared, approval, nextProgress)
                Result.success(Data.Builder().putBoolean("complete", true).build())
            } else {
                enqueueNext(applicationContext, runId, ExistingWorkPolicy.APPEND_OR_REPLACE)
                Result.success(
                    Data.Builder()
                        .putInt("completed", nextProgress.results.size)
                        .putInt("total", prepared.samples.size)
                        .build()
                )
            }
        } catch (error: Exception) {
            error.throwIfCancellation()
            val retryable = shouldRetryAuthorizedEvaluationError(error)
            if (retryable && runAttemptCount < MAX_ATTEMPTS - 1) Result.retry()
            else Result.failure(failure(error::class.java.simpleName.take(80)))
        }
    }

    companion object {
        private const val KEY_RUN_ID = "run_id"
        private const val MAX_ATTEMPTS = 5
        private val RUN_ID = Regex("^[A-Za-z0-9._-]{3,128}$")

        fun start(context: Context, runId: String) {
            require(RUN_ID.matches(runId))
            enqueueNext(context, runId, ExistingWorkPolicy.KEEP)
        }

        fun workName(runId: String): String = "jianwei-authorized-image-evaluation-$runId"

        private fun enqueueNext(context: Context, runId: String, policy: ExistingWorkPolicy) {
            val request = OneTimeWorkRequestBuilder<AuthorizedImageEvaluationWorker>()
                .setInputData(Data.Builder().putString(KEY_RUN_ID, runId).build())
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .setRequiresBatteryNotLow(true)
                        .build()
                )
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, Duration.ofSeconds(30))
                .addTag(workName(runId))
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(workName(runId), policy, request)
        }

        private fun failure(code: String): Data = Data.Builder().putString("failure_type", code).build()
    }
}
