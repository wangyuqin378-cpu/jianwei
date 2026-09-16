import SwiftUI

struct OnboardingView: View {
    @Environment(AppModel.self) private var model
    @State private var page: Int
    @State private var interests = Set<KnowledgeInterest>([
        .everydayDesign,
        .objectHistory,
        .science
    ])
    @State private var qwenAPIKey = ""
    @FocusState private var keyFieldFocused: Bool
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
                    Text("扫帚刷毛做成斜扇形，是为了更贴近墙角")
                        .font(.title2.weight(.bold))
                        .foregroundStyle(.white)
                        .shadow(color: .black.opacity(0.24), radius: 8, y: 2)
                }
                .padding(18)
            }
            VStack(alignment: .leading, spacing: 10) {
                Text("有些扫帚把刷毛做成略带角度的扇形，让边缘更容易贴近墙角和家具边缘。")
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
        .accessibilityLabel("示例知识卡：扫帚刷毛做成斜扇形，是为了更贴近墙角")
    }

    private var privacyPage: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                VStack(alignment: .leading, spacing: 13) {
                    Text("先在 iPhone 上\n筛一遍")
                        .font(.system(size: 39, weight: .bold, design: .serif))
                        .tracking(-0.7)
                        .foregroundStyle(JianweiBrand.ink)
                    Text("先排除检测到的人物、证件、截图和高文字密度图片，再压缩少量合适候选并清除元数据。自动检测可能有误，你可以随时暂停分析。")
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
                        title: "只发送候选",
                        detail: "长边缩至 1280 px，移除元数据后发送给你所选的 AI 服务"
                    )
                    Divider().padding(.leading, 64)
                    privacyRow(
                        number: "03",
                        icon: "trash.slash",
                        title: "见微不建立云端相册",
                        detail: "原图不长期上云；只在本机保留展示所需的脱敏缩略图"
                    )
                }
                .jianweiCard()

                Label("拒绝相册权限后不会读取或发送任何照片，可随时在系统设置中重新开启", systemImage: "hand.raised.fill")
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
                    Text("每天替你选出一条")
                        .font(.system(size: 34, weight: .bold, design: .serif))
                        .tracking(-0.5)
                        .foregroundStyle(JianweiBrand.ink)
                    Text("见微会自动寻找未处理照片。为每一天准备内容时，最多交给 AI 9 张；找到 3 条合格知识后，选出最好的一条。")
                        .font(.body)
                        .foregroundStyle(.secondary)
                }

                onboardingSectionTitle("1", "自动发现")
                Label(
                    "优先读取最近 90 天的照片；候选不足时再从更早照片继续，最多查看 500 张。先在本机筛选，再发送脱敏候选。先准备今天，再补齐未来 6 天；首次补齐一周最多分析 63 张。",
                    systemImage: "photo.stack.fill"
                )
                .font(.subheadline)
                .foregroundStyle(JianweiBrand.forest)
                .padding(16)
                .jianweiCard(cornerRadius: 20)

                onboardingSectionTitle("2", "选择感兴趣的方向")

                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Text("至少保留 3 个")
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

                onboardingSectionTitle("3", "准备 AI 服务")
                modelAccessCard
            }
            .padding(.horizontal, 22)
            .padding(.top, 18)
            .padding(.bottom, 150)
        }
        .scrollIndicators(.hidden)
    }

    private func onboardingSectionTitle(_ number: String, _ title: String) -> some View {
        HStack(spacing: 9) {
            Text(number)
                .font(.caption.monospacedDigit().weight(.bold))
                .foregroundStyle(.white)
                .frame(width: 24, height: 24)
                .background(JianweiBrand.forest, in: Circle())
            Text(title)
                .font(.headline)
                .foregroundStyle(JianweiBrand.ink)
        }
        .padding(.top, 2)
        .accessibilityElement(children: .combine)
    }

    private var modelAccessCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 5) {
                Text(model.modelAccessReady ? "AI 服务已准备好" : "选择 AI 服务")
                    .font(.headline)
                    .foregroundStyle(JianweiBrand.ink)
                Text("每个待准备日期最多分析 9 张新照片；每张都会尝试多个可见物件和知识角度，找到 3 条合格知识便停止。已备好的日期不会重复分析。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if model.deviceBetaExperienceEnabled && model.managedServiceAvailable {
                if model.modelAccessMode == .managed {
                    Label("现有 AI 已配置，无需填写内容或 Key", systemImage: "checkmark.seal.fill")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(JianweiBrand.forest)
                    Text("完成授权后会直接开始自动准备。")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                } else {
                    Button("使用见微体验服务") {
                        Task { await model.useManagedModelService() }
                    }
                    .disabled(model.isWorking)
                }
            } else if !model.managedServiceAvailable {
                Label("个人 Beta · 使用自己的 Qwen Key", systemImage: "iphone.and.arrow.forward")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(JianweiBrand.forest)
            } else if model.managedSubscriptionState == .subscribed {
                if model.modelAccessMode == .managed {
                    Label("见微 Pro 已开通", systemImage: "checkmark.seal.fill")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(JianweiBrand.forest)
                } else {
                    Button("使用已订阅的见微 Pro") {
                        Task { await model.useManagedModelService() }
                    }
                    .disabled(model.isWorking)
                }
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

                Text("按月自动续订；每天展示 1 条。每个待准备日期最多分析 9 张照片，并提前缓存今天及未来 6 天。可随时在 App Store 取消。")
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

            if model.modelAccessMode == .qwenUserKey || !model.managedServiceAvailable {
                qwenKeyControls
            } else {
                DisclosureGroup("使用自己的 Qwen Key") { qwenKeyControls }
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

    @ViewBuilder
    private var qwenKeyControls: some View {
        if model.hasQwenAPIKey {
            Label("本机 Qwen Key 已配置", systemImage: "key.fill")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(JianweiBrand.forest)
            if model.modelAccessMode != .qwenUserKey {
                Button("使用已保存的 Qwen Key") {
                    Task { await model.useSavedQwenAPIKey() }
                }
                .disabled(model.isWorking)
            }
        } else {
            SecureField("粘贴百炼 Qwen API Key", text: $qwenAPIKey)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .privacySensitive()
                .focused($keyFieldFocused)
                .submitLabel(.done)
                .onSubmit { keyFieldFocused = false }
                .textFieldStyle(.roundedBorder)

            Button("保存并使用自己的 Key") {
                keyFieldFocused = false
                let value = qwenAPIKey
                qwenAPIKey = ""
                Task { await model.saveAndUseQwenAPIKey(value) }
            }
            .buttonStyle(.bordered)
            .tint(JianweiBrand.forest)
            .disabled(model.isWorking || qwenAPIKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

        }
        Text("Key 只保存在本机；照片直连百炼，不经过见微服务器。不代开或要求联网搜索，AI 可用已有知识生成并标注未联网核实，费用计入自己的百炼账号。")
            .font(.caption2)
            .foregroundStyle(.secondary)
    }

    private var hasConfiguredModelAccess: Bool {
        model.modelAccessReady
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
                            automatic: true,
                            interests: interests,
                            preparationMode: preparationMode
                        )
                    }
                }
            } label: {
                HStack {
                    Text(page < 2 ? "继续" : "授权并开始自动发现")
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
