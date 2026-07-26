# 见微 / Jianwei

见微把 Android 相册里的日常照片变成有来源的每日知识卡，并通过桌面小组件持续展示。仓库包含：

- `android/`：Kotlin + Compose + Glance + Room + WorkManager 客户端。
- `backend/`：Fastify API、PostgreSQL 持久化、临时对象存储与通义视觉适配器。
- `knowledge/`：经过结构校验的日常物件知识种子。
- `docs/`：架构、隐私和验收说明。

## 当前可运行闭环

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

2026-07-25 当前权威本地基线：Android 43 个 JVM 套件 178/178，Android 14/API 34 设备测试
69/69（App 11、Data 58）；App/Data Debug/Release Lint 均为 0 error，分别有 42/22 条非阻断 warning，Debug 与 R8 Release 均重建成功。
后端 TypeScript check/build 与 113/113 项基础测试通过；隔离 PostgreSQL 17.10 已再次执行全部 13 个迁移，
13/13 项真实仓储/升级测试及编译服务 TCP E2E 通过。迁移 13 已验证旧卡片对象名回填、非空长度约束和
`detectedObjectName` 持久化；证据位于 `.tooling/postgres-integration-results-macos/`。

真实百炼 Provider 已用 CC0 自行车图片复验：验证器在内存去除 JPEG APP/COM 元数据后，`qwen3.6-flash-2026-04-16` 于 5.46 秒返回 `bicycle / 自行车 / 0.98`，严格 JSON Schema 通过。Qwen 提示已固定 `{x,y,width,height}` 坐标形状并移除可能截断 JSON 的 `max_tokens`；源码守卫输出 `qwenStructuredContract=1 qwenVerifierPrivacy=1`。`pnpm verify:qwen-guardrail-access -- --credentials-file <csv>` 已于 2026-07-26 使用无敏感文本真实检查生产 `cip` Header 并返回 HTTP 200 / `guardrailAccess=GO`，全程未读取或上传图片。带护栏的完整图片 Provider 复验仍须对明确授权的非个人测试图另行执行；这些本地诊断不是托管云或发布证据。

App 与桌面组件在原图缩略图不可读取时统一显示“原图暂不可显示”，不再使用可能被理解为“候选图绝不上云”的“照片在本机”类文案。Pixel Launcher 端到端测试还验证旧缓存卡标题等于对象名时只显示一次对象名，而中低置信度提示继续保留；源码护栏固定这两条产品边界。

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

当前 Debug、未签名 Release SHA-256 分别为
`7cf23e0700f88ff997cf2bec4aeaffebdffcf8f9900abdc57b773cd0b15fd3c6`、
`1f83474c1148b48e6ef1c3d5d7a7c9b42cbdf24b0127ea306d0b8109c2e998c3`；未签名包和本地模拟器证据均不能作为 Beta 正式发布证据。

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

本地演示可在 `.env` 中使用 `ALLOW_UNATTESTED_FACTS=true`。OSS 模式会拒绝该开关；真实发布只允许带真人审核签注的事实进入卡片。

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

真人审核必须由受保护白名单中的责任人启动。工作台会固定当前目录与审核队列快照，只监听
`127.0.0.1`，并提供一次性浏览器入口；自动保存使用不可变修订，遇到并发版本冲突时保留本页输入，
不会自动刷新或应用到知识目录。每条事实会即时显示待处理原因；可按全部、待处理、已就绪筛选并跳到下一条待处理。
健康/安全等高风险批准要求至少两个权威来源且必须全部人工勾选；只有全批次就绪后才能完成。冲突或保存失败时可
导出不含 CSRF 的本地恢复草稿，但该文件不能直接应用目录或构成真人签注。完成批次前会等待最后一次保存，
完成后仍须在终端执行页面给出的人工应用命令：

```powershell
node scripts\knowledge-review-workbench.mjs `
  --confirm-human-review-session `
  --reviewer <protected-human-reviewer-id> `
  --next-version <new-catalog-version> `
  --output .tooling\knowledge-review-batches\<batch-name>.json `
  --limit 20 `
  --port 8791
```

