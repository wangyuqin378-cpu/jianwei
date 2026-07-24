package cn.jianwei.domain.card

import com.google.common.truth.Truth.assertThat
import org.junit.Test

class CardSupplyPolicyTest {
    @Test
    fun `automatic discovery refills from the low water mark toward fourteen cards`() {
        val empty = requireNotNull(cardSupplyPlan(CardSupplyMode.AUTOMATIC_DISCOVERY, 0))
        val low = requireNotNull(cardSupplyPlan(CardSupplyMode.AUTOMATIC_DISCOVERY, 6))

        assertThat(empty.targetCachedCards).isEqualTo(14)
        assertThat(low.targetCachedCards).isEqualTo(14)
        assertThat(cardSupplyPlan(CardSupplyMode.AUTOMATIC_DISCOVERY, 7)).isNull()
        assertThat(cardSupplyPlan(CardSupplyMode.AUTOMATIC_DISCOVERY, 14)).isNull()
    }

    @Test
    fun `automatic refill stops at target or bounded candidate cap`() {
        val plan = requireNotNull(cardSupplyPlan(CardSupplyMode.AUTOMATIC_DISCOVERY, 3))

        assertThat(shouldContinueCardSupply(plan, currentCachedCards = 13, processedCandidates = 23)).isTrue()
        assertThat(shouldContinueCardSupply(plan, currentCachedCards = 14, processedCandidates = 8)).isFalse()
        assertThat(shouldContinueCardSupply(plan, currentCachedCards = 8, processedCandidates = 24)).isFalse()
    }

    @Test
    fun `explicit imports run even when the automatic cache is full`() {
        val plan = requireNotNull(cardSupplyPlan(CardSupplyMode.EXPLICIT_IMPORT, 14))

        assertThat(plan.targetCachedCards).isNull()
        assertThat(shouldContinueCardSupply(plan, currentCachedCards = 14, processedCandidates = 0)).isTrue()
        assertThat(shouldContinueCardSupply(plan, currentCachedCards = 30, processedCandidates = 19)).isTrue()
        assertThat(shouldContinueCardSupply(plan, currentCachedCards = 30, processedCandidates = 20)).isFalse()
    }

    @Test
    fun `healthy automatic cache skips privacy analysis but explicit imports never do`() {
        assertThat(shouldRunPrivacyBatch(CardSupplyMode.AUTOMATIC_DISCOVERY, 6)).isTrue()
        assertThat(shouldRunPrivacyBatch(CardSupplyMode.AUTOMATIC_DISCOVERY, 7)).isFalse()
        assertThat(shouldRunPrivacyBatch(CardSupplyMode.AUTOMATIC_DISCOVERY, 14)).isFalse()
        assertThat(shouldRunPrivacyBatch(CardSupplyMode.EXPLICIT_IMPORT, 14)).isTrue()
    }

    @Test
    fun `first automatic card syncs immediately only once`() {
        assertThat(shouldSyncCardsImmediately(
            CardSupplyMode.AUTOMATIC_DISCOVERY,
            hadAnyLocalCardAtStart = false,
            immediateSyncCompleted = false,
            candidateCompleted = true
        )).isTrue()
        assertThat(shouldSyncCardsImmediately(
            CardSupplyMode.AUTOMATIC_DISCOVERY,
            hadAnyLocalCardAtStart = false,
            immediateSyncCompleted = true,
            candidateCompleted = true
        )).isFalse()
        assertThat(shouldSyncCardsImmediately(
            CardSupplyMode.AUTOMATIC_DISCOVERY,
            hadAnyLocalCardAtStart = true,
            immediateSyncCompleted = false,
            candidateCompleted = true
        )).isFalse()
    }

    @Test
    fun `explicit import syncs its first completed candidate without waiting for batch end`() {
        assertThat(shouldSyncCardsImmediately(
            CardSupplyMode.EXPLICIT_IMPORT,
            hadAnyLocalCardAtStart = true,
            immediateSyncCompleted = false,
            candidateCompleted = true
        )).isTrue()
        assertThat(shouldSyncCardsImmediately(
            CardSupplyMode.EXPLICIT_IMPORT,
            hadAnyLocalCardAtStart = true,
            immediateSyncCompleted = false,
            candidateCompleted = false
        )).isFalse()
    }

    @Test
    fun `automatic privacy batch moves on after twelve unique eligible candidates`() {
        val plan = privacyBatchPlan(CardSupplyMode.AUTOMATIC_DISCOVERY)

        assertThat(plan.maxInspections).isEqualTo(24)
        assertThat(plan.targetUniqueEligibleCandidates).isEqualTo(12)
        assertThat(shouldContinuePrivacyBatch(plan, inspectedCandidates = 12, uniqueEligibleCandidates = 3)).isTrue()
        assertThat(shouldContinuePrivacyBatch(plan, inspectedCandidates = 18, uniqueEligibleCandidates = 12)).isFalse()
        assertThat(shouldContinuePrivacyBatch(plan, inspectedCandidates = 24, uniqueEligibleCandidates = 4)).isFalse()
    }

    @Test
    fun `explicit privacy batch inspects all accepted user imports`() {
        val plan = privacyBatchPlan(CardSupplyMode.EXPLICIT_IMPORT)

        assertThat(plan.maxInspections).isEqualTo(20)
        assertThat(plan.targetUniqueEligibleCandidates).isNull()
        assertThat(shouldContinuePrivacyBatch(plan, inspectedCandidates = 12, uniqueEligibleCandidates = 12)).isTrue()
        assertThat(shouldContinuePrivacyBatch(plan, inspectedCandidates = 20, uniqueEligibleCandidates = 20)).isFalse()
    }
}
