# 见微完成度审计

2026-07-26 Android 网络响应空字段边界（当前最新 Android 权威摘要）：Gson 会把缺失或显式 `null` 的 JSON 字段写入 Kotlin 非空属性，原 Card/Source/Feedback wire DTO 因此只能在编译期看似非空；错误环境、代理或服务端回归返回缺字段时，卡片同步可能抛出未受控 NPE，反馈确认也可能绕开预期的可重试 I/O 失败。分析任务 `completed` 分支原来只校验 card/candidate 身份，还会在完整卡片载荷进入 Room 前提前接受终态。

当前所有卡片、来源、分页项、反馈确认和 topic affinity 的网络字段均按运行时真实 JSON 建模为可空；边界层先验证完整集合，再构造非空持久化模型。缺失/null 卡片字段、来源、分页项、反馈 ID/card/action/time/topic/weight/aliases，或完成响应中的不完整卡片，统一在候选终态、Room 提交、偏好写入和 outbox 确认前抛出 IOException。真实 Gson 反序列化回归证明“可解析”不等于“可接受”；API 34 真实 Room 回归证明缺失确认字段时 LIKE outbox 与本地权重均保持不变，可依赖服务端幂等性安全重试。

API 34 关键同步专项 24/24、完整 Data instrumentation 80/80 通过；Android JVM 231/231（Domain 64、Data 101、App 66），API 契约 11 个合成绕过、源码守卫 `wireResponseNullability=1`、Data/App Debug Lint、App Release Lint、Debug/R8 Release 与 Data 测试 APK 构建全部通过。Debug/未签名 Release/Data 测试 APK SHA-256 为 `3d5d3499b225a7c2457dc51fa749744f1645e7559af7f822c916d1b1b5291113` / `428bf0e5f54a8e63ad92c61c53fa179ccf4aa2be43f28ed01417f0d9d1d3aac7` / `6e8e3ab876252b6e42a15089e4aa3ca7b88fc61e5491f659bc31767d1dc29a8e`。本轮未改后端/OpenAPI，严格公开契约继续为 GO；真实云/Qwen 安全护栏、正式签名、OEM 实体机、真人审核和 cohort 阻断不变，Beta 保持 `NO_GO`。

2026-07-26 卡片分页候选归属与公开响应边界（当前最新跨端权威摘要）：Android 原来会验证远端卡片字段、来源和分页上限，但只在本机候选存在时读取照片 URI；若服务端、代理缓存或错误环境返回一个结构完全合法、candidate token 却从未属于本安装的卡片，客户端仍会用空照片引用写入 Room。另一方面，用户清除本地照片索引后，已验证卡片仍应继续同步，否则隐私最小引用和已有知识会失去刷新能力。服务端虽然按匿名 device ID 查询卡片，`complete` 与 `/v1/cards` 却直接回传内部 `KnowledgeCard`，把 OpenAPI 和 Android 都不需要的匿名 `deviceId` 一并公开。

当前客户端只接受两类卡片：candidate token 能绑定到本机候选，或 Room 已存在同一 card ID 且 candidate token 完全一致的可信卡；同 card ID 改绑、未知候选、缺失 items、超过 50 项、非法/自循环 UUID 游标都会在任何 Room 写入和 outbox 确认前以 IOException 失败关闭。全部分页仍先完整验证、再一次性 upsert，因此第二页外来卡不会留下第一页面更新；`TOO_PRIVATE`/`NEVER_ANALYZE` 屏障仍先于正文校验，清索引后同一可信卡仍能刷新并保留最小隐私引用。服务端新增显式 `publicCardResponse` 白名单，`complete` 和分页只返回 13 个公开卡片字段；OpenAPI 的 Card/CardsResponse 均禁止额外字段并固定页大小、状态、标识符与正文边界，编译产物 TCP E2E 同时检查两条响应不含 `deviceId`。

API 34 真实 Room 专项 23/23、完整 Data instrumentation 79/79 通过；Android JVM 229/229（Domain 64、Data 99、App 66），后端 124/124、TypeScript check/build、API 契约 11 个合成绕过、源码守卫 `cardCandidateOwnershipBinding=1 publicCardProjection=1`、Data/App Debug Lint、App Release Lint、Debug/R8 Release 与编译后端 TCP `publicCardProjection=1` 全部通过。Debug/未签名 Release/Data 测试 APK SHA-256 为 `ba389535750c94b8cb26f79a2ec61fe7508c55ce5d2bbdc62592815926550169` / `3cf87f3f5aa503db798824eb16e993a7c836a15da6a5d69dbd54c7b08a700df8` / `26ac229e00a2b873c4a16a3afe44d0c424be72610bb7adcd86084381760156d4`。后端应优先部署以停止内部字段暴露；新旧 APK 对字段移除均兼容。真实云/Qwen 安全护栏、正式签名、OEM 实体机、真人内容审核和 cohort 仍未形成，Beta 保持 `NO_GO`。

2026-07-26 提醒同步确认绑定（当前最新跨端权威摘要）：Android 原来丢弃 POST track 的完整成功正文，并在 DELETE 的空 204 后直接确认 Room outbox。合法但串 card/日期/周期的响应可让本地停止重试，而云端保留错误提醒；POST 还额外公开了客户端不需要的匿名 deviceId。当前创建响应缩为不含 deviceId 的五字段资源快照，取消响应改为幂等 `cardId + untracked`；Android 在任何 outbox 确认前精确绑定 card、日期、周期、ID、创建时间和删除终态，缺失或错配统一保留 outbox。

API 34 真实 Room 测试证明串 card 的 UPSERT/DELETE 确认分别保留原动作，精确重试后才确认。OpenAPI 两个响应均严格，契约第 9 个绕过反例、后端 124/124、Android JVM 228/228、API 34 Data 78/78、Lint、Debug/R8 Release、编译后 TCP `reminderAckBinding=1` 和源码守卫 `reminderAcknowledgementBinding=1` 全部通过。按 `api-design` 的兼容策略必须先部署返回 200 取消确认的新后端，再分发新 APK；真实云、正式签名、OEM、真人审核和 cohort 仍未形成，Beta 保持 `NO_GO`。

2026-07-26 分析任务状态快照绑定（当前最新后端/云验收权威摘要）：GET analysis job 原本校验设备所有权，却不返回 `candidateToken`，OpenAPI 也没有成功响应 Schema。真实云验收在上传后与完成后看到的状态，不能证明属于本轮随机照片候选。当前 `JobStatusResponse` 只允许六个必填字段，覆盖 job/candidate 身份、完整 8 项状态、受限错误码和两个规范 ISO 时间；云校验器在 uploaded 与 terminal 两个检查点都要求 job/candidate 精确匹配，并拒绝额外字段、非法状态、非规范时间和时间倒退。

合成云负面用例证明串 candidate 的 GET 快照在 OSS 观察前失败；API 端到端固定精确字段集，编译后端真实 TCP 同时绑定 uploaded/completed 快照并输出 `jobStatusBinding=1`。OpenAPI 契约第 8 个绕过反例、后端 124/124、TypeScript check/build、TCP E2E 和源码守卫 `jobStatusResponseBinding=1` 全部通过。本轮 Android 生产代码未改，不将旧 APK 结果记作新构建；真实云、Qwen 安全护栏、正式签名、OEM、真人审核和 cohort 仍未形成，Beta 保持 `NO_GO`。

2026-07-26 匿名注册响应 installation 绑定（当前最新跨端权威摘要）：旧注册成功响应没有携带任何可由当前请求验证的 installation 身份，Android 会把 `deviceId/deviceToken/created` 直接加密落盘。另一个 installation 的合法缓存响应、缺字段产生的 Gson 运行时 null 或格式异常 token 都可能污染匿名身份。当前后端只公开带域分隔的 `installationBindingSha256`，不回显原始 installation；Android 在首次 bearer/设备 ID 写入前严格校验规范 UUID、43 位 base64url token、精确摘要和非空 `created`，失败时不留下 bearer，并可用原 installation 安全重试。

TypeScript 与 Kotlin 共享固定 SHA-256 向量；OpenAPI 固定严格四字段、token 长度/字符集与摘要格式，云 Beta 校验器在任何图片上传前执行同一绑定检查，编译后端真实 TCP E2E 也验证绑定。API 契约第 7 个合成绕过和 API 34 DataStore 回归分别证明删除字段与串 installation 会失败关闭。后端 122/122、Android JVM 226/226、API 34 Data 77/77 + App 25/25、Lint、Debug/R8 Release 与源码守卫 `registrationResponseBinding=1` 全部通过。该字段要求后端先部署；真实云、正式签名、OEM、真人审核和 cohort 仍未形成，Beta 保持 `NO_GO`。

2026-07-26 一次性上传会话与 PUT 确认绑定（当前最新跨端权威摘要）：create/complete 身份绑定仍遗漏了中间的原始图片 PUT。旧 create 响应只有 upload URL，没有独立 session 字段；Android 确认 URL 同源且路径像 UUID 后便上传，随后只要 HTTP 属于任意 2xx 就继续 complete，成功正文中的 jobId/status 从未读取。OpenAPI 的 raw PUT 200 也没有响应 Schema。因此 URL/响应串到同设备另一任务时，客户端无法证明哪些字节进入了哪个 job。

当前 create 新增必填可空 `uploadSessionId`；awaiting_upload 必须为合法 UUID，并与 uploadUrl 路径逐字相等，其他状态必须没有 session。PUT 200 新增严格 `UploadJobResponse`，后端返回认领后的 jobId、candidateToken、当前路由 uploadSessionId 和常量 uploaded。Android 只接受 HTTP 200；成功正文先以 4 KiB 上限读取，再用 `JsonReader` 非宽松逐字段解析，字段集合必须精确等于四项，重复键、额外/缺失字段、非字符串值、尾随 JSON、非法 UUID、job/candidate/session 任一错配或非 uploaded 状态都会抛 IOException。该失败不会进入 FILTERED；候选和显式导入副本保留，若上传实际已成功，重试 create 会从 uploaded 安全续接 complete。

API 契约门禁现在强制 raw PUT 200 引用严格 UploadJobResponse，并新增移除响应引用的失败关闭自测。编译后端在真实回环 TCP 上完成注册、create、PUT 确认、同 session 重放 409、GET uploaded、complete/card 和终态幂等，三段身份一致且对象目录归零。云 Beta 验证器同步要求 URL/session 与 upload ack 的 job/candidate/session 完整绑定，合成串确认在进入 complete 前被拒绝。最终后端 120/120、TypeScript check/build、API 契约 6 个绕过反例、TCP E2E 和源码守卫 `uploadAcknowledgementBinding=1` 通过；Android JVM 224/224（Domain 64、Data 94、App 66），Data/App Debug Lint、App Release Lint、Debug/R8 Release 与 Data androidTest APK 构建通过。Debug/未签名 Release/Data 测试 APK SHA-256 为 `9ada998dd6dbdbdb19169c9705352afb40adaf1ae56a28961cdc2ebb0993290c` / `73da4d699c762c4c7691973340588036d4f67cb106b3340f1bc2bbdb09e4ce27` / `8fa52397df948e6593b3b3e4957fcb9cefc6f40bde88b6c78c74290a0389566c`。真实云与 Qwen 安全护栏仍未执行/放行，正式签名、OEM、真人内容审核和 cohort 阻断不变，Beta 保持 `NO_GO`。

2026-07-26 分析任务响应身份绑定（当前最新跨端权威摘要）：创建分析任务时，客户端提交的是本地随机 `candidateToken`，但旧成功响应没有回传它；完成接口也没有独立候选身份，Android 只按响应 `status` 把当前照片标成 COMPLETED 或 FILTERED。代理串包、错误服务实现或响应错配只要保持 JSON 结构合法，就可能把另一个 candidate/job 的结果提交给当前 Worker。上传 URL 的路径 UUID 是独立的一次性 upload session，不是 jobId，因此把两者强行比较并不能解决身份问题。

当前 Create/Complete 响应都强制包含 `candidateToken`。Android 不再让 Gson 原始 DTO 直接进入 Worker：wire 字段按运行时真实情况保持可空，`RemoteAnalysisClient` 只有在全部验证后才构造非空 `ValidatedCreateJobResponse/AnalysisJobOutcome`。验证要求 job/candidate/card UUID 合法，create candidate 与本地候选相等，complete job 与请求 job 相等且 candidate 仍相等；create 只允许 awaiting_upload/uploaded/completed/needs_content/rejected，complete 只允许 completed/needs_content/rejected；awaiting_upload 必须携带同源精确一次性路径，其余 create 状态必须没有上传目标；completed 必须有同 candidate 卡片，另外两个终态不得携带卡片；expiresAt 必须可解析。缺字段或错配都抛出 IOException，沿既有上传故障策略保持候选 READY 和显式导入副本，不会因 Gson 的运行时 null 变成 NPE 后提交终态或清理导入副本。为支持先后端、后 APK 的滚动升级，服务端暂时保留旧 APK 使用的终态空字符串，新 Android 双读空字符串/null，OpenAPI 明确兼容形态并固定状态枚举。

