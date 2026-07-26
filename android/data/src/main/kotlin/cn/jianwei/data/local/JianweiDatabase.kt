package cn.jianwei.data.local

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverters
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(
    entities = [
        PhotoCandidateEntity::class,
        CardEntity::class,
        SavedCardEntity::class,
        CardFeedbackStateEntity::class,
        PendingFeedbackEntity::class,
        TrackedItemEntity::class,
        SuppressedPhotoEntity::class,
        MediaScanCursorEntity::class,
        TopicAffinityEntity::class
    ],
    version = 13,
    exportSchema = true
)
@TypeConverters(Converters::class)
abstract class JianweiDatabase : RoomDatabase() {
    abstract fun photos(): PhotoDao
    abstract fun cards(): CardDao
}

val MIGRATION_1_2 = object : Migration(1, 2) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS `suppressed_photos` (`localId` INTEGER NOT NULL, `suppressedAtMillis` INTEGER NOT NULL, PRIMARY KEY(`localId`))"
        )
    }
}

val MIGRATION_2_3 = object : Migration(2, 3) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE `photo_candidates` ADD COLUMN `sourceDigest` TEXT")
        db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS `index_photo_candidates_sourceDigest` ON `photo_candidates` (`sourceDigest`)")
    }
}

val MIGRATION_3_4 = object : Migration(3, 4) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS `media_scan_cursors` (" +
                "`accessScope` TEXT NOT NULL, `freshnessSeconds` INTEGER NOT NULL, " +
                "`mediaId` INTEGER NOT NULL, `updatedAtMillis` INTEGER NOT NULL, " +
                "PRIMARY KEY(`accessScope`))"
        )
    }
}

val MIGRATION_4_5 = object : Migration(4, 5) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS `topic_affinities` (" +
                "`topicId` TEXT NOT NULL, `weight` REAL NOT NULL, " +
                "`aliases` TEXT NOT NULL, `updatedAtMillis` INTEGER NOT NULL, " +
                "PRIMARY KEY(`topicId`))"
        )
    }
}

val MIGRATION_5_6 = object : Migration(5, 6) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS `pending_tracked_items` (" +
                "`cardId` TEXT NOT NULL, `startedOn` TEXT NOT NULL, " +
                "`reminderDays` INTEGER NOT NULL, `updatedAtMillis` INTEGER NOT NULL, " +
                "PRIMARY KEY(`cardId`))"
        )
    }
}

val MIGRATION_6_7 = object : Migration(6, 7) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS `local_tracked_items` (" +
                "`cardId` TEXT NOT NULL, `startedOn` TEXT NOT NULL, " +
                "`reminderDays` INTEGER NOT NULL, `syncAction` TEXT NOT NULL, " +
                "`updatedAtMillis` INTEGER NOT NULL, PRIMARY KEY(`cardId`))"
        )
        db.execSQL(
            "INSERT OR REPLACE INTO `local_tracked_items` " +
                "(`cardId`, `startedOn`, `reminderDays`, `syncAction`, `updatedAtMillis`) " +
                "SELECT `cardId`, `startedOn`, `reminderDays`, 'UPSERT', `updatedAtMillis` " +
                "FROM `pending_tracked_items`"
        )
        db.execSQL("DROP TABLE `pending_tracked_items`")
        db.execSQL(
            "CREATE INDEX IF NOT EXISTS `index_local_tracked_items_syncAction` " +
                "ON `local_tracked_items` (`syncAction`)"
        )
    }
}

val MIGRATION_7_8 = object : Migration(7, 8) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS `saved_cards` (" +
                "`cardId` TEXT NOT NULL, `isSaved` INTEGER NOT NULL, " +
                "`feedbackSignaled` INTEGER NOT NULL, `savedAtMillis` INTEGER NOT NULL, " +
                "`updatedAtMillis` INTEGER NOT NULL, PRIMARY KEY(`cardId`), " +
                "FOREIGN KEY(`cardId`) REFERENCES `knowledge_cards`(`cardId`) " +
                "ON UPDATE NO ACTION ON DELETE CASCADE)"
        )
        db.execSQL(
            "CREATE INDEX IF NOT EXISTS `index_saved_cards_isSaved` ON `saved_cards` (`isSaved`)"
        )
        db.execSQL(
            "CREATE INDEX IF NOT EXISTS `index_saved_cards_savedAtMillis` ON `saved_cards` (`savedAtMillis`)"
        )
    }
}

