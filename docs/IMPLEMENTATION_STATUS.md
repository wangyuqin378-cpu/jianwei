# 实现状态

## 2026-07-30 Beta.73 审核事实标题与卡片去重

- 新生成卡优先从已审核事实中提取 8–30 字的首个完整短句作为标题；上下文依赖、过短或过长时回退到确定性模板，低置信度措辞不变。没有第二次模型调用，也没有目录外知识扩写。App 与 Glance 组件统一去掉正文中完全重复的标题前缀，详情标题使用中文 Heading 均衡断行；自动卡审计策略已升级为 `derived-ai-reviewed-card-v2`。
- 标准与 1.6× 字号 API 34 专项各 1/1、Data 90/90、App 29/29。最终 post-fix Gradle 284 个任务通过；后端 133/133、TypeScript check/build，以及源码、API、供应链、卡审计、Beta 证据和候选门禁全部通过。Debug / unsigned Release APK SHA-256 为 `46ca8cc4904e595dadf973600b1c40925479e2595ef9eabca708193ef7f53e00` / `25e46e644d95f4a3acfd49effa4d800568af5bc0a65c356be5ef8d2b47b89c13`。
- 新 `linux/amd64` 镜像 `jianwei-api:beta73-reviewed-fact-headlines` 的 OCI image ID 为 `sha256:247ab4ae97d3d73b2e9d66c72c3e06764640566ee7951cad193b29dd510cea1c`，后端 Release 为 `223f618f7084a529a5fd9eee386049cf118297bd550b2c918f88598e51609109`；live/ready、非 root、Node 22.23.1 与 runtime 工具裁剪均通过。Trivy 可修复 HIGH/CRITICAL 为 0，22 项基础系统 HIGH/CRITICAL 当前无修复，SBOM 232 个组件。
- 当前候选 `.tooling/release-candidate/beta73-reviewed-fact-headlines.json` 为 `LOCAL_CANDIDATE_GO`、`releaseEvidence=false`，SHA-256 `5457c32262d3656cc4ab6bf7a5dfe835437b95caca40eddae481707af8dd62e3`。真实云、签名、授权图片/OEM/真人无障碍、生产卡和 cohort 证据仍缺，整体保持 `NO_GO`。

## 2026-07-30 Beta.73 首次体验选择公平性（已由审核事实标题候选继承）

- 第 3 屏先同屏展示“自动发现”和“仅选择照片”，用户在看到两种完整路径后再选择；只有自动发现会展开“提前备好一周 / 当天只理解一张”。两种开始方式、兴趣和自动准备模式都使用可保存状态，整张选择卡具备 RadioButton、选中态和可点击说明。
- API 34 首次体验专项 2/2、Data 设备 90/90、App 设备 29/29；CI 对齐 Gradle 聚合 252 个任务通过，包含 JVM、Debug Lint、Release Vital Lint、Debug 与 R8 unsigned Release。Debug / unsigned Release APK SHA-256 为 `a76497702c975848b9f6ae6681fedad924e3a5443664409f230a7351352c5600` / `c2a98a79beff452f2a1e47ea534ab4173be11977e8cd2bf9313f17937707dd2a`。
- 当前候选 `.tooling/release-candidate/beta73-onboarding-choice-fairness.json` 为 `LOCAL_CANDIDATE_GO`、`releaseEvidence=false`，SHA-256 `3114f19e57b1cc8bb57b642efea5433986f7f56a48e3b466bf3737bdd3dfe377`；它继承并重新绑定同一份容器安全证据和镜像 ID。真实云、正式签名、OEM/真人无障碍与 cohort 仍未完成，整体保持 `NO_GO`。

## 2026-07-30 Beta.73 PostgreSQL 与容器安全本地闭环（由当前首次体验候选继承）

- Serverless Devs、psql 与 Docker/Colima 工具链已真实安装；独立 x86_64 VM 解决 ARM 用户态模拟 Node 的 libuv 崩溃，最终 `linux/amd64` 镜像完成构建和启动。
- Dockerfile 使用独立生产依赖层 `pnpm install --prod --no-optional`，runtime 移除 npm/corepack、保留非 root `node`。固定基础镜像为 Node 22.23.1 trixie-slim index digest `sha256:e6d9a389d34ff9678438af985c9913fbd1eb6ed36e80fea56644f4b4f6dd70ba`。
- 最终镜像 `jianwei-api:beta73-production-security-v2` 为 86,601,643 字节，OCI image ID `sha256:6fde2adc644814df506da660c25a72f584f48078fe968d8d39da0c41aa7a8cd4`，Node 22.23.1；`/health/live`、`/health/ready` 与日志验证通过，后端 Release 为 `aa912619b16e71c941dfd855a8e783cb84831115ef20d8a90618a8d357cc15f1`。后端 133/133、TypeScript、部署/源码门禁与候选复验通过。
- PostgreSQL 17.10 已完成 15 个迁移三轮幂等执行、17 项真实集成测试和 TCP E2E。Trivy 0.72.0 扫描显示可修复 HIGH/CRITICAL 为 0；仍有 22 项无可用修复版本的基础系统 HIGH/CRITICAL。CycloneDX SBOM 含 232 个组件，镜像绑定证据 SHA-256 为 `95118eb073785d4478114dad3de0ccbbfe8f9f2d24c1836cff0fc35fb45b2bce`，`releaseEvidence=false`。
- 历史候选 `.tooling/release-candidate/beta73-image-security-bound.json` 已因 Android 源码/APK 更新而由当前首次体验候选取代。2026-07-30 的固定良性文本复核确认北京工作空间 Qwen `cip` 护栏 HTTP 200 / `guardrailAccess=GO`，没有上传图片；当前真实外部缺口已收敛为 RAM access 与 FC/RDS/OSS/VPC/ACR/HTTPS 资源。本轮未发生云资源变更或照片外发，整体保持 `NO_GO`。

## 2026-07-30 Beta.73 ARM 内测分发体积收敛（已由生产容器候选继承）

- Release APK 从四套 ABI 收敛为 `arm64-v8a + armeabi-v7a`，Debug 仍保留模拟器架构；版本为 `73 / 0.1.0-beta73`。unsigned Release 从 128,833,539 字节降到 61,552,852 字节，减少 52.2%。
- 候选装配器不只检查 Gradle 文本，而是解析 APK 中央目录并强制两套 ARM ABI与 70 MiB 上限。Android 14 设置页路径 1/1、最终 Gradle 311 个任务、源码门禁、8 类候选绕过自测和候选复验均通过。
- 历史候选 `.tooling/release-candidate/beta73-arm-beta-distribution-final.json` 已因 Dockerfile/后端 Release 绑定变化而被当前生产容器候选取代；Release APK SHA-256 仍为 `796f75284fd4d19126d3b340d101a2676539a717de2379e1ce2fe083ea025284`。

## 2026-07-30 可核验的 Beta.72 内测构建身份

- Android Debug/Release 现在统一使用 `versionCode=72`、`versionName=0.1.0-beta72`，设置页直接显示“见微 0.1.0-beta72 · 内测版”，内测用户截图即可绑定具体构建；覆盖安装也不再长期停留在 code 1。
- 发布候选装配器与源码门禁会共同拒绝非正整数 code、非 `0.1.0-betaN` 名称和 code/name 错配。Android 14 设置页设备测试 1/1、最终 Gradle 311 个任务、Debug/Release Lint、JVM 测试、Debug/App 测试/unsigned Release APK、API 契约、200 主题知识和候选复验均通过。
- 当前候选 `.tooling/release-candidate/beta72-versioned-pilot-final.json` 为 `LOCAL_CANDIDATE_GO`、`releaseEvidence=false`，SHA-256 `497cc94fd0f0872f17acccdf62d25aa3db0a46c67476d2f10ab050f569195c2c`；Debug / unsigned Release / App 测试 APK SHA-256 分别为 `aff8b83aecadb1219d64de924a2f49e5d6acef44a5fe28663723477c6c71f0c9` / `48b6d17c9b8568c23a5c7bdb8efa2ce075b52613c2c218c753cc8a276860a7d9` / `8f215d35d95c3c0b1e20bab67df8a541b3b7294f6fd6eb05cdde5a62938a60a5`。本轮未调用云服务或外发照片；正式云、签名、授权图片/OEM/真人无障碍/生产卡/cohort 证据仍缺，整体 Beta 保持 `NO_GO`。