正式云验证器也要求 create candidate、complete job/candidate 与本轮随机夹具精确相等，新增合成串候选反例会在上传前失败，因此发布证据链不能绕过 App 的身份边界。协议为兼容增强，发布顺序固定为先部署新后端、再分发新 APK。最终后端 120/120、TypeScript check/build、API 契约、云验证负面用例与 TCP E2E 自测通过；Android JVM 223/223（Domain 64、Data 93、App 66），Data/App Debug Lint、App Release Lint、Debug/R8 Release 和 Data androidTest APK 构建通过；源码守卫输出 `analysisJobResponseBinding=1`。Debug/未签名 Release/Data 测试 APK SHA-256 为 `094cb275d1944fabe54d30a98a9882ce1c5baad9e7abeade69ecb83c5917d55e` / `4a3eceb6fed1e3bc74fcd1b61087a321b747db31b7dffdcb85311c8d5ae31c10` / `514f089be015b4e643c1f5ebcd6be497d5ac43277ad2f225eb3dc6d4dea0d204`。真实云尚未执行且现有 Qwen 安全护栏仍未放行，正式签名、OEM、真人内容审核与 cohort 阻断不变，Beta 保持 `NO_GO`。

2026-07-26 反馈 topic 身份绑定（当前最新 Android 权威摘要）：card/action 绑定仍不足以证明偏好快照属于当前知识主题。旧 pending 表没有 topic，合法的 broom/LIKE 确认可以携带 toothbrush 权重并通过所有上一轮校验，随后既删除 broom outbox 又污染另一个主题的候选排序。

Room 13 为 `pending_feedback` 增加可空 `topicId`，所有新建普通反馈、收藏和隐私反馈都在读取卡片的同一事务内写入真实 topic。12→13 迁移通过 cardId 仅回填仍存在的卡片；旧 TOO_PRIVATE 可能已删除卡片，因此保持 null，禁止从其他偏好或标题猜测。确认处理在应用快照前要求非空 expected topic 使用安全 ID 且与响应唯一 topic 精确相等。升级遗留 null 行只确认已由 card/action 绑定的幂等服务端事件，返回空快照，不把无法证明归属的权重写入 Room。

JVM 回归覆盖 topic 错配拒绝和 legacy null 快照丢弃；API 34 Room 12→13 迁移证明 live LIKE 回填 broom、deleted TOO_PRIVATE 保持 null，真实同步测试证明 broom LIKE 遇到 toothbrush/-2.0 后 outbox 保留、broom 维持 0.35、toothbrush 行不存在。最终 Android JVM 217/217（Domain 64、Data 87、App 66），完整 Data instrumentation 76/76；Data/App Debug Lint、App Release Lint、Debug/R8 Release、Room schema 13、源码守卫 `feedbackTopicBinding=1` 和差异检查通过。Debug/未签名 Release/Data 测试 APK SHA-256 为 `a3346ec1de830e8302c52461c27c5d4f600cd96613142db52fb46e124b57346c` / `d20a9a6440dc60c8803affc9d5c638c3b6c3043ac5ec6cbc5dc7496d8b480a56` / `5c1fbaa648a1b0335e33b127a5c51597a2868e2565c7b560866553d1aecf0721`。外部发布阻断不变，Beta 保持 `NO_GO`。

2026-07-26 反馈确认身份绑定（当前最新跨端权威摘要）：后端的两条反馈成功分支实际都返回 `id`、`cardId`、`action`、`createdAt` 和 `topicAffinities`，但旧 OpenAPI 只描述一个可空偏好数组，Android DTO 因而主动丢弃确认身份。客户端只检查 HTTP 成功和正文存在，就会应用偏好并由调用方删除当前 outbox；一个合法结构但属于另一张卡或另一动作的 201 响应可以错误确认当前本地事件。

当前 OpenAPI 将反馈响应设为无额外字段的严格对象，五字段全部必填，偏好数组必须恰好一项；TopicAffinity 同步声明安全 ID、-2..2 权重及别名数量/长度边界。Android `feedbackAcknowledgementOrThrow` 以 pending 为权威，要求响应 card ID 与 action 精确匹配、feedback/card ID 为 UUID、action 为已知枚举、createdAt 可解析，并在返回前完成偏好整批校验。只有该确认返回后才允许 `applyServerWeights`，也只有整个 `sendPendingFeedback` 成功后调用方才删除 pending 行。错配会失败关闭，但服务端反馈的 `(device, card, action)` 幂等边界允许安全重试。

JVM 回归覆盖空正文、错误 feedback ID/card/action/time、空/多项/NaN 偏好；API 34 真实 Room 注入“请求 CARD_ID 的 LIKE、响应 MALFORMED_CARD_ID 与 -2.0”，验证异常后 LIKE outbox 仍为一条、本地 LIKE 权重不变。首次 74 项设备回归准确发现旧 RecordingApi 把必填权重模拟为 0.0，导致同步后错误覆盖 0.35；测试桩已按真实服务端规则返回 LIKE=0.4 等权威快照，最终 74/74 通过。后端 120/120、TypeScript check/build、API 契约门禁、Android JVM 216/216（Domain 64、Data 86、App 66）、Data/App Debug Lint、App Release Lint、Debug/R8 Release、源码守卫 `feedbackAcknowledgementBinding=1` 和差异检查均通过。Debug/未签名 Release/Data 测试 APK SHA-256 为 `ad3d5ddcb5d9da5c1f50b6514da31068a5a7fd6537883fe44f8c6dbef4b901cd` / `0700bdd6776810ef1ae93ed100953b9cfa635ecc02d179ef1f6e7e5a4e3c7ef3` / `af6f34a99e79d40d5a39462b98fcab57d54182b43f340c4db801a51c56bcae98`。外部发布阻断不变，Beta 保持 `NO_GO`。

2026-07-26 反馈偏好响应持久化边界（当前最新 Android 权威摘要）：服务端确认 LIKE、DISLIKE、SAVE、WRONG_OBJECT 或 TOO_PRIVATE 后会返回当前 topic 权重快照，客户端原来逐项调用 Room upsert。其唯一输入检查是 topic ID 非空；权重依赖 `coerceIn(-2, 2)`，但 NaN 与上下界的比较都为 false，仍会原样流入持久层。异常/重复 topic ID、过多别名、控制字符和超大响应也未拒绝；更重要的是，如果第二项才损坏，第一项已经提交，重试前本地推荐状态会成为服务端从未发布过的半份快照。

当前 `LocalTopicAffinityStore` 在任何 DAO 查询或写入前先验证并规范化完整集合：最多 20 个 topic，ID 使用与卡片相同的有界安全字符集且不可重复；权重必须 finite 且位于 domain 的 -2..2；每个 topic 最多 12 个别名，每个别名去边缘空白并小写后须为 2–48 Unicode code point、不得含 ISO 控制字符，最后才去重。任意一项失败都会抛出 I/O 失败，使反馈 outbox 保留并依赖服务端已有幂等性重试；不会静默截断坏权重或部分改变 Room。

新增 JVM 回归覆盖 NaN、Infinity、上下界外、异常/重复 ID、过大 topic/alias 集合、过短/过长/控制字符别名和合法规范化。API 34 使用真实内存 Room 传入“首项合法、第二项 NaN”，验证抛出后 `topic_affinities` 仍为空。最终 Android JVM 215/215（Domain 64、Data 85、App 66），完整 Data instrumentation 73/73；Data/App Debug Lint、App Release Lint、Debug 与 R8 Release、源码守卫 `feedbackAffinityPayloadValidation=1` 和差异检查通过。Debug/未签名 Release/Data 测试 APK SHA-256 为 `7bc2f381c9fcf05f6bd6d5cfcacfc3444c6ba8666d750afa1bac9f094b5261e6` / `22c0cb8a9a73a944fabff3c029c06802c46d8f28425396438fa2adc7593a37aa` / `13231431c9de47fcbe7de759039abdc59b7d4d75373e71852d00cf09b5eab3b2`。外部发布阻断不变，Beta 保持 `NO_GO`。

2026-07-26 远端卡片持久化边界（当前最新 Android 权威摘要）：卡片分页原来会先校验来源 URL、来源权威级别和游标，但其他 Card DTO 字段直接进入 Room。非法 `scheduledDate` 可以完成数据库提交，随后在 Room observer 的 domain 映射中反复触发 `LocalDate.parse()`；非法状态、非有限置信度、过长正文或不安全标识符也缺少客户端最后一道失败关闭边界。由于卡片同步还负责确认 `TOO_PRIVATE`、`WRONG_OBJECT` 和普通反馈 outbox，简单地把全部校验前置又会让一张已经被用户标为私密的陈旧卡片因坏正文而永久阻塞删除确认。

当前实现把边界拆成两阶段：先严格校验 card ID 与 candidate token 的 UUID，再立即执行当前同步批次的 `TOO_PRIVATE` card ID 屏障和本地 `NEVER_ANALYZE` 候选屏障；只有仍有资格展示的卡片才继续校验 topic/fact ID、标题、对象名、正文、推送原因、有限且位于 0–1 的置信度、允许状态、规范 ISO 日期、可解析 Instant 与 1–3 个安全来源。所有展示文本按 Unicode code point 计数并只规范化边缘空白。整套分页在内存中全部通过后才单次写入 Room，因此后续页损坏不会产生半更新缓存，也不会提前确认任何 outbox。

新增 JVM 回归覆盖无效 UUID/标识符、空或超长文本、NaN/越界置信度、非法状态/日期/时间和合法文本规范化；API 34 真实 Room 回归证明恶意后续页不会改变既有缓存、不会插入坏卡、不会消费 LIKE outbox，也不会发出 LIKE API 调用。最终完整 Data instrumentation 72/72；Android JVM 214/214（Domain 64、Data 84、App 66）；Data/App Debug Lint、App Release Lint、Debug 与 R8 Release、源码守卫 `remoteCardPayloadValidation=1` 和差异检查通过。Debug/未签名 Release/Data 测试 APK SHA-256 为 `8e246938e0957194acd5a8e8eedf6e1cf529a708cb68ab5f5f6e66bfb0faf2dd` / `460970e5311b469ef76876e2161d4d04faabaf3deb0105c4833379f00a79c773` / `a6fb472e76666567114d027d0848502aa7393ce00bd39bd1190abee5de8801a4`。同日无图片 Qwen 安全护栏预检仍返回 `403 access_denied`，所以没有执行视觉 Provider、没有上传图片；外部发布阻断不变，Beta 保持 `NO_GO`。

2026-07-26 跨端 processing lease 自动恢复（当前最新 Android 权威摘要）：服务端视觉处理 lease 是 210 秒，但 Android 上传链原来最多尝试 3 次，1 分钟指数退避只会让客户端在约 0、1、3 分钟运行。若服务端已经取得 processing claim、却在响应前退出或断网，第三次仍可能得到 409，随后客户端就在 lease 可恢复前约 30 秒宣告失败；服务端具备恢复能力，但产品无法自动走到它。现在 UploadWorker 独立使用 4 次尝试预算，四个创建入口共用 1 分钟 backoff，第四次最早约在第 7 分钟运行，确定跨过 210 秒窗口；中间的 409、IOException 继续保持候选 `READY`，显式导入副本也不会清理。其他 Worker 的三次预算没有扩大。

新增 JVM 回归锁定尝试边界 0/1/2 可重试、3 终止，以及统一 backoff；跨语言来源门禁读取两端常量，计算指数退避累计覆盖时间必须大于服务端 lease，并要求四个 UploadWorker 构造入口全部使用该 backoff，输出 `processingLeaseRetryCoverage=1`。完整 Android JVM 212/212（Domain 64、Data 82、App 66），Data/App Debug Lint、App Release Lint、Debug 和 R8 Release 构建、来源守卫及差异检查通过。Debug/未签名 Release APK SHA-256 为 `e8ee6c74edef80eb547a6ee45584c6fcdd34f0256e9619dad88f096897f4e6e9` / `ed08ab4888e680eed882f9a07f999c7ea8f387f84b2c206e481af299bb3f9c84`。真实云、正式签名、OEM 实体机和 cohort 仍未满足，Beta 保持 `NO_GO`。

2026-07-26 服务端上传租约恢复（当前最新后端权威摘要）：分析任务原本只给视觉处理阶段设置 lease。上传入口取得一次性会话后会先把任务原子置为 `uploading`；函数实例若在 OSS 写入或 `finishUpload` 前退出，任务会永久停在该状态，客户端轮询只能得到 `409 upload_in_progress`，重建会话也不会发生。现在上传 claim 有独立 60 秒 lease；创建会话和 GET 轮询都会原子恢复过期 claim 为 `failed/upload_lease_recovered`，随后尽力删除旧对象并用旧 session CAS 建立替代上传。对象键包含随机 upload session ID，因此旧请求即使迟到，也不能覆盖或删除替代会话的对象；旧 session 的完成提交同样被仓储拒绝。未过期 claim 保持互斥，不会被并发请求抢走。

后端 TypeScript check/build、120/120 基础测试通过；隔离 PostgreSQL 17.10 实跑 13 个迁移、14/14 仓储集成测试和编译后端 TCP E2E，覆盖四个独立连接池、过期恢复、新鲜 claim 保护、旧/新 session 隔离、迟到完成拒绝及对象清理。源码守卫 `staleUploadLeaseRecovery=1` 和差异检查通过。此修复不放宽照片安全、内容审核或成本熔断；Qwen 安全护栏授权、真人审核、正式签名、OEM 实体机与真实 cohort 仍未满足，Beta 保持 `NO_GO`。