val MIGRATION_8_9 = object : Migration(8, 9) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
            "ALTER TABLE `knowledge_cards` ADD COLUMN `detectedObjectName` TEXT NOT NULL DEFAULT ''"
        )
    }
}

val MIGRATION_9_10 = object : Migration(9, 10) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS `card_feedback_states` (" +
                "`cardId` TEXT NOT NULL, `action` TEXT NOT NULL, " +
                "`submittedAtMillis` INTEGER NOT NULL, PRIMARY KEY(`cardId`), " +
                "FOREIGN KEY(`cardId`) REFERENCES `knowledge_cards`(`cardId`) " +
                "ON UPDATE NO ACTION ON DELETE CASCADE)"
        )
        // Older builds allowed several ordinary actions for one card. Preserve the latest
        // pending choice and compact the rest so the new one-choice invariant starts cleanly.
        db.execSQL(
            "INSERT OR IGNORE INTO `card_feedback_states` (`cardId`, `action`, `submittedAtMillis`) " +
                "SELECT feedback.cardId, feedback.action, feedback.createdAtMillis " +
                "FROM pending_feedback AS feedback " +
                "INNER JOIN knowledge_cards AS cards ON cards.cardId = feedback.cardId " +
                "WHERE feedback.action IN ('LIKE', 'DISLIKE', 'WRONG_OBJECT') " +
                "AND feedback.id = (SELECT latest.id FROM pending_feedback AS latest " +
                "WHERE latest.cardId = feedback.cardId " +
                "AND latest.action IN ('LIKE', 'DISLIKE', 'WRONG_OBJECT') " +
                "ORDER BY latest.createdAtMillis DESC, latest.id DESC LIMIT 1)"
        )
        db.execSQL(
            "DELETE FROM pending_feedback WHERE action IN ('LIKE', 'DISLIKE', 'WRONG_OBJECT') " +
                "AND NOT EXISTS (SELECT 1 FROM card_feedback_states AS state " +
                "WHERE state.cardId = pending_feedback.cardId " +
                "AND state.action = pending_feedback.action " +
                "AND state.submittedAtMillis = pending_feedback.createdAtMillis)"
        )
    }
}

val MIGRATION_10_11 = object : Migration(10, 11) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE `knowledge_cards` ADD COLUMN `privacyPhotoLocalId` INTEGER")
        db.execSQL(
            "UPDATE `knowledge_cards` SET `privacyPhotoLocalId` = (" +
                "SELECT photo.localId FROM `photo_candidates` AS photo " +
                "WHERE photo.candidateToken = `knowledge_cards`.candidateToken LIMIT 1)"
        )
    }
}

val MIGRATION_11_12 = object : Migration(11, 12) {
    override fun migrate(db: SupportSQLiteDatabase) {
        // Existing reminders may already have a durable WorkManager request. Only reminders
        // created or updated by version 12 enter the explicit local-scheduling outbox.
        db.execSQL(
            "ALTER TABLE `local_tracked_items` " +
                "ADD COLUMN `localSchedulePending` INTEGER NOT NULL DEFAULT 0"
        )
    }
}

val MIGRATION_12_13 = object : Migration(12, 13) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE `pending_feedback` ADD COLUMN `topicId` TEXT")
        db.execSQL(
            "UPDATE `pending_feedback` SET `topicId` = (" +
                "SELECT cards.topicId FROM `knowledge_cards` AS cards " +
                "WHERE cards.cardId = `pending_feedback`.cardId LIMIT 1)"
        )
    }
}

fun buildJianweiDatabase(context: Context): JianweiDatabase =
    Room.databaseBuilder(context.applicationContext, JianweiDatabase::class.java, "jianwei.db")
        .addMigrations(
            MIGRATION_1_2,
            MIGRATION_2_3,
            MIGRATION_3_4,
            MIGRATION_4_5,
            MIGRATION_5_6,
            MIGRATION_6_7,
            MIGRATION_7_8,
            MIGRATION_8_9,
            MIGRATION_9_10,
            MIGRATION_10_11,
            MIGRATION_11_12,
            MIGRATION_12_13
        )
        .fallbackToDestructiveMigrationOnDowngrade(dropAllTables = true)
        .build()
