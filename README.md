# 见微 / Jianwei

见微把用户相册里的日常照片变成有来源的每日知识卡，并通过桌面小组件持续展示。仓库包含：

- `android/`：Kotlin + Compose + Glance + Room + WorkManager 客户端。
- `ios/`：Swift 6 + SwiftUI + WidgetKit + AppIntents + PhotoKit + Vision 客户端。
- `backend/`：Fastify API、PostgreSQL 持久化、临时对象存储与通义视觉适配器。
- `knowledge/`：经过结构校验的日常物件知识种子。
- `docs/`：架构、隐私和验收说明。

## iOS 当前候选

iOS 首版支持 iOS 17+，包含完整/部分/拒绝照片权限、系统照片选择器、近 90 天/最多 500 张的增量发现、端侧人脸/OCR/证件/模糊/重复筛选、1280 px 去元数据候选、匿名设备身份、严格 API DTO 校验、本地卡片/反馈缓存、隐私删除，以及小号/中号 WidgetKit。Widget 只读取 App Group 内最多 800 px 的脱敏缩略图和卡片 JSON，不直接联网；中号组件可用 AppIntent 每天换两次，未来 7 天时间线离线可用。

本地工程由 `ios/project.yml` 生成：

```bash
cd ios
xcodegen generate
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  xcodebuild -project Jianwei.xcodeproj -scheme Jianwei \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' test
```

普通 Debug 与 Release 的 `JIANWEI_API_BASE_URL` 都故意保持为空；只有显式运行获授权图片云端 E2E 时，Debug 专用参数才连接 `http://127.0.0.1:8787`。正式构建必须在真实 HTTPS 后端部署后由私有构建配置注入地址。真机分发还必须在 Apple Developer 中为 App 与 Widget 注册 `group.cn.jianwei.shared`、设置同一 Development Team 并创建签名配置；仓库不保存证书或生产密钥。

2026-08-03 的本地证据使用 iPhone 17 Pro / iOS 26.5 模拟器：三屏首次体验、动态大字、主卡详情、系统组件库发现、小号/中号桌面添加、真实 App Group 卡片读取、两次 AppIntent 换卡和耗尽提示均通过。当前 Mac 没有有效代码签名身份，也没有连接 iPhone，生产 HTTPS 地址仍未配置，因此这些是 `releaseEvidence=false` 的工程证据，不能作为 TestFlight 或真实设备 Beta 放行证明。

## 当前可运行闭环

当前 Android 候选为 Beta.73（`versionCode=73 / 0.1.0-beta73`）。受控内测 Release 只携带 `arm64-v8a` 与 `armeabi-v7a`，Debug 继续保留模拟器架构；unsigned Release 已从 128,833,539 字节降为 61,555,212 字节。候选门禁会从 APK 本身复核 ABI，并拒绝超过 70 MiB 的工件。

当前安装体验已使用正式自适应品牌图标：普通与圆形 Launcher 蒙版、Android 13 主题图标都在 Pixel Launcher 实际渲染通过；物品提醒改用独立白色单色小图标，不再误用全彩图标。Android 12+ 启动画面在 API 31 资源中显式绑定同一暖白背景与见微前景图形，最终 APK 资源表已复核三项 SplashScreen 属性。截图和本地审计位于 `.tooling/beta73-launcher-branding/`，均为 `releaseEvidence=false` 的模拟器工程证据。

首次体验第 3 屏现在把说明、兴趣和自动准备方式留在可滚动区域，把返回与唯一主操作固定在底部并避开系统导航栏；主按钮会随开始方式切换为“开启自动发现 / 选择一张照片”。返回与主操作按 0.72:1.28 分配宽度，标准与 1.6× 字体下均保持单行、完整可见。API 34 两种字号专项各 2/2、完整 App 设备回归 30/30；截图与审计位于 `.tooling/beta73-onboarding-sticky-action/`，均为 `releaseEvidence=false` 的模拟器工程证据。

桌面组件现在以事实标题为第一信息：标准字体下，长标题在 2×2 最多三行、4×2 最多两行；系统字体达到 1.3× 时，2×2 缩成照片线索条并把四行空间留给事实，4×2 使用三行事实，两种尺寸都优先保证标题、来源和进入详情的操作可读。API 34 的标准与 1.6× 字体均已通过真实 Pixel Launcher 安装、桌面页定位和缩放手柄验证；当前标准/大字体截图位于 `.tooling/beta73-widget-fact-headline/`。

后端生产容器也已完成真实本地闭环：固定 Node 22.23.1 trixie-slim 的不可变 index digest，在独立 x86_64 VM 构建 `linux/amd64` 镜像；运行时移除 npm/corepack、默认使用非 root `node`。当前镜像 86,601,925 字节，OCI image ID 为 `sha256:247ab4ae97d3d73b2e9d66c72c3e06764640566ee7951cad193b29dd510cea1c`，`/health/live` 与 `/health/ready` 均通过，后端 Release SHA-256 为 `223f618f7084a529a5fd9eee386049cf118297bd550b2c918f88598e51609109`。PostgreSQL 17.10 的 15 个迁移已完成三轮幂等执行、17 项真实集成测试和 TCP E2E；容器扫描中可修复 HIGH/CRITICAL 为 0，但仍有 22 项当前没有修复版本的基础系统 HIGH/CRITICAL。这些只证明本地生产镜像可构建、可运行并经过本地安全检查，不代表阿里云资源已经部署。

当前内容基线为 `2026-07-28-beta.64`：554/554 条一般知识均经固定 Qwen 模型与生产 `cip` 护栏审核通过，70 条健康/安全事实继续保持草稿、不进入首版发布池。知识 readiness 为 `GO`，200 个受控主题中 183 个可供卡、554 条事实带有效 AI 审核签注；目录 SHA-256 为 `ef26febc1520d9b46e74dd34a985ed2d2e270cd857dea21456f5e93a8e88a923`。

