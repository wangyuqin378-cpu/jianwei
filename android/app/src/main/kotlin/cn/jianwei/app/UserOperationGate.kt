package cn.jianwei.app

import java.util.concurrent.atomic.AtomicReference

enum class UserOperation(val progressLabel: String) {
    START_DISCOVERY("正在安排照片扫描"),
    IMPORT_PHOTOS("正在导入所选照片"),
    RECORD_FEEDBACK("正在保存反馈"),
    UPDATE_SAVED("正在更新收藏"),
    SET_REMINDER("正在设置物品提醒"),
    CANCEL_REMINDER("正在取消物品提醒"),
    PAUSE_ANALYSIS("正在暂停分析"),
    RESUME_ANALYSIS("正在恢复分析"),
    RETRY_ANALYSIS("正在重新安排分析"),
    CLEAR_LOCAL_INDEX("正在清除本地索引"),
    DELETE_CLOUD_DATA("正在删除云端数据")
}

/**
 * User mutations are deliberately serialized. Room and WorkManager remain the durable consistency
 * boundary; this gate prevents conflicting UI commands from being launched before those boundaries
 * can publish their new state.
 */
internal class UserOperationGate {
    private val active = AtomicReference<UserOperation?>(null)

    fun tryStart(operation: UserOperation): Boolean = active.compareAndSet(null, operation)

    fun finish(operation: UserOperation): Boolean = active.compareAndSet(operation, null)

    fun current(): UserOperation? = active.get()
}