## 2026-07-29 自动发现可撤销与后台停机屏障

- 自动发现现在是默认关闭、明确开启、可持久撤销的独立授权；首次体验、仅选择照片、设置关闭和权限撤销使用同一状态。Scan/Privacy/Upload Worker 被会话级停机屏障包围，并在每个候选前重验权限和授权，旧任务无法继续读取或上传。
- 重复拒绝后的系统设置恢复、Android 14 部分照片、组件换卡去重与当天状态、午夜刷新、云删除后的本机重试、私有副本删除失败保留索引、提醒通知失败重试均有回归覆盖。最终 Gradle 307 个任务通过；Android JVM 271/271（76/111/84）、Data 90/90、App 隔离组 29/29，后端 133/133，源码、API 与知识门禁为 GO。
- 历史候选 `.tooling/release-candidate/beta71-automatic-discovery-control.json` 为 `LOCAL_CANDIDATE_GO`、`releaseEvidence=false`，SHA-256 `6070629cb7fd602a2ac717a18e4cc19a18dc25a09e0a265edd098565775473b3`，现已被 Beta.72 取代。未产生云请求或照片外发；正式云、签名、授权图片/OEM/真人无障碍/生产卡/cohort 证据仍缺，整体 Beta 保持 `NO_GO`。

## 2026-07-29 反馈后的对象纠错与精确回滚

- 用户点过“有意思 / 没意思”后仍可选择“识错了 / 太私人”；确认识错会原子归档卡片、取消收藏、清理旧反馈、安排提醒删除并撤销该卡学习效果。
- Room 15 与 PostgreSQL 迁移 015 持久化反馈实际应用的 affinity contribution，修复权重触顶后按理论值过度回滚。标准/1.6× API 34 点击路径通过；Data 89/89，App 全部 29 项在三个隔离 instrumentation 组中通过，Android JVM 260/260（75/109/76），后端 133/133，TypeScript、四组 Lint、Debug/App 测试 APK/R8 unsigned Release、源码门禁与候选复验通过。
- 当前候选 `.tooling/release-candidate/beta70-post-feedback-object-correction.json` 为 `LOCAL_CANDIDATE_GO`、`releaseEvidence=false`，SHA-256 `95b6b98f32ae99e17baef6014942d6a4c62b76489a47ff24ba7f6b7b8575bc47`；审计 `.tooling/beta70-post-feedback-object-correction/audit.json` SHA-256 `a3d2edf5ad5e6765ba3e354596469c781cbaaacf76a83d973d22b5404d1d5d22`。外部发布证据仍未完成，整体 Beta 保持 `NO_GO`。

## 2026-07-29 可见且隐私安全的反馈学习（已由 Beta.70 继承）

- “有意思 / 没意思”提交后，卡片会持续解释之后是更常留意还是减少推荐；设置页把本机学习结果与用户主动选择的三个兴趣分开呈现，并明确只影响本次安装。
- 学习摘要只展示仍保留且已排期卡片的受控物件名，不显示照片内容；“识错了”归档卡和“太私人”删除卡不会重新出现。反馈策略 8/8，标准/1.6× 设备专项通过；API 34 Data 88/88、App 29/29，Android JVM 258/258（73/109/76），双模块双变体 Lint、Debug/App 测试 APK/R8 unsigned Release、源码门禁与候选复验通过。
- 当前候选 `.tooling/release-candidate/beta69-visible-feedback-learning.json` 为 `LOCAL_CANDIDATE_GO`、`releaseEvidence=false`，SHA-256 `2171691cde3101f945361d122e17a5df15c332f7a48afa81f7af2b6c45f2c4e6`；审计 `.tooling/beta69-visible-feedback-learning/audit.json` SHA-256 `422900db08d2745784086af88680a7caa0c051e45eda8fe3ac3b36834f85edde`。外部发布证据仍未完成，整体 Beta 保持 `NO_GO`。

## 2026-07-29 无可靠命中后的可恢复引导

- 显式导入未命中可靠知识时，会先说明“见微不会为了出卡而猜测”，再用具体日常物件示例和主体、光线、文字、人脸标准指导下一张；主操作明确为“换一张日常物品照片”。`NO_MATCH` 使用安静主色容器，技术失败与权限失效继续走独立恢复路径。
- 第一次 1.6× 渲染暴露标题末字孤行，收紧为“暂时没找到可靠知识”后重新执行标准与 1.6× 设备测试，两档标题、说明、建议和操作都完整可达。API 34 Data 88/88、App 29/29；Android JVM 256/256（73/109/74），双模块双变体 Lint、Debug/App 测试 APK/R8 unsigned Release、源码门禁与候选复验通过。
- 当前候选 `.tooling/release-candidate/beta68-no-match-recovery.json` 为 `LOCAL_CANDIDATE_GO`、`releaseEvidence=false`，SHA-256 `02daef43aa8430f1cc292ad8ac1e7cc27719adea0395ade136713e90c662c274`；审计 `.tooling/beta68-no-match-recovery/audit.json` SHA-256 `003368b49ac19ee3b6f2c2e04cbf3e4224c207c025755bfedbf5f149267f9bf0`。外部发布证据仍未完成，整体 Beta 保持 `NO_GO`。

## 2026-07-29 来源优先的组件转化

- 每日卡与最近导入成功卡现在先连续展示正文、识别对象、推送原因和可点击来源，再显示“每天在桌面看一张”的组件邀请；入口仍在标准 API 34 首屏内，安装后不再重复。
- 组件与导入专项 8/8、清空 AVD 后 Data 88/88、App 29/29；Android JVM 255/255（73/109/73）、Data/App Debug/Release Lint、Debug/R8 unsigned Release、源码门禁和候选复验全部通过。
- 当前候选 `.tooling/release-candidate/beta67-source-first-widget-prompt.json` 为 `LOCAL_CANDIDATE_GO`、`releaseEvidence=false`，SHA-256 `30f6d4fc2f5f7226a5b19129fe373c73c0bf395ae7ad4d50bbb75e36f28a0ef5`；审计 `.tooling/beta67-source-first-widget-prompt/audit.json` SHA-256 `fdd8d45e91f114868b77e3325845583c01899cf3032f4600624bf83404c462a8`。外部发布证据仍未完成，整体 Beta 保持 `NO_GO`。

## 2026-07-29 模式切换与后台行为一致

- 模式切换已由独立 Domain UseCase 执行：新模式持久化后取消全部旧自动链，再按现有照片权限重排；Privacy/Upload Worker 每个候选前核对模式，旧模式不能继续处理后续候选。手动选择和分享导入不会被自动模式切换取消。
- WorkManager 专项 1/1、设置与 TalkBack 专项 1/1、Data 设备全量 88/88、清空冷 AVD App 全量 29/29；Android JVM 255/255（73/109/73）、Data/App Debug/Release Lint、Debug/R8 unsigned Release 与源码门禁通过。
- 当前候选 `.tooling/release-candidate/beta66-mode-switch-consistency.json` 为 `LOCAL_CANDIDATE_GO`、`releaseEvidence=false`，SHA-256 `a38bcb0aee253730b2d32f8bcf3198650ee702223c9b76e988ed66c73a0ddf64`；审计 `.tooling/beta66-mode-switch-consistency/audit.json` SHA-256 `08d24b6a514655c2f3bdc1623d7c92c03534dc04adb029340ef4034d616f89b7`。外部发布证据仍未完成，整体 Beta 保持 `NO_GO`。

## 2026-07-29 自动发现两种模式

- 首次体验把“提前备好一周（推荐）”和“当天只理解一张”收进自动发现卡片；前者准备 7–14 张未来卡，后者每个中国自然日最多上传分析 1 张且未命中可靠知识时沿用上一张。“仅选择照片”保持独立，设置、状态摘要与 TalkBack 口径同步。
- Android 14/API 34 首次体验 2/2、目标竞态 2/2、冷启动 App 全量 29/29；Android JVM 249/249（Domain 69、Data 107、App 73），后端 132/132、TypeScript check/build、Data/App Debug/Release Lint、Debug/R8 unsigned Release 与本地门禁全部通过。
- 当前候选 `.tooling/release-candidate/beta65-onboarding-mode-clarity.json` 为 `LOCAL_CANDIDATE_GO`、`releaseEvidence=false`，SHA-256 `e26abddbbc306390f77e0c78ae0b2705dd522f718f85f30ef0c967e1e84176e9`；审计 `.tooling/beta65-onboarding-mode-clarity/audit.json` SHA-256 `7a99782f8e155d4230e257f9eb5a380da90ab6f6c57ff467fdd28a24ec1fd542`。真实云、正式签名、授权图片评测、OEM、真人 TalkBack、生产卡复算与 cohort 仍使整体 Beta 保持 `NO_GO`。

