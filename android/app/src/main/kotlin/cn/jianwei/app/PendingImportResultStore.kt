package cn.jianwei.app

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton
import org.json.JSONArray

data class PendingImportResultSnapshot(
    val candidateTokens: List<String>,
    val retryCandidateTokens: List<String>,
    val focusedCardId: String?,
    val notice: ImportedPhotoResultNotice?
)

enum class ImportedPhotoResultNotice {
    NO_MATCH,
    FAILED,
    CANNOT_RETRY
}

/**
 * Durable presentation handoff between WorkManager and the next app session.
 * It stores only opaque random identifiers and a bounded result state; no URI, label, filename,
 * object name or model output is persisted here.
 */
@Singleton
class PendingImportResultStore @Inject constructor(
    @ApplicationContext context: Context
) {
    private val preferences = context.getSharedPreferences(FILE_NAME, Context.MODE_PRIVATE)

    @Synchronized
    fun snapshot(): PendingImportResultSnapshot {
        val tokens = readTokens(KEY_TOKENS)
        val retryTokens = readTokens(KEY_RETRY_TOKENS)
        val focusedCardId = normalizedFocusedCardId(preferences.getString(KEY_FOCUSED_CARD_ID, null))
        val storedNotice = preferences.getString(KEY_NOTICE, null)
            ?.let { name -> runCatching { ImportedPhotoResultNotice.valueOf(name) }.getOrNull() }
        val notice = if (storedNotice == ImportedPhotoResultNotice.FAILED && retryTokens.isEmpty()) {
            ImportedPhotoResultNotice.CANNOT_RETRY
        } else {
            storedNotice
        }
        return PendingImportResultSnapshot(tokens, retryTokens, focusedCardId, notice)
    }

    @Synchronized
    fun remember(candidateTokens: List<String>): List<String> {
        val normalized = normalizedPendingImportTokens(candidateTokens)
        if (normalized.isEmpty()) return emptyList()
        preferences.edit()
            .putString(KEY_TOKENS, JSONArray(normalized).toString())
            .remove(KEY_RETRY_TOKENS)
            .remove(KEY_FOCUSED_CARD_ID)
            .remove(KEY_NOTICE)
            .commit()
        return normalized
    }

    @Synchronized
    fun complete(
        focusedCardId: String?,
        notice: ImportedPhotoResultNotice?,
        retryCandidateTokens: List<String> = emptyList()
    ) {
        val retryTokens = if (notice == ImportedPhotoResultNotice.FAILED) {
            normalizedPendingImportTokens(retryCandidateTokens)
        } else {
            emptyList()
        }
        preferences.edit()
            .putString(KEY_TOKENS, "[]")
            .putString(KEY_RETRY_TOKENS, JSONArray(retryTokens).toString())
            .apply {
                val safeCardId = normalizedFocusedCardId(focusedCardId)
                if (safeCardId == null) remove(KEY_FOCUSED_CARD_ID) else putString(KEY_FOCUSED_CARD_ID, safeCardId)
                if (notice == null) remove(KEY_NOTICE) else putString(KEY_NOTICE, notice.name)
            }
            .commit()
    }

    @Synchronized
    fun retryFailed(): List<String> {
        val snapshot = snapshot()
        if (
            snapshot.notice != ImportedPhotoResultNotice.FAILED ||
            snapshot.retryCandidateTokens.isEmpty()
        ) return emptyList()
        preferences.edit()
            .putString(KEY_TOKENS, JSONArray(snapshot.retryCandidateTokens).toString())
            .remove(KEY_RETRY_TOKENS)
            .remove(KEY_FOCUSED_CARD_ID)
            .remove(KEY_NOTICE)
            .commit()
        return snapshot.retryCandidateTokens
    }

    @Synchronized
    fun setFocusedCard(cardId: String?) {
        preferences.edit().apply {
            val safeCardId = normalizedFocusedCardId(cardId)
            if (safeCardId == null) remove(KEY_FOCUSED_CARD_ID) else putString(KEY_FOCUSED_CARD_ID, safeCardId)
        }.commit()
    }

    @Synchronized
    fun clearNotice() {
        preferences.edit()
            .remove(KEY_NOTICE)
            .remove(KEY_RETRY_TOKENS)
            .commit()
    }

    @Synchronized
    fun clearAll() {
        preferences.edit().clear().commit()
    }

    private fun readTokens(key: String): List<String> = runCatching {
        val array = JSONArray(preferences.getString(key, "[]"))
        normalizedPendingImportTokens(buildList {
            for (index in 0 until minOf(array.length(), MAX_STORED_RESULTS)) {
                add(array.optString(index))
            }
        })
    }.getOrDefault(emptyList())

    private companion object {
        const val FILE_NAME = "pending_import_result"
        const val KEY_TOKENS = "candidate_tokens"
        const val KEY_RETRY_TOKENS = "retry_candidate_tokens"
        const val KEY_FOCUSED_CARD_ID = "focused_card_id"
        const val KEY_NOTICE = "notice"
        const val MAX_STORED_RESULTS = 20
    }
}

internal fun normalizedFocusedCardId(value: String?): String? = value
    ?.trim()
    ?.takeIf { it.length in 1..128 && it.none(Char::isISOControl) }
