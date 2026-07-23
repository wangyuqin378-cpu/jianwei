package cn.jianwei.app.evaluation

import android.content.Context
import android.os.Build
import cn.jianwei.data.BuildConfig as DataBuildConfig
import java.io.File
import java.net.URI
import java.security.MessageDigest
import java.time.Instant
import java.util.Locale
import org.json.JSONArray
import org.json.JSONObject

internal data class EvaluationManifest(
    val datasetId: String,
    val runId: String,
    val labelsSha256: String,
    val resultEvidenceRef: String,
    val appVersion: String,
    val evaluationApkSha256: String,
    val modelVersion: String,
    val catalogVersion: String,
    val createdAt: String
)

internal data class EvaluationLease(
    val leaseId: String,
    val datasetId: String,
    val runId: String,
    val labelsSha256: String,
    val maxJobs: Int,
    val createdAt: String,
    val expiresAt: String,
    val leaseToken: String
)

internal data class EvaluationSampleInput(
    val sampleId: String,
    val sampleSha256: String,
    val relativePath: String,
    val size: Long,
    val lastModified: Long
)

internal data class PreparedEvaluation(
    val directory: File,
    val manifest: EvaluationManifest,
    val manifestSha256: String,
    val samples: List<EvaluationSampleInput>,
    val preparedAt: String
)

internal data class EvaluationApproval(
    val runId: String,
    val labelsSha256: String,
    val manifestSha256: String,
    val reviewerId: String,
    val approvedAt: String
)

internal data class EvaluationSampleResult(
    val sampleId: String,
    val sampleSha256: String,
    val pipelineCompleted: Boolean,
    val leftDevice: Boolean,
    val predictedTopicId: String?
)

internal data class EvaluationProgress(
    val runId: String,
    val labelsSha256: String,
    val manifestSha256: String,
    val startedAt: String,
    val results: List<EvaluationSampleResult>
)

internal data class LoadedEvaluation(
    val prepared: PreparedEvaluation,
    val approval: EvaluationApproval,
    val progress: EvaluationProgress,
    val lease: EvaluationLease
)

internal object EvaluationArtifacts {
    private const val ROOT_DIRECTORY = "authorized-evaluation"
    private const val LABELS_FILE = "image-labels.json"
    private const val MANIFEST_FILE = "image-evaluation-run.json"
    private const val LEASE_FILE = "image-evaluation-lease.json"
    private const val IMAGES_DIRECTORY = "images"
    private const val RESULT_FILE = "image-results.json"
    private const val MAX_LABEL_BYTES = 4L * 1024 * 1024
    private const val MAX_MANIFEST_BYTES = 64L * 1024
    private const val MAX_IMAGE_BYTES = 25L * 1024 * 1024
    private const val MAX_TOTAL_IMAGE_BYTES = 5L * 1024 * 1024 * 1024
    private val token = Regex("^[A-Za-z0-9._-]{3,128}$")
    private val digest = Regex("^[a-f0-9]{64}$")
    private val automation = Regex("(?:codex|chatgpt|gpt|kimi|moonshot|qwen|claude|gemini|llama|automation|robot)", RegexOption.IGNORE_CASE)
    private val imageExtensions = setOf("jpg", "jpeg", "png", "webp", "heic", "heif")
    private val sensitiveTypes = setOf(
        "face", "selfie", "identity_document", "bank_card", "receipt", "document",
        "high_text_density", "screenshot"
    )

