package cn.jianwei.app

import android.app.AlertDialog
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.ProgressBar
import androidx.activity.ComponentActivity
import androidx.lifecycle.lifecycleScope
import cn.jianwei.domain.repository.AnalysisScheduler
import cn.jianwei.domain.repository.CloudDeletionStatusRepository
import cn.jianwei.domain.usecase.ImportPhotosUseCase
import cn.jianwei.domain.usecase.PhotoImportDisposition
import cn.jianwei.domain.usecase.PhotoImportOutcome
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

@AndroidEntryPoint
class ShareReceiverActivity : ComponentActivity() {
    @Inject lateinit var importPhotos: ImportPhotosUseCase
    @Inject lateinit var operationGate: UserOperationGate
    @Inject lateinit var scheduler: AnalysisScheduler
    @Inject lateinit var cloudDeletionStatus: CloudDeletionStatusRepository
    private var progressDialog: AlertDialog? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val uris = sharedImageUris(intent)
        if (uris.isEmpty()) {
            finish()
            return
        }
        AlertDialog.Builder(this)
            .setTitle("导入分享的图片？")
            .setMessage("将导入并分析 ${uris.size} 张你从其他应用分享的图片。画面本身可能以压缩副本上传；位置和设备等元数据会移除，服务器处理后删除，异常情况下最多保留 24 小时。这次同意独立于系统相册权限；如需停止所有待处理任务，请在应用内点“暂停分析”。")
            .setNegativeButton("取消") { _, _ -> finish() }
            .setPositiveButton("导入并分析") { _, _ -> importConfirmed(uris) }
            .setOnCancelListener { finish() }
            .show()
    }

    private fun importConfirmed(uris: List<Uri>) {
        if (!operationGate.tryStart(UserOperation.IMPORT_PHOTOS)) {
            showRetryDialog(
                title = "另一项操作还没完成",
                message = "见微正在处理其他照片或数据操作。当前分享仍保留在这个页面，你可以稍后重试。",
                uris = uris
            )
            return
        }
        lifecycleScope.launch {
            var outcome: PhotoImportOutcome? = null
            var failed = false
            var blockedByCloudDeletion = false
            try {
                blockedByCloudDeletion = cloudDeletionStatus.isUnresolved()
                if (!blockedByCloudDeletion) {
                    progressDialog = AlertDialog.Builder(this@ShareReceiverActivity)
                        .setTitle("正在安全导入")
                        .setMessage(
                            if (scheduler.isPaused()) {
                                "正在将所选图片复制到见微的私有空间。分析会保持暂停，恢复后再继续。"
                            } else {
                                "正在将所选图片复制到见微的私有空间。此时还不会上传原图。"
                            }
                        )
                        .setView(ProgressBar(this@ShareReceiverActivity))
                        .setCancelable(false)
                        .create()
                        .also(AlertDialog::show)
                    outcome = importPhotos(uris.map(Uri::toString))
                }
            } catch (cancellation: CancellationException) {
                throw cancellation
            } catch (_: Exception) {
                failed = true
            } finally {
                progressDialog?.dismiss()
                progressDialog = null
                operationGate.finish(UserOperation.IMPORT_PHOTOS)
            }
            when {
                blockedByCloudDeletion -> showCloudDeletionBlockedDialog()
                failed -> showRetryDialog(
                    title = "导入没有完成",
                    message = "图片访问可能已失效，或本机存储暂时不可用。已安全写入的重复照片不会再次导入。",
                    uris = uris
                )
                outcome?.disposition == PhotoImportDisposition.NO_READABLE_PHOTOS -> showRetryDialog(
                    title = "未能读取分享图片",
                    message = "图片访问可能已撤销或格式不受支持。可以重试，或返回来源应用重新分享。",
                    uris = uris
                )
                outcome != null -> openMainActivity(outcome)
            }
        }
    }

    private fun showCloudDeletionBlockedDialog() {
        if (isFinishing || isDestroyed) return
        AlertDialog.Builder(this)
            .setTitle("先完成云端数据删除")
            .setMessage("你之前发起的云端删除尚未完成。完成前，见微不会接收或分析新照片。请回到见微继续删除。")
            .setNegativeButton("取消") { _, _ -> finish() }
            .setPositiveButton("回到见微") { _, _ ->
                startActivity(
                    Intent(this, MainActivity::class.java).apply {
                        flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
                    }
                )
                finish()
            }
            .setOnCancelListener { finish() }
            .show()
    }

    private fun openMainActivity(outcome: PhotoImportOutcome) {
        startActivity(
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
                putExtra(MainActivity.EXTRA_SHARED_IMPORT_DISPOSITION, outcome.disposition.name)
                putExtra(MainActivity.EXTRA_SHARED_IMPORT_COUNT, outcome.importedCount)
                putStringArrayListExtra(
                    MainActivity.EXTRA_SHARED_IMPORT_CANDIDATE_TOKENS,
                    ArrayList(outcome.candidateTokens)
                )
            }
        )
        finish()
    }

    private fun showRetryDialog(
        title: String,
        message: String,
        uris: List<Uri>
    ) {
        if (isFinishing || isDestroyed) return
        AlertDialog.Builder(this)
            .setTitle(title)
            .setMessage(message)
            .setNegativeButton("取消") { _, _ -> finish() }
            .setPositiveButton("重试") { _, _ -> importConfirmed(uris) }
            .setOnCancelListener { finish() }
            .show()
    }

    override fun onDestroy() {
        progressDialog?.dismiss()
        progressDialog = null
        super.onDestroy()
    }

    @Suppress("DEPRECATION")
    private fun sharedImageUris(intent: Intent): List<Uri> {
        val values = when (intent.action) {
            Intent.ACTION_SEND -> listOfNotNull(intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM))
            Intent.ACTION_SEND_MULTIPLE -> intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM).orEmpty()
            else -> emptyList()
        }
        return acceptedSharedImageUris(
            action = intent.action,
            declaredMimeType = intent.type,
            // Do not probe a third-party provider before explicit consent. Android's
            // ContentResolver logs the complete URI when a transient grant has expired.
            // The bounded copy, image decoder, JPEG sanitizer and final privacy pass are
            // the byte-level trust boundary after the user confirms the import.
            inputs = values.map { uri -> SharedInput(uri.toString()) },
            maximumImages = MAX_SHARED_IMAGES
        ).map(Uri::parse)
    }

    companion object {
        const val MAX_SHARED_IMAGES = 20
    }
}
