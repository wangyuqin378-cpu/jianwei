# 架构说明

## 当前源码：iOS 与 Cloudflare（2026-09-17）

当前主路径是自动发现：授权相册 → 本机筛选和净化 → 每个准备日期最多分析 9 张 → 留下最多 3 条知识 → 选择一条 → 本机与组件共享展示。前三张没有合格结果会继续补选；无新卡时保留最近一条，暂时失败保持可重试。

`AutomaticDiscoveryRunner` 串行准备今天及未来 6 天。前台一次补齐最多分析 63 张，后台一次最多 9 张；这些是处理上限，不是定时执行保证。`LocalRepository` 保存日期准备记录和历史，`SharedWidgetStore` 原子写入共享快照，组件读取预生成时间线，不直接请求模型。

- BYOK：`DirectQwenService` 使用本机 Keychain 中的用户 Key，直接调用百炼。先匹配内置知识；未命中时允许模型知识生成并标注“未联网核实”，不代开搜索、不使用平台 Key 兜底。
- 托管：`APIClient` 请求 Cloudflare 网关的照片知识与每日选卡接口。网关负责设备权益、幂等、用量、内置搜索、证据与照片关联校验；通用知识缓存在 D1，不保存照片库。
- 本地源码与当前云端部署、已安装手机包是三个独立版本。合并源码不能替代云端迁移、分发签名、真实内容质量和跨日组件验收，见[本次同步状态](SOURCE_SNAPSHOT_2026-09-17.md)。

## 历史：2026-08 个人 BYOK 架构

以下保留早期设计背景，不代表当前两种服务模式的完整行为；旧“仅匹配目录”限制已由上文替代。

当前可发布路径不依赖见微自建后端，也不需要 RDS、OSS 或函数计算。用户在 App 内填写自己的阿里云百炼 API Key，Key 只保存在 iOS Keychain；候选照片在设备端去除元数据并压缩后，由 iPhone 通过 HTTPS 直接调用固定版本 Qwen。识别结果只用于匹配随 App 发布、已经审核过的知识与来源。

```text
PhotoKit / Share Sheet
        |
        v
Vision 隐私过滤 -> 候选排序 -> 图片净化
        |                         |
        |                         v
        |                 DirectQwenService
        |                         |
        v                         v
本地状态与缩略图 <- BundledKnowledgeCatalog
        |
        v
WidgetKit 每日知识卡
```

日常闭环是：从未做过知识判断的照片中完成三张安全候选；每张图最多识别三个可讲述对象，并逐项尝试本地审核事实。通过严格质量门槛的照片进入 `knowledgeReady`，穷尽后仍无好卡的照片进入 `exhausted` 且不再选择，模型失败进入可重试的 `failed`。当天从新产生及跨日保留的可用卡中选一条展示，其余继续留在可用库存。模型不能临场编造知识或来源。

## 当前 iOS 数据边界

- 原图、PhotoKit 标识、文件名和精确位置不进入见微自建服务；当前版本没有见微照片服务器。
- 发送给百炼的候选图会重新编码、缩放并去除 EXIF。
- API Key 存在 Keychain；知识卡、反馈、处理状态和组件缓存保存在本机/App Group。
- 随 App 发布的知识目录只接受已审核、一般风险且来源可访问的事实。

## Android 与未来托管服务

以下架构保留给 Android 或未来由见微承担模型费用的托管版本，不是当前 iOS 个人 Beta 的部署要求。

### 托管服务数据边界

原始照片 URI、MediaStore ID、文件名和精确位置只存在于设备端。上传候选图会重新编码、缩放至长边 1280 像素并移除 EXIF。服务端只接收随机 `candidateToken`、时间桶、端侧标签、质量分和敏感标记。

```text
MediaStore / Share Sheet
        |
        v
MediaScanner -> PrivacyFilter -> CandidateRanker -> Room
                                           |
                                           v
                                    UploadWorker
                                           |
                                           v
                         Fastify -> VisionProvider
                                           |
                                           v
                         audited KnowledgeFact only
                                           |
                                           v
                             Room -> Glance Widget
```

### Android 依赖方向

```text
app -> data -> domain
app --------> domain
domain -> no Android framework
```

- `domain`：模型、Repository 接口和 UseCase，纯 Kotlin。
- `data`：Room、MediaStore、ML Kit、HTTP 和 Repository 实现。
- `app`：Compose 页面、权限流程、分享入口、Hilt 装配与 Glance 小组件。

WorkManager 使用唯一任务名串行执行扫描、隐私过滤和上传；每日周期任务只负责启动同一条幂等链。完整相册授权使用 `(max(DATE_ADDED, DATE_MODIFIED), mediaId)` 复合水位增量查询；Android 14 部分授权可能让一张旧照片突然可见但不改变媒体时间戳，因此部分授权每次重查最多 500 条可见记录，并由 Room 在写入边界幂等判断，未变化照片不会重新隐私分析。增量 WHERE 只使用 MediaProvider 允许的基础列比较，不使用 Android 14 会拒绝的 `CASE` 谓词；除撤权产生的 `SecurityException` 外，查询错误不再伪装成成功空结果。自动 MediaStore 上传在每 64 KiB 写入前重验精确 URI 权限。Picker/分享原始副本在终态删除或被净化缩略图覆盖，并有 24 小时/30 天本地保留上限。服务端以 `(device_id, candidate_token)` 建立唯一约束；每设备与全局日/月预算在 PostgreSQL 事务锁内原子检查，全局匿名事件账本在设备隐私删除后仍保留总成本计数。

Beta 指标只保存在应用私有的本地存储中，并使用与 API 安装身份无关的随机证据 ID。只有测试者主动点击导出时，应用才通过 Android 系统分享器发送 allowlist JSON；照片、识别标签、位置、MediaStore ID、安装身份和设备令牌都不进入报告。

### 托管服务事实安全

模型不允许提供来源。它只能：

1. 输出识别对象与置信度；
2. 在服务端已经选定 `factId` 后，将该事实压缩成 28–80 字卡片；
3. 原样返回指定的 `factId` 和 `sourceIds`。

服务端不信任客户端上报的空敏感标记：固定视觉提供方必须独立返回结构化敏感枚举，命中人脸、证件、银行卡、票据、文档、截图或高文字密度内容时任务直接进入 `rejected`，不会选择事实或调用写卡模型，临时对象仍在 `finally` 删除。随后服务端拒绝未知 `factId`、未知来源、未审核事实和缺少权威来源的高风险事实。无可靠命中时任务进入 `needs_content`，不会发布卡片。

### 托管服务运行模式

- `local`：内存数据、临时目录、标签匹配视觉提供方；可离线开发。
- `postgres + local object store`：服务持久化但图片仍在受控本机临时目录。
- `postgres + OSS + qwen`：未来托管生产模式。

生产 Function Compute 自定义容器不会把启动时的 STS 凭证视为永久值。服务在每次调用入口校验完整的 `x-fc-access-key-id`、`x-fc-access-key-secret`、`x-fc-security-token`，写入仅驻留内存的轮换凭证源；OSS SDK 每次操作从该源取快照，缺失或部分凭证时请求直接失败。跨栈预算固定为 Qwen 25 秒、OSS 10 秒、最坏核心处理 110 秒、Android 150 秒、函数 180 秒、处理租约 210 秒，并由 `check-runtime-budgets.mjs` 防止顺序倒置。
