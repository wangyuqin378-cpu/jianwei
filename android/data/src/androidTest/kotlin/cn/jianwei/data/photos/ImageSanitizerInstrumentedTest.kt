package cn.jianwei.data.photos

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.net.Uri
import androidx.exifinterface.media.ExifInterface
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import java.io.ByteArrayInputStream
import java.io.File
import org.junit.Test

class ImageSanitizerInstrumentedTest {
    @Test
    fun reencodes_to_1280_jpeg_and_removes_gps_exif() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val source = File(context.cacheDir, "sanitizer-source.jpg")
        val bitmap = Bitmap.createBitmap(1600, 800, Bitmap.Config.ARGB_8888).apply {
            eraseColor(Color.rgb(40, 120, 80))
        }
        source.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 95, it) }
        bitmap.recycle()
        ExifInterface(source).apply {
            setAttribute(ExifInterface.TAG_GPS_LATITUDE, "31/1,14/1,0/1")
            setAttribute(ExifInterface.TAG_GPS_LATITUDE_REF, "N")
            setAttribute(ExifInterface.TAG_GPS_LONGITUDE, "121/1,28/1,0/1")
            setAttribute(ExifInterface.TAG_GPS_LONGITUDE_REF, "E")
            saveAttributes()
        }

        val sanitized = ImageSanitizer(context.contentResolver).sanitize(Uri.fromFile(source).toString())
        val decoded = BitmapFactory.decodeByteArray(sanitized.bytes, 0, sanitized.bytes.size)
        val exif = ExifInterface(ByteArrayInputStream(sanitized.bytes))

        assertThat(sanitized.contentType).isEqualTo("image/jpeg")
        assertThat(maxOf(decoded.width, decoded.height)).isAtMost(1280)
        assertThat(exif.getAttribute(ExifInterface.TAG_GPS_LATITUDE)).isNull()
        assertThat(exif.getAttribute(ExifInterface.TAG_GPS_LONGITUDE)).isNull()
        JpegMetadataGuard.requireNoEmbeddedMetadata(sanitized.bytes)

        decoded.recycle()
        source.delete()
    }

    @Test
    fun normalizesEveryExifOrientationBeforeRemovingMetadata() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val orientations = listOf(
            ExifInterface.ORIENTATION_NORMAL to listOf(Color.RED, Color.GREEN, Color.BLUE, Color.YELLOW),
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL to listOf(Color.GREEN, Color.RED, Color.YELLOW, Color.BLUE),
            ExifInterface.ORIENTATION_ROTATE_180 to listOf(Color.YELLOW, Color.BLUE, Color.GREEN, Color.RED),
            ExifInterface.ORIENTATION_FLIP_VERTICAL to listOf(Color.BLUE, Color.YELLOW, Color.RED, Color.GREEN),
            ExifInterface.ORIENTATION_TRANSPOSE to listOf(Color.RED, Color.BLUE, Color.GREEN, Color.YELLOW),
            ExifInterface.ORIENTATION_ROTATE_90 to listOf(Color.BLUE, Color.RED, Color.YELLOW, Color.GREEN),
            ExifInterface.ORIENTATION_TRANSVERSE to listOf(Color.YELLOW, Color.GREEN, Color.BLUE, Color.RED),
            ExifInterface.ORIENTATION_ROTATE_270 to listOf(Color.GREEN, Color.YELLOW, Color.RED, Color.BLUE)
        )
        orientations.forEach { (orientation, expectedCorners) ->
            val source = File(context.cacheDir, "orientation-$orientation.jpg")
            try {
                writeQuadrantImage(source)
                ExifInterface(source).apply {
                    setAttribute(ExifInterface.TAG_ORIENTATION, orientation.toString())
                    saveAttributes()
                }

                val sanitized = ImageSanitizer(context.contentResolver).sanitize(Uri.fromFile(source).toString())
                val decoded = BitmapFactory.decodeByteArray(sanitized.bytes, 0, sanitized.bytes.size)
                val swapsDimensions = orientation in setOf(
                    ExifInterface.ORIENTATION_TRANSPOSE,
                    ExifInterface.ORIENTATION_ROTATE_90,
                    ExifInterface.ORIENTATION_TRANSVERSE,
                    ExifInterface.ORIENTATION_ROTATE_270
                )
                assertThat(decoded.width).isEqualTo(if (swapsDimensions) 80 else 120)
                assertThat(decoded.height).isEqualTo(if (swapsDimensions) 120 else 80)
                assertThat(cornerColors(decoded)).containsExactlyElementsIn(expectedCorners).inOrder()
                assertThat(
                    ExifInterface(ByteArrayInputStream(sanitized.bytes)).getAttributeInt(
                        ExifInterface.TAG_ORIENTATION,
                        ExifInterface.ORIENTATION_UNDEFINED
                    )
                ).isEqualTo(ExifInterface.ORIENTATION_UNDEFINED)
                decoded.recycle()
            } finally {
                source.delete()
            }
        }
    }

    private fun writeQuadrantImage(file: File) {
        val bitmap = Bitmap.createBitmap(120, 80, Bitmap.Config.ARGB_8888)
        for (y in 0 until bitmap.height) for (x in 0 until bitmap.width) {
            bitmap.setPixel(
                x,
                y,
                when {
                    x < bitmap.width / 2 && y < bitmap.height / 2 -> Color.RED
                    x >= bitmap.width / 2 && y < bitmap.height / 2 -> Color.GREEN
                    x < bitmap.width / 2 -> Color.BLUE
                    else -> Color.YELLOW
                }
            )
        }
        file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 100, it) }
        bitmap.recycle()
    }

    private fun cornerColors(bitmap: Bitmap): List<Int> = listOf(
        dominantColor(bitmap.getPixel(bitmap.width / 4, bitmap.height / 4)),
        dominantColor(bitmap.getPixel(bitmap.width * 3 / 4, bitmap.height / 4)),
        dominantColor(bitmap.getPixel(bitmap.width / 4, bitmap.height * 3 / 4)),
        dominantColor(bitmap.getPixel(bitmap.width * 3 / 4, bitmap.height * 3 / 4))
    )

    private fun dominantColor(color: Int): Int {
        val red = Color.red(color)
        val green = Color.green(color)
        val blue = Color.blue(color)
        return when {
            red > 180 && green > 180 -> Color.YELLOW
            red >= green && red >= blue -> Color.RED
            green >= red && green >= blue -> Color.GREEN
            else -> Color.BLUE
        }
    }
}
