import SwiftUI

private enum StartChoice {
    case automatic
    case selectedOnly
}

struct OnboardingView: View {
    @Environment(AppModel.self) private var model
    @State private var page: Int
    @State private var choice: StartChoice = .automatic
    @State private var interests = Set<KnowledgeInterest>([
        .everydayDesign,
        .objectHistory,
        .science
    ])
    @State private var qwenAPIKey = ""
    @State private var preparationMode: AutomaticPreparationMode = .dailySingle

    init() {
        let arguments = ProcessInfo.processInfo.arguments
        let requestedPage = arguments.firstIndex(of: "-JianweiOnboardingPage")
            .flatMap { index in arguments.indices.contains(index + 1) ? Int(arguments[index + 1]) : nil }
        _page = State(initialValue: min(2, max(0, requestedPage ?? 0)))
    }

    var body: some View {
        ZStack {
            JianweiBrand.paper.ignoresSafeArea()
            VStack(spacing: 0) {
                header
                TabView(selection: $page) {
                    valuePage.tag(0)
                    privacyPage.tag(1)
                    choicePage.tag(2)
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                .animation(.spring(response: 0.38, dampingFraction: 1), value: page)
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            footer
        }
    }

    private var header: some View {
        HStack {
            HStack(spacing: 10) {
                JianweiMark(size: 30)
                Text("见微")
                    .font(.system(.headline, design: .serif, weight: .semibold))
                    .foregroundStyle(JianweiBrand.ink)
            }
            Spacer()
            HStack(spacing: 7) {
                ForEach(0..<3) { index in
                    Capsule()
                        .fill(index == page ? JianweiBrand.forest : JianweiBrand.forest.opacity(0.18))
                        .frame(width: index == page ? 22 : 7, height: 7)
                }
            }
            .accessibilityLabel("第 \(page + 1) 页，共 3 页")
        }
        .padding(.horizontal, 22)
        .padding(.top, 10)
        .padding(.bottom, 8)
    }

    private var valuePage: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                VStack(alignment: .leading, spacing: 13) {
                    Text("你的照片，\n不只是一段回忆")
                        .font(.system(size: 39, weight: .bold, design: .serif))
                        .tracking(-0.7)
                        .foregroundStyle(JianweiBrand.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("见微每天从你的日常照片里，挑出一个物件，讲一件今天值得知道的小事。")
                        .font(.title3)
                        .foregroundStyle(.secondary)
                        .lineSpacing(4)
                }

                onboardingCardPreview

                Label("不是照片轮播，而是与你的生活有关的知识", systemImage: "sparkles")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(JianweiBrand.forest)
            }
            .padding(.horizontal, 22)
            .padding(.top, 22)
            .padding(.bottom, 120)
        }
        .scrollIndicators(.hidden)
    }

