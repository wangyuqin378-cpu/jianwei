package cn.jianwei.data.photos

import android.content.ContentResolver
import android.graphics.Bitmap
import android.net.Uri
import com.google.android.gms.tasks.Task
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetectorOptions
import com.google.mlkit.vision.label.ImageLabeling
import com.google.mlkit.vision.label.defaults.ImageLabelerOptions
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions
import java.io.ByteArrayOutputStream
import java.text.Normalizer
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine

data class PrivacyAnalysis(
    val perceptualHash: Long,
    val qualityScore: Double,
    val labels: List<String>,
    val sensitiveFlags: Set<String>
)

interface PrivacyFilter {
    suspend fun analyze(uri: String, initialFlags: Set<String>): PrivacyAnalysis
    suspend fun analyzeBytes(bytes: ByteArray, initialFlags: Set<String>): PrivacyAnalysis
}

@Singleton
class MlKitPrivacyFilter @Inject constructor(
    private val resolver: ContentResolver
) : PrivacyFilter {
    private val faceDetector = FaceDetection.getClient(
        FaceDetectorOptions.Builder()
            .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_FAST)
            .setMinFaceSize(0.12f)
            .build()
    )
    private val recognizer = TextRecognition.getClient(ChineseTextRecognizerOptions.Builder().build())
    private val labeler = ImageLabeling.getClient(ImageLabelerOptions.DEFAULT_OPTIONS)

    override suspend fun analyze(uri: String, initialFlags: Set<String>): PrivacyAnalysis {
        val bitmap = decodeOrientedBitmap(resolver, Uri.parse(uri), 640) ?: error("无法解码图片")
        return analyzeBitmap(bitmap, initialFlags)
    }

    override suspend fun analyzeBytes(bytes: ByteArray, initialFlags: Set<String>): PrivacyAnalysis {
        val bitmap = decodeOrientedBitmap(bytes, 640) ?: error("无法解码待上传图片")
        return analyzeBitmap(bitmap, initialFlags)
    }

    private suspend fun analyzeBitmap(bitmap: Bitmap, initialFlags: Set<String>): PrivacyAnalysis {
        var sample: Bitmap? = null
        var hashSample: Bitmap? = null
        try {
            val input = InputImage.fromBitmap(bitmap, 0)
            val faces = faceDetector.process(input).await()
            val text = recognizer.process(input).await()
            val labels = labeler.process(input).await()
                .filter { it.confidence >= 0.65f }
                .sortedByDescending { it.confidence }
                .take(8)
                .map { it.text }

            val flags = initialFlags.toMutableSet()
            flags += sensitiveFlagsFromSignals(
                faceDetected = faces.isNotEmpty(),
                recognizedText = text.text,
                textBlockCount = text.textBlocks.size,
                labels = labels
            )

            val qualityBitmap = Bitmap.createScaledBitmap(bitmap, 64, 64, true)
            sample = qualityBitmap
            val quality = qualityScore(qualityBitmap)
            val hashBitmap = Bitmap.createScaledBitmap(qualityBitmap, 8, 8, true)
            hashSample = hashBitmap
            val hash = averageHash(hashBitmap)
            if (quality < 0.35) flags += "blurred"
            return PrivacyAnalysis(hash, quality, labels, flags)
        } finally {
            hashSample?.takeIf { it !== sample && it !== bitmap && !it.isRecycled }?.recycle()
            sample?.takeIf { it !== bitmap && !it.isRecycled }?.recycle()
            if (!bitmap.isRecycled) bitmap.recycle()
        }
    }

    private fun qualityScore(bitmap: Bitmap): Double {
        var edges = 0.0
        var luminanceVariance = 0.0
        var mean = 0.0
        val count = bitmap.width * bitmap.height
        for (y in 0 until bitmap.height) for (x in 0 until bitmap.width) mean += luminance(bitmap.getPixel(x, y))
        mean /= count.coerceAtLeast(1)
        for (y in 0 until bitmap.height) {
            for (x in 0 until bitmap.width) {
                val value = luminance(bitmap.getPixel(x, y))
                luminanceVariance += (value - mean) * (value - mean)
                if (x > 0) edges += kotlin.math.abs(value - luminance(bitmap.getPixel(x - 1, y)))
                if (y > 0) edges += kotlin.math.abs(value - luminance(bitmap.getPixel(x, y - 1)))
            }
        }
        val edgeScore = (edges / (count * 55.0)).coerceIn(0.0, 1.0)
        val contrastScore = kotlin.math.sqrt(luminanceVariance / count.coerceAtLeast(1)) / 64.0
        return (edgeScore * 0.7 + contrastScore.coerceIn(0.0, 1.0) * 0.3).coerceIn(0.0, 1.0)
    }

    private fun averageHash(bitmap: Bitmap): Long {
        val values = IntArray(64) { index -> luminance(bitmap.getPixel(index % 8, index / 8)).toInt() }
        val mean = values.average()
        var hash = 0L
        values.forEachIndexed { index, value -> if (value >= mean) hash = hash or (1L shl index) }
        return hash
    }

    private fun luminance(pixel: Int): Double {
        val red = pixel shr 16 and 0xff
        val green = pixel shr 8 and 0xff
        val blue = pixel and 0xff
        return red * 0.2126 + green * 0.7152 + blue * 0.0722
    }
}

