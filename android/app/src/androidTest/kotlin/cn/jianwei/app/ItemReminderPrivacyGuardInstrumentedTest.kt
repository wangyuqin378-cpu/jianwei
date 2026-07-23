package cn.jianwei.app

import android.Manifest
import android.app.ActivityOptions
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import cn.jianwei.data.local.CardEntity
import cn.jianwei.data.local.TrackedItemEntity
import cn.jianwei.data.local.buildJianweiDatabase
import com.google.common.truth.Truth.assertThat
import java.time.LocalDate
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.runBlocking
import org.junit.Test

class ItemReminderPrivacyGuardInstrumentedTest {
    @Test
    fun missingCardOrTrackingCannotNotifyEvenWhenStaleWorkStillExecutes() = runBlocking {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        if (Build.VERSION.SDK_INT >= 33) {
            instrumentation.uiAutomation.grantRuntimePermission(
                context.packageName,
                Manifest.permission.POST_NOTIFICATIONS
            )
        }
        ensureItemReminderChannel(context)
        assertThat(canPostItemReminder(context)).isTrue()

        val cardId = "privacy-reminder-${System.nanoTime()}"
        val startedOn = LocalDate.now()
        val reminderDays = 90
        val notificationId = stableReminderNotificationId(cardId)
        val notifications = context.getSystemService(NotificationManager::class.java)
        val workManager = WorkManager.getInstance(context)
        val database = buildJianweiDatabase(context)
        try {
            notifications.cancel(notificationId)
            database.cards().upsertAll(listOf(reminderCard(cardId, startedOn)))
            database.cards().upsertTrackedItem(
                TrackedItemEntity(
                    cardId = cardId,
                    startedOn = startedOn.toString(),
                    reminderDays = reminderDays,
                    syncAction = "UPSERT",
                    updatedAtMillis = 1L
                )
            )

            val activeRequest = reminderRequest(cardId, startedOn, reminderDays)
            workManager.enqueue(activeRequest).result.get(5, TimeUnit.SECONDS)
            awaitFinished(workManager, activeRequest.id)
            val activeNotification = notifications.activeNotifications
                .single { notification -> notification.id == notificationId }
                .notification
            val visibleText = listOf(
                activeNotification.extras.getCharSequence("android.title"),
                activeNotification.extras.getCharSequence("android.text"),
                activeNotification.extras.getCharSequence("android.bigText")
            ).joinToString(" ")
            assertThat(visibleText).contains("你追踪的物品到复查时间了")
            assertThat(visibleText).doesNotContain("隐私测试物品")
            val launchOptions = ActivityOptions.makeBasic().apply {
                if (Build.VERSION.SDK_INT >= 34) {
                    setPendingIntentBackgroundActivityStartMode(
                        ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED
                    )
                }
            }
            activeNotification.contentIntent.send(
                context,
                0,
                null,
                null,
                null,
                null,
                launchOptions.toBundle()
            )
            assertThat(awaitOpenedCardId(instrumentation)).isEqualTo(cardId)
            instrumentation.runOnMainSync {
                resumedMainActivity()?.finish()
            }

            notifications.cancel(notificationId)
            database.cards().deleteById(cardId)

            val missingCardRequest = reminderRequest(cardId, startedOn, reminderDays)
            workManager.enqueue(missingCardRequest).result.get(5, TimeUnit.SECONDS)
            awaitFinished(workManager, missingCardRequest.id)
            assertThat(
                notifications.activeNotifications.map { it.id }
            ).doesNotContain(notificationId)

            database.cards().upsertAll(listOf(reminderCard(cardId, startedOn)))
            database.cards().removeTrackedItem(cardId)

            // This request models the crash window after the Room privacy transaction removed
            // tracking but before WorkManager cancellation completed.
            val staleRequest = reminderRequest(cardId, startedOn, reminderDays)
            workManager.enqueue(staleRequest).result.get(5, TimeUnit.SECONDS)
            awaitFinished(workManager, staleRequest.id)

            assertThat(
                notifications.activeNotifications.map { it.id }
            ).doesNotContain(notificationId)
        } finally {
            notifications.cancel(notificationId)
            database.cards().removeTrackedItem(cardId)
            database.cards().deleteById(cardId)
            database.close()
        }
    }

    private fun reminderCard(cardId: String, scheduledDate: LocalDate) = CardEntity(
        cardId = cardId,
        candidateToken = "candidate-$cardId",
        photoUri = "",
        topicId = "reminder-test",
        factId = "reminder-test-fact",
        title = "提醒回卡测试",
        detectedObjectName = "测试物品",
        body = "这是一张仅用于本地提醒回卡验证的合成卡片。",
        personalContext = "本地 API 34 测试",
        confidence = 0.99,
        sources = "[]",
        status = "scheduled",
        scheduledDate = scheduledDate.toString(),
        createdAtMillis = 1L
    )

    private fun reminderRequest(
        cardId: String,
        startedOn: LocalDate,
        reminderDays: Int
    ) = OneTimeWorkRequestBuilder<ItemReminderWorker>()
        .setInputData(
            itemReminderData(
                cardId = cardId,
                startedOn = startedOn,
                reminderDays = reminderDays
            )
        )
        .build()

    private fun awaitOpenedCardId(
        instrumentation: android.app.Instrumentation
    ): String {
        repeat(100) {
            var openedCardId: String? = null
            instrumentation.runOnMainSync {
                openedCardId = resumedMainActivity()
                    ?.intent
                    ?.getStringExtra(MainActivity.EXTRA_CARD_ID)
            }
            if (openedCardId != null) return openedCardId!!
            Thread.sleep(50)
        }
        error("Reminder notification did not open its tracked card")
    }

    private fun resumedMainActivity(): MainActivity? = ActivityLifecycleMonitorRegistry.getInstance()
        .getActivitiesInStage(Stage.RESUMED)
        .filterIsInstance<MainActivity>()
        .firstOrNull()

    private fun awaitFinished(workManager: WorkManager, id: UUID) {
        repeat(100) {
            val state = workManager.getWorkInfoById(id).get(2, TimeUnit.SECONDS)?.state
            if (state?.isFinished == true) {
                assertThat(state).isEqualTo(WorkInfo.State.SUCCEEDED)
                return
            }
            Thread.sleep(50)
        }
        error("Reminder work did not finish")
    }
}
