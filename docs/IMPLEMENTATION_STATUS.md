# 实现状态

> 2026-07-24 首页滚动状态隔离（当前最新权威摘要）：Compose 为每日、收藏和精准入口分别维护 `LazyListState`；当前模式只消费自己的状态，每个新的 `focusedCardId` 强制精准入口回到顶部，退出后恢复原每日/收藏位置。API 34 标准布局从历史“拉链”打开未来“保温杯”、切换“回形针”及关闭恢复原位置全部通过；320dp/2× 大字体复验顶部入口、计划日期和目标对象可达。`.tooling/independent-home-scroll-audit/audit.json` 为 `GO`、`releaseEvidence=false`，SHA-256 `bc37eeda04b2bb3fdf0e1fcc21294d2059ce573e887e0b2d3dc3c164190ee77a`。完整回归 JVM 135/135、API 34 instrumentation 51/51、源码守卫 `independentHomeScroll=1`、双 Lint 0 error/32 warning、Debug 与 R8 Release 成功。Debug/未签名 Release SHA-256 为 `3d747d4ae9f189772676f45282ea9b4691c937e928608896221007e839db212f` / `60ce0c7de70b7609976edb52d3c3134c70ccdf8ef70238cbccef3e16416bd928`。这些证据不替代 OEM 实体机、真人内容审核、真实云、正式签名、真人 TalkBack 或 cohort，Beta 保持 `NO-GO`。

> 2026-07-24 真实卡片日期与历史分区（当前最新权威摘要）：domain 新增基于中国自然日的纯日期展示策略，历史卡不再固定冒充“今日识物”；每日流新增“今天 / 往日”分区，卡片按今日、昨日、同年月日、跨年完整日期或未来计划日期显示，并为 TalkBack 暴露明确日期语义。API 34 无真实照片夹具验证标准布局、320dp/2× 大字体和未来精准入口；`.tooling/truthful-card-date-audit/audit.json` 为 `GO`、`releaseEvidence=false`，SHA-256 `f96a65ab64e11279b01ce6bb62e9466d8ae87fbdf6845362d3be4c399d092a34`。完整回归 JVM 135/135、API 34 instrumentation 51/51、源码守卫 `truthfulCardDates=1`、双 Lint 0 error、R8 Release 成功。Debug/未签名 Release SHA-256 为 `eb0ba918e62818cd9a0ab806bbc3c4180c90b8ddbc3c386d0a8ba986332d0dcc` / `5f55d331f797f20b3bf3b117dc98551c8adddb4cea3519ceaefd6678cf005634`。该结果不替代真人内容、真实云、正式签名、OEM 实体机、真人无障碍听读或 cohort，Beta 保持 `NO-GO`。

> 2026-07-24 精准回卡独立入口（当前最新权威摘要）：组件/提醒目标卡不再被插入普通每日列表。domain 的 `DailyCardPresentation` 将今天/历史卡、合法精准目标和不可用目标分开；Compose 精准模式只显示目标卡和返回入口，隐藏每日/收藏页签及设置，系统返回优先退出；未知、删除或非 scheduled ID 显示明确失效状态，不会静默落到另一张卡。API 34 无照片夹具验证普通页只显示今日卡、未来目标独立打开、可见返回/系统返回恢复每日页、失效 ID 只有一个返回动作；320dp/2× 下全部卡片内容与操作可达。`.tooling/focused-card-entry-audit/audit.json` 为 `GO`、`releaseEvidence=false`，SHA-256 `b3b99993502ae711ff5d5b4fcff52b93dde9f2f6d00b11a10ef2473003fe2009`。完整回归 JVM 130/130、API 34 instrumentation 51/51、源码守卫 `focusedCardEntry=1`、双 Lint 0 error、R8 Release 成功。Debug/未签名 Release SHA-256 为 `9086669c452743106396cdce0ac6461c623a0151362ca38393c6efe45eb0ca1f` / `7cbae81c84038bbfb64142943f0bb7f0b009ec60a5391b3aefc64b8d4d789ba3`。外部 Beta 阻断不变，结论保持 `NO-GO`。

> 2026-07-24 用户可控推荐兴趣（当前最新权威摘要）：引导页的三项兴趣现已成为可持续维护的用户设置。domain 集中定义五类兴趣、恰好三项规则、旧值规范化和候选排名词；data 用兼容既有 SharedPreferences 的 Repository 持久化并发布变更；ViewModel 暴露状态与保存结果；`PrivacyScanWorker` 从同一 Repository 读取，不再耦合引导页存储。首页“你的推荐偏好”展示三项摘要，可展开替换、取消或保存，并明确只影响下一批新照片排序，反馈学习不会静默修改显式选择。API 34 标准宽度真实保存并冷启动保留 `生活设计/科学原理/制造工艺`；320dp/2× 字体下五项与操作全部可达，crash buffer 为空。完整回归为 JVM 130/130、API 34 instrumentation 51/51（App 3、Data 48）、源码守卫 `userInterestControl=1`、App Debug/Release Lint 0 error（32/32 warning）、R8 Release 成功。Debug/未签名 Release SHA-256 为 `f239c5c2a1e77f3a108c552104db25cf7bc453b659f5188dfe217b830c8b33f3` / `66d535b157874b8ce6ab51ae85f91240685b05671213ac753959fd1306bbd7dd`。该结果不替代真人内容、真实云、正式签名、OEM 实体机或 cohort，Beta 保持 `NO-GO`。

> 2026-07-23 首次体验产品化（当前最新权威摘要）：Compose 三屏引导已从纯文字权限说明改为“价值预览 → 隐私处理流程 → 兴趣与授权入口”。第一屏展示最终知识卡的信息结构但不编造具体事实；第二屏明确本机筛选、压缩/去 EXIF、审核事实命中三道边界；第三屏以选择卡片展示 3 项兴趣，分别解释自动发现与 picker-only 的权限后果。进度、可见返回按钮和 `BackHandler` 允许用户复查前页。兴趣布局由纯策略在 `<360dp` 或 `fontScale >= 1.5` 时切为单列。API 34 标准宽度及精确 320dp/2× 字体均实跑；首次窄屏流程发现跨页保留滚动偏移，现以 `LaunchedEffect(step)` 将新页滚动归零并复验。最终 picker-only 真实进入系统 Photo Picker，取消后 `completed=true`、3 项兴趣持久化并进入仅手动选择首页；清洁重启无 App crash。审计 `.tooling/onboarding-experience-audit/audit.json` 为 `GO`、`releaseEvidence=false`，SHA-256 `0cbaec57684a272a0611a67964f1fd18e23d089ee88b2996a1a73d9af3471c26`。完整回归 JVM 120/120、API 34 instrumentation 46/46、App Debug/Release Lint 0 error（32/8 warning）、Debug/R8 Release 成功；Debug/未签名 Release SHA-256 为 `43331e8044c5f400c5bed6c6b2b198ef7f121dc914646667cdc24f1459e3911d` / `1634491b9f53276316d37603bcfd63c1b753a5c91286d2023ca3b00e37a3ce97`。清理完成，外部发布阻断不变，Beta 保持 `NO-GO`。

> 2026-07-23 桌面组件产品化呈现（当前最新权威摘要）：Jetpack Glance 2×2/4×2 已统一使用见微的品牌色与照片优先知识层级。2×2 扩大照片区域；4×2 使用全高照片、紧凑对象/把握、两行正文、来源和底部自定义换卡控制。领域层集中生成 `compactLabel`，低置信度标题已带对象时只显示“把握较低”，App 的完整可见标签和精确 TalkBack 百分比不受影响。API 34 Pixel Launcher 实际通过系统 Pin Widget 添加 2×2，拖拽为 4×2，连续换到扫帚和牙刷两张卡并从组件准确打开牙刷详情。实跑先后暴露并修复照片未撑满组件高度、右栏未撑高使换卡控制悬空两个布局缺陷。最终审计 `.tooling/widget-experience-audit/audit.json` 为 `GO`、`releaseEvidence=false`，SHA-256 `35bb0ee19d22c2f45377cdc8a2ea41680a42efbbea65b6f29250732021efabd2`；清理后包、组件绑定和夹具均不存在，模拟器与 ADB 已停止。完整回归为 JVM 119/119、API 34 instrumentation 46/46，App Debug/Release Lint 0 error（32/8 warning），Debug/R8 Release 成功。Debug/未签名 Release SHA-256 为 `a16cbb12160ff98f8cabdd8b46cf0eb1e89d03258bed166c6723e1b4b55a2bf8` / `39f0743c9f70c519399df7bbbf4b318177e3986cf76c96f27c9caecffde94fe4`。该结果不替代真人内容、真实云、正式签名、OEM、真人无障碍验证或 cohort，Beta 保持 `NO-GO`。

