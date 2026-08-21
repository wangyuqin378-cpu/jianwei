import SwiftUI
import UIKit

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @State private var interests = Set<KnowledgeInterest>()
    @State private var preparationMode: AutomaticPreparationMode = .weeklyCache
    @State private var confirmLocalDeletion = false
    @State private var confirmCloudDeletion = false

    var body: some View {
        ZStack {
            JianweiBrand.paper.ignoresSafeArea()
            Form {
                discoverySection
                preferenceSection
                privacySection
                aboutSection
            }
            .scrollContentBackground(.hidden)
        }
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
            Picker("准备方式", selection: $preparationMode) {
                ForEach(AutomaticPreparationMode.allCases, id: \.self) { mode in
                    Text(mode.title).tag(mode)
                }
            }
            .onChange(of: preparationMode) { _, _ in savePreferences() }

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