2026-07-26 Worker 取消传播（当前最新 Android 权威摘要）：`ScanWorker`、`CardSyncWorker`、导入副本清理和每日组件刷新原本会用 `runCatching` 把 `CancellationException` 转成产品失败或 `Result.retry()`；扫描尤其可能在用户暂停后反写“正在重试”。受控图片评测 Worker 也会把取消记录成普通失败，造成不真实的评测结果。现在 domain 的 `throwIfCancellation()` 在所有这些 Worker 进入重试/失败策略前原样抛回结构化取消；普通服务错误仍保留原有处理。两条 JVM 回归分别证明取消实例不被替换、普通异常不被吞。

完整 Android JVM 211/211（Domain 64、Data 81、App 66）；Data/App Debug Lint 与 App Release Lint 均 0 error，Debug 与 R8 Release 构建、源码守卫 `workerCancellationPropagation=1` 和差异检查通过。Debug/未签名 Release APK SHA-256 为 `46fd5021e4f4d3ebe187b572c82e4267bbcd5093d042f12e73e4a8dd63bc869d` / `c2b31da856887511684168cf764c094a49f204c9bfe6eed698b5eb170e267dfe`。这不替代实体机或外部 Beta 证据，发布保持 `NO_GO`。

2026-07-26 上传身份/授权故障照片保留（当前最新 Android 权威摘要）：上传链原本会把“照片不可处理”和“账号/服务不可用”混为同一终态。匿名身份自动刷新后仍失败、Retrofit 401/403 或原始上传抛出 `AuthenticationExpiredException` 时，候选会被写成 `FILTERED`，Photo Picker/分享导入的应用内副本随即删除，UploadWorker 还可能继续淘汰同批其余候选。现在上述身份与授权故障统一保持候选 `READY` 和应用内副本，终止本轮并明确显示候选仍在本机；用户可通过既有重新尝试入口恢复处理。明确的 400/410/413/415 和本地访问失效仍按候选终态处理，409/429/5xx 与 IOException 继续使用有界自动重试。

专项回归覆盖身份异常、Retrofit 401/403、瞬态错误和候选终态，完整 Android JVM 209/209（Domain 62、Data 81、App 66）；Data/App Debug Lint 与 App Release Lint 均 0 error，Debug 与 R8 Release 构建、源码守卫 `authFailureCandidateRetention=1` 和差异检查通过。Debug/未签名 Release APK SHA-256 为 `0825aa7f40a77dfd478d56709668e8571a80caed5f95743e6f7b97ff3c17a1ee` / `deca69ed8e913edf292a4a4dc855f0b55bd1dbfcfc637c3b9aa65119aa10e6a3`。这不替代真实云、正式签名或实体机证据，Beta 保持 `NO_GO`。

2026-07-26 百炼 AI 安全护栏文本预检（当前最新权威摘要）：新增独立命令 `pnpm verify:qwen-guardrail-access -- --credentials-file <csv>`，用于在不读取或上传任何图片的情况下检查账号侧阻断。命令只发送一条无敏感文本，携带与生产完全相同的 `X-DashScope-DataInspection={"input":"cip","output":"cip"}`，输出仅包含北京区域、固定模型、HTTP 状态和受限错误码；API Key、完整工作空间端点、凭据路径和上游错误正文均不进入输出。专项测试同时断言请求体不存在 `image_url`。

使用当前下载的北京百炼按量付费工作空间 CSV 真实执行后，固定 `qwen3.6-flash-2026-04-16` 仍返回 `403 access_denied`。这直接证明截至本次检查，AI Safety Guardrails 尚未对当前工作空间完成授权；所需服务关联角色仍为 `AliyunServiceRoleForSFMAccessingCIP`。根据阿里云当前官方流程，仍需先开通按量付费 AI 安全护栏，再在百炼北京地域“安全管理”中授权内容审核。预检未来返回 GO 也只证明角色和生产 Header 可用，之后仍须用明确授权的非个人图片重跑完整视觉 Provider 验证。后端 TypeScript check/build、118/118 基础测试（另 13 项 PostgreSQL 环境测试 skipped）、源码护栏 `qwenGuardrailPreflight=1` 和差异检查通过；Beta 保持 `NO_GO`。

2026-07-26 真实 Qwen Provider 验证（当前最新权威摘要）：使用用户下载的北京百炼工作空间按量付费 Key 和仓库自有、无人物的扫帚示例图，真实调用固定模型 `qwen3.6-flash-2026-04-16`。生产请求携带强制内容安全 Header 时返回 `403 access_denied`；随后只用于定位的无内容安全文本探针返回 200，无内容安全视觉诊断识别为 `broom / 扫帚 / 0.98` 且无敏感标记。这证明当前 Key、北京工作空间端点和固定视觉模型可达，但也精确证明生产要求的 AI Safety Guardrails 尚未对该工作空间授权；服务器运行时仍强制该 Header，不会为了跑通而降级。

Provider 验证器现在把失败路径收敛为一份机读报告：`providerGate=NO_GO`、`releaseEvidence=false`，显式记录本轮实际 3 个请求，而不是只显示产品单卡的 1 次模型调用。原 JPEG 的 JFIF/EXIF 段在内存中移除，报告只保留净化字节 SHA-256 与大小；写出前扫描 API Key、完整工作空间端点、凭据路径和图片路径，命中即拒绝。报告以 `0600` 和 `wx` 写入，拒绝覆盖旧证据。本轮真实报告位于忽略目录 `.tooling/qwen-provider-verification-2026-07-26.json`，SHA-256 为 `4cbb927227fad5dcaf3f362f3081f6db33e2cb421de03ab9a6ae528a29a1ff2b`；二次检查确认四类敏感值均不存在。它是本地诊断证据，不是发布证据。下一外部动作仍需阿里云主账号开通按量付费 AI Safety Guardrails、授权同一百炼工作空间并允许创建 `AliyunServiceRoleForSFMAccessingCIP`，随后重跑到生产 Header 请求本身通过；Beta 保持 `NO_GO`。

2026-07-25 每天一张自然日配额（当前最新权威摘要）：上一版把 `AUTOMATIC_DAILY_ONE` 的单个供给计划限制为 1 个候选，但用户选择、首次启动、权限调整和 WorkManager 重试都可能形成独立自动链，因此“每个自动周期最多 1 张”不能证明“每天随机挑一张”。这是业务语义偏差，不是文案问题。

当前 domain 继续负责纯供给规则：当天自动配额已被领取时，后续 daily-one 隐私批次不得启动；提前准备和显式导入不受该条件影响。Data 层新增 `SharedPreferencesAutomaticDailyUploadQuota`，在视觉请求前以同步 `commit()` 持久写入中国自然日与本地候选 ID。首次候选返回 `NEW_CLAIM`，同日同候选返回 `SAME_CANDIDATE` 以支持 WorkManager/进程中断后的幂等继续，同日不同候选或同日损坏状态返回 `EXHAUSTED` 并在联网前失败关闭；次日覆盖旧领取。UploadWorker 的进程内 mutex 保证调用串行，配额组件自身也同步保护并发。PrivacyScanWorker 在当天已有领取时不再筛新的自动批次；UploadWorker 若发现已有领取，会调用 Room 的范围受限精确查询，只恢复该 READY、可访问、`MEDIA_STORE` 候选，不会让排序更高的另一张照片取代它，也不会跨进显式导入队列。服务端已有 `(device_id, candidate_token)` 幂等任务边界，保持同候选重试不产生另一张卡。

API 34 设备测试让 24 个不同候选并发领取同一天，结果恰好 1 个 `NEW_CLAIM`、23 个 `EXHAUSTED`；新建配额组件后仍能读取同一候选，同候选重试允许、不同候选拒绝、次日新候选允许。损坏的“有日期无候选 ID”状态失败关闭。真实 Room 同时放入高分候选、低分已领取候选和显式 Picker 候选，普通排序选择高分，而精确恢复只返回已领取 ID；缺少相册权限或来源不符均返回空。最终 Data instrumentation 64/64、App instrumentation 18/18；Android JVM 184/184（Domain 60、App 46、Data 78），App/Data Debug/Release Lint 0 error，Debug、R8 Release、源码门禁和差异检查通过。Lint 首次并发运行曾因 Release KSP 生成文件尚未落盘触发工具异常，先完成 APK 生成再以单 worker 顺序运行四个 Lint 后全部成功。

标准与 840×1867/2× 字体专项均按“照片发现方式 → 每个自然日最多上传分析 1 张 → 开启自动发现”的阅读顺序通过；测试会保存、暂时清空并最终恢复既有导入交接状态，证明脏状态下也不会误入另一条路径。标准/大字截图 SHA-256 为 `3e3dfec9649d333ad0621529753f38be9b7e1b4da89079422afb56806d7820d8` / `fb39de4319bf2b291f1d227099524a46032dd5b51dedb05be1b2abfcc4629ca5`；Debug/未签名 Release APK SHA-256 为 `8112a59a834d39d4f5faa0f748fc07177c3548e631fb82d05987c2502b54caf2` / `54dd161a44f553abdb2ca459b3f1788e69e1bdd8db9750bd4ceb239e08261641`。以上仍是模拟器和本地工程证据；真人事实审核、真实托管云、正式签名、OEM 七天运行、真人 TalkBack、200 卡抽检和 cohort 未完成，Beta 保持 `NO_GO`。

2026-07-25 双模式使用状态闭环（当前最新权威摘要）：上一版已经让用户在首次体验和设置中选择“提前准备”或“每天一张”，但选择完成后的首页状态仍有卡池模式残留文案。用户选择“每天一张”后，隐私中心可能承诺“持续补充未来卡片”，分析中的空状态也没有告诉用户本轮硬上限，产品决策没有真正贯穿完整闭环。

当前纯 UI policy 读取持久化 `AutomaticCardMode`，统一生成自动发现控制、相册范围摘要、启动反馈与 QUEUED/SCANNING/FILTERING/SYNCING/NO_MATCH 文案。“提前准备”继续说明逐步准备 7–14 张；“每天一张”说明每个自动周期最多上传分析 1 张、本机最多深度检查 4 张、筛选阶段最多选出 1 张，未命中时明确“今天没有生成新卡片”并承诺不凑数。Picker-only 不冒充自动扫描，部分授权明确只在已选照片中工作，完整授权也会展示当前处理节奏。ViewModel 只负责把当前 mode 交给 policy，扫描、供给、Room 和 Worker 的既有业务上限未改变。

API 34 标准字号测试以 `DAILY_ONE` 打开设置，验证精确说明并真实点击“开启自动发现”进入 Permission Controller；840×1867/2× 字体下验证相同说明、按钮 enabled 且存在可点击祖先，避免重复触发系统权限弹窗。`PREPARED_POOL` 的完整/部分授权摘要由独立设备测试验证。完整 App instrumentation 18/18；Android JVM 183/183（Domain 59、App 46、Data 78），App/Data Lint 0 error，Debug、R8 Release、源码门禁和差异检查通过。标准/大字截图均为 1080×2400，SHA-256 分别为 `0bc51946e9c7f4932e057765045c7af8a12d2eac97d777a48024d54e9eb491f4` / `afcc9c86dac584c8b4bb82059bb6bc7dae417652c9aa0497b53791f252c9a38b`；当前工作区图片查看器无法挂载该路径，因此未把截图生成冒充为人工视觉复核。Debug/未签名 Release APK SHA-256 为 `e314bc83bcbcaa45787230f5400a6cd2543704cab6db2d1d94bb964eb87bf374` / `8121a876b7ede39b285728dda8ed916cd73fc38fdbea1eec24e2cdd71d5f2b9a`。以上仍是模拟器与本地工程证据，Beta 保持 `NO_GO`。

2026-07-25 首次体验双模式选择（当前最新权威摘要）：上一版两种自动节奏已经在设置中真实可用，但新用户授权前仍只能看到“自动发现/仅选择照片”，无法知道自动发现会提前批量准备还是每天只处理一张。当前保持原三屏，不增加 onboarding 摩擦；第三屏在同一决策上下文中完成 3 个兴趣、自动节奏和授权方式。两种模式的限额、离线收益和未命中行为在授权前明确可见，并明确 Picker/分享不受自动节奏约束。

