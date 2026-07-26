package cn.jianwei.domain.coroutines

import kotlinx.coroutines.CancellationException

/** Never translate structured coroutine cancellation into an ordinary product failure or retry. */
fun Throwable.throwIfCancellation() {
    if (this is CancellationException) throw this
}