用户已确认首版执行全量内容审核。这里的“全量”是所有一般知识在发布前统一经过固定 Qwen 与生产 `cip` 自动审核，覆盖涉政、违法、色情、暴力、仇恨、侵权和隐私等主要风险；模型不确定即拒绝。健康与安全事实首版不自动发布，人工只处理异常、纠错和发布后抽检，不要求维护逐条审批后台。

生成卡片也不再要求人工逐卡盖章：服务端只允许从已批准的一般知识事实生成正文与来源；标题优先使用已审核事实的首个完整短句，不适合时回退到确定性模板，且不会追加第二次模型调用。App 与桌面组件会去掉正文中与标题完全重复的前缀。发布证据使用 `derived-ai-reviewed-card-v2` 从真实 PostgreSQL 导出并复算 200–500 张脱敏卡片快照，核对事实标题、正文、来源、Qwen 审核签注、低置信度措辞和个人上下文，任一不一致即整批 `NO_GO`。人工卡片抽检仅用于发现体验问题，不再拥有发布授权。

自动发现现在明确提供两种真实运行方式：“提前备好一周（推荐）”联网准备 7–14 张卡片，使桌面组件断网后仍可连续更新；“当天只理解一张”每个中国自然日最多上传分析 1 张，若没有可靠知识则继续显示上一张。两种方式只属于自动发现，“仅选择照片”仍是独立入口。Android 14/API 34 首次体验专项 2/2、目标竞态 2/2、冷启动 App 全量 29/29，Android JVM 249/249、后端 132/132、Data/App Debug/Release Lint、Debug 与 R8 unsigned Release 及本地门禁均通过。

模式切换也已贯穿真实后台链路：保存新模式后会先取消旧的自动扫描/筛选/上传链，再按新模式重排；Worker 在每个候选前重新确认模式，旧的“提前备好一周”任务不能在用户改为“当天只理解一张”后继续上传。系统选择器和分享导入属于用户主动请求，不会被自动模式切换取消。Android 14/API 34 WorkManager 专项 1/1、设置与 TalkBack 专项 1/1、Data 设备全量 88/88、冷 AVD App 全量 29/29，Android JVM 255/255 通过。

知识卡的信任顺序已进一步收紧：正文之后先展示识别对象、推送原因和可点击来源，再邀请用户“每天在桌面看一张 / 添加到桌面”。组件转化仍位于标准 API 34 首屏内，但不再把事实与证据隔开；已安装组件时不重复提示。Android 14/API 34 组件与导入专项 8/8、Data 设备全量 88/88、冷 AVD App 全量 29/29，Android JVM 255/255、双模块双变体 Lint、Debug 与 R8 unsigned Release 均通过。

用户主动分析照片但暂时没有可靠知识命中时，不再只看到冷冰冰的失败说明：现在会明确“见微不会为了出卡而猜测”，并用杯子、雨伞、扫帚、充电线解释下一张应如何选择，包括主体占画面主要位置、光线清楚、少文字和无人脸；技术失败与权限失效仍使用独立的重试或重新选择路径。标准与 1.6× 字号均已在 API 34 实际渲染并复验，Data 设备 88/88、App 设备 29/29，Android JVM 256/256（73/109/74）通过。

普通反馈不再封死纠错入口：用户点过“有意思 / 没意思”后，仍可选择“识错了 / 太私人”。“识错了”经确认后会归档卡片、取消收藏、清理旧反馈、安排提醒删除并撤销这张卡实际产生的学习权重；Room 15 与 PostgreSQL 迁移 015 持久化每次反馈真正应用的贡献，因此主题权重已在上限饱和时也能精确回到反馈前，而不是按理论增量过度回滚。标准与 1.6× 字号 API 34 点击路径均通过；Data 设备 89/89，App 全部 29 项在干净模拟器的三个隔离组中通过，Android JVM 260/260（75/109/76）、后端 133/133、四组 Lint 与最终 Debug/R8 Release 构建均通过。当前候选 `.tooling/release-candidate/beta70-post-feedback-object-correction.json` 为 `LOCAL_CANDIDATE_GO`、`releaseEvidence=false`，SHA-256 `95b6b98f32ae99e17baef6014942d6a4c62b76489a47ff24ba7f6b7b8575bc47`。

卡片反馈也不再只显示“已记录”：选择“有意思 / 没意思”后，卡片会明确说明之后会更常留意或减少这类内容，设置页则把本机学到的“更常留意 / 减少推荐”与用户主动选择的三个兴趣分开呈现。学习摘要只使用仍保留、已排期卡片的受控物件名，不显示照片内容，也不会重新暴露已移除的物件。此前 `.tooling/release-candidate/beta69-visible-feedback-learning.json` 已被 Beta.70 当前 Android、后端和数据库字节取代。

首张卡生成前的等待状态也已产品化：用户会依次看到“准备照片 / 本机隐私筛选 / 识别并匹配知识”三阶段和当前进度；暂停、云端删除未完成和重试不会显示虚假的推进。失败文案不再暗示照片一定没有离开设备，而是明确本机副本与“如已进入云端，临时图片最长保留 24 小时”的边界。等待页不再同时显示顶栏和卡片两套转圈：当前步骤卡片保留唯一活动指示，其他页面的自动分析提示及用户操作进度不受影响。此前 `.tooling/release-candidate/beta68-no-match-recovery.json` 已被 Beta.69 当前 Android 字节取代。

首页固定导航现为等宽文字页签，当前页用短绿色底线标记，不再用三个描边胶囊与知识卡、组件入口争夺注意力；48dp 触控、TalkBack Tab 语义和动态收藏数不变。知识卡内部也已收为单一编辑阅读流：识别、推送原因、来源和反馈与正文左缘对齐，不再分别套灰色圆角卡；组件转化仍是唯一强调行动区。桌面 4×2 组件在只有一张卡时不再显示“暂无更多卡片”，而是提供“查看照片与来源 →”；来源发布方提高到 11sp，有候选卡时仍保留每日最多两次换卡。API 34 Pixel Launcher 已通过真实缩放手柄验证 2×2 → 4×2；这些能力已由后续 `beta66-mode-switch-consistency` Android 字节继承并完成 App 29/29、Android JVM 255/255、双模块双 Lint 和 R8 Release 回归。