    fun prepare(context: Context, runId: String): PreparedEvaluation {
        require(token.matches(runId)) { "评测运行 ID 无效" }
        val directory = controlledRunDirectory(context, runId)
        val labelsFile = File(directory, LABELS_FILE).ordinaryFile(MAX_LABEL_BYTES)
        val manifestFile = File(directory, MANIFEST_FILE).ordinaryFile(MAX_MANIFEST_BYTES)
        val leaseFile = File(directory, LEASE_FILE).ordinaryFile(MAX_MANIFEST_BYTES)
        val labelsBytes = labelsFile.readBytes()
        val manifestBytes = manifestFile.readBytes()
        val leaseBytes = leaseFile.readBytes()
        val labels = parseLabels(labelsBytes)
        val manifest = parseManifest(manifestBytes)
        val lease = parseLease(leaseBytes)
        require(lease.datasetId == manifest.datasetId && lease.runId == manifest.runId &&
            lease.labelsSha256 == manifest.labelsSha256 && lease.maxJobs == labels.samples.size) {
            "Evaluation lease does not bind the current authorized run"
        }
        require(strictFutureInstant(lease.expiresAt) != null) { "Evaluation lease has expired" }
        require(manifest.runId == runId && manifest.datasetId == labels.datasetId) { "运行清单与标签集不匹配" }
        require(manifest.labelsSha256 == sha256(labelsBytes)) { "运行清单没有绑定当前标签文件" }
        require(manifest.appVersion == installedVersion(context)) { "运行清单 App 版本与已安装 APK 不一致" }
        require(strictPastInstant(manifest.createdAt) != null) { "运行清单时间无效" }
        require(manifest.evaluationApkSha256 == installedApkSha256(context)) { "Evaluation manifest APK SHA-256 does not match the installed binary" }
        requireProductionEndpoint(DataBuildConfig.API_BASE_URL)
        require(!emulatorFingerprint(Build.FINGERPRINT)) { "授权图片评测必须在物理 Android 设备上运行" }

        val images = File(directory, IMAGES_DIRECTORY)
        require(images.isDirectory && !java.nio.file.Files.isSymbolicLink(images.toPath())) { "评测图片目录不存在或不是普通目录" }
        val candidates = images.walkTopDown()
            .filter { it.isFile && !java.nio.file.Files.isSymbolicLink(it.toPath()) && it.extension.lowercase(Locale.ROOT) in imageExtensions }
            .toList()
        require(candidates.size == labels.samples.size) { "图片数量必须与 300–500 条标签一一对应" }
        var totalBytes = 0L
        val byDigest = linkedMapOf<String, File>()
        for (file in candidates) {
            require(file.length() in 1..MAX_IMAGE_BYTES) { "存在空文件或超过 25 MiB 的评测图片" }
            totalBytes = Math.addExact(totalBytes, file.length())
            require(totalBytes <= MAX_TOTAL_IMAGE_BYTES) { "评测图片总量超过 5 GiB" }
            val value = file.inputStream().use(::sha256)
            require(byDigest.put(value, file) == null) { "评测目录包含重复图片字节" }
        }
        val samples = labels.samples.map { label ->
            val file = byDigest.remove(label.sampleSha256) ?: error("标签 SHA-256 在图片目录中没有唯一匹配")
            val relative = images.toPath().relativize(file.toPath()).toString().replace('\\', '/')
            require(!relative.startsWith("../") && !relative.contains("/../")) { "评测图片路径越界" }
            EvaluationSampleInput(label.sampleId, label.sampleSha256, relative, file.length(), file.lastModified())
        }
        require(byDigest.isEmpty()) { "图片目录包含标签集之外的图片" }
        val prepared = PreparedEvaluation(
            directory = directory,
            manifest = manifest,
            manifestSha256 = sha256(manifestBytes),
            samples = samples,
            preparedAt = Instant.now().toString()
        )
        writePrivate(context, indexFile(context, runId), prepared.toJson().toString(2))
        return prepared
    }

    fun approve(context: Context, prepared: PreparedEvaluation, reviewerId: String): EvaluationApproval {
        require(validHumanId(reviewerId)) { "请输入可追责的真人审核身份，不能使用 AI 或 bot 身份" }
        val approval = EvaluationApproval(
            runId = prepared.manifest.runId,
            labelsSha256 = prepared.manifest.labelsSha256,
            manifestSha256 = prepared.manifestSha256,
            reviewerId = reviewerId,
            approvedAt = Instant.now().toString()
        )
        writePrivate(context, approvalFile(context, prepared.manifest.runId), approval.toJson().toString(2))
        return approval
    }

