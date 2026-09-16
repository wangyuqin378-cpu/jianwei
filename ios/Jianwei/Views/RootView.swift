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
        .allowsHitTesting(!model.isReadOnlyStateProbe)
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.backgroundRefreshStatusDidChangeNotification)) { _ in
            model.refreshBackgroundPreparationAvailability()
        }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name.NSProcessInfoPowerStateDidChange)) { _ in
            model.refreshBackgroundPreparationAvailability()
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            model.refreshBackgroundPreparationAvailability()
            Task { await model.resumeFromBackground() }
        }
        .task(id: model.isReady && scenePhase == .active && !model.isReadOnlyStateProbe) {
            guard model.isReady, scenePhase == .active, !model.isReadOnlyStateProbe else { return }
            // Date() is not observable. Refresh the day-keyed selection even
            // when the app stays open across Shanghai midnight.
            while !Task.isCancelled {
                let midnight = ChinaDay.adding(days: 1, to: Date())
                do {
                    try await Task.sleep(for: .seconds(max(0, midnight.timeIntervalSinceNow)))
                } catch { return }
                guard !Task.isCancelled else { return }
                await model.dayDidChange()
            }
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

            ZStack {
                // Reset history's navigation without replacing the tab itself
                // while its selection is changing in the same update.
                NavigationStack {
                    SavedView()
                }
                .id(model.historyNavigationID)
            }
            .tag(AppSection.saved)
            .tabItem { Label("回顾", systemImage: "clock.arrow.circlepath") }

            NavigationStack {
                SettingsView()
            }
            .tag(AppSection.settings)
            .tabItem { Label("设置", systemImage: "slider.horizontal.3") }
        }
        .tint(JianweiBrand.forest)
        .modifier(JianweiTabBarBehavior())
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
        .onChange(of: model.selectedSection) { _, _ in
            // Toasts describe the action on the page where they were created.
            // Carrying an undo message into “回顾” makes it look like a history
            // status, so dismiss transient context when the user changes tabs.
            model.clearMessage()
        }
    }
}

private struct JianweiTabBarBehavior: ViewModifier {
    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            // These are the app's three primary destinations. Keeping all of
            // them visible avoids turning a long settings scroll into a hidden
            // navigation state, and the content views already reserve space
            // above the tab bar.
            content.tabBarMinimizeBehavior(.never)
        } else {
            content
        }
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
