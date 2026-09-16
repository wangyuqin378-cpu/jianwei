import SwiftUI

struct KnowledgeCorrectionBanner: View {
    let notice: KnowledgeCorrectionNotice

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("知识有误，已停止推荐", systemImage: "exclamationmark.bubble")
                .font(.headline)
            Text(notice.reason)
                .font(.subheadline)
                .fixedSize(horizontal: false, vertical: true)
            Text("\(notice.issuedDay) · 原文与收藏保留，供你回顾。")
                .font(.caption)
                .foregroundStyle(JianweiBrand.mutedText)
                .fixedSize(horizontal: false, vertical: true)
            Link("查看纠错依据", destination: notice.sourceURL)
                .font(.subheadline.weight(.semibold))
                .padding(.vertical, 10)
                .accessibilityHint("在浏览器中查看原始来源，核对撤回原因")
        }
        .foregroundStyle(JianweiBrand.ink)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(JianweiBrand.secondarySurface, in: RoundedRectangle(cornerRadius: 16))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("knowledgeCorrectionNotice")
    }
}

struct CardDetailView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppModel.self) private var model
    let card: KnowledgeCard

    var body: some View {
        ZStack {
            JianweiBrand.paper.ignoresSafeArea()
            ScrollView {
                if let current = model.state.cards.first(where: { $0.id == card.id }) {
                    KnowledgeCardView(card: current)
                        .padding(18)
                        .padding(.bottom, 18)
                }
            }
            .scrollIndicators(.hidden)
        }
        .navigationTitle(card.objectName)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Task { await model.toggleSaved(card) }
                } label: {
                    Image(
                        systemName: model.state.savedCardIDs.contains(card.id)
                            ? "bookmark.fill"
                            : "bookmark"
                    )
                }
                .disabled(!cardExists)
                .accessibilityLabel(model.state.savedCardIDs.contains(card.id) ? "取消收藏" : "收藏")
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button("完成") { dismiss() }
            }
        }
        .onChange(of: cardExists, initial: true) { _, exists in
            if !exists { dismiss() }
        }
    }

    private var cardExists: Bool {
        model.state.cards.contains(where: { $0.id == card.id })
    }
}
