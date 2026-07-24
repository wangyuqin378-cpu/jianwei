package cn.jianwei.domain.metrics

fun interface FirstCardMetricRecorder {
    fun recordFirstCardAvailable(nowMillis: Long)
}