## 2026-07-28 显式导入单一进度焦点

- 每日页已显示三阶段导入进度卡时，不再同时显示顶栏分析转圈；其他分区、没有内联进度卡的自动分析，以及具体用户操作的顶栏状态保持原行为。
- Android 14 专项 1/1 和完整 App 29/29；FILTERING/SYNCING 均只有 1 个无障碍 `ProgressBar`。Android JVM 249/249、双模块双变体 Lint、Debug/R8 Release、源码守卫通过。
- 当前候选为 `.tooling/release-candidate/beta64-single-import-progress-indicator.json`，SHA-256 `3787ae8536eaadd258cfaf89570e4ec51b393396cab9c8713d871f8339622833`，仍为本地 `releaseEvidence=false`。

## 2026-07-28 阿里云部署预检增量

- 新增 `scripts/check-cloud-deployment-preflight.mjs`：一条命令在不输出凭据值的前提下检查本机工具、Serverless Devs access、云资源输入、HTTPS、固定 Qwen、目录摘要、成本上限和镜像摘要绑定；支持不可覆盖的 mode-0600 JSON 报告。
- 自测 8/8 绕过被拒绝，合成密钥与数据库密码输出为 0；CI 已接入。当前本机真实结果是预期的 `NO_GO`，因为仅有百炼 API Key，没有 RAM/Serverless Devs、Docker、云资源参数或已推送不可变镜像。
- 这关闭的是“部署交接不可复现”的仓库缺口，不是云部署本身；ACR/FC/RDS/OSS/HTTPS 仍未被观察，`releaseEvidence=false`。

> 2026-07-28 Beta.64 首张照片三阶段进度与真实云边界（当前最新产品摘要）：显式导入等待卡新增“准备照片 / 本机隐私筛选 / 识别并匹配知识”三阶段和三段进度条；暂停、云端删除未完成与重试不显示虚假进度。失败文案删除“照片仍安全保留在本机”的绝对暗示，明确本机重试副本和“如已进入云端，临时图片最长保留 24 小时”。干净 API 34 AVD 上阶段专项 1/1、App 设备全量 29/29；Android JVM 248/248、后端 132/132、TypeScript、双 Lint、Debug/R8 Release 及本地门禁通过。审计 `.tooling/beta64-truthful-import-progress/audit.json` SHA-256 `3e7f1b36e3428fc5ee1c77b39d1ca76faeea042e561fb17702398716cc258b27`；当前不可变候选 `.tooling/release-candidate/beta64-truthful-import-progress.json` 为 `LOCAL_CANDIDATE_GO`、`releaseEvidence=false`，SHA-256 `eaace1b91ec69589c183d9f85215dc0d0dfc2b52a25363e8f84c4ac78f148c37`。真实云、正式签名、授权图片评测、OEM、真人 TalkBack、生产卡复算和 cohort 尚缺，整体 Beta 继续 `NO_GO`。

> 2026-07-28 Beta.64 首张卡片到组件闭环（当前最新产品摘要）：最近导入成功卡已在核心知识后直接提供“把这张知识放到桌面 / 添加到桌面”，文案只承诺“有新卡时自动更新”；已安装组件不重复提示。重试同步发布新分析状态并创建新唯一 Work，SharedPreferences 迟到回调不再把界面退回旧失败；Room 多实例与暂停屏障持久状态同步也已修复。API 34 App 28/28、Data 87/87、Android JVM 245/245、后端 132/132、TypeScript/TCP E2E、Data/App 双 Lint、Debug/R8 Release 和本地门禁全部通过。审计 `.tooling/beta64-first-card-widget-loop/audit.json` SHA-256 `4fa09a130fa9ccdb86934f697a2bb9124f22132474d12b63cb71beba7285777c`；当前不可变候选 `.tooling/release-candidate/beta64-first-card-widget-loop.json` 为 `LOCAL_CANDIDATE_GO`、`releaseEvidence=false`，SHA-256 `1fdb01abe3745fd0dc182270d7cbb1a0b1d76863eb810bef24f8f19d984a7fa6`。真实云、正式签名、授权图片评测、OEM、真人 TalkBack、生产卡复算和 cohort 尚缺，整体 Beta 继续 `NO_GO`。

> 2026-07-28 Beta.64 全量自动卡片审核（当前最新审核权威摘要）：用户确认的全量 AI 审核已贯穿到生成卡发布门禁。554 条可发布一般事实继续要求固定 Qwen + 生产 `cip` 批准；生成卡只能确定性组合该事实、精确来源集合、置信度标题和授权照片上下文。真实 Beta 的 200–500 张脱敏 PostgreSQL 卡片快照由 `derived-ai-reviewed-card-v1` 自动复算，任一目录、正文、来源、审核签注、低置信度措辞或日期模板漂移都会使整批 `NO_GO`；health/safety 不能进入首版自动池。人工卡片模板降为可选质量调查，不再拥有发布授权。编译器拒绝 14 类绕过，Beta 门禁拒绝 32 类；后端 132/132、TypeScript、证据装配/签名自测及源码/API/供应链/知识/部署/预算门禁均通过。本轮 Android 字节未变，复用既有 28/28 设备与 244/244 JVM 证据。审计 `.tooling/beta64-automatic-card-audit/audit.json` SHA-256 `3df27637b6cfd0185ae8d5419076b67dfc6cc3cc39a905c4f850469a952fafb3`；候选 `.tooling/release-candidate/beta64-automatic-card-audit.json` 为 `LOCAL_CANDIDATE_GO`、`releaseEvidence=false`，SHA-256 `88a7e96507a9444af7949b1a5a5023036ced95936b8adb2cdbe4b9f07aa3a01f`。真实云、正式签名、授权图片评测、OEM、真人 TalkBack、真实生产卡自动验证和 cohort 仍缺，整体 Beta 保持 `NO_GO`。

> 2026-07-28 Beta.64 桌面组件来源入口（当前最新摘要）：4×2 单卡/卡池末尾状态从“暂无更多卡片”改为绿色“查看照片与来源 →”，来源字号由 10sp 提高到 11sp，缓存过期状态缩为“缓存用完 · 点按更新”；正常换卡与每日两次上限不变。API 34 Pixel Launcher 真实 Pin 后通过系统右侧手柄从 2×2 扩为 4×2，组件宽 966/1080px，来源行动位于正文之后且完整在组件内。专项 1/1、App 设备全量 28/28、Android JVM 244/244、后端 132/132、TypeScript、双 Lint、Debug/R8 Release 与全部本地门禁通过。Debug / 未签名 Release / 测试 APK SHA-256 为 `7bea036ff6dbd48116f770b462d831f4fa654b520bdefb5ac24c09e347c86017` / `ec749b99e437bde4fdd55bbfe768bd21ca00386e2bec42878ea1fd683366e0b8` / `a0f08255d959c59865476c40cb9e321ef8713a3b945c48626a3bca16350b754a`。审计 `.tooling/beta64-widget-editorial/audit.json` 为 `GO`、`releaseEvidence=false`；当前候选 `.tooling/release-candidate/beta64-widget-editorial.json` 双绑定复验为 `LOCAL_CANDIDATE_GO`，SHA-256 `a4841bed1bd67d07646b117e4e45b2baf12e4496d2de0e30aed84d55b2540b07`。全量审核继续采用固定 Qwen + 生产 `cip`，health/safety 不自动发布，本轮没有新云端发送；真实云、正式签名和真人/实体机 Beta 证据未产生，整体仍为 `NO_GO`。