Compose 只保存尚未提交的引导页码、兴趣和模式，并使用 `rememberSaveable` 跨 Activity 重建；两个离开引导的入口都调用 ViewModel，由既有 domain Repository 边界共同持久化兴趣和模式后再请求相册权限或打开系统 Picker。API 34 测试真实把“生活设计”替换为“实用技巧”、选择“每天一张”、重建 Activity，验证仍停留在 3/3、兴趣勾选和 RadioButton 状态保留；随后点击可交互的“仅选择照片”按钮进入系统 Picker，并从共享偏好确认 `DAILY_ONE`。标准 1080×2400 与 840×1867/2× 字体两条路径均通过。完整 App instrumentation 18/18；Android JVM 182/182（Domain 59、App 45、Data 78），App/Data Lint 0 error，Debug、R8 Release、源码门禁和差异检查通过。标准/大字截图 SHA-256 为 `db7315d80cb994defcdb5b3cac294c96f65e798ee621044ca32a899d88c73f8d` / `4b15aeb846f12ceffbe10a6c0bc9807c78bdbd2cace382fc6c063c7e0a10421b`；Debug/未签名 Release APK SHA-256 为 `542e08dd73730235bd441ed51315c65939920cc10b79ee79d2326b947a894565` / `b9b634f56f49cdee5798dd4557167e0afad805e2e5dcf086fd45332b46e6ffd6`。这些仍是模拟器与本地工程证据，Beta 保持 `NO_GO`。

2026-07-25 双照片处理模式（当前最新权威摘要）：用户现在可以在设置中选择真实不同的自动处理节奏，而不是只改变排序文案。默认“提前准备（推荐）”维持低于 7 张时补到最多 14 张未来/当日卡的离线卡池，单轮最多上传 24 个自动候选；“每天一张”在 domain 供给策略和两个 Worker 执行层共同硬限制每次自动周期最多上传并分析 1 个候选，本机隐私阶段最多检查 4 张照片来寻找 1 张安全且不重复的候选。Picker 与分享属于逐项同意的显式导入，不受自动模式限额影响。

模式通过 Repository 持久化并由 Worker 运行时读取；默认兼容原卡池行为，非法旧值失败关闭到推荐默认值。设置页以 RadioButton 语义显示“已选择/未选择”，明确每天一张仍会先在本机筛选、没有可靠事实或后台延迟时继续展示已有卡。切换不会删除已有卡；重复选择当前值不产生新任务；暂停或 picker-only 时只保存。API 34 标准/2× 字体测试验证模式切换、持久化、Activity 重建和设置导航；完整 App instrumentation 17/17、Data instrumentation 60/60、Android JVM 182/182，App/Data Lint 0 error，Debug、R8 Release、源码门禁和差异检查通过。标准/大字截图 SHA-256 为 `8f7076ccca925a7ed160278d845b7a9e4e0522979c1ccd4f4d4a84055dfdef25` / `ea2c58f2008cd9999f04a02b2d7c7bc8c14716287acc70a3e4b3674da17a6eb8`；Debug/未签名 Release APK SHA-256 为 `f89b63b1cf2a096e2e1a5da0e7f87f771bd25dac6c3876b348339d99548f8e70` / `fbb4f144b670cc7ada57f6015685e2d6eb205ba37a326cfd1ac9d380f6711453`。这些仍是模拟器与本地工程证据，Beta 保持 `NO_GO`。

2026-07-25 固定三段导航与设置隔离（当前最新权威摘要）：推荐偏好和隐私管理不再出现在每日知识流末尾；内容区顶部固定提供“每日 / 收藏 N / 设置”，不会随长卡片滚走。每日只展示卡片与发现状态，收藏只展示归档，设置独立承载兴趣、照片发现方式、组件和数据管理。每日、收藏、设置和聚焦详情分别持有滚动状态；从设置底部切走再返回会恢复深层位置，收藏/设置的系统返回统一回每日，精准详情继续保持最高返回优先级。Android Clean Architecture 在本轮用于把变化限定于 Compose 导航/展示层。

设备测试首次发现 Material Button 将 `selected=true` 和可访问名称拆到两个节点，形成无名称的选中 Tab；当前 48dp 自绘分段按钮用单一语义节点同时提供 Tab 角色、完整名称、选中态与点击动作。API 34 真实 Room 测试覆盖每日/设置内容隔离、三段选中态、设置底部全部操作、固定入口、滚动位置恢复与系统返回；原权限、收藏和组件路径同步迁入设置页。标准 1080×2400 与 840×1867/2× 字体均通过，标准/大字截图 SHA-256 为 `5f556634b7871ffdd95c454fb575fbf4e41cad84ab7f5440a7c18e32bbdc2ba5` / `9462f1f96cd2e144e0cd344dd540b45119c9662365a72e4af56e5e37bbe86662`。完整 App instrumentation 17/17；Android JVM 179/179（Domain 56、App 45、Data 78），App/Data Lint 0 error，Debug、R8 Release、源码门禁和差异检查通过。Debug/未签名 Release APK SHA-256 为 `aa20d672eb8a92c1c46454fece4a748d4e8e2dbcf200c18c2b8d51bc2ff3405d` / `0398355c10c69fd33b5835063071a8cf09a2631e6f50b7993857965eb1786c64`。这些仍是本地模拟器工程证据；外部发布阻断不变，Beta 保持 `NO_GO`。

2026-07-25 每日卡与往日目录闭环（当前最新权威摘要）：每日页现在只完整展开今天的知识卡；已展示的历史卡收进“往日一知”紧凑目录，以日期、标题、摘要和有界缩略图支持长期回看，不再重复展开每张卡的来源、提醒和反馈。点击旧卡进入完整详情，显式返回与系统返回都恢复原历史列表位置；收藏、提醒、反馈继续复用既有完整卡能力。该变化限定在 Compose 展示/导航层，DailyCard domain policy、Room、Repository、卡池补给和组件调度未改。

API 34 设备测试用真实 Room 的今天、昨天和更早三张卡验证今天正文完整、历史私人上下文不在目录提前展开、旧卡来源可达、系统返回保留列表和 DAO 数据不丢；标准 1080×2400 与 840×1867/2× 字体均通过。标准目录/详情截图 SHA-256 为 `b62958b013b57ec04811d6c1e897af0e780bdc983396b1f4f7cc79a5b52f60b3` / `e3d9c5830e446e99d665b18579d5679ee805c1b3abfb3f48`，大字目录/详情为 `3f36e5620443589eee64bfe735f006faabd484e1e41ee98dcbc99a6901bc6813` / `56fe3b3ba238124b34c16d976207a96e7edaa1a0c8f2657d804dafd1064d6880`。完整 App instrumentation 16/16；Android JVM 180/180（Domain 56、App 46、Data 78），App/Data Lint 0 error，Debug、R8 Release、源码门禁和差异检查通过。Debug/未签名 Release APK SHA-256 为 `76cbd8c5c8be36008d78527ca0350a86c7d5e4fecf9b9d30d0b025aa430ce43e` / `3ff2a8606095b10d890164c4b76f7874a5193c282ee84ced56ad48be52efd240`。这些仍是本地模拟器工程证据；真实云、正式签名、OEM、真人内容与 cohort 阻断不变，Beta 保持 `NO_GO`。

2026-07-25 物品提醒知情确认闭环（当前最新权威摘要）：提醒不再暗示系统可以从照片推断物品已使用多久。新建和编辑首先说明时间必须由用户确认，并使用卡片的规范对象名；开始使用日、预计复查日与已开启状态全部改为中文日期。用户必须显式勾选确认开始日和周期，修改任一值会撤销确认，再次编辑也必须重新确认。预计通知说明限定为当天上午 9:00 左右并提示省电延迟，底部明确这是自定义复查提醒，不代表专业更换建议。对话框正文可滚动，通知权限仍只在用户确认后按既有流程请求；Reminder Repository、Room 和 WorkManager 生命周期未改。

API 34 设备测试以真实 Room 牙刷卡验证默认确认按钮禁用、勾选后启用、持久化为当天/90 天、中文提醒状态可见和编辑重新确认；标准 1080×2400 与 840×1867/2× 字体完整链路均通过。标准/大字截图 SHA-256 为 `b7282fdb5a6cd2ce37118d5e060693e179b344021c257a97ab115ffe3c11694b` / `5cb486724be3ba4941f132fed1c1985bcdde5ad29cfee510cf17b9fd8b7af4e7`。源码门禁新增提醒知情确认与设备覆盖约束。完整 App instrumentation 15/15；Android JVM 180/180（Domain 56、App 46、Data 78），App/Data Lint 0 error，Debug、R8 Release、源码门禁和差异检查通过。Debug/未签名 Release APK SHA-256 为 `a8651f2bf5ed76403bf3df29501e1ff49497677c0b2e7e663ba6e27091026e0b` / `ad332d838b505a8ad6f796ef86a9b09ff52d08bafb60f1d4996060a0c2c3b5f5`。这些仍是本地模拟器工程证据；外部发布阻断不变，Beta 保持 `NO_GO`。

2026-07-25 收藏目录与详情闭环（当前最新权威摘要）：收藏页有内容时不再把来源、提醒和四项反馈逐张全部展开，而是按既有最近收藏顺序展示紧凑可点击目录。标准宽度使用 112dp 照片与标题/摘要并排，净宽 `<300dp` 或字体 `>=1.5×` 时切为上下结构并将摘要收为两行；目录缩略图只解码到 320px，完整详情继续使用 1280px 上限。点击后进入独立“从收藏打开”详情，显式返回和系统返回都恢复收藏滚动位置；取消收藏会以现有 Repository/Room 事务更新状态，详情随 Flow 自动关闭并显示新计数。Android Clean Architecture 在本轮用于把浏览形态留在 Compose，未改收藏业务或同步边界。

API 34 设备测试用真实 Room 保存两张卡，验证目录中没有提前展开“为什么推给你”、详情完整可达、系统返回、再次进入、取消收藏及 DAO 最终 `isSaved=false`；标准 1080×2400 和 840×1867/2× 字体均通过。详情滚动复位只观察当前打开卡片的 ID/存在性，其他收藏同步变化不会重置阅读位置。标准/大字截图 SHA-256 为 `31e18380480c2b6976f6e776a843a46408d9691badb70bacaee84bb13841964e` / `95c0f8ae92d064cc11af4209d62d4a4a6756a3a67d53dba467b4dcaa280407d9`。当前源码包重新安装后的完整 App instrumentation 14/14；Android JVM 180/180（Domain 56、App 46、Data 78），App/Data Lint 0 error，Debug、R8 Release、源码门禁和差异检查通过。Debug/未签名 Release APK SHA-256 为 `1b70a08445a3ae2805298612b91cf17549b85c7c7d287b89553945178c501e19` / `5637bcbe97b9aa073eb185875e216a01b4252fe6c917efe65f2f5994cab3797d`。这些仍是本地工程证据；外部发布阻断不变，Beta 保持 `NO_GO`。

2026-07-25 收藏页独立导航闭环（当前最新权威摘要）：收藏空状态不再沿用旧动作名“收藏这张知识卡”，而是与每日卡片当前的“收藏”操作一致，明确说明卡片会保存在这里，并给出“查看每日卡片”主操作。收藏模式只呈现归档内容，不再重复自动分析状态、推荐偏好和隐私中心；CTA 与系统返回键都恢复每日模式，未改变 Room 收藏、反馈或云同步语义。Android Clean Architecture 在本轮用于保持变化位于 Compose 展示/导航边界。

API 34 新增设备测试以真实 Room 空状态验证文案、设置隔离、CTA 返回和 `KEYCODE_BACK` 返回，并生成 1080×2400 截图；840×1867/2× 字体下同一测试通过，主操作完整可达。标准/大字截图 SHA-256 为 `892187f0b7dd1108e2f61c96a8d2bf7a77e12a2e89f5ce344e2165eedf3a844e` / `f686965d6f43916bd221db7fc396e8d753d01e8ace8fa2291110244bb2364ef8`。完整 App instrumentation 13/13；Android JVM 180/180（Domain 56、App 46、Data 78），App/Data Lint 0 error，Debug、R8 Release、源码门禁和差异检查通过。Debug/未签名 Release APK SHA-256 为 `13f2068d797b3f842e5d0c40d2f4cbbaf2d862c2c4e99cc30ab0605bff666579` / `a579b6f0e164fe79b411edb93e9a2440f66c5b5ed8d93c0e9a8e23709fa755de`。截图和 APK 仍是本地工程证据；外部发布阻断不变，Beta 保持 `NO_GO`。

2026-07-25 Picker-only 首日空状态（当前最新权威摘要）：完成引导但取消系统选图后，首页不再只解释权限和入口。主卡现在先告诉用户“从一件日常物品开始”，说明主体清楚、画面简单以及本机先做隐私/质量筛选，并给出杯子与餐具、清洁工具、数码小物三类可直接尝试的照片；选图是唯一主操作，分享入口降为补充说明。三项建议按卡片净宽而非屏幕宽度排版，标准横排，净宽 `<300dp` 或字体 `>=1.5×` 才纵排。策略保持在 app 纯 UI policy，扫描、权限和数据层语义未改。

API 34 Picker-only 设备测试真实检查标题、三项建议、选图按钮和截图，并使用真实滑动手势验证精确 320dp/2× 字体下隐私中心展开后的自动发现入口仍可到达；完整 App instrumentation 12/12。Android JVM 180/180（Domain 56、App 46、Data 78），App/Data Lint 0 error，Debug、R8 Release 与源码门禁通过。标准截图 SHA-256 为 `e8242db314ace01beb39990a0bc62196d451778e3815d2e3bcc16901a8082ed4`；Debug/未签名 Release APK SHA-256 为 `a613574db83c8d5bfe4bc28d11dcf6732312966a899ed8fba851fe23327ed95a` / `51176de1a10542a0f6e944029b7f731c1b373fe8cc566d60210a9d870b0d14d7`。这些仍是本地工程证据；外部发布阻断不变，Beta 保持 `NO_GO`。

