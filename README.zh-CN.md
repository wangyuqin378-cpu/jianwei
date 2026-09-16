# 见微 / Jianwei

[English](README.md) · [产品介绍](https://yuqin.wang/#/project/jianwei)

**从日常照片中发现一点知识。** 当前仓库已同步 iPhone App、小组件、Cloudflare 网关和评测工具的最新开发源码，Android 与 Fastify 后端保留为早期工程。当前尚无公开 App 下载，内容质量、真机跨日小组件和正式分发仍待验收。

<img src="docs/images/jianwei-today.webp" width="260" alt="见微开发预览：照片知识卡与来源入口">

图片来自开发中的产品预览，不是正式发行包的验收证据。

见微把用户相册里的日常照片变成每日知识卡，并通过桌面小组件展示。知识库和联网核实卡提供实际来源；自带 Key 生成的模型知识会标注“未联网核实”，不编造来源。

> 本次仅同步源码，不更新云端部署或手机安装包。具体验证结果见[同步状态](docs/SOURCE_SNAPSHOT_2026-09-17.md)。

## 产品怎么工作

1. 授权相册后自动发现未处理照片，无需逐张选图。
2. 本机筛除人物、证件、截图、高文字密度、模糊和重复图片，压缩并去除元数据。
3. 每个准备日期最多送 AI 9 张，前三张没有合格知识便继续补选，最多留下 3 条卡。
4. 选一条作为主卡，其余用于“换一条”；展示过的卡自动进入回顾，可反馈和收藏。
5. 提前准备今天及未来 6 天，前台一次最多分析 63 张、后台一次最多 9 张。当天没有新卡时继续显示最近一条。

支持自己的 Qwen Key 或授权的见微托管服务。BYOK 不代开联网搜索、不回退平台 Key；托管新知识研究使用模型内置搜索。iOS 后台执行由系统调度，不承诺精确更新时间。

## 隐私边界

- 不识别人是谁，不推断人物关系、颜值、情绪或健康状况。
- 不自动读取微信等其他 App 的私有数据。
- 上传前移除 EXIF、文件名和本地媒体 ID；服务端不建立个人照片库。
- 当前 Cloudflare 网关只在模型处理期间转发脱敏图，不将图片写入 D1 或对象存储。
- 小组件只读取本地缓存，不直接调用模型服务。
- 物品使用周期由用户确认起始时间，AI 不独立断言“用了多久”。
- 用户可以暂停分析、禁止再次分析某张照片，并删除本地或云端数据。

完整说明见 [隐私设计](docs/PRIVACY.md)。

## 仓库结构

| 目录 | 内容 |
| --- | --- |
| `android/` | Kotlin、Compose、Glance、Room、WorkManager 客户端 |
| `ios/` | Swift 6、SwiftUI、WidgetKit、PhotoKit、Vision 客户端 |
| `cloudflare/gateway/` | Qwen 产品接口、D1 缓存、权益、幂等和用量控制 |
| `backend/` | TypeScript、Fastify、PostgreSQL、OSS、Qwen Provider |
| `knowledge/` | 日常物件主题、事实、来源和审核状态 |
| `docs/` | 架构、部署、隐私、验收和发布证据说明 |
| `scripts/` | 构建、验证和受控发布工具 |

## 本地运行

### 当前 Cloudflare 网关

需要 Node.js 22+。以下只运行本地检查，不部署、不调用付费模型：

```bash
cd cloudflare/gateway
npm ci --ignore-scripts
npm run check
npm test
npm run test:runtime
```

### 早期 Fastify 后端

需要 Node.js 20.12+ 和 pnpm 11。

```bash
cd backend
cp .env.example .env
pnpm install
pnpm test
pnpm dev
```

默认地址是 `http://127.0.0.1:8787`。保持 `VISION_PROVIDER=local` 时不需要云密钥，可运行本地闭环。

已有百炼凭据 CSV 时，可直接启动不依赖 RDS、OSS 或函数计算的 Qwen 体验服务：

```bash
pnpm experience:free -- --credentials-file /absolute/path/to/bailian-credentials.csv
```

该模式使用 Qwen，图片只临时保存在本机；费用由该凭据所属账号承担。模型版本和额度以服务配置为准，不要把这个早期服务的额度当成当前 iOS/Cloudflare 产品限制。
需要让测试手机通过 HTTPS 访问时，再追加 `--public-base-url https://你的测试域名`；该地址必须同时转发 API 与图片上传请求。

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

当前托管路径使用 Cloudflare 网关和 D1，不要求 RDS、OSS 或函数计算；公开源码不包含可直接使用的托管凭证。平台 Key 与 Beta 授权只配置在服务器，不能提交到仓库。BYOK 的 Key 只保存在手机 Keychain，手机直连百炼，不发送给见微网关。订阅代码保留，但正式购买/恢复与分发尚未验收，不能据此宣称服务已可购买。

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

## 源码与许可

源码公开供查阅；仓库目前没有开源许可证，公开可见不等于授予开源使用许可。