从组件、分享导入、收藏或往日记录打开卡片时，App 现在直接把知识卡放进首屏，只用一行标记入口上下文和返回动作，不再先展示教学说明卡。API 34 布局回归确认知识标题在 49.83% 屏高处出现，App 设备测试 27/27、Android JVM 244/244 通过；本地审计为 `releaseEvidence=false`，正式发布仍需真实云、签名、OEM 实体机、真人无障碍、真实生产卡自动验证与 cohort 证据。

首次每日卡会先连续展示照片、标题、核心知识、识别把握、推送原因和来源，再给出“每天在桌面看一张”的安装入口；收藏、提醒和反馈随后出现。API 34 的 2400 px 窗口中入口仍无需滚动即可到达，并已完成真实系统 Pin。

重访首页现在使用紧凑单行品牌栏，不再重复首次体验中的价值承诺，也不在“今日一知”卡片上方再显示一层“今天”。API 34 的 2400px 窗口中，正文顶部从早先候选的 1114px 前移到 869px，组件入口从 1308px 前移到 1063px。此前 `.tooling/release-candidate/beta64-compact-home.json` 已被当前编辑型页签 Android 字节取代。

照片被删除、权限撤回或 URI 暂时不可读时，详情卡不再保留整块空白大图：加载阶段显示进度，确认不可用后缩成 68dp 提示；正常照片仍保持 190dp。API 34 实测缺图提示为 179/2400px，正文、组件入口、来源及管理动作都进入同一屏。此前 `.tooling/release-candidate/beta64-compact-missing-photo.json` 已被当前 Android 字节取代。

真实 Qwen 返回的归一化对象框会随卡片进入 PostgreSQL、OpenAPI、Room 和 Glance。桌面组件以对象中心生成有界缩略图，避免 4×2 纵向照片条把主体裁出画面；旧卡或无效框继续使用安全的居中裁图。Android 14 上已用授权的无人物扫帚图跑通 Photo Picker、Qwen、卡片、2×2/4×2 与精准回卡，私有本地审计位于 `.tooling/beta64-object-crop/audit.json`。

首次体验第 3 屏先把“自动发现”和“仅选择照片”作为两张同屏可见的单选卡展示，再进入兴趣和自动准备方式；选择“仅选择照片”不会先遇到相册授权按钮，选择状态、兴趣和“当天只理解一张”设置在 Activity 重建后都能保持。最新固定操作区证据位于 `.tooling/beta73-onboarding-sticky-action/`；App 30/30 与 Data 90/90 设备测试通过。

当前 Beta.73 已生成不可覆盖并可复验的跨工件候选清单 `.tooling/release-candidate/beta73-onboarding-sticky-action-final.json`，逐字节绑定当前 Android APK、最终 Dockerfile/后端 Release、15 个迁移、知识库、API、Room 15，以及同一镜像 ID 的 Trivy 完整报告、CycloneDX SBOM 和派生安全指标；清单 SHA-256 为 `8bc1076d427a89877fa0794d221a441baa932d2e8f6702d1563b30e77d39163c`。Debug / unsigned Release / App 测试 APK SHA-256 分别为 `c4257c719c76ee42eac4396bbd20a1818174819ec9c6803f0e575c8a0839257a` / `66509101d780f55482fd3664c8921f98766ff348015f8a799db63e30b74c746e` / `b09ba07f8bf33fa2b71eec6de17b1c2040f0dbc7e0e26cd88918c0ac6b69ac75`。旧 `beta73-onboarding-sticky-action.json` 与 `beta73-launcher-branding.json` 均已被装配器实际拒绝为 stale。候选记录当前镜像可修复 HIGH/CRITICAL 为 0，并拒绝替换报告、SBOM、镜像 ID 或安全证据。固定发布顺序为迁移 015 → digest 固定后端 → 真实云验证 → APK 签名分发；详见 `docs/DEPLOYMENT.md`。这些仍是 `releaseEvidence=false` 的发布准备，不代表 ACR 保存摘要、云资源、正式签名或实体机 Beta 已完成，整体 Beta 仍为 `NO_GO`。

默认使用本地演示模式，不需要云密钥：

1. Android 端扫描近 90 天、最多 500 张照片；有拍摄时间时按拍摄时间判断，没有拍摄时间时只有 `DATE_ADDED/DATE_MODIFIED` 仍在窗口内才纳入。完整授权使用时间戳/媒体 ID 增量游标，部分授权每天重查有上限的可见页，以发现后来新增授权的旧照片而不重复分析未变化记录。
2. 端侧过滤人脸、截图、证件、银行卡、票据、文档、高文字密度、模糊和重复图片；OCR 文本先做 NFKC 归一化与有限分隔符折叠，最终上传 JPEG 字节会再次执行相同检查。
3. 本地后端根据端侧标签匹配审核知识库并生成卡片。
4. Room 缓存未来卡片；App 的每日页只展示今天及历史卡，并以“今天 / 往日”分区。卡片根据中国自然日显示“今日识物”“昨日识物”、月日或跨年完整日期，未来离线缓存不会被误写成今天。Glance 小组件按中国自然日离线读取“当前卡 + 最多两张未展示未来卡”，每天最多换两次且不会循环回旧卡；组件或物品提醒点击会进入只显示目标卡的独立入口，可返回每日页，目标已失效时明确提示而不会打开另一张卡。每日、收藏和精准入口分别拥有滚动状态；每个新目标从顶部展示，退出后恢复原列表位置。WorkManager 为未来 7 个自然日分别建立持久刷新任务，系统组件更新作为独立兜底。
   卡片详情会直接展示每条来源的发布方和具体文章/页面标题，多来源依次编号；点击和 TalkBack 都保留完整来源身份，相同标题不会重复显示。
   扫描、端侧筛选、知识匹配、有卡、无匹配、自动重试与最终失败均以不含照片标识的聚合状态持久化；进程重建后首页不会把终态误报为仍在处理。缓存日期耗尽时组件继续显示最后一张卡并明确提示打开 App 更新。
