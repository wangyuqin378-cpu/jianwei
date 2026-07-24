package cn.jianwei.app

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.SystemClock
import android.provider.MediaStore
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
import androidx.work.WorkInfo
import androidx.work.WorkManager
import cn.jianwei.data.local.buildJianweiDatabase
import cn.jianwei.data.photos.MediaPhotoRepository
import cn.jianwei.domain.repository.AnalysisScheduler
import com.google.common.truth.Truth.assertThat
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.runBlocking
import org.junit.Test

class ShareReceiverFlowInstrumentedTest {
    @Test
    fun sharedImageRetriesAcrossProcessGateAndExplainsPausedImport() = runBlocking {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val database = buildJianweiDatabase(context)
        val photos = MediaPhotoRepository(context, context.contentResolver, database.photos())
        val workManager = WorkManager.getInstance(context)
        val sourceUri = insertSyntheticImage(context)
        var mainScenario: ActivityScenario<MainActivity>? = null
        var shareActivity: ShareReceiverActivity? = null
        var initialMainActivity: MainActivity? = null
        var gate: UserOperationGate? = null
        var scheduler: AnalysisScheduler? = null

        try {
            photos.clearIndex()
            context.getSharedPreferences("onboarding", Context.MODE_PRIVATE)
                .edit()
                .putBoolean("completed", true)
                .commit()

            mainScenario = ActivityScenario.launch(MainActivity::class.java)
            mainScenario.onActivity { activity ->
                initialMainActivity = activity
                activity.startActivity(
                    Intent(activity, ShareReceiverActivity::class.java).apply {
                        action = Intent.ACTION_SEND
                        type = "image/jpeg"
                        putExtra(Intent.EXTRA_STREAM, sourceUri)
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    }
                )
            }
            shareActivity = awaitResumedShareReceiverActivity(instrumentation)
            instrumentation.runOnMainSync {
                gate = shareActivity!!.operationGate
                scheduler = shareActivity!!.scheduler
                scheduler!!.setPaused(true)
                assertThat(scheduler!!.isPaused()).isTrue()
                assertThat(gate!!.tryStart(UserOperation.DELETE_CLOUD_DATA)).isTrue()
            }

            clickNode(instrumentation, "导入并分析")
            awaitNode(instrumentation, "另一项操作还没完成")
            assertThat(gate!!.current()).isEqualTo(UserOperation.DELETE_CLOUD_DATA)

            assertThat(gate!!.finish(UserOperation.DELETE_CLOUD_DATA)).isTrue()
            clickNode(instrumentation, "重试")
            val resumedMainActivity = awaitResumedMainActivity(instrumentation)
            assertThat(resumedMainActivity).isSameInstanceAs(initialMainActivity)

            val imported = database.photos()
                .discoveredForPrivacy(10)
                .single()
            assertThat(imported.origin).isEqualTo("PHOTO_PICKER")
            assertThat(imported.contentUri).startsWith("file:")
            assertThat(imported.contentUri).doesNotContain(sourceUri.toString())
            assertThat(gate!!.current()).isNull()

            val activeImportWork = workManager
                .getWorkInfosForUniqueWork("jianwei-imported-analysis")
                .get(5, TimeUnit.SECONDS)
                .filter { info ->
                    info.state == WorkInfo.State.ENQUEUED ||
                        info.state == WorkInfo.State.RUNNING ||
                        info.state == WorkInfo.State.BLOCKED
                }
            assertThat(activeImportWork).isEmpty()
        } finally {
            gate?.finish(UserOperation.DELETE_CLOUD_DATA)
            gate?.finish(UserOperation.IMPORT_PHOTOS)
            scheduler?.setPaused(false)
            if (shareActivity?.isDestroyed == false) {
                instrumentation.runOnMainSync {
                    shareActivity?.finish()
                }
            }
            if (initialMainActivity?.isDestroyed == false) {
                instrumentation.runOnMainSync {
                    initialMainActivity?.finish()
                }
            }
            photos.clearIndex()
            database.close()
            context.contentResolver.delete(sourceUri, null, null)
        }
    }

    private fun insertSyntheticImage(context: Context): Uri {
        val resolver = context.contentResolver
        val uri = requireNotNull(
            resolver.insert(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                ContentValues().apply {
                    put(MediaStore.Images.Media.DISPLAY_NAME, "jianwei-share-${System.nanoTime()}.jpg")
                    put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
                    put(MediaStore.Images.Media.IS_PENDING, 1)
                }
            )
        )
        resolver.openOutputStream(uri).use { output ->
            requireNotNull(output)
            val bitmap = Bitmap.createBitmap(96, 96, Bitmap.Config.ARGB_8888)
            try {
                bitmap.eraseColor(Color.rgb(42, 98, 71))
                check(bitmap.compress(Bitmap.CompressFormat.JPEG, 90, output))
            } finally {
                bitmap.recycle()
            }
        }
        resolver.update(
            uri,
            ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) },
            null,
            null
        )
        return uri
    }

    private fun clickNode(
        instrumentation: android.app.Instrumentation,
        text: String
    ) {
        val node = awaitNode(instrumentation, text)
        val clickable = generateSequence(node) { current -> current.parent }
            .firstOrNull { current -> current.isClickable }
        assertThat(clickable).isNotNull()
        assertThat(clickable!!.performAction(AccessibilityNodeInfo.ACTION_CLICK)).isTrue()
    }

    private fun exactNode(
        instrumentation: android.app.Instrumentation,
        text: String
    ): AccessibilityNodeInfo? = instrumentation.uiAutomation.rootInActiveWindow
        ?.findAccessibilityNodeInfosByText(text)
        ?.firstOrNull { node -> node.text?.toString() == text }

    private fun awaitNode(
        instrumentation: android.app.Instrumentation,
        text: String,
        timeoutMillis: Long = 5_000
    ): AccessibilityNodeInfo {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        while (SystemClock.uptimeMillis() < deadline) {
            val match = exactNode(instrumentation, text)
            if (match != null) return match
            SystemClock.sleep(100)
        }
        error("Timed out waiting for accessibility node: $text")
    }

    private fun awaitResumedMainActivity(
        instrumentation: android.app.Instrumentation,
        timeoutMillis: Long = 5_000
    ): MainActivity {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        while (SystemClock.uptimeMillis() < deadline) {
            var activity: MainActivity? = null
            instrumentation.runOnMainSync {
                activity = ActivityLifecycleMonitorRegistry.getInstance()
                    .getActivitiesInStage(Stage.RESUMED)
                    .filterIsInstance<MainActivity>()
                    .singleOrNull()
            }
            if (activity != null) return activity!!
            SystemClock.sleep(100)
        }
        error("Timed out waiting for MainActivity")
    }

    private fun awaitResumedShareReceiverActivity(
        instrumentation: android.app.Instrumentation,
        timeoutMillis: Long = 5_000
    ): ShareReceiverActivity {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        while (SystemClock.uptimeMillis() < deadline) {
            var activity: ShareReceiverActivity? = null
            instrumentation.runOnMainSync {
                activity = ActivityLifecycleMonitorRegistry.getInstance()
                    .getActivitiesInStage(Stage.RESUMED)
                    .filterIsInstance<ShareReceiverActivity>()
                    .singleOrNull()
            }
            if (activity != null) return activity!!
            SystemClock.sleep(100)
        }
        error("Timed out waiting for ShareReceiverActivity")
    }
}