浏览器入口只能使用一次；意外关闭后按终端输出的 `--resume <session-id>` 命令恢复。来源可访问只代表能够打开，
不代表支持事实；每条批准决定仍必须人工核对全部来源、完整语义、数字、因果和适用范围。

PostgreSQL 门禁使用项目 `.tooling` 下的 PostgreSQL 17 隔离实例，在随机本地端口三跑 13 个迁移并执行至少 13 项真实仓储/升级测试，包括迁移 13 对既有卡片识别对象名的回填与约束、四个独立连接池下的全局预算原子性、单次上传、处理租约恢复、主题偏好持久化、卡片后端 Release 摘要落库、“太私人”原子删除回执、并发注册唯一 `created=true` 证明，以及 300–500 样本授权评测租约的单设备绑定、并发幂等消费与撤销；结束后立即停止实例。Windows 运行 `scripts/run-postgres-integration-windows.ps1`，macOS 运行 `scripts/run-postgres-integration-macos.sh`。普通设备的日/月额度不为评测放宽，租约样本也不会计入该设备后续普通请求的日/月用量；真实图片评测必须按 `docs/BETA_EVIDENCE_RUNBOOK.md` 由后端签发短期、清单绑定的租约，且仍受全局数量与模型成本熔断约束。`preflight-knowledge-sources.mjs` 在草稿入库前用与全目录检查相同的超时、Header、Range 和响应类型边界验证候选 URL；`--live` 只验证已批准候选事实引用的来源，`--all-live` 还覆盖不可发布草稿的编辑来源。联网检查每次保留 `*-latest-attempt.json`；多主机统一 DNS/网络失败会被标为基础设施故障并退出 `NO_GO`，但不会覆盖正式来源证据，审核队列也不会采信该次结果。URL 可达性与预检都不能替代真人语义审核。

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
$env:JIANWEI_KNOWLEDGE_REVIEWER_IDS = "<protected-comma-separated-human-reviewer-ids>"
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
Beta 证据不仅绑定 `versionName`：卡片抽检、真实云验证、20–50 人 cohort、三家 OEM
真机和真人 TalkBack 必须全部携带正式 Release APK 的同一 SHA-256。授权图片评测因仅
Debug 含受控 runner，单独绑定其清单、已安装 base APK 和最终结果的同一 SHA-256；
Release DEX/Manifest 必须不含评测 Activity、租约 Header 或评测清单标记。
后端容器构建同时生成不可由环境变量覆盖的 `release-identity.json`，摘要覆盖可部署源码、
精确 Dockerfile、SQL 迁移、依赖锁和知识目录；生产启动、`/health/ready`、卡片落库、真实云验证与卡片
抽检会交叉绑定该摘要。真实云工件还必须验证 `beta_deployment_attestor` 签名回执，把 Function
Compute revision 与实际 ACR OCI 摘要绑定；`beta_assembly_attestor` 签名批准清单和八个精确工件，
`beta_release_approver` 签名最终证据字节。装配清单还固定精确 `knowledge/catalog.json`、
`knowledge/topic-backlog.json` 字节摘要，以及受保护 `JIANWEI_KNOWLEDGE_REVIEWER_IDS` 排序策略摘要；
最终门禁会以同一外部审核人白名单复核每条审核记录。三个角色必须使用不同 issuer ID、key ID 和 Ed25519 SPKI
公钥指纹，私钥保留在仓库外；策略字节还必须匹配受保护的
`JIANWEI_EVIDENCE_TRUST_POLICY_SHA256`。服务环境变量自报、仓库内替换策略、缺少装配签名或复用任一
角色密钥都不能放行。完整取证顺序和原始材料要求以 [Beta evidence runbook](docs/BETA_EVIDENCE_RUNBOOK.md) 为准。
跨 Android、Qwen、OSS、Function Compute 和数据库租约的超时预算也有独立门禁：

```powershell
node scripts/check-runtime-budgets.mjs --self-test
node scripts/check-runtime-budgets.mjs
```
