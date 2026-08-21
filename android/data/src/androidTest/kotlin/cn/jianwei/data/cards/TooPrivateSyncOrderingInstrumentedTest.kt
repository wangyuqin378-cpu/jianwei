package cn.jianwei.data.cards

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import cn.jianwei.data.control.AnalysisSessionGate
import cn.jianwei.data.local.CardEntity
import cn.jianwei.data.local.JianweiDatabase
import cn.jianwei.data.local.PendingFeedbackEntity
import cn.jianwei.data.local.PhotoCandidateEntity
import cn.jianwei.data.local.TrackedItemEntity
import cn.jianwei.data.local.toDomain
import cn.jianwei.data.network.CompleteJobResponse
import cn.jianwei.data.network.CreateJobRequest
import cn.jianwei.data.network.CreateJobResponse
import cn.jianwei.data.network.DeviceIdentity
import cn.jianwei.data.network.DeleteDeviceDataResponse
import cn.jianwei.data.network.DeviceTokenCipher
import cn.jianwei.data.network.FeedbackRequest
import cn.jianwei.data.network.FeedbackResponse
import cn.jianwei.data.network.JianweiApi
import cn.jianwei.data.network.RegisterRequest
import cn.jianwei.data.network.RegisterResponse
import cn.jianwei.data.network.TrackRequest
import cn.jianwei.data.network.TrackItemResponse
import cn.jianwei.data.network.UntrackItemResponse
import cn.jianwei.data.network.CardsResponse
import cn.jianwei.data.network.CardDto
import cn.jianwei.data.network.SourceDto
import cn.jianwei.data.network.TopicAffinityDto
import cn.jianwei.data.photos.MediaPhotoRepository
import cn.jianwei.data.work.DailyPipelineKickWorker
import cn.jianwei.domain.metrics.FirstCardMetricRecorder
import cn.jianwei.domain.model.AnalysisState
import cn.jianwei.domain.model.FeedbackAction
import cn.jianwei.domain.model.PhotoOrigin
import cn.jianwei.domain.model.SavedCardUpdateResult
import com.google.common.truth.Truth.assertThat
import java.io.IOException
import java.time.LocalDate
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response

class TooPrivateSyncOrderingInstrumentedTest {
    @Test
    fun crossedReminderAcknowledgementsRetainOutboxUntilExactRetrySucceeds() = runBlocking {
        withRepository { database, repository, _, api ->
            repository.track(CARD_ID, LocalDate.parse("2026-07-20"), 90)
            api.trackResponseFactory = { _, request ->
                TrackItemResponse(
                    TRACKED_ITEM_ID,
                    MALFORMED_CARD_ID,
                    request.startedOn,
                    request.reminderDays,
                    "2026-07-26T00:00:00.000Z"
                )
            }

            assertThat(runCatching { repository.syncCards() }.exceptionOrNull())
                .isInstanceOf(IOException::class.java)
            assertThat(database.cards().findTrackedItem(CARD_ID)?.syncAction).isEqualTo("UPSERT")

            api.trackResponseFactory = { cardId, request ->
                TrackItemResponse(
                    TRACKED_ITEM_ID,
                    cardId,
                    request.startedOn,
                    request.reminderDays,
                    "2026-07-26T00:00:00.000Z"
                )
            }
            repository.syncCards()
            assertThat(database.cards().findTrackedItem(CARD_ID)?.syncAction).isEqualTo("NONE")

            repository.cancelTracking(CARD_ID)
            api.untrackResponseFactory = { UntrackItemResponse(MALFORMED_CARD_ID, "untracked") }
            assertThat(runCatching { repository.syncCards() }.exceptionOrNull())
                .isInstanceOf(IOException::class.java)
            assertThat(database.cards().findTrackedItem(CARD_ID)?.syncAction).isEqualTo("DELETE")

            api.untrackResponseFactory = { cardId -> UntrackItemResponse(cardId, "untracked") }
            repository.syncCards()
            assertThat(database.cards().findTrackedItem(CARD_ID)).isNull()
        }
    }

