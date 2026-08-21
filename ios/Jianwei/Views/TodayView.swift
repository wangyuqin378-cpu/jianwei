import PhotosUI
import SwiftUI

struct TodayView: View {
    @Environment(AppModel.self) private var model
    @State private var selectedPhoto: PhotosPickerItem?
    @State private var showWidgetGuide = false
    @State private var isPhotoPickerPresented = false

    var body: some View {
        ZStack {
            JianweiBrand.paper.ignoresSafeArea()
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 18) {
                    dayHeader
                    if model.isWorking {
                        AnalysisProgressView(stage: model.analysisStage)
                    }
                    if let card = model.currentCard {
                        KnowledgeCardView(card: card)
                        cardActions(card)
                        widgetCallout
                    } else {
                        emptyState
                    }
                    if model.failedCandidate != nil && !model.isWorking {
                        retryCallout
                    }
                }
                .padding(.horizontal, 18)
                .padding(.top, 8)
                .padding(.bottom, 34)
            }
            .scrollIndicators(.hidden)
        }
        .navigationBarHidden(true)
        .photosPicker(
            isPresented: $isPhotoPickerPresented,
            selection: $selectedPhoto,
            matching: .images
        )
        .onChange(of: model.shouldPresentPhotoPicker, initial: true) { _, requested in
            guard requested else { return }
            model.consumePhotoPickerRequest()
            isPhotoPickerPresented = true
        }
        .onChange(of: selectedPhoto) { _, newValue in
            guard let newValue else { return }
            Task {
                defer { selectedPhoto = nil }
                guard let data = try? await newValue.loadTransferable(type: Data.self) else {
                    return
                }
                await model.importPhoto(data: data)
            }
        }
        .sheet(isPresented: $showWidgetGuide) {
            WidgetGuideView()
                .presentationDetents([.medium])
                .presentationDragIndicator(.visible)
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
                    .foregroundStyle(.secondary)
            }
            Spacer()
            PhotosPicker(selection: $selectedPhoto, matching: .images) {
                Image(systemName: "photo.badge.plus")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(JianweiBrand.forest)
                    .frame(width: 46, height: 46)
                    .background(JianweiBrand.surface, in: Circle())
                    .overlay { Circle().stroke(JianweiBrand.ink.opacity(0.07), lineWidth: 0.5) }
            }
            .accessibilityLabel("选择一张照片")
        }
        .padding(.horizontal, 4)
    }

    private func cardActions(_ card: KnowledgeCard) -> some View {
        HStack(spacing: 10) {
            if model.state.cards.count > 1 {
                Button {
                    Task { await model.showNextCard() }
                } label: {
                    Label(
                        model.remainingSwaps > 0 ? "换一条 · \(model.remainingSwaps)" : "今日已换完",
                        systemImage: "arrow.triangle.2.circlepath"
                    )
                }
                .disabled(model.remainingSwaps == 0)
            }
            Spacer()
            Button {
                Task { await model.toggleSaved(card) }
            } label: {
                Label(
                    model.state.savedCardIDs.contains(card.id) ? "已收藏" : "收藏",
                    systemImage: model.state.savedCardIDs.contains(card.id) ? "bookmark.fill" : "bookmark"
                )
            }
        }
        .font(.subheadline.weight(.semibold))
        .foregroundStyle(JianweiBrand.forest)
        .buttonStyle(.borderless)
        .padding(.horizontal, 6)
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
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.tertiary)
            }
            .padding(16)
            .jianweiCard(cornerRadius: 21)
        }
        .buttonStyle(.plain)
    }

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 20) {
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
                    Image(systemName: "sparkles.rectangle.stack")
                        .font(.system(size: 44, weight: .light))
                        .foregroundStyle(JianweiBrand.forest)
                    Text("今天从哪张照片开始？")
                        .font(.title2.weight(.bold))
                        .foregroundStyle(JianweiBrand.ink)
                    Text("选一张主体清楚的日常物品。人物、证件和高文字图片会在本机被排除。")
                        .font(.body)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .lineSpacing(3)
                        .padding(.horizontal, 20)
                    PhotosPicker(selection: $selectedPhoto, matching: .images) {
                        Label("选择一张照片", systemImage: "photo.badge.plus")
                            .font(.headline)
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .tint(JianweiBrand.forest)
                    .padding(.horizontal, 24)
                }
                .padding(.vertical, 34)
            }
            .frame(minHeight: 360)
            .jianweiCard(cornerRadius: 28)

            if model.automaticDiscoveryEnabled {
                Button {
                    Task { await model.runAutomaticDiscovery() }
                } label: {
                    Label("继续自动发现", systemImage: "photo.stack")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
                .tint(JianweiBrand.forest)
            }
        }
    }

    private var retryCallout: some View {
        HStack(spacing: 14) {
            Image(systemName: "icloud.and.arrow.up")
                .font(.title3)
                .foregroundStyle(JianweiBrand.rust)
            VStack(alignment: .leading, spacing: 3) {
                Text("有一张候选等待联网")
                    .font(.headline)
                    .foregroundStyle(JianweiBrand.ink)
                Text("只保留了去除元数据后的压缩副本")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button("重试") {
                Task { await model.retryFailedUpload() }
            }
            .buttonStyle(.bordered)
            .tint(JianweiBrand.forest)
        }
        .padding(16)
        .jianweiCard(cornerRadius: 20)
    }
}

