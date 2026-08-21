import SwiftUI

struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Group {
            if !model.isReady {
                launchView
            } else if !model.state.onboardingCompleted {
                OnboardingView()
            } else {
                MainTabView()
            }
        }
        .preferredColorScheme(nil)
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            Task { await model.synchronizeCards(showFailure: false) }
        }
    }

    private var launchView: some View {
        ZStack {
            JianweiBrand.paper.ignoresSafeArea()
            VStack(spacing: 18) {
                JianweiMark(size: 58)
                Text("见微")
                    .font(.system(.title, design: .serif, weight: .semibold))
                    .foregroundStyle(JianweiBrand.ink)
                ProgressView()
                    .tint(JianweiBrand.forest)
                    .accessibilityLabel("正在载入")
            }
        }
    }
}

struct MainTabView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        TabView(selection: $model.selectedSection) {
            NavigationStack {
                TodayView()
            }
            .tag(AppSection.today)
            .tabItem { Label("今天", systemImage: "sparkles.rectangle.stack") }

            NavigationStack {
                SavedView()
            }
            .tag(AppSection.saved)
            .tabItem { Label("收藏", systemImage: "bookmark") }

            NavigationStack {
                SettingsView()
            }
            .tag(AppSection.settings)
            .tabItem { Label("设置", systemImage: "slider.horizontal.3") }
        }
        .tint(JianweiBrand.forest)
        .sheet(
            isPresented: Binding(
                get: { model.presentedCardID != nil },
                set: { if !$0 { model.presentedCardID = nil } }
            )
        ) {
            if let id = model.presentedCardID,
               let card = model.state.cards.first(where: { $0.id == id }) {
                NavigationStack {
                    CardDetailView(card: card)
                }
                .presentationDragIndicator(.visible)
            }
        }
        .overlay(alignment: .top) {
            if let message = model.message {
                StatusToast(message: message) {
                    model.clearMessage()
                }
                .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.spring(response: 0.35, dampingFraction: 1), value: model.message)
    }
}

private struct StatusToast: View {
    let message: String
    let dismiss: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "info.circle.fill")
                .foregroundStyle(JianweiBrand.forest)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(JianweiBrand.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button(action: dismiss) {
                Image(systemName: "xmark")
                    .font(.caption.weight(.bold))
                    .padding(8)
                    .contentShape(Rectangle())
            }
            .foregroundStyle(.secondary)
            .accessibilityLabel("关闭提示")
        }
        .padding(14)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .shadow(color: .black.opacity(0.12), radius: 16, y: 6)
        .padding(.horizontal, 16)
        .padding(.top, 8)
    }
}