> 2026-07-23 知识卡产品化呈现（当前最新权威摘要）：Compose 首页主卡已从长表单式操作堆叠调整为稳定的阅读层级：照片、标题与收藏状态、识别把握、核心知识、个性化推送原因和来源先完成阅读，再进入收藏/物品提醒、四类反馈与本次安装排除。引导页增加品牌副标题和三段进度轨，Material 颜色系统补齐容器与正文对比。收藏/提醒使用纯策略在 `<340dp` 或 `fontScale >= 1.5` 时由并排切换为纵向，源码门禁固定标题 → 原因/来源 → 主操作 → 反馈顺序。API 34 真实 Compose 运行覆盖标准宽度、第三屏引导、精确 320dp/2.0 倍字体的主操作和反馈区；临时视觉夹具已删除，显示设置恢复，crash buffer 为空。本地审计 `.tooling/card-experience-audit/audit.json` 状态 `GO`、`releaseEvidence=false`，SHA-256 `3ffeb2a17fcea8ba1fd00e7cad3ec3c0d4ecda3d7c3bd759d5a24fe0c5f45192`。Android JVM 119/119，Debug/Release Lint 0 error（32/8 warning），Debug 与 R8 Release 成功；APK SHA-256 为 `A7BF5D93AD8C218D101E31C87B78D40F6C0899ABADC0FC8214E5D9DEEB1B5AFB` / `1774C9CDF153F39208F10196778260BADBFD2F20C6B6D31090C27A4B2A882839`。这只提升产品呈现并验证本地运行，不替代真实内容、云、OEM、正式签名或 cohort，Beta 仍为 `NO-GO`。

> 2026-07-23 PostgreSQL 迁移 13 真实执行（当前最新权威摘要）：安装但不注册常驻服务的 PostgreSQL 17.10 (Homebrew) 已由新增 macOS 隔离门禁在随机回环端口启动；全部 13 个迁移首次执行、重复迁移和编译服务启动迁移均成功。13/13 仓储/升级测试通过，其中迁移 13 在模拟旧表中真实回填 `detected_object_name=title`、拒绝空白值，仓储创建/读取继续保留独立对象名。编译后 Fastify 又经过 PostgreSQL-backed TCP 闭环，认证、敏感拒绝、一次性上传、识别、卡片同步、反馈、追踪、未知物件、删除与对象归零全部通过；进程最终关闭。结果在 `.tooling/postgres-integration-results-macos/` 和 `.tooling/backend-e2e-postgres/`。后端基础测试仍为 98/98，check/build 成功，源码护栏 GO。该证据将迁移 13 从“静态验证”提升为“本地真实 PostgreSQL 已验证”，但不等于托管 PostgreSQL、OSS/Qwen/HTTPS 云证据，发布结论保持 `NO-GO`。

> 状态解释：下文仍保留各时间点的历史摘要；其中“PostgreSQL 测试 skipped / 迁移 13 未真实执行”已被本段 13/13 真实数据库证据取代。

> 2026-07-23 真实照片到桌面组件闭环（当前最新权威摘要）：在未授予全量相册权限的 API 34 环境，用 Android 系统 Photo Picker 导入一张 CC0 自行车图片；bundled ML Kit 实际输出 `Vehicle/Bicycle/Wheel/Tire/Metal`，质量分 0.7614，敏感标记为空。客户端生成 1280×960、无可见 EXIF/GPS/设备字段的 JPEG，通过同源临时上传会话进入本地 Fastify，按真实端侧标签匹配 `bicycle-001`，回写 Room 后由 App 与 Pixel Launcher 2×2 Glance 组件展示，组件点击准确回卡，服务端临时对象为 0。该实跑发现并修复 Compose 状态切换时错误回收新位图导致的 `Canvas: trying to use a recycled bitmap`，新增设备级生命周期回归及源码守卫。最新完整回归为 Android JVM 118/118、API 34 instrumentation 46/46（App 2/2、Data 44/44），App/Data Lint 0 error（32/20 warning），R8 Release 成功。Debug/未签名 Release/App instrumentation SHA-256 为 `C3E79661172D1BFEA10D6D1069B11C44DB149C0D3AFE676CC42E8254FA180F34` / `4486251A2103038463F5010601A822BF4B4125102DEF9699A4717688439178E4` / `65BD9531B986CD614A56A8F7DAE005E632C0428FC05C474ED6760B91EEA339E4`。证据位于 `.tooling/photo-to-card-e2e/`，其 `releaseEvidence=false`；真实 PostgreSQL/OSS/Qwen/HTTPS、真人内容审核、正式签名、OEM 实体机和 cohort 仍未完成，发布结论保持 `NO-GO`。

> 2026-07-23 识别信息去重与用户化置信度复核（当前最新权威摘要）：Android domain 现统一返回可见识别标签与精确无障碍标签。低置信度标题已携带对象时，App/Glance 只显示“识别把握较低”；标题未携带对象时才补“可能是牙刷 · 把握较低”。0.72–0.89 显示“把握中等”，0.90 起显示“把握较高”，非法值失败关闭；TalkBack 语义仍包含对象与精确百分比。API 34 Pixel Launcher 已实测 App、2×2 组件和组件精准回卡，crash buffer 为空。完整回归为 31 个 JVM 套件 118/118、API 34 设备测试 45/45，App/Data Lint 0 error（32/20 warning），R8 Release 成功；源码护栏 GO。Debug/未签名 Release SHA-256 为 `6E978F2A0AF60148254DF1A53403E6B69959FACC933BA8C3A54BEC36D4F5BF59` / `CB8F938A0BC90B4E7430A4129F67200B1A8289E955B842367104CF59E6200FBD`。本地证据明确 `releaseEvidence=false`，外部发布阻断不变。

> 2026-07-23 显式识别对象与不确定性闭环（当前最新权威摘要）：`KnowledgeCard` 现在独立持久化 `detectedObjectName`，覆盖后端、OpenAPI、PostgreSQL 迁移 13、Room 9、Compose 和 Glance；标题不再是系统识别对象的唯一载体。后端和 Android 领域策略都固定 0.72 阈值，低置信度稳定显示“这可能是……”和“识别对象：可能是……”。后端 TypeScript check/build 与 98/98 基础测试通过；12 项 PostgreSQL 集成测试在本机显式 skipped，因此迁移 13 仍待真实数据库执行。Android 31 个 JVM 套件 115/115、API 34 设备测试 45/45（含 Room 8→9），App/Data Lint 0 error（32/20 warning），Debug 与 R8 Release 成功。API 34 Pixel Launcher 已验证 App、2×2 组件和精准回卡；本地证据明确 `releaseEvidence=false`。源码、API 契约、供应链和运行预算门禁 GO。Debug/未签名 Release SHA-256 为 `E837E5771F81AC3ACC189D9302E40871DECC86CDF503BE39D22EDFAFCA5AB0FD` / `05900CD3CD449B0AD6F90AC6023DEBDF0975A1109C780D626E59D3C8A1AF41C4`；外部发布阻断不变，Beta 保持 `NO-GO`。

