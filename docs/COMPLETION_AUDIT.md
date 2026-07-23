# 见微完成度审计

2026-07-23 首次体验产品化（当前最新权威摘要）：三屏 onboarding 不再是权限说明表单。第一屏用完整知识卡结构预告“来自你的照片、事实有来源、包含识别把握/推荐原因/来源”；第二屏用三步流程解释本机隐私筛选、1280px/去 EXIF 的少量候选上传和“可靠命中才生成”；第三屏以可选择卡片呈现 3 项兴趣，并把自动发现与仅选择照片的权限差异拆成两个明确入口。页面增加 1/3 进度、可见返回操作和系统返回拦截。API 34 标准宽度逐屏实跑通过；精确 320dp/2× 字体下兴趣项由两列回流为单列，两个入口和返回上一步均可滚动到达。首次窄屏实跑发现第二屏滚到底后第三屏继承旧滚动位置，现以页面切换 `scrollTo(0)` 修复，复验第三屏标题与首个兴趣从顶部出现。最终 picker-only 路径进入 Android 系统照片选择器（`com.google.android.providers.media.module`），取消后持久化 3 项兴趣和 `completed=true`，回到“照片权限：仅手动选择 / 先选择一张照片”首页；清空日志后冷启动的 App crash buffer 为空。`.tooling/onboarding-experience-audit/audit.json` 为 `GO`、`releaseEvidence=false`，SHA-256 `0cbaec57684a272a0611a67964f1fd18e23d089ee88b2996a1a73d9af3471c26`。完整回归为 31 个 JVM 套件 120/120、API 34 instrumentation 46/46（App 2/2、Data 44/44），App Debug/Release Lint 0 error（32/8 warning），Debug 与 R8 Release 成功；Debug/未签名 Release/App/Data instrumentation APK SHA-256 分别为 `43331e8044c5f400c5bed6c6b2b198ef7f121dc914646667cdc24f1459e3911d`、`1634491b9f53276316d37603bcfd63c1b753a5c91286d2023ca3b00e37a3ce97`、`65bd9531b986cd614a56a8f7dae005e632c0428fc05c474ed6760b91eea339e4`、`77e33064877ccee59f42e048d7db0b211e9d4a63afad81838c4c7a93eb916048`。测试包已卸载，1080×2400/420dpi/1.0 字体设置已恢复，模拟器与 ADB 已停止。该证据只提升本地首次体验，不替代真人内容审核、真实云、正式签名、国产 OEM、真人 TalkBack、200 卡抽检或 10–50 人 cohort，发布结论保持 `NO_GO`。

2026-07-23 桌面组件产品化呈现（当前最新权威摘要）：Glance 2×2/4×2 已与 App 主卡统一品牌色、照片优先级和知识阅读层级；2×2 使用更大的照片区域，4×2 使用全高照片、对象/把握、正文、来源和底部“换一条”控制。domain 新增组件专用 `compactLabel`，保留对象语义但不重复低置信度标题中的对象名；App 继续使用完整可见标签和精确无障碍语义。API 34 Pixel Launcher 实际完成系统 Pin Widget、2×2 展示、拖拽到 4×2、两次换卡和组件精准回卡。第一次实跑发现固定 104dp 照片导致底部空洞，第二次发现右栏包裹内容导致换卡控制悬空，均在真实布局中修正为全高照片与底部锚定。最终低置信度牙刷卡显示“把握较低”而不重复“牙刷”，App 回卡仍显示“识别对象可能是牙刷，识别置信度 68%”；清空日志后再次回卡的 App crash buffer 为空。`.tooling/widget-experience-audit/audit.json` 为 `GO`、`releaseEvidence=false`，SHA-256 为 `35bb0ee19d22c2f45377cdc8a2ea41680a42efbbea65b6f29250732021efabd2`；测试包经重启确认已卸载，组件绑定与夹具数据不存在，模拟器和 ADB 已停止。完整回归为 Android 31 个 JVM 套件 119/119、API 34 instrumentation 46/46（App 2/2、Data 44/44），App Debug/Release Lint 0 error（32/8 warning），Debug 与 R8 Release 构建成功。Debug/未签名 Release/App/Data instrumentation APK SHA-256 分别为 `a16cbb12160ff98f8cabdd8b46cf0eb1e89d03258bed166c6723e1b4b55a2bf8`、`39f0743c9f70c519399df7bbbf4b318177e3986cf76c96f27c9caecffde94fe4`、`65bd9531b986cd614a56a8f7dae005e632c0428fc05c474ed6760b91eea339e4`、`77e33064877ccee59f42e048d7db0b211e9d4a63afad81838c4c7a93eb916048`。该审计只证明本地产品体验与工程闭环，真人内容审核、真实云、正式签名、国产 OEM、真人 TalkBack、200 卡抽检和 10–50 人 cohort 阻断不变，发布结论保持 `NO_GO`。

2026-07-23 知识卡产品化呈现（当前最新权威摘要）：首页主卡不再把识别、来源、收藏、反馈、提醒和隐私动作平铺成长表单。当前层级固定为照片 → “今日识物”标题 → 识别把握 → 核心知识 → “为什么是这张照片”与可点击来源 → 收藏/物品提醒 → 推荐反馈 → 本次安装不再分析；收藏状态有独立可见标记。引导页增加品牌副标题和三段进度轨，颜色系统补齐容器、正文、轮廓与对比色。收藏/提醒在常规宽度并排，在 `<340dp` 或字体倍率 `>=1.5` 时纵向回流，纯策略测试及源码门禁防止回归。API 34 实际运行验证标准宽度首屏层级、第三屏引导，以及精确 320dp/2.0 倍字体下的纵向主操作、四类反馈和隐私动作均可达；临时 `visual-audit-card` 已删除，显示设置已恢复，crash buffer 为空。`.tooling/card-experience-audit/audit.json` 为 `GO` 且明确 `releaseEvidence=false`，SHA-256 为 `3ffeb2a17fcea8ba1fd00e7cad3ec3c0d4ecda3d7c3bd759d5a24fe0c5f45192`。Android 31 个 JVM 套件 119/119，Debug/Release Lint 0 error（32/8 warning），Debug 与 R8 Release 构建成功；APK SHA-256 为 `A7BF5D93AD8C218D101E31C87B78D40F6C0899ABADC0FC8214E5D9DEEB1B5AFB` / `1774C9CDF153F39208F10196778260BADBFD2F20C6B6D31090C27A4B2A882839`。本轮没有把模拟器夹具当作真实内容或发布证据，真人审核、真实云、正式签名、国产 OEM 与 cohort 阻断不变，发布结论保持 `NO_GO`。

2026-07-23 PostgreSQL 迁移 13 真实执行（当前最新权威摘要）：新增 `scripts/run-postgres-integration-macos.sh`，使用 PostgreSQL 17.10 (Homebrew) 在随机回环端口初始化隔离集群，不注册常驻服务。首次迁移应用 001–013，第二次迁移确认 schema current，编译服务启动再执行迁移；13/13 仓储/升级测试通过。迁移 13 专用测试在模拟旧表中执行真实 SQL，确认旧卡片由 title 回填对象名、空白对象名被长度约束拒绝，仓储读回独立 `detectedObjectName`；编译 Fastify 的 PostgreSQL TCP 闭环也验证认证、敏感拒绝、一次性上传、分析、卡片、反馈、追踪、未知物件、删除和对象归零。最终 `pg_ctl status` 为 no server running。后端 98/98 基础测试、check/build、源码护栏通过。`.tooling/postgres-integration-results-macos/` 和 `.tooling/backend-e2e-postgres/` 是本地工程证据，不代表托管 PostgreSQL 或真实 OSS/Qwen/HTTPS；发布结论保持 `NO_GO`。

状态解释：下文仍保留各时间点的历史摘要；其中“PostgreSQL 测试 skipped / 迁移 13 未真实执行”已被本段 13/13 真实数据库证据取代。

