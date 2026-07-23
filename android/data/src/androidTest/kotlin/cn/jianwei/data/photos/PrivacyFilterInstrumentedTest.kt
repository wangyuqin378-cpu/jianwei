package cn.jianwei.data.photos

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import java.io.ByteArrayOutputStream
import kotlinx.coroutines.runBlocking
import org.junit.Test

class PrivacyFilterInstrumentedTest {
    @Test
    fun bundledOcrAndPolicyBlockGroupedBankCardOnFinalJpegBytes() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val bitmap = Bitmap.createBitmap(1_200, 600, Bitmap.Config.ARGB_8888)
        val bytes = try {
            val canvas = Canvas(bitmap)
            canvas.drawColor(Color.WHITE)
            val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.BLACK
                textSize = 96f
            }
            canvas.drawText("VISA", 80f, 190f, paint)
            canvas.drawText("6222-0200-0000-0000", 80f, 360f, paint)
            ByteArrayOutputStream().use { output ->
                check(bitmap.compress(Bitmap.CompressFormat.JPEG, 95, output))
                output.toByteArray()
            }
        } finally {
            bitmap.recycle()
        }

        val result = MlKitPrivacyFilter(context.contentResolver).analyzeBytes(bytes, emptySet())

        assertThat(result.sensitiveFlags).contains("bank_card")
    }
}