    fun loadPrepared(context: Context, runId: String): LoadedEvaluation {
        val prepared = parsePrepared(JSONObject(indexFile(context, runId).ordinaryFile(8L * 1024 * 1024).readText()))
        val approval = parseApproval(JSONObject(approvalFile(context, runId).ordinaryFile(64L * 1024).readText()))
        require(prepared.manifest.runId == runId && approval.runId == runId) { "评测私有索引与运行 ID 不一致" }
        val currentDirectory = controlledRunDirectory(context, runId)
        require(prepared.directory.canonicalFile == currentDirectory.canonicalFile) { "评测目录绑定已失效" }
        val labelsBytes = File(currentDirectory, LABELS_FILE).ordinaryFile(MAX_LABEL_BYTES).readBytes()
        val manifestBytes = File(currentDirectory, MANIFEST_FILE).ordinaryFile(MAX_MANIFEST_BYTES).readBytes()
        val leaseBytes = File(currentDirectory, LEASE_FILE).ordinaryFile(MAX_MANIFEST_BYTES).readBytes()
        val lease = parseLease(leaseBytes)
        require(sha256(labelsBytes) == prepared.manifest.labelsSha256 && sha256(manifestBytes) == prepared.manifestSha256) {
            "标签或运行清单在真人确认后发生变化"
        }
        require(approval.labelsSha256 == prepared.manifest.labelsSha256 && approval.manifestSha256 == prepared.manifestSha256) {
            "真人确认没有绑定当前输入"
        }
        require(validHumanId(approval.reviewerId) && strictPastInstant(approval.approvedAt) != null) { "真人确认记录无效" }
        require(prepared.manifest.appVersion == installedVersion(context)) { "已安装 APK 版本已改变" }
        requireProductionEndpoint(DataBuildConfig.API_BASE_URL)
        require(lease.datasetId == prepared.manifest.datasetId && lease.runId == prepared.manifest.runId &&
            lease.labelsSha256 == prepared.manifest.labelsSha256 && lease.maxJobs == prepared.samples.size &&
            strictFutureInstant(lease.expiresAt) != null) { "Evaluation lease does not bind this run or has expired" }
        val progressFile = progressFile(context, runId)
        val progress = if (progressFile.exists()) parseProgress(JSONObject(progressFile.readText())) else EvaluationProgress(
            runId = runId,
            labelsSha256 = prepared.manifest.labelsSha256,
            manifestSha256 = prepared.manifestSha256,
            startedAt = Instant.now().toString(),
            results = emptyList()
        )
        require(progress.runId == runId && progress.labelsSha256 == prepared.manifest.labelsSha256 &&
            progress.manifestSha256 == prepared.manifestSha256) { "评测进度与当前输入不一致" }
        return LoadedEvaluation(prepared, approval, progress, lease)
    }

    fun verifySampleFile(prepared: PreparedEvaluation, sample: EvaluationSampleInput): File {
        val images = File(prepared.directory, IMAGES_DIRECTORY).canonicalFile
        val file = File(images, sample.relativePath).canonicalFile
        require(file.parentFile != null && file.toPath().startsWith(images.toPath())) { "评测图片路径越界" }
        require(file.isFile && !java.nio.file.Files.isSymbolicLink(file.toPath())) { "评测图片已丢失或被链接替换" }
        require(file.length() == sample.size && file.lastModified() == sample.lastModified) { "评测图片元数据在预检后发生变化" }
        require(file.inputStream().use(::sha256) == sample.sampleSha256) { "评测图片字节在预检后发生变化" }
        return file
    }

    fun saveProgress(context: Context, progress: EvaluationProgress) {
        writePrivate(context, progressFile(context, progress.runId), progress.toJson().toString(2))
    }

