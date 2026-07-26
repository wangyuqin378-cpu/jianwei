package cn.jianwei.data.network

import com.google.common.truth.Truth.assertThat
import java.io.IOException
import org.junit.Test

class TrackedItemResponseBindingTest {
    @Test
    fun trackResponse_requiresExactCardDateAndReminderPeriod() {
        val valid = TrackItemResponse(TRACK_ID, CARD_ID, "2026-07-26", 90, "2026-07-26T00:00:00.000Z")
        valid.requireBoundTo(CARD_ID, "2026-07-26", 90)

        for (response in listOf(
            valid.copy(id = null),
            valid.copy(id = "tracked"),
            valid.copy(cardId = OTHER_CARD_ID),
            valid.copy(startedOn = "2026-02-30"),
            valid.copy(startedOn = "2026-07-27"),
            valid.copy(reminderDays = 120),
            valid.copy(createdAt = "2026-07-26T00:00:00Z")
        )) {
            assertThat(runCatching { response.requireBoundTo(CARD_ID, "2026-07-26", 90) }.exceptionOrNull())
                .isInstanceOf(IOException::class.java)
        }
    }

    @Test
    fun untrackResponse_requiresExactCardAndTerminalStatus() {
        UntrackItemResponse(CARD_ID, "untracked").requireBoundTo(CARD_ID)

        for (response in listOf(
            UntrackItemResponse(null, "untracked"),
            UntrackItemResponse(OTHER_CARD_ID, "untracked"),
            UntrackItemResponse(CARD_ID, null),
            UntrackItemResponse(CARD_ID, "deleted")
        )) {
            assertThat(runCatching { response.requireBoundTo(CARD_ID) }.exceptionOrNull())
                .isInstanceOf(IOException::class.java)
        }
    }

    private companion object {
        const val TRACK_ID = "a542bed7-fca8-43b1-8b7a-ff21f196d0d1"
        const val CARD_ID = "2a7d8040-f311-4e83-a38c-1bcd09f21961"
        const val OTHER_CARD_ID = "f8dd6a8b-5d4a-4c5a-881d-cddad8fd52c5"
    }
}
