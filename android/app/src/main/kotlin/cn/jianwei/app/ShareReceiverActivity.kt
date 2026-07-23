package cn.jianwei.app

import android.app.AlertDialog
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.lifecycle.lifecycleScope
import cn.jianwei.domain.repository.AnalysisScheduler
import cn.jianwei.domain.repository.PhotoRepository
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject
import kotlinx.coroutines.launch

@AndroidEntryPoint
class ShareReceiverActivity : ComponentActivity() {
    @Inject lateinit var photos: PhotoRepository
    @Inject lateinit var scheduler: AnalysisScheduler

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
        lifecycleScope.launch {
            val imported = photos.importUris(uris.map(Uri::toString))
            if (imported.isNotEmpty()) {
                scheduler.scheduleImportedPhotos()
                startActivity(Intent(this@ShareReceiverActivity, MainActivity::class.java))
            } else {
                Toast.makeText(this@ShareReceiverActivity, "未能读取所选图片", Toast.LENGTH_LONG).show()
            }
            finish()
        }
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

    private companion object {
        const val MAX_SHARED_IMAGES = 20
    }
}