2026-07-23 真实照片到桌面组件闭环（当前最新权威摘要）：在 API 34 上通过 Android 系统 Photo Picker 真实导入 CC0 自行车图片，没有授予全量相册权限，也没有注入标签或直接写卡。bundled ML Kit 输出 `Vehicle/Bicycle/Wheel/Tire/Metal`，质量分 0.7614，敏感标记为空；客户端生成 1280×960、无可见 EXIF/GPS/设备字段的 JPEG，通过同源临时上传会话进入本地 Fastify，按端侧标签匹配已存在的 `bicycle-001`，写入 Room 后在 App 和 Pixel Launcher 2×2 Glance 组件正确展示，组件点击准确回到该卡，临时服务端对象清零。首次 App 展示暴露 `Canvas: trying to use a recycled bitmap`；根因是旧 `DisposableEffect` 闭包在 Compose 状态切换时回收刚发布的新位图，现以不可变 `displayBitmap` 捕获修复，并增加设备级生命周期回归和源码守卫。修复后完整回归为 JVM 118/118、API 34 instrumentation 46/46（App 2/2、Data 44/44），App/Data Lint 0 error（32/20 warning），R8 Release 成功。Debug/未签名 Release/App instrumentation SHA-256 为 `C3E79661172D1BFEA10D6D1069B11C44DB149C0D3AFE676CC42E8254FA180F34`、`4486251A2103038463F5010601A822BF4B4125102DEF9699A4717688439178E4`、`65BD9531B986CD614A56A8F7DAE005E632C0428FC05C474ED6760B91EEA339E4`。`.tooling/photo-to-card-e2e/audit.json` 明确 `releaseEvidence=false`，所以该结果只放行本地工程闭环；真实 PostgreSQL/OSS/Qwen/HTTPS、真人内容审核、正式签名、国产 OEM、真人 TalkBack、200 卡抽检和 10–50 人 cohort 仍缺失，发布结论保持 `NO_GO`。

2026-07-23 识别信息去重与用户化置信度复核（当前最新权威摘要）：API 34 视觉审计确认旧卡片连续显示“这可能是牙刷”“识别对象：可能是牙刷”“68%”，在 App 与 2×2 组件中重复且偏工程化。当前纯 Kotlin 领域策略统一产生可见标签与无障碍标签：低置信度标题已携带对象时只显示“识别把握较低”，标题未携带对象时才补“可能是牙刷 · 把握较低”；0.72–0.89 显示中等、0.90 起显示较高，非法置信度失败关闭为低。App 无障碍树仍精确包含“识别对象可能是牙刷，识别置信度 68%”。Pixel Launcher 实测 App、2×2 组件和组件精准回卡均无重复对象名，crash buffer 为空。完整回归为 31 个 JVM 套件 118/118、API 34 设备测试 45/45，App/Data Lint 0 error（32/20 warning），R8 Release 成功。Debug/未签名 Release SHA-256 为 `6E978F2A0AF60148254DF1A53403E6B69959FACC933BA8C3A54BEC36D4F5BF59`、`CB8F938A0BC90B4E7430A4129F67200B1A8289E955B842367104CF59E6200FBD`。证据包明确 `releaseEvidence=false`，发布结论仍为 `NO_GO`。

2026-07-23 显式识别对象与不确定性闭环（当前最新权威摘要）：卡片不再用生成标题代替识别结果，`detectedObjectName` 已从视觉结果贯穿后端领域对象、OpenAPI、PostgreSQL 迁移 13、Room 9、Compose 与 Glance。服务端与 Android 领域层都以 0.72 为不确定阈值，低置信度必须显示“这可能是……”和“识别对象：可能是……”，模型不能绕过。后端 check/build、98/98 基础测试通过；12 项 PostgreSQL 集成测试在本机显式 skipped，迁移 13 尚无本轮真实数据库执行证据。Android 31 个 JVM 套件 115/115、API 34 设备测试 45/45，含 Room 8→9；App/Data Lint 0 error（32/20 warning），R8 Release 成功。API 34 还实测 App、2×2 Pixel Launcher 组件及精准回卡，证据包明确 `releaseEvidence=false`。Debug/未签名 Release SHA-256 为 `E837E5771F81AC3ACC189D9302E40871DECC86CDF503BE39D22EDFAFCA5AB0FD`、`05900CD3CD449B0AD6F90AC6023DEBDF0975A1109C780D626E59D3C8A1AF41C4`。正式签名、真人内容审核、真实云、国产 OEM、真人 TalkBack、200 卡抽检和 10–50 人 cohort 仍缺失，发布结论保持 `NO_GO`。

2026-07-23 每日卡与真实桌面组件闭环（最新权威摘要）：App 普通每日页只展示今天及历史卡，未来 7 天离线缓存不会提前进入内容流；组件点击指定卡时才允许该卡作为首项显示。4×2 Pixel Launcher 组件仅使用当前卡和最多两张未来卡，历史卡不进入换卡池，到末尾不循环。组件现在直接观察 DataStore 状态流，修复了 Glance 活跃会话边界上“第二次状态已提交但 RemoteViews 未重绘”的真实问题。API 34 实际完成组件添加、2×2→4×2 缩放、今日→明日→后日两次换卡、终态按钮消失和点击准确聚焦后日卡；每次换卡 3 秒内在 hierarchy 可见，crash buffer 为空。完整回归为 30 个 JVM 套件 112/112、API 34 设备测试 44/44，App/Data Lint 0 error（32/20 warning），Debug 与 R8 Release 成功；源码、API 合约和供应链门禁 GO。Debug/未签名 Release SHA-256 为 `DA5A2870592E98BC327F74EC17892A8F24CB39E2ACA2132329FC3C186C996421`、`0CB9C3EEC44CE374D5F706147AA8BC5C658F1482F86E996F058B81BB473A0F9B`。正式签名、真人内容审核、真实云、OEM、真人 TalkBack、卡片抽检和 cohort 仍缺失，发布结论保持 `NO_GO`。

2026-07-23 首卡状态与缓存耗尽复核（上一已完成摘要）：扫描、端侧筛选、知识同步、有卡、无匹配、自动重试和最终失败现为持久化结构化状态，不再依赖易丢失字符串。持久层只保存阶段、聚合计数和用户安全文案；API 34 证明 Repository 重建后状态一致且没有照片 ID、标签或文件名。首页针对各终态显示选择/恢复/重试动作；组件未来卡日期耗尽时继续展示最后一张卡并明确提示缓存已用完。源码门禁新增 `truthfulAnalysisState=1 widgetCacheExhaustion=1`。完整回归为 28 个 JVM 套件 105/105、设备测试 44/44，App/Data Lint 0 error（32/20 warning），R8 Release 成功。Debug/未签名 Release SHA-256 为 `F988110BE57063570CDFD026D169DA70C8ECF6941DCF7A87A7D576D4D99EA609`、`3052AC11BEB911FB0B4E4CF89083D669ED90921F9596EB3EB3BD86C14BDA36C6`。

2026-07-23 OCR 敏感信息复核（最新权威摘要）：身份证号和银行卡号现在先做 NFKC，再折叠全空白及
有限的常见分隔符，覆盖全角、连字符、分组卡号和身份证版式标记；日期+手机号负例不误判。API 34
使用 bundled ML Kit 对生成的最终 JPEG 字节真实 OCR，确认分组银行卡号进入 `bank_card`，与上传前
`analyzeBytes` 路径一致。源码门禁输出 `ocrSensitiveNormalization=1`。完整回归为 27 个 JVM 套件
100/100、设备测试 43/43，App/Data Lint 0 error（32/20 warning），R8 Release 成功。Debug/未签名
Release SHA-256 为 `9BE969A2F9AFDF2D85233D0EBCE6A5F4BA49C0D224FF3BB1B58F58A04D149840`、
`A9930CD5A1A6B185D107D90AD30E1D2037977DE34984337DCD8F748CC0E404D1`。

2026-07-23 MediaStore 90 天边界复核（最新权威摘要）：此前 `DATE_TAKEN` 为空或 0 的媒体会无条件
通过查询，可能把历史下载图或迁移图纳入自动发现。现在有效拍摄时间优先且必须在请求窗口；缺失拍摄
时间时才回退到 `DATE_ADDED/DATE_MODIFIED`，回退值也必须在窗口内。API 34 真实 MediaProvider 以
新旧拍摄时间和新旧媒体时间四种交叉组合验证，旧无拍摄时间媒体被排除，近期媒体不漏；源码门禁固定
`mediaStoreRecencyBoundary=1`。最新完整回归为 27 个 JVM 套件 100/100、设备测试 43/43，App/Data Lint
0 error（32/20 warning），R8 Release 成功。Debug/未签名 Release SHA-256 为
`9BE969A2F9AFDF2D85233D0EBCE6A5F4BA49C0D224FF3BB1B58F58A04D149840`、
`A9930CD5A1A6B185D107D90AD30E1D2037977DE34984337DCD8F748CC0E404D1`。

