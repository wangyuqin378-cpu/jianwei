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
        let exactCard = state.card(for: day)
        // Keep the last card visible across midnight until the next daily card
        // is prepared. A prebuilt seven-day timeline must not schedule seven
        // empty widget entries when future cards do not exist yet.
        let card = exactCard ?? state.mostRecentCard(onOrBefore: day)
        let image = card.flatMap { try? Data(contentsOf: store.thumbnailURL(for: $0.candidateToken)) }
        let remaining = exactCard == nil ? 0 : state.remainingSwaps(on: day)
        return DailyKnowledgeEntry(
            date: date,
            card: card,
            imageData: image,
            remainingSwaps: remaining,
            canAdvance: exactCard != nil && state.canAdvance(on: day)
        )
    }

    static let sampleCard = WidgetCardSnapshot(
        id: UUID(uuidString: "10000000-0000-0000-0000-000000000001")!,
        candidateToken: UUID(uuidString: "20000000-0000-0000-0000-000000000001")!,
        topicID: "broom",
        objectName: "扫帚",
        title: "扫帚刷毛做成斜扇形，是为了更贴近墙角",
        body: "有些扫帚把刷毛做成略带角度的扇形，让边缘更容易贴近墙角和家具边缘。",
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
        .configurationDisplayName("见微 · 每日一知")
        .description("从你拍下的日常里，每天发现一件值得知道的小事。")
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
        // Keep the recovery URL at the same level as card links. A nil URL on
        // this outer view overrides the empty view's link in WidgetKit.
        .widgetURL(entry.card?.deepLink ?? URL(string: "jianwei://start"))
        // Widgets have a fixed canvas. Preserve Dynamic Type through the largest
        // standard size, then keep the knowledge and source legible instead of
        // producing several unrelated ellipses at accessibility sizes.
        .dynamicTypeSize(.small ... .xxxLarge)
    }

    private func small(_ card: WidgetCardSnapshot) -> some View {
        GeometryReader { geometry in
            ZStack {
                widgetPhoto
                    .frame(width: geometry.size.width, height: geometry.size.height)
                    .clipped()
                LinearGradient(
                    stops: [
                        .init(color: .black.opacity(0.16), location: 0),
                        .init(color: .clear, location: 0.38),
                        .init(color: .black.opacity(0.84), location: 1)
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
                VStack(alignment: .leading, spacing: 0) {
                    HStack {
                        objectBadge(card)
                        Spacer(minLength: 4)
                        Text("见微")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(.white.opacity(0.86))
                    }
                    Spacer(minLength: 8)
                    Text(card.title)
                        .font(.system(size: 17, weight: .bold, design: .serif))
                        .foregroundStyle(.white)
                        .lineLimit(3)
                        .minimumScaleFactor(0.86)
                        .allowsTightening(true)
                        .shadow(color: .black.opacity(0.2), radius: 6, y: 2)
                    Text(card.effectiveEvidenceKind == .modelKnowledge ? "AI 生成 · 未联网核实" : card.effectiveEvidenceKind.label)
                        .font(.caption2)
                        .foregroundStyle(.white.opacity(0.85))
                        .lineLimit(1)
                        .padding(.top, 4)
                }
                .padding(13)
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(card.effectiveEvidenceKind.label)，\(card.objectName)。\(card.title)。\(card.body)")
    }

    private func medium(_ card: WidgetCardSnapshot) -> some View {
        HStack(spacing: 0) {
            Link(destination: card.deepLink) {
                ZStack {
                    widgetPhoto
                    LinearGradient(
                        colors: [.clear, .black.opacity(0.42)],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                    VStack {
                        Spacer()
                        HStack {
                            objectBadge(card)
                            Spacer(minLength: 0)
                        }
                    }
                    .padding(10)
                }
            }
            .buttonStyle(.plain)
            .accessibilityLabel("打开\(card.objectName)知识卡照片")
            .frame(width: usesCompactMediumLayout ? 112 : 124)
            .clipped()

            VStack(alignment: .leading, spacing: usesCompactMediumLayout ? 4 : 6) {
                HStack(alignment: .center, spacing: 6) {
                    Capsule()
                        .fill(WidgetPalette.rust)
                        .frame(width: 12, height: 3)
                    Text("今日一知")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(WidgetPalette.rust)
                    Spacer(minLength: 4)
                    Text("见微")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(WidgetPalette.ink.opacity(0.42))
                }
                Link(destination: card.deepLink) {
                    VStack(alignment: .leading, spacing: usesCompactMediumLayout ? 5 : 7) {
                        Text(card.title)
                            .font(.system(size: usesCompactMediumLayout ? 15 : 17, weight: .bold, design: .serif))
                            .foregroundStyle(WidgetPalette.ink)
                            .lineLimit(2)
                            .minimumScaleFactor(0.88)
                            .allowsTightening(true)
                            .layoutPriority(2)
                        Text(mediumSummary(card.body))
                            .font(.caption)
                            .foregroundStyle(WidgetPalette.ink.opacity(0.68))
                            .lineLimit(usesCompactMediumLayout ? 1 : 2)
                            .minimumScaleFactor(0.9)
                            .layoutPriority(1)
                    }
                }
                .buttonStyle(.plain)
                .accessibilityElement(children: .combine)
                .accessibilityLabel("打开\(card.objectName)知识卡详情")
                Spacer(minLength: 0)
                HStack(spacing: 6) {
                    Image(systemName: card.effectiveEvidenceKind.symbol)
                    Text(card.effectiveEvidenceKind == .modelKnowledge ? "AI 生成 · 未联网核实" : (card.source?.publisher ?? card.effectiveEvidenceKind.label))
                        .lineLimit(1)
                        .minimumScaleFactor(0.72)
                        .allowsTightening(true)
                        .layoutPriority(1)
                    Spacer(minLength: 2)
                    Button(intent: SwitchKnowledgeCardIntent()) {
                        if entry.canAdvance {
                            HStack(spacing: 4) {
                                Image(systemName: "arrow.triangle.2.circlepath")
                                Text("\(entry.remainingSwaps)")
                                    .monospacedDigit()
                            }
                        } else {
                            HStack(spacing: 3) {
                                Image(systemName: entry.remainingSwaps == 0 ? "sunrise.fill" : "clock")
                                Text(switchDisplayText)
                            }
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
            .padding(usesCompactMediumLayout ? 10 : 12)
        }
        .accessibilityElement(children: .contain)
    }

    private func objectBadge(_ card: WidgetCardSnapshot) -> some View {
        HStack(spacing: 4) {
            Image(systemName: card.confidence < 0.8 ? "viewfinder" : "checkmark.seal.fill")
            Text(card.confidence < 0.8 ? "可能是 · \(card.objectName)" : card.objectName)
                .lineLimit(1)
        }
        .font(.caption2.weight(.semibold))
        .foregroundStyle(.white)
        .padding(.horizontal, 7)
        .padding(.vertical, 5)
        .background(.black.opacity(0.3), in: Capsule())
    }

    private var widgetPhoto: some View {
        GeometryReader { geometry in
            if let data = entry.imageData, let image = UIImage(data: data) {
                let fitted = CardPhotoLayout.fittedSize(image.size, in: geometry.size)
                ZStack {
                    if CardPhotoLayout.preservesWholeImage(image.size) {
                        fullColorPhoto(image)
                            .frame(width: geometry.size.width, height: geometry.size.height)
                            .blur(radius: 18)
                            .overlay(.black.opacity(0.16))
                        fullColorPhoto(image)
                            .frame(width: fitted.width, height: fitted.height)
                    } else {
                        fullColorPhoto(image)
                            .scaledToFill()
                            .frame(width: geometry.size.width, height: geometry.size.height)
                    }
                }
                .frame(width: geometry.size.width, height: geometry.size.height)
                .clipped()
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
        .clipped()
        .accessibilityHidden(true)
    }

    private var switchDisplayText: String {
        if entry.canAdvance {
            return "换一条"
        }
        return entry.remainingSwaps == 0 ? "明天见" : "就这条"
    }

    private var usesCompactMediumLayout: Bool {
        dynamicTypeSize >= .xxxLarge
    }

    private func mediumSummary(_ body: String) -> String {
        let limit = usesCompactMediumLayout ? 18 : 38
        let characters = Array(body.trimmingCharacters(in: .whitespacesAndNewlines))
        guard characters.count > limit else { return String(characters) }

        let punctuation = Set<Character>(["，", "；", "。", "！", "？"])
        guard let boundary = characters[..<min(limit, characters.count)].lastIndex(where: { punctuation.contains($0) }) else {
            return String(characters)
        }
        let summary = String(characters[...boundary])
            .trimmingCharacters(in: CharacterSet(charactersIn: "，；。！？"))
        return summary.isEmpty ? String(characters) : "\(summary)。"
    }

    @ViewBuilder
    private func fullColorPhoto(_ image: UIImage) -> some View {
        if #available(iOS 18.0, *) {
            Image(uiImage: image)
                .resizable()
                .widgetAccentedRenderingMode(.fullColor)
        } else {
            Image(uiImage: image)
                .resizable()
        }
    }

    private var empty: some View {
        Group {
            if family == .systemMedium {
                HStack(spacing: 0) {
                    ZStack {
                        LinearGradient(
                            colors: [WidgetPalette.sand.opacity(0.75), WidgetPalette.forest.opacity(0.9)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                        Image(systemName: "photo.on.rectangle.angled")
                            .font(.system(size: 32, weight: .light))
                            .foregroundStyle(.white.opacity(0.82))
                    }
                    .frame(width: 124)
                    VStack(alignment: .leading, spacing: 7) {
                        Text("见微 · 每日一知")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(WidgetPalette.rust)
                        Spacer(minLength: 0)
                        Text("开启自动发现")
                            .font(.system(.headline, design: .serif, weight: .bold))
                            .foregroundStyle(WidgetPalette.ink)
                        Text("打开见微，完成照片授权与 AI 服务设置。")
                            .font(.caption)
                            .foregroundStyle(WidgetPalette.ink.opacity(0.65))
                            .lineLimit(2)
                        Spacer(minLength: 0)
                        Label("打开见微", systemImage: "arrow.up.right")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(WidgetPalette.forest)
                    }
                    .padding(13)
                }
            } else {
                VStack(alignment: .leading, spacing: 9) {
                    HStack {
                        WidgetMark()
                        Spacer()
                        Image(systemName: "photo.badge.plus")
                            .foregroundStyle(WidgetPalette.forest)
                    }
                    Spacer()
                    Text("开启自动发现")
                        .font(.system(.headline, design: .serif, weight: .bold))
                        .foregroundStyle(WidgetPalette.ink)
                    Text("打开见微，完成照片授权与 AI 服务设置。")
                        .font(.caption)
                        .foregroundStyle(WidgetPalette.ink.opacity(0.62))
                        .lineLimit(3)
                }
                .padding(15)
            }
        }
    }
}

private enum WidgetPalette {
    static let forest = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.58, green: 0.78, blue: 0.65, alpha: 1)
            : UIColor(red: 0.21, green: 0.36, blue: 0.29, alpha: 1)
    })
    static let rust = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.78, green: 0.57, blue: 0.46, alpha: 1)
            : UIColor(red: 0.54, green: 0.35, blue: 0.27, alpha: 1)
    })
    static let sand = Color(red: 0.75, green: 0.65, blue: 0.51)
    static let paper = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.12, green: 0.14, blue: 0.13, alpha: 1)
            : UIColor(red: 0.98, green: 0.97, blue: 0.93, alpha: 1)
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