2026-07-25 首次体验产品示例与入口布局（当前最新权威摘要）：第一页不再使用“你的日常照片 / 一件普通物品”的抽象色块，而是展示明确标注的原创扫帚示例照片、识别结果和一个具体问题，直观演示照片如何变成知识，同时不冒充用户照片。资产无人物、品牌和文字，WebP 为 56 KiB，完整来源与 SHA-256 记录在 `docs/ASSET_PROVENANCE.md`。第三页兴趣布局改用卡片内部净宽阈值：标准 411dp 使用两列，只有净宽 `<300dp` 或字体 `>=1.5×` 才纵排；标准屏两个入口同屏可见。换页在新帧清除旧焦点并回到顶部，修复从第二页底部进入第三页后开场停在中段的问题。

新增 API 34 instrumentation 真实走完三页，断言示例标签/无障碍描述、每页顶部及两个入口；标准和精确 320dp/2× 均通过，完整 App instrumentation 12/12。Android JVM 179/179（Domain 56、App 45、Data 78），App/Data Lint 0 error，Debug、R8 Release 与源码门禁通过。标准首屏/入口页截图 SHA-256 为 `2685b089cc01e11d29e890464d9c89e1ccd988c6db4efcfdd0a3568f9a28323c` / `848f72545dc25fb72a8759563db78e8053685b203ee479258a18757b30288bb0`；Debug/未签名 Release APK SHA-256 为 `bafccad6fa2d6a69cd7945d02a1ec6b825a2809a6fb8c236042877af931fdeb3` / `a58b082112193c163e3d6a0bee6959b730ac120835e784a9886a4e94b69c346b`。这些仍是本地工程证据；外部发布阻断不变，Beta 保持 `NO_GO`。

2026-07-25 卡片反馈区产品化（当前最新权威摘要）：旧反馈区把四种语义拆成不同层级，正常手机上也会因为复用主操作阈值而纵向显示四个全宽按钮，形成问卷感。当前反馈标题为“这条知识怎么样？”，中性 `surfaceVariant` 承载后果说明；标准净宽以 2×2 网格平等展示有意思、没意思、识错了、太私人，只有净宽 `<260dp` 或字体 `>=1.5×` 才纵排。布局判断留在 app 的纯 UI policy，反馈业务状态仍由现有 ViewModel/domain/data 链路处理。

API 34 标准宽度与精确 320dp/2× 字体均逐项滚动确认四个选择可达；设备测试还真实点击“太私人”，确认删除与停止分析对话框出现，并点击“保留卡片”返回。全新 `-wipe-data` AVD 最终 App instrumentation 11/11，Android JVM 179/179（Domain 56、App 45、Data 78），Lint 0 issue，Debug、R8 Release 与源码门禁通过。Debug/未签名 Release APK SHA-256 为 `8ad3f758dbeb8db5fc352b6165574ce574d336fad8cf43b10a56005c6133b2b7` / `8f946d975b1b41425e2ac61dd9565e4ba464046784a2c4862627e6a745036fae`；标准/大字反馈截图 SHA-256 为 `da30950353e546903d615acab68120e6f4dbe2e39c32f44a31802799ba6a5b76` / `942bd8f8557be17992bc33590be5aaafd9a637159897d35e37c697738b6e6c63`，仅属本地工程证据。Beta 外部阻断不变，保持 `NO_GO`。

2026-07-25 每日知识卡视觉层级与大字可达性（当前最新权威摘要）：API 34 真实截图确认旧卡片虽已知识优先，但来源卡和绿色“收藏这张知识卡”仍把阅读流拉回操作表单。当前继续保留对象把握、个性化缘由和来源可信链路；“为什么推给你”直接解释推荐，来源主视觉只显示发布者，完整来源标题进入 TalkBack 描述。收藏与物品提醒统一降为描边次级操作并使用短标签，反馈学习仍位于其后。

标准 1080×2400 与精确 320dp/2× 字体均由 API 34 instrumentation 生成真实截图；大字路径会实际滚动并确认识别、来源和收藏可达，短操作标签不再被拆成多行大圆按钮。Pixel Launcher 组件闭环同时把返回 App 后的隐私管理点击改为屏幕坐标输入，避免窗口焦点竞态造成假失败。全新 `-wipe-data` AVD 最终 App instrumentation 11/11；Android JVM 178/178（Domain 56、App 44、Data 78），Lint 0 issue，Debug 与 R8 Release 全部通过。Debug/未签名 Release APK SHA-256 为 `bdf7c425671def3fc7abcf24933ce7aedda7ec55ba54f9b10787645a2ed9647b` / `96a14430b77bc07ff1e7e3441396d3e2f83d8ee48a487e0b45acdf36f324a5bb`。标准/大字截图 SHA-256 为 `181a5abbea25ce0c15d707e1621a1954dc2bcf71c70259180241a61c906822f2` / `8b23e6d0d9de54f8d5d63d9d041aec05edd763eb4fd15e2e5b814282dd4394e8`，仅属本地工程证据；Beta 外部阻断不变，保持 `NO_GO`。

2026-07-25 真实 Qwen 结构化识别复验（当前最新权威摘要）：使用用户提供的北京百炼业务空间凭据和项目既有 CC0 自行车图片执行真实 Provider。首轮诊断请求已到达模型并返回顶层字段完整的 JSON，但 boundingBox 使用了非约定坐标形状，因此严格 Schema 失败；旧验证命令也会把文档中的 pnpm `--` 当作未知参数。当前 Qwen JSON Mode 提示固定完整对象示例、`{x,y,width,height}` 数字坐标并禁止 x1/x2、left/right、数组等替代字段；按阿里云官方结构化输出建议移除 `max_tokens`，避免 JSON 被输出上限截断。验证器兼容 pnpm 分隔符，并在任何网络请求前于内存移除 JPEG APP/COM 元数据，再拒绝残留元数据、畸形结构和尾随字节。

修正后真实 `qwen3.6-flash-2026-04-16` 在 5.46 秒内返回 `canonicalTopicId=bicycle`、`displayName=自行车`、`confidence=0.98`、`sensitiveFlags=[]`，严格 Schema 通过，且仍为单卡一次视觉模型调用。带 `X-DashScope-DataInspection` 的生产请求继续返回 `403 access_denied`，同业务空间普通模型探针为 200，因此账号侧阻断仍精确为 `ai_safety_guardrails_not_authorized`，所需角色为 `AliyunServiceRoleForSFMAccessingCIP`。省略付费护栏的本地诊断不能进入服务端生产装配，也不构成发布证据。TypeScript check/build、后端 113/113 基础测试和源码护栏 `qwenStructuredContract=1 qwenVerifierPrivacy=1` 通过；本轮未改 Android/API。真人内容审核、真实托管云、正式签名、OEM 七天运行、真人 TalkBack、200 卡抽检和 cohort 仍未完成，Beta 保持 `NO_GO`。

2026-07-25 组件信任文案与对象去重（当前最新权威摘要）：缩略图不可读取时，App 与 Glance 统一显示“原图暂不可显示”，不再用“照片保留在本机 / 照片在本机”制造候选图绝不上云的理解；这不改变明确授权、压缩去 EXIF、短暂处理和服务端删除边界。组件对旧缓存卡 `title == detectedObjectName` 增加去重，高置信度对象名只显示一次，中低置信度与更丰富标题继续显示识别提示。源码护栏拒绝旧文案并要求去重测试存在。

API 34 Pixel Launcher 端到端测试真实完成 Pin、桌面渲染与安装完成态：组件无照片夹具显示“见微 · 今日”和“原图暂不可显示”，无障碍树中“自行车”恰好一个。Android JVM 178/178（Domain 56、App 44、Data 78）、App instrumentation 11/11、Debug/Release Lint 0 error/42 warning、Debug 与 R8 Release、源码护栏和差异检查全部通过。Debug/未签名 Release APK SHA-256 为 `c6e058a75b9202d93e291bfaed1db3c3d789015d2a80b7fb4c53fb2837c2edc7` / `b22a7ee1dc9438f2be67095699eeb5edf86452ba67e12501a3b6b22675090207`；组件截图 SHA-256 `8821da053e0b0731d5a1480998a7c1ab2f1730919f636f5ab62116df08b89f06`，明确只属模拟器工程证据。真人知识审核、真实托管云、正式签名、OEM 七天运行、真人 TalkBack、200 卡抽检和 cohort 仍未完成，Beta 保持 `NO_GO`。

2026-07-25 单次模型调用卡片管线（当前最新权威摘要）：此前每张候选先调用视觉模型，再把已经选定的审核事实、来源 ID 与对象名交给同一远端模型生成标题；第二次调用不产生正文价值，却增加一次模型成本和最多一个完整 Provider 超时，并可能因标题 JSON/ID 回传异常丢弃一张已有可靠事实的卡片。当前远端 Provider 只保留视觉识别。服务端以审核目录对象名和 `factId` 稳定选择三种不增加事实的安全标题模板，限制 30 字；低置信度继续由 0.72 阈值策略覆盖为“这可能是…”。正文、事实 ID 和来源始终由目录直接进入卡片，不再发送给标题模型，也不存在模型改写或伪造它们的入口。

TypeScript check/build 与后端 112/112 基础测试通过，13 项 PostgreSQL 测试在普通环境显式 skipped；API 契约、源码护栏 `singleModelCallCardPipeline=1`、E2E 自测和内存仓储编译服务 TCP 闭环通过。隔离 PostgreSQL 17.10 再次完成全部 13 个迁移、13/13 集成测试与编译服务 TCP 闭环，内存/PostgreSQL 两种闭环都输出 `deterministicTitle=1`，结束后数据库进程已停止。本轮未改变 Android/API 数据结构，所以沿用前一轮已验证 APK，不把它冒充为新构建证据。百炼生产内容安全授权、真人知识审核、真实托管云、正式签名、OEM 七天运行、真人 TalkBack、200 卡抽检和 cohort 仍未完成，Beta 保持 `NO_GO`。

2026-07-25 WRONG_OBJECT 终止反馈闭环（当前最新权威摘要）：此前“识错了”正确地不惩罚用户对主题的兴趣，但只保存一条零权重反馈；错误卡片继续存在于每日页、收藏和组件，服务端同步还会重新写入 `scheduled`，已收藏卡也继续保留 +0.5 的错误主题信号。当前使用既有 `archived` 卡片状态建立终止语义。Room 单一事务提交反馈状态/outbox、卡片归档、SAVE 信号撤销、收藏清除和提醒 DELETE outbox；App 取消对应提醒 Work。Repository 在卡片下载前先发送 WRONG_OBJECT，并把尚未完成整页提交的 outbox 保留为显示屏障；即使反馈请求期间旧进程重新写卡、服务端返回陈旧 `scheduled` 页面，落库仍强制为 archived，确认后才删除 outbox。文件数据库测试证明事务提交后立即崩溃、重启仍保留上述状态；仅有 archived 卡片时不再误记“首卡可用”。

服务端内存与 PostgreSQL 仓储同步实现终止语义：每设备/卡片的普通反馈与 TOO_PRIVATE 共用 advisory lock，首次 WRONG_OBJECT 归档卡片并抵消同卡既有 LIKE/DISLIKE/SAVE 对主题权重的影响，之后陈旧 LIKE/SAVE 返回已有 WRONG_OBJECT 且不再训练。API 端到端测试覆盖 SAVE +0.5 → WRONG_OBJECT 归零 → 卡片 archived → 陈旧 LIKE 仍为零；真实 PostgreSQL 17.10 完成 13 次迁移、13/13 集成测试和编译服务 TCP E2E。Android Clean Architecture 的影响是把原子业务提交留在 data/Room、同步编排留在 Repository，domain 继续保持纯 Kotlin，UI 只负责准确文案和取消提醒副作用。

最终验证为后端 115/115 基础测试、TypeScript check/build、API 契约和源码护栏 `wrongObjectTerminal=1` GO；Android 43 个 JVM 套件 176/176、API 34 Data 58/58 + App 11/11，最终反馈类 15/15 重跑；App/Data Debug/Release Lint 分别 0 error/42 warning、0 error/22 warning，Debug 与 R8 Release 成功。Debug/未签名 Release APK SHA-256 为 `ad37b102062814e489de03cc86642e7c1832a6dbd09a039eee8ea8438407d8f1` / `b80cb1db74bc5e78d75ab9480c4d8f830e452e15fdab1bc4ea366d1073cf8c40`。测试包、模拟器、ADB、QEMU 和 PostgreSQL 均已清理。以上仍是本地工程证据，不替代百炼生产护栏、真人知识审核、真实托管云、正式签名、国产 OEM 七天运行、真人 TalkBack、200 卡抽检或 cohort；Beta 保持 `NO_GO`。

