import SwiftUI

struct TodayView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var showWidgetGuide = false

    var body: some View {
        ZStack {
            JianweiBrand.paper.ignoresSafeArea()
            ScrollView {
                // This is one card and a bounded set of controls, not a feed.
                // Eager sizing avoids the lazy stack repeatedly re-estimating
                // a multi-screen card when its feedback/notice changes height.
                VStack(alignment: .leading, spacing: 18) {
                    dayHeader
                    if model.currentCard != nil { preparationStatus }
                    if model.showsBackgroundPreparationNotice {
                        Button {
                            model.selectedSection = .settings
                        } label: {
                            Label("\(model.backgroundPreparationAvailability.title) · 查看原因", systemImage: "info.circle")
                                .font(.footnote)
                                .foregroundStyle(JianweiBrand.mutedText)
                                .multilineTextAlignment(.leading)
                        }
                        .accessibilityIdentifier("background-preparation-notice")
                        .padding(.horizontal, 4)
                    }
                    if let card = model.currentCard {
                        KnowledgeCardView(card: card)
                        cardActions(card)
                        todayHistory(currentCard: card)
                        widgetCallout
                    } else {
                        emptyState
                    }
                }
                .padding(.horizontal, 18)
                .padding(.top, 8)
                // iOS 26's floating tab bar can overlap the final controls even
                // though SwiftUI reports the scroll view's safe area correctly.
                // Keep enough trailing scroll space for the feedback row to move
                // fully above the bar.
                .padding(.bottom, 128)
            }
            .scrollIndicators(.hidden)
        }
        .navigationBarHidden(true)
        .sheet(isPresented: $showWidgetGuide) {
            WidgetGuideView()
                .presentationDetents([.medium])
                .presentationDragIndicator(.visible)
        }
        .task(id: model.undoExpirationDate) {
            guard let expiration = model.undoExpirationDate else { return }
            let delay = max(0, expiration.timeIntervalSinceNow)
            if delay > 0 {
                try? await Task.sleep(for: .seconds(delay))
            }
            guard !Task.isCancelled else { return }
            await model.refreshUndoAvailability()
        }
    }

    private var dayHeader: some View {
        HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: 3) {
                Text("见微")
                    .font(.system(.largeTitle, design: .serif, weight: .bold))
                    .tracking(-0.5)
                    .foregroundStyle(JianweiBrand.ink)
                Text(Date.now.formatted(.dateTime.month(.wide).day().weekday(.wide).locale(Locale(identifier: "zh_CN"))))
                    .font(.subheadline)
                    .foregroundStyle(JianweiBrand.mutedText)
            }
        }
        .padding(.horizontal, 4)
    }

    private var preparationStatus: some View {
        let presentation = model.preparationPresentation
        return VStack(alignment: .leading, spacing: 8) {
            PreparationStatusText(presentation: presentation)
            if let action = presentation.action {
                Button(action.title) { performPreparationAction(action) }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(JianweiBrand.forest)
            }
        }
        .padding(.horizontal, 4)
    }

    private func cardActions(_ card: KnowledgeCard) -> some View {
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 10))
            : AnyLayout(HStackLayout(spacing: 10))
        return VStack(alignment: .leading, spacing: 10) {
            layout {
                if model.canAdvanceCard {
                    Button {
                        Task { await model.showNextCard() }
                    } label: {
                        Label(
                            "换一条 · \(model.remainingSwaps)",
                            systemImage: "arrow.triangle.2.circlepath"
                        )
                    }
                    .accessibilityIdentifier("daily-swap-card")
                } else if model.remainingSwaps == 0 {
                    Label("今日已换完", systemImage: "checkmark.circle")
                        .foregroundStyle(JianweiBrand.mutedText)
                } else {
                    Label("今天就先看这一条", systemImage: "bookmark")
                        .foregroundStyle(JianweiBrand.mutedText)
                }
                if !dynamicTypeSize.isAccessibilitySize { Spacer() }
                Button {
                    Task { await model.toggleSaved(card) }
                } label: {
                    Label(
                        model.state.savedCardIDs.contains(card.id) ? "已收藏" : "收藏",
                        systemImage: model.state.savedCardIDs.contains(card.id) ? "bookmark.fill" : "bookmark"
                    )
                }
            }
            if model.canUndoLastSwap {
                Button {
                    Task { await model.undoLastSwap() }
                } label: {
                    Label("撤销刚才的换卡", systemImage: "arrow.uturn.backward")
                        .font(.caption.weight(.semibold))
                }
            }
        }
        .font(.subheadline.weight(.semibold))
        .foregroundStyle(JianweiBrand.forest)
        .buttonStyle(.borderless)
        .padding(.horizontal, 6)
    }

    @ViewBuilder
    private func todayHistory(currentCard: KnowledgeCard) -> some View {
        let previousCards = model.todaySeenCards.filter { $0.id != currentCard.id }
        if !previousCards.isEmpty {
            VStack(alignment: .leading, spacing: 11) {
                HStack {
                    Text("今天出现过")
                        .font(.headline)
                        .foregroundStyle(JianweiBrand.ink)
                    Spacer()
                    Button("查看全部") {
                        model.showAllHistory()
                    }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(JianweiBrand.forest)
                }
                ForEach(previousCards) { card in
                    Button {
                        model.presentedCardID = card.id
                    } label: {
                        HStack(spacing: 12) {
                            CardPhoto(data: model.imageData(for: card), objectName: card.objectName)
                                .frame(width: 58, height: 58)
                                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                            VStack(alignment: .leading, spacing: 4) {
                                Text(card.objectName)
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(JianweiBrand.forest)
                                Text(card.title)
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(JianweiBrand.ink)
                                    .lineLimit(2)
                            }
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.caption.weight(.bold))
                                .foregroundStyle(JianweiBrand.mutedText)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(15)
            .jianweiCard(cornerRadius: 20)
        }
    }

    private var widgetCallout: some View {
        Button {
            showWidgetGuide = true
        } label: {
            HStack(spacing: 14) {
                ZStack {
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(JianweiBrand.forest)
                    Image(systemName: "square.grid.2x2")
                        .font(.title3.weight(.medium))
                        .foregroundStyle(.white)
                }
                .frame(width: 48, height: 48)
                VStack(alignment: .leading, spacing: 3) {
                    Text("把今天的知识放到桌面")
                        .font(.headline)
                        .foregroundStyle(JianweiBrand.ink)
                    Text("小号看一句，中号可直接换一条")
                        .font(.subheadline)
                        .foregroundStyle(JianweiBrand.mutedText)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(JianweiBrand.mutedText)
            }
            .padding(16)
            .jianweiCard(cornerRadius: 21)
        }
        .buttonStyle(.plain)
    }

    private var emptyState: some View {
        let presentation = model.preparationPresentation
        return VStack(alignment: .leading, spacing: 20) {
            ZStack {
                RoundedRectangle(cornerRadius: 28, style: .continuous)
                    .fill(
                        LinearGradient(
                            colors: [JianweiBrand.forest.opacity(0.18), JianweiBrand.rust.opacity(0.12)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                VStack(spacing: 16) {
                    if model.isWorking {
                        ProgressView()
                            .tint(JianweiBrand.forest)
                            .accessibilityLabel("正在自动准备知识")
                    } else {
                        Image(systemName: presentation.symbol)
                            .font(.system(size: 44, weight: .light))
                            .foregroundStyle(JianweiBrand.forest)
                    }
                    Text(presentation.title)
                        .font(.title2.weight(.bold))
                        .foregroundStyle(JianweiBrand.ink)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 20)
                    Text(presentation.detail)
                        .font(.body)
                        .foregroundStyle(JianweiBrand.mutedText)
                        .multilineTextAlignment(.center)
                        .lineSpacing(3)
                        .padding(.horizontal, 20)
                }
                .padding(.vertical, 34)
            }
            .frame(minHeight: 360)
            .jianweiCard(cornerRadius: 28)

            if let action = presentation.action {
                Button {
                    performPreparationAction(action)
                } label: {
                    Text(action.title)
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .tint(JianweiBrand.forest)
                .accessibilityIdentifier("preparation-recovery")
            }
        }
    }

    private func performPreparationAction(_ action: DailyPreparationPresentation.Action) {
        switch action {
        case .enableDiscovery: Task { await model.enableAutomaticDiscovery() }
        case .photoSettings, .modelSettings: model.selectedSection = .settings
        case .retry: Task { await model.runAutomaticDiscovery() }
        }
    }

}

struct PreparationStatusText: View {
    let presentation: DailyPreparationPresentation

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Label(presentation.title, systemImage: presentation.symbol)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(presentation.needsAttention ? JianweiBrand.rust : JianweiBrand.forest)
            Text(presentation.detail)
                .font(.footnote)
                .foregroundStyle(JianweiBrand.mutedText)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("daily-preparation-status")
    }
}

struct KnowledgeCardView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let card: KnowledgeCard
    @State private var destructiveAction: FeedbackAction?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack {
                ZStack(alignment: .bottomLeading) {
                    Color.clear
                        .frame(height: 250)
                        .overlay {
                            CardPhoto(data: model.imageData(for: card), objectName: card.objectName)
                        }
                        .clipped()
                    LinearGradient(
                        colors: [.clear, .black.opacity(0.58)],
                        startPoint: .center,
                        endPoint: .bottom
                    )
                    recognitionLayout {
                        PillLabel(
                            icon: "viewfinder",
                            text: card.confidence < 0.8 ? "这可能是 · \(card.objectName)" : card.objectName
                        )
                        if !dynamicTypeSize.isAccessibilitySize { Spacer() }
                        Text("识别 \(Int(card.confidence * 100))%")
                            .font(.caption.monospacedDigit().weight(.semibold))
                            .foregroundStyle(.white.opacity(0.9))
                            .padding(.horizontal, 9)
                            .padding(.vertical, 6)
                            .background(.black.opacity(0.26), in: Capsule())
                    }
                    .padding(16)
                }
                .frame(maxWidth: .infinity)
                .frame(height: 250)
                .clipped()
                .accessibilityHidden(true)
                // UIKit derives focus from the real viewport, not SwiftUI's
                // uncropped descendants, and follows scroll offsets.
                PhotoAccessibilityViewport(
                    label: card.confidence < 0.8 ? "这可能是 · \(card.objectName)" : card.objectName,
                    value: "识别 \(Int(card.confidence * 100))%"
                )
            }
            .frame(height: 250)

            VStack(alignment: .leading, spacing: 17) {
                if let correction = card.correction {
                    KnowledgeCorrectionBanner(notice: correction)
                }
                Text(card.title)
                    .font(.system(.title, design: .serif, weight: .bold))
                    .tracking(-0.35)
                    .foregroundStyle(JianweiBrand.ink)
                    .fixedSize(horizontal: false, vertical: true)

                Text(card.body)
                    .font(.title3)
                    .foregroundStyle(JianweiBrand.ink)
                    .lineSpacing(5)
                    .fixedSize(horizontal: false, vertical: true)

                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "sparkle.magnifyingglass")
                        .foregroundStyle(JianweiBrand.rust)
                        .padding(.top, 2)
                    VStack(alignment: .leading, spacing: 3) {
                        Text("为什么推给你")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(JianweiBrand.mutedText)
                        Text(card.personalContext)
                            .font(.subheadline)
                            .foregroundStyle(JianweiBrand.ink.opacity(0.82))
                            .lineSpacing(2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(14)
                .background(JianweiBrand.secondarySurface.opacity(0.48), in: RoundedRectangle(cornerRadius: 16))

                Divider()

                feedbackBar

                Divider()

                if let source = card.sources.first {
                    Link(destination: source.url) {
                        HStack(spacing: 10) {
                            Image(systemName: card.effectiveEvidenceKind.symbol)
                                .foregroundStyle(JianweiBrand.forest)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(card.isWithdrawn ? "原始来源 · 本卡结论已撤回" : card.effectiveEvidenceKind.label)
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(JianweiBrand.mutedText)
                                Text("\(source.publisher) · 查看原始来源")
                                    .font(.subheadline)
                                    .foregroundStyle(JianweiBrand.forest)
                                    .lineLimit(2)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            Spacer()
                            Image(systemName: "arrow.up.right")
                                .font(.caption.weight(.bold))
                                .foregroundStyle(JianweiBrand.forest)
                        }
                    }
                    .accessibilityHint("在浏览器中打开来源")
                } else {
                    Label(card.effectiveEvidenceKind.label, systemImage: card.effectiveEvidenceKind.symbol)
                        .font(.caption)
                        .foregroundStyle(JianweiBrand.mutedText)
                        .fixedSize(horizontal: false, vertical: true)
                }

            }
            .padding(19)
        }
        .frame(maxWidth: .infinity)
        .clipShape(RoundedRectangle(cornerRadius: 27, style: .continuous))
        .jianweiCard(cornerRadius: 27)
        .confirmationDialog(
            destructiveAction == .tooPrivate ? "从见微中移除这张照片？" : "这次识别错了吗？",
            isPresented: Binding(
                get: { destructiveAction != nil },
                set: { if !$0 { destructiveAction = nil } }
            ),
            titleVisibility: .visible
        ) {
            if let action = destructiveAction {
                Button(action == .tooPrivate ? "移除，并永不分析这张照片" : "移除卡片并提交纠错", role: .destructive) {
                    Task { await model.submitFeedback(card: card, action: action) }
                }
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text(destructiveAction == .tooPrivate
                ? "本机缩略图会立即删除，反馈将在联网后同步。"
                : "这张卡会从当前卡池移除。")
        }
    }

    private var feedbackBar: some View {
        VStack(alignment: .leading, spacing: 11) {
            Text("这条知识怎么样？")
                .font(.caption.weight(.semibold))
                .foregroundStyle(JianweiBrand.mutedText)
            if dynamicTypeSize.isAccessibilitySize {
                VStack(spacing: 18) {
                    HStack(spacing: 12) {
                        feedbackButton("有意思", icon: "hand.thumbsup", action: .like)
                        feedbackButton("没意思", icon: "hand.thumbsdown", action: .dislike)
                    }
                    HStack(spacing: 12) {
                        feedbackButton("识错了", icon: "viewfinder.trianglebadge.exclamationmark", action: .wrongObject)
                        feedbackButton("太私人", icon: "eye.slash", action: .tooPrivate)
                    }
                }
            } else {
                HStack(spacing: 0) { feedbackControls }
            }
        }
    }

    private var recognitionLayout: AnyLayout {
        dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
            : AnyLayout(HStackLayout())
    }

    @ViewBuilder
    private var feedbackControls: some View {
        feedbackButton("有意思", icon: "hand.thumbsup", action: .like)
        feedbackButton("没意思", icon: "hand.thumbsdown", action: .dislike)
        feedbackButton("识错了", icon: "viewfinder.trianglebadge.exclamationmark", action: .wrongObject)
        feedbackButton("太私人", icon: "eye.slash", action: .tooPrivate)
    }

    private func feedbackButton(_ title: String, icon: String, action: FeedbackAction) -> some View {
        Button {
            if action == .wrongObject || action == .tooPrivate {
                destructiveAction = action
            } else {
                Task { await model.submitFeedback(card: card, action: action) }
            }
        } label: {
            VStack(spacing: 6) {
                Image(systemName: model.state.feedbackByCardID[card.id] == action ? icon + ".fill" : icon)
                    .font(.body)
                Text(title)
                    .font(.caption2)
            }
            .foregroundStyle(
                model.state.feedbackByCardID[card.id] == action
                    ? JianweiBrand.forest
                    : JianweiBrand.mutedText
            )
            .frame(maxWidth: .infinity, minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(model.state.feedbackByCardID[card.id] == action ? .isSelected : [])
    }
}

private struct PhotoAccessibilityViewport: UIViewRepresentable {
    let label: String
    let value: String

    func makeUIView(context: Context) -> UIView {
        let view = UIView()
        view.backgroundColor = .clear
        view.isUserInteractionEnabled = false
        view.isAccessibilityElement = true
        view.accessibilityTraits = .image
        view.accessibilityIdentifier = "knowledge-card-photo"
        return view
    }

    func updateUIView(_ view: UIView, context: Context) {
        view.accessibilityLabel = label
        view.accessibilityValue = value
    }
}

private struct WidgetGuideView: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 22) {
                HStack(spacing: 16) {
                    JianweiMark(size: 48)
                    VStack(alignment: .leading, spacing: 3) {
                        Text("把见微放到桌面")
                            .font(.title2.weight(.bold))
                        Text("卡片已在本机预缓存")
                            .foregroundStyle(JianweiBrand.mutedText)
                    }
                }
                VStack(alignment: .leading, spacing: 16) {
                    guideStep("1", "长按桌面空白处，点左上角“+”")
                    guideStep("2", "搜索“见微”")
                    guideStep("3", "选择小号或中号，添加小组件")
                }
                Text("iOS 会根据系统调度刷新；见微提前准备未来卡片，因此不承诺精确更新时间。")
                    .font(.footnote)
                    .foregroundStyle(JianweiBrand.mutedText)
                    .lineSpacing(3)
                Spacer()
            }
            .padding(24)
            .background(JianweiBrand.paper)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("完成") { dismiss() }
                }
            }
        }
    }

    private func guideStep(_ number: String, _ text: String) -> some View {
        HStack(spacing: 14) {
            Text(number)
                .font(.headline.monospacedDigit())
                .foregroundStyle(.white)
                .frame(width: 34, height: 34)
                .background(JianweiBrand.forest, in: Circle())
            Text(text)
                .font(.body.weight(.medium))
        }
    }
}