> 2026-07-23 每日卡可见性与真实桌面组件闭环（最新权威摘要）：domain 层集中定义每日卡可见性，普通 App 内容流失败关闭地隐藏未来缓存，只有带合法卡 ID 的组件点击可把对应已排期卡置顶。组件只加载当前卡和最多两张未来卡，历史卡不参与手动换卡；状态机到末尾不循环。Glance 内容直接收集 DataStore 状态流，保留显式 `update` 作为非活跃会话兜底，修复真实发现的第二次换卡状态已持久化但桌面未重绘问题。API 34 Pixel Launcher 实测 2×2 添加、4×2 缩放、两次连续换卡、配额终态无按钮及精准回卡全部通过。完整回归为 30 个 JVM 套件 112/112、API 34 设备测试 44/44，App/Data Lint 0 error（32/20 warning），Debug 与 R8 Release 通过；源码门禁新增 `futureCardCacheHidden=1 widgetSwitchAffordance=1 widgetLiveRefresh=1 widgetCardDeepLink=1`，API 合约与供应链门禁 GO。Debug/未签名 Release SHA-256 为 `DA5A2870592E98BC327F74EC17892A8F24CB39E2ACA2132329FC3C186C996421` / `0CB9C3EEC44CE374D5F706147AA8BC5C658F1482F86E996F058B81BB473A0F9B`；外部发布阻断不变。

> 2026-07-23 首卡真实状态与离线缓存耗尽闭环（上一已完成摘要）：旧首页只有一个可丢失字符串，后台已无候选、无审核事实或重试耗尽后仍可能永久显示“正在寻找第一张卡片”。当前 domain 定义 `QUEUED/SCANNING/FILTERING/SYNCING/READY/NO_MATCH/RETRYING/FAILED`；data 层只持久化聚合计数与安全文案，不保存照片 ID、标签或文件名；扫描、隐私筛选、上传同步、权限撤销和有限重试均收束到明确终态。Compose 对每种空状态显示可执行的选择、恢复或重试动作，已有卡时只把重试/失败作为非阻塞提示。Glance 在排期日期过期后继续显示最后一张卡，同时明确标记“新卡缓存已用完”。API 34 Repository 重建回归及完整设备套件通过，源码门禁输出 `truthfulAnalysisState=1 widgetCacheExhaustion=1`。完整回归为 28 个 JVM 套件 105/105、API 34 设备测试 44/44，App/Data Lint 0 error（32/20 warning），R8 Release 通过。Debug/未签名 Release SHA-256 为 `F988110BE57063570CDFD026D169DA70C8ECF6941DCF7A87A7D576D4D99EA609` / `3052AC11BEB911FB0B4E4CF89083D669ED90921F9596EB3EB3BD86C14BDA36C6`；正式签名与真实云阻断不变。

> 2026-07-23 OCR 敏感信息失败关闭复核（最新权威摘要）：旧规则只移除普通空格和换行，带全角数字、
> 全角/Unicode 连字符或分组排版的身份证号和银行卡号可能漏检。当前 OCR 文本先经 Unicode NFKC
> 归一化，随后只折叠空白与身份证/银行卡常见分隔符；身份证还支持显式字段和版式标记组合，银行卡
> 支持品牌+13–19 位号码以及无品牌的四组卡号。日期与手机号组合负例保持不命中。API 34 使用 bundled
> ML Kit 对生成的最终 JPEG 字节执行真实 OCR，确认 `VISA 6222-0200-0000-0000` 被标记为
> `bank_card`；该 `analyzeBytes` 路径就是创建上传任务前的最终字节复检。源码门禁固定
> `ocrSensitiveNormalization=1`。完整回归为 27 个 JVM 套件 100/100、API 34 设备测试 43/43，
> App/Data Lint 0 error（32/20 warning），R8 Release 通过。Debug/未签名 Release SHA-256 为
> `9BE969A2F9AFDF2D85233D0EBCE6A5F4BA49C0D224FF3BB1B58F58A04D149840` /
> `A9930CD5A1A6B185D107D90AD30E1D2037977DE34984337DCD8F748CC0E404D1`。真实授权敏感集和 Qwen 云验证仍属外部阻断。

> 2026-07-23 MediaStore 90 天隐私边界复核（最新权威摘要）：旧查询会无条件接受
> `DATE_TAKEN` 为空或 0 的媒体，因此历史下载图或迁移图可能绕过“近 90 天”授权说明。当前有有效
> 拍摄时间时严格按拍摄时间判断；只有缺失拍摄时间时才回退到 `DATE_ADDED/DATE_MODIFIED`，且回退
> 时间本身也必须位于请求窗口。Android 14 MediaProvider 四组合设备回归覆盖新旧拍摄时间与新旧媒体
> 时间的交叉情况，确认旧无拍摄时间图片被排除，并保留近期图片；源码门禁固定
> `mediaStoreRecencyBoundary=1`。最新完整回归为 27 个 JVM 套件 100/100、API 34 设备测试 43/43，App/Data
> Lint 0 error（32/20 warning），R8 Release 通过。Debug/未签名 Release SHA-256 为
> `9BE969A2F9AFDF2D85233D0EBCE6A5F4BA49C0D224FF3BB1B58F58A04D149840` /
> `A9930CD5A1A6B185D107D90AD30E1D2037977DE34984337DCD8F748CC0E404D1`。外部发布阻断不变。

> 2026-07-23 Android 产品界面层级复核（最新权威摘要）：API 34 实机级视觉审计确认旧首页把组件推广
> 放在知识卡之前，并在每日页和收藏页重复；隐私、删除、导出等六项管理操作又长期展开在内容流中，
> 使知识与反馈闭环退居次要位置。当前知识卡在每日页直接成为首屏主内容，四项反馈与物品提醒入口可见；
> 紧凑的品牌绿组件 CTA 仅跟在第一张每日卡之后，收藏页不显示；“你的数据与隐私”默认折叠，展开后
> 选择照片、添加组件、暂停分析、清本地索引、删云端数据和导出报告均保留。空每日、空收藏、每日卡、
> 收藏卡和展开隐私状态均以 1080×2400 API 34 截图及 accessibility hierarchy 验证。
>
> 新增纯策略回归固定“仅第一张每日卡显示 CTA、收藏页不显示”。追加的 320dp/2× 字体实跑发现横向
> CTA 会把标题挤成逐字换行，现由纯展示策略在宽度低于 360dp 或字体倍率至少 1.5 时切换为纵排；
> 标准 411dp/1× 保持横排。按钮完整命名为“添加桌面组件”并实测进入 Pixel Launcher 原生 Pin Widget；
> 每日/收藏 Tab 会向 accessibility tree 暴露随页面切换的 `selected=true`；320dp/2× 的每日可见标签
> 压缩为单行“每日”，但无障碍名称仍是“每日卡片”，411dp/1× 继续显示完整文案。Windows App smoke 会显式
> 展开隐私区再验证导出、暂停和删除。“仅选择照片”现在在用户选定模式时即完成引导，Photo Picker
> 空结果不再把用户送回第三屏；API 34、320dp/2× 实跑确认取消后返回仅手动选择首页、引导偏好已落盘，
> 且照片分析 WorkManager 任务为 0，Windows accessibility smoke 已固定该路径。Android 当前为
> 26 个 JVM 套件 94/94、API 34 设备测试 42/42；App/Data
> Lint 均 0 error（32/20 warning），Debug 与 R8 Release 构建通过。Debug/未签名 Release SHA-256 为
> `4AF516C59CF3311117ECD75C5EA373319F7B61297F19BADCD5555070EC8ADB01` /
> `3B5D1A082406AC1A78A9FCE57A143297E9AF5A428272F7015E4E7D6D29A98497`；源码、API 契约与供应链
> 门禁 GO。真实知识审核、云、正式签名、OEM、真人听读与 cohort 仍缺失，Beta 保持 `NO-GO`。

