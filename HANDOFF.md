# 见微生产 Beta 交接

## 当前目标与范围

把中国大陆 Android 照片冷知识组件推进到可由真实证据放行的受控 Beta。当前发布结论是 `NO_GO`；
不得用模拟器、合成证据、测试签名、Kimi 审查轮次或本地自测代替真人内容审核、真实云、实体机和真实 cohort。

## 已完成并验证

- 后端 TypeScript check/build 与 98/98 项基础测试通过；API 契约、供应链、运行预算和源码护栏均为 GO。
- 2026-07-23 在隔离 PostgreSQL 17.10 (Homebrew) 上三次运行全部 13 个迁移，13/13 仓储/升级测试和编译服务 TCP E2E 通过。新增测试会在模拟旧表中执行 `013_card_detected_object_name.sql`，证明旧卡片按 title 回填对象名、空白对象名受约束拒绝，并验证仓储读写保留“扫帚”。macOS 门禁位于 `scripts/run-postgres-integration-macos.sh`，运行后数据库进程已关闭；结果在 `.tooling/postgres-integration-results-macos/`。这仍是本地 PostgreSQL，不是托管云证据。
- Android：31 个 JVM 套件 118/118、API 34 instrumentation 46/46；当前 Debug、R8 Release、真实 Pixel Launcher 组件添加/缩放/两次换卡/精准回卡及 crash buffer 均通过。App/Data Lint 均为 0 error，分别 32/20 warning。
- 真实本地照片闭环已用 Android 系统 Photo Picker 实跑：bundled ML Kit 对真实自行车图给出 `Vehicle/Bicycle/Wheel/Tire/Metal`，敏感标记为空；客户端压缩并清除可见元数据，经同源上传会话进入本地后端，匹配 `bicycle-001`，写 Room 后在 App 与 2×2 Glance 组件展示，组件点击准确回卡，临时对象目录最终为空。没有注入标签或直接写卡。证据在 `.tooling/photo-to-card-e2e/`，且明确 `releaseEvidence=false`。
- 上述实跑暴露 `Canvas: trying to use a recycled bitmap`：旧 `DisposableEffect` 闭包会在状态切换时回收刚发布的新位图。当前改为不可变 `displayBitmap` 生命周期捕获，并新增 `PhotoThumbnailLifecycleInstrumentedTest` 与源码守卫；修复后 App、组件和精准回卡均无崩溃。
- 显式识别对象已贯穿视觉结果、后端卡片、OpenAPI、PostgreSQL 迁移 13、Room 9、Compose 与 Glance；领域阈值固定为 0.72。低置信度标题已经包含对象时，App/组件副标签只显示“识别把握较低”，不再重复“可能是牙刷”；若标题未携带对象则副标签失败关闭地补回对象。精确百分比保留在 App 无障碍语义中。API 34 已验证 App、2×2 组件和组件精准回卡；`.tooling/recognition-presentation-audit/audit.json` 明确标记 `releaseEvidence=false`。
- 首卡链路不再使用易丢失的字符串提示：domain 定义 QUEUED/SCANNING/FILTERING/SYNCING/READY/NO_MATCH/RETRYING/FAILED，data 只持久化聚合计数与用户安全文案，Worker 在成功、无匹配、有界重试耗尽和权限撤销时收束终态，Compose 映射为可执行的选择/恢复/重试动作。API 34 证明 Repository 重建后状态一致且 SharedPreferences 不含照片 ID、标签或文件名；组件在排期缓存过期后继续显示最后一张卡并标记“新卡缓存已用完”。源码门禁输出 `truthfulAnalysisState=1 widgetCacheExhaustion=1`。
- OCR 敏感信息规则已从“去普通空格后匹配”升级为 NFKC 归一化、全空白移除和有限身份证/银行卡分隔符折叠；覆盖全角/分组身份证号、带品牌或裁掉品牌的分组银行卡号、身份证版式标记，并以日期+手机号负例控制误杀。API 34 使用 bundled ML Kit 对生成的最终 JPEG 字节真实 OCR，确认分组卡号被标记为 `bank_card`；源码门禁输出 `ocrSensitiveNormalization=1`。
- MediaStore 的近 90 天边界已失败关闭：存在 `DATE_TAKEN` 时严格按拍摄时间判断；缺失或为 0 时，只有 `DATE_ADDED/DATE_MODIFIED` 至少一项仍在窗口内才纳入。API 34 真实 MediaProvider 四组合回归同时证明旧无拍摄时间图片被排除、近期无拍摄时间图片被纳入、旧拍摄时间不会被近期导入时间覆盖、近期拍摄时间不会因旧元数据被漏掉；源码门禁输出 `mediaStoreRecencyBoundary=1`。
- “仅选择照片”不再以必须选中至少一张为完成条件：用户选定该模式时即持久化引导与兴趣，系统 Photo Picker 回调只负责导入。API 34、320dp/2× 字体实跑确认取消 Picker 后返回“照片权限：仅手动选择 / 先选择一张照片”首页，`completed=true`，五类照片分析 WorkManager 任务计数为 0，crash buffer 为空；Windows accessibility smoke 已固定该路径。
- 2026-07-23 API 34 原生界面审计已将知识卡恢复为首屏主内容：四项反馈与提醒入口无需先穿过组件推广；组件 CTA 只在每日页第一张卡之后出现，收藏页不重复；照片与云端管理默认收敛为“你的数据与隐私”，展开后原六项能力完整可达。空每日、空收藏、每日卡、收藏卡和展开隐私均以真实模拟器截图及 accessibility hierarchy 验证。追加的 320dp/2× 字体审计发现横排 CTA 会把标题挤成逐字换行，现按宽度/字体倍率切换纵排；标准宽度保持紧凑横排。CTA 完整命名为“添加桌面组件”并实测进入 Pixel Launcher Pin Widget；每日/收藏页签会向 accessibility tree 暴露随页面切换的 `selected=true`。
- 320dp/2× 下每日页签改用单行“每日”，无障碍名称仍为完整“每日卡片”且保持 `selected=true`；411dp/1× 继续显示“每日卡片”。两种布局均以截图和 hierarchy 复验。
- 2026-07-23 真实 Pixel Launcher 组件闭环：App 普通每日页全量滚动不显示未来缓存；从组件点击时允许且只允许聚焦组件当前卡。4×2 组件从今日卡开始，只把当前卡和最多两张未来卡放入换卡池，历史卡不再混入且到末尾不循环。DataStore 状态流解决同一 Glance 会话边界漏重绘；实测两次点击均在 3 秒内更新，最终显示“今天已换 2 次”且按钮消失，点击卡片准确打开第二张未来卡。源码门禁输出 `futureCardCacheHidden=1 widgetSwitchAffordance=1 widgetLiveRefresh=1 widgetCardDeepLink=1`。
- 当前 Debug APK SHA-256：`C3E79661172D1BFEA10D6D1069B11C44DB149C0D3AFE676CC42E8254FA180F34`；未签名 Release 为 `4486251A2103038463F5010601A822BF4B4125102DEF9699A4717688439178E4`；App/Data instrumentation APK 为 `65BD9531B986CD614A56A8F7DAE005E632C0428FC05C474ED6760B91EEA339E4` / `8BF62D28265677395A3BAC469E01BCAEC3D7876A041306696699A1B97981EA27`。`formalSigning=0`，均不可作为 Beta 正式包。
- 本地收藏完成本轮 Loop Engineer：Room 7→8 引入带卡片级联外键的 `saved_cards`；首次收藏只发一个 SAVE 偏好，取消/重启/服务端 upsert/再次收藏保持幂等。第一次 critic 为 `REVISE`，指出 TOO_PRIVATE 会留下 SAVE outbox；修复后第二次最终 critic 仍为 `REVISE`，指出隐私屏障和删除分属事务。当前已合并为首个执行的单一 Room 事务，并新增“事务提交后立即崩溃、重启”API 34 回归；达到两次 critic 上限后未虚构第三次 PASS。
- TOO_PRIVATE 的本地提交点会一次写入隐私 outbox、将照片标记为 `NEVER_ANALYZE` 并抑制后续扫描，再删除提醒、普通反馈、卡片和级联收藏。真实 Debug UI 验证从 `收藏 1 / SAVE=1` 到 `cards=0 / saved=0 / feedback=TOO_PRIVATE / suppressed=1`，进程重启前后均成立。
- 卡片详情来源链已完成 evaluator–optimizer，第一次 critic 为 REVISE、第二次最终为 GO。后端目录与 Android 同步/旧缓存/点击只允许公共 HTTPS，拒绝深链、凭据、本机/内网名称和直接 IP；全部分页先验证后单次写 Room，第二页恶意来源不留下半更新。OpenAPI 的 `Source/Card/ErrorResponse` 已从错误嵌套恢复为顶层 schema；源码门禁为 `safeKnowledgeSourceLinks=1 apiSchemaStructure=1`。
- 小组件每日最多换两次由 `WidgetStateStore` 的 DataStore 事务状态机强制执行；32 次并发点击与 32 次刷新只提交两次，旧偏好迁移、进程重建、卡片移除、跨日和迟到旧日回调均有 JVM/API 34 回归。当前状态机到换卡池末尾返回无更多卡，不会循环回当天已展示卡；组件直接观察持久状态流解决活跃 Glance 会话漏重绘。
- 小组件自动刷新已从“进程启动时刻 + 24 小时”改为按 `Asia/Shanghai` 00:05 为未来 7 个自然日分别建立唯一 OneTimeWork，任一任务执行后补齐后续窗口，离线读取 Room，系统组件更新保留为兜底。最终 critic 为 REVISE，指出立即任务的 `REPLACE` 自取消竞态；现已统一使用 `KEEP`，重复排队保留未完成任务 ID，源码门禁为 `calendarDayWidgetRefresh=1`。两次 critic 上限已用尽，未虚构第三次 PASS。
- 未来七天卡片排期不再使用历史卡总数；任务完成事务以每设备 PostgreSQL advisory lock 选择今天起首个空日期，并严格归一化数据库 `date`。四连接池 32 路并发产生连续唯一日期，删除中间日期后下一张补最早缺口；独立 critic 最终为 PASS，源码门禁为 `contiguousCardSchedule=1`。
- 云端删除崩溃恢复完成本轮 evaluator–optimizer：持久化 `DELETE_PENDING/DELETE_CONFIRMED`，服务端以原子 `created` 证明区分令牌轮换与删除后新建替代设备；客户端先等待取消提醒，再按远端确认、Room 原子清理、身份重置执行。最终独立 critic 为 REVISE，指出先重置身份会在 Room 清理前崩溃时丢失恢复材料；已修复并以 JVM 崩溃点、API 34 丢响应/确认重放、源码守卫与 UI 烟测验证。两次 critic 硬上限已用尽，未虚构额外 PASS。
- 图片上传状态保真完成本轮 evaluator–optimizer，最终独立 critic 为 PASS。原始 OkHttp PUT 会保留非成功 HTTP 状态；401 只刷新身份并重放一次，409/429/5xx 保持 READY、保留 Picker/分享私有副本并进入有界重试，400/410/413/415 才进入 FILTERED 并清理副本。JVM、API 34 和源码守卫均覆盖该边界。
- 详情页/组件缩略图 OOM 风险完成本地 evaluator–optimizer，最终独立 critic 为 PASS。共享 decoder 先读 bounds、应用八种 EXIF 方向并回收中间位图；详情长边 ≤1280 px，组件 ≤320 px/400 KiB。策略测试覆盖 48MP 与极端宽高比，API 34 覆盖损坏输入、方向交换和 20 次重复解码；真实 Pixel Launcher 组件绑定/渲染无崩溃。
- “太私人”同步竞态已修复：隐私 outbox 先提交并在全部卡片分页期间保持为硬屏障，按 card ID 和 `NEVER_ANALYZE` 双重拒绝陈旧卡；只有全分页成功后才确认 outbox，失败/中断保留供幂等重试。独立 critic 最终指出清索引边界后为 REVISE；修复达到本轮复核硬上限，未虚构额外 PASS，25/25 设备回归包含成功和 503 两条真实 HTTP 路径。
- 权限生命周期与上传并发完成上一轮本地 evaluator–optimizer，该轮最终独立 critic 为 PASS。前台恢复会对账真实权限；撤权仅取消自动链并保留 imported；FULL→PARTIAL 使用专用 reconciliation；自动/显式导入上传来源隔离且非法范围失败关闭；单进程上传由可取消互斥串行执行，进程重启后 READY 候选仍按原范围恢复。运行态证明 `preConsentAnalysisWork=0`、`deniedAnalysisWork=0`、`revokedAutoWork=0`、`partialScope=1`、`partialReconciliation=1`。
- Android 上传只允许 API 同源一次性会话，且 OkHttp 普通/HTTPS 重定向均关闭；单测和源码守卫覆盖。
- 生产日志最小化、非测试环境依赖覆盖拒绝、同候选成本幂等、分享确认前 MediaStore URI 日志泄漏修复均已回归。
- 34 个证据/安全自测及 API 契约、运行预算、供应链、部署清单、源码守卫全部 GO。
- 已按 Beta.62 当前目录生成首批 20 条全空决策人工审核包 `.tooling/knowledge-review-batches/beta62-review-01-pending.json`，覆盖砧板、牙线、海绵、牙刷、安全气囊、自行车和自行车刹车，风险构成为 health 10、safety 6、general 4；包内没有预选决定、来源勾选、语义确认或审核人，不能授予发布资格。
- 来源联网检查会识别跨多主机的统一 DNS/网络基础设施失败：每次保留 latest-attempt 诊断，但不以系统性失败覆盖正式证据，审核队列也拒绝 `infrastructureFailure=true`。2026-07-23 19:11 再次真实运行 531/531 全目录检查；当前 Codex 网络把 Wikipedia、ADA、Android、GHCR 等代表性公共域名统一解析到 RFC 2544 保留的 `198.18.0.0/15`，安全请求层按设计拒绝，得到 `infrastructureFailure=1 canonicalUpdated=0`。最新诊断在 `.tooling/knowledge-source-results/all-sources-latest-attempt.json`；队列预览仍为 `sourceEvidence=0 grantsApproval=0`。必须在能直接解析公共 IP 的网络环境重跑，不能绕过 SSRF 防线。
- Kimi 已完成 20 个 SAFE_PACKET 轮次并达到硬上限；报告在 `reports/kimi-adversarial-review-round-20.md`，结论仍为 `NO-GO`。

