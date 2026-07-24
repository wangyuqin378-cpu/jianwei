package cn.jianwei.app

import cn.jianwei.domain.metrics.FirstCardMetricRecorder
import cn.jianwei.domain.repository.AnalysisScheduler
import cn.jianwei.domain.repository.PhotoRepository
import cn.jianwei.domain.usecase.ImportPhotosUseCase
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object AppModule {
    @Provides
    @Singleton
    fun importPhotosUseCase(
        photos: PhotoRepository,
        scheduler: AnalysisScheduler
    ): ImportPhotosUseCase = ImportPhotosUseCase(photos, scheduler)

    @Provides
    @Singleton
    fun firstCardMetricRecorder(
        metrics: BetaMetricsStore
    ): FirstCardMetricRecorder = metrics
}
