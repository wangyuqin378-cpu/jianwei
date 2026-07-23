package cn.jianwei.data.local

import androidx.room.testing.MigrationTestHelper
import androidx.test.platform.app.InstrumentationRegistry
import com.google.common.truth.Truth.assertThat
import java.io.IOException
import org.junit.Rule
import org.junit.Test

class DatabaseMigrationInstrumentedTest {
    @get:Rule
    val helper = MigrationTestHelper(
        InstrumentationRegistry.getInstrumentation(),
        JianweiDatabase::class.java
    )

    @Test
    @Throws(IOException::class)
    fun migratesVersion2To3AndEnforcesSourceDigestUniqueness() {
        helper.createDatabase(TEST_DATABASE, 2).apply {
            execSQL(
                "INSERT INTO photo_candidates VALUES " +
                    "(1, 'candidate-1', 'file:///one', 1, 1, NULL, 0.9, '[]', '[]', 'READY', 'PHOTO_PICKER', 100, 100)"
            )
            close()
        }

        helper.runMigrationsAndValidate(TEST_DATABASE, 3, true, MIGRATION_2_3).use { database ->
            database.query("PRAGMA table_info(photo_candidates)").use { cursor ->
                val nameIndex = cursor.getColumnIndexOrThrow("name")
                val columns = buildList {
                    while (cursor.moveToNext()) add(cursor.getString(nameIndex))
                }
                assertThat(columns).contains("sourceDigest")
            }
            database.execSQL("UPDATE photo_candidates SET sourceDigest = 'same-digest' WHERE localId = 1")
            val duplicateRejected = runCatching {
                database.execSQL(
                    "INSERT INTO photo_candidates " +
                        "(localId, candidateToken, contentUri, capturedAtMillis, modifiedAtMillis, perceptualHash, qualityScore, localLabels, sensitiveFlags, analysisState, origin, width, height, sourceDigest) " +
                        "VALUES (2, 'candidate-2', 'file:///two', 2, 2, NULL, 0.8, '[]', '[]', 'READY', 'PHOTO_PICKER', 100, 100, 'same-digest')"
                )
            }.isFailure
            assertThat(duplicateRejected).isTrue()
        }
    }

    @Test
    @Throws(IOException::class)
    fun migratesVersion3To4AndPersistsIndependentAccessCursors() {
        helper.createDatabase(CURSOR_DATABASE, 3).close()

        helper.runMigrationsAndValidate(CURSOR_DATABASE, 4, true, MIGRATION_3_4).use { database ->
            database.execSQL(
                "INSERT INTO media_scan_cursors " +
                    "(accessScope, freshnessSeconds, mediaId, updatedAtMillis) " +
                    "VALUES ('FULL', 100, 42, 1000), ('PARTIAL', 90, 12, 1000)"
            )
            database.query("SELECT COUNT(*) FROM media_scan_cursors").use { cursor ->
                assertThat(cursor.moveToFirst()).isTrue()
                assertThat(cursor.getInt(0)).isEqualTo(2)
            }
        }
    }

    @Test
    @Throws(IOException::class)
    fun migratesVersion4To5AndPersistsTopicAffinity() {
        helper.createDatabase(AFFINITY_DATABASE, 4).close()

        helper.runMigrationsAndValidate(AFFINITY_DATABASE, 5, true, MIGRATION_4_5).use { database ->
            database.execSQL(
                "INSERT INTO topic_affinities " +
                    "(topicId, weight, aliases, updatedAtMillis) " +
                    "VALUES ('toothbrush', 0.5, '[\"toothbrush\"]', 1000)"
            )
            database.query("SELECT weight FROM topic_affinities WHERE topicId = 'toothbrush'").use { cursor ->
                assertThat(cursor.moveToFirst()).isTrue()
                assertThat(cursor.getDouble(0)).isEqualTo(0.5)
            }
        }
    }

    @Test
    @Throws(IOException::class)
    fun migratesVersion5To6AndPersistsReminderSyncOutbox() {
        helper.createDatabase(REMINDER_DATABASE, 5).close()

        helper.runMigrationsAndValidate(REMINDER_DATABASE, 6, true, MIGRATION_5_6).use { database ->
            database.execSQL(
                "INSERT INTO pending_tracked_items " +
                    "(cardId, startedOn, reminderDays, updatedAtMillis) " +
                    "VALUES ('card-1', '2026-07-18', 120, 1000)"
            )
            database.query(
                "SELECT startedOn, reminderDays FROM pending_tracked_items WHERE cardId = 'card-1'"
            ).use { cursor ->
                assertThat(cursor.moveToFirst()).isTrue()
                assertThat(cursor.getString(0)).isEqualTo("2026-07-18")
                assertThat(cursor.getInt(1)).isEqualTo(120)
            }
        }
    }

