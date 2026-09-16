import SwiftUI

struct SavedView: View {
    @Environment(AppModel.self) private var model
    @State private var filter: ReviewFilter = .all

    var body: some View {
        ZStack {
            JianweiBrand.paper.ignoresSafeArea()
            VStack(spacing: 0) {
                Picker("回顾范围", selection: $filter) {
                    ForEach(ReviewFilter.allCases) { option in
                        Text(option.title).tag(option)
                    }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 18)
                .padding(.vertical, 12)

                if visibleCards.isEmpty {
                    emptyState
                } else {
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 14) {
                            ForEach(visibleSections) { section in
                                Text(section.title)
                                    .font(.headline)
                                    .foregroundStyle(JianweiBrand.ink)
                                    .padding(.horizontal, 4)

                                ForEach(section.cards) { card in
                                    NavigationLink {
                                        CardDetailView(card: card)
                                    } label: {
                                        ReviewCardRow(
                                            card: card,
                                            imageData: model.imageData(for: card),
                                            isSaved: model.state.savedCardIDs.contains(card.id),
                                            statusText: statusText(for: card)
                                        )
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                        .padding(.horizontal, 18)
                        .padding(.bottom, 120)
                    }
                    .scrollIndicators(.hidden)
                }
            }
        }
        .navigationTitle("回顾")
    }

    private var visibleCards: [KnowledgeCard] {
        switch filter {
        case .all: model.historyCards
        case .saved: model.savedCards
        }
    }

    private var visibleSections: [ReviewSection] {
        visibleCards.reduce(into: [ReviewSection]()) { sections, card in
            let id = card.scheduledDay.isEmpty ? "undated" : card.scheduledDay
            if let index = sections.firstIndex(where: { $0.id == id }) {
                sections[index].cards.append(card)
            } else {
                sections.append(ReviewSection(id: id, title: sectionTitle(for: id), cards: [card]))
            }
        }
    }

    private func statusText(for card: KnowledgeCard) -> String? {
        if model.currentCard?.id == card.id { return "当前" }
        if card.scheduledDay == ChinaDay.string(from: Date()) { return "今天出现过" }
        return model.state.savedCardIDs.contains(card.id) ? "已收藏" : nil
    }

    private func sectionTitle(for id: String) -> String {
        if id == "undated" { return "仅收藏" }
        if id == ChinaDay.string(from: Date()) { return "今天" }
        let parts = id.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return id }
        let currentYear = Calendar(identifier: .gregorian).component(.year, from: Date())
        return parts[0] == currentYear
            ? "\(parts[1])月\(parts[2])日"
            : "\(parts[0])年\(parts[1])月\(parts[2])日"
    }

    private var emptyState: some View {
        VStack(spacing: 14) {
            Image(systemName: filter == .all ? "clock.arrow.circlepath" : "bookmark")
                .font(.largeTitle.weight(.regular))
                .foregroundStyle(JianweiBrand.forest)
                .accessibilityHidden(true)
            Text(filter == .all ? "还没有出现过的卡片" : "还没有收藏")
                .font(.title3.weight(.semibold))
                .foregroundStyle(JianweiBrand.ink)
            Text(
                filter == .all
                    ? "每天出现过的知识会自动留在这里，换掉也不会丢。"
                    : "看到特别想留下的知识时，点卡片下方的“收藏”。"
            )
            .font(.body)
            .foregroundStyle(JianweiBrand.mutedText)
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
        }
        .padding(28)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct ReviewSection: Identifiable {
    let id: String
    let title: String
    var cards: [KnowledgeCard]
}

private enum ReviewFilter: String, CaseIterable, Identifiable {
    case all
    case saved

    var id: String { rawValue }
    var title: String { self == .all ? "全部" : "收藏" }
}

private struct ReviewCardRow: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let card: KnowledgeCard
    let imageData: Data?
    let isSaved: Bool
    let statusText: String?

    var body: some View {
        // Keep the same text/accessibility nodes when Dynamic Type changes.
        // Only their placement changes; rebuilding two separate trees loses
        // element identity during live resizing and accessibility inspection.
        ReviewCardRowLayout(stacked: dynamicTypeSize.isAccessibilitySize) {
            thumbnail
            metadata
            title
            evidence
            Image(systemName: "chevron.right")
                .font(.caption.weight(.bold))
                .foregroundStyle(JianweiBrand.mutedText)
                .opacity(dynamicTypeSize.isAccessibilitySize ? 0 : 1)
                .accessibilityHidden(true)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .jianweiCard(cornerRadius: 21)
    }

    private var thumbnail: some View {
        CardPhoto(data: imageData, objectName: card.objectName)
            .frame(width: 92, height: 92)
            .clipShape(RoundedRectangle(cornerRadius: 17, style: .continuous))
    }

    private var metadata: some View {
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 6))
            : AnyLayout(HStackLayout(spacing: 6))
        return layout {
            HStack(spacing: 6) {
                Text(card.objectName)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(JianweiBrand.forest)
                if isSaved {
                    Image(systemName: "bookmark.fill")
                        .font(.caption2)
                        .foregroundStyle(JianweiBrand.rust)
                        .accessibilityLabel("已收藏")
                }
            }
            if !dynamicTypeSize.isAccessibilitySize { Spacer() }
            if let statusText {
                Text(statusText)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(statusText == "当前" ? .white : JianweiBrand.forest)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(
                        statusText == "当前" ? JianweiBrand.forest : JianweiBrand.forest.opacity(0.10),
                        in: Capsule()
                    )
            }
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    private var title: some View {
        Text(card.title)
            .font(.headline)
            .foregroundStyle(JianweiBrand.ink)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var evidence: some View {
        Text(card.isWithdrawn ? "知识有误 · 已撤回，查看说明" : card.effectiveEvidenceKind == .modelKnowledge
            ? card.effectiveEvidenceKind.label
            : (card.sources.first?.publisher ?? card.effectiveEvidenceKind.label))
            .font(.caption)
            .foregroundStyle(JianweiBrand.mutedText)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// Compact rows use a photo beside the text column. Large text keeps the
/// photo beside metadata, but gives the title and evidence the full width.
private struct ReviewCardRowLayout: Layout {
    let stacked: Bool

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        geometry(proposal: proposal, subviews: subviews).size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let geometry = geometry(proposal: ProposedViewSize(width: bounds.width, height: nil), subviews: subviews)
        for (subview, frame) in zip(subviews, geometry.frames) {
            subview.place(
                at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY),
                anchor: .topLeading,
                proposal: ProposedViewSize(frame.size)
            )
        }
    }

    private func geometry(proposal: ProposedViewSize, subviews: Subviews) -> (size: CGSize, frames: [CGRect]) {
        let photo = subviews[0].sizeThatFits(.unspecified)
        let chevron = subviews[4].sizeThatFits(.unspecified)
        let idealTextWidth = subviews[1...3].map { $0.sizeThatFits(.unspecified).width }.max() ?? 0
        let width = max(0, proposal.width ?? (photo.width + idealTextWidth + chevron.width + 28))
        let columnX = photo.width + 14
        let columnWidth = max(0, width - columnX - (stacked ? 0 : chevron.width + 14))
        let metadata = subviews[1].sizeThatFits(ProposedViewSize(width: columnWidth, height: nil))
        let textWidth = stacked ? width : columnWidth
        let title = subviews[2].sizeThatFits(ProposedViewSize(width: textWidth, height: nil))
        let evidence = subviews[3].sizeThatFits(ProposedViewSize(width: textWidth, height: nil))

        if stacked {
            let titleY = max(photo.height, metadata.height) + 12
            let evidenceY = titleY + title.height + 12
            return (CGSize(width: width, height: evidenceY + evidence.height), [
                CGRect(origin: .zero, size: photo),
                CGRect(x: columnX, y: 0, width: columnWidth, height: metadata.height),
                CGRect(x: 0, y: titleY, width: textWidth, height: title.height),
                CGRect(x: 0, y: evidenceY, width: textWidth, height: evidence.height),
                CGRect(origin: .zero, size: .zero)
            ])
        }

        let textHeight = metadata.height + title.height + evidence.height + 12
        let height = max(photo.height, textHeight, chevron.height)
        let textY = (height - textHeight) / 2
        return (CGSize(width: width, height: height), [
            CGRect(x: 0, y: (height - photo.height) / 2, width: photo.width, height: photo.height),
            CGRect(x: columnX, y: textY, width: columnWidth, height: metadata.height),
            CGRect(x: columnX, y: textY + metadata.height + 6, width: textWidth, height: title.height),
            CGRect(x: columnX, y: textY + metadata.height + title.height + 12, width: textWidth, height: evidence.height),
            CGRect(x: width - chevron.width, y: (height - chevron.height) / 2, width: chevron.width, height: chevron.height)
        ])
    }
}