5. 用户可为具体物件确认启用日期和提醒周期；通知权限只在确认后请求。已启用提醒会在卡片上持续显示，可更新或确认取消；本地提醒离线可用，云端新增/删除通过 Room outbox 后续同步。
6. 用户可离线收藏卡片并在独立收藏页查看；收藏跨进程重启和服务端卡片刷新保留，取消后再收藏不会重复发送偏好。点击“太私人”会在同一 Room 事务中提交隐私屏障、禁止照片再次分析，并删除卡片、收藏、提醒和普通反馈。
7. 用户可随时查看和调整五类推荐兴趣中的三项；显式选择从下一批新照片开始影响候选排序，反馈学习不会静默改写用户选择。
8. 有通义和 OSS 配置时，可切换为真实云端视觉识别与临时对象存储。
9. 收藏、反馈、提醒、扫描控制和数据删除等用户操作使用单一原子入口串行执行；操作期间冲突按钮禁用，顶部显示具体操作进度，后台照片分析状态不会冒充当前用户操作。
10. Android 分享入口与照片选择器共用同一导入用例和进程级操作门。分享确认后先复制到 App 私有空间；分析暂停时不创建后台任务，冲突或不可读时停留原页并允许重试，成功后复用唯一主界面并展示经过边界校验的结果。

2026-07-30 当前权威本地基线：Android JVM 278/278（Domain 79、Data 111、App 88）；Android 14/API 34 的 Data 设备测试 90/90、App 设备测试 30/30 均在干净独立进程通过，0 跳过、0 失败。最终 Gradle `test lintDebug lintRelease assembleDebug assembleDebugAndroidTest assembleRelease` 聚合 311 个任务，覆盖完整 App/Data Debug/Release Lint、Debug、两套测试 APK 与 R8 unsigned Release。后端 TypeScript check/build 与 133/133 项基础测试通过。数据库链现为 15 个迁移：迁移 13 回填旧卡片对象名，迁移 14 添加可空对象框，迁移 15 回填反馈实际贡献并支持饱和权重精确撤销；本地 PostgreSQL 17.10 三轮迁移、17 项集成测试和 TCP E2E 已重新取得，托管 PostgreSQL 与其余云端证据仍须按发布门禁取得。

真实百炼 Provider 已用 CC0 自行车图片复验：验证器在内存去除 JPEG APP/COM 元数据后，`qwen3.6-flash-2026-04-16` 于 5.46 秒返回 `bicycle / 自行车 / 0.98`，严格 JSON Schema 通过。Qwen 提示已固定 `{x,y,width,height}` 坐标形状并移除可能截断 JSON 的 `max_tokens`；源码守卫输出 `qwenStructuredContract=1 qwenVerifierPrivacy=1`。用户明确授权的无人物扫帚测试图已完成唯一一次带生产 `cip` 输入/输出护栏的视觉验证并返回 `providerGate=GO`；2026-07-30 又用固定良性文本复核同一北京工作空间，HTTP 200 / `guardrailAccess=GO`，未再次发送图片。旧 403 授权问题已解除，但这些本地 Provider 诊断仍不等于托管云或发布证据。

App 与桌面组件在原图缩略图不可读取时统一显示“原图暂不可显示”，不再使用可能被理解为“候选图绝不上云”的“照片在本机”类文案。Pixel Launcher 端到端测试还验证旧缓存卡标题等于对象名时只显示一次对象名，而中低置信度提示继续保留；源码护栏固定这两条产品边界。

真实照片组件路径也已进入设备门禁：测试使用仓库内无人物扫帚照片的真实本地文件 URI，绑定已审核 `broom-001` 与 Google Patents 来源，在 Pixel Launcher 上真实安装并从 2×2 拖动为 4×2。标准字号下 4×2 完整显示照片、事实、补充句、来源和入口；1.6× 字号下 2×2 完整显示四行事实并保留照片线索，4×2 继续完整显示照片、事实和来源。截图与布局审计位于 `.tooling/beta73-widget-real-photo/`，均为本地模拟器工程证据且 `releaseEvidence=false`。

App 每日卡也已使用同一真实扫帚文件 URI 与审核事实进入设备门禁，不再只靠空照片夹具证明层级。标准字号首屏同时展示照片、事实、识别把握、推送原因、Google Patents 来源、组件入口、收藏和物品提醒；1.6× 字号下全部内容可滚动到达。真实视觉复核进一步将列表底部阅读空间从 8dp 增为 96dp，使最后的四类反馈可以完整滚到视口主体，不在顶部残留来源半行。截图与布局审计位于 `.tooling/beta73-real-photo-knowledge-card/`，均为 `releaseEvidence=false`。

Beta 本地指标已修正为可用于真实 cohort 判定的语义：收藏只计“产生互动”，不再进入 LIKE 率的卡片反馈分母；只有组件或提醒携带的 card ID 成功解析到本地有效卡片后，才计一次回卡点击。首卡时延不再等 App 页面“看到卡片”，而在服务端返回非空批次成功写入 Room 后立即、幂等记录；指标写入异常不会让已提交卡片同步失败。组件添加仍以 `AppWidgetManager` 查询到真实实例为准，不把系统仅接受 Pin 请求算作成功。导出继续排除照片路径、来源 URI 和候选令牌。API 34 合成卡片设备回归覆盖反馈分离、有效精准回卡、非空落库和故障隔离；源码守卫输出 `truthfulBetaMetrics=1` 与 `FIRST_CARD_COMMIT_METRIC_GATE=GO`。审计位于 `.tooling/truthful-beta-metrics-audit/audit.json`，状态 `GO`、`releaseEvidence=false`，SHA-256 `b39caf9435f0d1bcae1675ee6ae60fc488a3539271474c91b57c52895f4e4169`；真实首卡 P50/P95、组件添加率、7 日互动率和 LIKE 率仍必须由 Beta cohort 产生。