    @Test
    @Throws(IOException::class)
    fun migratesVersion6To7AndPreservesActiveReminderState() {
        helper.createDatabase(REMINDER_STATE_DATABASE, 6).apply {
            execSQL(
                "INSERT INTO pending_tracked_items " +
                    "(cardId, startedOn, reminderDays, updatedAtMillis) " +
                    "VALUES ('card-2', '2026-07-18', 180, 2000)"
            )
            close()
        }

        helper.runMigrationsAndValidate(REMINDER_STATE_DATABASE, 7, true, MIGRATION_6_7).use { database ->
            database.query(
                "SELECT startedOn, reminderDays, syncAction FROM local_tracked_items WHERE cardId = 'card-2'"
            ).use { cursor ->
                assertThat(cursor.moveToFirst()).isTrue()
                assertThat(cursor.getString(0)).isEqualTo("2026-07-18")
                assertThat(cursor.getInt(1)).isEqualTo(180)
                assertThat(cursor.getString(2)).isEqualTo("UPSERT")
            }
        }
    }

    @Test
    @Throws(IOException::class)
    fun migratesVersion7To8PreservesCardsAndCascadesSavedState() {
        helper.createDatabase(SAVED_CARDS_DATABASE, 7).apply {
            execSQL(
                "INSERT INTO knowledge_cards " +
                    "(cardId, candidateToken, photoUri, topicId, factId, title, body, personalContext, " +
                    "confidence, sources, status, scheduledDate, createdAtMillis) VALUES " +
                    "('card-saved', 'candidate-saved', '', 'broom', 'broom-001', 'Broom', 'Fact', " +
                    "'Context', 0.9, '[]', 'scheduled', '2026-07-21', 1)"
            )
            close()
        }

        helper.runMigrationsAndValidate(SAVED_CARDS_DATABASE, 8, true, MIGRATION_7_8).use { database ->
            database.query("SELECT title FROM knowledge_cards WHERE cardId = 'card-saved'").use { cursor ->
                assertThat(cursor.moveToFirst()).isTrue()
                assertThat(cursor.getString(0)).isEqualTo("Broom")
            }
            database.query("PRAGMA foreign_key_list(saved_cards)").use { cursor ->
                val tableIndex = cursor.getColumnIndexOrThrow("table")
                val deleteIndex = cursor.getColumnIndexOrThrow("on_delete")
                assertThat(cursor.moveToFirst()).isTrue()
                assertThat(cursor.getString(tableIndex)).isEqualTo("knowledge_cards")
                assertThat(cursor.getString(deleteIndex)).isEqualTo("CASCADE")
            }
            // MigrationTestHelper opens a bare SQLite connection. Room enables foreign
            // keys in production, so mirror that runtime setting before proving the cascade.
            database.execSQL("PRAGMA foreign_keys=ON")
            database.execSQL(
                "INSERT INTO saved_cards " +
                    "(cardId, isSaved, feedbackSignaled, savedAtMillis, updatedAtMillis) " +
                    "VALUES ('card-saved', 1, 1, 1000, 1000)"
            )
            database.execSQL("DELETE FROM knowledge_cards WHERE cardId = 'card-saved'")
            database.query("SELECT COUNT(*) FROM saved_cards").use { cursor ->
                assertThat(cursor.moveToFirst()).isTrue()
                assertThat(cursor.getInt(0)).isEqualTo(0)
            }
        }
    }

    @Test
    @Throws(IOException::class)
    fun migratesVersion8To9PreservesLegacyCardAndAddsDetectedObjectName() {
        helper.createDatabase(OBJECT_NAME_DATABASE, 8).apply {
            execSQL(
                "INSERT INTO knowledge_cards " +
                    "(cardId, candidateToken, photoUri, topicId, factId, title, body, personalContext, " +
                    "confidence, sources, status, scheduledDate, createdAtMillis) VALUES " +
                    "('card-object', 'candidate-object', '', 'toothbrush', 'toothbrush-001', " +
                    "'牙刷刷毛的设计', 'Fact', 'Context', 0.9, '[]', 'scheduled', '2026-07-23', 1)"
            )
            close()
        }

        helper.runMigrationsAndValidate(OBJECT_NAME_DATABASE, 9, true, MIGRATION_8_9).use { database ->
            database.query(
                "SELECT title, detectedObjectName FROM knowledge_cards WHERE cardId = 'card-object'"
            ).use { cursor ->
                assertThat(cursor.moveToFirst()).isTrue()
                assertThat(cursor.getString(0)).isEqualTo("牙刷刷毛的设计")
                assertThat(cursor.getString(1)).isEmpty()
            }
        }
    }

    private companion object {
        const val TEST_DATABASE = "migration-2-3-test"
        const val CURSOR_DATABASE = "migration-3-4-cursor-test"
        const val AFFINITY_DATABASE = "migration-4-5-affinity-test"
        const val REMINDER_DATABASE = "migration-5-6-reminder-test"
        const val REMINDER_STATE_DATABASE = "migration-6-7-reminder-state-test"
        const val SAVED_CARDS_DATABASE = "migration-7-8-saved-cards-test"
        const val OBJECT_NAME_DATABASE = "migration-8-9-object-name-test"
    }
}