> 2026-07-22 本地收藏与隐私原子删除 Loop Engineer 闭环（最新权威摘要）：Android 现有独立收藏页、
> 离线即时收藏/取消、跨进程重启与服务端 card upsert 保留状态；Room 7→8 新增 `saved_cards`，由
> `knowledge_cards` 外键级联拥有。首次收藏原子写本地状态、一个 SAVE outbox 和 +0.50 主题偏好；
> 取消保留 `feedbackSignaled` 墓碑，再次收藏不会重复 outbox 或偏好。第一次 critic 返回 `REVISE`，
> 发现 TOO_PRIVATE 删除卡片时可能留下普通 SAVE outbox；修复后第二次也是最后一次 critic 仍返回
> `REVISE`，指出隐私屏障、照片禁止分析和卡片/收藏删除之间存在进程崩溃窗口。当前
> `stagePrivateFeedbackAndDelete` 是首个执行的单一 Room `@Transaction`：写 TOO_PRIVATE 屏障、将候选
> 标记为 `NEVER_ANALYZE` 并写抑制记录、删除提醒与所有普通反馈，最后删除卡片并通过外键删除收藏；
> 私有文件清理和偏好学习只在事务后幂等执行，不会重新打开展示或上传路径。达到两次 critic 上限后
> 未虚构第三次 PASS。
>
> 新增 API 34 文件数据库回归会在事务提交后立即关闭数据库模拟进程死亡，重开后证明卡片、收藏、
> 提醒和普通 outbox 均消失，仅保留 TOO_PRIVATE，照片仍为 `NEVER_ANALYZE` 且已抑制。当前 Android
> 为 26 个 JVM 套件 91/91、API 34 设备测试 41/41；真实 Debug UI 还验证收藏、强停重启和 TOO_PRIVATE
> 后 `cards=0 / saved=0 / feedback=TOO_PRIVATE / suppressed=1`，crash buffer 为空。Lint 0 error、
> Debug 与 R8 Release 构建通过；三类 APK SHA-256 见根 README。源码、供应链与 API 契约门禁 GO。
> 知识门禁仍为 200 主题、0 真人签注、0 ready topic；容器不可变摘要与
> `evaluation/beta-evidence.json` 缺失，三项发布门禁均按预期退出 1，因此 Beta 保持 `NO-GO`。

> 2026-07-21 卡片来源安全与分页原子性 Loop Engineer 闭环（最新权威摘要）：卡片详情原有标题、正文、
> 置信度、推送理由、来源与四类反馈链路完整，但目录只用通用 URL 校验，Android 又会把服务端或旧 Room
> 中的任意 URI 直接交给系统打开；同时卡片同步逐页写库，第二页非法会留下第一页的半更新。当前后端与
> Android 都只接受无凭据、默认端口、公共主机名的 HTTPS 来源，拒绝 HTTP、`javascript:`、`file:`、
> `intent:`、本机/内网名称和直接 IP；Android 在全部分页、来源、游标与总页数验证成功后才单次写 Room，
> 旧缓存和最终点击再次失败关闭，打开异常不会导致崩溃。审计还发现 OpenAPI 的 `Source`、`Card` 与
> `ErrorResponse` 被误嵌套在 `TopicAffinity` 下，现已恢复为顶层 schema 并固定 1–3 个 HTTPS 来源。
> 第一次独立 critic 返回 `REVISE` 并定义上述边界，第二次也是最后一次返回 `GO`。后端 94 项基础测试、
> check/build、内存 TCP E2E 与 API 契约均通过；Android 26 个 JVM 套件 91/91、API 34 设备测试 37/37，
> 完整参考套件 GO。源码门禁输出 `safeKnowledgeSourceLinks=1 apiSchemaStructure=1`；测试签名 R8 APK
> SHA-256 为 `533B7F68C583A72CE907446DE3CDAE8DAE2772A0EAFFA6281A039AEF0FB1FE70`，
> Debug 为 `E24102CE870F85BB891DD1AECC5D11948701DDBF701FDFD866972E85875113E9`，未签名 Release 为
> `C4308526FA1F5D08B934E7E6F2AA799093C2ADDAB50A8FDFA0417002CA56FD29`。知识就绪仍为 0 个真人
> 签注/0 ready topic，容器不可变摘要和 `evaluation/beta-evidence.json` 仍缺失，因此 Beta 保持 `NO-GO`。

> 2026-07-21 小组件中国自然日自动刷新 Loop Engineer 闭环（最新权威摘要）：旧实现把首次进程启动时刻
> 作为 24 小时周期锚点，若用户在午夜前启动，跨日后的当天卡最坏会接近下一晚才刷新。当前启动入口先
> 取消旧周期任务，再立即安排一次本地刷新，并按 `Asia/Shanghai` 00:05 为未来 7 个自然日分别建立
> 独立、唯一、无网络约束的 OneTimeWork；任何一次执行都会补齐后续 7 天，系统 `APPWIDGET_UPDATE`
> 继续作为第二条兜底。第二次也是最后一次独立 critic 返回 `REVISE`，指出立即任务使用 `REPLACE`
> 可能在 WorkManager 唤醒进程时取消负责唤醒自己的 Work；现已统一改为 `KEEP`，重复调度必须保留
> 7 个未完成任务的原 Work ID，源码门禁同时禁止该文件重新出现 `REPLACE`。达到两次 critic 上限后
> 未虚构第三次 PASS。Android 全量为 25 个 JVM 套件 88/88、API 34 设备测试 34/34，应用、组件、
> 320dp+2.0x、TalkBack 焦点、R8 与 Release 日志隐私参考套件全部 GO；源码门禁输出
> `calendarDayWidgetRefresh=1`，测试签名 R8 SHA-256 为
> `740978BD7F3C45C4C86EC00F2A6AE2F9FA2ED312AAD4641EA1FAFDEFE82CB313`，`formalSigning=0`。
> 后端仍为 76/76、PostgreSQL 17.10 为 12/12/TCP E2E；外部发布阻断不变，Beta 仍为 `NO-GO`。

> 2026-07-20 未来七天卡片连续排期 Loop Engineer 闭环（最新权威摘要）：服务端此前按
> `cards.list(..., 100).items.length` 把历史卡片总数当作新卡日期偏移；老用户即使未来缓存为空，新卡
> 也可能被排到几十天后，100 张以后还会持续撞在同一远期日期。现在 AnalysisService 只提供中国日历
> 的最早日期，`completeWithCard` 在任务完成与写卡的同一事务内选择今天起第一个空日期；PostgreSQL
> 以每设备 advisory lock 串行化多个函数实例，并在删除未来卡后优先补最早缺口。首次真实数据库回归
> 还发现 `date` 被驱动解析成 `Date` 后，旧映射会下发 `Mon Jul 20` 并使所有并发任务误判同一天为空；
> 当前由严格 `databaseDate` 统一归一化。四连接池 32 路并发产生 32 个连续唯一日期，删除中间日期后
> 下一张精确回填；独立 critic 最终为 `PASS`。后端 76/76，PostgreSQL 17.10 为 12/12/TCP E2E，
> 源码门禁输出 `contiguousCardSchedule=1`。Android 未改，当前证据仍为 24 个 JVM 套件 83/83、API 34
> 33/33 与完整参考套件 GO；测试签名 R8 SHA-256 仍为
> `72E21772FCFAAFD7632A1460D32BC89EC71EE9F2F7AEB027CA0992D9E3D522E6`。外部发布阻断不变，Beta
> 仍为 `NO-GO`。

> 2026-07-20 小组件原子换卡配额 Loop Engineer 闭环（最新权威摘要）：组件渲染与“换一条”
> 现在统一通过 `WidgetStateStore` 的 DataStore 事务更新，不再在 Room 挂起前后分别读写
> `SharedPreferences`。进程级互斥与持久事务保证多个组件实例、快速点击和刷新竞争时每天最多只有
> 两次换卡成功；旧偏好会自动迁移，进程重建后配额仍保留，同日卡片被移除不会恢复额度。最终独立
> critic 返回 `REVISE`，发现跨午夜迟到的前一天回调仍可能把日期倒退并重新打开额度；状态日期现已
> 改为只能单调向前，旧日刷新与点击均只读保留新日状态。该补丁以 32 次并发点击 + 32 次并发刷新、
> 文件重建、旧偏好迁移、跨日重置和旧日回调交错回归闭环；达到两次 critic 硬上限后未虚构额外
> PASS。后端 73/73、PostgreSQL 17.10 为 11/11/TCP E2E；Android 24 个 JVM 套件 83/83、API 34
> 设备测试 33/33，应用/组件/320dp+2.0x/TalkBack 焦点/R8/Release 日志隐私统一参考套件为 GO。
> 测试签名 R8 SHA-256 为 `72E21772FCFAAFD7632A1460D32BC89EC71EE9F2F7AEB027CA0992D9E3D522E6`；
> `formalSigning=0`、`spokenOutput=0`、`humanAudit=0`，外部发布阻断不变，Beta 仍为 `NO-GO`。

