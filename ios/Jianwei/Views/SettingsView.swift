import SwiftUI
import UIKit

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @State private var interests = Set<KnowledgeInterest>()
    @State private var preparationMode: AutomaticPreparationMode = .dailySingle
    @State private var confirmLocalDeletion = false
    @State private var confirmCloudDeletion = false
    @State private var qwenAPIKey = ""

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
        }
        .onDisappear { qwenAPIKey = "" }
        .navigationTitle("设置")
        .onAppear {
            interests = model.interests
            preparationMode = model.preparationMode
        }
        .confirmationDialog(
            "清除本机数据？",
            isPresented: $confirmLocalDeletion,
            titleVisibility: .visible
        ) {
            Button("清除本机索引和卡片", role: .destructive) {
                Task { await model.deleteLocalData() }
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("不会自动删除云端匿名设备数据。再次使用时可重新开始。")
        }
        .confirmationDialog(
            "删除见微中的全部数据？",
            isPresented: $confirmCloudDeletion,
            titleVisibility: .visible
        ) {
            Button("删除云端与本机数据", role: .destructive) {
                Task { await model.deleteCloudAndLocalData() }
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("需要联网取得服务端确认。此操作完成后无法恢复。")
        }
    }

    private var modelServiceSection: some View {
        Section {
            LabeledContent("当前方式", value: model.modelAccessMode.title)
            LabeledContent("见微 Pro", value: model.managedSubscriptionState.title)

            if model.managedSubscriptionState == .subscribed {
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
            } else {
                Button {
                    Task { await model.purchaseManagedModelService() }
                } label: {
                    Label(subscriptionButtonTitle, systemImage: "sparkles")
                }
                .disabled(model.isWorking || model.managedSubscriptionState == .productUnavailable)
            }

            Button("恢复购买") {
                Task { await model.restoreManagedSubscription() }
            }
            .disabled(model.isWorking)

            if model.managedSubscriptionState == .subscribed {
                Link("管理或取消订阅", destination: URL(string: "https://apps.apple.com/account/subscriptions")!)
            }

            HStack {
                Link("隐私政策", destination: URL(string: "https://github.com/wangyuqin378-cpu/jianwei/blob/main/docs/PRIVACY.md")!)
                Spacer()
                Link("使用条款", destination: URL(string: "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/")!)
            }

            SecureField("粘贴百炼 Qwen API Key", text: $qwenAPIKey)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .privacySensitive()

            Button {
                let value = qwenAPIKey
                qwenAPIKey = ""
                Task { await model.saveAndUseQwenAPIKey(value) }
            } label: {
                Label(
                    model.hasQwenAPIKey ? "更新并使用自己的 Key" : "保存并使用自己的 Key",
                    systemImage: "key.fill"
                )
            }
            .disabled(qwenAPIKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

            if model.hasQwenAPIKey {
                LabeledContent("本机 Key", value: "已安全保存")
                Button("删除本机 Qwen Key", role: .destructive) {
                    qwenAPIKey = ""
                    Task { await model.removeQwenAPIKey() }
                }
            }
        } header: {
            Text("AI 服务")
        } footer: {
            Text("见微 Pro 为按月自动续订服务：每天最多分析 3 张未处理照片并发布 1 条知识，每自然月最多 31 条；可随时在 App Store 取消。购买时显示的本地价格为准。自己的 Key 只保存在本机 Keychain，分析时通过加密连接单次使用，服务端不保存。")
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
                            model.automaticDiscoveryEnabled ? JianweiBrand.forest : Color.secondary
                        )
                }
            }
            .foregroundStyle(JianweiBrand.ink)

            HStack {
                Label("照片访问", systemImage: "photo.on.rectangle")
                Spacer()
                Text(photoAccessTitle)
                    .foregroundStyle(.secondary)
            }

            if model.photoAccess == .limited || model.photoAccess == .denied {
                Button("在系统设置中管理照片权限") {
                    guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
                    UIApplication.shared.open(url)
                }
            }

            if model.automaticDiscoveryEnabled {
                Button {
                    Task { await model.runAutomaticDiscovery() }
                } label: {
                    Label("现在检查新照片", systemImage: "arrow.clockwise")
                }
                .disabled(model.isWorking)
            }
        } header: {
            Text("照片发现")
        } footer: {
            Text("关闭后会停止新的相册扫描与后台任务；系统照片选择器仍可使用。")
        }
    }

    private var preferenceSection: some View {
        Section {
            LabeledContent("每日准备", value: "3 张候选 → 1 条知识")

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
                                    : Color.secondary.opacity(0.45)
                            )
                    }
                }
            }
        } header: {
            Text("内容偏好")
        } footer: {
            Text("至少保留 3 个方向。反馈会在这些显式选择之外微调推荐。")
        }
    }

    private var privacySection: some View {
        Section {
            HStack {
                Label("服务连接", systemImage: "network")
                Spacer()
                Text(model.serviceConfigured ? "已配置" : "未配置")
                    .foregroundStyle(model.serviceConfigured ? JianweiBrand.forest : JianweiBrand.rust)
            }

            Button("清除本机索引与缩略图", role: .destructive) {
                confirmLocalDeletion = true
            }

            Button("删除云端与本机全部数据", role: .destructive) {
                confirmCloudDeletion = true
            }
            .disabled(model.isWorking)
        } header: {
            Text("隐私中心")
        } footer: {
            Text("见微不接广告 SDK，也不使用照片建立广告画像。云端删除只有收到服务确认后才会清除本机身份。")
        }
    }

    private var aboutSection: some View {
        Section {
            LabeledContent("版本", value: "0.1.0 · iOS Beta")
            Link(destination: URL(string: "https://www.ada.org/resources/ada-library/oral-health-topics/toothbrushes")!) {
                Label("内容与健康建议原则", systemImage: "checkmark.seal")
            }
        } header: {
            Text("关于见微")
        } footer: {
            Text("健康与安全卡片只使用经过审核的权威来源；不提供诊断或个性化医疗建议。")
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
