package cn.jianwei.app

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import cn.jianwei.domain.model.PhotoAccess

fun requiredPhotoPermissions(): Array<String> = when {
    Build.VERSION.SDK_INT >= 34 -> arrayOf(
        Manifest.permission.READ_MEDIA_IMAGES,
        Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED
    )
    Build.VERSION.SDK_INT >= 33 -> arrayOf(Manifest.permission.READ_MEDIA_IMAGES)
    else -> arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE)
}

fun currentPhotoAccess(context: Context): PhotoAccess = when {
    Build.VERSION.SDK_INT >= 34 && granted(context, Manifest.permission.READ_MEDIA_IMAGES) -> PhotoAccess.FULL
    Build.VERSION.SDK_INT >= 34 && granted(context, Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED) -> PhotoAccess.PARTIAL
    Build.VERSION.SDK_INT >= 33 && granted(context, Manifest.permission.READ_MEDIA_IMAGES) -> PhotoAccess.FULL
    Build.VERSION.SDK_INT <= 32 && granted(context, Manifest.permission.READ_EXTERNAL_STORAGE) -> PhotoAccess.FULL
    else -> PhotoAccess.PICKER_ONLY
}

internal fun shouldOpenPhotoPermissionSettings(
    access: PhotoAccess,
    previousRequestCount: Int,
    shouldShowRationale: Boolean
): Boolean = access == PhotoAccess.PICKER_ONLY &&
    previousRequestCount > 0 &&
    !shouldShowRationale

private fun granted(context: Context, permission: String) =
    ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED
