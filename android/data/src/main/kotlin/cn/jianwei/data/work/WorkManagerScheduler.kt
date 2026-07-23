package cn.jianwei.data.work

import android.content.Context
import androidx.work.Constraints
import androidx.work.BackoffPolicy
import androidx.work.Data
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import cn.jianwei.domain.model.AnalysisPhase
import cn.jianwei.domain.model.AnalysisProgress
import cn.jianwei.domain.model.PhotoAccess
import cn.jianwei.domain.repository.AnalysisScheduler
import cn.jianwei.domain.repository.AnalysisStatusRepository
import cn.jianwei.data.control.AnalysisSessionGate
import dagger.hilt.android.qualifiers.ApplicationContext
import java.time.Duration
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

@Singleton
class WorkManagerScheduler @Inject constructor(
    @param:ApplicationContext private val context: Context,
    private val sessionGate: AnalysisSessionGate,
    private val status: AnalysisStatusRepository
) : AnalysisScheduler {
    private val workManager = WorkManager.getInstance(context)
    private val preferences = context.getSharedPreferences(DailyPipelineKickWorker.PREFS, Context.MODE_PRIVATE)

    override fun scheduleInitialScan(access: PhotoAccess) {
        if (isPaused()) return
        status.publishProgress(AnalysisProgress(phase = AnalysisPhase.QUEUED))
        preferences.edit()
            .putString(DailyPipelineKickWorker.KEY_ACCESS, access.name)
            .apply()
        val scan = OneTimeWorkRequestBuilder<ScanWorker>()
            .setInputData(Data.Builder().putString(ScanWorker.KEY_ACCESS, access.name).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, Duration.ofMinutes(1))
            .build()
        val privacy = OneTimeWorkRequestBuilder<PrivacyScanWorker>()
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, Duration.ofMinutes(1))
            .build()
        val upload = OneTimeWorkRequestBuilder<UploadWorker>()
            .setInputData(Data.Builder().putString(UploadWorker.KEY_ORIGIN_SCOPE, UploadOriginScope.MEDIA_STORE.name).build())
            .setConstraints(uploadConstraints())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, Duration.ofMinutes(1))
            .build()
        workManager.beginUniqueWork(INITIAL, ExistingWorkPolicy.KEEP, scan)
            .then(privacy)
            .then(upload)
            .enqueue()
    }

    override fun scheduleAccessReconciliation(access: PhotoAccess) {
        if (isPaused() || access == PhotoAccess.PICKER_ONLY) return
        status.publishProgress(AnalysisProgress(phase = AnalysisPhase.QUEUED))
        preferences.edit()
            .putString(DailyPipelineKickWorker.KEY_ACCESS, access.name)
            .apply()
        val scan = OneTimeWorkRequestBuilder<ScanWorker>()
            .setInputData(Data.Builder().putString(ScanWorker.KEY_ACCESS, access.name).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, Duration.ofMinutes(1))
            .build()
        val privacy = OneTimeWorkRequestBuilder<PrivacyScanWorker>()
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, Duration.ofMinutes(1))
            .build()
        val upload = OneTimeWorkRequestBuilder<UploadWorker>()
            .setInputData(Data.Builder().putString(UploadWorker.KEY_ORIGIN_SCOPE, UploadOriginScope.MEDIA_STORE.name).build())
            .setConstraints(uploadConstraints())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, Duration.ofMinutes(1))
            .build()
        workManager.beginUniqueWork(RECONCILIATION, ExistingWorkPolicy.REPLACE, scan)
            .then(privacy)
            .then(upload)
            .enqueue()
    }

    override fun scheduleImportedPhotos() {
        if (isPaused()) return
        status.publishProgress(AnalysisProgress(phase = AnalysisPhase.QUEUED))
        workManager.beginUniqueWork(
            IMPORTED,
            ExistingWorkPolicy.APPEND_OR_REPLACE,
            OneTimeWorkRequestBuilder<PrivacyScanWorker>()
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, Duration.ofMinutes(1))
                .build()
        ).then(
            OneTimeWorkRequestBuilder<UploadWorker>()
                .setInputData(Data.Builder().putString(UploadWorker.KEY_ORIGIN_SCOPE, UploadOriginScope.EXPLICIT_IMPORT.name).build())
                .setConstraints(uploadConstraints())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, Duration.ofMinutes(1))
                .build()
        ).enqueue()
    }

    override fun scheduleDailyRefresh() {
        if (isPaused()) return
        val request = PeriodicWorkRequestBuilder<DailyPipelineKickWorker>(Duration.ofHours(24))
            .setConstraints(Constraints.Builder().setRequiresBatteryNotLow(true).build())
            .build()
        workManager.enqueueUniquePeriodicWork(DAILY, ExistingPeriodicWorkPolicy.KEEP, request)
    }

    override suspend fun stopAutomaticDiscovery() {
        status.publishProgress(AnalysisProgress(phase = AnalysisPhase.IDLE))
        preferences.edit()
            .putString(DailyPipelineKickWorker.KEY_ACCESS, PhotoAccess.PICKER_ONLY.name)
            .apply()
        withContext(Dispatchers.IO) {
            automaticCancellationOperations().forEach { operation -> operation.result.get() }
        }
    }

    override fun isPaused(): Boolean = sessionGate.isPaused()

    override fun setPaused(paused: Boolean) {
        if (paused) sessionGate.beginPause() else sessionGate.resume()
    }

    override suspend fun pauseAndCancel() {
        sessionGate.beginPause()
        val cancellation = runCatching {
            withContext(Dispatchers.IO) {
                cancellationOperations().forEach { operation -> operation.result.get() }
            }
        }
        sessionGate.awaitDrained()
        cancellation.getOrThrow()
    }

    override fun cancelAll() {
        cancellationOperations()
    }

    private fun automaticCancellationOperations() = listOf(
        workManager.cancelUniqueWork(INITIAL),
        workManager.cancelUniqueWork(RECONCILIATION),
        workManager.cancelUniqueWork(DAILY),
        workManager.cancelUniqueWork(DailyPipelineKickWorker.DAILY_PIPELINE)
    )

    private fun cancellationOperations() = automaticCancellationOperations() +
        workManager.cancelUniqueWork(IMPORTED)

    private fun uploadConstraints() = Constraints.Builder()
        .setRequiredNetworkType(NetworkType.CONNECTED)
        .setRequiresBatteryNotLow(true)
        .build()

    companion object {
        internal const val INITIAL = "jianwei-initial-analysis"
        internal const val RECONCILIATION = "jianwei-photo-access-reconciliation"
        internal const val IMPORTED = "jianwei-imported-analysis"
        internal const val DAILY = "jianwei-daily-card-sync"
    }
}
