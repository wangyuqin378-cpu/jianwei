package cn.jianwei.data.photos

import android.content.ContentResolver
import android.graphics.Bitmap
import android.net.Uri
import java.io.ByteArrayOutputStream
import javax.inject.Inject
import javax.inject.Singleton

data class SanitizedImage(val bytes: ByteArray, val contentType: String)

@Singleton
class ImageSanitizer @Inject constructor(private val resolver: ContentResolver) {
    fun sanitize(uriValue: String, maximumSide: Int = 1280): SanitizedImage {
        val uri = Uri.parse(uriValue)
        val source = decodeOrientedBitmap(resolver, uri, maximumSide) ?: error("无法解码图片")
        val scale = (maximumSide.toDouble() / maxOf(source.width, source.height)).coerceAtMost(1.0)
        var scaled: Bitmap? = null
        try {
            val activeScaled = if (scale < 1.0) {
                Bitmap.createScaledBitmap(source, (source.width * scale).toInt(), (source.height * scale).toInt(), true)
            } else source
            scaled = activeScaled
            val output = ByteArrayOutputStream()
            check(activeScaled.compress(Bitmap.CompressFormat.JPEG, 84, output)) { "无法重新编码图片" }
            // Encoding a fresh bitmap drops source metadata; the guard makes this a runtime invariant.
            val bytes = JpegMetadataStripper.strip(output.toByteArray())
            JpegMetadataGuard.requireNoEmbeddedMetadata(bytes)
            return SanitizedImage(bytes, "image/jpeg")
        } finally {
            scaled?.takeIf { it !== source && !it.isRecycled }?.recycle()
            if (!source.isRecycled) source.recycle()
        }
    }
}