    private var onboardingCardPreview: some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .bottomLeading) {
                LinearGradient(
                    colors: [
                        Color(red: 0.79, green: 0.69, blue: 0.54),
                        JianweiBrand.forest.opacity(0.78)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                .frame(height: 220)
                VStack(alignment: .leading, spacing: 6) {
                    PillLabel(icon: "viewfinder", text: "照片里的扫帚")
                    Text("扫帚为什么总有一点斜？")
                        .font(.title2.weight(.bold))
                        .foregroundStyle(.white)
                        .shadow(color: .black.opacity(0.24), radius: 8, y: 2)
                }
                .padding(18)
            }
            VStack(alignment: .leading, spacing: 10) {
                Text("略带角度的扇形刷毛，更容易贴近墙角和家具边缘。")
                    .font(.body)
                    .foregroundStyle(JianweiBrand.ink)
                    .lineSpacing(3)
                Text("来源 · Google Patents")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(18)
        }
        .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
        .jianweiCard(cornerRadius: 26)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("示例知识卡：扫帚为什么总有一点斜")
    }

    private var privacyPage: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                VStack(alignment: .leading, spacing: 13) {
                    Text("先在 iPhone 上\n筛一遍")
                        .font(.system(size: 39, weight: .bold, design: .serif))
                        .tracking(-0.7)
                        .foregroundStyle(JianweiBrand.ink)
                    Text("人物、证件、截图和高文字密度图片不会上传。只有少量合适候选会被压缩并清除元数据。")
                        .font(.title3)
                        .foregroundStyle(.secondary)
                        .lineSpacing(4)
                }

                VStack(spacing: 0) {
                    privacyRow(
                        number: "01",
                        icon: "iphone.gen3",
                        title: "本机筛选",
                        detail: "Vision 检查人脸、文字、清晰度和重复照片"
                    )
                    Divider().padding(.leading, 64)
                    privacyRow(
                        number: "02",
                        icon: "wand.and.stars.inverse",
                        title: "只上传候选",
                        detail: "长边缩至 1280 px，并移除 GPS、设备和文件信息"
                    )
                    Divider().padding(.leading, 64)
                    privacyRow(
                        number: "03",
                        icon: "trash.slash",
                        title: "不建立云端相册",
                        detail: "图片分析后删除；卡片只保留脱敏缩略图"
                    )
                }
                .jianweiCard()

                Label("拒绝相册权限后，仍可只选一张照片", systemImage: "hand.raised.fill")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(JianweiBrand.forest)
            }
            .padding(.horizontal, 22)
            .padding(.top, 22)
            .padding(.bottom, 120)
        }
        .scrollIndicators(.hidden)
    }

    private func privacyRow(number: String, icon: String, title: String, detail: String) -> some View {
        HStack(alignment: .top, spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(JianweiBrand.forest.opacity(0.11))
                Image(systemName: icon)
                    .font(.title3.weight(.medium))
                    .foregroundStyle(JianweiBrand.forest)
            }
            .frame(width: 48, height: 48)
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.headline)
                    .foregroundStyle(JianweiBrand.ink)
                Text(detail)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineSpacing(2)
            }
            Spacer(minLength: 0)
            Text(number)
                .font(.caption2.monospacedDigit().weight(.bold))
                .foregroundStyle(JianweiBrand.rust)
        }
        .padding(16)
        .accessibilityElement(children: .combine)
    }

    private var choicePage: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                VStack(alignment: .leading, spacing: 10) {
                    Text("选择你的开始方式")
                        .font(.system(size: 34, weight: .bold, design: .serif))
                        .tracking(-0.5)
                        .foregroundStyle(JianweiBrand.ink)
                    Text("两种方式随时可以在设置里切换。")
                        .font(.body)
                        .foregroundStyle(.secondary)
                }

                choiceCard(
                    value: .automatic,
                    title: "自动发现",
                    badge: "推荐",
                    detail: "读取最近 90 天、最多 500 张照片；本机筛选后只处理少量候选。",
                    icon: "photo.stack.fill"
                )
                if choice == .automatic {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("每天三选一")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                        Text("从未处理过的照片中找出 3 张合适候选，用 AI 分别判断知识潜力，只展示其中最有趣的一条。")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.horizontal, 4)
                }
                choiceCard(
                    value: .selectedOnly,
                    title: "仅选择照片",
                    badge: nil,
                    detail: "不开放持续访问。每次由你通过系统照片选择器明确选择。",
                    icon: "photo.badge.plus"
                )

                modelAccessCard

                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Text("先选 3 个兴趣")
                            .font(.headline)
                            .foregroundStyle(JianweiBrand.ink)
                        Spacer()
                        Text("\(interests.count) / 5")
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                        ForEach(KnowledgeInterest.allCases) { interest in
                            Button {
                                if interests.contains(interest) {
                                    if interests.count > 3 { interests.remove(interest) }
                                } else {
                                    interests.insert(interest)
                                }
                            } label: {
                                HStack {
                                    Text(interest.title)
                                    Spacer()
                                    Image(systemName: interests.contains(interest) ? "checkmark.circle.fill" : "circle")
                                }
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(
                                    interests.contains(interest) ? JianweiBrand.forest : Color.secondary
                                )
                                .padding(13)
                                .background(
                                    interests.contains(interest)
                                        ? JianweiBrand.forest.opacity(0.10)
                                        : JianweiBrand.secondarySurface.opacity(0.55),
                                    in: RoundedRectangle(cornerRadius: 15, style: .continuous)
                                )
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .padding(.top, 4)
            }
            .padding(.horizontal, 22)
            .padding(.top, 18)
            .padding(.bottom, 150)
        }
        .scrollIndicators(.hidden)
    }

    private func choiceCard(
        value: StartChoice,
        title: String,
        badge: String?,
        detail: String,
        icon: String
    ) -> some View {
        Button {
            choice = value
        } label: {
            HStack(alignment: .top, spacing: 14) {
                Image(systemName: icon)
                    .font(.title2.weight(.medium))
                    .foregroundStyle(choice == value ? Color.white : JianweiBrand.forest)
                    .frame(width: 48, height: 48)
                    .background(
                        choice == value ? JianweiBrand.forest : JianweiBrand.forest.opacity(0.10),
                        in: RoundedRectangle(cornerRadius: 15, style: .continuous)
                    )
                VStack(alignment: .leading, spacing: 7) {
                    HStack(spacing: 8) {
                        Text(title)
                            .font(.headline)
                            .foregroundStyle(JianweiBrand.ink)
                        if let badge {
                            Text(badge)
                                .font(.caption2.weight(.bold))
                                .foregroundStyle(JianweiBrand.rust)
                                .padding(.horizontal, 7)
                                .padding(.vertical, 4)
                                .background(JianweiBrand.rust.opacity(0.10), in: Capsule())
                        }
                    }
                    Text(detail)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.leading)
                        .lineSpacing(2)
                }
                Spacer(minLength: 0)
                Image(systemName: choice == value ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(
                        choice == value ? JianweiBrand.forest : Color.secondary.opacity(0.45)
                    )
            }
            .padding(16)
            .background(JianweiBrand.surface, in: RoundedRectangle(cornerRadius: 21, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 21, style: .continuous)
                    .stroke(choice == value ? JianweiBrand.forest : JianweiBrand.ink.opacity(0.06), lineWidth: 1.5)
            }
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(choice == value ? .isSelected : [])
    }

    private var modelAccessCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 5) {
                Text("选择 AI 服务")
                    .font(.headline)
                    .foregroundStyle(JianweiBrand.ink)
                Text("AI 会理解每天 3 张候选照片，只发布最有趣的一条知识。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if model.managedSubscriptionState == .subscribed {
                Label("见微 Pro 已开通", systemImage: "checkmark.seal.fill")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(JianweiBrand.forest)
            } else {
                Button {
                    Task { await model.purchaseManagedModelService() }
                } label: {
                    Label(subscriptionButtonTitle, systemImage: "sparkles")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(JianweiBrand.forest)
                .disabled(model.isWorking || model.managedSubscriptionState == .productUnavailable)

                Text("按月自动续订；每天最多分析 3 张并发布 1 条，每自然月最多 31 条。可随时在 App Store 取消。")
                    .font(.caption2)
                    .foregroundStyle(.secondary)

                HStack {
                    Link("隐私政策", destination: URL(string: "https://github.com/wangyuqin378-cpu/jianwei/blob/main/docs/PRIVACY.md")!)
                    Spacer()
                    Link("使用条款", destination: URL(string: "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/")!)
                    Spacer()
                    Button("恢复购买") {
                        Task { await model.restoreManagedSubscription() }
                    }
                    .disabled(model.isWorking)
                }
                .font(.caption)
            }

            HStack {
                Rectangle()
                    .fill(JianweiBrand.ink.opacity(0.08))
                    .frame(height: 1)
                Text("或者使用自己的 Qwen Key")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .fixedSize()
                Rectangle()
                    .fill(JianweiBrand.ink.opacity(0.08))
                    .frame(height: 1)
            }

            if model.hasQwenAPIKey {
                Label("本机 Qwen Key 已配置", systemImage: "key.fill")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(JianweiBrand.forest)
            } else {
                SecureField("粘贴百炼 Qwen API Key", text: $qwenAPIKey)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .privacySensitive()
                    .textFieldStyle(.roundedBorder)

                Button("保存并使用自己的 Key") {
                    let value = qwenAPIKey
                    qwenAPIKey = ""
                    Task { await model.saveAndUseQwenAPIKey(value) }
                }
                .buttonStyle(.bordered)
                .tint(JianweiBrand.forest)
                .disabled(qwenAPIKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                Text("Key 只保存在本机 Keychain；分析时通过加密连接单次使用，服务端不保存。")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            if let message = model.message {
                Text(message)
                    .font(.caption)
                    .foregroundStyle(JianweiBrand.rust)
                    .accessibilityLabel("提示：\(message)")
            }
        }
        .padding(16)
        .background(JianweiBrand.surface, in: RoundedRectangle(cornerRadius: 21, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 21, style: .continuous)
                .stroke(JianweiBrand.ink.opacity(0.06), lineWidth: 1)
        }
    }

    private var hasConfiguredModelAccess: Bool {
        model.managedSubscriptionState == .subscribed || model.hasQwenAPIKey
    }

    private var subscriptionButtonTitle: String {
        if let price = model.managedSubscriptionPrice {
            return "订阅见微 Pro · \(price)/月"
        }
        return model.managedSubscriptionState == .productUnavailable
            ? "见微 Pro 暂不可购买"
            : "订阅见微 Pro"
    }

    private var footer: some View {
        HStack(spacing: 12) {
            if page > 0 {
                Button("返回") {
                    page -= 1
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
                .tint(JianweiBrand.forest)
            }
            Button {
                if page < 2 {
                    page += 1
                } else {
                    Task {
                        await model.finishOnboarding(
                            automatic: choice == .automatic,
                            interests: interests,
                            preparationMode: preparationMode
                        )
                    }
                }
            } label: {
                HStack {
                    Text(page < 2
                        ? "继续"
                        : choice == .automatic ? "开启自动发现" : "开始选择照片")
                    Spacer()
                    Image(systemName: page < 2 ? "arrow.right" : "sparkles")
                }
                .font(.headline)
                .padding(.horizontal, 4)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .tint(JianweiBrand.forest)
            .disabled(model.isWorking || (page == 2 && !hasConfiguredModelAccess))
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 14)
        .background(.ultraThinMaterial)
    }
}