    @Test
    fun wrongObjectBarrierSurvivesCrashRestart() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val databaseName = "wrong-object-crash-${System.nanoTime()}.db"
        context.deleteDatabase(databaseName)
        var database = Room.databaseBuilder(context, JianweiDatabase::class.java, databaseName).build()
        try {
            database.cards().upsertAll(listOf(localCard()))
            database.cards().setCardSaved(CARD_ID, true, 1L)
            database.cards().upsertTrackedItem(
                TrackedItemEntity(CARD_ID, "2026-07-20", 90, "NONE", 2L)
            )

            database.cards().commitOrdinaryFeedback(
                CARD_ID,
                FeedbackAction.WRONG_OBJECT.name,
                3L
            )
            database.close()
            database = Room.databaseBuilder(context, JianweiDatabase::class.java, databaseName).build()

            assertThat(database.cards().findById(CARD_ID)?.status).isEqualTo("archived")
            assertThat(database.cards().observeSavedCards().first()).isEmpty()
            assertThat(database.cards().findFeedbackState(CARD_ID)?.action)
                .isEqualTo(FeedbackAction.WRONG_OBJECT.name)
            assertThat(database.cards().pendingFeedback().map { it.action })
                .containsExactly(FeedbackAction.WRONG_OBJECT.name)
            assertThat(database.cards().findTopicAffinity("broom")?.weight).isEqualTo(0.0)
            assertThat(database.cards().findTrackedItem(CARD_ID)?.syncAction).isEqualTo("DELETE")
        } finally {
            database.close()
            context.deleteDatabase(databaseName)
        }
    }

    @Test
    fun privateBarrierAndDeletionSurviveCrashRestart() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val databaseName = "too-private-crash-${System.nanoTime()}.db"
        context.deleteDatabase(databaseName)
        var database = Room.databaseBuilder(context, JianweiDatabase::class.java, databaseName).build()
        try {
            database.photos().upsert(candidate())
            database.cards().upsertAll(listOf(localCard()))
            database.cards().setCardSaved(CARD_ID, true, 1L)
            database.cards().enqueueFeedback(
                PendingFeedbackEntity(cardId = CARD_ID, action = FeedbackAction.LIKE.name, createdAtMillis = 2L)
            )
            database.cards().upsertTrackedItem(
                TrackedItemEntity(CARD_ID, "2026-07-20", 90, "UPSERT", 3L)
            )

            val cleanup = database.cards().stagePrivateFeedbackAndDelete(CARD_ID, 4L)
            assertThat(cleanup.photoLocalId).isEqualTo(42L)
            // Simulate process death immediately after the database commit and before repository
            // follow-up work such as private-file deletion or local affinity learning.
            database.close()
            database = Room.databaseBuilder(context, JianweiDatabase::class.java, databaseName).build()

            assertThat(database.cards().findById(CARD_ID)).isNull()
            assertThat(database.cards().observeSavedCards().first()).isEmpty()
            assertThat(database.cards().findTrackedItem(CARD_ID)).isNull()
            assertThat(database.cards().pendingFeedback().map { it.action })
                .containsExactly(FeedbackAction.TOO_PRIVATE.name)
            assertThat(database.photos().findById(42L)?.analysisState)
                .isEqualTo(AnalysisState.NEVER_ANALYZE.name)
            assertThat(database.photos().isSuppressed(42L)).isTrue()
        } finally {
            database.close()
            context.deleteDatabase(databaseName)
        }
    }

    @Test
    fun privateBarrierCanStillSuppressPhotoAfterLocalIndexWasCleared() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val database = Room.inMemoryDatabaseBuilder(context, JianweiDatabase::class.java).build()
        try {
            database.photos().upsert(candidate())
            database.cards().upsertAll(listOf(localCard().copy(privacyPhotoLocalId = 42L)))

            database.cards().clearPhotoUris()
            database.photos().clear()
            assertThat(database.cards().findById(CARD_ID)?.photoUri).isEmpty()
            val cleanup = database.cards().stagePrivateFeedbackAndDelete(CARD_ID, 4L)

            assertThat(cleanup.photoLocalId).isEqualTo(42L)
            assertThat(database.photos().isSuppressed(42L)).isTrue()
        } finally {
            database.close()
        }
    }

    @Test
    fun firstCardMetricIsRecordedOnlyAfterNonEmptySyncCommit() = runBlocking {
        val recordedAt = mutableListOf<Long>()
        withRepository(
            firstCardMetrics = FirstCardMetricRecorder { recordedAt += it }
        ) { database, repository, _, api ->
            api.cardsHandler = { CardsResponse(emptyList(), null) }
            repository.syncCards()
            assertThat(recordedAt).isEmpty()

            api.cardsHandler = {
                CardsResponse(listOf(serverCard(title = "rejected-card").copy(status = "archived")), null)
            }
            repository.syncCards()
            assertThat(recordedAt).isEmpty()

            api.cardsHandler = { CardsResponse(listOf(serverCard(title = "first-card")), null) }
            repository.syncCards()

            assertThat(recordedAt).hasSize(1)
            assertThat(database.cards().findById(CARD_ID)?.title).isEqualTo("first-card")
        }
    }

    @Test
    fun firstCardMetricFailureDoesNotFailCommittedCardSync() = runBlocking {
        withRepository(
            firstCardMetrics = FirstCardMetricRecorder { error("synthetic metric failure") }
        ) { database, repository, _, api ->
            api.cardsHandler = { CardsResponse(listOf(serverCard(title = "committed-card")), null) }

            val failure = runCatching { repository.syncCards() }.exceptionOrNull()

            assertThat(failure).isNull()
            assertThat(database.cards().findById(CARD_ID)?.title).isEqualTo("committed-card")
        }
    }

    @Test
    fun savedCardSurvivesRefreshAndResaveDoesNotDuplicateSignal() = runBlocking {
        withRepository { database, repository, _, api ->
            assertThat(repository.setSaved(CARD_ID, true))
                .isEqualTo(SavedCardUpdateResult(true, true, true))
            assertThat(repository.setSaved(CARD_ID, false))
                .isEqualTo(SavedCardUpdateResult(true, true, false))
            assertThat(repository.setSaved(CARD_ID, true))
                .isEqualTo(SavedCardUpdateResult(true, true, true))
            assertThat(repository.setSaved(CARD_ID, true))
                .isEqualTo(SavedCardUpdateResult(true, false, true))
            assertThat(database.cards().pendingFeedbackByAction(FeedbackAction.SAVE.name)).hasSize(1)
            assertThat(database.cards().findTopicAffinity("broom")?.weight).isEqualTo(0.5)
            api.cardsHandler = { CardsResponse(listOf(serverCard(title = "server-refreshed")), null) }

            repository.syncCards()

            assertThat(repository.observeSavedCards().first().single().title).isEqualTo("server-refreshed")
            assertThat(database.cards().pendingFeedbackByAction(FeedbackAction.SAVE.name)).isEmpty()
            assertThat(api.events.count { it == "feedback:SAVE" }).isEqualTo(1)
        }
    }

    @Test
    fun mismatchedFeedbackAcknowledgementRetainsOutboxAndLocalAffinity() = runBlocking {
        withRepository { database, repository, _, api ->
            repository.sendFeedback(CARD_ID, FeedbackAction.LIKE)
            val localWeight = database.cards().findTopicAffinity("broom")!!.weight
            api.feedbackResponseFactory = { _, request ->
                FeedbackResponse(
                    id = FEEDBACK_ID,
                    cardId = MALFORMED_CARD_ID,
                    action = request.action,
                    createdAt = "2026-07-26T00:00:00.000Z",
                    topicAffinities = listOf(TopicAffinityDto("broom", -2.0, emptyList()))
                )
            }

            val failure = runCatching { repository.syncCards() }.exceptionOrNull()

            assertThat(failure).isInstanceOf(IOException::class.java)
            assertThat(database.cards().pendingFeedbackByAction(FeedbackAction.LIKE.name)).hasSize(1)
            assertThat(database.cards().findTopicAffinity("broom")?.weight).isEqualTo(localWeight)
            assertThat(api.events).contains("feedback:LIKE")
        }
    }

    @Test
    fun missingFeedbackFieldRetainsOutboxAndLocalAffinity() = runBlocking {
        withRepository { database, repository, _, api ->
            repository.sendFeedback(CARD_ID, FeedbackAction.LIKE)
            val localWeight = database.cards().findTopicAffinity("broom")!!.weight
            api.feedbackResponseFactory = { cardId, request ->
                FeedbackResponse(
                    id = FEEDBACK_ID,
                    cardId = cardId,
                    action = request.action,
                    createdAt = null,
                    topicAffinities = listOf(TopicAffinityDto("broom", -2.0, emptyList()))
                )
            }

            val failure = runCatching { repository.syncCards() }.exceptionOrNull()

            assertThat(failure).isInstanceOf(IOException::class.java)
            assertThat(database.cards().pendingFeedbackByAction(FeedbackAction.LIKE.name)).hasSize(1)
            assertThat(database.cards().findTopicAffinity("broom")?.weight).isEqualTo(localWeight)
        }
    }

    @Test
    fun mismatchedFeedbackTopicRetainsOutboxAndDoesNotCreateForeignAffinity() = runBlocking {
        withRepository { database, repository, _, api ->
            repository.sendFeedback(CARD_ID, FeedbackAction.LIKE)
            assertThat(database.cards().pendingFeedbackByAction(FeedbackAction.LIKE.name).single().topicId)
                .isEqualTo("broom")
            api.feedbackResponseFactory = { cardId, request ->
                FeedbackResponse(
                    id = FEEDBACK_ID,
                    cardId = cardId,
                    action = request.action,
                    createdAt = "2026-07-26T00:00:00.000Z",
                    topicAffinities = listOf(TopicAffinityDto("toothbrush", -2.0, emptyList()))
                )
            }

            val failure = runCatching { repository.syncCards() }.exceptionOrNull()

            assertThat(failure).isInstanceOf(IOException::class.java)
            assertThat(database.cards().pendingFeedbackByAction(FeedbackAction.LIKE.name)).hasSize(1)
            assertThat(database.cards().findTopicAffinity("broom")?.weight).isEqualTo(0.35)
            assertThat(database.cards().findTopicAffinity("toothbrush")).isNull()
        }
    }

    @Test
    fun syncedPrivacyReferenceSurvivesIndexClearAndServerRefresh() = runBlocking {
        withRepository { database, repository, _, api ->
            repository.syncCards()
            assertThat(database.cards().findById(CARD_ID)?.privacyPhotoLocalId).isEqualTo(42L)

            database.photos().clear()
            api.cardsHandler = { CardsResponse(listOf(serverCard(title = "server-refreshed")), null) }
            repository.syncCards()

            assertThat(database.cards().findById(CARD_ID)?.privacyPhotoLocalId).isEqualTo(42L)
            repository.sendFeedback(CARD_ID, FeedbackAction.TOO_PRIVATE)
            assertThat(database.photos().isSuppressed(42L)).isTrue()
        }
    }

    @Test
    fun ordinaryFeedbackIsPersistentIdempotentAndKeepsOneEffectiveChoice() = runBlocking {
        withRepository { database, repository, _, api ->
            val first = repository.sendFeedback(CARD_ID, FeedbackAction.LIKE)
            val duplicate = repository.sendFeedback(CARD_ID, FeedbackAction.LIKE)
            val conflicting = repository.sendFeedback(CARD_ID, FeedbackAction.DISLIKE)

            assertThat(first.accepted).isTrue()
            assertThat(first.effectiveAction).isEqualTo(FeedbackAction.LIKE)
            assertThat(duplicate.accepted).isFalse()
            assertThat(duplicate.effectiveAction).isEqualTo(FeedbackAction.LIKE)
            assertThat(conflicting.accepted).isFalse()
            assertThat(conflicting.effectiveAction).isEqualTo(FeedbackAction.LIKE)
            assertThat(repository.observeFeedbackStates().first().single().action)
                .isEqualTo(FeedbackAction.LIKE)
            assertThat(database.cards().pendingFeedback().map { it.action })
                .containsExactly(FeedbackAction.LIKE.name)
            assertThat(database.cards().findTopicAffinity("broom")?.weight).isEqualTo(0.35)

            repository.syncCards()

            assertThat(database.cards().pendingFeedback()).isEmpty()
            assertThat(repository.observeFeedbackStates().first().single().action)
                .isEqualTo(FeedbackAction.LIKE)
            assertThat(api.events.count { it == "feedback:LIKE" }).isEqualTo(1)
            assertThat(api.events).doesNotContain("feedback:DISLIKE")
            assertThat(database.cards().findTopicAffinity("broom")?.weight).isEqualTo(0.4)
        }
    }

    @Test
    fun pausedAnalysisStillAllowsLocalSaveAndPrivacyFeedback() = runBlocking {
        withRepository(initiallyPaused = true) { database, repository, _, api ->
            assertThat(repository.setSaved(CARD_ID, true))
                .isEqualTo(SavedCardUpdateResult(true, true, true))
            assertThat(repository.observeSavedCards().first().single().cardId).isEqualTo(CARD_ID)
            assertThat(database.cards().pendingFeedbackByAction(FeedbackAction.SAVE.name)).hasSize(1)

            val result = repository.sendFeedback(CARD_ID, FeedbackAction.TOO_PRIVATE)

            assertThat(result.accepted).isTrue()
            assertThat(result.cardRemoved).isTrue()
            assertThat(database.cards().findById(CARD_ID)).isNull()
            assertThat(repository.observeSavedCards().first()).isEmpty()
            assertThat(database.cards().pendingFeedback().map { it.action })
                .containsExactly(FeedbackAction.TOO_PRIVATE.name)
            assertThat(database.photos().findById(42L)?.analysisState)
                .isEqualTo(AnalysisState.NEVER_ANALYZE.name)
            assertThat(database.photos().isSuppressed(42L)).isTrue()
            assertThat(api.events).isEmpty()
        }
    }

    @Test
    fun unavailableCardCannotReportAFalseSavedState() = runBlocking {
        withRepository { database, repository, _, _ ->
            database.cards().archiveCard(CARD_ID)

            val archived = repository.setSaved(CARD_ID, true)
            database.cards().deleteById(CARD_ID)
            val missing = repository.setSaved(CARD_ID, true)

            assertThat(archived).isEqualTo(SavedCardUpdateResult(false, false, false))
            assertThat(missing).isEqualTo(SavedCardUpdateResult(false, false, false))
            assertThat(database.cards().pendingFeedbackByAction(FeedbackAction.SAVE.name)).isEmpty()
            assertThat(repository.observeSavedCards().first()).isEmpty()
        }
    }

    @Test
    fun wrongObjectHidesCardRevokesSaveAndCannotBeResurrectedByStaleSync() = runBlocking {
        withRepository { database, repository, _, api ->
            repository.setSaved(CARD_ID, true)
            repository.sendFeedback(CARD_ID, FeedbackAction.LIKE)
            repository.track(CARD_ID, LocalDate.parse("2026-07-20"), 90)
            assertThat(database.cards().findTopicAffinity("broom")?.weight).isEqualTo(0.85)

            val result = repository.sendFeedback(CARD_ID, FeedbackAction.WRONG_OBJECT)

            assertThat(result.accepted).isTrue()
            assertThat(database.cards().findById(CARD_ID)?.status).isEqualTo("archived")
            assertThat(repository.observeSavedCards().first()).isEmpty()
            assertThat(repository.observeFeedbackStates().first().single().action)
                .isEqualTo(FeedbackAction.WRONG_OBJECT)
            assertThat(database.cards().pendingFeedback().map { it.action })
                .containsExactly(FeedbackAction.WRONG_OBJECT.name)
            assertThat(database.cards().findTopicAffinity("broom")?.weight).isEqualTo(0.0)
            assertThat(database.cards().findTrackedItem(CARD_ID)?.syncAction).isEqualTo("DELETE")

            // Reproduce a stale server page and an older local write arriving while the
            // terminal feedback is in flight. The outbox must remain a display barrier.
            api.onSuccessfulPrivacy = { database.cards().upsertAll(listOf(localCard())) }
            var outboxPresentDuringDownload = false
            api.onCards = {
                outboxPresentDuringDownload = database.cards().pendingFeedback()
                    .any { it.cardId == CARD_ID && it.action == FeedbackAction.WRONG_OBJECT.name }
            }
            api.cardsHandler = { CardsResponse(listOf(serverCard()), null) }

            repository.syncCards()

            assertThat(api.events.indexOf("feedback:WRONG_OBJECT"))
                .isLessThan(api.events.indexOf("cards"))
            assertThat(outboxPresentDuringDownload).isTrue()
            assertThat(database.cards().findById(CARD_ID)?.status).isEqualTo("archived")
            assertThat(repository.observeSavedCards().first()).isEmpty()
            assertThat(database.cards().pendingFeedback()).isEmpty()
            assertThat(api.events).doesNotContain("feedback:SAVE")
            assertThat(api.events).doesNotContain("feedback:LIKE")
            assertThat(api.events).contains("cancelTracking:$CARD_ID")
            assertThat(database.cards().findTrackedItem(CARD_ID)).isNull()
        }
    }

    @Test
    fun tooPrivateDropsSaveOutboxBeforeRemoteDeletion() = runBlocking {
        withRepository { database, repository, _, api ->
            repository.setSaved(CARD_ID, true)
            repository.sendFeedback(CARD_ID, FeedbackAction.LIKE)
            assertThat(database.cards().findTopicAffinity("broom")?.weight).isEqualTo(0.85)

            repository.sendFeedback(CARD_ID, FeedbackAction.TOO_PRIVATE)

            assertThat(repository.observeSavedCards().first()).isEmpty()
            assertThat(repository.observeFeedbackStates().first()).isEmpty()
            assertThat(database.cards().findById(CARD_ID)).isNull()
            assertThat(database.cards().pendingFeedback().map { it.action })
                .containsExactly(FeedbackAction.TOO_PRIVATE.name)
            assertThat(database.cards().findTopicAffinity("broom")?.weight).isEqualTo(-0.75)

            repository.syncCards()

            assertThat(api.events).contains("feedback:TOO_PRIVATE")
            assertThat(api.events).doesNotContain("feedback:SAVE")
            assertThat(api.events).doesNotContain("feedback:LIKE")
            assertThat(database.cards().pendingFeedback()).isEmpty()
        }
    }

    @Test
    fun invalidSourceOnLaterPageLeavesExistingCacheUntouched() = runBlocking {
        withRepository { database, repository, _, api ->
            database.cards().enqueueFeedback(
                PendingFeedbackEntity(
                    cardId = CARD_ID,
                    action = FeedbackAction.LIKE.name,
                    createdAtMillis = 10L
                )
            )
            api.cardsHandler = { cursor ->
                if (cursor == null) {
                    CardsResponse(listOf(serverCard(title = "server-updated")), SECOND_PAGE_CURSOR)
                } else {
                    CardsResponse(
                        listOf(
                            serverCard(
                                cardId = MALFORMED_CARD_ID,
                                sources = listOf(validSource().copy(url = "javascript:alert(1)"))
                            )
                        ),
                        null
                    )
                }
            }

            val error = runCatching { repository.syncCards() }.exceptionOrNull()

            assertThat(error).isInstanceOf(IOException::class.java)
            assertThat(database.cards().findById(CARD_ID)?.title).isEqualTo("local-original")
            assertThat(database.cards().findById(MALFORMED_CARD_ID)).isNull()
            assertThat(database.cards().pendingFeedback().map { it.action })
                .containsExactly(FeedbackAction.LIKE.name)
            assertThat(api.events).doesNotContain("feedback:LIKE")
        }
    }

    @Test
    fun validPublicHttpsSourceIsStoredAfterCompletePagination() = runBlocking {
        withRepository { database, repository, _, api ->
            api.cardsHandler = { CardsResponse(listOf(serverCard(title = "server-updated")), null) }

            repository.syncCards()

            val stored = database.cards().findById(CARD_ID)!!.toDomain()
            assertThat(stored.title).isEqualTo("server-updated")
            assertThat(stored.sources.single().url).isEqualTo("https://example.com/reference")
        }
    }

    @Test
    fun foreignCandidateOnLaterPageLeavesExistingCacheUntouched() = runBlocking {
        withRepository { database, repository, _, api ->
            api.cardsHandler = { cursor ->
                if (cursor == null) {
                    CardsResponse(listOf(serverCard(title = "server-updated")), SECOND_PAGE_CURSOR)
                } else {
                    CardsResponse(
                        listOf(
                            serverCard(
                                cardId = MALFORMED_CARD_ID,
                                candidateToken = FOREIGN_CANDIDATE_TOKEN
                            )
                        ),
                        null
                    )
                }
            }

            val error = runCatching { repository.syncCards() }.exceptionOrNull()

            assertThat(error).isInstanceOf(IOException::class.java)
            assertThat(database.cards().findById(CARD_ID)?.title).isEqualTo("local-original")
            assertThat(database.cards().findById(MALFORMED_CARD_ID)).isNull()
        }
    }

    @Test
    fun corruptLegacyRoomSourceIsFilteredWithoutCrashing() = runBlocking {
        withRepository { database, _, _, _ ->
            database.cards().upsertAll(
                listOf(
                    localCard().copy(
                        sources = """[{"sourceId":"bad","title":"Bad","url":"intent://settings","publisher":"Bad","authority":"official"}]"""
                    )
                )
            )

            val restored = database.cards().findById(CARD_ID)!!.toDomain()

            assertThat(restored.sources).isEmpty()
        }
    }

    @Test
    fun privacyFeedbackRunsBeforeDownloadAndCannotBeResurrected() = runBlocking {
        withRepository { database, repository, identity, api ->
            database.photos().clear()
            repository.sendFeedback(CARD_ID, FeedbackAction.TOO_PRIVATE)
            assertThat(database.cards().findById(CARD_ID)).isNull()
            assertThat(database.photos().findByToken(CANDIDATE_TOKEN)).isNull()
            assertThat(database.cards().pendingFeedback().single().action)
                .isEqualTo(FeedbackAction.TOO_PRIVATE.name)

            // Simulate the exact older-build failure: the card reappears while the feedback call
            // is in flight, and the server card page is stale for one read.
            api.onSuccessfulPrivacy = { database.cards().upsertAll(listOf(localCard())) }
            var outboxPresentDuringCardDownload = false
            api.onCards = {
                outboxPresentDuringCardDownload = database.cards().pendingFeedback()
                    .any { it.cardId == CARD_ID && it.action == FeedbackAction.TOO_PRIVATE.name }
            }
            repository.syncCards()

            assertThat(api.events.indexOf("feedback:TOO_PRIVATE"))
                .isLessThan(api.events.indexOf("cards"))
            assertThat(database.cards().findById(CARD_ID)).isNull()
            assertThat(database.cards().pendingFeedback()).isEmpty()
            assertThat(outboxPresentDuringCardDownload).isTrue()
            identity.reset()
        }
    }

    @Test
    fun failedPrivacyFeedbackBlocksDownloadAndKeepsOutbox() = runBlocking {
        withRepository { database, repository, identity, api ->
            repository.sendFeedback(CARD_ID, FeedbackAction.TOO_PRIVATE)
            api.failPrivacy = true

            val error = runCatching { repository.syncCards() }.exceptionOrNull()

            assertThat(error).isInstanceOf(HttpException::class.java)
            assertThat((error as HttpException).code()).isEqualTo(503)
            assertThat(api.events).doesNotContain("cards")
            assertThat(database.cards().findById(CARD_ID)).isNull()
            assertThat(database.cards().pendingFeedback().single().action)
                .isEqualTo(FeedbackAction.TOO_PRIVATE.name)
            identity.reset()
        }
    }

    @Test
    fun failedCloudDeletionPreservesCardsFeedbackAndTrackedOutbox() = runBlocking {
        withRepository { database, repository, identity, api ->
            assertThat(identity.bearer()).isEqualTo("Bearer $DEVICE_TOKEN")
            repository.sendFeedback(CARD_ID, FeedbackAction.LIKE)
            repository.track(CARD_ID, LocalDate.parse("2026-07-20"), 90)
            api.failDelete = true

            val error = runCatching { repository.clearCloudData() }.exceptionOrNull()

            assertThat(error).isInstanceOf(HttpException::class.java)
            assertThat((error as HttpException).code()).isEqualTo(503)
            assertThat(database.cards().findById(CARD_ID)).isNotNull()
            assertThat(database.cards().pendingFeedback().single().action).isEqualTo(FeedbackAction.LIKE.name)
            assertThat(database.cards().pendingTrackedItems().single().cardId).isEqualTo(CARD_ID)
            assertThat(identity.existingBearer()).isEqualTo("Bearer $DEVICE_TOKEN")
        }
    }

    @Test
    fun successfulCloudDeletionClearsCardsOutboxesAndIdentity() = runBlocking {
        withRepository { database, repository, identity, api ->
            assertThat(identity.bearer()).isEqualTo("Bearer $DEVICE_TOKEN")
            database.photos().upsert(candidate())
            repository.setSaved(CARD_ID, true)
            repository.sendFeedback(CARD_ID, FeedbackAction.LIKE)
            repository.track(CARD_ID, LocalDate.parse("2026-07-20"), 90)

            repository.clearCloudData()

            assertThat(api.deleteCalls).isEqualTo(1)
            assertThat(database.cards().findById(CARD_ID)).isNull()
            assertThat(database.cards().pendingFeedback()).isEmpty()
            assertThat(database.cards().pendingTrackedItems()).isEmpty()
            assertThat(repository.observeSavedCards().first()).isEmpty()
            assertThat(database.photos().findById(42L)?.analysisState)
                .isEqualTo(AnalysisState.READY.name)
            assertThat(identity.existingBearer()).isNull()
        }
    }

    private suspend fun withRepository(
        firstCardMetrics: FirstCardMetricRecorder = FirstCardMetricRecorder {},
        initiallyPaused: Boolean = false,
        block: suspend (
            JianweiDatabase,
            RoomCardRepository,
            DeviceIdentity,
            RecordingApi
        ) -> Unit
    ) {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val pipelinePreferences =
            context.getSharedPreferences(DailyPipelineKickWorker.PREFS, Context.MODE_PRIVATE)
        pipelinePreferences.edit().clear().putBoolean(
            DailyPipelineKickWorker.KEY_PAUSED,
            initiallyPaused
        ).commit()
        val database = Room.inMemoryDatabaseBuilder(context, JianweiDatabase::class.java).build()
        val api = RecordingApi()
        api.cardsHandler = { CardsResponse(listOf(serverCard()), null) }
        val identity = DeviceIdentity(context, api, DeviceTokenCipher())
        identity.reset()
        try {
            database.photos().upsert(candidate())
            database.cards().upsertAll(listOf(localCard()))
            val photoRepository = MediaPhotoRepository(context, context.contentResolver, database.photos())
            val repository = RoomCardRepository(
                database.cards(),
                database.photos(),
                photoRepository,
                api,
                identity,
                AnalysisSessionGate(context),
                LocalTopicAffinityStore(database.cards()),
                firstCardMetrics
            )
            block(database, repository, identity, api)
        } finally {
            runCatching { identity.reset() }
            pipelinePreferences.edit().clear().commit()
            database.close()
        }
    }

    private fun candidate() = PhotoCandidateEntity(
        localId = 42,
        candidateToken = CANDIDATE_TOKEN,
        contentUri = "content://media/external/images/media/42",
        capturedAtMillis = 1,
        modifiedAtMillis = 1,
        sourceDigest = null,
        perceptualHash = 42,
        qualityScore = 0.9,
        localLabels = listOf("broom"),
        sensitiveFlags = emptySet(),
        analysisState = AnalysisState.COMPLETED.name,
        origin = PhotoOrigin.MEDIA_STORE.name,
        width = 100,
        height = 100
    )

    private fun localCard() = CardEntity(
        cardId = CARD_ID,
        candidateToken = CANDIDATE_TOKEN,
        photoUri = "content://media/external/images/media/42",
        topicId = "broom",
        factId = "broom-001",
        title = "local-original",
        detectedObjectName = "扫帚",
        body = "事实",
        personalContext = "原因",
        confidence = 0.9,
        sources = "[]",
        status = "scheduled",
        scheduledDate = "2026-07-20",
        createdAtMillis = 1
    )

    private class RecordingApi : JianweiApi {
        val events = mutableListOf<String>()
        var failPrivacy = false
        var failDelete = false
        var deleteCalls = 0
        var onSuccessfulPrivacy: suspend () -> Unit = {}
        var onCards: suspend () -> Unit = {}
        var cardsHandler: suspend (String?) -> CardsResponse = { error("cards handler not configured") }
        var feedbackResponseFactory: (String, FeedbackRequest) -> FeedbackResponse = { cardId, request ->
            FeedbackResponse(
                id = FEEDBACK_ID,
                cardId = cardId,
                action = request.action,
                createdAt = "2026-07-26T00:00:00.000Z",
                topicAffinities = listOf(
                    TopicAffinityDto(
                        "broom",
                        when (request.action) {
                            "LIKE" -> 0.4
                            "SAVE" -> 0.5
                            "DISLIKE" -> -0.4
                            "TOO_PRIVATE" -> -0.8
                            else -> 0.0
                        },
                        emptyList()
                    )
                )
            )
        }
        var trackResponseFactory: (String, TrackRequest) -> TrackItemResponse = { cardId, request ->
            TrackItemResponse(
                id = TRACKED_ITEM_ID,
                cardId = cardId,
                startedOn = request.startedOn,
                reminderDays = request.reminderDays,
                createdAt = "2026-07-26T00:00:00.000Z"
            )
        }
        var untrackResponseFactory: (String) -> UntrackItemResponse = { cardId ->
            UntrackItemResponse(cardId, "untracked")
        }

        override suspend fun register(request: RegisterRequest): RegisterResponse {
            events += "register"
            return RegisterResponse(
                DEVICE_ID,
                DEVICE_TOKEN,
                cn.jianwei.data.network.installationBindingSha256(request.installationId),
                created = events.count { it == "register" } == 1
            )
        }

        override suspend fun cards(authorization: String, cursor: String?, limit: Int): CardsResponse {
            events += "cards"
            onCards()
            return cardsHandler(cursor)
        }

        override suspend fun feedback(
            authorization: String,
            cardId: String,
            request: FeedbackRequest
        ): Response<FeedbackResponse> {
            events += "feedback:${request.action}"
            if (failPrivacy) return Response.error(503, "unavailable".toResponseBody())
            onSuccessfulPrivacy()
            return Response.success(feedbackResponseFactory(cardId, request))
        }

        override suspend fun createJob(
            authorization: String,
            request: CreateJobRequest
        ): CreateJobResponse = error("unused")

        override suspend fun completeJob(
            authorization: String,
            jobId: String
        ): CompleteJobResponse = error("unused")

        override suspend fun track(
            authorization: String,
            cardId: String,
            request: TrackRequest
        ): TrackItemResponse {
            events += "track:$cardId"
            return trackResponseFactory(cardId, request)
        }

        override suspend fun cancelTracking(authorization: String, cardId: String): UntrackItemResponse {
            events += "cancelTracking:$cardId"
            return untrackResponseFactory(cardId)
        }

        override suspend fun deleteDeviceData(authorization: String): DeleteDeviceDataResponse {
            deleteCalls += 1
            if (failDelete) throw HttpException(Response.error<Any>(503, "unavailable".toResponseBody()))
            check(authorization == "Bearer $DEVICE_TOKEN")
            return DeleteDeviceDataResponse(DEVICE_ID, "deleted")
        }

    }

    private fun serverCard(
        cardId: String = CARD_ID,
        candidateToken: String = CANDIDATE_TOKEN,
        title: String = "server-card",
        sources: List<SourceDto> = listOf(validSource())
    ) = CardDto(
        cardId = cardId,
        candidateToken = candidateToken,
        topicId = "broom",
        factId = "broom-001",
        title = title,
        detectedObjectName = "扫帚",
        body = "fact",
        personalContext = "context",
        confidence = 0.9,
        sources = sources,
        status = "scheduled",
        scheduledDate = "2026-07-20",
        createdAt = "2026-07-20T00:00:00Z"
    )

    private fun validSource() = SourceDto(
        sourceId = "source-one",
        title = "Reference",
        url = "https://example.com/reference",
        publisher = "Example",
        authority = "reference"
    )

    private companion object {
        const val DEVICE_ID = "00000000-0000-4000-8000-000000000001"
        const val DEVICE_TOKEN = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
        const val CARD_ID = "2a7d8040-f311-4e83-a38c-1bcd09f21961"
        const val MALFORMED_CARD_ID = "f8dd6a8b-5d4a-4c5a-881d-cddad8fd52c5"
        const val CANDIDATE_TOKEN = "7ff7a59e-2791-38b4-bdbe-3e8274eed084"
        const val FOREIGN_CANDIDATE_TOKEN = "2a8c945f-767d-4c59-bce1-7b9a3c192fef"
        const val SECOND_PAGE_CURSOR = "8a1b6f90-2c14-4ea9-96a4-9a2416778880"
        const val FEEDBACK_ID = "16d3e259-3ec1-4232-b542-f9a7d8719464"
        const val TRACKED_ITEM_ID = "a542bed7-fca8-43b1-8b7a-ff21f196d0d1"
    }
}