    fun ensureFinalResult(
        context: Context,
        prepared: PreparedEvaluation,
        approval: EvaluationApproval,
        progress: EvaluationProgress
    ) {
        require(progress.results.size == prepared.samples.size) { "评测尚未完成全部样本" }
        val resultById = progress.results.associateBy { it.sampleId }
        require(resultById.size == prepared.samples.size && prepared.samples.all { resultById[it.sampleId]?.sampleSha256 == it.sampleSha256 }) {
            "评测结果与预检样本不一致"
        }
        val output = File(prepared.directory, RESULT_FILE)
        verifyCompleteInputSet(prepared)
        if (output.exists()) {
            require(existingFinalMatches(output, prepared, approval, progress)) { "现有结果文件与当前运行不一致" }
            return
        }
        val endpoint = endpointOrigin(DataBuildConfig.API_BASE_URL)
        val json = JSONObject()
            .put("schemaVersion", 1)
            .put("evidenceKind", "image_pipeline_results")
            .put("datasetId", prepared.manifest.datasetId)
            .put("runId", prepared.manifest.runId)
            .put("evidenceRef", prepared.manifest.resultEvidenceRef)
            .put("appVersion", prepared.manifest.appVersion)
            .put("evaluationApkSha256", prepared.manifest.evaluationApkSha256)
            .put("modelVersion", prepared.manifest.modelVersion)
            .put("catalogVersion", prepared.manifest.catalogVersion)
            .put("evaluatedAt", Instant.now().toString())
            .put("runnerProvenance", JSONObject()
                .put("evidenceKind", "android_authorized_image_runner")
                .put("reviewerId", approval.reviewerId)
                .put("approvedAt", approval.approvedAt)
                .put("appVersion", prepared.manifest.appVersion)
                .put("evaluationApkSha256", prepared.manifest.evaluationApkSha256)
                .put("manufacturer", Build.MANUFACTURER)
                .put("model", Build.MODEL)
                .put("buildFingerprint", Build.FINGERPRINT)
                .put("apiLevel", Build.VERSION.SDK_INT)
                .put("endpointOrigin", endpoint))
            .put("samples", JSONArray(prepared.samples.map { resultById.getValue(it.sampleId).toJson() }))
        writeExclusive(output, json.toString(2))
    }

    fun progressSnapshot(context: Context, runId: String): Pair<Int, Int>? = runCatching {
        val prepared = parsePrepared(JSONObject(indexFile(context, runId).readText()))
        val completed = progressFile(context, runId).takeIf(File::exists)?.let { parseProgress(JSONObject(it.readText())).results.size } ?: 0
        completed to prepared.samples.size
    }.getOrNull()

    private data class ParsedLabels(val datasetId: String, val samples: List<LabelIdentity>)
    private data class LabelIdentity(val sampleId: String, val sampleSha256: String)

    private fun parseLabels(bytes: ByteArray): ParsedLabels {
        val root = JSONObject(bytes.toString(Charsets.UTF_8))
        root.requireKeys(setOf("schemaVersion", "evidenceKind", "datasetId", "evidenceOwner", "evidenceRef", "labeledAt", "samples"), "标签文件")
        require(root.getInt("schemaVersion") == 1 && root.getString("evidenceKind") == "authorized_image_labels") { "标签文件 schema 无效" }
        val datasetId = root.getString("datasetId").also { require(token.matches(it)) }
        require(validHumanId(root.getString("evidenceOwner"))) { "标签负责人必须是真人" }
        require(root.getString("evidenceRef").length in 1..500 && strictPastInstant(root.getString("labeledAt")) != null)
        val rows = root.getJSONArray("samples")
        require(rows.length() in 300..500) { "标签必须包含 300–500 条样本" }
        val ids = mutableSetOf<String>()
        val digests = mutableSetOf<String>()
        val samples = (0 until rows.length()).map { index ->
            val row = rows.getJSONObject(index)
            row.requireKeys(setOf(
                "sampleId", "sampleSha256", "authorized", "authorizationRef", "authorizationScope",
                "authorizedAt", "expectedSensitiveTypes", "expectedTopicId"
            ), "标签样本")
            val id = row.getString("sampleId")
            val sha = row.getString("sampleSha256")
            require(token.matches(id) && ids.add(id) && digest.matches(sha) && digests.add(sha)) { "标签样本身份无效或重复" }
            require(row.getBoolean("authorized") && row.getString("authorizationScope") == "local_and_cloud_evaluation") {
                "每张图片必须明确授权端侧和云端完整评测"
            }
            require(row.getString("authorizationRef").length in 1..500 && strictPastInstant(row.getString("authorizedAt")) != null)
            val sensitive = row.getJSONArray("expectedSensitiveTypes")
            val values = (0 until sensitive.length()).map(sensitive::getString)
            require(values.toSet().size == values.size && values.all(sensitiveTypes::contains)) { "敏感标签无效" }
            if (values.isEmpty()) require(!row.isNull("expectedTopicId") && token.matches(row.getString("expectedTopicId")))
            else require(row.isNull("expectedTopicId"))
            LabelIdentity(id, sha)
        }
        return ParsedLabels(datasetId, samples)
    }

