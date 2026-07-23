package cn.jianwei.app

internal data class SharedInput(val uri: String)

internal fun acceptedSharedImageUris(
    action: String?,
    declaredMimeType: String?,
    inputs: List<SharedInput>,
    maximumImages: Int = 20
): List<String> {
    if (action !in setOf("android.intent.action.SEND", "android.intent.action.SEND_MULTIPLE")) return emptyList()
    if (declaredMimeType?.startsWith("image/") != true) return emptyList()
    if (inputs.isEmpty() || inputs.size > maximumImages) return emptyList()
    if (inputs.any { input -> !input.uri.startsWith("content://") }) return emptyList()
    return inputs.map { it.uri }.distinct()
}
