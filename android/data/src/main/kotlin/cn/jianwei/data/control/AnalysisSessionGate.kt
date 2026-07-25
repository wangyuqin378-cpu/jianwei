package cn.jianwei.data.control

import android.content.Context
import cn.jianwei.data.work.DailyPipelineKickWorker
import dagger.hilt.android.qualifiers.ApplicationContext
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

class AnalysisStoppedException : IllegalStateException("分析会话已暂停或失效")

internal class SessionBarrier(
    initialEpoch: Long = 0,
    initiallyPaused: Boolean = false
) {
    private val operation = Mutex()
    private val epoch = AtomicLong(initialEpoch)
    private val paused = AtomicBoolean(initiallyPaused)

    suspend fun <T> withActiveSession(block: suspend (AnalysisSessionToken) -> T): T =
        operation.withLock {
            val token = AnalysisSessionToken(this, epoch.get())
            token.requireActive()
            block(token)
        }

    suspend fun <T> withSerializedLocalMutation(block: suspend () -> T): T =
        operation.withLock { block() }

    fun invalidate(): Long {
        paused.set(true)
        return epoch.incrementAndGet()
    }

    suspend fun awaitDrained() {
        operation.withLock { Unit }
    }

    fun resume(): Long {
        val next = epoch.incrementAndGet()
        paused.set(false)
        return next
    }

    fun isPaused(): Boolean = paused.get()

    internal fun requireActive(expectedEpoch: Long) {
        if (paused.get() || epoch.get() != expectedEpoch) throw AnalysisStoppedException()
    }
}

class AnalysisSessionToken internal constructor(
    private val barrier: SessionBarrier,
    private val epoch: Long
) {
    fun requireActive() = barrier.requireActive(epoch)
}

@Singleton
class AnalysisSessionGate @Inject constructor(
    @param:ApplicationContext context: Context
) {
    private val preferences = context.getSharedPreferences(DailyPipelineKickWorker.PREFS, Context.MODE_PRIVATE)
    private val barrier = SessionBarrier(
        initialEpoch = preferences.getLong(KEY_SESSION_EPOCH, 0),
        initiallyPaused = preferences.getBoolean(DailyPipelineKickWorker.KEY_PAUSED, false)
    )

    suspend fun <T> withActiveSession(block: suspend (AnalysisSessionToken) -> T): T =
        barrier.withActiveSession(block)

    /**
     * Serializes a local user action with analysis and sync without requiring analysis to be
     * resumed. Pausing is a transport/analysis barrier; it must not reject local feedback,
     * saved-state changes, or privacy cleanup that can safely remain in the Room outbox.
     */
    suspend fun <T> withSerializedLocalMutation(block: suspend () -> T): T =
        barrier.withSerializedLocalMutation(block)

    fun beginPause() {
        val epoch = barrier.invalidate()
        check(
            preferences.edit()
                .putBoolean(DailyPipelineKickWorker.KEY_PAUSED, true)
                .putLong(KEY_SESSION_EPOCH, epoch)
                .commit()
        ) { "无法持久化暂停状态" }
    }

    suspend fun awaitDrained() = barrier.awaitDrained()

    fun resume() {
        val epoch = barrier.resume()
        check(
            preferences.edit()
                .putBoolean(DailyPipelineKickWorker.KEY_PAUSED, false)
                .putLong(KEY_SESSION_EPOCH, epoch)
                .commit()
        ) { "无法持久化恢复状态" }
    }

    fun isPaused(): Boolean = barrier.isPaused()

    private companion object {
        const val KEY_SESSION_EPOCH = "analysis_session_epoch"
    }
}
