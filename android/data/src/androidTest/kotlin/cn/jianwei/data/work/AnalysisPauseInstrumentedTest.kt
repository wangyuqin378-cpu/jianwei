package cn.jianwei.data.work

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.work.WorkInfo
import androidx.work.WorkManager
import cn.jianwei.domain.model.AnalysisPhase
import cn.jianwei.domain.model.AnalysisProgress
import cn.jianwei.domain.model.AnalysisProgressScope
import cn.jianwei.domain.model.PhotoAccess
import cn.jianwei.domain.repository.AnalysisStatusRepository
import cn.jianwei.data.control.AnalysisSessionGate
import cn.jianwei.data.status.SharedPreferencesAnalysisStatusRepository
import com.google.common.truth.Truth.assertThat
import org.junit.Test
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.runBlocking

class AnalysisPauseInstrumentedTest {
    @Test
    fun schedulerScopesPrivacyWorkBeforeItCanInspectCandidates() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val manager = WorkManager.getInstance(context)
        manager.cancelAllWork().result.get()
        manager.pruneWork().result.get()
        val statuses = RecordingAnalysisStatusRepository()
        val scheduler = WorkManagerScheduler(
            context,
            AnalysisSessionGate(context),
            statuses
        )

        try {
            scheduler.setPaused(false)
            scheduler.scheduleInitialScan(PhotoAccess.FULL)
            scheduler.scheduleImportedPhotos()

            val automaticTags = manager.getWorkInfosForUniqueWork(WorkManagerScheduler.INITIAL).get()
                .single { PrivacyScanWorker::class.java.name in it.tags }
                .tags
            val importedTags = manager.getWorkInfosForUniqueWork(WorkManagerScheduler.IMPORTED).get()
                .single { PrivacyScanWorker::class.java.name in it.tags }
                .tags

            assertThat(automaticTags).contains(PRIVACY_ORIGIN_TAG_PREFIX + UploadOriginScope.MEDIA_STORE.name)
            assertThat(importedTags).contains(PRIVACY_ORIGIN_TAG_PREFIX + UploadOriginScope.EXPLICIT_IMPORT.name)
            assertThat(statuses.latest(AnalysisProgressScope.AUTOMATIC_DISCOVERY).phase)
                .isEqualTo(AnalysisPhase.QUEUED)
            assertThat(statuses.latest(AnalysisProgressScope.EXPLICIT_IMPORT).phase)
                .isEqualTo(AnalysisPhase.QUEUED)
        } finally {
            scheduler.cancelAll()
            scheduler.setPaused(false)
        }
    }

    @Test
    fun pausePersistsAcrossSchedulersAndIsVisibleToWorkers() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val preferences = context.getSharedPreferences(DailyPipelineKickWorker.PREFS, Context.MODE_PRIVATE)
        preferences.edit().clear().commit()
        val first = WorkManagerScheduler(context, AnalysisSessionGate(context), SharedPreferencesAnalysisStatusRepository(context))

        try {
            first.setPaused(true)

            assertThat(WorkManagerScheduler(context, AnalysisSessionGate(context), SharedPreferencesAnalysisStatusRepository(context)).isPaused()).isTrue()
            assertThat(context.analysisIsPaused()).isTrue()

            first.setPaused(false)
            assertThat(WorkManagerScheduler(context, AnalysisSessionGate(context), SharedPreferencesAnalysisStatusRepository(context)).isPaused()).isFalse()
            assertThat(context.analysisIsPaused()).isFalse()
        } finally {
            first.setPaused(false)
            first.cancelAll()
        }
    }

    @Test
    fun revocationCancelsAutomaticWorkButPreservesExplicitImports() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val manager = WorkManager.getInstance(context)
        manager.cancelAllWork().result.get()
        manager.pruneWork().result.get()
        val scheduler = WorkManagerScheduler(context, AnalysisSessionGate(context), SharedPreferencesAnalysisStatusRepository(context))

        try {
            scheduler.setPaused(false)
            scheduler.scheduleImportedPhotos()
            scheduler.scheduleInitialScan(PhotoAccess.FULL)
            scheduler.scheduleAccessReconciliation(PhotoAccess.FULL)
            scheduler.scheduleDailyRefresh()

            scheduler.stopAutomaticDiscovery()

            val imported = manager.getWorkInfosForUniqueWork(WorkManagerScheduler.IMPORTED).get()
            assertThat(imported).isNotEmpty()
            assertThat(imported.none { it.state == WorkInfo.State.CANCELLED }).isTrue()

            val automaticNames = listOf(
                WorkManagerScheduler.INITIAL,
                WorkManagerScheduler.RECONCILIATION,
                WorkManagerScheduler.DAILY,
                DailyPipelineKickWorker.DAILY_PIPELINE
            )
            val activeStates = setOf(WorkInfo.State.ENQUEUED, WorkInfo.State.RUNNING, WorkInfo.State.BLOCKED)
            automaticNames.forEach { name ->
                assertThat(manager.getWorkInfosForUniqueWork(name).get().none { it.state in activeStates }).isTrue()
            }
        } finally {
            scheduler.cancelAll()
            scheduler.setPaused(false)
        }
    }

    private class RecordingAnalysisStatusRepository : AnalysisStatusRepository {
        private val values = AnalysisProgressScope.entries.associateWith { MutableStateFlow(AnalysisProgress()) }

        override fun observeProgress(scope: AnalysisProgressScope): Flow<AnalysisProgress> =
            requireNotNull(values[scope])

        override fun publishProgress(scope: AnalysisProgressScope, progress: AnalysisProgress) {
            requireNotNull(values[scope]).value = progress
        }

        fun latest(scope: AnalysisProgressScope): AnalysisProgress = requireNotNull(values[scope]).value
    }
}