Android 分享导入已在 API 34 标准布局与精确 320dp/2× 字体下实跑：冲突操作会阻止导入并提供原地重试；分析暂停时生成私有副本但 `jianwei-imported-analysis` 无活动 Work；Room 不持久化来源 URI；返回时复用原 `MainActivity`。源码守卫输出 `sharedImportFlow=1`。审计位于 `.tooling/shared-import-flow-audit/audit.json`，状态 `GO`、`releaseEvidence=false`，SHA-256 `2949ec0196268f59b36bd7276ce92c77bb1d53e184d72d0202aede4286c6eb8f`。

用户操作串行化已在 API 34 标准布局与精确 320dp/2× 字体下实跑：受控云端删除期间页面显示“正在删除云端数据”，进度语义为“操作进度”，导入、暂停、清索引和再次删除均不可点击；并发单元测试证明 16 个同时入口只接纳一个操作，错误操作不能释放活动门。审计位于 `.tooling/serialized-user-operations-audit/`，明确 `releaseEvidence=false`。

首页滚动状态已在 API 34 真实 Compose 运行中复核：每日列表停在历史“拉链”卡时，组件协议打开未来
“保温杯”卡会从“打开的知识卡 / 返回每日卡片”顶部开始；目标切换到“回形针”再次回顶，关闭后仍回到
原“拉链”位置。320dp/2× 字体重复验证通过。审计位于
`.tooling/independent-home-scroll-audit/`，明确 `releaseEvidence=false`。

本地工程环境已实际跑通一条不注入标签的真实图片闭环：Android 系统 Photo Picker 导入图片，bundled
ML Kit 产生 `Vehicle/Bicycle/Wheel/Tire/Metal` 标签并通过隐私筛选，客户端生成 1280×960 无可见
EXIF/GPS/设备字段的 JPEG，经同源临时上传会话交给本地后端，匹配 `bicycle-001` 后写入 Room，
最终在 App 与 Pixel Launcher 2×2 组件展示“自行车”卡片；组件点击准确回卡，临时服务端对象已清零。
实跑还发现并修复了 Compose 图片状态切换时回收新位图导致的 `Canvas: trying to use a recycled bitmap`
崩溃，现有设备级生命周期回归与源码护栏。完整证据位于 `.tooling/photo-to-card-e2e/`，其
`audit.json` 明确为 `releaseEvidence=false`：它证明本地产品链真实连通，不代表托管 PostgreSQL、OSS、
Qwen、HTTPS、正式签名、真人内容审核或实体机 Beta 已完成。

Beta.63 又以用户明确授权的项目无人物扫帚图跑通 Android → 真实 Qwen 闭环：端侧标签实际只有
`Room/Chair/Pattern`，Qwen 在生产 `cip` 护栏下识别为 `broom / 扫帚 / 0.95`，再从 AI 审核目录选择
`broom-draft-004` 与 Google Patents 来源；App、2×2/4×2 组件、跨日“昨日一知”和精准回卡均通过。
实跑修复了 `Room` 通过 substring 误命中 `broom` 的本地假阳性，以及 4×2 缓存提示替换来源的问题。
私有证据位于 `.tooling/beta63-photo-to-card/`，仍明确为本地工程证据，不替代真实 OSS/PostgreSQL/HTTPS、
正式签名、OEM 实体机或 Beta cohort。

当前 Debug、未签名 Release SHA-256 分别为
`79249138638bc4eaac90f343d7cf0fd511325f0e1258c2a5b1a15dfdd0fc14ed`、
`6039743e95a4e23c4a65c960202636e2296980a573b209258d1d8f3f7da9cd6a`；未签名包和本地模拟器证据均不能作为 Beta 正式发布证据。

## 后端启动

需要 Node.js 20+：

```powershell
cd backend
Copy-Item .env.example .env
pnpm install
pnpm test
pnpm migrate
pnpm dev
```

默认监听 `http://127.0.0.1:8787`。`VISION_PROVIDER=local` 与 `DATABASE_URL` 为空时，服务使用内存数据库和本地临时文件，适合开发与自动化测试。配置 `DATABASE_URL` 后，服务启动前也会自动执行带校验和与数据库锁的迁移；部署流水线仍应显式运行 `pnpm migrate`。

本地演示可在 `.env` 中使用 `ALLOW_UNATTESTED_FACTS=true`。OSS 模式会拒绝该开关；真实发布只允许带有效 Qwen 审核签注，或经过受控人工纠错签注的事实进入卡片。

Kimi 已作为独立视觉 Provider 接入。生产环境使用 `VISION_PROVIDER=kimi` 时，只接受
`https://api.moonshot.cn/v1`、`kimi-k3` 和 Kimi Open Platform 服务端密钥；Kimi Code 会员密钥及
`https://api.kimi.com/coding/v1` 仅允许本地工程验证，不能作为面向 Beta 用户的生产凭据。两种
路径都继续执行同一套端侧过滤、服务端敏感分类、Zod Schema、人工事实绑定、成本熔断和立即删除。Qwen/Kimi
都只执行一次视觉识别；标题由服务端稳定生成，正文和来源直接取自审核目录，不再为标题发起第二次模型调用。

## Android 构建

Windows 可用仓库内脚本准备隔离工具链并构建：

```powershell
.\scripts\bootstrap-android-windows.ps1
.\scripts\build-android-windows.ps1
```

已有 JDK 17、Android SDK 36 和 Build Tools 35.0.0 时也可直接运行：

```powershell
cd android
.\gradlew.bat :domain:test :app:testDebugUnitTest :data:testDebugUnitTest :data:assembleDebugAndroidTest lintDebug assembleDebug
```

上述命令会编译 Keystore、JPEG/EXIF 与本地隐私墓碑三项设备测试。连接 Android 设备后运行：

```powershell
.\gradlew.bat :data:connectedDebugAndroidTest :app:connectedDebugAndroidTest
```

Windows 隔离工具链已经准备好 Android 14 AVD 时，可从项目根目录运行可重复证据门禁：

```powershell
.\scripts\run-android-device-tests-windows.cmd
```