2026-07-23 Android 产品界面层级复核（最新权威摘要）：API 34 视觉审计发现旧首页把桌面组件推广放在
知识卡之前且在收藏页重复，隐私/删除/导出等管理操作也长期展开占据主内容流。当前每日页先展示知识卡，
四项反馈与提醒入口可在首屏触达；紧凑组件 CTA 只跟在第一张每日卡之后，收藏页不出现；照片与云端管理
默认折叠为“你的数据与隐私”，展开后原六项能力完整可达。空每日、空收藏、每日卡、收藏卡与展开隐私
均在 1080×2400 API 34 模拟器以截图和 accessibility hierarchy 验证。追加 320dp/2× 字体实跑发现
横排 CTA 会把标题挤成逐字换行，现按宽度/字体倍率切换纵排；标准宽度仍为紧凑横排。按钮完整命名为
“添加桌面组件”且实测进入 Pixel Launcher Pin Widget；每日/收藏页签会暴露正确的语义选中状态。
320dp/2× 下每日可见标签压缩为单行“每日”，无障碍名称仍为完整“每日卡片”；411dp/1× 继续显示完整标签。
“仅选择照片”在用户选定模式时即完成引导，Photo Picker 空结果只表示本次未导入；API 34、320dp/2×
实跑确认取消后返回“仅手动选择”首页、`completed=true`，五类照片分析任务计数为 0，崩溃缓冲为空。

当前证据：Android 27 个 JVM 套件 100/100、API 34 43/43；App/Data Lint 均 0 error（32/20 warning），
Debug 与 R8 Release 构建通过，源码、API 契约和供应链门禁 GO。Debug、未签名 Release SHA-256 分别为
`9BE969A2F9AFDF2D85233D0EBCE6A5F4BA49C0D224FF3BB1B58F58A04D149840`、
`A9930CD5A1A6B185D107D90AD30E1D2037977DE34984337DCD8F748CC0E404D1`。正式签名、真人内容审核、
真实云、OEM、真人 TalkBack 听读、卡片抽检和 cohort 仍未提供，发布结论保持 `NO-GO`。

2026-07-22 本地收藏与 TOO_PRIVATE 崩溃原子性复核（最新权威摘要）：本地收藏 UI、Room 状态、一次性
SAVE 偏好和 Room 7→8 迁移已落地。取消、重启、服务端刷新和再次收藏均不重复 SAVE；云端删除会清空
收藏。第一次 critic 为 `REVISE`，发现隐私操作后可能残留 SAVE；第二次最终 critic 仍为 `REVISE`，
发现 TOO_PRIVATE 屏障与本地删除不在同一事务。当前首个本地写操作就是单一 Room 事务，原子完成
TOO_PRIVATE outbox、候选 `NEVER_ANALYZE`、照片抑制、提醒/普通反馈清理、卡片删除和收藏级联删除。
事务后立即模拟崩溃并重启的 API 34 回归通过；两次 critic 上限已用尽，没有宣称未发生的第三次 PASS。

当前证据：Android 26 个 JVM 套件 91/91、API 34 41/41；Debug UI 验证 `收藏 1`、强停重启保留，以及
点击 TOO_PRIVATE 后 `cards=0`、`saved=0`、唯一 outbox 为 TOO_PRIVATE、照片为 `NEVER_ANALYZE`、
`suppressed=1`、crash buffer 为空。Lint 0 error（32 warning），Debug、R8 Release 和不可调试 R8 API 34
冷启动通过。Debug、未签名 Release、测试签名 R8 SHA-256 分别为
`27689F5AAD914292DEDD33A159E0E0D739797EEA4AA5316CF05367C247C184D2`、
`A4CDE4BDEE18626238CF24E9344542D5856AA1CF6DC7868DFAA516CC9E1DF490`、
`DCDA1B76C36A7D88DF4EAE9042C94AD85FA7C36F08CFFC05F72DAD4C38485420`；测试签名不等于正式签名。
知识、人审、真实云、不可变容器摘要、OEM/真人听读、cohort 与 Beta 证据仍缺失，发布结论保持 `NO-GO`。

2026-07-21 卡片来源安全与分页原子性 Loop Engineer 复核（最新权威摘要）：原详情字段链路完整，但来源
URL 只做通用格式校验，Android 会持久化并直接打开任意 URI；同步还会逐页写 Room，导致后续页失败时旧
缓存被部分覆盖。当前目录、Android 同步、旧 Room 读取和最终点击均只放行无凭据、默认端口、公共主机名
的 HTTPS 链接，并拒绝深链、本机/内网名称和直接 IP；所有分页必须先通过来源、游标、页数与重复 ID 校验，
随后才单次落库。第二页恶意来源不改旧缓存、合法 HTTPS 正常保存、旧恶意 Room 数据不崩溃三项 API 34
回归均通过。OpenAPI 中误嵌套的 `Source/Card/ErrorResponse` 也已恢复为顶层 schema，并约束来源为 1–3 个。
第一次 critic 为 `REVISE`，第二次最终为 `GO`。后端 94 项基础测试、check/build、TCP E2E 和 API 契约通过；
Android 26 个 JVM 套件 91/91、API 34 37/37、完整参考套件 GO；测试签名 R8 SHA-256 为
`533B7F68C583A72CE907446DE3CDAE8DAE2772A0EAFFA6281A039AEF0FB1FE70`。真实知识审核、正式签名、
真实云、OEM、真人听读、卡片抽检和 cohort 仍未出现，Beta 保持 `NO-GO`。

2026-07-21 小组件中国自然日自动刷新 Loop Engineer 复核（最新权威摘要）：旧 24 小时 Work 以首次
进程启动时刻为锚点，可能让午夜后的当天卡延迟近一整天。当前按 `Asia/Shanghai` 00:05 为未来 7 个
自然日分别建立持久 OneTimeWork，执行后继续补齐窗口；刷新只读本地 Room，不依赖网络，系统组件
24 小时更新保留为第二兜底。最后一次 critic 为 `REVISE`：最初的立即任务 `REPLACE` 会与唤醒进程的
同名任务竞争；修复后立即与日历任务均为 `KEEP`，重复调度保持所有未完成 Work ID，源码守卫禁止回归。
达到两次 critic 上限后没有伪造第三次 PASS。策略测试覆盖午夜前后、固定时区、队列上限和冲突策略；
API 34 真实 WorkManager 验证 7 个独立日期及重复调度 ID 不变。Android 25 个 JVM 套件 88/88、API 34
设备测试 34/34，完整参考套件 GO；测试签名 R8 SHA-256 为
`740978BD7F3C45C4C86EC00F2A6AE2F9FA2ED312AAD4641EA1FAFDEFE82CB313`。正式签名、真人内容审核、
真实云、OEM、真人听读和 cohort 未出现，Beta 保持 `NO-GO`。

2026-07-20 未来七天卡片连续排期 Loop Engineer 复核（最新权威摘要）：旧实现把最多 100 张历史卡的
数量当作新卡排期偏移，导致老用户未来缓存断档，并在上限后产生同日碰撞。当前由任务完成/写卡事务选择
中国日历今天起第一个空日期，PostgreSQL 每设备 advisory lock 串行化跨实例并发；删除未来卡后下次优先
补最早缺口。真实数据库首轮失败还证明旧 `String(date).slice(0, 10)` 会把 PostgreSQL `date` 下发为
`Mon Jul 20`，当前严格归一化为 ISO 日期。四连接池 32 路并发生成连续唯一日期，缺口回填通过；独立
critic 最终为 `PASS`。后端 76/76、PostgreSQL 17.10 12/12/TCP E2E，源码门禁
`contiguousCardSchedule=1`。Android 未改，24 个 JVM 套件 83/83、API 34 33/33 与完整参考套件证据
继续有效。正式签名、真人内容审核、真实云、OEM、真人听读及 cohort 未出现，Beta 保持 `NO-GO`。

2026-07-20 小组件原子换卡配额 Loop Engineer 复核（最新权威摘要）：组件渲染与手动换卡统一进入
DataStore 事务状态机，进程级互斥串行化多个组件实例、快速点击和刷新；每天最多两次换卡，旧偏好迁移、
进程重建、同日卡片移除和跨日重置均有回归。最终独立 critic 返回 `REVISE`，指出迟到的前一天回调可在
午夜后倒退日期并重新放开额度；修复后状态日期只能单调向前，旧日刷新和点击都不能改写或消费新日状态。
JVM 用 32 次点击与 32 次刷新并发验证恰好两次提交，API 34 使用真实 DataStore 文件验证迁移、重建、跨日
和旧日交错。达到两次 critic 硬上限后没有伪造额外 PASS。后端 73/73、PostgreSQL 17.10 11/11/TCP E2E；
Android 24 个 JVM 套件 83/83、API 34 设备测试 33/33，完整参考套件 GO。测试签名 R8 SHA-256 为
`72E21772FCFAAFD7632A1460D32BC89EC71EE9F2F7AEB027CA0992D9E3D522E6`。`formalSigning=0`、真人听读和
外部 Beta 证据仍为 0，结论保持 `NO-GO`。