2026-07-25 卡片对象命名与拍摄日期可信边界（当前最新权威摘要）：此前视觉模型命中目录主题后，标题编辑和推送理由使用审核目录的对象名，但持久化 `detectedObjectName` 与低置信度标题仍使用模型原始 `displayName`；模型返回同义词时，一张卡可能同时出现“清扫刷”和“扫帚”。当前模型只负责主题候选与置信度，目录命中后以 `topic.displayName` 统一标题输入、低置信度标题、识别对象、推送理由与事实正文；目录对象名限制为清理空白后的 1–60 字，匹配 API 与数据库约束。端到端测试让模型返回“清扫刷”、目录命中“扫帚”且置信度 0.68，最终标题为“这可能是扫帚”、识别对象和拍摄理由也只使用“扫帚”。API 会在创建上传目标前拒绝 `2026-02-31`，历史任务若带无效日期则降级为不含日期的授权来源说明。

最终验证为后端 114/114 基础测试通过、13 项 PostgreSQL 集成测试按环境显式 skipped，TypeScript check/build、API 契约（13 个服务操作、8 个 Retrofit 操作、1 个原始上传、9 个 DTO）、真实回环 TCP 完整闭环与源码护栏 `canonicalCardIdentity=1 strictCapturedAtBucket=1` 全部 GO。首次 TCP 命令仅因受限沙箱禁止绑定 `127.0.0.1` 返回 EPERM，随后在获准的本机回环隔离环境原命令通过。本轮没有 Android/API 结构变更，未重建 APK；以上仍是本地工程证据，不替代真实 Qwen/OSS/PostgreSQL/HTTPS、真人事实审核、200 卡抽检、正式签名、OEM 实体机、真人 TalkBack 或 cohort，Beta 保持 `NO_GO`。

2026-07-24 首卡落库时延（当前最新权威摘要）：此前 `MainActivity` 在 Compose 看见任意卡片时才调用 `markFirstCardObserved`。若 WorkManager 已在后台生成并缓存首卡，指标会一直等到用户下次打开 App，把离开页面的时间错误计入“首卡生成耗时”，无法可信验收 P50/P95。当前 domain 新增 `FirstCardMetricRecorder` 端口，App 的 `BetaMetricsStore` 负责本地幂等持久化，data 的 `RoomCardRepository` 只在完整分页验证通过、非空批次成功写入 Room 后记录本机时间；UI 观察补记已删除。记录器异常被隔离在已提交事务之后，不会把卡片同步变成失败重试。组件添加口径同时确认只在 `AppWidgetManager` 查询到真实组件 ID 后标记，`requestPinAppWidget` 的 accepted 返回值不计成功。

API 34 设备测试先用空响应证明不记首卡，再同步非空合成卡片并确认 Room 已更新且只记录一次；另用抛异常记录器证明同步仍成功、卡片仍已提交。指标导出测试重复提交两个首卡时间，最终保持首次 89 秒。`.tooling/truthful-beta-metrics-audit/audit.json` 更新为 schema 2，状态 `GO`、`releaseEvidence=false`，SHA-256 `b39caf9435f0d1bcae1675ee6ae60fc488a3539271474c91b57c52895f4e4169`。完整回归为 38 个 JVM 套件 146/146、API 34 instrumentation 56/56（App 6、Data 50）、源码守卫 `FIRST_CARD_COMMIT_METRIC_GATE=GO`、App Debug/Release Lint 0 error、32 warning，Debug 与 R8 Release 成功。Debug/未签名 Release/App/Data instrumentation APK SHA-256 分别为 `f18e3a6a5112708eeadf5089a3881f7cd0744f4f4e8adc2dffc8c456f93bab5d`、`f65d3de90abfea21141937834ec8674c547d56dc98fb939749a7c6b78fd27058`、`81e86ee8bacf3238503ec542300a55d3bbae727b80e14c6e7e66208af6aea119`、`b0d02628ac312790bb338066cd3ff771107f8ae0f138ca20868af95ad307634d`。这些仍是模拟器与合成卡片证据，不构成真实首卡分位数、真实组件添加率、真实云、正式签名、OEM 实体机、真人审核/TalkBack、200 卡抽检或 cohort，Beta 保持 `NO_GO`。

2026-07-24 Beta 指标真实语义（当前最新权威摘要）：此前收藏首次切换会被记录为 `FeedbackAction.SAVE`，同时增加互动、反馈总数，却不增加 LIKE 数，导致 Beta 的“有意思反馈率”被收藏动作错误压低；从组件或提醒成功打开有效卡片也没有记录互动，导致“7 日内卡片点击或反馈”漏记。当前 domain 提供 `isCardFeedback()` 作为业务边界，SAVE 只记录互动，`BetaMetricsStore.markFeedback` 对 SAVE 失败关闭；`MainActivity` 仅在 card ID 已由 ViewModel 解析成有效 `focusedCard` 后记录回卡互动，未知或失效参数不会直接计数。

API 34 使用真实 Room、SharedPreferences 与合成卡片执行两项设备测试：分别证明 `feedbackCount=1/likeCount=1` 不受 SAVE 污染、有效精准回卡写入 `firstEngagedAt` 且反馈计数仍为 0；导出的本地报告不含 `photoPath`、`contentUri` 或 `candidateToken`。`.tooling/truthful-beta-metrics-audit/audit.json` 为 `GO`、`releaseEvidence=false`，SHA-256 `28223cf0d8646df6309939244d018aa7308a5f9e18e025a9e8e2c939c57ec08a`。完整回归为 38 个 JVM 套件 146/146、API 34 instrumentation 54/54（App 6、Data 48）、源码守卫 `truthfulBetaMetrics=1`、App Debug/Release Lint 0 error、32 warning，Debug 与 R8 Release 成功。Debug/未签名 Release/App/Data instrumentation APK SHA-256 分别为 `7cd55769c8f5b017e4a99a52cbd48a258e6f6b467d0dcb14bfe584d3cf04555c`、`0a17ea45e1d8c4b93d3ccfc71d09e8b3b574b2e796f5508c7c91cc9f37e4b0b7`、`e51553e2e692cc1705513fa96a326055f643cdc6e4b907d8c28397b36ff8146c`、`281bb02afafe20dc49842294b7a4bd84257a333068b135a6f8d739e673fc8269`。实际 `check-beta-readiness` 仍因 `evaluation/beta-evidence.json` 缺失返回 `NO_GO`；上述结果只证明采集语义与本地边界，不构成真实 cohort、真人内容审核、真实云、正式签名、OEM 实体机、真人 TalkBack 或 200 卡抽检证据。

2026-07-24 Android 分享导入产品化（当前最新权威摘要）：此前 `ShareReceiverActivity` 绕过首页的用户操作门，直接复制并排队，没有进行中状态、可重试失败状态或暂停语义；成功后还可能创建第二个首页。当前 domain `ImportPhotosUseCase` 成为 Photo Picker 与 Android Sharesheet 的共同业务边界，导入后只在分析未暂停时排队。分享页使用单例 `UserOperationGate`，冲突、异常和不可读均留在原页并允许重试；进度文案区分私有复制与上传，`MainActivity` 使用 `singleTask`，外部结果只接受已知 disposition 和 0–20 的合法数量。

API 34 用合成 JPEG 实跑标准布局与精确 320dp/2× 字体：删除操作占门时导入被拒绝且可重试；释放后生成一条 `PHOTO_PICKER` 私有副本，Room URI 为 `file:` 且不含来源 `content://`；分析暂停期间 `jianwei-imported-analysis` 无 ENQUEUED/RUNNING/BLOCKED Work；返回的是原首页实例。`.tooling/shared-import-flow-audit/audit.json` 为 `GO`、`releaseEvidence=false`，SHA-256 `2949ec0196268f59b36bd7276ce92c77bb1d53e184d72d0202aede4286c6eb8f`。完整回归为 38 个 JVM 套件 145/145、API 34 instrumentation 52/52（App 4、Data 48）、源码守卫 `sharedImportFlow=1`、App Debug/Release Lint 0 error、32 warning，Debug 与 R8 Release 成功。Debug/未签名 Release/App/Data instrumentation APK SHA-256 分别为 `7cf23e0700f88ff997cf2bec4aeaffebdffcf8f9900abdc57b773cd0b15fd3c6`、`1f83474c1148b48e6ef1c3d5d7a7c9b42cbdf24b0127ea306d0b8109c2e998c3`、`4979700deaf7cde4410d9f60e98e1d24eb7fc741bfe547a93ed26a2a239f1d6c`、`61b03063a0694a6492ddc78a297569d5660b6c51e4f17a540932b8e99f0b15e6`。这些是模拟器与合成图片证据，不替代真实云、正式签名、OEM 实体机、真人内容/无障碍验证、200 卡抽检或 cohort；Beta 保持 `NO_GO`。

2026-07-24 用户操作串行化（当前最新权威摘要）：此前 `MainViewModel` 会为每次点击直接启动独立协程，多个收藏、反馈、提醒、暂停、清索引或云端删除可以并发执行；任一较早任务结束还会提前清掉全局 busy，页面继续接受冲突命令，顶部统一“照片分析”也无法说明实际在做什么。当前 `UserOperationGate` 以 `AtomicReference` 在启动协程前原子接纳一个操作；其他入口失败关闭，只有匹配的活动操作才能释放。取消异常保持结构化并发语义，完成时基于最新 UI 状态收口。Compose 对卡片、偏好和隐私区全部 mutation 统一禁用，并分别展示“正在保存反馈 / 正在设置提醒 / 正在删除云端数据”等具体状态；后台照片流水线仍显示独立“照片分析”。

并发单元测试让 16 个线程同时点击，只接纳 1 个操作，并验证错误 operation 无法释放门。API 34 标准布局使用受控悬挂响应保持删除进行中，快速点击清索引后仍只有删除活动；accessibility hierarchy 中导入、暂停、清索引和再次删除父节点均 `enabled=false`。精确 320dp/2× 字体下，云端删除按钮与确认对话框完整可达，确认后“正在删除云端数据”和 `content-desc=操作进度` 同时可见。审计 `.tooling/serialized-user-operations-audit/audit.json` 为 `GO`、`releaseEvidence=false`，SHA-256 `60723b4b986bdabdecfcfeca7b7e8d4052b06424a1f3cc1a86efdc55a93ea011`，不含真实照片、身份、令牌或网络请求日志。完整回归为 36 个 JVM 套件 139/139、API 34 instrumentation 51/51（App 3、Data 48）、源码守卫 `serializedUserOperations=1`、App Debug/Release Lint 均 0 error、32 warning，Debug 与 R8 Release 成功。Debug/未签名 Release/App/Data instrumentation APK SHA-256 分别为 `99420560f24c5feafb4d779e8580c1333d1c7663316ab4b71f914627ced17deb`、`6b8f8189b3a4aa0462ebc511252300878ffa8e72435e548d0531bd5bfdc8e897`、`4ffa7b1dd437115cb057a3c96e1a29732d216e8c09ecffb8c00a3c06e9c2ea70`、`aa8a793aaaedaea5d7988dd698c8aa2ea8142df59198993c87bc967941ad529b`。`check-beta-readiness` 仍因真实证据文件缺失返回 `NO_GO`；本地模拟器证据不替代真实云、正式签名、OEM 实体机、真人内容审核、真人 TalkBack、200 卡抽检或 cohort。

2026-07-24 首页滚动状态隔离（当前最新权威摘要）：此前每日、收藏和组件/提醒精准入口共用 `LazyColumn` 的隐式状态；用户在每日历史中滚动很深后通过 `onNewIntent` 打开目标卡，精准页可能继承旧索引，直接落到卡片中部并把入口说明和返回动作滚出首屏。当前 Compose 为三种模式分别持有 `LazyListState`，只按当前模式注入列表；`focusedCardId` 每次变化都把精准列表滚到 0，关闭时不破坏每日或收藏原位置。源码守卫固定 `independentHomeScroll=1`。

API 34 使用 12 张无照片夹具实跑。标准布局从历史“拉链”位置打开 7 月 25 日“保温杯”，首屏出现“打开的知识卡 / 返回每日卡片 / 7月25日识物”；将精准页滚动后再打开 7 月 26 日“回形针”，入口再次回顶；关闭后列表仍在“拉链”，证明精准、每日状态既隔离又各自保留。精确 320dp/2× 字体下，从历史“马克杯”打开目标时顶部入口和计划日期可达，滚动后能读到“保温杯”，切换第二目标后再次从“7月26日识物”顶部开始。`.tooling/independent-home-scroll-audit/audit.json` 为 `GO`、`releaseEvidence=false`，SHA-256 `bc37eeda04b2bb3fdf0e1fcc21294d2059ce573e887e0b2d3dc3c164190ee77a`。完整回归为 35 个 JVM 套件 135/135、API 34 instrumentation 51/51（App 3、Data 48）、App Debug/Release Lint 均 0 error、32 warning，Debug 与 R8 Release 成功。Debug/未签名 Release APK SHA-256 为 `3d747d4ae9f189772676f45282ea9b4691c937e928608896221007e839db212f` / `60ce0c7de70b7609976edb52d3c3134c70ccdf8ef70238cbccef3e16416bd928`。这些仍是本地模拟器与合成夹具证据，不替代 OEM 实体机、真人内容审核、真实云、正式签名、真人 TalkBack、200 卡抽检或 cohort；Beta 保持 `NO_GO`。