    private fun parseManifest(bytes: ByteArray): EvaluationManifest {
        val root = JSONObject(bytes.toString(Charsets.UTF_8))
        root.requireKeys(setOf(
            "schemaVersion", "evidenceKind", "datasetId", "runId", "labelsSha256", "resultEvidenceRef",
            "appVersion", "evaluationApkSha256", "modelVersion", "catalogVersion", "createdAt"
        ), "运行清单")
        require(root.getInt("schemaVersion") == 1 && root.getString("evidenceKind") == "authorized_image_pipeline_run")
        return EvaluationManifest(
            datasetId = root.getString("datasetId").also { require(token.matches(it)) },
            runId = root.getString("runId").also { require(token.matches(it)) },
            labelsSha256 = root.getString("labelsSha256").also { require(digest.matches(it)) },
            resultEvidenceRef = root.getString("resultEvidenceRef").also { require(it.length in 1..500) },
            appVersion = root.getString("appVersion").also { require(it.length in 1..100) },
            evaluationApkSha256 = root.getString("evaluationApkSha256").also { require(digest.matches(it)) },
            modelVersion = root.getString("modelVersion").also { require(it.length in 1..200) },
            catalogVersion = root.getString("catalogVersion").also { require(token.matches(it)) },
            createdAt = root.getString("createdAt").also { require(strictPastInstant(it) != null) }
        )
    }

    private fun parseLease(bytes: ByteArray): EvaluationLease {
        val root = JSONObject(bytes.toString(Charsets.UTF_8))
        root.requireKeys(setOf(
            "schemaVersion", "evidenceKind", "leaseId", "datasetId", "runId", "labelsSha256",
            "maxJobs", "createdAt", "expiresAt", "leaseToken"
        ), "Evaluation lease")
        require(root.getInt("schemaVersion") == 1 && root.getString("evidenceKind") == "authorized_image_evaluation_lease")
        val lease = EvaluationLease(
            leaseId = root.getString("leaseId"), datasetId = root.getString("datasetId"),
            runId = root.getString("runId"), labelsSha256 = root.getString("labelsSha256"),
            maxJobs = root.getInt("maxJobs"), createdAt = root.getString("createdAt"),
            expiresAt = root.getString("expiresAt"), leaseToken = root.getString("leaseToken")
        )
        require(Regex("^[0-9a-fA-F-]{36}$").matches(lease.leaseId) && token.matches(lease.datasetId) &&
            token.matches(lease.runId) && digest.matches(lease.labelsSha256) && lease.maxJobs in 300..500 &&
            strictPastInstant(lease.createdAt) != null && strictFutureInstant(lease.expiresAt) != null &&
            Regex("^[A-Za-z0-9_-]{43}$").matches(lease.leaseToken)) { "Evaluation lease is invalid" }
        return lease
    }

    private fun parsePrepared(root: JSONObject): PreparedEvaluation {
        root.requireKeys(setOf("schemaVersion", "evidenceKind", "directory", "manifest", "manifestSha256", "preparedAt", "samples"), "私有预检索引")
        require(root.getInt("schemaVersion") == 1 && root.getString("evidenceKind") == "private_authorized_image_index")
        val manifest = parseManifest(root.getJSONObject("manifest").toString().toByteArray())
        val rows = root.getJSONArray("samples")
        val samples = (0 until rows.length()).map { index ->
            val row = rows.getJSONObject(index)
            row.requireKeys(setOf("sampleId", "sampleSha256", "relativePath", "size", "lastModified"), "私有预检样本")
            val sample = EvaluationSampleInput(
                row.getString("sampleId"), row.getString("sampleSha256"), row.getString("relativePath"),
                row.getLong("size"), row.getLong("lastModified")
            )
            require(token.matches(sample.sampleId) && digest.matches(sample.sampleSha256) &&
                sample.relativePath.isNotBlank() && !sample.relativePath.startsWith("/") &&
                !sample.relativePath.startsWith("../") && !sample.relativePath.contains("/../") &&
                sample.size in 1..MAX_IMAGE_BYTES && sample.lastModified >= 0L) { "私有预检样本无效" }
            sample
        }
        require(samples.size in 300..500 && samples.map { it.sampleId }.toSet().size == samples.size &&
            samples.map { it.sampleSha256 }.toSet().size == samples.size) { "私有预检索引样本无效或重复" }
        return PreparedEvaluation(
            directory = File(root.getString("directory")),
            manifest = manifest,
            manifestSha256 = root.getString("manifestSha256"),
            samples = samples,
            preparedAt = root.getString("preparedAt")
        )
    }

