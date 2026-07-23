package cn.jianwei.data.network

import cn.jianwei.data.photos.ImageSanitizer
import cn.jianwei.data.photos.PrivacyFilter
import cn.jianwei.data.photos.PhotoPermissionGate
import cn.jianwei.data.BuildConfig
import cn.jianwei.data.control.AnalysisSessionGate
import cn.jianwei.data.control.AnalysisSessionToken
import cn.jianwei.domain.model.PhotoCandidate
import cn.jianwei.domain.model.PhotoOrigin
import cn.jianwei.domain.time.ChinaCalendar
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.RequestBody
import okhttp3.MediaType
import okio.BufferedSink
import java.net.URI
import java.io.IOException
import java.security.MessageDigest
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

data class AnalyzedCandidate(val response: CompleteJobResponse, val sanitizedBytes: ByteArray)

class UploadHttpStatusException(val statusCode: Int) : Exception("Candidate upload failed with HTTP $statusCode")

@Singleton
class RemoteAnalysisClient @Inject constructor(
    private val api: JianweiApi,
    private val identity: DeviceIdentity,
    private val http: OkHttpClient,
    private val sanitizer: ImageSanitizer,
    private val privacyFilter: PrivacyFilter,
    private val permissionGate: PhotoPermissionGate,
    private val sessionGate: AnalysisSessionGate
) {
    suspend fun analyze(candidate: PhotoCandidate): AnalyzedCandidate = sessionGate.withActiveSession { session ->
        analyzeInSession(candidate, session) { bearer, request -> api.createJob(bearer, request) }
    }

    internal suspend fun analyzeWithJobCreator(
        candidate: PhotoCandidate,
        createJob: suspend (bearer: String, request: CreateJobRequest) -> CreateJobResponse
    ): AnalyzedCandidate = sessionGate.withActiveSession { session ->
        analyzeInSession(candidate, session, createJob)
    }

    private suspend fun analyzeInSession(
        candidate: PhotoCandidate,
        session: AnalysisSessionToken,
        createJob: suspend (bearer: String, request: CreateJobRequest) -> CreateJobResponse
    ): AnalyzedCandidate {
        requireCurrentAccess(candidate, session)
        require(candidate.sensitiveFlags.isEmpty()) { "敏感候选不得上传" }
        val image = sanitizer.sanitize(candidate.contentUri)
        val sanitizedDigest = payloadDigest(image.bytes)
        requireCurrentAccess(candidate, session)
        val exactUploadAnalysis = privacyFilter.analyzeBytes(image.bytes, emptySet())
        require(payloadMatchesDigest(image.bytes, sanitizedDigest)) { "最终隐私检查改变了待上传字节" }
        require(exactUploadAnalysis.sensitiveFlags.isEmpty() && exactUploadAnalysis.qualityScore >= 0.35) {
            "待上传副本未通过最终隐私检查"
        }
        requireCurrentAccess(candidate, session)
        val response = identity.authenticated(session::requireActive) { bearer ->
            session.requireActive()
            val job = createJob(
                bearer,
                CreateJobRequest(
                    candidateToken = candidate.candidateToken,
                    capturedAtBucket = ChinaCalendar.dateOf(candidate.capturedAt).toString(),
                    localLabels = (candidate.localLabels + exactUploadAnalysis.labels).distinct().take(20),
                    qualityScore = exactUploadAnalysis.qualityScore,
                    sensitiveFlags = emptyList(),
                    contentType = image.contentType,
                    evaluationContext = null
                )
            )
            if (job.status in setOf("completed", "needs_content", "rejected")) {
                return@authenticated CompleteJobResponse(job.jobId, job.status, null)
            }
            if (job.status == "uploaded") {
                requireCurrentAccess(candidate, session)
                return@authenticated api.completeJob(bearer, job.jobId)
            }
            requireCurrentAccess(candidate, session)
            require(payloadMatchesDigest(image.bytes, sanitizedDigest)) { "创建上传请求前字节发生变化" }
            require(isAllowedUploadUrl(job.uploadUrl, BuildConfig.API_BASE_URL)) {
                "服务端返回了不受信任的上传地址"
            }
            val upload = buildUploadRequest(
                uploadUrl = job.uploadUrl,
                contentType = image.contentType,
                bytes = image.bytes,
                apiBaseUrl = BuildConfig.API_BASE_URL,
                bearer = bearer
            ) { requireCurrentAccess(candidate, session) }
            http.newCall(upload).awaitResponse().use { response ->
                requireSuccessfulUploadResponse(response)
            }
            require(payloadMatchesDigest(image.bytes, sanitizedDigest)) { "上传过程中待分析字节发生变化" }
            requireCurrentAccess(candidate, session)
            api.completeJob(bearer, job.jobId)
        }
        return AnalyzedCandidate(response, image.bytes)
    }

    private fun requireCurrentAccess(candidate: PhotoCandidate, session: AnalysisSessionToken) {
        session.requireActive()
        if (candidate.origin == PhotoOrigin.MEDIA_STORE && !permissionGate.canReadMediaStoreItem(candidate.contentUri)) {
            throw SecurityException("MediaStore item permission was revoked before upload")
        }
    }
}

