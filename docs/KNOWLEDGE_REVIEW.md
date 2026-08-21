# AI knowledge review workflow

见微首版不再要求运营人员逐条操作知识审核后台。知识目录是静态、带公开来源的内容，发布前由固定版本 Qwen 做一次批量内容审核；用户每天看到卡片时不会再次触发知识审核模型。

产品责任人已确认首版采用全量审核。执行口径是“所有一般知识统一机器审核，异常才人工介入”，而不是恢复逐条人工审批；已有 554 条一般知识已按这一口径完成审核，后续新增或修改事实必须进入同一流程。

## 首版边界

- 只允许 `riskLevel: general` 的普通物件知识进入 AI 审核和发布池。
- `health` 与 `safety` 事实保留在目录中，但首版一律不发布。牙刷更换、电池安全、交通安全等内容因此不会被 AI 自动放行。
- AI 检查涉政和违法内容，同时检查色情、暴力、仇恨、侵权、隐私、个人结论以及被错误标成一般知识的健康或安全建议。不能只做涉政过滤。
- 每条事实仍必须绑定公开 HTTPS 来源。AI 会看到来源标题、发布方和 URL 身份，但不会假装已经打开网页正文；来源正文语义支持范围不作为 AI 自动审核已经证明的事项。
- 运行时卡片只能使用目录中的原文、`factId` 和 `sourceId`。视觉模型不能临场编造事实或替换来源。
- 任一模型错误、缺失决定、重复 `factId`、内容安全护栏失败或成本上限触发都会整批失败，不会写目录。

## 一条命令审核

在 `backend` 目录先用 20 条做不写入烟测：

```powershell
pnpm review:knowledge-ai -- `
  --credentials-file <absolute-path-to-bailian-csv> `
  --limit 20
```

确认结果后，一次审核全部待处理的一般知识并生成新目录版本：

```powershell
pnpm review:knowledge-ai -- `
  --credentials-file <absolute-path-to-bailian-csv> `
  --all `
  --write `
  --next-version <new-catalog-version>
```

全量命令会把一般知识文本和公开来源元数据发送给阿里云百炼，因此必须由有权限的人明确批准这次外发。凭据只在进程内读取；私有报告写入 `.tooling/ai-knowledge-review/`，权限为 `0600`，不记录 API Key、完整工作空间端点或本地路径。

脚本使用固定 `qwen3.6-flash-2026-04-16`、生产 `X-DashScope-DataInspection` 护栏、20 条一批、最多 3 次仅瞬态错误重试，并记录请求数和 token 用量。`--write` 会原子替换目录；高风险的旧版无签注批准状态会被降回 `draft`。

## 写入后的门禁

```powershell
node scripts\build-topic-backlog.mjs --write
node scripts\build-topic-backlog.mjs
node scripts\check-knowledge-readiness.mjs
```

首版要求至少 150 个主题各有一条经过 AI 或真人审核的 `general` 事实。目录仍保留 200 个受控主题，但纯健康或安全主题可以暂不进入发布池。

原本的真人工作台保留为可选纠错工具，不再是一般知识 Beta 发布的前置步骤。后续如果要上线健康或安全建议，应单独设计更严格的权威来源与责任审核流程，不能复用当前 AI 自动放行策略。