    private fun parseApproval(root: JSONObject): EvaluationApproval {
        root.requireKeys(setOf("schemaVersion", "evidenceKind", "runId", "labelsSha256", "manifestSha256", "reviewerId", "approvedAt"), "真人确认")
        require(root.getInt("schemaVersion") == 1 && root.getString("evidenceKind") == "human_authorized_image_run_approval")
        return EvaluationApproval(
            root.getString("runId"), root.getString("labelsSha256"), root.getString("manifestSha256"),
            root.getString("reviewerId"), root.getString("approvedAt")
        )
    }

    private fun parseProgress(root: JSONObject): EvaluationProgress {
        root.requireKeys(setOf("schemaVersion", "evidenceKind", "runId", "labelsSha256", "manifestSha256", "startedAt", "samples"), "评测进度")
        require(root.getInt("schemaVersion") == 1 && root.getString("evidenceKind") == "private_image_pipeline_progress")
        val rows = root.getJSONArray("samples")
        val results = (0 until rows.length()).map { index ->
            val row = rows.getJSONObject(index)
            row.requireKeys(setOf("sampleId", "sampleSha256", "pipelineCompleted", "leftDevice", "predictedTopicId"), "评测结果")
            val result = EvaluationSampleResult(
                row.getString("sampleId"), row.getString("sampleSha256"), row.getBoolean("pipelineCompleted"),
                row.getBoolean("leftDevice"), row.optString("predictedTopicId").takeIf { !row.isNull("predictedTopicId") }
            )
            require(token.matches(result.sampleId) && digest.matches(result.sampleSha256) && result.pipelineCompleted &&
                (result.predictedTopicId == null || token.matches(result.predictedTopicId))) { "评测进度结果无效" }
            result
        }
        require(results.map { it.sampleId }.toSet().size == results.size) { "评测进度包含重复样本" }
        return EvaluationProgress(
            root.getString("runId"), root.getString("labelsSha256"), root.getString("manifestSha256"),
            root.getString("startedAt"), results
        )
    }

    private fun PreparedEvaluation.toJson() = JSONObject()
        .put("schemaVersion", 1)
        .put("evidenceKind", "private_authorized_image_index")
        .put("directory", directory.absolutePath)
        .put("manifest", manifest.toJson())
        .put("manifestSha256", manifestSha256)
        .put("preparedAt", preparedAt)
        .put("samples", JSONArray(samples.map { it.toJson() }))

    private fun EvaluationManifest.toJson() = JSONObject()
        .put("schemaVersion", 1)
        .put("evidenceKind", "authorized_image_pipeline_run")
        .put("datasetId", datasetId)
        .put("runId", runId)
        .put("labelsSha256", labelsSha256)
        .put("resultEvidenceRef", resultEvidenceRef)
        .put("appVersion", appVersion)
        .put("evaluationApkSha256", evaluationApkSha256)
        .put("modelVersion", modelVersion)
        .put("catalogVersion", catalogVersion)
        .put("createdAt", createdAt)

    private fun EvaluationSampleInput.toJson() = JSONObject()
        .put("sampleId", sampleId).put("sampleSha256", sampleSha256).put("relativePath", relativePath)
        .put("size", size).put("lastModified", lastModified)

    private fun EvaluationApproval.toJson() = JSONObject()
        .put("schemaVersion", 1).put("evidenceKind", "human_authorized_image_run_approval")
        .put("runId", runId).put("labelsSha256", labelsSha256).put("manifestSha256", manifestSha256)
        .put("reviewerId", reviewerId).put("approvedAt", approvedAt)

    private fun EvaluationProgress.toJson() = JSONObject()
        .put("schemaVersion", 1).put("evidenceKind", "private_image_pipeline_progress")
        .put("runId", runId).put("labelsSha256", labelsSha256).put("manifestSha256", manifestSha256)
        .put("startedAt", startedAt).put("samples", JSONArray(results.map { it.toJson() }))

    private fun EvaluationSampleResult.toJson() = JSONObject()
        .put("sampleId", sampleId).put("sampleSha256", sampleSha256)
        .put("pipelineCompleted", pipelineCompleted).put("leftDevice", leftDevice)
        .put("predictedTopicId", predictedTopicId ?: JSONObject.NULL)

