package cn.jianwei.data.photos

import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import androidx.exifinterface.media.ExifInterface
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import java.io.File
import org.junit.Test

class BoundedThumbnailDecoderInstrumentedTest {
    @Test
    fun boundsAllocationAndAppliesExifWithoutRetainingIntermediates() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val source = File(context.cacheDir, "bounded-thumbnail.jpg")
        val original = Bitmap.createBitmap(1_600, 900, Bitmap.Config.ARGB_8888)
        original.eraseColor(Color.rgb(32, 96, 160))
        source.outputStream().use { output ->
            assertThat(original.compress(Bitmap.CompressFormat.JPEG, 90, output)).isTrue()
        }
        original.recycle()
        ExifInterface(source).apply {
            setAttribute(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_ROTATE_90.toString())
            saveAttributes()
        }

        try {
            repeat(20) {
                val decoded = decodeBoundedThumbnail(context.contentResolver, Uri.fromFile(source), 320)
                assertThat(decoded).isNotNull()
                decoded!!
                assertThat(maxOf(decoded.width, decoded.height)).isAtMost(320)
                assertThat(decoded.width).isLessThan(decoded.height)
                assertThat(decoded.allocationByteCount).isAtMost(320 * 320 * 4)
                decoded.recycle()
            }
        } finally {
            source.delete()
        }
    }

    @Test
    fun corruptInputReturnsNullWithoutAllocatingThumbnail() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val source = File(context.cacheDir, "corrupt-thumbnail.jpg")
        source.writeBytes(byteArrayOf(0x01, 0x02, 0x03, 0x04))
        try {
            assertThat(decodeBoundedThumbnail(context.contentResolver, Uri.fromFile(source), 320)).isNull()
        } finally {
            source.delete()
        }
    }
}
