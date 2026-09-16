import Foundation

enum SharedConstants {
    static let appGroupIdentifier = "group.cn.jianwei.shared"
    static let widgetKind = "JianweiDailyKnowledgeWidget"
    static let widgetStateFilename = "widget-state.json"
    static let widgetLockFilename = "widget-state.lock"
    static let thumbnailDirectory = "thumbnails"
    static let discoveryTaskIdentifier = "cn.jianwei.ios.discovery"
    static let maximumDailySwaps = 2
    // Bump only when the managed photo-understanding or reviewed cloud catalog
    // changes enough that earlier `no_insight` decisions deserve one retry.
    static let managedAnalysisRevision = "qwen-evidence-first-20260908"
}