脚本会检查 VM 加速、启动无窗口 AVD、执行设备测试，并拒绝 `0 tests`、失败、错误或跳过结果。首次配置 VM 加速应按 Android 官方说明启用 WHPX，或安装仍受支持的 AEHD 驱动。

以下长段保留已完成能力的细节；其中测试计数与 APK 摘要以本节上方“当前权威本地基线”为准。
当前隔离工具链已通过 30 个 JVM 套件 112/112，并在官方 Android 14/API 34 AVD 上执行 44 项设备测试全部通过。小组件当前用单一 DataStore 事务状态机维护日期、当前卡片与每日换卡次数；32 次并发点击和 32 次并发刷新只能提交两次换卡，旧偏好迁移、进程重建、同日卡片移除、跨日重置和迟到旧日回调均有 JVM 与真实文件回归，状态日期不能倒退。组件自动刷新不再以首次启动时刻为 24 小时锚点，而在 00:05 后按 `Asia/Shanghai` 为未来 7 个自然日分别建立唯一 OneTimeWork；重复调度保留同一未完成 Work ID，任一任务执行都会补齐下一窗口，且不依赖网络。服务端未来卡不再按历史卡数量排期，而在任务完成事务内选择今天起第一个空日期；PostgreSQL 每设备锁的 32 路并发回归证明日期连续唯一，中间卡删除后会先补缺口，数据库日期下发严格为 ISO 格式。云端删除采用持久化 `DELETE_PENDING/DELETE_CONFIRMED` 恢复状态，先等待取消全部本地提醒，再按远端确认、Room 原子清理卡片及 outbox、最后重置身份；服务端注册响应以原子 `created` 证明区分令牌轮换和删除后新建的空替代设备，覆盖“服务端已删除但响应丢失”的恢复路径。真实 MediaStore 回归会发布 503 条测试媒体，证明首轮 501 条只索引 500、无变化不重复入队、新增/内容修改进入增量队列，以及部分授权不会因旧游标漏掉后来可见的照片；另以 Android 14 MediaProvider 的四种时间组合证明缺失 `DATE_TAKEN` 的图片必须由 `DATE_ADDED/DATE_MODIFIED` 仍处于请求窗口才能入库，旧图不会因缺失拍摄时间逃逸 90 天边界。OCR 策略回归覆盖全角/分组身份证与银行卡格式及日期+手机号负例，bundled ML Kit 设备测试还证明最终 JPEG 字节中的分组银行卡号会被拦截。权限撤销测试证明自动发现链会停止而 Picker/分享导入链不被取消。自动相册与 Picker/分享上传使用强制来源范围，缺失或非法范围会失败关闭；当前单进程内的上传 Work 还通过进程级互斥避免重复读取同一 READY 候选，取消或进程重启后候选仍可恢复。原始 OkHttp 图片 PUT 会保留非成功 HTTP 状态：401 最多刷新身份并重放一次，409/429/5xx 保持候选 READY、保留 Picker/分享私有副本并进入有界重试，400/410/413/415 才进入 FILTERED 并清理导入副本。“太私人”反馈采用同步硬屏障：先持久提交隐私反馈，卡片分页期间保留 outbox 墓碑并拒绝同卡 ID 或 `NEVER_ANALYZE` 候选，完整同步成功后才确认移除 outbox，避免服务端陈旧页面把本地已删除卡片复活。知识来源只接受公共 HTTPS，拒绝深链、凭据、本机/内网名称和直接 IP；全部卡片分页验证完成后才单次写 Room，旧恶意缓存和最终点击也会失败关闭。详情页和组件共用 bounds-first、EXIF-aware 解码器，不再直接解码原图或固定四倍采样；详情长边上限 1280 px，组件上限 320 px，设备回归验证组件位图分配不超过 400 KiB。推荐用一条参考套件完成 Release/R8、设备测试、真实 APK 引导、系统权限弹窗、拒绝/完整/部分权限标签、撤权与部分权限重新对账、分享二次确认、物品提醒明确同意、可见状态、更新/取消与离线 outbox、本地内测报告导出、组件与无障碍烟测。参考套件会先重建当前 Debug APK，避免复用旧产物：

```powershell
.\scripts\run-android-reference-suite-windows.cmd

# 也可以逐项诊断
.\scripts\run-android-device-tests-windows.cmd -KeepEmulator
.\scripts\run-android-app-smoke-windows.cmd
.\scripts\run-android-accessibility-smoke-windows.cmd -FontScale 2.0
.\scripts\run-android-talkback-smoke-windows.cmd
.\scripts\run-android-widget-smoke-windows.cmd
.\scripts\run-android-release-smoke-windows.cmd
```

这些门禁分别覆盖 320dp/2.0 倍字体、真实 Google TalkBack 服务绑定与键盘焦点遍历、Pixel Launcher 原生 Pin Widget 与缓存卡渲染，以及当前不可调试 R8 产物的测试签名运行。Debug 门禁会直接核验提醒的 WorkManager 唯一任务、Room 持久状态机、可见状态、更新与确认取消；服务端删除接口为设备隔离且幂等。锁屏公开通知使用不含物件名的通用文案。Release 门禁保持不可调试，只验证 UI、组件、R8 和签名运行。TalkBack 自动化不验证实际语音是否清晰，R8 测试签名也不等于正式签名；两者仍不能替代真人听读和国产 Launcher 真机矩阵。

模拟器结果不能替代华为、小米、OPPO/vivo 实体机的后台、小组件和权限回归。

模拟器通过 `http://10.0.2.2:8787/` 访问本机后端。真机调试时，在 `android/local.properties` 中设置：

```properties
jianwei.apiUrl=http://你的局域网IP:8787/
```

正式签名构建必须另行提供 Release 专用配置，不能复用 Debug 的明文地址：

```properties
jianwei.releaseApiUrl=https://你的正式API域名/
```

未设置时，普通 `assembleRelease` 只会写入 `https://not-configured.invalid/` 以供 R8 工程验证；`build-android-windows.ps1 -Release` 会拒绝正式签名构建。

## 云端配置

见 `backend/.env.example`。生产环境必须：

