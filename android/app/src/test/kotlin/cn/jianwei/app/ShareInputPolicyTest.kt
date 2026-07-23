package cn.jianwei.app

import com.google.common.truth.Truth.assertThat
import org.junit.Test

class ShareInputPolicyTest {
    @Test
    fun `accepts only bounded content images and deduplicates them`() {
        val accepted = acceptedSharedImageUris(
            action = "android.intent.action.SEND_MULTIPLE",
            declaredMimeType = "image/*",
            inputs = listOf(
                SharedInput("content://photos/1"),
                SharedInput("content://photos/1"),
                SharedInput("content://photos/2")
            )
        )
        assertThat(accepted).containsExactly("content://photos/1", "content://photos/2").inOrder()
        assertThat(acceptedSharedImageUris("android.intent.action.SEND", "image/jpeg", listOf(
            SharedInput("content://limited-provider/photo")
        ))).containsExactly("content://limited-provider/photo")
    }

    @Test
    fun `rejects non image non content and oversized payloads as a whole`() {
        assertThat(acceptedSharedImageUris("android.intent.action.SEND", "text/plain", listOf(
            SharedInput("content://photos/1")
        ))).isEmpty()
        assertThat(acceptedSharedImageUris("android.intent.action.SEND", "image/jpeg", listOf(
            SharedInput("file:///tmp/photo.jpg")
        ))).isEmpty()
        assertThat(acceptedSharedImageUris("android.intent.action.SEND_MULTIPLE", "image/*",
            (1..21).map { SharedInput("content://photos/$it") }
        )).isEmpty()
    }
}
