# 见微 / Jianwei

见微把用户相册里的日常照片变成有来源的每日知识卡，并通过桌面小组件持续展示。

> 当前处于工程候选阶段：Android、iOS、后端和知识库已形成完整框架，但生产云部署、正式签名、实体机验证和受控 Beta 仍未完成。

## 产品怎么工作

1. 每天从尚未处理过的相册照片里稳定随机挑选候选。
2. 客户端在本机排除人脸、证件、截图、文档、高文字密度、模糊和重复图片，直到得到最多 3 张安全候选。
3. 候选图压缩并清除元数据后，由 AI 分别理解物件、匹配已审核知识和来源。
4. AI 比较最多 3 条候选知识，只发布其中最有趣的 1 条；没有可靠命中时不猜测。
5. 卡片缓存在本机，由桌面组件每天展示；用户可以反馈、收藏或主动设置物品提醒。

系统照片选择器和分享导入仍可用于主动理解单张照片。

## 隐私边界

- 不识别人是谁，不推断人物关系、颜值、情绪或健康状况。
- 不自动读取微信等其他 App 的私有数据。
- 上传前移除 EXIF、文件名和本地媒体 ID；服务端不建立个人照片库。
- 图片分析完成后立即删除，异常情况下最长保留 24 小时。
- 小组件只读取本地缓存，不直接调用模型服务。
- 物品使用周期由用户确认起始时间，AI 不独立断言“用了多久”。
- 用户可以暂停分析、禁止再次分析某张照片，并删除本地或云端数据。

完整说明见 [隐私设计](docs/PRIVACY.md)。

## 仓库结构

| 目录 | 内容 |
| --- | --- |
| `android/` | Kotlin、Compose、Glance、Room、WorkManager 客户端 |
| `ios/` | Swift 6、SwiftUI、WidgetKit、PhotoKit、Vision 客户端 |
| `backend/` | TypeScript、Fastify、PostgreSQL、OSS、Qwen Provider |
| `knowledge/` | 日常物件主题、事实、来源和审核状态 |
| `docs/` | 架构、部署、隐私、验收和发布证据说明 |
| `scripts/` | 构建、验证和受控发布工具 |

## 本地运行

### 后端

需要 Node.js 20.12+ 和 pnpm 11。

```bash
cd backend
cp .env.example .env
pnpm install
pnpm test
pnpm dev
```

默认地址是 `http://127.0.0.1:8787`。保持 `VISION_PROVIDER=local` 时不需要云密钥，可运行本地闭环。

### Android

Windows 可直接运行：

```powershell
.\scripts\bootstrap-android-windows.ps1
.\scripts\build-android-windows.ps1
```

已有 Android 工具链时，也可以在 `android/` 下执行：

```bash
./gradlew :domain:test :app:testDebugUnitTest :data:testDebugUnitTest lintDebug assembleDebug
```

Android 模拟器通过 `http://10.0.2.2:8787/` 访问本机后端。

### iOS

需要 Xcode 和 XcodeGen。

```bash
cd ios
xcodegen generate
xcodebuild -project Jianwei.xcodeproj -scheme Jianwei \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' test
```

如果本机没有该模拟器，请把设备名替换为已安装的 iPhone 模拟器。

## 云端配置

托管模式的 Qwen、OSS 和数据库凭证只配置在后端环境变量中，不应写入客户端或提交到仓库。iOS 用户也可自行填写百炼 Qwen API Key；Key 只保存在本机 Keychain，服务端仅在单次请求内使用。见微 Pro 通过 StoreKit 购买，生产服务端必须验证 Apple 签名交易后才提供托管推理。

具体变量、部署顺序和放行条件见 [部署说明](docs/DEPLOYMENT.md)。

## 验证

常用验证命令：

```bash
cd backend
pnpm check
pnpm test
pnpm build
```

Android 与 iOS 的测试命令与上面的本地运行命令相同。完整自动化流程见 [GitHub CI](.github/workflows/ci.yml)。

## 进一步阅读

- [当前实现状态](docs/IMPLEMENTATION_STATUS.md)
- [成本与定价](docs/PRICING.md)
- [系统架构](docs/ARCHITECTURE.md)
- [知识审核](docs/KNOWLEDGE_REVIEW.md)
- [Beta 证据与放行手册](docs/BETA_EVIDENCE_RUNBOOK.md)
- [完整性审计](docs/COMPLETION_AUDIT.md)
