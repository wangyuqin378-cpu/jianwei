package cn.jianwei.app

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import cn.jianwei.data.local.CardEntity
import cn.jianwei.data.local.PhotoCandidateEntity
import cn.jianwei.data.local.buildJianweiDatabase
import com.google.common.truth.Truth.assertThat
import java.io.File
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.runBlocking
import org.junit.Test

class PhotoThumbnailLifecycleInstrumentedTest {
    @Test
    fun decodedPhotoRemainsDrawableAfterProduceStatePublishesIt(): Unit = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val photo = File(context.filesDir, "thumbnail-lifecycle-regression.jpg")
        writeTestJpeg(photo)
        context.getSharedPreferences("onboarding", Context.MODE_PRIVATE)
            .edit()
            .putBoolean("completed", true)
            .putStringSet("interests", setOf("生活设计", "物件历史", "科学原理"))
            .commit()

        val database = buildJianweiDatabase(context)
        database.cards().clear()
        database.photos().clear()
        val candidateToken = "thumbnail-lifecycle-candidate"
        database.photos().upsert(
            PhotoCandidateEntity(
                localId = -91001L,
                candidateToken = candidateToken,
                contentUri = Uri.fromFile(photo).toString(),
                capturedAtMillis = System.currentTimeMillis(),
                modifiedAtMillis = System.currentTimeMillis(),
                sourceDigest = "thumbnail-lifecycle-source",
                perceptualHash = 1L,
                qualityScore = 0.9,
                localLabels = listOf("Bicycle"),
                sensitiveFlags = emptySet(),
                analysisState = "COMPLETED",
                origin = "PHOTO_PICKER",
                width = 96,
                height = 96
            )
        )
        database.cards().upsertAll(
            listOf(
                CardEntity(
                    cardId = "thumbnail-lifecycle-card",
                    candidateToken = candidateToken,
                    photoUri = Uri.fromFile(photo).toString(),
                    topicId = "bicycle",
                    factId = "bicycle-001",
                    title = "自行车",
                    detectedObjectName = "自行车",
                    body = "自行车依靠链条和齿轮传递踩踏力量，让轮子持续转动并提高通勤效率。",
                    personalContext = "来自你刚刚选择的照片",
                    confidence = 0.92,
                    sources = """[{"sourceId":"test-source","title":"测试来源","url":"https://example.com/source","publisher":"测试发布者","authority":"reference"}]""",
                    status = "scheduled",
                    scheduledDate = LocalDate.now(ZoneId.of("Asia/Shanghai")).toString(),
                    createdAtMillis = System.currentTimeMillis()
                )
            )
        )
        database.close()

        val scenario = ActivityScenario.launch(MainActivity::class.java)
        try {
            InstrumentationRegistry.getInstrumentation().waitForIdleSync()
            Thread.sleep(750)
            InstrumentationRegistry.getInstrumentation().waitForIdleSync()
            scenario.onActivity { activity ->
                assertThat(activity.isFinishing).isFalse()
                assertThat(activity.isDestroyed).isFalse()
            }
        } finally {
            scenario.close()
            val cleanup = buildJianweiDatabase(context)
            cleanup.cards().clear()
            cleanup.photos().clear()
            cleanup.close()
            photo.delete()
        }
    }

    private fun writeTestJpeg(file: File) {
        val bitmap = Bitmap.createBitmap(96, 96, Bitmap.Config.ARGB_8888)
        try {
            bitmap.eraseColor(Color.rgb(54, 108, 72))
            file.outputStream().use { output ->
                check(bitmap.compress(Bitmap.CompressFormat.JPEG, 92, output))
            }
        } finally {
            bitmap.recycle()
        }
    }
}