internal fun sensitiveFlagsFromSignals(
    faceDetected: Boolean,
    recognizedText: String,
    textBlockCount: Int,
    labels: Collection<String>
): Set<String> {
    val normalizedText = Normalizer.normalize(recognizedText, Normalizer.Form.NFKC)
    val characterCount = normalizedText.count { !it.isWhitespace() }
    val compactText = normalizedText.filterNot(Char::isWhitespace)
    val identifierText = compactText.filterNot(::isIdentifierSeparator)
    val flags = mutableSetOf<String>()

    if (faceDetected) flags += "face"
    if (characterCount >= 80 || textBlockCount >= 10) flags += "high_text_density"
    if (characterCount >= 160) flags += "document"

    val identityMarkerCount = IDENTITY_MARKERS.count { compactText.contains(it, ignoreCase = true) }
    if (IDENTITY_NUMBER.containsMatchIn(identifierText) ||
        IDENTITY_EXPLICIT_MARKERS.any { compactText.contains(it, ignoreCase = true) } ||
        identityMarkerCount >= 3
    ) {
        flags += "id_card"
    }

    val bankMarker = BANK_MARKERS.any { compactText.contains(it, ignoreCase = true) }
    val bankNumber = BANK_ACCOUNT_NUMBER.containsMatchIn(identifierText)
    if ((bankMarker && bankNumber) || GROUPED_BANK_CARD_NUMBER.containsMatchIn(normalizedText)) {
        flags += "bank_card"
    }

    if (RECEIPT_MARKERS.any { compactText.contains(it, ignoreCase = true) }) flags += "receipt"
    if (labels.any { it.equals("Person", true) || it.equals("Selfie", true) }) flags += "person"
    return flags
}

private fun isIdentifierSeparator(character: Char): Boolean = character in IDENTIFIER_SEPARATORS

private val IDENTITY_NUMBER = Regex("(?<!\\d)\\d{17}[0-9Xx](?!\\d)")
private val BANK_ACCOUNT_NUMBER = Regex("(?<!\\d)\\d{13,19}(?!\\d)")
private val GROUPED_BANK_CARD_NUMBER = Regex(
    "(?<!\\d)\\d{4}[\\s\\-－‐‑‒–—―·•・]+\\d{4}[\\s\\-－‐‑‒–—―·•・]+" +
        "\\d{4}[\\s\\-－‐‑‒–—―·•・]+\\d{4}(?!\\d)"
)
private val IDENTIFIER_SEPARATORS = "-－‐‑‒–—―·•・".toSet()
private val IDENTITY_EXPLICIT_MARKERS = listOf("居民身份证", "公民身份号码", "身份证号")
private val IDENTITY_MARKERS = listOf("姓名", "性别", "民族", "出生", "住址", "公民身份号码", "签发机关", "有效期限")
private val BANK_MARKERS = listOf(
    "银联", "银行卡", "信用卡", "银行", "DEBIT", "CREDIT", "VISA", "MASTERCARD", "MASTER CARD",
    "AMERICAN EXPRESS", "AMEX"
)
private val RECEIPT_MARKERS = listOf("发票", "收据", "小票", "invoice", "receipt")

private suspend fun <T> Task<T>.await(): T = suspendCancellableCoroutine { continuation ->
    addOnSuccessListener { if (continuation.isActive) continuation.resume(it) }
    addOnFailureListener { if (continuation.isActive) continuation.resumeWithException(it) }
}