2026-07-20 云端删除崩溃恢复 Loop Engineer 复核（最新权威摘要）：客户端持久化
`DELETE_PENDING/DELETE_CONFIRMED`，服务端注册响应以 PostgreSQL 原子 `created` 证明区分原设备令牌轮换
和删除后的空替代设备。服务端已删除原设备但响应丢失时，重试只删除新建替代设备；注册命中既有不同
设备时失败关闭。删除入口先取消并等待全部本地提醒，再按“远端确认 → Room 事务原子清理云派生卡片、
反馈 outbox 和追踪 outbox → 身份重置”执行。最终独立 critic 返回 `REVISE`，指出旧顺序在远端成功后
先重置身份、Room 清理前崩溃会丢失恢复材料；修复后以 JVM 崩溃点、API 34 丢响应/确认重放、源码守卫
和真实 UI 删除烟测验证。达到两次独立 critic 硬上限后没有伪造额外 PASS。后端基础测试 73/73，
PostgreSQL 17.10 为 11/11/TCP E2E；Android 为 24 个 JVM 套件 83/83、API 34 设备测试 32/32，完整
参考套件 GO。测试签名 R8 SHA-256 为
`69AE0AB72DA896400BE542459A4A43D7A449D9022963C59BAD0551CBAABB084A`。`formalSigning=0`、真人听读和
外部 Beta 证据仍为 0，结论保持 `NO-GO`。

2026-07-20 图片上传状态保真 Loop Engineer 复核（上一已完成摘要）：独立 critic 发现原始 OkHttp 图片 PUT
会把除 401 外的非成功响应压成 `IllegalStateException`，使 409/429/5xx 被误判为永久失败，候选进入
`FILTERED` 且 Picker/分享私有副本被删除。当前使用 `UploadHttpStatusException(statusCode)` 保留真实
状态，Retrofit 与原始 PUT 共用失败分类：401 只刷新匿名身份并重放一次；409/429/5xx 保持 `READY`、
保留导入副本并进入 WorkManager 有界重试；400/410/413/415 才进入 `FILTERED` 并清理副本。JVM 回归
覆盖响应转换与状态处置；API 34 回归证明连续 401 时总尝试恰好两次、身份只刷新一次；源码守卫固定
状态保真和条件清理不变量。最终独立 critic 返回 `PASS`。当前 Android 为 23 个 JVM 套件 81/81、
API 34 设备测试 28/28，完整参考套件 GO；测试签名 R8 SHA-256 为
`9C6A8C964F97F6C60BC773909E55346DB0EC7E3E45FB93A297E40D0A89B1AB6E`。`formalSigning=0`、真人听读和
外部 Beta 证据仍为 0，结论保持 `NO-GO`。

2026-07-20 有界缩略图 Loop Engineer 复核（上一已完成摘要）：独立 critic 将详情页直接解码原图、组件固定
`inSampleSize=4` 定为 P1；常见 48MP ARGB 原图理论分配约 192MB，四倍采样后仍约 12MB，并且两条
路径都忽略 EXIF。当前共享 decoder 会先读 bounds，以 2 的幂采样到目标以内，应用八种 EXIF 方向，
并回收旋转/缩放中间位图；详情返回长边不超过 1280 px（ARGB 上界 6.25 MiB），组件不超过 320 px
（ARGB 上界 400 KiB），且不会在 Glance 完成 RemoteViews 转换前提前 recycle。策略回归覆盖 48MP、
超宽、超高及非法边界；API 34 回归覆盖损坏输入、方向交换、20 次重复解码、尺寸与实际分配字节。
实现后独立 critic 返回 `PASS`。当前 Android 为 22 个 JVM 套件 75/75、API 34 设备测试 27/27，完整
参考套件 GO；测试签名 R8 SHA-256 为
`E300911424EFC0770129F0B79A8268BC06669778EE0C4034FA02FA4C3C34F567`。`formalSigning=0`、真人听读和
外部 Beta 证据仍为 0，结论保持 `NO-GO`。

2026-07-20 “太私人”同步竞态复核（上一已完成摘要）：独立 critic 发现卡片同步先 GET、隐私反馈后 POST 时，
服务端陈旧页面能够复活本地已删除卡片；进一步复核指出清除照片索引后不能只依赖候选墓碑。当前实现把
全部待处理 `TOO_PRIVATE` outbox 作为卡片同步硬屏障：先提交隐私反馈，整个分页期间保留 outbox 并按
card ID 丢弃陈旧卡，同时拒绝关联 `NEVER_ANALYZE` 候选；所有页面成功后才二次本地删除并确认移除
outbox。隐私 POST 失败时不请求卡片页并保留 outbox；服务端成功后客户端中断时也保留 outbox，供幂等
重试。独立 critic 最后一轮为 `REVISE` 并指出“索引已清除”边界；修复后达到本轮复核硬上限，没有伪造
额外 PASS，以两项 API 34 instrumentation 与源码守卫验证。当前 Android 为 21 个 JVM 套件 73/73、
API 34 设备测试 25/25，完整参考套件 GO；测试签名 R8 SHA-256 为
`232C5C83804533E32831FEE930BE23D4D30B56C48B87423275A7AF0484FCEF81`。`formalSigning=0`、真人听读和
外部 Beta 证据仍为 0，结论保持 `NO-GO`。

2026-07-20 权限生命周期三轮 Loop Engineer 复核（上一已完成摘要）：第 1 轮修复引导前/拒绝后误调度和
误导空状态；第 2 轮独立 critic 发现前台从 `FULL/PARTIAL` 撤权后旧自动 Work 仍存活，以及旧 FULL
任务可能吞掉 PARTIAL 对账；第 3 轮继续发现自动 UploadWorker 会跨来源消费 Picker/分享候选，取消时
还可能把逐项导入误记为 FILTERED。最终实现以 Activity 前台恢复对账真实权限，以独立 reconciliation
链保证 PARTIAL 扫描必执行，以任务请求范围和当前系统授权交集防止旧任务扩权，并在 DAO/Work 输入层
分隔 `MEDIA_STORE` 与显式导入；缺失/非法范围失败关闭，进程级互斥阻止当前单进程内的 Work 重复
消费 READY 候选，等待中和持锁时的取消均传播，数据库关闭重开后候选仍按原范围恢复。最终独立 critic
返回 `PASS`。该轮 Android 为 21 个 JVM 套件 73/73、API 34 设备测试 23/23；运行态直接证明
`preConsentAnalysisWork=0`、`deniedAnalysisWork=0`、`revokedAutoWork=0`、`partialScope=1`、
`partialReconciliation=1`，完整参考套件 GO。测试签名 R8 SHA-256 为
`E8701FE69616A089631211053A39C34264DED2F48A5346A9290A6435FB24E375`。正式签名、真人听读和外部
Beta 证据仍为 0，结论保持 `NO-GO`。

2026-07-20 第 19–20 轮增量（当前权威摘要）：第 19 轮接受并修复生产日志最小化、测试依赖注入隔离、
同候选 HTTP 重试成本幂等、SAFE_PACKET 历史计数漂移和 Release 运行时日志取证；该取证真实发现并
修复分享确认前的 MediaStore URI 日志泄漏。第 20 轮“Android 上传可跟随重定向”经源码核对不成立，
但已升级为 OkHttp 属性单测和源码护栏；“部分权限未覆盖”与“撤销广泛权限必须撤销逐张导入同意”
分别被真实 API 34 测试和明确产品同意模型否定。“暂停分析”是持久化本地停止开关，不等同于云端删除；
“删除云端数据”则先删除/排队删除对象，再由 PostgreSQL 级联清除全部设备关联数据与上传会话。
本轮真实门禁结果为：后端 73/73，PostgreSQL 17.10 的 12 个迁移三次运行、10/10 集成及 TCP E2E；
Android 17 个 JVM 套件 61/61、API 34 设备测试 20/20，以及应用、组件、320dp+2.0x、TalkBack
焦点、R8 与 Release 日志隐私全套 GO。测试签名 R8 SHA-256 为
`39A6B991AC1757444F46226B2362949356D94AC6AA88997F3AAEFB65AFD7343F`，正式签名和真人语音审计
仍明确为 0。Kimi 已到第 20 轮硬上限且结论仍是 `NO-GO`；真实内容、授权评测、真实云与不可变部署、
正式签名、OEM、真人听读、卡片抽检及 cohort 证据未出现，所以产品不能进入 Beta。

