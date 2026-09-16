import SwiftUI
import UIKit

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @State private var interests = Set<KnowledgeInterest>()
    @State private var preparationMode: AutomaticPreparationMode = .dailySingle
    @State private var confirmLocalDeletion = false
    @State private var confirmCloudDeletion = false
    @State private var qwenAPIKey = ""
    @FocusState private var keyFieldFocused: Bool

    var body: some View {
        ZStack {
            JianweiBrand.paper.ignoresSafeArea()
            Form {
                discoverySection
                modelServiceSection
                preferenceSection
                privacySection
                aboutSection
            }
            .scrollContentBackground(.hidden)
            .scrollDismissesKeyboard(.interactively)
            .contentMargins(.bottom, 104, for: .scrollContent)
        }
        .onDisappear { qwenAPIKey = "" }
        .navigationTitle("设置")
        .onAppear {
            interests = model.interests
            preparationMode = model.preparationMode
        }
        .alert(
            "清除本机数据？",
            isPresented: $confirmLocalDeletion
        ) {
            Button("清除本机索引和卡片", role: .destructive) {
                Task { await model.deleteLocalData() }
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("会删除本机照片索引、知识卡和脱敏缩略图，不会删除系统相册原图或本机 Qwen Key，也不会取消订阅。过去的见微云端数据和删除凭证仍保留。")
        }
        .alert(
            "删除见微云端与本机数据？",
            isPresented: $confirmCloudDeletion
        ) {
            Button("删除云端与本机数据", role: .destructive) {
                Task { await model.deleteCloudAndLocalData() }
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("只删除已有的见微云端身份，不会注册新身份。云端删除需要联网确认；即使未确认，仍会清除本机卡片与缩略图并保留重试凭证。不会删除系统相册原图、本机 Qwen Key，也不会取消订阅。")
        }
    }

    private var modelServiceSection: some View {
        Section {
            LabeledContent("当前方式") {
                Text(model.modelAccessMode.title)
                    .foregroundStyle(JianweiBrand.mutedText)
            }

            if model.deviceBetaExperienceEnabled && model.managedServiceAvailable {
                if model.modelAccessMode == .managed {
                    Label("真机体验服务已配置，无需填写 Key", systemImage: "checkmark.seal.fill")
                        .foregroundStyle(JianweiBrand.forest)
                } else {
                    Button("使用见微体验服务") {
                        Task { await model.useManagedModelService() }
                    }
                    .disabled(model.isWorking)
                }
            } else if !model.managedServiceAvailable {
                Label("iPhone 通过 HTTPS 直接连接阿里云百炼", systemImage: "iphone.and.arrow.forward")
                    .foregroundStyle(JianweiBrand.forest)
            } else if model.managedSubscriptionState == .subscribed {
                Button {
                    Task { await model.useManagedModelService() }
                } label: {
                    HStack {
                        Label("使用见微托管服务", systemImage: "sparkles")
                        Spacer()
                        if model.modelAccessMode == .managed {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundStyle(JianweiBrand.forest)
                        }
                    }
                }
                .foregroundStyle(JianweiBrand.ink)
                .disabled(model.isWorking)
            } else {
                Button {
                    Task { await model.purchaseManagedModelService() }
                } label: {
                    Label(subscriptionButtonTitle, systemImage: "sparkles")
                }
                .disabled(model.isWorking || model.managedSubscriptionState == .productUnavailable)
            }

            if model.managedServiceAvailable && !model.deviceBetaExperienceEnabled {
                Button("恢复购买") {
                    Task { await model.restoreManagedSubscription() }
                }
                .disabled(model.isWorking)
            }

            if model.managedSubscriptionState == .subscribed && !model.deviceBetaExperienceEnabled {
                Link("管理或取消订阅", destination: URL(string: "https://apps.apple.com/account/subscriptions")!)
            }

            HStack {
                Link("隐私政策", destination: URL(string: "https://github.com/wangyuqin378-cpu/jianwei/blob/main/docs/PRIVACY.md")!)
                Spacer()
                Link("使用条款", destination: URL(string: "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/")!)
            }

            if model.modelAccessMode == .qwenUserKey || !model.managedServiceAvailable {
                qwenKeyControls
            } else {
                DisclosureGroup("使用自己的 Qwen Key") { qwenKeyControls }
            }
        } header: {
            Text("AI 服务").foregroundStyle(JianweiBrand.mutedText)
        } footer: {
            Text(model.modelAccessMode == .qwenUserKey
                ? "自己的 Key 只保存在本机 Keychain，照片直接发送给百炼，不经过见微服务器。不代开联网搜索或额外付费审核；AI 可用已有知识生成，未联网核实会明确标注。费用计入自己的百炼账号。"
                : model.usesLocalDevelopmentService
                    ? "本地开发服务只适合同一网络调试；平台 Key 不会写入 iPhone。候选照片先在本机完成隐私筛选、压缩和去除 EXIF。"
                    : "见微服务使用平台 Key 和模型内置联网搜索，费用由见微承担并纳入服务定价。候选照片先在本机完成隐私筛选、压缩和去除 EXIF。")
                .foregroundStyle(JianweiBrand.mutedText)
        }
    }

    @ViewBuilder
    private var qwenKeyControls: some View {
        if model.hasQwenAPIKey && model.modelAccessMode != .qwenUserKey {
            Button("使用已保存的 Qwen Key") {
                Task { await model.useSavedQwenAPIKey() }
            }
            .disabled(model.isWorking)
        }
        SecureField("粘贴百炼 Qwen API Key", text: $qwenAPIKey)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .privacySensitive()
            .focused($keyFieldFocused)
            .submitLabel(.done)
            .onSubmit { keyFieldFocused = false }

        Button {
            keyFieldFocused = false
            let value = qwenAPIKey
            qwenAPIKey = ""
            Task { await model.saveAndUseQwenAPIKey(value) }
        } label: {
            Label(
                model.hasQwenAPIKey ? "更新并使用自己的 Key" : "保存并使用自己的 Key",
                systemImage: "key.fill"
            )
        }
        .disabled(model.isWorking || qwenAPIKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

        if model.hasQwenAPIKey {
            LabeledContent("本机 Key", value: "已安全保存")
            Button("删除本机 Qwen Key", role: .destructive) {
                qwenAPIKey = ""
                Task { await model.removeQwenAPIKey() }
            }
        }
    }

    private var subscriptionButtonTitle: String {
        if let price = model.managedSubscriptionPrice {
            return "订阅见微 Pro · \(price)/月"
        }
        return "订阅见微 Pro"
    }

    private var discoverySection: some View {
        Section {
            Button {
                Task {
                    if model.automaticDiscoveryEnabled {
                        await model.disableAutomaticDiscovery()
                    } else {
                        await model.enableAutomaticDiscovery()
                    }
                }
            } label: {
                HStack {
                    Label(
                        model.automaticDiscoveryEnabled ? "自动发现已开启" : "开启自动发现",
                        systemImage: model.automaticDiscoveryEnabled ? "photo.stack.fill" : "photo.stack"
                    )
                    Spacer()
                    Text(model.automaticDiscoveryEnabled ? "开启" : "关闭")
                        .foregroundStyle(
                            model.automaticDiscoveryEnabled ? JianweiBrand.forest : JianweiBrand.mutedText
                        )
                }
            }
            .foregroundStyle(JianweiBrand.ink)
            .accessibilityIdentifier("automatic-discovery-toggle")
            .accessibilityValue(model.automaticDiscoveryEnabled ? "开启" : "关闭")

            HStack {
                Label("照片访问", systemImage: "photo.on.rectangle")
                Spacer()
                Text(photoAccessTitle)
                    .foregroundStyle(JianweiBrand.mutedText)
            }

            if model.photoAccess == .limited || model.photoAccess == .denied {
                Button("在系统设置中管理照片权限") {
                    guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
                    UIApplication.shared.open(url)
                }
            }

            VStack(alignment: .leading, spacing: 8) {
                Label(model.backgroundPreparationAvailability.title, systemImage: "clock.arrow.circlepath")
                    .foregroundStyle(JianweiBrand.ink)
                Text(model.backgroundPreparationAvailability.detail)
                    .font(.footnote)
                    .foregroundStyle(JianweiBrand.mutedText)
                if model.backgroundPreparationAvailability == .disabled {
                    Button("打开系统设置") {
                        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
                        UIApplication.shared.open(url)
                    }
                    .font(.footnote.weight(.semibold))
                }
            }
            .accessibilityIdentifier("background-preparation-status")

            if model.automaticDiscoveryEnabled {
                Button {
                    Task { await model.runAutomaticDiscovery() }
                } label: {
                    Label("现在检查新照片", systemImage: "arrow.clockwise")
                }
                .disabled(model.isWorking)
            }
        } header: {
            Text("照片发现").foregroundStyle(JianweiBrand.mutedText)
        } footer: {
            Text("关闭“自动发现”会停止新的相册扫描与后台任务；重新开启后会从未处理照片继续。")
                .foregroundStyle(JianweiBrand.mutedText)
        }
    }

    private var preferenceSection: some View {
        Section {
            LabeledContent("每个准备日期") {
                Text("最多分析 9 张，展示 1 条")
                    .foregroundStyle(JianweiBrand.mutedText)
            }

            if let record = model.state.dailyPreparations[ChinaDay.string(from: Date())] {
                LabeledContent("今天进度") {
                    Text("本机 \(record.inspectedPhotoCount) · AI \(record.aiPhotoCount) · 合格 \(record.qualifiedCardIDs.count)")
                        .foregroundStyle(JianweiBrand.mutedText)
                }
            }

            ForEach(KnowledgeInterest.allCases) { interest in
                Button {
                    if interests.contains(interest) {
                        if interests.count > 3 { interests.remove(interest) }
                    } else {
                        interests.insert(interest)
                    }
                    savePreferences()
                } label: {
                    HStack {
                        Text(interest.title)
                            .foregroundStyle(JianweiBrand.ink)
                        Spacer()
                        Image(systemName: interests.contains(interest) ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(
                                interests.contains(interest)
                                    ? JianweiBrand.forest
                                    : JianweiBrand.mutedText
                            )
                    }
                }
            }
        } header: {
            Text("内容偏好").foregroundStyle(JianweiBrand.mutedText)
        } footer: {
            Text("会提前准备今天及未来 6 天，每个日期最多分析 9 张照片。至少保留 3 个兴趣方向，反馈会微调推荐。")
                .foregroundStyle(JianweiBrand.mutedText)
        }
    }

    private var privacySection: some View {
        Section {
            if model.modelAccessMode == .managed && model.managedServiceAvailable {
                Button {
                    Task { await model.checkServiceConnection() }
                } label: {
                    HStack {
                        Label("检测服务连接", systemImage: "network")
                        Spacer()
                        if model.serviceConnectionState == .checking {
                            ProgressView()
                        }
                        Text(model.serviceConnectionState.title)
                            .foregroundStyle(
                                model.serviceConnectionState == .connected
                                    ? JianweiBrand.forest
                                    : model.serviceConnectionState == .unavailable
                                    ? JianweiBrand.rust
                                    : JianweiBrand.mutedText
                            )
                    }
                }
                .disabled(model.serviceConnectionState == .checking)
                .accessibilityLabel("检测服务连接，\(model.serviceConnectionState.title)")
                .accessibilityIdentifier("serviceConnectionCheck")

                if model.deviceBetaExperienceEnabled,
                   model.usesLocalDevelopmentService,
                   model.serviceConnectionState == .unavailable {
                    Button {
                        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
                        UIApplication.shared.open(url)
                    } label: {
                        Label("打开系统设置，允许本地网络", systemImage: "gear")
                    }
                    Text("进入后打开“本地网络”，返回见微会自动重新检测。")
                        .font(.footnote)
                        .foregroundStyle(JianweiBrand.mutedText)
                }
            } else {
                HStack {
                    Label(model.modelAccessMode == .qwenUserKey ? "Qwen Key" : "服务连接", systemImage: "network")
                    Spacer()
                    Text(model.modelAccessMode == .qwenUserKey
                        ? (model.hasQwenAPIKey ? "已保存在本机" : "未添加")
                        : (model.serviceConfigured ? "已配置" : "未配置"))
                        .foregroundStyle(model.serviceConfigured ? JianweiBrand.forest : JianweiBrand.rust)
                }
            }

            Button("清除本机索引、卡片与缩略图", role: .destructive) {
                confirmLocalDeletion = true
            }

            if model.managedServiceAvailable {
                Button("删除见微云端与本机数据", role: .destructive) {
                    confirmCloudDeletion = true
                }
                .disabled(model.isWorking)
            }
        } header: {
            Text("隐私中心").foregroundStyle(JianweiBrand.mutedText)
        } footer: {
            Text(model.modelAccessMode == .qwenUserKey
                ? "自带 Key 的照片与生成请求直连百炼，不检查见微服务器。若曾使用托管服务，切换 Key 不会自动删除旧云端数据。以上删除不处理百炼按其条款保留的数据。"
                : "见微不接广告 SDK，也不使用照片建立广告画像。云端删除确认后清除设备访问凭证；用于购买归属的本机随机安装标识仍保留。")
                .foregroundStyle(JianweiBrand.mutedText)
        }
    }

    private var aboutSection: some View {
        Section {
            LabeledContent("版本") {
                Text("0.1.0 · iOS Beta")
                    .foregroundStyle(JianweiBrand.mutedText)
            }
            Link(destination: URL(string: "https://www.ada.org/resources/ada-library/oral-health-topics/toothbrushes")!) {
                Label("内容与健康建议原则", systemImage: "checkmark.seal")
            }
        } header: {
            Text("关于见微").foregroundStyle(JianweiBrand.mutedText)
        } footer: {
            Text("健康与安全卡片只使用经过审核的权威来源；不提供诊断或个性化医疗建议。")
                .foregroundStyle(JianweiBrand.mutedText)
        }
    }

    private var photoAccessTitle: String {
        switch model.photoAccess {
        case .full: "完整"
        case .limited: "部分照片"
        case .denied: "未授权"
        case .notDetermined: "尚未选择"
        }
    }

    private func savePreferences() {
        Task {
            await model.updatePreferences(
                interests: interests,
                preparationMode: preparationMode
            )
        }
    }
}