2026-07-24 真实卡片日期与历史分区（当前最新权威摘要）：每日页虽然已经正确隐藏未来缓存并按日期倒序，但卡片标题上方仍固定写死“今日识物”，导致昨日和更早的卡片在阅读时被错误描述成今天内容。当前新增纯 Kotlin `CardDatePolicy`，以传入的中国自然日为唯一基准，区分 TODAY/HISTORY/UPCOMING，并生成“今日识物”“昨日识物”、同年月日和跨年完整日期；未来精准入口显示计划日期。Compose 每日流按相同规则增加“今天 / 往日”分区，收藏页与精准入口都复用同一标签，无障碍节点明确暴露“卡片日期”。

API 34 使用四张无真实照片夹具实跑：标准布局首屏出现 `今天 + 今日识物`，滚动后出现 `往日 + 昨日识物`，跨年卡为 `2025年12月31日识物`；组件同协议打开 2026-07-25 未来缓存时，精准入口显示 `7月25日识物` 而不是“今日识物”。精确 320dp/2× 字体下，“往日”和“昨日识物”均可达且日期无障碍语义存在；crash buffer 为空，显示设置、Debug 包和夹具已清理。`.tooling/truthful-card-date-audit/audit.json` 为 `GO`、`releaseEvidence=false`，SHA-256 `f96a65ab64e11279b01ce6bb62e9466d8ae87fbdf6845362d3be4c399d092a34`。完整回归为 35 个 JVM 套件 135/135、API 34 instrumentation 51/51（App 3、Data 48）、源码守卫 `truthfulCardDates=1`，App Debug/Release Lint 均 0 error、32 warning，R8 Release 成功。Debug/未签名 Release/App/Data instrumentation APK SHA-256 分别为 `eb0ba918e62818cd9a0ab806bbc3c4180c90b8ddbc3c386d0a8ba986332d0dcc`、`5f55d331f797f20b3bf3b117dc98551c8adddb4cea3519ceaefd6678cf005634`、`4ffa7b1dd437115cb057a3c96e1a29732d216e8c09ecffb8c00a3c06e9c2ea70`、`aa8a793aaaedaea5d7988dd698c8aa2ea8142df59198993c87bc967941ad529b`。这些仍是本地模拟器与无照片夹具证据，不替代真人内容、真实云、正式签名、OEM、真人 TalkBack、卡片抽检或 cohort；Beta 保持 `NO_GO`。

2026-07-24 精准回卡独立入口（当前最新权威摘要）：桌面组件或物品提醒此前通过 `focusedCardId` 把目标卡直接插到普通每日列表顶部；如果目标是未来离线缓存，它会在整个 ViewModel 生命周期持续混入今天/历史内容，页面也没有说明进入来源、可见返回路径或目标失效状态。当前 domain 改为返回 `DailyCardPresentation`：普通 `dailyCards` 永远只含今天及过去的 scheduled 卡；合法组件/提醒 card ID 只解析为独立 `focusedCard`，未知、已删除或非 scheduled 目标解析为 `UNAVAILABLE`，不会改用另一张卡冒充成功。Compose 精准入口隐藏每日/收藏页签、推荐偏好和隐私管理，只展示目标卡及“返回每日卡片”；系统返回先退出精准模式。失效入口只显示一次“这张卡已不可用”和一个返回动作。

API 34 以无真实照片的今日扫帚卡和未来牙刷卡实跑：普通启动为 `today=1 future=0 focusedHeader=0 dailyTab=1`；发送与组件相同的 `CLEAR_TOP|SINGLE_TOP + EXTRA_CARD_ID=future-focus-card` 后为 `future=1 today=0 focusedHeader=1 returnAction=1 dailyTabExact=0 savedTab=0`。点击可见返回和系统返回都恢复 `today=1 future=0`，且系统返回保持 App 可见；无效 ID 为 `unavailable=1 returnCount=1 today=0 future=0`。精确 320dp/2× 字体下，入口说明/返回首屏可达，滚动后标题、正文、来源、收藏、提醒和反馈全部可达；显示设置已恢复，冷启动 crash buffer 为空。`.tooling/focused-card-entry-audit/audit.json` 为 `GO`、`releaseEvidence=false`，SHA-256 `b3b99993502ae711ff5d5b4fcff52b93dde9f2f6d00b11a10ef2473003fe2009`。完整回归为 JVM 130/130、API 34 instrumentation 51/51（App 3、Data 48）、源码守卫 `focusedCardEntry=1`，App Debug/Release Lint 均 0 error、32 warning，R8 Release 成功。Debug/未签名 Release/App/Data instrumentation APK SHA-256 分别为 `9086669c452743106396cdce0ac6461c623a0151362ca38393c6efe45eb0ca1f`、`7cbae81c84038bbfb64142943f0bb7f0b009ec60a5391b3aefc64b8d4d789ba3`、`4ffa7b1dd437115cb057a3c96e1a29732d216e8c09ecffb8c00a3c06e9c2ea70`、`c0a038593e11942198c6db8cde9eea0daf6d2dfd1c185018491faa4a57d24d27`。这仍是本地模拟器工程证据，不替代正式签名、OEM 实体机、真实内容/云或 cohort；Beta 保持 `NO_GO`。

2026-07-24 用户可控推荐兴趣（当前最新权威摘要）：首次体验要求用户选择 3 项兴趣，但此前完成引导后没有查看或修改入口，候选排序 Worker 还会永久读取引导期 SharedPreferences，长期个性化闭环并不成立。当前 domain 统一定义五类兴趣、恰好三项的选择规则、默认回退与排名词扩展；data 提供兼容原 `onboarding/interests` 数据的持久 Repository，ViewModel 公开可观察状态并负责保存，`PrivacyScanWorker` 通过同一 Repository 获取排序词，不再直接读取 UI 偏好。首页新增“你的推荐偏好”，展示当前三项并允许编辑、取消和保存；文案明确显式选择只从下一批新照片开始影响候选排序，卡片反馈会独立学习但不会静默改写用户选择。未知或损坏的旧偏好失败关闭为安全默认，少于或多于三项均拒绝覆盖有效状态。

API 34 标准 1080×2400/420dpi 实跑完成“物件历史 → 制造工艺”替换并保存，应用私有偏好精确持久为 `生活设计/科学原理/制造工艺`；强停冷启动后首页仍显示相同摘要。精确 320dp/2× 字体下五个选项和取消/保存均可滚动到达，常规首页层级没有被偏好卡挤乱，冷启动 crash buffer 为空。完整回归为 34 个 JVM 套件 130/130、API 34 instrumentation 51/51（App 3/3、Data 48/48），其中新增设备测试覆盖 Repository 重建、变更流和非法选择不覆盖；源码守卫输出 `userInterestControl=1`，App Debug/Release Lint 均为 0 error、32 warning，R8 Release 成功。Debug/未签名 Release/App/Data instrumentation APK SHA-256 分别为 `f239c5c2a1e77f3a108c552104db25cf7bc453b659f5188dfe217b830c8b33f3`、`66d535b157874b8ce6ab51ae85f91240685b05671213ac753959fd1306bbd7dd`、`4ffa7b1dd437115cb057a3c96e1a29732d216e8c09ecffb8c00a3c06e9c2ea70`、`0a865657eb58ecb6e1a038553b0d673905d496ab26031b24222ee4187a3c1627`。该结果是本地产品与工程证据，不是正式签名、实体机、真人内容审核、真实云或 cohort 证据；Beta 保持 `NO_GO`。

2026-07-24 真人知识审核批次操作性（当前最新权威摘要）：工作台现在把服务端最终门禁前置为逐事实即时预检，每条卡直接显示“待处理/已就绪”和缺失项；批次区提供全部、待处理、已就绪筛选及“下一条待处理”，并同时显示就绪数和待处理数。普通批准必须核对全部引用来源、确认完整语义和不支持结论，正文保持 28–80 字；健康/安全等高风险事实额外显示醒目指引，并且至少有两个 official/professional 来源且全部勾选才可就绪。批次未全部就绪时“完成人工审核批次”保持禁用。保存失败或 409 内容冲突会展示“导出本地恢复草稿”；草稿保留本页 decisions 与修订元数据，但不含 CSRF，并明确不能直接应用目录或构成真人签注。真实 Android 14 Chrome 正常闭环输出 `initialOpen=2 readyFilter=1 nextOpen=1 highRiskTwoSourceGate=1 completedReady=2 finalizeFlush=1 finalized=1 autoApply=0 runtimeExceptions=0`；独立的不同内容并发写入输出 `serverRevision=1 localInputPreserved=1 competingContentPreserved=1 explicitReload=1 recoveryDraft=1 csrfExcluded=1 destructiveAutoReload=0 runtimeExceptions=0`。这只证明本地审核工具可安全支撑责任人工作，不是 624 条事实的真人语义审核；目录仍为 0 真人签注，Beta 保持 `NO_GO`。

2026-07-24 真人知识审核工作台状态一致性（当前最新权威摘要）：原浏览器客户端在第一次自动保存后会把 `model.decisions` 替换成服务端反序列化对象，但已渲染控件仍闭包引用旧对象；保存请求进行中产生的新编辑也可能被响应覆盖，409 还会自动重载页面。这三条路径都可能让责任人的审核记录静默丢失。当前独立 `review-workbench-client.mjs` 以 `editVersion` 和单一 in-flight 保存串行化修订，服务端响应只更新修订元数据并保留当前 decisions 数组/对象身份；请求期间发生编辑会保持 dirty 并补存，完成批次前必须 `flush()` 到干净状态。409 不再自动重载，而是保留本页输入、禁用保存/完成并提供带二次确认的“重新加载服务端版本”。真实 Android 14 Chrome 回归还发现外部 Intent 打开一次性入口时 `SameSite=Strict` 会消费令牌却不携带新 Cookie，现改为适用于顶层导航的 `SameSite=Lax`；POST 仍同时受回环 Host、同源 Origin、CSRF 和一次性入口保护。合成双来源健康事实在真实 Chrome 中完成两次自动保存、完成前最后一刻编辑、最终写批次但不自动应用，结果为 `decisionIdentityPreserved=1 finalizeFlush=1 autoApply=0 runtimeExceptions=0`；独立并发版本回归为 `localInputPreserved=1 explicitReload=1 destructiveAutoReload=0`。单来源健康事实仍被双权威来源规则拒绝。以上是本地工程/体验证据，不是 624 条真人语义审核，目录仍为 0 真人签注，Beta 保持 `NO_GO`。

2026-07-24 知识来源与人工审核准备度（当前最新权威摘要）：此前系统解析器把 49 个公开来源主机统一映射到保留的 `198.18.0.0/15` 代理假 IP，安全请求器因此把 531 个来源全部判为基础设施失败并拒绝覆盖正式证据。当前新增非默认 `--google-doh` 模式：只向固定 `https://dns.google/resolve` 查询、拒绝重定向、校验响应 Question 与 A/AAAA 类型；解析结果仍经过原公网地址白名单，来源连接继续钉扎 vetted 地址并以原 hostname 完成证书/SNI 校验。私网 DoH 回答、私网重定向、混合地址和解析异常继续失败关闭。实际网络运行证明状态批准候选 13/13、全部编辑来源 531/531 可达，规范证据 SHA-256 为 `dfdc08abd113e113532c675a93237b2cbf1dae80990ecd042f3df2f2eec0f7dd` 和 `718c7d19c8b0a6a488885f6ca52402a590e0988d748185a21fed0884cc74b7bb`。审核队列已重建为当前目录 `2026-07-19-beta.62` 的 200 个可审核主题、624 条待审事实，绑定来源证据且 `grantsApproval=0`；JSON/Markdown SHA-256 为 `bb4a0f50c4daa5038b0c7cbc24a8c75087dd68640b5b53388cc4960a13f06253`、`af92d6e9437b82194e33f14385e62a47d0c8a98b681919adb1a209c7e4d59e19`。首批 20 条工作台预检全部 `pending`，自测继续要求 loopback、CSRF、一次性入口、真人检查点、不可自动应用。`.tooling/knowledge-source-results/review-readiness-audit.json` SHA-256 为 `9a411b498af63e5af423efadbd512891a00527067c7e11481e49d7d6e952fc01`，明确 0 条真人签注、未验证语义支持、非发布证据。来源可达不代表来源支持中文事实；624 条仍须真人逐条核验，Beta 保持 `NO_GO`。