2026-07-20 第 18 轮增量（优先于下文历史计数）：知识来源请求现以解析后公网 IP 固定连接、原主机名
校验证书，并在最多五次手动重定向的每一跳重做 HTTPS/443、凭据、DNS 与公网地址检查，关闭 DNS
重绑定和重定向到内网的取证通道。Android 净化后的 JPEG 最终守卫无条件拒绝 APP0–APP15/COM；
导入副本在应用启动和每 12 小时独立清理一次，不会因用户暂停分析而永久残留。冷构建 JVM 60/60、
API 34 instrumentation 20/20、应用权限/分享/提醒、桌面组件、320dp+2.0x、TalkBack 焦点与 R8 v2
测试签名运行时均通过；正式签名明确为 0，真人语音审计明确为 0。Kimi 第 18 轮提出的“未审核事实可发布”、
“事实可跨主题绑定”、“太私人后组件仍展示”和“上传完成前撤权竞态”等意见，经源码与回归核对不成立；
APP0 守卫和暂停时导入副本清理两项有效意见已修复。真实内容审核、真实云/OSS 生命周期、正式签名、
国产 OEM 七天矩阵、真人 `zh-CN` TalkBack、授权图片评测、200 卡抽检及真实 cohort 仍无证据，
因此 Beta 发布结论仍为 `NO-GO`。

2026-07-20 第 17 轮增量（优先于下文历史计数）：发布门禁已关闭目录联接路径下“退出 0 但未执行”
的主入口绕过，并按真实当前时间拒绝超过七天的部署回执。三方签名覆盖的装配清单现在同时绑定
八个证据工件、精确知识目录/backlog 字节和受保护审核人白名单摘要；最终门禁重算所有摘要，并以
同一外部白名单核验 fact-level reviewerId。知识就绪规则与生产运行时统一为 approved 正文 28–80 字。
后端稳定设备限流、正确 429、删除重试公平性和 Qwen 禁止重定向均已回归。上述修复提高了门禁可信性，
不替代 624 条真人语义审核、真实云、授权评测、正式签名、OEM、真人 TalkBack 与 cohort，Beta 仍为
`NO-GO`。

2026-07-19 三方信任链增量（优先于下文旧描述）：正式 GO 现在同时需要独立部署、QA 装配和
发布审批三份 Ed25519 证明。策略强制三个角色使用不同 issuerId、keyId 与 SPKI 公钥指纹，
QA 装配签名绑定批准清单及固定八工件的精确 SHA-256/长度；最终门禁还要求策略字节摘要匹配
仓库外受保护环境的 `JIANWEI_EVIDENCE_TRUST_POLICY_SHA256`，因此仓库编辑者不能通过替换
公开策略自行任命三种签发者。负向回归覆盖角色合并、公钥复用、错误策略摘要、缺失装配签名、
清单/工件篡改与单发布审批人伪造。真实三方策略、三把外部私钥和正式证据尚不存在，状态仍为
`NO-GO`。

2026-07-19 最终证据链增量：schema v3 证据绑定批准的八工件装配清单。最终门禁会重读
固定路径清单、全部八个原始工件与固定信任策略，重新验证部署回执签名并确定性重装配，
再与发布审批签名覆盖的证据逐字段比较。仅持 `beta_release_approver` 私钥但没有有效
`beta_deployment_attestor` 回执不能通过。该能力已由负向回归证明；真实清单和外部回执
当前仍不存在，因此不是发布证据。

2026-07-19 最新增量（优先于下文历史计数）：后端基础测试、PostgreSQL 17.10 的 11 个迁移与 10 项事务/并发测试通过；Android JVM 为 7/12/41，API 34 instrumentation 为 20/20，完整参考套件通过。最终证据必须由仓库外 Ed25519 私钥签名，并同时绑定正式 APK、后端 Release SHA-256、精确 Dockerfile 与实际部署 OCI `sha256:` 摘要。正式门禁从真实仓库根固定加载信任策略并拒绝覆盖；OCI 证据还必须来自独立 `beta_deployment_attestor` 签名的部署回执，回执绑定 endpoint、Function Compute revision、后端身份与 ACR 摘要，单纯比较服务端环境变量不能放行。生产就绪端点和云验证会核对该回执，部署前输入门禁拒绝可变镜像标签、摘要不一致和未固定基础镜像。客户端删云数据在旧令牌下只恢复同一安装/同一设备绑定，失败保留恢复材料；`TOO_PRIVATE` 在 PostgreSQL 内以回执、偏好扣减、抑制、删除队列、卡片/任务删除的单事务保证并发幂等；删除 UI 具备永久操作确认，隐私扫描区分撤权和瞬时失败并释放位图资源。以上是工程证据，不替代真实内容、云、正式签名、OEM、真人听读和 cohort 证据；Beta 仍为 `NO-GO`。

更新：2026-07-19。结论：**工程 Alpha 可构建并通过 API 34 参考套件，真实 Beta 仍为 NO-GO**。

状态定义：`PROVEN` 有源码和自动化产物证据；`IMPLEMENTED_UNVERIFIED` 已实现但仍需真机、真实云或授权数据；`PARTIAL` 只覆盖部分目标；`EXTERNAL` 必须由设备、账号、内容审核或真实用户提供证据。

## 产品闭环

| 要求 | 状态 | 证据或缺口 |
|---|---|---|
| 三屏引导、3 个兴趣、自动发现/仅选择照片 | PROVEN | Compose 引导、权限请求与 Photo Picker 已连接；选择“仅选择照片”会先持久化模式与兴趣，取消系统 Picker 后仍进入仅手动选择首页，不要求本次必须选图；API 34、320dp/2× 实跑及 Windows accessibility smoke 证明 `completed=true` 且照片分析 WorkManager 任务为 0。自动发现的系统权限弹窗烟测同样通过；同意前或拒绝后不会安排自动分析，也不声称已开始扫描 |
| Android 完整/部分/拒绝权限 | PARTIAL | 官方 Android 14/API 34 AVD 三种状态与原生部分照片选择流程通过；MediaStore PUT 每 64 KiB 重验精确 URI；仍缺实体机/OEM 与真实网络撤权故障注入 |
| 近 90 天、最多 500 张、增量扫描 | PROVEN（参考设备）/ EXTERNAL（OEM） | Android 14/API 34 真实 MediaStore 测试发布 503 条测试媒体：首轮 501 条严格只索引最新 500，第二轮未变化为 0，新增照片为 1，pending→重写 JPEG→重新发布的内容修改为 1 且重置到隐私分析；部分授权即使已有未来旧游标仍会 bounded reconciliation 并发现后来可见照片。另一个真实 MediaProvider 回归覆盖新旧 `DATE_TAKEN` 与新旧 `DATE_ADDED/DATE_MODIFIED` 四种组合：有效拍摄时间优先，缺失拍摄时间时回退元数据仍必须在窗口内，旧图不能逃逸 90 天边界。完整授权使用基础列比较的复合水位，避免 Android 14 MediaProvider 拒绝 `CASE` WHERE；非撤权查询错误不再静默返回空成功。仍缺国产 OEM 500+ 相册执行证据 |
| 首轮 12 个候选、后台补足 7 张未来卡 | PROVEN | 排序限制、DEFERRED 队列、未来卡计数和单轮 24 个上传上限已实现；服务端不再按历史卡总数偏移日期，而在完成事务内选择中国日历今天起首个空位。PostgreSQL 四连接池 32 路并发证明日期连续唯一，删除中间卡后下一张补最早缺口；数据库 `date` 统一归一化为 ISO 字符串 |
| 首张卡进度、无匹配与失败恢复 | PROVEN（状态机）/ EXTERNAL（真实云时延） | QUEUED、扫描、端侧筛选、同步、有卡、无匹配、自动重试与最终失败均为持久化聚合状态；进程重建 API 34 回归证明不保存照片元数据。空页分别提供选择、恢复或重试动作，已有卡时失败提示不遮挡缓存内容；真实 Qwen 的 P50/P95 首卡时延仍需授权图片与云环境验证 |
| 2x2/4x2 小组件、每日主卡、每天换两次 | PROVEN | Glance 响应式布局、按日状态与计数存在；未来排期耗尽后继续显示最后一张卡并标记“新卡缓存已用完”；组件 CTA 只跟在第一张每日卡之后且收藏页不重复，窄屏/大字体切换纵排；Pixel Launcher 原生 Pin 预览、系统绑定计数增加和缓存知识卡桌面渲染烟测通过；仍缺国产 Launcher 实体机矩阵 |
| 系统 Pin Widget 引导 | PROVEN | 使用 `requestPinAppWidget`，不支持时给出手动说明 |
| 来源、置信度、推送理由、四类反馈 | PROVEN | Room/API/UI 全链路存在；来源仅允许公共 HTTPS，目录、分页同步、旧缓存读取和点击前四层失败关闭；第二页恶意来源不部分写库、旧恶意缓存不崩溃的 API 34 回归通过 |
| 物品追踪必须由用户确认起始日 | PROVEN（参考设备）/ EXTERNAL（OEM 准时性） | 用户必须打开提醒对话框，选择不晚于今天的启用日期和 30/60/90/120/180 天周期，再确认后才请求通知权限；拒绝权限时不创建任务。授权后即使后端未运行也会先创建唯一 WorkManager 本地提醒；卡片持续显示启用日、周期和预计复查日，并允许预填更新或确认取消。Room 6→7 把提醒升级为 `UPSERT/NONE/DELETE` 持久状态机，版本保护阻止旧同步回执覆盖较新的用户选择；服务端删除按设备隔离且幂等。锁屏公开版本不显示物件名。系统省电可能延迟，仍缺国产 OEM 实体机实际送达记录 |
| 大字体、窄屏与基础 TalkBack 语义 | PARTIAL | 320dp 宽、2.0 倍字体下三屏引导、滚动兴趣、两个入口、分享确认和触控目标烟测通过；真实 Google TalkBack 服务已绑定并完成键盘焦点遍历；仍缺真人听读与实体机记录 |

