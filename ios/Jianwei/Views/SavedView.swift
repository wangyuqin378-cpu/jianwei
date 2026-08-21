import SwiftUI

struct SavedView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        ZStack {
            JianweiBrand.paper.ignoresSafeArea()
            if model.savedCards.isEmpty {
                ContentUnavailableView(
                    "还没有收藏",
                    systemImage: "bookmark",
                    description: Text("看到想留下的知识时，点卡片下方的“收藏”。")
                )
            } else {
                ScrollView {
                    LazyVStack(spacing: 12) {
                        ForEach(model.savedCards) { card in
                            NavigationLink {
                                CardDetailView(card: card)
                            } label: {
                                HStack(spacing: 14) {
                                    CardPhoto(data: model.imageData(for: card), objectName: card.objectName)
                                        .frame(width: 92, height: 92)
                                        .clipShape(RoundedRectangle(cornerRadius: 17, style: .continuous))
                                    VStack(alignment: .leading, spacing: 6) {
                                        Text(card.objectName)
                                            .font(.caption.weight(.semibold))
                                            .foregroundStyle(JianweiBrand.forest)
                                        Text(card.title)
                                            .font(.headline)
                                            .foregroundStyle(JianweiBrand.ink)
                                            .lineLimit(2)
                                        Text(card.sources.first?.publisher ?? "可靠来源")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Image(systemName: "chevron.right")
                                        .font(.caption.weight(.bold))
                                        .foregroundStyle(.tertiary)
                                }
                                .padding(12)
                                .jianweiCard(cornerRadius: 21)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(18)
                }
                .scrollIndicators(.hidden)
            }
        }
        .navigationTitle("收藏")
    }
}
