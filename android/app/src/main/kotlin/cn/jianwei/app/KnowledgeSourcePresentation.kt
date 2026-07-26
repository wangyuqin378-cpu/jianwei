package cn.jianwei.app

import cn.jianwei.domain.model.KnowledgeSource

internal data class KnowledgeSourcePresentation(
    val eyebrow: String,
    val title: String?,
    val accessibilityLabel: String
)

internal fun knowledgeSourcePresentation(
    source: KnowledgeSource,
    index: Int,
    total: Int
): KnowledgeSourcePresentation {
    val publisher = source.publisher.trim()
    val title = source.title.trim()
    val distinctTitle = title.takeUnless { it.equals(publisher, ignoreCase = true) }
    val sourceLabel = if (total > 1) "来源 ${index + 1}" else "来源"
    return KnowledgeSourcePresentation(
        eyebrow = "$sourceLabel · $publisher",
        title = distinctTitle,
        accessibilityLabel = buildString {
            append("查看来源：")
            append(publisher)
            distinctTitle?.let {
                append('，')
                append(it)
            }
        }
    )
}
