package cn.jianwei.data.photos

import android.content.ContentResolver
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import androidx.exifinterface.media.ExifInterface
import java.io.ByteArrayInputStream

/**
 * Decodes a UI thumbnail without ever materializing the original-size bitmap.
 * The returned bitmap is EXIF-normalized and its width/height are both bounded
 * by [maximumOutputSide].
 */
fun decodeBoundedThumbnail(
    resolver: ContentResolver,
    uri: Uri,
    maximumOutputSide: Int
): Bitmap? {
    require(maximumOutputSide > 0)
    val orientation = resolver.openInputStream(uri)?.use(::readExifOrientation)
        ?: ExifInterface.ORIENTATION_NORMAL
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    val options = BitmapFactory.Options().apply {
        inSampleSize = thumbnailSampleSizeFor(bounds.outWidth, bounds.outHeight, maximumOutputSide)
        inPreferredConfig = Bitmap.Config.ARGB_8888
    }
    val decoded = resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, options) } ?: return null
    return boundOutputBitmap(applyExifOrientation(decoded, orientation), maximumOutputSide)
}

internal fun decodeOrientedBitmap(
    resolver: ContentResolver,
    uri: Uri,
    maximumDecodeSide: Int
): Bitmap? {
    val orientation = resolver.openInputStream(uri)?.use(::readExifOrientation)
        ?: ExifInterface.ORIENTATION_NORMAL
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    val options = BitmapFactory.Options().apply {
        inSampleSize = sampleSizeFor(bounds.outWidth, bounds.outHeight, maximumDecodeSide)
        inPreferredConfig = Bitmap.Config.ARGB_8888
    }
    val decoded = resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, options) } ?: return null
    return applyExifOrientation(decoded, orientation)
}

internal fun decodeOrientedBitmap(bytes: ByteArray, maximumDecodeSide: Int): Bitmap? {
    val orientation = ByteArrayInputStream(bytes).use(::readExifOrientation)
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    val decoded = BitmapFactory.decodeByteArray(
        bytes,
        0,
        bytes.size,
        BitmapFactory.Options().apply {
            inSampleSize = sampleSizeFor(bounds.outWidth, bounds.outHeight, maximumDecodeSide)
            inPreferredConfig = Bitmap.Config.ARGB_8888
        }
    ) ?: return null
    return applyExifOrientation(decoded, orientation)
}

private fun readExifOrientation(input: java.io.InputStream): Int = runCatching {
    ExifInterface(input).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
}.getOrDefault(ExifInterface.ORIENTATION_NORMAL)

private fun sampleSizeFor(width: Int, height: Int, maximumDecodeSide: Int): Int {
    require(maximumDecodeSide > 0)
    var sample = 1
    while (maxOf(width, height) / sample > maximumDecodeSide * 2) sample *= 2
    return sample
}

internal fun thumbnailSampleSizeFor(width: Int, height: Int, maximumOutputSide: Int): Int {
    require(width > 0 && height > 0)
    require(maximumOutputSide > 0)
    val longest = maxOf(width, height).toLong()
    var sample = 1L
    while ((longest + sample - 1L) / sample > maximumOutputSide.toLong()) {
        sample *= 2L
    }
    return sample.coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
}

private fun boundOutputBitmap(source: Bitmap, maximumOutputSide: Int): Bitmap {
    val longest = maxOf(source.width, source.height)
    if (longest <= maximumOutputSide) return source
    val scale = maximumOutputSide.toDouble() / longest.toDouble()
    val width = (source.width * scale).toInt().coerceAtLeast(1)
    val height = (source.height * scale).toInt().coerceAtLeast(1)
    return runCatching {
        Bitmap.createScaledBitmap(source, width, height, true).also { scaled ->
            if (scaled !== source) source.recycle()
        }
    }.getOrElse {
        if (!source.isRecycled) source.recycle()
        throw it
    }
}

private fun applyExifOrientation(source: Bitmap, orientation: Int): Bitmap {
    val matrix = Matrix()
    when (orientation) {
        ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.setScale(-1f, 1f)
        ExifInterface.ORIENTATION_ROTATE_180 -> matrix.setRotate(180f)
        ExifInterface.ORIENTATION_FLIP_VERTICAL -> {
            matrix.setRotate(180f)
            matrix.postScale(-1f, 1f)
        }
        ExifInterface.ORIENTATION_TRANSPOSE -> {
            matrix.setRotate(90f)
            matrix.postScale(-1f, 1f)
        }
        ExifInterface.ORIENTATION_ROTATE_90 -> matrix.setRotate(90f)
        ExifInterface.ORIENTATION_TRANSVERSE -> {
            matrix.setRotate(-90f)
            matrix.postScale(-1f, 1f)
        }
        ExifInterface.ORIENTATION_ROTATE_270 -> matrix.setRotate(-90f)
        else -> return source
    }
    return runCatching {
        Bitmap.createBitmap(source, 0, 0, source.width, source.height, matrix, true).also { transformed ->
            if (transformed !== source) source.recycle()
        }
    }.getOrElse {
        source.recycle()
        throw it
    }
}