- 使用 PostgreSQL；
- 使用 OSS 私有 Bucket 和 24 小时生命周期；
- 固定模型快照，不使用浮动 `latest`；
- 为 `DASHSCOPE_BASE_URL` 显式配置北京区 Model Studio 工作空间的 HTTPS `compatible-mode/v1` 地址；运行时只接受阿里云北京官方域名，不接受海外区、HTTP、userinfo、query 或任意路径；
- 配置 HTTPS、密钥托管、速率限制和日志脱敏；
- 配置每设备与全局日/月候选预算；全局预算事件不含设备或照片标识，并在删除设备数据后继续守住总成本；
- 开启通义输入内容安全检查。

## 验证

```powershell
cd backend
pnpm check
pnpm test
pnpm build
pnpm e2e:self-test
pnpm e2e

cd ..
.\scripts\run-postgres-integration-windows.cmd
node scripts\build-topic-backlog.mjs
node scripts\validate-topic-draft.mjs --self-test
node scripts\ingest-topic-draft.mjs --self-test
node scripts\ingest-topic-batch.mjs --self-test
node scripts\apply-catalog-draft-correction.mjs --self-test
node scripts\build-knowledge-review-queue.mjs --self-test
node scripts\create-knowledge-review-batch.mjs --self-test
node scripts\knowledge-review-workbench.mjs --self-test
node scripts\apply-knowledge-review-batch.mjs --self-test
node scripts\check-knowledge-readiness.mjs --self-test
node scripts\check-knowledge-readiness.mjs
node scripts\check-knowledge-sources.mjs --self-test
node scripts\check-knowledge-sources.mjs
node scripts\check-knowledge-sources.mjs --live
node scripts\check-knowledge-sources.mjs --all-live
node scripts\preflight-knowledge-sources.mjs --self-test
node scripts\preflight-knowledge-sources.mjs https://example.org/source-a https://example.org/source-b
node scripts\check-api-contract.mjs --self-test
node scripts\check-api-contract.mjs
node scripts\check-supply-chain.mjs --self-test
node scripts\check-supply-chain.mjs
node scripts\check-deployment-manifest.mjs --self-test
node scripts\check-deployment-manifest.mjs
node scripts\check-container-deployment-inputs.mjs --self-test
node scripts\check-cloud-deployment-preflight.mjs --self-test
# 设置真实部署环境后运行；只输出缺失项名称，不输出密钥值
node scripts\check-cloud-deployment-preflight.mjs
node scripts\hash-knowledge-catalog.mjs
node scripts\check-source-guardrails.mjs
node scripts\check-beta-readiness.mjs --self-test
node scripts\create-image-evaluation-run.mjs --self-test
node scripts\compile-image-evaluation.mjs --self-test
node scripts\create-physical-device-run-manifest.mjs --self-test
node scripts\compile-physical-device-runs.mjs --self-test
node scripts\create-accessibility-audit-manifest.mjs --self-test
node scripts\compile-accessibility-audit.mjs --self-test
node scripts\create-beta-evidence-assembly-manifest.mjs --self-test
node scripts\assemble-beta-evidence.mjs --self-test

cd backend
pnpm release:identity -- --self-test
pnpm release:identity
cd ..

cd android
.\gradlew.bat :domain:test :app:testDebugUnitTest :data:testDebugUnitTest :data:assembleDebugAndroidTest lintDebug assembleDebug
```

一般知识发布默认使用固定版本 Qwen 批量自动审核，不再要求运营人员打开逐条审核后台。先做 20 条不写入烟测；
全量写入必须显式给出新目录版本：

```powershell
cd backend
pnpm review:knowledge-ai -- `
  --credentials-file <absolute-path-to-bailian-csv> `
  --limit 20
pnpm review:knowledge-ai -- `
  --credentials-file <absolute-path-to-bailian-csv> `
  --all `
  --write `
  --next-version <new-catalog-version>
cd ..
node scripts\build-topic-backlog.mjs --write
node scripts\check-knowledge-readiness.mjs
```

AI 只批准 `general` 一般知识；健康和安全事实首版不发布。审核同时覆盖涉政、违法、色情、暴力、仇恨、侵权和隐私，
并始终携带百炼生产内容安全 Header。来源可访问和来源标题匹配不等于网页正文已经被语义核对，因此卡片仍显示原始来源。
Beta 继续收集真实生产卡的自动复算证据；人工抽检仅作为可选质量运营。原真人工作台仅保留为可选纠错工具，不再是一般知识发布前置步骤。完整边界见
[AI knowledge review workflow](docs/KNOWLEDGE_REVIEW.md)。

PostgreSQL 门禁使用项目 `.tooling` 下的 PostgreSQL 17 隔离实例，在随机本地端口三跑 15 个迁移并执行至少 17 项真实仓储/升级测试，包括迁移 13 的对象名回填、迁移 14 的对象框约束、迁移 15 的反馈贡献回填与饱和权重精确撤销，以及四个独立连接池下的全局预算原子性、单次上传、处理租约恢复、主题偏好持久化、卡片后端 Release 摘要落库、“太私人”原子删除回执、并发注册唯一 `created=true` 证明和授权评测租约；结束后立即停止实例。Windows 运行 `scripts/run-postgres-integration-windows.ps1`，macOS 运行 `scripts/run-postgres-integration-macos.sh`。普通设备的日/月额度不为评测放宽，租约样本也不会计入该设备后续普通请求的日/月用量；真实图片评测必须按 `docs/BETA_EVIDENCE_RUNBOOK.md` 由后端签发短期、清单绑定的租约，且仍受全局数量与模型成本熔断约束。`preflight-knowledge-sources.mjs` 在草稿入库前用与全目录检查相同的超时、Header、Range 和响应类型边界验证候选 URL；`--live` 只验证已批准候选事实引用的来源，`--all-live` 还覆盖不可发布草稿的编辑来源。联网检查每次保留 `*-latest-attempt.json`；多主机统一 DNS/网络失败会被标为基础设施故障并退出 `NO_GO`，但不会覆盖正式来源证据。URL 可达性与预检不证明来源正文支持事实，最终以 AI 内容门禁、公开来源透明度和 Beta 抽检共同控制风险。