## 当前阻断

- 知识目录 200 个主题、624 条事实；613 draft、11 仅状态 approved、0 真人签注、0 ready topic。未提供受保护的 `JIANWEI_KNOWLEDGE_REVIEWER_IDS`。
- 当前没有可采信的全目录实时来源证据；最新 531/531 统一失败已确认是 Codex 网络的保留地址 DNS 映射，不是 531 个来源各自失效，更不是语义审核结论。
- 只有一张 CC0 图片的本地工程闭环；仍没有 300–500 张明确授权的隐私/识别评测集，也没有真实 Qwen/OSS 生产管线结果。
- 没有真实托管 PostgreSQL/OSS/Qwen/HTTPS、不可变 OCI/base-image 摘要和三方签名部署回执。
- 没有正式 APK 私钥签名、华为/小米/OPPO 或 vivo 七天实体机矩阵、真人 `zh-CN` TalkBack 听读、200 卡人工抽检和 10–50 人 cohort。
- 当前失败关闭结果：知识发布、容器部署输入、Beta 原始证据三项门禁均退出 1；`evaluation/beta-evidence.json` 不存在。

## 下一步最短动作

1. 若先做内容：先在可完成公共 IP 安全解析的网络环境运行 `node scripts/check-knowledge-sources.mjs --all-live` 并重建队列；再由用户提供真实审核人 ID 白名单，从首批 20 条审核包启动本地工作台，逐条打开来源、形成并应用真人决策；每批后运行 `node scripts/check-knowledge-readiness.mjs`。
2. 若先做云：提供真实测试环境的 HTTPS API、临时 OSS STS、Qwen 与托管 PostgreSQL，按 `docs/DEPLOYMENT.md` 部署，并按 `docs/BETA_EVIDENCE_RUNBOOK.md` 生成已签名部署回执和安全/敏感双样本证据。
3. 若先做设备：用正式签名 APK 在华为、小米、OPPO/vivo 采集七天原始报告，再编译实体机与 TalkBack 工件。
4. 所有真实工件齐备后组装 `evaluation/beta-evidence.json`，只有 `node scripts/check-beta-readiness.mjs evaluation/beta-evidence.json` 返回 GO 才可 Beta。

## 不可重复的坑

- Windows 下必须从 `D:\wyq\jianwei` 运行 Gradle；混用桌面 junction 会造成 Gradle 根目录冲突。
- PowerShell 脚本需用 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File ...`，不要修改系统执行策略。
- Android 参考套件不包含全量 JVM 测试；还要单独运行 `:domain:test :data:testDebugUnitTest :app:testDebugUnitTest`。
- 直接运行 Gradle 时还必须设置仓库内 `.tooling\gradle-home`；优先调用 `scripts\build-android-windows.ps1`，不要使用全局 Gradle 缓存后再放宽依赖校验。
- Kimi 已到第 20 轮硬上限，不要重跑或把本地检查记作第 21 轮；不要向外部发送源码、路径、照片或密钥。
- 当前 macOS 隔离工具链在 `.tooling/macos-*`；ADB daemon 需要在允许本地端口绑定的上下文启动。若 R8 测试包与 Debug 签名不同，先只卸载测试 AVD 中的 `cn.jianwei.app`，不要清理真实设备数据。
- 两个 Windows 设备测试脚本的最低计数仍保持 40，本轮没有在 Windows 重跑，因此不要改阈值或误报 Windows 参考套件已覆盖新增测试；当前 macOS API 34 实跑总数为 46。