internal fun requireSuccessfulUploadResponse(response: Response) {
    if (response.code == 401) throw AuthenticationExpiredException()
    if (!response.isSuccessful) throw UploadHttpStatusException(response.code)
}

internal fun payloadDigest(bytes: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(bytes)

internal fun payloadMatchesDigest(bytes: ByteArray, expected: ByteArray): Boolean =
    MessageDigest.isEqual(payloadDigest(bytes), expected)

internal fun buildUploadRequest(
    uploadUrl: String,
    contentType: String,
    bytes: ByteArray,
    apiBaseUrl: String,
    bearer: String,
    permissionCheck: () -> Unit
): Request {
    require(isAllowedUploadUrl(uploadUrl, apiBaseUrl)) { "Upload URL must be the API one-time image endpoint" }
    val builder = Request.Builder()
        .url(uploadUrl)
        .header("Content-Type", contentType)
        .header("Authorization", bearer)
        .put(PermissionCheckedRequestBody(bytes, contentType.toMediaType(), permissionCheck))
    return builder.build()
}

internal class PermissionCheckedRequestBody(
    private val bytes: ByteArray,
    private val mediaType: MediaType,
    private val permissionCheck: () -> Unit
) : RequestBody() {
    override fun contentType(): MediaType = mediaType

    override fun contentLength(): Long = bytes.size.toLong()

    override fun writeTo(sink: BufferedSink) {
        var offset = 0
        while (offset < bytes.size) {
            permissionCheck()
            val count = minOf(UPLOAD_PERMISSION_CHUNK_BYTES, bytes.size - offset)
            sink.write(bytes, offset, count)
            offset += count
        }
        permissionCheck()
    }

    private companion object { const val UPLOAD_PERMISSION_CHUNK_BYTES = 64 * 1024 }
}

private suspend fun Call.awaitResponse(): Response = suspendCancellableCoroutine { continuation ->
    continuation.invokeOnCancellation { cancel() }
    enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) {
            if (continuation.isActive) continuation.resumeWithException(e)
        }

        override fun onResponse(call: Call, response: Response) {
            if (continuation.isActive) {
                continuation.resume(response) { _, value, _ -> value.close() }
            } else {
                response.close()
            }
        }
    })
}

internal fun isAllowedUploadUrl(uploadUrl: String, apiBaseUrl: String): Boolean {
    val upload = runCatching { URI(uploadUrl) }.getOrNull() ?: return false
    if (upload.userInfo != null || upload.host.isNullOrBlank() || upload.rawFragment != null) return false
    return sameOrigin(uploadUrl, apiBaseUrl) && isExpectedApiUploadPath(upload, apiBaseUrl)
}

private fun isExpectedApiUploadPath(upload: URI, apiBaseUrl: String): Boolean {
    if (upload.rawQuery != null || upload.rawFragment != null) return false
    val api = runCatching { URI(apiBaseUrl) }.getOrNull() ?: return false
    val basePath = api.path.orEmpty().trimEnd('/')
    val prefix = "$basePath/v1/analysis-jobs/"
    if (!upload.path.startsWith(prefix) || !upload.path.endsWith("/image")) return false
    val jobId = upload.path.removePrefix(prefix).removeSuffix("/image")
    return UUID_PATH.matches(jobId)
}

private fun sameOrigin(first: String, second: String): Boolean {
    val left = runCatching { URI(first) }.getOrNull() ?: return false
    val right = runCatching { URI(second) }.getOrNull() ?: return false
    fun effectivePort(uri: URI): Int = when {
        uri.port >= 0 -> uri.port
        uri.scheme.equals("https", true) -> 443
        else -> 80
    }
    return left.scheme.equals(right.scheme, true) && left.host.equals(right.host, true) && effectivePort(left) == effectivePort(right)
}

private val UUID_PATH = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$")