> 2026-07-20 云端删除崩溃恢复 Loop Engineer 闭环（最新权威摘要）：客户端现在持久化
> `DELETE_PENDING/DELETE_CONFIRMED`，服务端注册响应用 PostgreSQL 原子 `created` 证明区分“原设备令牌
> 轮换”和“删除后新建的空替代设备”。若服务端已删除原设备但响应丢失，重试会只删除新建替代设备并
> 完成恢复；若注册命中既有不同设备则失败关闭，不会越权删除。删除 UI 会先持久取消并等待全部本地
> 提醒 Work，再执行“远端确认 → Room 事务原子清卡片/反馈 outbox/追踪 outbox → 最后重置身份”。最终
> 独立 critic 返回 `REVISE`，指出先重置身份再清 Room 会在中间崩溃时丢失恢复材料；该顺序已修复，
> 并以 JVM 崩溃点测试、API 34 丢响应/确认重放测试、源码守卫和真实 UI 删除烟测闭环。达到两次独立
> critic 硬上限后未虚构额外 PASS。后端 73/73、PostgreSQL 17.10 为 11/11/TCP E2E；Android 24 个
> JVM 套件 83/83、API 34 设备测试 32/32，应用/组件/320dp+2.0x/TalkBack 焦点/R8/Release 日志隐私
> 统一参考套件为 GO。测试签名 R8 SHA-256 为
> `69AE0AB72DA896400BE542459A4A43D7A449D9022963C59BAD0551CBAABB084A`；`formalSigning=0`、
> `spokenOutput=0`、`humanAudit=0`，外部发布阻断不变，Beta 仍为 `NO-GO`。
>
> 2026-07-20 图片上传状态保真 Loop Engineer 闭环（上一已完成摘要）：独立 critic 发现原始 OkHttp
> 图片 PUT 对除 401 外的失败只抛 `IllegalStateException`，导致 409/429/5xx 被误判为永久失败，
> 候选进入 `FILTERED`，Picker/分享导入的私有副本也会被删除。现由
> `UploadHttpStatusException(statusCode)` 保留真实状态，Retrofit 与原始 PUT 统一进入同一分类函数：
> 401 仍只刷新匿名身份并重放一次；409/429/5xx 保持 `READY`、保留导入副本并由 WorkManager 有界
> 重试；400/410/413/415 才进入 `FILTERED` 并允许清理副本。纯 JVM 回归覆盖响应转换和两类失败处置，
> API 34 回归证明连续 401 时总尝试恰好两次、身份只刷新一次；源码守卫固定状态保真及条件清理边界。
> 最终独立 critic 为 `PASS`。当前 Android 23 个 JVM 套件 81/81、API 34 设备测试 28/28，
> 应用/组件/320dp+2.0x/TalkBack 焦点/R8/Release 日志隐私全为 GO。测试签名 R8 SHA-256 为
> `9C6A8C964F97F6C60BC773909E55346DB0EC7E3E45FB93A297E40D0A89B1AB6E`；`formalSigning=0`、
> `spokenOutput=0`、`humanAudit=0`，外部发布阻断不变，Beta 仍为 `NO-GO`。
>
> 2026-07-20 有界缩略图 Loop Engineer 闭环（上一已完成摘要）：独立 critic 将详情页原尺寸解码和
> 组件固定 `inSampleSize=4` 定为 P1；48MP ARGB 原图理论分配约 192MB，固定四倍采样后仍约 12MB，
> 且两条路径都未应用 EXIF。现由共享 decoder 先读 bounds、按 2 的幂采样到目标内、应用八种 EXIF
> 方向并回收旋转/缩放中间位图；详情返回长边不超过 1280 px（ARGB 上界 6.25 MiB），组件不超过
> 320 px（ARGB 上界 400 KiB），Glance 完成 RemoteViews 转换前不提前 recycle。纯策略回归覆盖
> 48MP、超宽、超高和非法边界；API 34 回归覆盖损坏输入、方向交换、20 次重复解码、尺寸与实际
> `allocationByteCount`。实现后独立 critic 为 `PASS`。当前 Android 22 个 JVM 套件 75/75、API 34
> 设备测试 27/27，应用/组件/320dp+2.0x/TalkBack 焦点/R8/Release 日志隐私全为 GO。测试签名 R8
> SHA-256 为 `E300911424EFC0770129F0B79A8268BC06669778EE0C4034FA02FA4C3C34F567`；
> `formalSigning=0`、`spokenOutput=0`、`humanAudit=0`，外部发布阻断不变，Beta 仍为 `NO-GO`。
>
> 2026-07-20 “太私人”同步竞态闭环（上一已完成摘要）：独立 critic 发现客户端会先拉取卡片、后提交
> `TOO_PRIVATE` 反馈，服务端陈旧分页可能复活刚删除的本地卡片；进一步复核还发现清除本地照片索引后
> 不能只依赖候选墓碑。现将隐私 outbox 作为卡片同步硬屏障：先提交全部待处理隐私反馈，分页期间始终
> 保留 outbox 并按 card ID 拒绝陈旧卡，同时继续拒绝 `NEVER_ANALYZE` 候选；只有全部卡片页成功后才
> 二次本地删除并确认移除 outbox。隐私 POST 失败会阻止卡片 GET，服务端成功后客户端崩溃则保留 outbox
> 供幂等重试。独立 critic 的最终一轮为 `REVISE`，指出“索引已清除”边界；修复后因本轮复核硬上限
> 不再虚构额外 PASS，而以两项 API 34 回归和源码守卫闭环。当前 Android 21 个 JVM 套件 73/73、
> API 34 设备测试 25/25；应用/组件/320dp+2.0x/TalkBack 焦点/R8/Release 日志隐私全为 GO。
> 测试签名 R8 SHA-256 为 `232C5C83804533E32831FEE930BE23D4D30B56C48B87423275A7AF0484FCEF81`；
> `formalSigning=0`、`spokenOutput=0`、`humanAudit=0`，外部发布阻断不变，Beta 仍为 `NO-GO`。
>
> 2026-07-20 权限生命周期三轮 Loop Engineer 闭环（上一已完成摘要）：真实 API 34 流程先发现并修复
> 引导前/拒绝后误建自动任务与误导空状态；独立 critic 随后发现系统设置撤权和 `FULL → PARTIAL`
> 仍会保留旧 Work/旧范围，以及自动上传链可能消费逐项导入候选。Activity 现于前台恢复时对账真实权限；
> 撤权会等待取消 `INITIAL/RECONCILIATION/DAILY/DAILY_PIPELINE`，但保留独立 `IMPORTED`；权限变化
> 使用专用 `RECONCILIATION + REPLACE` 链，旧 ScanWorker 仍以任务请求范围与当前授权的交集运行。
> 自动上传只取 `MEDIA_STORE`，Picker/分享上传只取显式导入，缺失或非法来源范围失败关闭；单进程
> 上传 Work 由进程级互斥串行消费 READY 候选，等待中或持锁时取消均传播，进程重启后仍可恢复。
> 该轮最终独立 critic 为 `PASS`。当时 Android 21 个 JVM 套件 73/73、API 34 设备测试 23/23，运行态
> 证明 `preConsentAnalysisWork=0`、`deniedAnalysisWork=0`、`revokedAutoWork=0`、
> `partialReconciliation=1`；应用/组件/320dp+2.0x/TalkBack 焦点/R8/Release 日志隐私全为 GO。
> 测试签名 R8 SHA-256 为 `E8701FE69616A089631211053A39C34264DED2F48A5346A9290A6435FB24E375`；
> `formalSigning=0`、`spokenOutput=0`、`humanAudit=0`，外部发布阻断不变，Beta 仍为 `NO-GO`。
>
> 2026-07-20 第 19–20 轮闭环（当前权威摘要）：生产 Fastify 日志改为只记录方法、代码定义的
> route template、状态码和受限错误类别，测试服务覆盖在非 `test` 环境失败关闭；HTTP 同候选重试
> 已证明只创建一个任务并预留一次最坏成本。Android 共享 OkHttpClient 明确关闭普通及 HTTPS
> 重定向，属性单测与源码护栏固定该边界；Release logcat 门禁曾真实捕获分享确认前
> `ContentResolver.getType` 泄漏完整 MediaStore URI，入口现不再做该预探测，修复后日志门禁通过。
> 删除云端数据的真实 PostgreSQL 测试逐表证明任务/上传会话、卡片、反馈、追踪、偏好、抑制记录和
> 删除回执级联归零，只保留不含设备标识的全局成本账本。当前后端 73/73 基础测试、12 个迁移及
> PostgreSQL 10/10/TCP E2E 为 GO；Android 17 个 JVM 套件 61/61、API 34 擦除数据后 20/20、
> 应用/组件/320dp+2.0x/TalkBack 焦点/R8/Release 日志隐私参考套件均为 GO。当前测试签名 R8
> SHA-256 为 `39A6B991AC1757444F46226B2362949356D94AC6AA88997F3AAEFB65AFD7343F`；
> `releaseLogPrivacy=1`、`formalSigning=0`、`spokenOutput=0`、`humanAudit=0`。Kimi SAFE_PACKET
> 已执行至硬上限第 20 轮，最新仍为 `NO-GO`；硬上限耗尽不代表产品完成。真实知识审核、授权图片、
> 托管 OSS/Qwen/PostgreSQL/HTTPS、不可变部署回执、正式签名、国产 OEM 七天矩阵、真人听读、
> 200 卡抽检及真实 cohort 仍缺失，因此 Beta 继续 `NO-GO`。