> 2026-07-28 Beta.64 知识卡编辑区收敛（历史摘要，已被桌面组件来源入口候选取代）：识别对象从绿色胶囊改为正文左缘的轻量元数据，“为什么推给你”与来源、反馈区不再各套一张灰色圆角卡；两条安静分隔线建立知识 → 来源 → 管理 → 反馈的顺序，组件转化仍为唯一强调行动区。API 34 真实 Compose 布局中正文、识别、推送原因和反馈标题左缘均为 89px，三个对齐差均为 0px；专项 1/1、相关知识卡/组件 3/3、最终 App 设备全量 28/28、Android JVM 244/244、双 Lint、Debug/R8 Release 全部通过。Debug / 未签名 Release / 测试 APK SHA-256 为 `b0e1826c0e06f04e099fc53d33b5bea5435037ae0fa8a33d2780adee4511923e` / `85f5cb0fdc1f693f8d03f19b1bcda8765cd3c45626a0cab658b698b24ea950e5` / `9b55298d0fca1e699100ce31367e7252040dd54edf2eaf120acf7d3543451910`。审计 `.tooling/beta64-editorial-sections/audit.json` 为 `GO`、`releaseEvidence=false`；候选 `.tooling/release-candidate/beta64-editorial-sections.json` 当时双绑定复验为 `LOCAL_CANDIDATE_GO`，SHA-256 `be5fadf15cf6c0badc11d570712c926b4fe8c1ed44f4c180b48a3f61317e37fa`。全量审核策略不变且本轮未新增云端发送；真实云、正式签名和真人/实体机 Beta 证据未产生，整体仍为 `NO_GO`。

> 2026-07-28 Beta.64 编辑型首页页签（历史摘要，已被知识卡编辑区候选取代）：固定导航从三个描边胶囊改为等宽文字页签，当前页以 28×3dp 主色底线和主色文字标记，未选页使用次级文字色；48dp 点击高度、单一 TalkBack 节点、Tab 角色、选中态和动态“收藏 N”名称均保持。API 34 视觉复核确认导航退为页面结构、每日知识卡与组件入口成为主层级；布局 JSON 与上一候选逐字节一致。设置导航专项 1/1、系统组件 Pin 复验 1/1；一次干净全量 26/27 的动态收藏标题等待超时经同方法隔离 1/1 后，第二次干净 App 设备全量 27/27。Android JVM 244/244（69/106/69）、双 Lint、Debug/R8 Release 全部通过。Debug / 未签名 Release / 测试 APK SHA-256 为 `05f4e9b43d297ce3713a6aeb92f60dbee2e4a69c2e4d6354366c2a34059cc898` / `397cbacf8a57bdcb1b0fac06ed7a62467a13ec940b2c7a7fc4bdefa7b012484c` / `885f2294bbab892f7d6137375f0f081d3c2fc8498f8721c6e9898e31fa23c890`。审计 `.tooling/beta64-editorial-tabs/audit.json` 为 `GO`、`releaseEvidence=false`；候选 `.tooling/release-candidate/beta64-editorial-tabs.json` 当时复验为 `LOCAL_CANDIDATE_GO`，SHA-256 `8a29425685a985ca0d166fbb43222edbab8798e0362014bed5d65c35c26a7be1`。全量审核策略不变且本轮未新增云端发送；真实云、正式签名和真人/实体机 Beta 证据未产生，整体仍为 `NO_GO`。

> 2026-07-28 Beta.64 重访首页紧凑化与全量审核确认（当前最新摘要）：重访首页使用单行品牌栏，移除已在首次体验说明的价值承诺和主卡上方重复“今天”标题，48dp 三段导航与卡片日期语义不变。API 34 的 2400px 窗口中，正文顶部由 1114px 前移至 869px，组件入口由 1308px 前移至 1063px；专项 3/3、冷启动提醒复验 1/1、最终 App 设备 27/27、Android JVM 244/244、后端 132/132、TypeScript、双 Lint、Debug/R8 Release 全部通过。Debug / 未签名 Release / 测试 APK SHA-256 为 `037e2c4eb93629f906b213e2678c64b26a10a5e6ebcb374fb2daae3baba6b978` / `17dae9b308d64621851f278fb5fa8c18af360ef6515f34889eb1cf61b2676f14` / `456ac2035e6abb2107dd013d8a9f9de9264221230eb18e3825452c18f1b7d43a`。审计 `.tooling/beta64-compact-home/audit.json` 为 `GO`、`releaseEvidence=false`；当前候选 `.tooling/release-candidate/beta64-compact-home.json` 已复验为 `LOCAL_CANDIDATE_GO`。全量审核保持固定 Qwen + 生产 `cip`、不确定即拒绝，health/safety 不自动发布；本轮未新增云端发送。真实云、正式签名和真人/实体机 Beta 证据未产生，整体仍为 `NO_GO`。

> 2026-07-28 Beta.64 缺图状态不再挤走知识内容（当前最新摘要）：卡片缩略图新增加载中/可用/不可用三态，可用照片保持 190dp，大图不可读时收为 68dp 并提供单一 TalkBack 标签。API 34 实测缺图容器 179/2400px，正文 1114–1240px，组件入口 1308–1361px，来源和管理动作也进入同一屏；生成 JPEG 仍保持完整大图。专项 2/2、当前字节组件复验 1/1、最终 App 设备 27/27、Android JVM 244/244、双 Lint、Debug/R8 Release 全部通过。Debug / 未签名 Release / 测试 APK SHA-256 为 `978ab174a8cfa8fe0463b83c92a108a46350bcb6bf248d12a6db86c2f50309ed` / `62a6c7b5347300251dad1b273f466d200400c0da273f66f303e081759a3d2c6c` / `5ec588e50160030c3de9a01ebc9abb62882db8b6be7f80dacd4973c576866e90`。审计 `.tooling/beta64-compact-missing-photo/audit.json` 为 `GO`、`releaseEvidence=false`；当前候选 `.tooling/release-candidate/beta64-compact-missing-photo.json` 已复验为 `LOCAL_CANDIDATE_GO`。真实云、正式签名和真人/实体机 Beta 证据未产生，整体仍为 `NO_GO`。

> 2026-07-28 Beta.64 价值优先组件入口与全量 AI 审核确认（当前最新摘要）：首次每日卡在照片、对象标题和知识正文之后立即展示“添加桌面组件”，不再要求用户先越过来源、收藏、提醒和反馈；入口只在组件未安装且位于第一张每日卡时出现。API 34 布局证据为正文底部 1560 px、入口 1628–1681 px、窗口 2400 px，无需滚动；真实系统 Pin 完成后来源上下文仍可到达。组件专项 1/1、第二次干净 App 设备全量 27/27、Android JVM 244/244（69/106/69）、双 Lint、Debug/R8 Release 均通过。Debug / 未签名 Release / 测试 APK SHA-256 为 `8e4f9b97b7444dd9496d46212806666897fb06030d2c36fd5fd7436b52bfbef6` / `cd8a478a5c97715b3b266c7a6429e732ae35f5b77a96ec120e992c79c322b73f` / `58e633c50b724892a5dd5b38b7be270dbda21e3abcd8fc23d305476966568e30`。审计 `.tooling/beta64-value-first-widget/audit.json` 为 `GO`、`releaseEvidence=false`；当前候选 `.tooling/release-candidate/beta64-value-first-widget.json` 已复验为 `LOCAL_CANDIDATE_GO`。用户确认的全量审核继续由固定 Qwen + 生产 `cip` 自动执行，一般知识覆盖主要内容风险、不确定即拒绝，health/safety 首版不自动发布，人工只处理异常与抽检。真实云、正式签名和真人/实体机 Beta 证据未产生，整体仍为 `NO_GO`。

> 2026-07-28 Beta.64 知识卡打开即见内容（当前最新 Android 产品体验摘要）：组件、分享导入、收藏和历史精准入口统一为单行上下文栏，移除先于内容出现的大说明卡。API 34 布局审计为入口/返回中心线差 0 px、知识卡标题顶部 1196/2400 px（49.83%）、旧说明不存在；专项 1/1、App 设备 27/27、Android JVM 244/244、双 Lint、Debug/R8 Release 均通过。Debug / 未签名 Release / 测试 APK SHA-256 为 `2f984cddd85c60dd88e1ab254b527632dfa296adcd4af9e67e1a6f3adc76dbb7` / `26f25160adf0a82af8613961da20de458f76409deab5d4a3117f8f388819651f` / `75924bfe1ab9f5eb8db3606d7c34f81fd030439a5b036020d7721adfc53a311d`。审计 `.tooling/beta64-compact-card-entry/audit.json` 为 `GO`、`releaseEvidence=false`；新候选 `.tooling/release-candidate/beta64-compact-entry.json` 已字节复验为 `LOCAL_CANDIDATE_GO`。真实云、正式签名和真人/实体机 Beta 证据未产生，整体仍为 `NO_GO`。