## 隐私与可靠性

| 要求 | 状态 | 证据或缺口 |
|---|---|---|
| 人脸、截图、证件、银行卡、票据、文档、高文字密度过滤 | IMPLEMENTED_UNVERIFIED | ML Kit 在最终上传字节上复检；OCR 文本先做 NFKC、全空白和有限分隔符归一化，JVM 覆盖全角/分组身份证号、银行卡号、身份证版式与日期+手机号负例，API 34 bundled ML Kit 对最终 JPEG 字节真实识别并阻断分组银行卡号。服务端固定视觉提供方还会结构化二次检查并在命中时拒绝、跳过写卡、删除对象；恶意客户端空标记回归通过。授权图片评测必须为每张样本明确记录 `local_and_cloud_evaluation` 同意，并把独立人类标签与 Android 真机运行结果按图片 SHA-256 一一合并。仅 Debug 运行器以生产 ML Kit、清洗和真实 HTTPS 云链路执行 300–500 张授权样本；编译器拒绝 AI 执行人、模拟器、非公共端点、混 APK、未完成样本、缺失八类敏感覆盖或少于 25 个识别主题。机制与合成最终字节已验证，但真实 Qwen 与授权评测集尚为空 |
| 模糊、重复、时间与兴趣多样性 | PROVEN | 清晰度、感知哈希与排序单测通过 |
| 1280px 重编码、去 EXIF/元数据 | PROVEN | Bitmap 全新编码后结构化移除 APP0–APP15/COM，再由 marker 守卫闭合验证；10 项 JPEG JVM 测试（含 512 输入畸形语料）及真实 Bitmap/EXIF/GPS Android 14 测试通过 |
| 撤销权限后停止自动扫描/上传 | IMPLEMENTED_UNVERIFIED | Activity 前台恢复会读取真实权限并等待取消 INITIAL/RECONCILIATION/DAILY/DAILY_PIPELINE，同时保留逐项同意的 IMPORTED；旧 ScanWorker 以请求与当前授权交集运行，自动/导入 UploadWorker 由必填、失败关闭的 DAO 来源范围隔离。进程级上传互斥避免当前单进程 Work 重复消费 READY 候选，取消传播和数据库关闭重开恢复均有回归。API 34 WorkManager/Room 测试与 APK 冒烟证明撤权后自动 Work 为 0、导入 Work 未取消、PARTIAL 专用 reconciliation 输入存在；PUT 每 64 KiB 与末尾仍复核。缺实体机真实网络撤权故障注入 |
| 选择器/分享图片的逐项同意 | PROVEN | 只接受用户选择或分享的 `content://` URI；分享入口最多 20 张且必须在应用内点击“导入并分析”后才复制，并直说画面可能上传、处理后删除、异常最多 24 小时；单图 25 MiB、单批 100 MiB，敏感/低质/终态失败立即删原始副本，成功仅保留净化缩略图最多 30 天 |
| 上传 URL 与凭据边界 | PROVEN | 客户端只允许 API 同源 `/v1/analysis-jobs/{UUID}/image` 且无 query/fragment；OSS/第三方直传、userinfo、替代端口、域名后缀与 path traversal 均被拒绝；请求构造器二次校验后才附带匿名 Bearer |
| 匿名令牌 | PROVEN | 服务端随机 256 位令牌、哈希存储、注册轮换、旧令牌失效测试；客户端 Keystore AES-GCM 保存令牌和安装秘密，并在 401 后只重注册重试一次 |
| 授权图片评测额度租约 | PROVEN（机制）/ EXTERNAL（真实运行） | 普通设备 24/日、300/月额度保持不变；PostgreSQL 仅保存短期 bearer 的 SHA-256，并把租约绑定精确标签摘要、300–500 个样本/候选 ID 和首台匿名设备。清单外样本、第二台设备、冲突重放、过期、撤销与删号均失败关闭；租约任务不会进入该设备当前或后续普通请求的日/月计数，但全局数量和模型成本熔断始终执行。Debug runner 读取受控文件，租约 Header/接口仅存在于 Debug source set；结果、日志和 Release APK 均不含 bearer，Release DEX/Manifest 的四个评测标记扫描结果为 0；真实云租约尚未签发或运行。 |
| 处理后立即删、最长 24 小时 | IMPLEMENTED_UNVERIFIED | `finally` 删除、周期清理；OSS 模式无一天生命周期规则会拒绝启动；缺真实 Bucket 证据 |
| 太私人/本次安装排除 | PROVEN | 本地删除卡片和私有副本，并把稳定本地照片标识写入独立 Room 墓碑（清索引不删除）；隐私反馈 outbox 是卡片同步硬屏障，先 POST、分页期间按 card ID 与 `NEVER_ANALYZE` 双重拒绝陈旧卡、全分页成功后才确认 outbox，失败或中断均保留供幂等重试；服务端删除卡片、任务与对象并写当前匿名设备的候选墓碑；卸载或清除应用数据会重置本地排除，产品不声称跨安装识别 |
| 详情/组件缩略图内存边界 | PROVEN（API 34）/ EXTERNAL（OEM） | 共享 bounds-first、EXIF-aware decoder 在解码前读取尺寸并按 2 的幂采样；详情长边 ≤1280 px，组件长边 ≤320 px，设备测试验证组件 ARGB `allocationByteCount` ≤400 KiB、旋转方向正确、损坏输入返回空且 20 次重复解码均回收。原生 Pixel Launcher 绑定/渲染无崩溃；仍需国产 Launcher 与真实超大相册长期运行证据 |
| 有限重试、幂等和成本熔断 | PROVEN | WorkManager 最多 3 次指数退避；原始 OkHttp PUT 与 Retrofit 统一保留状态，409/429/5xx 保持 `READY`、保留 Picker/分享私有副本并重试，400/410/413/415 才终止并清理副本，401 只刷新身份和重放一次；同源 PUT 可取消且上传会话只可原子消费一次，旧 URL 在成功上传或设备删除/重装后不能复活；Android 当前单进程中的 UploadWorker 由可取消互斥串行执行，服务端候选令牌继续承担跨进程重启的最终幂等；真实 PostgreSQL 17.10 下 4 个独立连接池并发提交 32 次、全局限额 5 时准确创建 5 次，匿名全局事件账本不随设备删除 |
| 一键删除设备数据 | PROVEN | UI 先暂停分析并持久取消/等待全部提醒 Work；客户端持久化删除中/已确认状态，服务端先清对象再级联删除设备数据，注册接口以原子 `created` 证明支持“远端已删但响应丢失”的安全恢复并对既有不同设备失败关闭；远端确认后 Room 在单事务清卡片、反馈 outbox 和追踪 outbox，最后才重置身份。JVM 崩溃点、API 34 丢响应/确认重放及真实 UI 烟测覆盖 |