> 2026-07-20 第 18 轮闭环（优先于下文历史计数）：知识来源联网预检与活性检查改为逐跳手动重定向、
> 每跳只允许无凭据 HTTPS/443、解析全部 DNS 地址并拒绝任一私网/保留地址，再把已审查公网 IP 固定给
> TLS 请求且保留原 hostname/SNI；自测覆盖私网 DNS、私网重定向和 IPv6 回环绕过。Android 最终 JPEG
> 守卫现在无条件拒绝 APP0–APP15 与 COM；导入原图副本新增不依赖“暂停分析”状态的启动即清理及 12 小时
> 周期清理，强制停止只会延迟到系统或用户下次允许运行，卸载则由系统删除应用私有目录。当前冷构建的
> 16 个 JVM 套件共 60 项测试、API 34 擦除数据后的 20/20 instrumentation、应用/组件/320dp+2.0x/
> TalkBack 焦点与测试签名 R8 运行时参考套件全部通过；测试签名 Release SHA-256 为
> `1CE886F51409D69BE44BFD4BC6FF304EE454A6FBDE0AF12E85EE952E3EF505E3`，`formalSigning=0`。
> 后端可信基线仍为 70 项基础测试、12 个迁移、10 项 PostgreSQL 集成测试。上述是本地工程证据；
> 真实知识审核、授权图片、OSS/Qwen/HTTPS、不可变部署回执、正式签名、国产 OEM、真人听读、
> 200 卡抽检和 10–50 人 cohort 均未产生，结论保持 `NO-GO`。

> 2026-07-20 第 17 轮闭环（优先于下文历史计数）：目录联接下会静默跳过 CLI 的主入口判断已统一为
> canonical realpath，独立知识门禁与最终 Beta 门禁现在都能正确返回 `NO_GO/exit 1`。最终装配除八个
> 固定工件外，还签名绑定精确 catalog/backlog 字节和受保护审核人白名单摘要；知识门禁与生产服务统一
> 要求 approved 正文 28–80 字，并拒绝不在 `JIANWEI_KNOWLEDGE_REVIEWER_IDS` 的审核身份。部署回执
> 以实际放行时钟重新验证，历史 evidence 时间不能重放过期回执。后端限流改为稳定设备键并保留 429，
> 删除重试队列加入公平排序与有界退避，Qwen 禁止重定向。当前为 70 项基础测试、12 个迁移、10 项
> PostgreSQL 集成测试；Beta 自测拒绝 27 类绕过，装配器拒绝 21 类。真实内容、云、正式签名、OEM、
> 真人听读、授权图片和 cohort 仍缺失，结论保持 `NO-GO`。

> 2026-07-19 三方信任链闭环（优先于下文旧“双签”描述）：最终门禁要求
> `beta_deployment_attestor`、`beta_assembly_attestor`、`beta_release_approver` 三个互斥角色分别
> 使用不同 issuerId、keyId 和 Ed25519 SPKI 公钥指纹。QA 装配签名精确绑定批准清单字节和
> 八个工件的 SHA-256/长度，发布签名绑定确定性 schema v3 证据，部署签名绑定真实 endpoint、
> revision、后端身份和 OCI 摘要。仓库内公开策略不再自成信任根；正式门禁还要求其精确摘要
> 匹配受保护环境中的 `JIANWEI_EVIDENCE_TRUST_POLICY_SHA256`。负向回归拒绝角色合并、公钥
> 复用、错误外部策略摘要、缺失装配签名、工件/清单篡改和单发布审批人伪造；Beta 门禁现拒绝
> 26 类绕过，发布签名器拒绝 6 类，装配签名器拒绝 5 类，装配器仍拒绝 19 类，源码护栏为 GO。
> 本轮后端从成功补丁日志恢复后，Release SHA-256 精确回到
> `b763b7a42db5709f04f0918f04f6cc20ea5392091744b51d45348a79d2c57420`（40 文件），
> 68 项基础测试、11 个迁移和 10 项 PostgreSQL 事务/并发测试重新通过。

> 2026-07-19 端到端审计闭环：发布证据已升级为 schema v3，并绑定批准的八工件清单
> SHA-256 与部署回执/策略摘要。最终 readiness 命令会从仓库固定路径重读信任策略、
> 已批准清单和全部八个原始工件，重新验证部署 Ed25519 签名，在证据记录的时间点做
> 确定性重装配，并要求与发布审批者签名的证据完全一致。回归门禁明确拒绝“发布审批
> 签名有效、但独立装配验证缺失”的证据。这关闭了此前的 signer 绕过；真实外部 Beta
> 证据仍未产生，所以状态保持 `NO-GO`。

2026-07-19 最终本地工程基线（优先于下文历史计数）：Android 参考套件从当前源码完成 Debug、Release/R8、Lint、20/20 API 34 instrumentation、应用/组件/320dp/2x/TalkBack 焦点和测试签名 R8 烟测；JVM 计数为 domain 7、app 12、data 41。云发布可信链同时绑定后端 Release SHA-256（覆盖精确 `deploy/Dockerfile`）和实际 OCI `sha256:` 镜像摘要；正式门禁的信任策略固定从仓库根加载且拒绝命令行替换，云验证还必须消费由独立 `beta_deployment_attestor` 签名、绑定 endpoint/Function Compute revision/后端身份/ACR 摘要的部署回执，服务自身回显的环境变量不再构成发布证据。生产配置、`/health/ready`、受控云验证、卡片快照入口、最终装配与 Beta 门禁均失败关闭，部署前门禁拒绝可变镜像、摘要错配和未固定基础镜像。Beta 门禁现拒绝 24 类合成绕过，装配器拒绝 19 类；Ed25519 最终证据签名、11 个 PostgreSQL 迁移/10 项事务并发测试、过期令牌删号恢复、并发“太私人”原子删除、破坏性 UI 确认、ML Kit 位图释放和可重试扫描失败均已验证。真实知识审核、授权图片、权威部署回执/托管云、正式 APK 签名、国产 OEM、真人 TalkBack、200 卡抽检、10–50 人 cohort、正式信任策略及最终签名仍不存在，因此发布结论保持 `NO-GO`。

2026-07-19 最新可信基线（以下段落优先于文中较早计数）：最终 `beta-evidence.json` 现在只能先由装配器写成 `READY_FOR_ATTESTATION`，再由仓库外 Ed25519 私钥和仓库内固定公开策略产生可追责、最长七日的 `beta_release_approver` 签名；最终门禁验证精确证据字节、精确策略字节、签发者/密钥/角色/有效期，拒绝整体重算 SHA 的伪造 bundle。签名器、Beta 门禁和源码护栏自测均通过，Beta 门禁现覆盖 21 类绕过。后端仍为 66 项基础测试通过；隔离 PostgreSQL 17.10 已三次执行 11 个迁移并通过 10 项事务/并发测试及编译服务 TCP 闭环。新增第 11 个迁移与仓储事务保证四连接池并发“太私人”反馈只扣权重一次、返回同一回执，并在删除卡片/任务前原子持久化候选抑制和对象删除队列。真实信任策略、发布签名、知识审核、云、OEM、真人 TalkBack、授权图片和 cohort 证据仍缺失，因此结论保持 `NO-GO`。

