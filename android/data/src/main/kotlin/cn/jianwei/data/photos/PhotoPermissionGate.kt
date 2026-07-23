package cn.jianwei.data.photos

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.net.Uri
import androidx.core.content.ContextCompat
import cn.jianwei.domain.model.PhotoAccess
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class PhotoPermissionGate @Inject constructor(
    @param:ApplicationContext private val context: Context
) {
    fun currentAccess(): PhotoAccess = when {
        Build.VERSION.SDK_INT >= 34 && granted(Manifest.permission.READ_MEDIA_IMAGES) -> PhotoAccess.FULL
        Build.VERSION.SDK_INT >= 34 && granted(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED) -> PhotoAccess.PARTIAL
        Build.VERSION.SDK_INT >= 33 && granted(Manifest.permission.READ_MEDIA_IMAGES) -> PhotoAccess.FULL
        Build.VERSION.SDK_INT <= 32 && granted(Manifest.permission.READ_EXTERNAL_STORAGE) -> PhotoAccess.FULL
        else -> PhotoAccess.PICKER_ONLY
    }

    fun canReadMediaStore(): Boolean = currentAccess() != PhotoAccess.PICKER_ONLY

    /**
     * Android 14 partial access can remain granted while the user removes one selected photo.
     * Opening the exact item forces MediaStore to re-evaluate that per-item grant.
     */
    fun canReadMediaStoreItem(contentUri: String): Boolean {
        if (!canReadMediaStore()) return false
        return runCatching {
            context.contentResolver.openFileDescriptor(Uri.parse(contentUri), "r")?.use { true } ?: false
        }.getOrDefault(false)
    }

    private fun granted(permission: String): Boolean =
        ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED
}
