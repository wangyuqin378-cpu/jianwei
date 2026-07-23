package cn.jianwei.domain.card

import kotlin.math.roundToInt

const val UNCERTAIN_OBJECT_CONFIDENCE = 0.72
const val HIGH_OBJECT_CONFIDENCE = 0.90

data class CardRecognitionPresentation(
    val visibleLabel: String,
    val compactLabel: String,
    val accessibilityLabel: String
)

fun cardRecognitionPresentation(
    cardTitle: String,
    detectedObjectName: String,
    confidence: Double
): CardRecognitionPresentation {
    val objectName = detectedObjectName.trim().replace(Regex("\\s+"), " ").ifEmpty { "未知物件" }
    val normalizedConfidence = confidence.takeIf(Double::isFinite)?.coerceIn(0.0, 1.0) ?: 0.0
    val confidencePercent = (normalizedConfidence * 100).roundToInt()
    val uncertain = normalizedConfidence < UNCERTAIN_OBJECT_CONFIDENCE
    val titleAlreadyCarriesIdentity =
        uncertain && compact(cardTitle) == compact("这可能是$objectName")

    val visibleLabel = when {
        objectName == "未知物件" -> "识别对象：未知物件"
        uncertain && titleAlreadyCarriesIdentity -> "识别把握较低"
        uncertain -> "可能是 $objectName · 把握较低"
        normalizedConfidence < HIGH_OBJECT_CONFIDENCE -> "识别对象：$objectName · 把握中等"
        else -> "识别对象：$objectName · 把握较高"
    }
    val compactLabel = when {
        objectName == "未知物件" -> "未知物件"
        uncertain && titleAlreadyCarriesIdentity -> "把握较低"
        uncertain -> "可能是 $objectName"
        normalizedConfidence < HIGH_OBJECT_CONFIDENCE -> "$objectName · 中等把握"
        else -> objectName
    }
    val accessibilityLabel = when {
        objectName == "未知物件" -> "识别对象未知，识别置信度 $confidencePercent%"
        uncertain -> "识别对象可能是 $objectName，识别置信度 $confidencePercent%"
        else -> "识别对象是 $objectName，识别置信度 $confidencePercent%"
    }
    return CardRecognitionPresentation(
        visibleLabel = visibleLabel,
        compactLabel = compactLabel,
        accessibilityLabel = accessibilityLabel
    )
}

private fun compact(value: String): String = value.trim().replace(Regex("\\s+"), "")