`pnpm e2e` 启动刚编译的 `dist/index.js`，在随机回环端口通过真实 TCP 依次验证健康检查、匿名注册、上传前敏感拒绝、一次性图片上传、识别完成、卡片同步、反馈、主动追踪、未知物件 `needs_content`、设备数据删除和旧令牌失效。内存模式结构化结果写入 `.tooling/backend-e2e/result.json`；Windows PostgreSQL 门禁还会设置 `BACKEND_E2E_DATABASE_URL`，让相同闭环再经过 PostgreSQL 17.10，结果写入 `.tooling/backend-e2e-postgres/result.json`。服务日志不含令牌、安装 ID 或数据库地址；这两种门禁仍使用本地视觉和对象存储，不冒充真实 OSS/Qwen/托管 PostgreSQL 云证据。

详细状态见 [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md)。

## Kimi 对抗审查

Kimi `SAFE_PACKET` 对抗审查已经执行到第 20 轮硬上限；不得再启动第 21 轮，也不能把后续本地审查记成新的 Kimi 轮次。可离线验证安全模式、凭据隔离、人工外发检查点和轮次上限：

```powershell
node scripts/kimi-adversarial-review.mjs --self-test
```

历史报告保存在 `reports/kimi-adversarial-review-round-20.md`，最新结论仍是 `NO-GO`。模型审查报告只用于发现问题；无论是否生成报告，都不能作为 Beta 放行依据。

Beta 放行必须使用真实证据门禁，不能以构建成功或一份模型文本代替。最终文件不能手工拼接，必须先将八个真实组件工件固定到真人审批清单，由独立 QA 装配人签名，再由装配器生成并交给独立发布审批人签名。三方公开策略必须提交在 `config/evidence-trust-policy.json`，其精确 SHA-256 由仓库外受保护环境固定：

```powershell
node scripts\check-beta-readiness.mjs --self-test
node scripts\sign-beta-evidence.mjs --self-test
node scripts\sign-beta-evidence-assembly.mjs --self-test
node scripts\create-image-evaluation-run.mjs --self-test
node scripts\compile-image-evaluation.mjs --self-test
node scripts\create-physical-device-run-manifest.mjs --self-test
node scripts\compile-physical-device-runs.mjs --self-test
node scripts\create-accessibility-audit-manifest.mjs --self-test
node scripts\compile-accessibility-audit.mjs --self-test
node scripts\create-beta-evidence-assembly-manifest.mjs --write
$env:JIANWEI_EVIDENCE_TRUST_POLICY_SHA256 = "<protected-policy-sha256>"
node scripts\sign-beta-evidence-assembly.mjs --issuer-id <qa-assembly-id> --key-id <assembly-key-id> --private-key C:\controlled-evidence\beta-assembly.private.pem --confirm-reviewed
node scripts\sign-beta-evidence-assembly.mjs --issuer-id <qa-assembly-id> --key-id <assembly-key-id> --private-key C:\controlled-evidence\beta-assembly.private.pem --confirm-reviewed --write
node scripts\assemble-beta-evidence.mjs
node scripts\assemble-beta-evidence.mjs --write
node scripts\sign-beta-evidence.mjs --issuer-id <release-approver-id> --key-id <release-key-id> --private-key C:\controlled-evidence\beta-release.private.pem --confirm-reviewed
node scripts\sign-beta-evidence.mjs --issuer-id <release-approver-id> --key-id <release-key-id> --private-key C:\controlled-evidence\beta-release.private.pem --confirm-reviewed --write
node scripts\check-beta-readiness.mjs evaluation\beta-evidence.json
node scripts\summarize-beta-device-metrics.mjs --self-test
node scripts\check-knowledge-readiness.mjs
```

正式 APK 先复制 `android/keystore.properties.example`，配置独立保管的私钥，再运行
`.\scripts\build-android-windows.ps1 -Release`。未配置私钥时，`assembleRelease` 只产生不可分发的未签名产物。
Beta 证据不仅绑定 `versionName`：生产卡自动验证、真实云验证、20–50 人 cohort、三家 OEM
真机和真人 TalkBack 必须全部携带正式 Release APK 的同一 SHA-256。授权图片评测因仅
Debug 含受控 runner，单独绑定其清单、已安装 base APK 和最终结果的同一 SHA-256；
Release DEX/Manifest 必须不含评测 Activity、租约 Header 或评测清单标记。
后端容器构建同时生成不可由环境变量覆盖的 `release-identity.json`，摘要覆盖可部署源码、
精确 Dockerfile、SQL 迁移、依赖锁和知识目录；生产启动、`/health/ready`、卡片落库、真实云验证与生产卡
自动验证会交叉绑定该摘要。真实云工件还必须验证 `beta_deployment_attestor` 签名回执，把 Function
Compute revision 与实际 ACR OCI 摘要绑定；`beta_assembly_attestor` 签名批准清单和八个精确工件，
`beta_release_approver` 签名最终证据字节。装配清单还固定精确 `knowledge/catalog.json`、
`knowledge/topic-backlog.json` 字节摘要，以及可选人工纠错审核人白名单的排序策略摘要；未配置人工审核人时，
该摘要绑定空集合，已批准的一般知识由目录内的 Qwen 审核签注复核。三个角色必须使用不同 issuer ID、key ID 和 Ed25519 SPKI
公钥指纹，私钥保留在仓库外；策略字节还必须匹配受保护的
`JIANWEI_EVIDENCE_TRUST_POLICY_SHA256`。服务环境变量自报、仓库内替换策略、缺少装配签名或复用任一
角色密钥都不能放行。完整取证顺序和原始材料要求以 [Beta evidence runbook](docs/BETA_EVIDENCE_RUNBOOK.md) 为准。
跨 Android、Qwen、OSS、Function Compute 和数据库租约的超时预算也有独立门禁：

```powershell
node scripts/check-runtime-budgets.mjs --self-test
node scripts/check-runtime-budgets.mjs
```