## 内容与后端

| 要求 | 状态 | 证据或缺口 |
|---|---|---|
| 200 主题，每主题 3–5 条已审核事实 | PARTIAL | 受控分类账与生产目录均已达到 200 个主题（200 seeded + 0 proposed）。目录 `2026-07-19-beta.62` 现有 624 条事实（613 draft、11 状态 approved）：176 个主题各有 3 条，24 个主题各有 4 条，全部主题结构完整；0 条真人签注、0 个完整人工审核主题。本轮新增摩托车后视镜、后视镜、道路标志、减速带和雨刮器，每个主题一次写入 3 条 `safety` 草稿事实，且每条绑定至少两个官方来源，并避开驾驶、维修或事故处置建议。只读审核队列已把全部 200 个主题的 624 条事实按风险排序并附上来源可达证据；本机真人审核工作台默认全部 `pending`，仅监听回环地址，使用一次性入口、同源 CSRF、不可变修订和旧摘要并发拒绝，完成时只写出批次而不应用目录；应用器继续固定目录/事实 SHA-256、拒绝 AI 审核身份、要求逐来源确认并整批原子落库，旧单事实直写入口已关闭。主题数量与 3–5 条结构门槛已满足，但 624 条事实仍需真人逐条语义核验；该工作流不授予或伪造真人审核权限，内容门禁仍为 NO-GO |
| 无可靠命中不发卡 | PROVEN | `needs_content` 分支与 draft-only 集成测试通过；已编译服务的真实 TCP 闭环也证明未知标签上传后只进入 `needs_content` 且不返回卡片 |
| 来源可访问性与语义审核 | PARTIAL（静态）/ EXTERNAL（实时与语义） | 静态门禁覆盖 531 个唯一 HTTPS 来源且无悬空引用。当前 shell 的全量联网检查因 49 个主机统一触发公共 IP 安全解析失败而得到 `infrastructureFailure=1`；诊断保留在 latest-attempt，`canonicalUpdated=0`，正式实时证据为空，审核队列显示 `sourceEvidence=0`。历史可达记录不能作为当前证据；必须在可完成公共 IP 安全解析的网络环境重跑。预检工具和队列均失败关闭；即使 URL 可达也不证明来源支持事实，真人逐条核验仍为发布前置条件 |
| 模型不能编造 fact/source ID | PROVEN | 服务端先确定性选 approved fact，再严格比对 writer 返回 ID；恶意 writer 伪造 fact/source ID 的两项端到端测试均返回 502、不写卡并删除对象 |
| 健康/安全双权威来源 | PROVEN（规则）/ EXTERNAL（内容） | Catalog 校验会拒绝不足两权威来源的高风险 approved fact；200 主题人工审核未完成 |
| PostgreSQL 持久化 | PROVEN（本地）/ EXTERNAL（云） | 隔离的 PostgreSQL 17.10 三次走完 13 个迁移（含编译服务启动迁移）并通过 13 项测试；第 10 个迁移把运行中后端 Release SHA-256 写入新卡，第 11 个迁移建立最小化隐私删除回执，第 12 个迁移提供公平、有界退避的对象删除重试，第 13 个迁移回填并约束独立识别对象名。专用升级测试在旧表夹具上真实执行迁移 13；4 个独立连接池验证预算、幂等、单次上传、处理租约恢复、删除/重装、主题偏好、授权评测租约、并发注册恰有一个 `created=true`，以及并发“太私人”反馈只扣权重一次并在同一事务写候选抑制、对象删除队列、删除卡片与任务；同一编译服务的完整 TCP 产品闭环也已真实经过 PostgreSQL；托管实例、监控与故障注入仍未执行 |
| OSS、Qwen 可替换实现 | IMPLEMENTED_UNVERIFIED | 适配器、结构化输出和内容安全 Header 已实现；当前官方 Chat Completions 视觉格式、`json_object`、内容安全 Header 与固定模型快照已复核；生产必须显式配置北京工作空间端点，运行时只允许官方 HTTPS `compatible-mode/v1` 地址；OSS 取回字节会再次校验大小/类型/魔数；缺真实 OSS/Qwen/HTTPS 端到端运行 |

## 自动验证结果

