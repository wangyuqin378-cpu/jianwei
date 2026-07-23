# Kimi 对抗审查

当前状态：已完成硬上限 20 轮 `SAFE_PACKET` 审查，最新结论为 `NO-GO`。对抗审查推动修复分享显式同意与保留期披露、导入副本保留、JPEG 畸形输入、在途撤权、恶意 Provider 无界复制、Release 配置、中国时区排期、七卡缓存/每日换卡策略、上传字节一致性、OSS 无 Bearer、服务端二次隐私分类、模型 ID 白名单、API 上传路径、410/429 状态、跨进程暂停、全局金额熔断、生产日志最小化、测试覆盖隔离和 Release 运行时日志隐私。第 20 轮后又以本地可执行证据固定 Android 禁止重定向和 PostgreSQL 设备数据逐表级联。内容、授权评测集、国产实体机、真实 OSS/Qwen/HTTPS、正式签名、真人听读和真实用户证据仍阻断 Beta；达到轮次上限不表示产品完成。

安全模式不会发送源码、文件路径、用户照片、环境变量或密钥，只发送经过人工限定的产品能力声明与明确未完成项。报告写入被 Git 忽略的 `reports/kimi-adversarial-review.md`，每轮另存 `reports/kimi-adversarial-review-round-N.md`。

```powershell
node scripts/kimi-adversarial-review.mjs --self-test
```

第 20 轮已完成且已达到代码固定的最大轮次，不再继续调用外部 Kimi。后续仍可在本地继续实现、
测试和处置，但不能把本地检查冒充额外外部轮次，也不能因循环到达上限而放行 Beta。

`sk-kimi-` Key 使用 Kimi Code 的 `kimi-for-coding`；其他 Key 默认使用 Kimi Platform 的 `kimi-k3`。不要把 Key 写入仓库、报告、命令历史或截图；曾经粘贴到聊天或日志中的 Key 应立即轮换。

Loop Engineer 门禁固定最多 20 个审查轮次、单次最多 32768 输出 token、估算总 token
最多 50000，并在调用前执行预算判定。源码快照模式已禁用；缺少显式外发确认变量时不会
调用 API。完整循环契约见 `LOOP_ENGINEERING.md`。

由于 Kimi 在安全模式下看不到源码，它会把许多已实现控制标为“证据不足”。这些输出用于产生攻击假设，不单独决定发布。逐项本地处置见 `KIMI_FINDING_DISPOSITION.md`；最终 Beta 权限由真实原始数据运行 `scripts/check-beta-readiness.mjs` 的结果决定。