    private fun controlledRunDirectory(context: Context, runId: String): File {
        val root = context.getExternalFilesDir(ROOT_DIRECTORY)?.canonicalFile ?: error("设备外部私有目录不可用")
        val directory = File(root, runId).canonicalFile
        require(directory.parentFile == root && directory.isDirectory && !java.nio.file.Files.isSymbolicLink(directory.toPath())) {
            "评测运行目录不存在、越界或是链接"
        }
        return directory
    }

    private fun privateRoot(context: Context): File = File(context.filesDir, ROOT_DIRECTORY).apply {
        require(mkdirs() || isDirectory)
        require(!java.nio.file.Files.isSymbolicLink(toPath()))
    }

    private fun indexFile(context: Context, runId: String) = File(privateRoot(context), "$runId.index.json")
    private fun approvalFile(context: Context, runId: String) = File(privateRoot(context), "$runId.approval.json")
    private fun progressFile(context: Context, runId: String) = File(privateRoot(context), "$runId.progress.json")

    private fun File.ordinaryFile(maximumBytes: Long): File {
        require(isFile && !java.nio.file.Files.isSymbolicLink(toPath()) && length() in 1..maximumBytes) { "受控评测文件缺失、链接或大小异常" }
        return this
    }

    private fun writePrivate(context: Context, target: File, content: String) {
        require(target.parentFile?.canonicalFile == privateRoot(context).canonicalFile)
        writeReplace(target, content)
    }

    private fun writeReplace(target: File, content: String) {
        val temporary = File(target.parentFile, ".${target.name}.${System.nanoTime()}.tmp")
        try {
            temporary.outputStream().bufferedWriter(Charsets.UTF_8).use { it.append(content).append('\n') }
            try {
                java.nio.file.Files.move(
                    temporary.toPath(), target.toPath(),
                    java.nio.file.StandardCopyOption.REPLACE_EXISTING,
                    java.nio.file.StandardCopyOption.ATOMIC_MOVE
                )
            } catch (_: java.nio.file.AtomicMoveNotSupportedException) {
                java.nio.file.Files.move(
                    temporary.toPath(), target.toPath(),
                    java.nio.file.StandardCopyOption.REPLACE_EXISTING
                )
            }
        } finally {
            temporary.delete()
        }
    }

    private fun writeExclusive(target: File, content: String) {
        require(target.createNewFile()) { "结果文件已存在" }
        try {
            target.outputStream().bufferedWriter(Charsets.UTF_8).use { it.append(content).append('\n') }
        } catch (error: Exception) {
            target.delete()
            throw error
        }
    }

    private fun installedVersion(context: Context): String = runCatching {
        @Suppress("DEPRECATION")
        context.packageManager.getPackageInfo(context.packageName, 0).versionName
    }.getOrNull() ?: error("无法读取已安装 App 版本")

    private fun installedApkSha256(context: Context): String = File(context.applicationInfo.sourceDir)
        .inputStream().buffered().use(::sha256)

    private fun strictPastInstant(value: String): Instant? = runCatching { Instant.parse(value) }.getOrNull()?.takeIf { !it.isAfter(Instant.now()) }

    private fun strictFutureInstant(value: String): Instant? = runCatching { Instant.parse(value) }.getOrNull()?.takeIf { it.isAfter(Instant.now()) }

    private fun validHumanId(value: String): Boolean = value.length in 1..128 && value == value.trim() &&
        Regex("^[\\p{L}\\p{N}._@-]+$").matches(value) && !automation.containsMatchIn(value) &&
        !Regex("(?:^|[._@-])(?:ai|bot)(?:$|[._@-])", RegexOption.IGNORE_CASE).containsMatchIn(value)

    private fun requireProductionEndpoint(value: String) {
        endpointOrigin(value)
    }

