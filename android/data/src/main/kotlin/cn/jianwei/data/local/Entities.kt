package cn.jianwei.data.local

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "photo_candidates",
    indices = [
        Index(value = ["candidateToken"], unique = true),
        Index(value = ["modifiedAtMillis"]),
        Index(value = ["sourceDigest"], unique = true)
    ]
)
data class PhotoCandidateEntity(
    @PrimaryKey val localId: Long,
    val candidateToken: String,
    val contentUri: String,
    val capturedAtMillis: Long,
    val modifiedAtMillis: Long,
    val sourceDigest: String?,
    val perceptualHash: Long?,
    val qualityScore: Double,
    val localLabels: List<String>,
    val sensitiveFlags: Set<String>,
    val analysisState: String,
    val origin: String,
    val width: Int,
    val height: Int
)

@Entity(tableName = "knowledge_cards", indices = [Index("scheduledDate"), Index("candidateToken")])
data class CardEntity(
    @PrimaryKey val cardId: String,
    val candidateToken: String,
    val photoUri: String,
    // Minimal local-only linkage retained after clearing the photo index so a later
    // TOO_PRIVATE action can still suppress this exact MediaStore/import identity.
    val privacyPhotoLocalId: Long? = null,
    val topicId: String,
    val factId: String,
    val title: String,
    val detectedObjectName: String,
    val body: String,
    val personalContext: String,
    val confidence: Double,
    val sources: String,
    val status: String,
    val scheduledDate: String,
    val createdAtMillis: Long
)

@Entity(
    tableName = "saved_cards",
    foreignKeys = [
        ForeignKey(
            entity = CardEntity::class,
            parentColumns = ["cardId"],
            childColumns = ["cardId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [Index("isSaved"), Index("savedAtMillis")]
)
data class SavedCardEntity(
    @PrimaryKey val cardId: String,
    val isSaved: Boolean,
    val feedbackSignaled: Boolean,
    val savedAtMillis: Long,
    val updatedAtMillis: Long
)

@Entity(
    tableName = "card_feedback_states",
    foreignKeys = [
        ForeignKey(
            entity = CardEntity::class,
            parentColumns = ["cardId"],
            childColumns = ["cardId"],
            onDelete = ForeignKey.CASCADE
        )
    ]
)
data class CardFeedbackStateEntity(
    @PrimaryKey val cardId: String,
    val action: String,
    val submittedAtMillis: Long
)

@Entity(tableName = "pending_feedback", indices = [Index(value = ["cardId", "action"], unique = true)])
data class PendingFeedbackEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val cardId: String,
    val action: String,
    val createdAtMillis: Long
)

@Entity(tableName = "local_tracked_items", indices = [Index("syncAction")])
data class TrackedItemEntity(
    @PrimaryKey val cardId: String,
    val startedOn: String,
    val reminderDays: Int,
    val syncAction: String,
    val updatedAtMillis: Long,
    val localSchedulePending: Boolean = false
)

@Entity(tableName = "suppressed_photos")
data class SuppressedPhotoEntity(
    @PrimaryKey val localId: Long,
    val suppressedAtMillis: Long
)

@Entity(tableName = "media_scan_cursors")
data class MediaScanCursorEntity(
    @PrimaryKey val accessScope: String,
    val freshnessSeconds: Long,
    val mediaId: Long,
    val updatedAtMillis: Long
)

@Entity(tableName = "topic_affinities")
data class TopicAffinityEntity(
    @PrimaryKey val topicId: String,
    val weight: Double,
    val aliases: List<String>,
    val updatedAtMillis: Long
)
