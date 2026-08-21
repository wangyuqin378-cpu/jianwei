package cn.jianwei.domain.photo

import cn.jianwei.domain.model.NormalizedBoundingBox
import kotlin.math.roundToInt

data class PixelCropRect(
    val left: Int,
    val top: Int,
    val width: Int,
    val height: Int
)

fun objectAwareCropRect(
    imageWidth: Int,
    imageHeight: Int,
    targetAspectRatio: Double,
    objectBounds: NormalizedBoundingBox?
): PixelCropRect? {
    if (imageWidth <= 0 || imageHeight <= 0 || !targetAspectRatio.isFinite() || targetAspectRatio <= 0.0) {
        return null
    }

    val sourceAspectRatio = imageWidth.toDouble() / imageHeight
    val cropWidth: Int
    val cropHeight: Int
    if (sourceAspectRatio > targetAspectRatio) {
        cropHeight = imageHeight
        cropWidth = (cropHeight * targetAspectRatio).roundToInt().coerceIn(1, imageWidth)
    } else {
        cropWidth = imageWidth
        cropHeight = (cropWidth / targetAspectRatio).roundToInt().coerceIn(1, imageHeight)
    }

    val validBounds = objectBounds?.takeIf(::isValidNormalizedBoundingBox)
    val focusX = validBounds?.let { (it.x + it.width / 2.0) * imageWidth } ?: imageWidth / 2.0
    val focusY = validBounds?.let { (it.y + it.height / 2.0) * imageHeight } ?: imageHeight / 2.0
    val left = (focusX - cropWidth / 2.0).roundToInt().coerceIn(0, imageWidth - cropWidth)
    val top = (focusY - cropHeight / 2.0).roundToInt().coerceIn(0, imageHeight - cropHeight)
    return PixelCropRect(left, top, cropWidth, cropHeight)
}

fun isValidNormalizedBoundingBox(bounds: NormalizedBoundingBox): Boolean =
    bounds.x.isFinite() && bounds.y.isFinite() &&
        bounds.width.isFinite() && bounds.height.isFinite() &&
        bounds.x >= 0.0 && bounds.y >= 0.0 &&
        bounds.width > 0.0 && bounds.height > 0.0 &&
        bounds.x + bounds.width <= 1.0 && bounds.y + bounds.height <= 1.0