> 2026-07-28 Beta.64 对象裁图阶段发布候选（历史发布工程摘要，已被紧凑入口候选取代）：新增 `scripts/assemble-release-candidate.mjs`，把后端 Release identity、14 个 SQL 迁移、Beta.64 目录、OpenAPI、Room 14、部署模板、生成器和 Gradle unsigned Release APK 做成不可覆盖且可重算的字节绑定。`.tooling/release-candidate/beta64-final.json` 当时为 `LOCAL_CANDIDATE_GO`、`releaseEvidence=false`；后端/知识/APK SHA-256 分别为 `50323c815aa3abbd4a01e5479ff7555d10edc10a795caf810d6b3245422831b8` / `ef26febc1520d9b46e74dd34a985ed2d2e270cd857dea21456f5e93a8e88a923` / `6039743e95a4e23c4a65c960202636e2296980a573b209258d1d8f3f7da9cd6a`。陈旧候选、覆盖写入、错误迁移终点、错误 Room 版本、假签名状态、逆序发布和回滚删列均失败关闭；CI 已加入自测。发布顺序固定为迁移 → 后端 → 云验证 → APK 签名分发，迁移 014 只前进不回滚。真实云与正式发布证据未产生，整体 Beta 仍为 `NO_GO`。

> 2026-07-28 Beta.64 一般知识审核全量收口（当前最新内容运营权威摘要）：餐叉与 USB 数据线两条超长正文已缩为 78/77 字，并只将这两条修订正文、主题名和公开来源元数据发送至固定 Qwen 模型及生产 `cip` 护栏重审；本轮 1 次请求返回 2/2 `approved / safe_general`、0 rejected，499 input / 93 output tokens。目录已原子升级为 `2026-07-28-beta.64`，554/554 条一般知识全部 approved、verified、AI-reviewed；70 条 health/safety 未发送且继续保持 draft。知识 readiness 为 183/200 ready topic、554 verified fact、0 blocker，目录 SHA-256 `ef26febc1520d9b46e74dd34a985ed2d2e270cd857dea21456f5e93a8e88a923`。后端 132/132、Android JVM 241/241（66/106/69）、双 Lint、Debug/R8 Release、API 契约和源码守卫全部通过。当前 Debug / 未签名 Release APK SHA-256 为 `abc306225577b7c836f80917da15226b5253c93aef6ec4321a6f63b1b78c44ba` / `ecbf67c21c433535d9c5917f1bcff8824860e7762e5cdb3a6ac2afc7159370c1`。一般知识审核无剩余待处理项；真实托管云、正式签名、OEM、真人 TalkBack、200 卡抽检和 cohort 仍使整体 Beta 保持 `NO_GO`。

> 2026-07-28 Beta.63 Android → Qwen 真实产品闭环（当前最新跨端权威摘要）：使用用户已明确授权的项目无人物扫帚图，从 Android 14 系统 Photo Picker 开始，未授予持续相册权限；bundled ML Kit 实际只给出 `Room / Chair / Pattern`、敏感标记为空。真实后端以固定 `qwen3.6-flash-2026-04-16` 和生产 `cip` 输入/输出护栏直接理解图片，返回 `broom / 扫帚 / 0.95`，随后从 Beta.63 审核目录选择已批准的一般事实 `broom-draft-004`，绑定 Google Patents 来源并写入 Room。App 详情、2×2/4×2 Glance、跨日“昨日一知”和组件精准回卡均通过，服务端临时对象归零，crash buffer 为空。实跑发现本地标签 substring 会让 `Room` 误命中 `broom`，已收紧为规范化精确匹配；另修复 4×2 缓存耗尽提示替换来源的问题，来源现固定保留。后端 132/132、Android JVM 241/241、API 34 组件设备测试 2/2，知识/API/源码门禁均 `GO`，R8 Release 重建成功。Debug / 未签名 Release APK SHA-256 为 `a87ce1d09106e80aa140bb0fffa99adee60bac13f47f619143125cea065b1184` / `ecbf67c21c433535d9c5917f1bcff8824860e7762e5cdb3a6ac2afc7159370c1`；私有审计 `.tooling/beta63-photo-to-card/audit.json` 为 `releaseEvidence=false`。真实托管 PostgreSQL/OSS/HTTPS、正式签名、OEM 实体机、真人 TalkBack、200 卡抽检和 cohort 仍使整体 Beta 保持 `NO_GO`。

> 2026-07-27 一般知识 AI-only 全量审核（当前最新内容运营权威摘要）：用户明确授权后，554 条一般知识文本、主题名和公开来源元数据已发送至固定 `qwen3.6-flash-2026-04-16`；552 条一般知识通过，叉子与 USB 线各 1 条因正文分别为 84/87 字被本地确定性规则拒绝，10 条 health 与 60 条 safety 未发送且全部保持 draft，旧牙刷高风险批准状态也已降回 draft。目录已原子升级为 `2026-07-27-beta.63`，SHA-256 为 `01c6e1d1eade84dac63363d24ba1624dc06b2b0f495321fa127d83cc0548d18d`；readiness 为 `GO`，200 个受控主题中 183 个 ready，552 条事实带有效 Qwen 签注，0 条高风险发布。审核器新增本地 28–80 字硬拦截、可恢复批次检查点、严格数组提示和模型格式偏差有界重试。最终被接受审核轮为 28 批、76977 input tokens、22746 output tokens、0 次无护栏调用；此前一次完整结果因最终长度门禁失败，另有一次畸形 JSON 响应，故阿里云实际计费调用至少 57 次，精确费用以账单为准。后端 131 项通过、14 项 PostgreSQL 按环境跳过，知识/部署/API/证据/源码门禁均为 `GO`。内容审核阻断已关闭；真实托管云、正式签名、国产 OEM、TalkBack 和 Beta cohort 等外部阻断仍使整体 Beta 保持 `NO_GO`。

> 2026-07-26 一般知识启动审核批次（当前最新内容运营权威摘要）：责任人已明确确认 reviewer ID `wyq` 并由本人操作本机知识审核工作台。当前 loopback 会话只监听 `127.0.0.1:8791`，固定 Beta.62 目录快照、`--risk general --whole-topics`、19 条 / 6 个完整主题以及下一版本 `2026-07-26-beta.63`；初始 revision 0 的 19 条决定全部未设置，尚未生成完成批次、尚未应用目录，也没有自动批准。工作台仍要求逐条打开来源、填写决定与确认项，并在真人 checkpoint 后才会一次性写出 `.tooling/knowledge-review-batches/beta63-general-launch-01.json`。当前目录仍为 0 ready topic，Beta 仍为 `NO_GO`。

> 2026-07-26 知识来源透明度（当前最新 Android 权威摘要）：卡片详情现在直接显示每条来源的发布方与具体文章/页面标题，多来源编号、发布方与标题相同时去重，TalkBack 保留完整来源身份；来源点击仍复用既有公共 HTTPS 安全边界。改动限定在 App presentation 层。API 34 标准/1.6× 字体专项和最终 App 27/27 instrumentation 通过；Android JVM 240/240（Domain 66、Data 106、App 68），Debug/Release Lint、Debug/R8 Release、API 契约、差异检查和源码守卫 `sourceTransparency=1` 全部为 `GO`。Debug/未签名 Release/App 测试 APK SHA-256 为 `497394b26017fbb0d1d80e181db428c05cecd490300a3dec7b965b580085c6a4` / `a9336764f90203e13995b31b67b6e33ac1aff078513c1b4af53c5b6d7739b0bd` / `12a0ae2e0a50e3d2a6ee20006fcba9a047a587363a1267450536e79c9a28456f`。这证明来源可被用户看见和打开，不证明来源已由真人逐条确认支持事实；外部 Beta 阻断不变，仍为 `NO_GO`。

