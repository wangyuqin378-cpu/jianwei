package cn.jianwei.domain.card

enum class CardSupplyMode {
    AUTOMATIC_DISCOVERY,
    EXPLICIT_IMPORT
}

data class CardSupplyPlan(
    val mode: CardSupplyMode,
    val targetCachedCards: Int?,
    val maxCandidates: Int
)

data class PrivacyBatchPlan(
    val maxInspections: Int,
    val targetUniqueEligibleCandidates: Int?
)

/**
 * Automatic discovery sleeps while the offline cache is healthy. Once it drops below seven
 * scheduled cards, one bounded run refills toward fourteen so daily delivery does not require a
 * network wake-up. Explicit imports are user-requested work and must never be blocked by a full
 * automatic cache.
 */
fun cardSupplyPlan(mode: CardSupplyMode, currentCachedCards: Int): CardSupplyPlan? {
    require(currentCachedCards >= 0)
    return when (mode) {
        CardSupplyMode.AUTOMATIC_DISCOVERY -> {
            if (currentCachedCards >= CARD_CACHE_LOW_WATER_MARK) {
                null
            } else {
                CardSupplyPlan(
                    mode = mode,
                    targetCachedCards = CARD_CACHE_REFILL_TARGET,
                    maxCandidates = MAX_AUTOMATIC_CANDIDATES_PER_RUN
                )
            }
        }
        CardSupplyMode.EXPLICIT_IMPORT -> CardSupplyPlan(
            mode = mode,
            targetCachedCards = null,
            maxCandidates = MAX_EXPLICIT_IMPORTS_PER_RUN
        )
    }
}

fun shouldContinueCardSupply(
    plan: CardSupplyPlan,
    currentCachedCards: Int,
    processedCandidates: Int
): Boolean {
    require(currentCachedCards >= 0)
    require(processedCandidates >= 0)
    if (processedCandidates >= plan.maxCandidates) return false
    return plan.targetCachedCards?.let { currentCachedCards < it } ?: true
}

/**
 * A first-time automatic run should publish its first completed card without waiting for the rest
 * of the model batch. Explicit imports get the same one-shot fast path because the user is waiting
 * for the photos they just selected. Routine automatic refills keep the cheaper batch sync.
 */
fun shouldSyncCardsImmediately(
    mode: CardSupplyMode,
    hadAnyLocalCardAtStart: Boolean,
    immediateSyncCompleted: Boolean,
    candidateCompleted: Boolean
): Boolean = candidateCompleted && !immediateSyncCompleted && (
    mode == CardSupplyMode.EXPLICIT_IMPORT || !hadAnyLocalCardAtStart
)

/**
 * Automatic discovery moves on as soon as twelve locally safe, non-duplicate candidates are
 * available, while allowing a bounded amount of over-sampling for blurred, private, or repeated
 * photos. Explicit imports are direct user requests, so every image in the accepted batch is
 * inspected before the next stage.
 */
fun privacyBatchPlan(mode: CardSupplyMode): PrivacyBatchPlan = when (mode) {
    CardSupplyMode.AUTOMATIC_DISCOVERY -> PrivacyBatchPlan(
        maxInspections = MAX_AUTOMATIC_CANDIDATES_PER_RUN,
        targetUniqueEligibleCandidates = INITIAL_UNIQUE_ELIGIBLE_TARGET
    )
    CardSupplyMode.EXPLICIT_IMPORT -> PrivacyBatchPlan(
        maxInspections = MAX_EXPLICIT_IMPORTS_PER_RUN,
        targetUniqueEligibleCandidates = null
    )
}

fun shouldContinuePrivacyBatch(
    plan: PrivacyBatchPlan,
    inspectedCandidates: Int,
    uniqueEligibleCandidates: Int
): Boolean {
    require(inspectedCandidates >= 0)
    require(uniqueEligibleCandidates >= 0)
    if (inspectedCandidates >= plan.maxInspections) return false
    return plan.targetUniqueEligibleCandidates
        ?.let { uniqueEligibleCandidates < it }
        ?: true
}

const val CARD_CACHE_LOW_WATER_MARK = 7
const val CARD_CACHE_REFILL_TARGET = 14
const val MAX_AUTOMATIC_CANDIDATES_PER_RUN = 24
const val MAX_EXPLICIT_IMPORTS_PER_RUN = 20
const val INITIAL_UNIQUE_ELIGIBLE_TARGET = 12
