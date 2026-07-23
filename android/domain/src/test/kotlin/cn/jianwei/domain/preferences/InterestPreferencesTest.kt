package cn.jianwei.domain.preferences

import com.google.common.truth.Truth.assertThat
import org.junit.Test

class InterestPreferencesTest {
    @Test
    fun `stored selection is canonical and malformed values fail to defaults`() {
        assertThat(
            canonicalInterestSelection(setOf("科学原理", "未知兴趣", "生活设计", "物件历史"))
        ).containsExactly("生活设计", "物件历史", "科学原理").inOrder()

        assertThat(canonicalInterestSelection(setOf("生活设计")))
            .containsExactlyElementsIn(DEFAULT_INTEREST_SELECTION)
            .inOrder()
    }

    @Test
    fun `draft selection allows replacement but never exceeds three`() {
        val withoutHistory = updatedInterestSelection(
            DEFAULT_INTEREST_SELECTION,
            "物件历史",
            selected = false
        )
        assertThat(withoutHistory).doesNotContain("物件历史")
        assertThat(isValidInterestSelection(withoutHistory)).isFalse()

        val replaced = updatedInterestSelection(withoutHistory, "制造工艺", selected = true)
        assertThat(replaced).containsExactly("生活设计", "科学原理", "制造工艺").inOrder()
        assertThat(isValidInterestSelection(replaced)).isTrue()

        assertThat(updatedInterestSelection(replaced, "实用技巧", selected = true))
            .containsExactlyElementsIn(replaced)
    }

    @Test
    fun `ranking terms derive only from the persisted three interests`() {
        val terms = expandedInterestTerms(setOf("科学原理", "实用技巧", "制造工艺"))

        assertThat(terms).containsAtLeast("science", "vehicle", "cleaning", "household", "metal", "ceramic")
        assertThat(terms).doesNotContain("antique")
    }

    @Test
    fun `unknown drafts cannot become valid selections`() {
        val current = DEFAULT_INTEREST_SELECTION

        assertThat(updatedInterestSelection(current, "未知兴趣", selected = false))
            .containsExactlyElementsIn(current)
        assertThat(isValidInterestSelection(current + "未知兴趣")).isFalse()
    }
}
