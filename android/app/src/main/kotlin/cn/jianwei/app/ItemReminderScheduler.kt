package cn.jianwei.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import cn.jianwei.domain.repository.CardRepository
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import dagger.hilt.android.qualifiers.ApplicationContext
import java.time.Clock
import java.time.LocalDate
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

@Singleton
class ItemReminderScheduler @Inject constructor(
    @param:ApplicationContext private val context: Context
) {
    fun schedule(cardId: String, startedOn: LocalDate, reminderDays: Int) {
        require(isValidItemReminderDraft(startedOn, reminderDays))
        ensureItemReminderChannel(context)
        val request = OneTimeWorkRequestBuilder<ItemReminderWorker>()
            .setInputData(itemReminderData(cardId, startedOn, reminderDays))
            .setInitialDelay(
                itemReminderDelayMillis(startedOn, reminderDays, Clock.systemUTC().instant()),
                TimeUnit.MILLISECONDS
            )
            .addTag(ITEM_REMINDER_WORK_TAG)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            itemReminderWorkName(cardId),
            ExistingWorkPolicy.REPLACE,
            request
        )
    }

    fun cancel(cardId: String) {
        WorkManager.getInstance(context).cancelUniqueWork(itemReminderWorkName(cardId))
    }

    suspend fun cancelAllAndAwait() = withContext(Dispatchers.IO) {
        WorkManager.getInstance(context).cancelAllWorkByTag(ITEM_REMINDER_WORK_TAG).result.get()
    }
}

@HiltWorker
class ItemReminderWorker @AssistedInject constructor(
    @Assisted appContext: Context,
    @Assisted params: WorkerParameters,
    private val cards: CardRepository
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        val cardId = inputData.getString(KEY_CARD_ID) ?: return Result.failure()
        val startedOn = inputData.getString(KEY_STARTED_ON)
            ?.let { stored -> runCatching { LocalDate.parse(stored) }.getOrNull() }
            ?: return Result.failure()
        val reminderDays = inputData.getInt(KEY_REMINDER_DAYS, -1)
        if (reminderDays !in 7..730) return Result.failure()

        // WorkManager cancellation is best-effort. Re-read the durable reminder immediately
        // before posting so a private-card deletion, cloud wipe, cancel, update, or process crash
        // cannot leave a stale scheduled request capable of exposing the old card title.
        if (!cards.isTrackedReminderCurrent(cardId, startedOn, reminderDays)) {
            return Result.success()
        }
        ensureItemReminderChannel(applicationContext)
        if (!canPostItemReminder(applicationContext)) return Result.success()
        postNotification(cardId)
        return Result.success()
    }

    @SuppressLint("MissingPermission")
    private fun postNotification(cardId: String) {
        val intent = Intent(applicationContext, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val contentIntent = PendingIntent.getActivity(
            applicationContext,
            stableReminderNotificationId(cardId),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val notification = NotificationCompat.Builder(applicationContext, ITEM_REMINDER_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher)
            .setContentTitle("见微物品提醒")
            .setContentText("你追踪的物品到复查时间了")
            .setStyle(NotificationCompat.BigTextStyle().bigText("你追踪的物品到复查时间了。打开见微查看原知识卡和来源。"))
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(
                NotificationCompat.Builder(applicationContext, ITEM_REMINDER_CHANNEL_ID)
                    .setSmallIcon(R.drawable.ic_launcher)
                    .setContentTitle("见微提醒")
                    .setContentText("你有一条物品复查提醒")
                    .setCategory(NotificationCompat.CATEGORY_REMINDER)
                    .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                    .build()
            )
            .setContentIntent(contentIntent)
            .setAutoCancel(true)
            .build()
        NotificationManagerCompat.from(applicationContext).notify(stableReminderNotificationId(cardId), notification)
    }
}

internal fun canPostItemReminder(context: Context): Boolean {
    val runtimePermissionGranted = Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(
        context,
        Manifest.permission.POST_NOTIFICATIONS
    ) == PackageManager.PERMISSION_GRANTED
    return runtimePermissionGranted && NotificationManagerCompat.from(context).areNotificationsEnabled()
}

internal fun ensureItemReminderChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java)
    val channel = NotificationChannel(
        ITEM_REMINDER_CHANNEL_ID,
        "物品提醒",
        NotificationManager.IMPORTANCE_DEFAULT
    ).apply {
        description = "仅在你主动确认追踪物品后发送"
    }
    manager.createNotificationChannel(channel)
}

internal fun itemReminderData(
    cardId: String,
    startedOn: LocalDate,
    reminderDays: Int
): Data = workDataOf(
    KEY_CARD_ID to cardId,
    KEY_STARTED_ON to startedOn.toString(),
    KEY_REMINDER_DAYS to reminderDays
)

internal fun itemReminderWorkName(cardId: String): String = "item-reminder-$cardId"

internal fun stableReminderNotificationId(cardId: String): Int = cardId.hashCode() and Int.MAX_VALUE

private const val ITEM_REMINDER_CHANNEL_ID = "item-reminders"
private const val ITEM_REMINDER_WORK_TAG = "item-reminder"
private const val KEY_CARD_ID = "card_id"
private const val KEY_STARTED_ON = "started_on"
private const val KEY_REMINDER_DAYS = "reminder_days"
