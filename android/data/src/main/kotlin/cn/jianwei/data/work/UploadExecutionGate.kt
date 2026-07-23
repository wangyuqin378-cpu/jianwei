package cn.jianwei.data.work

import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** Serializes upload workers inside the app process. */
@Singleton
class UploadExecutionGate @Inject constructor() {
    private val mutex = Mutex()

    suspend fun <T> runExclusive(block: suspend () -> T): T = mutex.withLock { block() }
}