云端与循环增量：项目已按 Loop Engineer 上游固定提交 vendoring evaluator-optimizer skill，真实退出条件固定为 `check-beta-readiness` 对真实证据返回 0；Kimi 审查具有 20 轮硬上限、32768 输出 token、50000 估算总 token、仅 SAFE_PACKET 和显式外发检查点。真实云端取证器现可在临时 OSS STS 下用两张明确授权的安全/敏感 JPEG 验证 HTTPS/Qwen、服务端敏感拒绝、对象上传后可观测且终态即时删除、禁用版本控制、一天生命周期和删号令牌失效；输出只含夹具摘要、公开版本和检查结果。容器构建会生成覆盖可部署源码、迁移和精确知识目录的 `release-identity.json`；生产环境拒绝缺失或不匹配的文件，健康端点公开其摘要，且部署配置禁止用环境变量覆盖。其故障注入测试已通过，但因未配置真实云账号/STS，当前仍没有云端发布证据。

持续审计增量：Beta 指标不再允许人工抄写汇总。应用导出的完整设备报告集现在由确定性 SHA-256、真人 cohort manifest 和七天观察窗口编译成 `betaProvenance`/`beta`；报告会从已安装 base APK 计算 SHA-256，且摘要计算转入 IO 线程，避免导出时阻塞主线程。遗漏用户、混用 App 版本或 APK、缩短观察期或 AI/bot 负责人都会失败关闭。最终门禁要求图片评测、卡片抽检、cohort、云端、所有实体机、TalkBack 与正式 APK 使用同一 App 版本；卡片、云端、cohort、OEM 和 TalkBack 还必须与正式 Release APK 使用同一 SHA-256，并要求图片/卡片/云端使用同一模型和知识目录版本。授权图片 runner 因只存在于 Debug，单独对清单、安装包与结果作同一 APK SHA-256 绑定。旧证据不能拼接到新包上。以上仍是门禁能力，不是 20–50 人真实 Beta 证据。

实体机、真人无障碍与最终证据装配增量：最终清单已删除直接手填 `deviceRuns` 和 TalkBack 结论的入口。华为、小米、OPPO/vivo 每台设备必须提交 App 脱敏报告和独立保留证据包，pending-only 运行清单固定二者 SHA-256，真人再确认权限、扫描、后台、七天离线组件和删除观察；编译器派生设备/App 身份并拒绝复用证据、模拟器、混版本、混 APK 和不完整矩阵。`zh-CN` TalkBack 审计也必须通过 pending-only 清单绑定同一 App 报告与独立听读证据包，拒绝 AI 身份、预确认和不完整结论，再与实体机矩阵的同一 `runId`、厂商、型号、指纹、API、App 版本和 APK SHA-256 交叉核验。最终 `beta-evidence.json` 禁止人工复制拼接：图片评测、卡片抽检、cohort、云验证、正式 APK、编译实体机矩阵和编译无障碍审计七个工件由真人装配清单固定原始字节 SHA-256；装配器复验解析值、云运行摘要、当前知识目录、跨组件版本和正式 Release APK 摘要，再以内存中的完整 Beta 门禁作唯一写出条件。实体机编译器 11 类、无障碍编译器 12 类、装配器 16 类绕过及路径/junction 逃逸均通过；装配器还要求卡片抽检、真实云和运行中服务使用同一后端 Release SHA-256，拒绝混用后端构建；当前真实工件不存在，因此没有生成或伪造发布证据。

授权图片真机执行增量：`image-results.json` 不再允许由人手工拼写。每张标签必须明确授权 `local_and_cloud_evaluation`；pending-only 运行清单只读取标签并固定其 SHA-256，不读取照片，同时固定将要安装的 Debug APK SHA-256。普通匿名设备每天 24、每月 300 的正式额度保持不变；真实评测由 PostgreSQL 签发最长 7 天、绑定精确标签摘要/300–500 个样本候选 ID/首台设备的短期租约，服务端把租约任务排除在该设备当前和后续普通请求的日/月计数之外，但仍执行全局数量与模型成本熔断，并在撤销、过期或删号后拒绝。租约 bearer 仅写入受控外部目录且不会进入结果、日志或 Release APK；租约 Header 与客户端接口已下沉至 Debug source set，Release DEX/Manifest 扫描确认四个评测标记均为 0。仅 Debug APK 含受控 Activity/Worker：主机和 App 会分别哈希已安装 base APK，并在运行前、恢复时和生成结果前拒绝与清单不同的构建。物理设备先把 300–500 张图片按内容摘要与标签盲匹配，真人在屏幕上核对数据集、模型和目录后输入可追责身份并确认真实 HTTPS 云评测；Worker 每次只处理一个样本，复用生产 ML Kit、清洗、最终字节复检和云客户端，将进度写入 App 私有目录并可跨杀进程恢复，输入在使用前和完成前再次哈希。最终结果记录真人批准、物理设备/API、公共 endpoint origin 和精确 Debug APK 摘要；编译器拒绝 AI/bot、模拟器、HTTP/私网、局部授权、输入变化、混 APK 和未完成运行。运行清单 5 类、编译器 11 类绕过及 Beta 门禁当前 20 类绕过自测、Android Debug 全量构建与 Lint 已通过；没有授权图片和真实云，所以仍未产生发布评测工件。

最新门禁增量：真人审核判为 rejected 的事实现在只能通过固定目录/事实摘要的替换清单进入修订，替换事实仍为 draft 且不能继承批准；200 张卡片抽检改为去身份 PostgreSQL 快照与独立真人审核按卡片 SHA-256 编译，负面结果不能被筛掉；卡片快照导出不再接受手填 App 版本、APK 摘要、模型、目录或后端构建身份：App/APK 从正式 Release 工件派生，模型/目录/后端 Release SHA-256 从已验证云工件派生；真实云验证同样从正式 Release 工件和本地源码重算身份。最终 Beta 判定会直接执行当前知识就绪检查，并要求固定公开证书指纹的正式非 Debug APK 及实体机 `zh-CN` 真人 TalkBack 听读证据。正式 APK 验证器同时检查单一 v2 签名、包名、minSdk 26、targetSdk 36 和 APK 摘要，现有测试签名烟测包会被负控制拒绝。以上均为门禁实现，不是发布证据，当前结论仍为 `NO-GO`。

人工审核执行增量：新增仅监听 `127.0.0.1` 的真人知识审核工作台，当前 Beta.62 的真实 624 条队列预检可安全选出首批 20 条且全部保持 `pending`。工作台使用一次性浏览器入口、HttpOnly SameSite Cookie、同源 CSRF、Host/Origin 校验、CSP、128 KiB 请求上限、受控输出目录、不可变 SHA 修订和乐观并发；来源由浏览器直开，服务端不代理，点击链接不会自动勾选。真人完成检查点只会一次性写出与现有原子应用器兼容的批次，不会直接改目录。对抗自测覆盖路径/junction 逃逸、AI 审核身份、预确认、修订篡改、旧标签页覆盖和无真人确认完成，并已纳入 CI 与源码护栏。这降低了 624 条人工审核的执行摩擦，但没有替代真人语义判断，也没有产生任何发布签注。

当前版本已形成可构建、可在 Android 14 参考模拟器运行的工程 Alpha：相册扫描、端侧隐私过滤、精确上传字节复检、临时云识别、审核事实匹配、Room 缓存、Glance 小组件、反馈、离线优先物品提醒和隐私删除闭环均已连接。

