package cn.jianwei.domain.preferences

data class InterestOption(
    val label: String,
    val rankingTerms: Set<String>
)

val INTEREST_OPTIONS: List<InterestOption> = listOf(
    InterestOption("生活设计", setOf("home", "furniture", "interior", "kitchen", "tableware", "lamp", "chair")),
    InterestOption("物件历史", setOf("tool", "antique", "artifact", "craft", "instrument")),
    InterestOption("科学原理", setOf("machine", "technology", "electronics", "vehicle", "science")),
    InterestOption("实用技巧", setOf("cleaning", "food", "appliance", "household", "container")),
    InterestOption("制造工艺", setOf("metal", "wood", "plastic", "textile", "ceramic", "glass"))
)

const val REQUIRED_INTEREST_COUNT = 3

val DEFAULT_INTEREST_SELECTION: Set<String> = linkedSetOf(
    INTEREST_OPTIONS[0].label,
    INTEREST_OPTIONS[1].label,
    INTEREST_OPTIONS[2].label
)

fun isValidInterestSelection(selection: Set<String>): Boolean =
    selection.size == REQUIRED_INTEREST_COUNT &&
        selection.all { selected -> INTEREST_OPTIONS.any { it.label == selected } }

fun canonicalInterestSelection(stored: Set<String>?): Set<String> {
    val known = INTEREST_OPTIONS
        .map { it.label }
        .filterTo(linkedSetOf()) { it in stored.orEmpty() }
    return if (isValidInterestSelection(known)) known else DEFAULT_INTEREST_SELECTION.toSet()
}

fun updatedInterestSelection(
    current: Set<String>,
    interest: String,
    selected: Boolean
): Set<String> {
    if (INTEREST_OPTIONS.none { it.label == interest }) return current
    val canonical = INTEREST_OPTIONS.map { it.label }.filterTo(linkedSetOf()) { it in current }
    if (!selected) {
        canonical.remove(interest)
        return canonical
    }
    if (canonical.size < REQUIRED_INTEREST_COUNT) canonical.add(interest)
    return canonical
}

fun expandedInterestTerms(selection: Set<String>): Set<String> {
    val canonical = canonicalInterestSelection(selection)
    return INTEREST_OPTIONS
        .filter { it.label in canonical }
        .flatMapTo(linkedSetOf()) { it.rankingTerms }
}