> 2026-07-26 真实 Qwen 安全护栏验证（当前最新权威摘要）：用户明确授权仓库自有、无人物的扫帚测试图外发后，验证器将其转为 JPEG、在内存移除 JFIF/EXIF，并于 `2026-07-26T15:34:42.988Z` 对固定 `qwen3.6-flash-2026-04-16` 发起唯一一次携带生产 `X-DashScope-DataInspection={"input":"cip","output":"cip"}` 的视觉请求。结果 `providerGate=GO`，5.802 秒返回 `broom / 扫帚 / 0.98 / sensitiveFlags=[]`；没有模型访问探针、没有无护栏视觉降级。净化字节 SHA-256 为 `8890d549cad0bcfb9952b9490284595a20ff2b2038fb70d36e32bf7b3dad1da2`，真实 `0600` 私有报告位于忽略目录 `.tooling/qwen-provider-verification-2026-07-26-guarded.json`，SHA-256 `d1ca4e408e77c609bf1fa3cf94f8c1980e5b3f7f8ee91f98abb08af583c414fa`；报告不含 Key、完整端点或本地路径，且 `releaseEvidence=false`。Qwen Provider 图片门禁已关闭；真实托管云全链路、正式签名、OEM 实体机、真人审核和 cohort 仍未闭环，Beta 保持 `NO_GO`。

> 2026-07-25 每天一张自然日配额（当前最新权威摘要）：`DAILY_ONE` 不再只是每个 Worker 最多 1 张，而是以中国自然日持久限制自动发现每天最多上传分析 1 个候选。配额在网络请求前同步落盘；同日不同候选失败关闭，同一候选可在中断后继续，次日重置。PrivacyScanWorker 当天已有领取时跳过新自动批次，UploadWorker 重启后按领取 ID 从 Room 精确找回 READY 候选；Picker/分享和提前准备模式不使用该配额。产品文案统一为每天/每个自然日上限。API 34 覆盖 24 候选并发、仓储重建、跨日、损坏状态、Room 锁定候选、显式导入隔离与标准/2× 字体连续阅读；Data 64/64、App 18/18 instrumentation，Android JVM 184/184，双 Lint 0 error、Debug、R8 Release、源码门禁与差异检查通过。Debug/未签名 Release SHA-256 为 `8112a59a834d39d4f5faa0f748fc07177c3548e631fb82d05987c2502b54caf2` / `54dd161a44f553abdb2ca459b3f1788e69e1bdd8db9750bd4ceb239e08261641`；外部 Beta 阻断不变，仍为 `NO_GO`。

> 2026-07-25 双模式使用状态闭环（当前最新权威摘要）：用户在首次体验或设置选择的自动节奏，现在会继续决定首页空状态、隐私中心说明、相册访问摘要和分析各阶段文案。“提前准备”明确逐步准备 7–14 张卡；“每天一张”明确每个自动周期最多上传分析 1 张、本机最多深度检查 4 张，未可靠命中时显示“今天没有生成新卡片”且不为凑数生成。Picker-only、部分和完整权限各自显示真实分析范围。API 34 标准字号测试真实进入系统权限页，840×1867/2× 字体验证说明与按钮可达；完整 App instrumentation 18/18，Android JVM 183/183，双 Lint 0 error、Debug、R8 Release、源码门禁与差异检查通过。Debug/未签名 Release SHA-256 为 `e314bc83bcbcaa45787230f5400a6cd2543704cab6db2d1d94bb964eb87bf374` / `8121a876b7ede39b285728dda8ed916cd73fc38fdbea1eec24e2cdd71d5f2b9a`；外部 Beta 阻断不变，仍为 `NO_GO`。

> 2026-07-25 首次体验双模式选择（当前最新权威摘要）：三屏首次体验第三屏现在同时收集恰好 3 个兴趣、自动发现处理节奏和授权方式。默认“提前准备（推荐）”与“每天一张”的真实成本/失败边界在授权前可见；处理节奏只约束自动发现，系统 Picker/分享仍是逐项同意。自动发现和 picker-only 两个入口都会先通过 ViewModel/Repository 持久化兴趣与模式，picker-only 用户日后开启自动发现不会静默回到另一种节奏。页码、未提交兴趣和模式使用 `rememberSaveable`，Activity 重建后仍停在第三屏并保留选择。API 34 标准和 840×1867/2× 字体下真实完成兴趣替换、选择 `DAILY_ONE`、Activity 重建、进入系统 Picker 与 SharedPreferences 验证；完整 App instrumentation 18/18，Android JVM 182/182，双 Lint 0 error、Debug、R8 Release、源码门禁与差异检查通过。Debug/未签名 Release SHA-256 为 `542e08dd73730235bd441ed51315c65939920cc10b79ee79d2326b947a894565` / `b9b634f56f49cdee5798dd4557167e0afad805e2e5dcf086fd45332b46e6ffd6`；外部 Beta 阻断不变，仍为 `NO_GO`。

> 2026-07-25 双照片处理模式（当前最新权威摘要）：设置页新增可持久化的“照片处理节奏”。默认“提前准备（推荐）”继续维护 7–14 张离线卡池，单轮最多上传 24 个自动候选；“每天一张”把每个自动周期硬限制为最多上传/分析 1 个候选，本机最多检查 4 张照片来找到 1 张安全且不重复的候选。两种模式共用现有端侧隐私筛选、压缩去 EXIF、审核知识库和卡片同步链路；Picker/分享导入不受自动节奏限制。切换不会删除已有卡，失败或后台延迟时继续展示旧卡；重复选择不重复排程，暂停或 picker-only 状态只持久化设置。API 34 设置流程在标准和 2× 字体下验证单选语义、切换与 Activity 重建持久化；完整 App instrumentation 17/17、Data instrumentation 60/60、Android JVM 182/182，双 Lint 0 error、Debug、R8 Release、源码门禁与差异检查通过。Debug/未签名 Release SHA-256 为 `f89b63b1cf2a096e2e1a5da0e7f87f771bd25dac6c3876b348339d99548f8e70` / `fbb4f144b670cc7ada57f6015685e2d6eb205ba37a326cfd1ac9d380f6711453`；外部 Beta 阻断不变，仍为 `NO_GO`。

> 2026-07-25 固定三段导航与设置隔离（当前最新权威摘要）：内容区顶部固定显示“每日 / 收藏 N / 设置”，每日不再混入推荐偏好和隐私表单；三个页面各自保留滚动位置，设置底部仍可直接切回每日，收藏/设置系统返回统一回每日。48dp 自绘 Tab 以单一 TalkBack 节点同时暴露名称、选中态和点击动作，修复 Material Button 父子语义分裂。变化限定在 Compose 展示/导航与对应设备路径，Domain/Data 边界未改。API 34 真实 Room 在标准与 840×1867/2× 字体下通过；完整 App instrumentation 17/17，Android JVM 179/179、双 Lint 0 error、Debug、R8 Release、源码门禁和差异检查通过。Debug/未签名 Release SHA-256 为 `aa20d672eb8a92c1c46454fece4a748d4e8e2dbcf200c18c2b8d51bc2ff3405d` / `0398355c10c69fd33b5835063071a8cf09a2631e6f50b7993857965eb1786c64`；外部 Beta 阻断不变，仍为 `NO_GO`。

> 2026-07-25 每日卡与往日目录闭环（当前最新权威摘要）：每日页只完整展开今天的卡片，历史卡进入“往日一知”紧凑目录；点击旧卡可查看完整来源、提醒和反馈，显式返回和系统返回均恢复历史列表位置。改动限定在 Compose 展示/导航层，DailyCard domain policy、Room、Repository、卡池和组件调度未改。API 34 真实 Room 在标准与 840×1867/2× 字体下通过；完整 App instrumentation 16/16，Android JVM 180/180、双 Lint 0 error、Debug、R8 Release、源码门禁与差异检查通过。Debug/未签名 Release SHA-256 为 `76cbd8c5c8be36008d78527ca0350a86c7d5e4fecf9b9d30d0b025aa430ce43e` / `3ff2a8606095b10d890164c4b76f7874a5193c282ee84ced56ad48be52efd240`；外部 Beta 阻断不变，仍为 `NO_GO`。