struct AnalysisProgressView: View {
    let stage: AnalysisStage

    var body: some View {
        HStack(spacing: 14) {
            ProgressView()
                .tint(JianweiBrand.forest)
            VStack(alignment: .leading, spacing: 3) {
                Text(stage.title)
                    .font(.headline)
                    .foregroundStyle(JianweiBrand.ink)
                Text("原图不会成为云端相册")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Text(progressText)
                .font(.caption.monospacedDigit().weight(.semibold))
                .foregroundStyle(JianweiBrand.forest)
        }
        .padding(16)
        .jianweiCard(cornerRadius: 20)
        .accessibilityElement(children: .combine)
    }

    private var progressText: String {
        switch stage {
        case .preparing: "1 / 3"
        case .filtering: "2 / 3"
        case .understanding: "3 / 3"
        case .ready: "完成"
        case .idle: ""
        }
    }
}

struct KnowledgeCardView: View {
    @Environment(AppModel.self) private var model
    let card: KnowledgeCard
    @State private var destructiveAction: FeedbackAction?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .bottomLeading) {
                CardPhoto(data: model.imageData(for: card), objectName: card.objectName)
                    .frame(height: 315)
                    .clipped()
                LinearGradient(
                    colors: [.clear, .black.opacity(0.58)],
                    startPoint: .center,
                    endPoint: .bottom
                )
                HStack {
                    PillLabel(
                        icon: "viewfinder",
                        text: card.confidence < 0.8 ? "这可能是 · \(card.objectName)" : card.objectName
                    )
                    Spacer()
                    Text("\(Int(card.confidence * 100))%")
                        .font(.caption.monospacedDigit().weight(.semibold))
                        .foregroundStyle(.white.opacity(0.9))
                        .padding(.horizontal, 9)
                        .padding(.vertical, 6)
                        .background(.black.opacity(0.26), in: Capsule())
                }
                .padding(16)
            }

            VStack(alignment: .leading, spacing: 17) {
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
                            .foregroundStyle(.secondary)
                        Text(card.personalContext)
                            .font(.subheadline)
                            .foregroundStyle(JianweiBrand.ink.opacity(0.82))
                            .lineSpacing(2)
                    }
                }
                .padding(14)
                .background(JianweiBrand.secondarySurface.opacity(0.48), in: RoundedRectangle(cornerRadius: 16))

                if let source = card.sources.first {
                    Link(destination: source.url) {
                        HStack(spacing: 10) {
                            Image(systemName: "checkmark.seal.fill")
                                .foregroundStyle(JianweiBrand.forest)
                            VStack(alignment: .leading, spacing: 2) {
                                Text("已核验来源")
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(.secondary)
                                Text("\(source.publisher) · 查看原始来源")
                                    .font(.subheadline)
                                    .foregroundStyle(JianweiBrand.forest)
                                    .lineLimit(1)
                            }
                            Spacer()
                            Image(systemName: "arrow.up.right")
                                .font(.caption.weight(.bold))
                                .foregroundStyle(JianweiBrand.forest)
                        }
                    }
                    .accessibilityHint("在浏览器中打开来源")
                }

                Divider()

                feedbackBar
            }
            .padding(19)
        }
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
                .foregroundStyle(.secondary)
            HStack(spacing: 0) {
                feedbackButton("有意思", icon: "hand.thumbsup", action: .like)
                feedbackButton("没意思", icon: "hand.thumbsdown", action: .dislike)
                feedbackButton("识错了", icon: "viewfinder.trianglebadge.exclamationmark", action: .wrongObject)
                feedbackButton("太私人", icon: "eye.slash", action: .tooPrivate)
            }
        }
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
                    : Color.secondary
            )
            .frame(maxWidth: .infinity, minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
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
                            .foregroundStyle(.secondary)
                    }
                }
                VStack(alignment: .leading, spacing: 16) {
                    guideStep("1", "长按桌面空白处，点左上角“+”")
                    guideStep("2", "搜索“见微”")
                    guideStep("3", "选择小号或中号，添加小组件")
                }
                Text("iOS 会根据系统调度刷新；见微提前准备未来卡片，因此不承诺精确更新时间。")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
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
