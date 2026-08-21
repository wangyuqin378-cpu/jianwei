import SwiftUI
import UIKit
import WidgetKit

struct DailyKnowledgeEntry: TimelineEntry {
    let date: Date
    let card: WidgetCardSnapshot?
    let imageData: Data?
    let remainingSwaps: Int
    let canAdvance: Bool
}

struct DailyKnowledgeProvider: TimelineProvider {
    func placeholder(in context: Context) -> DailyKnowledgeEntry {
        DailyKnowledgeEntry(
            date: Date(),
            card: Self.sampleCard,
            imageData: nil,
            remainingSwaps: 2,
            canAdvance: true
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (DailyKnowledgeEntry) -> Void) {
        if context.isPreview {
            completion(placeholder(in: context))
        } else {
            completion(entry(at: Date()))
        }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<DailyKnowledgeEntry>) -> Void) {
        let now = Date()
        var entries = [entry(at: now)]
        for offset in 1...7 {
            let day = ChinaDay.adding(days: offset, to: now)
            let date = day.addingTimeInterval(5 * 60)
            entries.append(entry(at: date))
        }
        let nextRefresh = ChinaDay.adding(days: 1, to: now).addingTimeInterval(10 * 60)
        completion(Timeline(entries: entries, policy: .after(nextRefresh)))
    }

    private func entry(at date: Date) -> DailyKnowledgeEntry {
        guard let store = try? SharedWidgetStore(),
              let state = try? store.load() else {
            return DailyKnowledgeEntry(
                date: date,
                card: nil,
                imageData: nil,
                remainingSwaps: 2,
                canAdvance: false
            )
        }
        let day = ChinaDay.string(from: date)
        let card = state.card(for: day)
        let image = card.flatMap { try? Data(contentsOf: store.thumbnailURL(for: $0.candidateToken)) }
        let remaining = max(
            0,
            SharedConstants.maximumDailySwaps - state.swapCounts[day, default: 0]
        )
        return DailyKnowledgeEntry(
            date: date,
            card: card,
            imageData: image,
            remainingSwaps: remaining,
            canAdvance: state.canAdvance(on: day)
        )
    }

    static let sampleCard = WidgetCardSnapshot(
        id: UUID(uuidString: "10000000-0000-0000-0000-000000000001")!,
        candidateToken: UUID(uuidString: "20000000-0000-0000-0000-000000000001")!,
        topicID: "broom",
        objectName: "扫帚",
        title: "扫帚为什么总有一点斜？",
        body: "略带角度的扇形刷毛，更容易贴近墙角和家具边缘。",
        personalContext: "来自你最近拍下的清洁工具。",
        confidence: 0.96,
        scheduledDay: ChinaDay.string(from: Date()),
        thumbnailFilename: nil,
        source: WidgetSourceSnapshot(
            title: "US4756039A: angled-cut bristle broom",
            publisher: "Google Patents",
            url: URL(string: "https://patents.google.com/patent/US4756039A/en")!
        )
    )
}

struct DailyKnowledgeWidget: Widget {
    let kind = SharedConstants.widgetKind

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: DailyKnowledgeProvider()) { entry in
            DailyKnowledgeWidgetView(entry: entry)
        }
        .configurationDisplayName("每日见微")
        .description("从你的照片里，每天认识一个日常物件。")
        .supportedFamilies([.systemSmall, .systemMedium])
        .contentMarginsDisabled()
    }
}

struct DailyKnowledgeWidgetView: View {
    @Environment(\.widgetFamily) private var family
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let entry: DailyKnowledgeEntry

    var body: some View {
        Group {
            if let card = entry.card {
                switch family {
                case .systemMedium:
                    medium(card)
                default:
                    small(card)
                }
            } else {
                empty
            }
        }
        .containerBackground(for: .widget) {
            WidgetPalette.paper
        }
        .widgetURL(entry.card?.deepLink)
        // Widgets have a fixed canvas. Preserve Dynamic Type through the largest
        // standard size, then keep the knowledge and source legible instead of
        // producing several unrelated ellipses at accessibility sizes.
        .dynamicTypeSize(.small ... .xxxLarge)
    }