    private fun endpointOrigin(value: String): String {
        val uri = URI(value)
        val host = uri.host?.lowercase(Locale.ROOT).orEmpty()
        require(uri.scheme.equals("https", true) && uri.userInfo == null && uri.rawQuery == null && uri.rawFragment == null && host.isNotBlank()) {
            "授权图片评测只允许公共 HTTPS 端点"
        }
        require(host != "localhost" && !host.endsWith(".localhost") && !host.endsWith(".local") && !host.endsWith(".invalid") &&
            host != "::1" && !Regex("^(127\\.|10\\.|192\\.168\\.|169\\.254\\.|0\\.)").containsMatchIn(host)) { "授权图片评测端点不是公共主机" }
        Regex("^172\\.(\\d{1,3})\\.").find(host)?.groupValues?.get(1)?.toIntOrNull()?.let { require(it !in 16..31) }
        val port = if (uri.port < 0 || uri.port == 443) "" else ":${uri.port}"
        return "https://$host$port"
    }

    private fun JSONObject.requireKeys(expected: Set<String>, label: String) {
        val actual = keys().asSequence().toSet()
        require(actual == expected) { "$label 字段不符合 schema" }
    }

    private fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).toHex()
    private fun sha256(stream: java.io.InputStream): String {
        val hasher = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(64 * 1024)
        while (true) {
            val count = stream.read(buffer)
            if (count < 0) break
            if (count > 0) hasher.update(buffer, 0, count)
        }
        return hasher.digest().toHex()
    }

    private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it.toInt() and 0xff) }

    private fun verifyCompleteInputSet(prepared: PreparedEvaluation) {
        val images = File(prepared.directory, IMAGES_DIRECTORY).canonicalFile
        val actual = images.walkTopDown()
            .filter { it.isFile && !java.nio.file.Files.isSymbolicLink(it.toPath()) && it.extension.lowercase(Locale.ROOT) in imageExtensions }
            .map { images.toPath().relativize(it.canonicalFile.toPath()).toString().replace('\\', '/') }
            .toSet()
        require(actual == prepared.samples.map { it.relativePath }.toSet()) { "评测目录在完成前增加、删除或替换了图片" }
        prepared.samples.forEach { verifySampleFile(prepared, it) }
    }

    private fun existingFinalMatches(
        output: File,
        prepared: PreparedEvaluation,
        approval: EvaluationApproval,
        progress: EvaluationProgress
    ): Boolean = runCatching {
        output.ordinaryFile(8L * 1024 * 1024)
        val root = JSONObject(output.readText())
        root.requireKeys(setOf(
            "schemaVersion", "evidenceKind", "datasetId", "runId", "evidenceRef", "appVersion", "evaluationApkSha256",
            "modelVersion", "catalogVersion", "evaluatedAt", "runnerProvenance", "samples"
        ), "现有评测结果")
        require(root.getInt("schemaVersion") == 1 && root.getString("evidenceKind") == "image_pipeline_results")
        require(root.getString("datasetId") == prepared.manifest.datasetId && root.getString("runId") == prepared.manifest.runId)
        require(root.getString("evidenceRef") == prepared.manifest.resultEvidenceRef && root.getString("appVersion") == prepared.manifest.appVersion)
        require(root.getString("evaluationApkSha256") == prepared.manifest.evaluationApkSha256)
        require(root.getString("modelVersion") == prepared.manifest.modelVersion && root.getString("catalogVersion") == prepared.manifest.catalogVersion)
        require(strictPastInstant(root.getString("evaluatedAt")) != null)
        val provenance = root.getJSONObject("runnerProvenance")
        require(provenance.getString("reviewerId") == approval.reviewerId && provenance.getString("approvedAt") == approval.approvedAt)
        val expected = progress.results.associateBy { it.sampleId }
        val rows = root.getJSONArray("samples")
        require(rows.length() == expected.size)
        for (index in 0 until rows.length()) {
            val row = rows.getJSONObject(index)
            val item = expected.getValue(row.getString("sampleId"))
            require(row.getString("sampleSha256") == item.sampleSha256 && row.getBoolean("pipelineCompleted") == item.pipelineCompleted &&
                row.getBoolean("leftDevice") == item.leftDevice &&
                (row.optString("predictedTopicId").takeIf { !row.isNull("predictedTopicId") } == item.predictedTopicId))
        }
        true
    }.getOrDefault(false)

    private fun emulatorFingerprint(value: String): Boolean =
        Regex("(?:generic|sdk_gphone|emulator|goldfish|ranchu|aosp_|google/sdk|unknown/unknown)", RegexOption.IGNORE_CASE)
            .containsMatchIn(value)
}
