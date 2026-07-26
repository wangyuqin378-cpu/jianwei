package cn.jianwei.app

import cn.jianwei.domain.model.KnowledgeSource
import com.google.common.truth.Truth.assertThat
import org.junit.Test

class KnowledgeSourcePresentationTest {
    @Test
    fun `single source exposes publisher and concrete title`() {
        val presentation = knowledgeSourcePresentation(
            source = source(
                publisher = "Smithsonian Magazine",
                title = "The surprisingly complex design of everyday objects"
            ),
            index = 0,
            total = 1
        )

        assertThat(presentation.eyebrow).isEqualTo("来源 · Smithsonian Magazine")
        assertThat(presentation.title)
            .isEqualTo("The surprisingly complex design of everyday objects")
        assertThat(presentation.accessibilityLabel).isEqualTo(
            "查看来源：Smithsonian Magazine，The surprisingly complex design of everyday objects"
        )
    }

    @Test
    fun `multiple sources are numbered and do not repeat identical title`() {
        val presentation = knowledgeSourcePresentation(
            source = source(publisher = "WHO", title = "who"),
            index = 1,
            total = 2
        )

        assertThat(presentation.eyebrow).isEqualTo("来源 2 · WHO")
        assertThat(presentation.title).isNull()
        assertThat(presentation.accessibilityLabel).isEqualTo("查看来源：WHO")
    }

    private fun source(publisher: String, title: String) = KnowledgeSource(
        sourceId = "source-1",
        title = title,
        url = "https://example.com/fact",
        publisher = publisher,
        authority = "official"
    )
}