- Backend：TypeScript `--noEmit` 与构建通过；73 项基础 Vitest 测试通过；已编译 `dist/index.js` 的真实回环 TCP 闭环在内存与 PostgreSQL 17.10 两种仓储模式均通过，覆盖认证、隐私前置拒绝、一次性上传/重放拒绝、卡片、反馈、追踪、幂等取消追踪、未知物件不出卡、删除与对象归零，证据分别位于 `.tooling/backend-e2e/result.json` 和 `.tooling/backend-e2e-postgres/result.json`；PostgreSQL 另通过 11 项事务/并发测试，新增用例证明独立连接池并发注册恰有一个请求返回 `created=true`，并证明四连接池并发提交“太私人”时只产生一个删除回执、一次偏好扣减、一个抑制墓碑和一个持久删除队列项。生产依赖联网审计为 0 已知漏洞。该 TCP 门禁仍是本地视觉/对象存储 Provider，不计作真实 OSS/Qwen/托管数据库云证据。
- Android：30 个 Debug JVM 套件共 112 项测试、Android 14 模拟器 44 项 instrumentation 测试全部通过且 0 失败/错误/跳过；新增每日卡策略覆盖未来缓存默认隐藏、合法组件焦点例外和非法焦点失败关闭，组件状态机覆盖末尾不循环，按钮策略覆盖可用卡数与配额共同决定剩余次数。真实 Pixel Launcher 完成 2×2 添加、4×2 缩放、同一 Glance 会话内两次换卡即时重绘、终态按钮消失和精准回卡。其余回归覆盖 OCR/最终 JPEG、MediaStore 90 天/500 张/增量/部分授权、删除恢复、提醒、隐私同步屏障、上传身份刷新与有界缩略图。App/Data Lint 均为 0 error（32/20 warning）；当前源码的 R8 Release 与 Lint Vital 通过。
- APK 烟测：参考套件先从当前源码重建 Debug APK，再验证引导、系统权限弹窗、拒绝/完整/部分权限标签、真实 MediaStore 分享二次确认、本地内测报告导出和物品提醒明确同意；通知权限在确认前不会请求，拒绝后 WorkManager 为 0，授权后在无后端情况下同时出现本地提醒任务与 Room `UPSERT`，随后验证提醒状态可见、周期从 90 天更新为 120 天且始终只有一个有效任务、确认取消后任务归零并写入 `DELETE` outbox。崩溃缓冲为空；导出门禁确认进入系统分享器、报告 schema 完整、包含已安装 base APK SHA-256 且不包含照片索引、安装身份或设备令牌；APK 摘要在 IO 线程计算，避免阻塞主线程。320dp/2.0 倍字体、真实 Google TalkBack 服务绑定/焦点遍历和 Pixel Launcher 原生 Pin/绑定/缓存卡渲染门禁均为 GO。不可调试 R8 APK 单独验证 UI、空状态组件和 v2 测试签名运行，不使用 Debug 私有数据库检查。TalkBack 门禁不验证语音或真人可理解性；测试签名 R8 运行不等于正式签名。
- 删除 UI 烟测：先重新建立一个本地提醒并证明 Work/追踪 outbox 各为 1，再暂停分析、确认永久删除，轮询到提醒 Work、卡片、反馈 outbox 和追踪 outbox 全部为 0；组件烟测随后显式重建唯一可丢弃卡片夹具，不再依赖前一烟测残留状态。完整参考套件实际输出 `cloudDeleteReminderCancel=1`、`cloudDeleteLocalAtomic=1`、`cachedCard=1`。
- Release：R8、Lint Vital、`assembleRelease` 通过，产物为未签名 APK；真实 Beta 签名需用户私钥。正式证据验证器固定公开证书 SHA-256，要求一个 v2 签名者，拒绝 Android Debug/Test Only/Local R8 Smoke 身份，检查包名、minSdk 26、targetSdk 36，并绑定 APK SHA-256；其自测与现有测试签名 APK 的负控制均失败关闭。
- 产物：当前 Debug APK SHA-256 `DA5A2870592E98BC327F74EC17892A8F24CB39E2ACA2132329FC3C186C996421`；App/Data 设备测试 APK SHA-256 分别为 `D7756C0FB81413195E6CCA84358923DB7057F0DAC15827C9A1FBD85E5D352611` / `B880064E6061C1F9BABD81748FD26ECE2D59C414745818A2369B33AC84B0E95D`；未签名 Release APK SHA-256 `0CB9C3EEC44CE374D5F706147AA8BC5C658F1482F86E996F058B81BB473A0F9B`。最近一次隔离测试签名 R8 APK 早于本轮改动，不作为当前运行证据；`formalSigning=0`。授权图片评测 Activity 只存在于 Debug manifest；Release 仍不得包含租约接口或凭据。
- 供应链：Fastify 已固定为安全修复版 5.8.5；pnpm 锁有 280 个完整性记录。Gradle Wrapper 分发包与 wrapper JAR 固定官方 SHA-256，依赖验证元数据覆盖 709 个组件/1264 条 SHA-256，三模块锁文件含 796 条记录；完整任务图在非联网严格模式通过。OpenAPI 契约门禁精确比对 13 个后端操作、8 个 Retrofit 操作、1 个原始上传操作和 9 组 DTO。
- 源码护栏：无 `TODO()`、`NotImplementedError` 或产品源码中的待办占位；无绝对化保护/已分析承诺和 Android 云密钥标记；Main 与 Debug Android source set 都进入扫描。Release/Debug 配置分离、正式签名证据验证器、精确 APK SHA-256 绑定、提醒确认、本地优先、完整更新/取消生命周期、版本化 outbox、Android 14 增量 MediaStore 与部分授权重新对账证据检查为 GO。 首卡结构化终态、组件缓存耗尽、未来卡隔离、换卡可用性、实时重绘与精准回卡门禁同样为 GO（`truthfulAnalysisState=1 widgetCacheExhaustion=1 futureCardCacheHidden=1 widgetSwitchAffordance=1 widgetLiveRefresh=1 widgetCardDeepLink=1`）。
- Beta 证据门禁：证据 schemaVersion 3 把批准的八工件装配清单摘要、人类标签与管线结果的 SHA-256、数据集/运行/应用/模型/目录版本绑定；每张图片必须有唯一内容摘要、`local_and_cloud_evaluation` 授权范围、授权时间、人类标签人、完整管线结果和 `leftDevice` 结论。结果还必须带由 Android 运行器生成的真人批准时间、物理设备身份/API、公共 HTTPS origin 与精确 Debug APK SHA-256；AI 身份、模拟器、混 APK 或手填结果不能通过。八类敏感覆盖、25 个识别主题分布、未执行样本和单主题刷分均有失败关闭自测。卡片抽检也不再允许直接手填：真实 PostgreSQL 只读导出不含设备/候选身份的 200-500 张卡片快照，独立真人审计逐卡核对全部来源，编译器按卡片 SHA-256 合并并从固定目录推导风险、白名单、权威来源、正文和来源集合一致性；负面结果不会被丢弃。Beta 指标同样只能由完整设备报告集和真人 cohort manifest 编译，绑定报告集/清单摘要并要求七天完整观察。全部合成输出明确 `synthetic=1 releaseEvidence=0`。最终门禁会从仓库固定路径重读已批准清单、八个原始工件和信任策略，重新验部署回执并确定性重装配，要求结果与发布审批者签名的证据逐字段一致；仅持发布审批私钥而没有部署证明私钥不能放行。门禁同时执行当前知识目录就绪判定，要求所有证据使用同一 App 版本，卡片/云端/cohort/OEM/TalkBack 全部与正式 Release APK 使用同一 SHA-256，并要求图片/卡片/云端使用同一模型与目录版本；正式非 Debug 签名 APK 证据及实体机 `zh-CN` 真人 TalkBack 听读证据不可缺失。自动化焦点遍历不能冒充真人可理解性。空白真实证据模板为 NO-GO；放行记录还必须包含责任人、严格时间、脱敏证据引用、实体机型号/指纹及真实云标记。
- 云端证据：受控命令要求显式确认两张授权 JPEG，使用真实 HTTPS API、Qwen 和临时 OSS STS；上传后先确认对象存在，再分别证明安全图完成、敏感图在客户端空标记下由服务端拒绝、两者终态即时删除，并核对禁用版本控制、一天生命周期与删号后令牌 401。App 版本与 Release APK SHA-256 由正式验证工件派生，不能手填。输出不含图片、对象键、令牌、安装 ID、Bucket、凭证或数据库 URL；2 项本地故障注入测试通过。未运行真实云，因此仍是 `IMPLEMENTED_UNVERIFIED`。
- Loop Engineer：项目本地 skill 固定上游提交；退出条件为真实 Beta 证据门禁，Kimi 具有硬轮次/总 token 上限、源码外发禁用和人工外发检查点。第 17 轮外部 Kimi 调用因平台仍未接受当前对话中的知情外发确认而未发送，不冒充完成轮次。
- Kimi：16 轮 SAFE_PACKET 对抗审查实际完成并保持 NO-GO；模型未接收源码、路径、照片或密钥。之后的上传会话、处理租约、主题偏好、STS/OSS 版本门禁和取消 OSS 直传属于本地持续审查，不冒充新的外部轮次。

- 实体机证据编译：最终清单已移除直接手填 `deviceRuns`。华为、小米、OPPO/vivo 每台设备必须同时提供 App 脱敏导出和独立保留证据包，pending-only 清单固定两者 SHA-256 后由真人填写权限、扫描、后台、七天离线组件和删除观察；编译器从 App 报告派生设备/App 身份与已安装 APK SHA-256，拒绝证据包复用、模拟器指纹、混版本、混 APK、少于七天和不完整 OEM/权限矩阵。11 类绕过自测通过，但当前没有国产实体机原始材料，所以仍无真实设备工件。
- 最终证据装配：`beta-evidence.json` 不再依赖人工复制字段。七个独立编译/验证工件先由 pending-only 真人清单固定原始字节 SHA-256；其中 TalkBack 工件还必须绑定 App 脱敏报告和保留证据包，并与编译实体机矩阵中的同一 `runId`、厂商、型号、指纹、API、App 版本和 APK SHA-256 交叉核验。装配器复验字节与解析值一致性、云运行摘要、当前知识就绪、跨组件版本和正式 Release APK 摘要，只能以 `READY_FOR_ATTESTATION` 写出；最终门禁还要求仓库内固定的公开信任策略和仓库外 Ed25519 私钥产生的七日内责任人签名。修改证据/策略、未知或失效签发者、错误密钥与伪造完整 bundle 均被拒绝。卡片抽检编译器 9 类、无障碍编译器 12 类、Beta 门禁 21 类、最终装配器 16 类绕过及路径/junction 逃逸自测通过；卡片、云验证、健康端点与最终装配必须使用同一后端 Release SHA-256，均明确 `releaseEvidence=0`；当前没有真实组件工件、正式信任策略或签名，所以没有生成发布文件。

## 仍然阻断 Beta 的外部门槛

1. 200 个主题、每主题 3–5 条事实完成真人审核；健康/安全内容双权威来源。
2. 300–500 张明确授权评测图片，敏感漏传率 <1%，主要对象 Top-1 ≥90%。
3. 华为、小米、OPPO 或 vivo Android 实体机回归，包括完整/部分/拒绝权限、处理中撤权、后台限制、小组件和真人 TalkBack 听读。
4. 真实托管 PostgreSQL、OSS、Qwen、HTTPS 部署；验证内容安全、立即删除、一天生命周期、删除设备数据和故障恢复。
5. 使用独立私钥签出 Release APK；先 10 人 3 天，再扩到 20–50 人。
6. 至少 200 张生成卡人工抽检，并达到组件添加率、7 日互动率、LIKE 率和首卡延迟目标。

所有原始结果填入 `evaluation/beta-evidence.json` 后，只有 `node scripts/check-beta-readiness.mjs evaluation/beta-evidence.json` 返回 `GO` 才允许 Beta。
> 2026-07-19 audit closure: final assembly increased from seven to eight SHA-bound artifacts and now
> independently re-verifies the raw deployment receipt with the pinned Ed25519 trust policy. The
> bypass fixture mutates both the receipt and cloud output into a self-consistent OCI claim, but is
> rejected because the attestor signature no longer verifies. No real deployment receipt is present;
> Beta remains `NO_GO` until external evidence is collected and signed.
