import SwiftUI

struct CardDetailView: View {
    @Environment(\.dismiss) private var dismiss
    let card: KnowledgeCard

    var body: some View {
        ZStack {
            JianweiBrand.paper.ignoresSafeArea()
            ScrollView {
                KnowledgeCardView(card: card)
                    .padding(18)
                    .padding(.bottom, 18)
            }
            .scrollIndicators(.hidden)
        }
        .navigationTitle(card.objectName)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("完成") { dismiss() }
            }
        }
    }
}