    private func small(_ card: WidgetCardSnapshot) -> some View {
        ZStack(alignment: .bottomLeading) {
            widgetPhoto
            LinearGradient(
                colors: [.clear, .black.opacity(0.78)],
                startPoint: .center,
                endPoint: .bottom
            )
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 5) {
                    Image(systemName: "viewfinder")
                    Text(card.confidence < 0.8 ? "可能是\(card.objectName)" : card.objectName)
                        .lineLimit(1)
                }
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.white.opacity(0.86))
                Text(card.title)
                    .font(.system(.headline, design: .serif, weight: .bold))
                    .foregroundStyle(.white)
                    .lineLimit(3)
                    .minimumScaleFactor(0.82)
            }
            .padding(14)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(card.objectName)。\(card.title)。\(card.body)")
    }

    private func medium(_ card: WidgetCardSnapshot) -> some View {
        HStack(spacing: 0) {
            Link(destination: card.deepLink) {
                ZStack(alignment: .bottomLeading) {
                    widgetPhoto
                    LinearGradient(
                        colors: [.clear, .black.opacity(0.55)],
                        startPoint: .center,
                        endPoint: .bottom
                    )
                    Text(card.confidence < 0.8 ? "可能是 · \(card.objectName)" : card.objectName)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                        .padding(10)
                }
            }
            .buttonStyle(.plain)
            .accessibilityLabel("打开\(card.objectName)知识卡照片")
            .frame(width: usesCompactMediumLayout ? 116 : 132)
            .clipped()

            VStack(alignment: .leading, spacing: usesCompactMediumLayout ? 5 : 7) {
                Link(destination: card.deepLink) {
                    VStack(alignment: .leading, spacing: usesCompactMediumLayout ? 5 : 7) {
                        Text(card.title)
                            .font(.system(.headline, design: .serif, weight: .bold))
                            .foregroundStyle(WidgetPalette.ink)
                            .lineLimit(2)
                            .minimumScaleFactor(0.85)
                            .layoutPriority(2)
                        Text(card.body)
                            .font(.caption)
                            .foregroundStyle(WidgetPalette.ink.opacity(0.78))
                            .lineLimit(usesCompactMediumLayout ? 2 : 3)
                            .minimumScaleFactor(0.88)
                            .layoutPriority(1)
                    }
                }
                .buttonStyle(.plain)
                .accessibilityElement(children: .combine)
                .accessibilityLabel("打开\(card.objectName)知识卡详情")
                Spacer(minLength: 0)
                HStack(spacing: 7) {
                    Image(systemName: "checkmark.seal.fill")
                    Text(card.source.publisher)
                        .lineLimit(1)
                        .minimumScaleFactor(0.72)
                        .allowsTightening(true)
                        .layoutPriority(1)
                    Spacer(minLength: 2)
                    Button(intent: SwitchKnowledgeCardIntent()) {
                        if entry.canAdvance {
                            HStack(spacing: 4) {
                                Image(systemName: "arrow.triangle.2.circlepath")
                                Text(switchDisplayText)
                                    .monospacedDigit()
                            }
                        } else {
                            Text(switchDisplayText)
                                .lineLimit(1)
                                .fixedSize(horizontal: true, vertical: false)
                        }
                    }
                    .buttonStyle(.plain)
                    .disabled(!entry.canAdvance)
                    .accessibilityLabel(
                        entry.canAdvance
                            ? "换一条，今天还可以换 \(entry.remainingSwaps) 次"
                            : entry.remainingSwaps == 0
                                ? "今天已经不能再换"
                                : "还没有下一张卡"
                    )
                }
                .font(.caption2.weight(.semibold))
                .foregroundStyle(WidgetPalette.forest)
            }
            .padding(usesCompactMediumLayout ? 11 : 13)
        }
        .accessibilityElement(children: .contain)
    }

    private var widgetPhoto: some View {
        Group {
            if let data = entry.imageData, let image = UIImage(data: data) {
                fullColorPhoto(image)
            } else {
                ZStack {
                    LinearGradient(
                        colors: [WidgetPalette.sand, WidgetPalette.forest],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                    Image(systemName: "sparkles")
                        .font(.title)
                        .foregroundStyle(.white.opacity(0.72))
                }
            }
        }
    }

    private var switchDisplayText: String {
        if entry.canAdvance {
            return "换 · \(entry.remainingSwaps)"
        }
        return entry.remainingSwaps == 0 ? "明天" : "稍后"
    }

    private var usesCompactMediumLayout: Bool {
        dynamicTypeSize >= .xxxLarge
    }

    @ViewBuilder
    private func fullColorPhoto(_ image: UIImage) -> some View {
        if #available(iOS 18.0, *) {
            Image(uiImage: image)
                .resizable()
                .widgetAccentedRenderingMode(.fullColor)
                .scaledToFill()
        } else {
            Image(uiImage: image)
                .resizable()
                .scaledToFill()
        }
    }

    private var empty: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack {
                WidgetMark()
                Spacer()
                Image(systemName: "photo.badge.plus")
                    .foregroundStyle(WidgetPalette.forest)
            }
            Spacer()
            Text("从一张照片开始")
                .font(.system(.headline, design: .serif, weight: .bold))
                .foregroundStyle(WidgetPalette.ink)
            Text("打开见微，选择你想理解的日常物品。")
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(3)
        }
        .padding(15)
        .widgetURL(URL(string: "jianwei://start"))
    }
}