关键安全边界包括：Android 14 逐 URI 权限复核与每 64 KiB 在途上传重验；JPEG 全新编码、APP/COM 结构清洗和元数据段守卫；净化字节 SHA-256 在最终隐私检查、申请上传、上传完成三个边界保持一致；分享入口严格限制 `image/*`、`content://`、1–20 个去重 URI，并要求应用内二次确认且告知异常时最多保留 24 小时；物品提醒必须由用户确认启用日期和周期后才请求通知权限，拒绝时不创建任务，授权后本地 WorkManager 先落盘、Room outbox 后同步云端，分析暂停或无网络不影响已建立的本地提醒；单图 25 MiB/单批 100 MiB 上限；客户端只接受 API 同源的 `/v1/analysis-jobs/{UUID}/image`，不接受 OSS 或任意第三方直传目标；服务端以 10 分钟上传会话原子消费每个 PUT，并用处理租约阻止并发/过期工作者覆盖结果；Function Compute 每次调用都必须提供完整临时 STS 凭证，暖实例通过内存凭证源轮换且不记录凭证；Qwen、OSS、Android、Function Compute 与处理租约的超时顺序由可执行门禁约束；服务端不信任客户端的空敏感标记，会通过固定视觉提供方二次检查人脸、证件、银行卡、票据、文档、截图和高文字密度内容；服务端随机令牌、每设备及全局日/月硬上限和候选幂等；卡片正文固定为已审核事实原文，模型只能生成受约束标题并回传 fact/source allowlist；反馈和提醒 outbox 都只在服务端成功确认后移除；OpenAPI、Fastify 路由和 Retrofit DTO/路径由可执行契约门禁锁定；处理后删除与 OSS 生命周期启动门禁；“太私人”会删除并写入本次安装的候选抑制墓碑，同时取消提醒和待同步记录；HTTP 410 不重试，429 会在应用内保留可见状态；Keystore 加密安装身份与 401 单次恢复；真人事实审核签注。

当前验证基线：后端类型检查、构建及 66 项基础测试通过，生产依赖联网审计为 0 已知漏洞；刚编译的 `dist/index.js` 已分别用内存仓储和真实 PostgreSQL 17.10 在随机回环端口通过 TCP 产品闭环，覆盖健康检查、认证、上传前敏感拒绝、一次性上传与重放拒绝、识别完成、终态幂等、卡片同步、反馈、主动追踪、幂等取消追踪、未知物件不出卡、设备删除、旧令牌失效和临时对象归零；独立 PostgreSQL 17.10 三次走完 10 个迁移（含应用启动迁移）并通过 9 项事务/并发测试；第 10 个迁移把运行中后端 Release SHA-256 写入每张新卡，未带构建身份的旧卡不能进入发布抽检；Qwen 当前官方快照、Chat Completions 视觉输入、结构化输出与内容安全 Header 已复核，生产还必须显式提供北京工作空间端点，运行时拒绝 HTTP、海外/非官方域名、userinfo、query 和任意路径；Android 7 项领域测试、12 项应用 JVM 测试、40 项数据 Debug JVM 测试和 18 项 Android 14 instrumentation 测试通过。真实 MediaStore 设备用例发布 503 条测试媒体，证明首轮 501 条硬截断为 500、无变化不重复入队、新增与标准内容编辑进入增量队列，以及部分授权不会因旧授权游标漏掉后来可见照片；增量 WHERE 已改为 Android 14 MediaProvider 接受的基础列比较，且只有撤权 `SecurityException` 才能返回正常空结果。Room 6→7 提醒状态迁移、同步后持久可见状态、取消队列和陈旧回执竞态均被设备测试验证；Lint 0 error，Debug 与 R8 Release 可构建。Gradle Wrapper 分发包和 wrapper JAR 有固定官方 SHA-256，Android 全依赖图含 707 个校验组件、1260 条 SHA-256 与 785 条锁记录，完整测试/Lint/Debug/Release 图已在严格离线模式通过；pnpm 锁含 280 个完整性记录。API 契约门禁覆盖 13 个服务端操作、8 个 Retrofit 操作、1 个原始上传操作和 9 组 DTO。授权图片评测使用数据库短期租约保持普通设备日/月额度不变；租约绑定 300–500 个授权样本和首台匿名设备，仍受全局数量/成本熔断、过期、撤销与删号失效约束。授权图片评测现采用独立的人类标签与真实管线结果工件，通过图片 SHA-256、数据集/运行/应用/模型/目录版本绑定后才能编译；门禁要求每张样本完整执行，覆盖八类敏感内容和至少 25 个识别主题，拒绝用未执行样本伪装“未漏传”或用单主题刷高 Top-1，评测编译器与 Beta 门禁连续三轮自测均通过且明确 `releaseEvidence=0`。参考套件每次先从当前源码重建 Debug APK，避免旧产物造成假绿；APK 烟测覆盖引导、拒绝/完整/部分权限、真实 MediaStore 分享确认、本地内测报告导出、提醒通知权限延迟申请、拒绝不落任务，以及授权后无后端仍可落本地任务、持续显示提醒、更新周期、确认取消和写入版本化同步 outbox，并校验同一物件始终只有一个有效任务；锁屏公开通知使用不含物件名的通用文案；320dp/2.0 倍字体流程、真实 Google TalkBack 服务绑定与键盘焦点遍历、Pixel Launcher 原生 Pin Widget 预览/绑定/缓存卡渲染均通过。不可调试 R8 产物单独使用隔离测试签名验证 UI/组件运行，不等于正式签名；TalkBack 自动化没有验证语音质量或真人听读。外部 Kimi `SAFE_PACKET` 审查实际完成 16 轮；之后的上传会话、处理租约、主题偏好、STS/OSS 版本门禁、同源上传、完整离线提醒生命周期、MediaStore 增量修复和授权评测证据加固属于本地持续审查，不计作新的外部轮次。结论仍因外部证据缺失保持 `NO-GO`。

Beta 仍不放行：生产知识目录 `2026-07-19-beta.62` 已结构化覆盖全部 200 个受控主题，共 624 条事实（613 draft、11 状态 approved）且 0 条有真人审核签注。本轮新增摩托车后视镜、后视镜、道路标志、减速带和雨刮器，每个主题一次建立 3 条镜面安装与视野、路牌视觉编码与逆反射、减速设施几何与预警、雨刷覆盖与洗涤性能事实；15 条均标记为 `safety`，每条绑定至少两个 `official` 来源并保持 `draft`，未写入驾驶、维修或事故处置建议。受控分类账现为 200 seeded + 0 proposed，主题数量和每主题 3–5 条事实的结构门槛已补齐；但全部 624 条事实仍需真人逐条核验，当前 0 个主题具备发布资格。静态门禁确认 531 个唯一公共 HTTPS 来源均被引用且元数据完整；当前 shell 的全量联网检查对 49 个主机统一触发公共 IP 安全解析失败，记录为 `infrastructureFailure=1`、`canonicalUpdated=0`，正式实时证据为空，审核队列为 `sourceEvidence=0`。该结果不能被解释成 531 个来源失效，历史可达记录也不能冒充当前证据；必须在可完成安全解析的网络环境重跑。候选来源预检工具有离线失败关闭自测并纳入 CI 与源码护栏。只读人工审核队列已按健康、安全、一般风险排序全部 200 个主题的 624 条事实，当前不附带实时可达证据且明确不授予批准权限；Beta.62 的首批 20 条待审模板默认全部 `pending`，审核应用器固定目录/事实 SHA-256、拒绝过期快照与 AI 审核身份、要求逐来源确认并整批原子落库，旧单事实直写入口已关闭。新主题批量导入、已有主题最小扩展与草稿纠错均支持无写预演、路径/符号链接逃逸拒绝和失败关闭自测，并已纳入 CI 与源码护栏。授权评测集、国产 OEM 实体机、真实 OSS/Qwen/HTTPS 部署、正式签名、真人 TalkBack 听读、624 条事实语义审核、200 张卡片抽检和 10–50 人 Beta 数据均未完成。完整门槛与证据格式见 `COMPLETION_AUDIT.md` 和 `BETA_EVIDENCE_RUNBOOK.md`。
> 2026-07-19 final provenance hardening: the deterministic Beta assembly now binds eight retained
> artifacts, including the exact signed deployment receipt. Assembly reloads the repository-pinned
> policy, re-verifies the Ed25519 signature, and cross-binds endpoint, Function Compute revision,
> OCI digest and backend Release identity. A regression test rejects a forged but internally
> self-consistent cloud artifact without the deployment-attestor private key. This closes the final
> P1 from the second independent adversarial audit; it does not turn the current external-evidence
> state into GO.