> 2026-07-25 物品提醒知情确认闭环（当前最新权威摘要）：新建/编辑提醒都明确由用户确认开始使用日和复查周期，见微不会从照片猜测已使用时长；日期以中文展示，预计通知限定为当天上午 9:00 左右并提示系统延迟。确认框默认未勾选，日期或周期变化会撤销确认，编辑已有提醒也需重新确认；免责声明说明这是自定义复查提醒，不代表专业更换建议。长内容可滚动，既有 Room/Repository/WorkManager 业务边界未改。API 34 真实 Room 标准与 840×1867/2× 字体链路均通过，完整 App instrumentation 15/15；Android JVM 180/180、双 Lint 0 error、Debug、R8 Release、源码门禁与差异检查通过。Debug/未签名 Release SHA-256 为 `a8651f2bf5ed76403bf3df29501e1ff49497677c0b2e7e663ba6e27091026e0b` / `ad332d838b505a8ad6f796ef86a9b09ff52d08bafb60f1d4996060a0c2c3b5f5`；外部 Beta 阻断不变，仍为 `NO_GO`。

> 2026-07-25 收藏目录与详情闭环（当前最新权威摘要）：有内容的收藏页改为最近收藏优先的紧凑目录，标准屏以照片/标题/摘要并排提高回找效率，净宽 `<300dp` 或字体 `>=1.5×` 自动切为上下卡片；目录缩略图上限 320px，详情仍为 1280px。点开后进入完整来源/提醒/反馈详情，显式返回和系统返回恢复原收藏位置；取消收藏会自动退出详情、更新计数，并以真实 DAO 状态证明持久化完成。详情滚动只在进入当前卡或该卡消失时复位，不受其他收藏后台更新影响。API 34 真实 Room 标准/2× 字体测试通过，当前源码包重装后的完整 App instrumentation 14/14；Android JVM 180/180、双 Lint 0 error、Debug、R8 Release、源码门禁与差异检查通过。Debug/未签名 Release SHA-256 为 `1b70a08445a3ae2805298612b91cf17549b85c7c7d287b89553945178c501e19` / `5637bcbe97b9aa073eb185875e216a01b4252fe6c917efe65f2f5994cab3797d`；外部 Beta 阻断不变，仍为 `NO_GO`。

> 2026-07-25 收藏页独立导航闭环（当前最新权威摘要）：空收藏页使用与每日卡一致的“收藏”动作名，说明知识会留在这里，并提供返回每日卡的主操作；收藏模式不再重复自动分析、推荐偏好和隐私中心。CTA 与系统返回键均返回每日模式，Room 收藏与同步语义未改，变化保持在 Compose 展示/导航层。API 34 真实 Room 测试覆盖空状态、内容隔离、CTA、系统返回、标准截图和 840×1867/2× 字体可达性；完整 App instrumentation 13/13。Android JVM 180/180、双 Lint 0 error、Debug、R8 Release、源码门禁与差异检查通过。Debug/未签名 Release SHA-256 为 `13f2068d797b3f842e5d0c40d2f4cbbaf2d862c2c4e99cc30ab0605bff666579` / `a579b6f0e164fe79b411edb93e9a2440f66c5b5ed8d93c0e9a8e23709fa755de`；外部 Beta 阻断不变，仍为 `NO_GO`。

> 2026-07-25 Picker-only 首日空状态（当前最新权威摘要）：空首页主卡改为“从一件日常物品开始”，给出主体清楚/画面简单的选图原则、三类日常物件建议、唯一选图主操作和次级分享说明，不再以权限解释作为主叙事。建议按卡片净宽响应式横排或纵排，纯 app UI policy 有边界单测；API 34 标准截图与精确 320dp/2× 真实滑动均通过，完整 App instrumentation 12/12。Android JVM 180/180、双 Lint 0 error、Debug、R8 Release、源码门禁通过。Debug/未签名 Release SHA-256 为 `a613574db83c8d5bfe4bc28d11dcf6732312966a899ed8fba851fe23327ed95a` / `51176de1a10542a0f6e944029b7f731c1b373fe8cc566d60210a9d870b0d14d7`；外部 Beta 阻断不变，仍为 `NO_GO`。

> 2026-07-25 首次体验产品化（当前最新权威摘要）：首屏加入明确标注的原创扫帚示例照片、“识别到 · 扫帚”和具体知识问题，资产来源/处理/SHA 已记录，不冒充用户照片。第三页按卡片真实净宽排版兴趣：标准手机两列并让自动发现、仅选择照片同时可见，净宽 `<300dp` 或字体 `>=1.5×` 才纵排；换页清除旧焦点并在新帧回到顶部。API 34 三页设备测试在标准与 320dp/2× 均通过，完整 App instrumentation 12/12；JVM 179/179、双 Lint 0 error、Debug、R8 Release、源码门禁通过。Debug/未签名 Release SHA-256 为 `bafccad6fa2d6a69cd7945d02a1ec6b825a2809a6fb8c236042877af931fdeb3` / `a58b082112193c163e3d6a0bee6959b730ac120835e784a9886a4e94b69c346b`；外部 Beta 阻断不变，仍为 `NO_GO`。

> 2026-07-25 卡片反馈区产品化（当前最新权威摘要）：反馈不再以问卷式长列表占据卡片尾部。标准净宽用 2×2 描边网格呈现有意思、没意思、识错了、太私人；净宽 `<260dp` 或字体 `>=1.5×` 才纵排，独立纯 UI policy 有边界单测。后果文案明确普通推荐反馈、错误隐藏和私人删除/停止分析；“太私人”仍经确认框，API 34 真实点击并取消返回。标准与 320dp/2× 截图、App instrumentation 11/11、Android JVM 179/179、Lint 0 issue、Debug、R8 Release、源码门禁全部通过。Debug/未签名 Release SHA-256 为 `8ad3f758dbeb8db5fc352b6165574ce574d336fad8cf43b10a56005c6133b2b7` / `8f946d975b1b41425e2ac61dd9565e4ba464046784a2c4862627e6a745036fae`；外部 Beta 阻断不变，结论仍为 `NO_GO`。

> 2026-07-25 每日知识卡视觉层级与大字可达性（当前最新权威摘要）：知识正文保持最高层级；“为什么推给你”以更短的来源区继续提供照片缘由和可点击出处，完整来源标题写入无障碍描述。收藏/物品提醒改为短标签的等权描边次级操作，不再由绿色收藏按钮抢走知识阅读焦点。API 34 标准 1080×2400 与精确 320dp/2× 字体真实截图通过，大字测试会滑动确认识别、来源和收藏可达；Pixel Launcher 组件返回 App 的焦点竞态也以真实坐标点击收口。全新 AVD 最终 App instrumentation 11/11、Android JVM 178/178、Lint 0 issue、Debug 与 R8 Release 通过。Debug/未签名 Release SHA-256 为 `bdf7c425671def3fc7abcf24933ce7aedda7ec55ba54f9b10787645a2ed9647b` / `96a14430b77bc07ff1e7e3441396d3e2f83d8ee48a487e0b45acdf36f324a5bb`；外部 Beta 阻断不变，结论仍为 `NO_GO`。

> 2026-07-25 真实 Qwen 结构化识别历史基线：用户提供的北京百炼业务空间凭据已对项目既有 CC0 自行车图片发起真实请求。旧 Provider 的 JSON Mode 只含模糊 boundingBox 描述，模型返回非约定坐标键后被严格 Schema 拒绝；验证命令还不能接受文档中的 pnpm `--`。当前提示词固定完整字段、示例及 `{x,y,width,height}`，禁止替代坐标形状，并按阿里云官方建议移除可能截断 JSON 的 `max_tokens`。验证器兼容 pnpm 分隔符，联网前在内存去除 APP/COM 元数据并严格复检 JPEG。修正后 `qwen3.6-flash-2026-04-16` 于 5.46 秒返回 `bicycle / 自行车 / 0.98 / sensitiveFlags=[]`，Schema 通过。当时生产安全头返回 `403 access_denied`；该历史账号阻断和图片复验待办已被 2026-07-26 的生产护栏扫帚图片 `providerGate=GO` 取代。fallback 不是发布证据。后端 113/113、TypeScript check/build、源码守卫 `qwenStructuredContract=1 qwenVerifierPrivacy=1` 通过；Android/API 未改，Beta 仍为 `NO_GO`。