2026-07-24 物品提醒卡片存在性收口（当前最新权威摘要）：提醒能否发送现在由 Room 单条 `SELECT EXISTS` 原子判断，查询联结 `local_tracked_items` 与 `knowledge_cards`，并同时要求追踪未进入 `DELETE`、启用日和周期与 Work 输入一致。这样不会在多个 Repository 读取之间制造观察窗口，也不会因为追踪行残留而通知一张已删除、无法打开的卡片。API 34 使用真实 WorkManager 验证三条路径：有效卡片和追踪会发布通用通知，其实际 PendingIntent 可按允许的 Android 14 模式启动 MainActivity 并带回精确 card ID；只删除知识卡、保留追踪行时，独立陈旧 Work 到达 `SUCCEEDED` 但不通知；恢复知识卡后只删除追踪行，另一独立陈旧 Work 同样不通知。`.tooling/reminder-privacy-audit/audit.json` 为 `GO`，但明确 `physicalNotificationTap=false`、`releaseEvidence=false`，SHA-256 `123a12f1bacc6dbc911337c74a4bed46e03c15ff7da8c3b515fb041b8372a3b8`。完整回归 JVM 126/126、API 34 instrumentation 49/49（App 3/3、Data 46/46）、源码守卫 GO（`reminderCardPresence=1 reminderCardDeepLink=1 reminderPrivacyGuard=1 genericReminderContent=1`）、App Debug/Release Lint 0 error（22/8 warning）、R8 Release 成功；Debug/未签名 Release/App/Data instrumentation APK SHA-256 分别为 `ddfa738b29a9dee0b823459be203b70620f96b2f5b9f99ba5a9d550c5f45b73a`、`1cebe1f4ddb82247e980381463406913a987a815816545938c3006adb1025df0`、`4ffa7b1dd437115cb057a3c96e1a29732d216e8c09ecffb8c00a3c06e9c2ea70`、`573511c75fc5e70ba6ddc72038c09badef43f41d83052399a4b4d86c4fc00344`。实体机真人点击、正式签名、真人内容审核、真实云、国产 OEM、真人 TalkBack、200 卡抽检和 10–50 人 cohort 仍未完成，发布结论保持 `NO_GO`。

2026-07-24 物品提醒精准回卡（当前最新权威摘要）：通知现在通过 `MainActivity.EXTRA_CARD_ID` 携带被追踪卡片 ID，复用桌面组件已经验证的聚焦协议；MainActivity 冷启动和任务复用分别在 `onCreate` 与 `onNewIntent` 消费该 ID。卡片标题仍不进入 WorkManager 输入或通知正文。API 34 实测先证明直接从后台测试进程发送 PendingIntent 会被 Android 14 后台 Activity 启动策略拦截，再以系统允许的 `MODE_BACKGROUND_ACTIVITY_START_ALLOWED` 重放允许启动的通知 PendingIntent，最终观察到 MainActivity 进入 resumed 且 Intent 中 card ID 与追踪记录完全一致。审计没有把这写成真人点击：`.tooling/reminder-privacy-audit/audit.json` 明确 `physicalNotificationTap=false`、`releaseEvidence=false`，SHA-256 `34aaecadc89d6cd5922e241d2547a78361fbf32ed4bcf8c7fa092adc4a2502f7`。完整回归 JVM 126/126、API 34 instrumentation 49/49（App 3/3、Data 46/46）、源码守卫 GO（`reminderCardDeepLink=1 reminderPrivacyGuard=1 genericReminderContent=1`）、App Debug/Release Lint 0 error（23/9 warning）、R8 Release 成功；Debug/未签名 Release/App/Data instrumentation APK SHA-256 分别为 `ea717910e33d51dd6524241dae80846ce247766f1349c5d0e9481c7c26b28dcd`、`1c505805766d49337f8a83eba175af2e9626c58fc2e44bc293797e21c4d16302`、`1b3c26bf73a60dc66a07d4c4bf05c56a07ec9c3abf9cce80ee9e50583c021e50`、`e78678b22e71a8d91f85ae2b5e43aaf40c8ba55387673b3559bf58d6d3dbb151`。实体机真人通知点击、正式签名和其他外部 Beta 证据仍未完成，发布结论保持 `NO_GO`。

2026-07-24 物品提醒隐私收口（当前最新权威摘要）：此前“太私人”的 Room 事务会删除追踪记录，但 WorkManager 取消发生在事务之后；若进程恰在两者之间退出，旧提醒仍可能带着卡片标题运行。当前 `ItemReminderWorker` 已改为 `@HiltWorker` 注入 `CardRepository` 的 `CoroutineWorker`，通知前必须重新确认持久追踪仍存在、未进入 `TRACK_DELETE`，且启用日与周期和 Work 输入完全一致。除此之外，Work 输入和系统通知正文都不再保存或展示卡片标题：正常提醒只显示通用文案，因此不能把“查完状态到发通知之间”不可原子化的系统边界冒充为绝对无竞态。API 34 使用真实 WorkManager 和 NotificationManager 验证两条路径：有效追踪会成功通知，且 title/text/bigText 不含“隐私测试物品”；删除 Room 追踪后再执行独立陈旧请求，Work 仍安全完成但通知不存在。AndroidX Hilt Worker 工厂已真实生成并由 WorkManager 实例化。`.tooling/reminder-privacy-audit/audit.json` 为 `GO`、`releaseEvidence=false`，SHA-256 `1a17bd0072ff538a93aa772e2b40245197a378ef3a335fd8af83bad4ed7366a1`。完整回归 JVM 126/126、API 34 instrumentation 49/49（App 3/3、Data 46/46）、源码守卫 GO（`reminderPrivacyGuard=1 genericReminderContent=1`）、App Debug/Release Lint 0 error（23/9 warning）、R8 Release 成功；Debug/未签名 Release/App/Data instrumentation APK SHA-256 分别为 `55b85f5eb883a4c8408d72c10110dcba37d05523cc4184e099bc354eb09288bc`、`ee8a729592f8b12719d3200bb5885ff95b689befd9c759347eae325a0a4e63b4`、`d50b2e0536f5c295045a13112a5d7a26c3bd434ad4e3f0a11f1c5a2b060d7200`、`e78678b22e71a8d91f85ae2b5e43aaf40c8ba55387673b3559bf58d6d3dbb151`。这不替代真人内容审核、真实云、正式签名、国产 OEM、真人 TalkBack、200 卡抽检或 10–50 人 cohort，发布结论保持 `NO_GO`。

2026-07-24 持久反馈闭环（当前最新权威摘要）：卡片普通反馈现为设备端持久状态而非一次性 Toast。一张卡只接受首个 LIKE、DISLIKE 或 WRONG_OBJECT；Room 10 在单一事务中提交 `card_feedback_states`、待同步 outbox 和主题权重，重复点击或冲突动作返回已生效选择且不会再次训练，服务端同步移除 outbox 后状态仍保留。SAVE 的 outbox 与权重同样原子提交。“太私人”是始终可用但必须确认的独立隐私操作；确认事务会撤销该卡此前 ordinary/SAVE 的主题贡献、只施加 TOO_PRIVATE 信号，然后提交隐私屏障、抑制候选、删除提醒、卡片和级联收藏。9→10 迁移会把旧版本尚未同步的多个普通动作压缩为最新一个并验证级联删除。API 34 真实 Debug UI 证明四个普通/隐私入口可见，选择 LIKE 后页面变为“已反馈 · 有意思 / 不会重复记录”，强停重启后普通按钮仍不再出现；隐私弹窗明确提供“保留卡片”和“删除并停止分析”。取消后数据库仍为 `card=1/state=LIKE`；确认后首页进入无卡状态，数据库为 `card=0/outbox=TOO_PRIVATE/state=0/photo=NEVER_ANALYZE/suppressed=1/topicAffinity=-0.75`。审计使用无真实照片的本地夹具，`.tooling/feedback-experience-audit/audit.json` 为 `GO`、SHA-256 `3d3c78932772ee175b760ca9815f1f485a3fe38d9c8b6adc005123b20a44fd45`，不构成发布证据。完整回归为 JVM 126/126、API 34 instrumentation 48/48（App 2/2、Data 46/46）、源码守卫 GO、App Debug/Release Lint 0 error（23/9 warning）、R8 Release 成功；Debug/未签名 Release/App/Data instrumentation APK SHA-256 分别为 `4e77442202133dd8e06cda171e4d1c49ff50139145f03d803726f2d21b2ff87d`、`38c04c30805772eb855b4b0faafd8cb3addf4fb1c6f2b5c4f8469a7aedcbac38`、`65bd9531b986cd614a56a8f7dae005e632c0428fc05c474ed6760b91eea339e4`、`e9b54469b251270468bf9aba8c40d93f9527dc5ea554c84089b72cc5df40aed3`。夹具、测试包、模拟器和 ADB 已清理。真人内容审核、真实云、正式签名、国产 OEM、真人 TalkBack、200 卡抽检和 10–50 人 cohort 阻断不变，发布结论保持 `NO_GO`。

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
| 三屏引导、3 个兴趣、双自动节奏、自动发现/仅选择照片 | PROVEN | Compose 三屏、权限请求与 Photo Picker 已连接；第三屏在授权前选择恰好 3 个兴趣及“提前准备/每天一张”，并说明自动节奏不约束逐项 Picker/分享。页码、兴趣、模式跨 Activity 重建保留；自动发现与仅选择照片入口都会先经 ViewModel/Repository 持久化两类偏好。API 34 标准与 840×1867/2× 字体实跑兴趣替换、`DAILY_ONE`、Activity 重建和系统 Picker；取消 Picker 后仍进入仅手动选择首页，不要求本次必须选图且自动分析 Work 为 0。自动发现权限弹窗烟测同样通过；同意前或拒绝后不会安排自动分析，也不声称已开始扫描 |
| Android 完整/部分/拒绝权限 | PARTIAL | 官方 Android 14/API 34 AVD 三种状态与原生部分照片选择流程通过；MediaStore PUT 每 64 KiB 重验精确 URI；仍缺实体机/OEM 与真实网络撤权故障注入 |
| 近 90 天、最多 500 张、增量扫描 | PROVEN（参考设备）/ EXTERNAL（OEM） | Android 14/API 34 真实 MediaStore 测试发布 503 条测试媒体：首轮 501 条严格只索引最新 500，第二轮未变化为 0，新增照片为 1，pending→重写 JPEG→重新发布的内容修改为 1 且重置到隐私分析；部分授权即使已有未来旧游标仍会 bounded reconciliation 并发现后来可见照片。另一个真实 MediaProvider 回归覆盖新旧 `DATE_TAKEN` 与新旧 `DATE_ADDED/DATE_MODIFIED` 四种组合：有效拍摄时间优先，缺失拍摄时间时回退元数据仍必须在窗口内，旧图不能逃逸 90 天边界。完整授权使用基础列比较的复合水位，避免 Android 14 MediaProvider 拒绝 `CASE` WHERE；非撤权查询错误不再静默返回空成功。仍缺国产 OEM 500+ 相册执行证据 |
| 两种自动处理节奏、卡池与每日单候选上限 | PROVEN | 默认“提前准备”在可见卡低于 7 张时补到最多 14 张，单轮最多上传 24 个候选；“每天一张”以中国自然日持久限制自动发现最多上传/分析 1 个候选，本机每个筛选批次最多检查 4 张以寻找 1 张安全且不重复的照片。领取在网络前同步落盘，同候选可跨任务继续、不同候选同日失败关闭，次日重置；PrivacyScanWorker 与 UploadWorker 均执行该规则，Room 精确取回保证重试不被更高分照片替换。模式持久化、Activity 重建保留；切换不删旧卡，重复选择不重复排程，暂停/picker-only 只保存。显式 Picker/分享仍按逐项同意独立处理。两种自动模式继续使用按中国日历日期生成的稳定种子，只在综合分差不超过 0.04 的最多 3 张中调整顺序，同日重试稳定且明显较差照片不能靠随机上位；服务端在事务内选择今天起首个空位，既有 PostgreSQL 并发测试证明排期连续唯一。API 34 标准/2× 字体、App 18/18、Data 64/64 instrumentation 及 domain/持久配额测试通过 |
| 首张卡进度、无匹配与失败恢复 | PROVEN（状态机）/ EXTERNAL（真实云时延） | QUEUED、扫描、端侧筛选、同步、有卡、无匹配、自动重试与最终失败均为持久化聚合状态。自动发现与主动选图/分享使用两个独立作用域：WorkManager 与 Worker 按来源写入，SharedPreferences 分键保存，主动结果解析只读取主动作用域；因此两种模式并发时不会由最后写入者覆盖另一条链的进度或终态。旧版无作用域状态只迁移到自动发现，非法 Work 输入则把两个作用域都置为失败而不留下陈旧活动态。进程重建及 API 34 完整 Data/App 回归证明不保存照片元数据，空页分别提供选择、恢复或重试动作，已有卡时失败提示不遮挡缓存内容；真实 Qwen 的 P50/P95 首卡时延仍需授权图片与云环境验证 |
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
| 来源可访问性与语义审核 | PROVEN（可访问性）/ EXTERNAL（语义） | 静态门禁覆盖 531 个唯一 HTTPS 来源且无悬空引用；固定 Google DoH 模式下的真实检查已证明状态批准候选 13/13、全部编辑来源 531/531 可访问，规范证据与当前 `2026-07-19-beta.62` 目录及审核队列 SHA-256 绑定。解析结果仍经过公网地址校验和 HTTPS 地址钉扎，不放宽 SSRF 防线。URL 可访问不证明来源支持中文事实；当前仍为 0 真人签注，624 条事实必须由受保护白名单中的责任人逐条核验，语义发布门禁保持 `NO_GO` |
| 模型不能编造 fact/source ID | PROVEN | 视觉模型不再接收或返回事实/来源；服务端确定性选择 approved fact 并直接写入正文、`factId` 与来源。标题也由服务端安全模板生成，因此模型没有改写或伪造这些字段的接口 |
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
