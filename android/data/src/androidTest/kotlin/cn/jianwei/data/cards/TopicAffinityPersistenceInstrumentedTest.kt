package cn.jianwei.data.cards

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import cn.jianwei.data.local.CardEntity
import cn.jianwei.data.local.JianweiDatabase
import cn.jianwei.domain.model.FeedbackAction
import com.google.common.truth.Truth.assertThat
import kotlinx.coroutines.runBlocking
import org.junit.Test

class TopicAffinityPersistenceInstrumentedTest {
    @Test
    fun feedbackChangesRankingSignalOfflineAndSurvivesDatabaseRestart() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        context.deleteDatabase(DATABASE_NAME)
        val first = open(context)
        try {
            first.cards().upsertAll(listOf(card()))
            LocalTopicAffinityStore(first.cards()).applyFeedback("card", FeedbackAction.LIKE)
            assertThat(first.cards().findTopicAffinity("toothbrush")?.weight).isGreaterThan(0.0)
        } finally {
            first.close()
        }

        val reopened = open(context)
        try {
            val affinity = LocalTopicAffinityStore(reopened.cards()).signals().single()
            assertThat(affinity.topicId).isEqualTo("toothbrush")
            assertThat(affinity.aliases).contains("toothbrush")
            assertThat(affinity.weight).isGreaterThan(0.0)
        } finally {
            reopened.close()
            context.deleteDatabase(DATABASE_NAME)
        }
    }

    private fun open(context: Context) =
        Room.databaseBuilder(context, JianweiDatabase::class.java, DATABASE_NAME).build()

    private fun card() = CardEntity(
        cardId = "card",
        candidateToken = "candidate",
        photoUri = "content://media/external/images/media/42",
        topicId = "toothbrush",
        factId = "fact",
        title = "Toothbrush design",
        detectedObjectName = "牙刷",
        body = "body",
        personalContext = "context",
        confidence = 0.9,
        sources = "[]",
        status = "scheduled",
        scheduledDate = "2026-07-18",
        createdAtMillis = 1
    )

    private companion object { const val DATABASE_NAME = "topic-affinity-persistence-test" }
}