> 2026-07-25 组件信任文案与对象去重（当前最新权威摘要）：App 与 Glance 的缩略图不可用状态统一为“原图暂不可显示”，不再用“照片在本机”暗示候选图从不参与明确授权后的短暂云端处理；源码护栏拒绝旧绝对暗示。组件对旧缓存卡增加标题/识别标签去重：完全相同时只显示标题，中低置信度和丰富标题仍显示识别提示。API 34 Pixel Launcher 真实 Pin 后断言品牌、占位文案可见且“自行车”只出现一次，并继续验证安装完成态。最终 Android JVM 178/178、App instrumentation 11/11、Debug/Release Lint 0 error/42 warning、Debug 与 R8 Release、源码护栏通过。Debug/未签名 Release SHA-256 为 `c6e058a75b9202d93e291bfaed1db3c3d789015d2a80b7fb4c53fb2837c2edc7` / `b22a7ee1dc9438f2be67095699eeb5edf86452ba67e12501a3b6b22675090207`；组件截图 SHA-256 为 `8821da053e0b0731d5a1480998a7c1ab2f1730919f636f5ab62116df08b89f06`，仅属模拟器工程证据。外部 Beta 阻断不变。

> 2026-07-25 单次模型调用卡片管线（当前最新权威摘要）：Qwen/Kimi 现在只负责一次视觉识别；旧的远端标题 Writer、CardDraft Schema 与事实/来源 ID 回传边界已删除。卡片标题由服务端根据审核目录对象名和 `factId` 稳定选择安全模板，正文、事实 ID 和来源直接来自目录，低置信度仍以 0.72 阈值显示“这可能是…”。这把正常单卡模型调用从两次降为一次，并避免标题超时或格式错误丢弃已有可靠事实的卡片。后端 112/112、TypeScript check/build、API 契约、源码护栏 `singleModelCallCardPipeline=1`、内存与 PostgreSQL 17.10 编译服务 TCP E2E（`deterministicTitle=1`）及 PostgreSQL 13/13 集成测试通过；Android/API 结构未改，外部 Beta 阻断不变。

> 2026-07-24 首卡落库时延（当前最新权威摘要）：domain `FirstCardMetricRecorder` 将指标端口与 Android 实现解耦；data 在非空服务端卡片批次完整验证并成功写入 Room 后记录首卡本机时间，UI 不再按下次看见卡片补记，重复同步保持首值，指标异常不影响已提交同步。组件成功仍由 `AppWidgetManager` 的真实组件 ID 判定。API 34 验证空/非空同步、异常隔离和导出幂等；`.tooling/truthful-beta-metrics-audit/audit.json` schema 2 为 `GO`、`releaseEvidence=false`，SHA-256 `b39caf9435f0d1bcae1675ee6ae60fc488a3539271474c91b57c52895f4e4169`。完整回归 JVM 146/146、instrumentation 56/56、双 Lint 0 error/32 warning、Debug 与 R8 Release 成功，源码守卫 `FIRST_CARD_COMMIT_METRIC_GATE=GO`。Debug/未签名 Release SHA-256 为 `f18e3a6a5112708eeadf5089a3881f7cd0744f4f4e8adc2dffc8c456f93bab5d` / `f65d3de90abfea21141937834ec8674c547d56dc98fb939749a7c6b78fd27058`。真实首卡 P50/P95 和其他外部发布证据仍未齐，Beta 保持 `NO-GO`。

> 2026-07-24 Beta 指标真实语义（当前最新权威摘要）：domain `FeedbackAction.isCardFeedback()` 现在把 SAVE 明确排除在卡片反馈分母外；收藏仅记录互动，`BetaMetricsStore.markFeedback` 会拒绝 SAVE。组件/提醒 card ID 只有解析成有效 `focusedCard` 后才记录回卡点击，未知或失效参数不计数。API 34 设备测试用真实 Room/SharedPreferences 与合成卡片验证反馈分离、精准回卡和导出隐私字段；`.tooling/truthful-beta-metrics-audit/audit.json` 为 `GO`、`releaseEvidence=false`，SHA-256 `28223cf0d8646df6309939244d018aa7308a5f9e18e025a9e8e2c939c57ec08a`。完整回归 JVM 146/146、API 34 instrumentation 54/54、源码守卫 `truthfulBetaMetrics=1`、双 Lint 0 error/32 warning、Debug 与 R8 Release 成功。Debug/未签名 Release SHA-256 为 `7cd55769c8f5b017e4a99a52cbd48a258e6f6b467d0dcb14bfe584d3cf04555c` / `0a17ea45e1d8c4b93d3ccfc71d09e8b3b574b2e796f5508c7c91cc9f37e4b0b7`。真实 cohort 与其他外部发布证据仍未齐，Beta 保持 `NO-GO`。

> 2026-07-24 Android 分享导入产品化（当前最新权威摘要）：Photo Picker 与 Android Sharesheet 现在共用 domain `ImportPhotosUseCase`；分享页接入单例 `UserOperationGate`，具有明确确认/进度、冲突/异常/不可读原地重试，并在分析暂停时只保留私有副本、不创建后台分析 Work。`MainActivity` 使用 `singleTask`，只消费已知且数量有界的分享结果。API 34 合成 JPEG 在标准布局和 320dp/2× 字体下均通过完整流程，验证来源 URI 不持久化、暂停无 Work、冲突可重试和原首页复用。`.tooling/shared-import-flow-audit/audit.json` 为 `GO`、`releaseEvidence=false`，SHA-256 `2949ec0196268f59b36bd7276ce92c77bb1d53e184d72d0202aede4286c6eb8f`。完整回归 JVM 145/145、API 34 instrumentation 52/52、源码守卫 `sharedImportFlow=1`、双 Lint 0 error/32 warning、Debug 与 R8 Release 成功。Debug/未签名 Release SHA-256 为 `7cf23e0700f88ff997cf2bec4aeaffebdffcf8f9900abdc57b773cd0b15fd3c6` / `1f83474c1148b48e6ef1c3d5d7a7c9b42cbdf24b0127ea306d0b8109c2e998c3`。这些仍是模拟器与合成图片证据，外部发布阻断不变，Beta 保持 `NO-GO`。

> 2026-07-24 用户操作串行化（当前最新权威摘要）：`MainViewModel` 现在通过基于 `AtomicReference` 的 `UserOperationGate` 在启动协程前只接纳一个收藏、反馈、提醒、扫描控制或数据删除命令；不匹配的完成者不能释放门，取消异常继续传播。`MainUiState.activeOperation` 替代模糊 busy，Compose 对所有冲突 mutation 禁用，并在顶部用具体操作文案和“操作进度”无障碍语义区分用户操作与后台照片分析。16 线程并发测试只接纳一个命令；API 34 标准布局快速冲突点击及 320dp/2× 字体下的云端删除确认均实跑通过。`.tooling/serialized-user-operations-audit/audit.json` 为 `GO`、`releaseEvidence=false`，SHA-256 `60723b4b986bdabdecfcfeca7b7e8d4052b06424a1f3cc1a86efdc55a93ea011`。完整回归 JVM 139/139、API 34 instrumentation 51/51、源码守卫 `serializedUserOperations=1`、双 Lint 0 error/32 warning、Debug 与 R8 Release 成功。Debug/未签名 Release SHA-256 为 `99420560f24c5feafb4d779e8580c1333d1c7663316ab4b71f914627ced17deb` / `6b8f8189b3a4aa0462ebc511252300878ffa8e72435e548d0531bd5bfdc8e897`。外部发布证据仍未齐，Beta 保持 `NO-GO`。

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
> 2026-07-28 Beta.64 对象感知组件裁图（当前最新跨端权威摘要）：真实 Qwen 扫帚卡对象框 `{0.48,0.02,0.35,0.75}` 已贯通 Fastify、PostgreSQL 014、OpenAPI、Android DTO/Room 14 和 Glance。4×2 不再盲目居中裁掉主体，旧卡或无效框继续安全居中；真实 Photo Picker → Qwen → 卡片 → 2×2/4×2 → 精准回卡已在 Android 14 重跑。后端 132/132；PostgreSQL 14 个迁移、15/15 集成及 TCP E2E；Android JVM 244/244（69/106/69）、Room 迁移 12/12、组件专项 2/2；双 Lint、Debug/R8 Release、知识/API/源码门禁均通过。Debug / 未签名 Release APK SHA-256 为 `79249138638bc4eaac90f343d7cf0fd511325f0e1258c2a5b1a15dfdd0fc14ed` / `6039743e95a4e23c4a65c960202636e2296980a573b209258d1d8f3f7da9cd6a`；本地证据不替代托管云、正式签名、OEM、真人 TalkBack、200 卡抽检和 cohort，整体仍为 `NO_GO`。
