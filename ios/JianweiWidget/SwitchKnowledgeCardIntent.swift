import AppIntents
import WidgetKit

struct SwitchKnowledgeCardIntent: AppIntent {
    static let title: LocalizedStringResource = "换一条知识"
    static let description = IntentDescription("在今天剩余的本机知识卡中换一条。")
    static let openAppWhenRun = false

    func perform() async throws -> some IntentResult {
        let store = try SharedWidgetStore()
        let changed = try store.advance(on: ChinaDay.string(from: Date()))
        if changed {
            WidgetCenter.shared.reloadTimelines(ofKind: SharedConstants.widgetKind)
        }
        return .result()
    }
}