private enum WidgetPalette {
    static let forest = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.58, green: 0.78, blue: 0.65, alpha: 1)
            : UIColor(red: 0.21, green: 0.36, blue: 0.29, alpha: 1)
    })
    static let rust = Color(red: 0.54, green: 0.35, blue: 0.27)
    static let sand = Color(red: 0.75, green: 0.65, blue: 0.51)
    static let paper = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.12, green: 0.14, blue: 0.13, alpha: 1)
            : UIColor(red: 0.97, green: 0.95, blue: 0.90, alpha: 1)
    })
    static let ink = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.94, green: 0.93, blue: 0.88, alpha: 1)
            : UIColor(red: 0.12, green: 0.15, blue: 0.13, alpha: 1)
    })
}

private struct WidgetMark: View {
    var body: some View {
        ZStack {
            Circle()
                .stroke(WidgetPalette.forest, lineWidth: 3)
                .frame(width: 22, height: 22)
                .offset(x: -3, y: -3)
            Capsule()
                .fill(WidgetPalette.forest)
                .frame(width: 4, height: 14)
                .rotationEffect(.degrees(-43))
                .offset(x: 8, y: 8)
            Circle()
                .fill(WidgetPalette.rust)
                .frame(width: 6, height: 6)
                .offset(x: 6, y: -7)
        }
        .frame(width: 32, height: 32)
        .accessibilityHidden(true)
    }
}

#Preview(as: .systemSmall) {
    DailyKnowledgeWidget()
} timeline: {
    DailyKnowledgeEntry(
        date: Date(),
        card: DailyKnowledgeProvider.sampleCard,
        imageData: nil,
        remainingSwaps: 2,
        canAdvance: true
    )
}

#Preview(as: .systemMedium) {
    DailyKnowledgeWidget()
} timeline: {
    DailyKnowledgeEntry(
        date: Date(),
        card: DailyKnowledgeProvider.sampleCard,
        imageData: nil,
        remainingSwaps: 2,
        canAdvance: true
    )
}
