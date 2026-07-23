package cn.jianwei.data.local

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Test

class LocalPrivacyCleanupInstrumentedTest {
    @Test
    fun photoUrisAndPendingFeedbackCanBeClearedWithoutDeletingKnowledgeCards() {
        runBlocking {
            val database = Room.inMemoryDatabaseBuilder(
                ApplicationProvider.getApplicationContext(),
                JianweiDatabase::class.java
            ).build()
            try {
                val cards = database.cards()
                cards.upsertAll(listOf(card("content://media/external/images/media/42")))
                cards.enqueueFeedback(
                    PendingFeedbackEntity(cardId = "card", action = "LIKE", createdAtMillis = 1)
                )

                assertThat(cards.clearPhotoUris()).isEqualTo(1)
                cards.clearPendingFeedback()

                val remaining = cards.observeAll().first().single()
                assertThat(remaining.cardId).isEqualTo("card")
                assertThat(remaining.photoUri).isEmpty()
                assertThat(cards.pendingFeedback()).isEmpty()
            } finally {
                database.close()
            }
        }
    }

    private fun card(uri: String) = CardEntity(
        cardId = "card",
        candidateToken = "candidate",
        photoUri = uri,
        topicId = "topic",
        factId = "fact",
        title = "title",
        detectedObjectName = "object",
        body = "body",
        personalContext = "context",
        confidence = 0.9,
        sources = "[]",
        status = "scheduled",
        scheduledDate = "2026-07-18",
        createdAtMillis = 1
    )
}
