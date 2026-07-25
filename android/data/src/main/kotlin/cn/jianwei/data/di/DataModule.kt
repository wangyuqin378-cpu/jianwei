package cn.jianwei.data.di

import android.content.ContentResolver
import android.content.Context
import cn.jianwei.data.BuildConfig
import cn.jianwei.data.cards.RoomCardRepository
import cn.jianwei.data.local.CardDao
import cn.jianwei.data.local.JianweiDatabase
import cn.jianwei.data.local.buildJianweiDatabase
import cn.jianwei.data.local.PhotoDao
import cn.jianwei.data.network.JianweiApi
import cn.jianwei.data.photos.MediaPhotoRepository
import cn.jianwei.data.photos.MlKitPrivacyFilter
import cn.jianwei.data.photos.PrivacyFilter
import cn.jianwei.data.work.WorkManagerScheduler
import cn.jianwei.data.status.SharedPreferencesAnalysisStatusRepository
import cn.jianwei.data.preferences.SharedPreferencesInterestPreferencesRepository
import cn.jianwei.data.preferences.SharedPreferencesAutomaticCardModeRepository
import cn.jianwei.domain.repository.AnalysisScheduler
import cn.jianwei.domain.repository.AnalysisStatusRepository
import cn.jianwei.domain.repository.CardRepository
import cn.jianwei.domain.repository.InterestPreferencesRepository
import cn.jianwei.domain.repository.AutomaticCardModeRepository
import cn.jianwei.domain.repository.PhotoRepository
import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Singleton
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory

@Module
@InstallIn(SingletonComponent::class)
object DataProviders {
    private const val API_CALL_TIMEOUT_SECONDS = 150L

    @Provides
    fun contentResolver(@ApplicationContext context: Context): ContentResolver = context.contentResolver

    @Provides
    @Singleton
    fun database(@ApplicationContext context: Context): JianweiDatabase =
        buildJianweiDatabase(context)

    @Provides fun photoDao(database: JianweiDatabase): PhotoDao = database.photos()
    @Provides fun cardDao(database: JianweiDatabase): CardDao = database.cards()

    @Provides
    @Singleton
    fun okHttp(): OkHttpClient = buildJianweiHttpClient()

    internal fun buildJianweiHttpClient(): OkHttpClient = OkHttpClient.Builder()
        .callTimeout(java.time.Duration.ofSeconds(API_CALL_TIMEOUT_SECONDS))
        .followRedirects(false)
        .followSslRedirects(false)
        .build()

    @Provides
    @Singleton
    fun retrofit(http: OkHttpClient): Retrofit = Retrofit.Builder()
        .baseUrl(BuildConfig.API_BASE_URL)
        .client(http)
        .addConverterFactory(GsonConverterFactory.create())
        .build()

    @Provides
    @Singleton
    fun api(retrofit: Retrofit): JianweiApi = retrofit.create(JianweiApi::class.java)
}

@Module
@InstallIn(SingletonComponent::class)
abstract class DataBindings {
    @Binds abstract fun photoRepository(value: MediaPhotoRepository): PhotoRepository
    @Binds abstract fun cardRepository(value: RoomCardRepository): CardRepository
    @Binds abstract fun privacyFilter(value: MlKitPrivacyFilter): PrivacyFilter
    @Binds abstract fun scheduler(value: WorkManagerScheduler): AnalysisScheduler
    @Binds abstract fun analysisStatus(value: SharedPreferencesAnalysisStatusRepository): AnalysisStatusRepository
    @Binds abstract fun interestPreferences(value: SharedPreferencesInterestPreferencesRepository): InterestPreferencesRepository
    @Binds abstract fun automaticCardMode(value: SharedPreferencesAutomaticCardModeRepository): AutomaticCardModeRepository
}
