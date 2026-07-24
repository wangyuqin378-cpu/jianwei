package cn.jianwei.data.work

import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** Serializes automatic MediaStore privacy batches without delaying explicit user imports. */
@Singleton
class PrivacyExecutionGate @Inject constructor() {
    private val automaticMutex = Mutex()

    internal suspend fun <T> run(originScope: UploadOriginScope, block: suspend () -> T): T =
        if (originScope == UploadOriginScope.MEDIA_STORE) {
            automaticMutex.withLock { block() }
        } else {
            block()
        }
}
