# 平台订阅鉴权与身份恢复（2026-09-07）

状态：本地实现与合成边界验证；没有部署、真实 Apple 交易验证或真机覆盖。BYOK 不受本改动影响。

## 已解决的问题

- 平台三个 AI 接口原来只验证设备令牌，不验证订阅。现在先检查有效权益，再进入图片解析、请求去重、额度预留与模型调用。历史、反馈和删除数据仍只要求设备身份。
- App 原来没有向产品接口发送 StoreKit 签名交易。现在照片、每日选卡及其重试均发送 `X-Jianwei-App-Store-Transaction`；交易不放入业务 JSON、模型提示或去重键。
- 云端使用 Apple 官方验证库、固定 Apple 根证书和当前订阅状态；旧的未过期交易不能覆盖退款/撤销。明确绑定本产品、环境与安装身份。当前有效续订和服务端计费宽限期分别验证。
- 原来设备令牌丢失时，App 会换一个安装 UUID。这会改变购买关联身份，导致已有订阅失配。现在保留 UUID，原令牌无法恢复时才附带有效交易重试注册；服务端验证同一安装身份后只轮换令牌，保留设备 ID、用量与已完成请求。
- 无凭证、他人凭证、撤销或验证故障不能借恢复身份重置额度。临时 Beta 授权不是身份所有权证明，不能用于恢复令牌。
- 缺少恢复凭证时停止自动重试，提示设置中的“恢复购买”，旧卡与候选保留。Apple 暂时故障仍是可重试错误，不冒充订阅到期。

Apple 文档明确：购买时传入的 `appAccountToken` 会原样出现在交易中，所以不能用更换安装 UUID 修复令牌问题。[官方说明](https://developer.apple.com/documentation/storekit/product/purchaseoption/appaccounttoken(_:))

## 验证范围与证据

先复现后修复：

- `/tmp/jianwei-identity-recovery-20260907-before.log`：原实现实际换了安装 UUID、删除恢复令牌并返回新身份，1 项测试 4 处失败。
- `/tmp/jianwei-recovery-gateway-20260907-before.log`：原服务端收到合成的已验证购买所有权仍返回 401，无法恢复原设备。另一个缺失/损坏证明状态码测试失败；不能把这个状态码差异描述成原来可越权。
- 较早的平台鉴权修复复现了未订阅请求返回 200；iOS 原购买恢复测试也实际发现请求未携带交易。

本地结果与最终日志：

- 网关类型检查、221 项测试通过：`/tmp/jianwei-recovery-gateway-20260907-final2.log`。恢复测试走真实路由、SQLite、Apple 状态请求构造、归属及额度检查；只有 Apple 签名交易解码和上游响应使用合成替身。
- iOS 当前完整回归 193 项、0 失败（49 发现安全、142 核心、2 订阅），含 App/Widget 构建：`/tmp/jianwei-identity-recovery-20260907-final2.log` 已终态 `TEST SUCCEEDED`。覆盖令牌恢复/失败、凭证传输、旧卡保留及恢复后仅继续选卡；不代表真实购买或系统后台验收。
- `npm run test:runtime`：实际 workerd 启动、三条 AI 路由及恢复注册拒绝无效凭证、官方 SDK 签署状态请求、拒绝重定向。日志 `/tmp/jianwei-recovery-gateway-20260907-runtime2.log`。全部外部请求被本地截获，真实外部请求 0。
- 正式入口仅打包、不部署：`/tmp/jianwei-recovery-gateway-20260907-bundle.log`。本地运行检查已加入 CI，但远端 CI 未执行。

前一实现阶段的真实 workerd 检查发现并修复了两项仅编译看不出的故障：Apple SDK 依赖在模块初始化时调用随机数，必须在请求内延迟加载；Workers 不接受 `redirect: "error"`，改为手动处理并拒绝 3xx。不要撤回这两处处理。正式入口没有合成交易测试路由。

## 部署前配置（只配置服务器）

平台服务需要经营者现有 Apple App 的真实配置，不能复制测试值：

| 字段 | 用途 |
| --- | --- |
| `APP_STORE_BUNDLE_ID` | 已确认的 App Bundle ID |
| `APP_STORE_SUBSCRIPTION_PRODUCT_ID` | 已建立的自动续订商品 ID |
| `APP_STORE_ENVIRONMENT` | `production` 或 `sandbox`；默认 production，不接受 Xcode/LocalTesting |
| `APP_STORE_APP_APPLE_ID` | 正式环境要求真实的数字 App ID |
| `APP_STORE_KEY_ID`、`APP_STORE_ISSUER_ID`、`APP_STORE_PRIVATE_KEY` | 官方 App Store Server API 签名凭证；私钥只放服务器 Secret |

若仍是受控内测，可以使用服务器 Secret `BETA_DEVICE_GRANTS_JSON`，每项仅包含 `installationHash` 和 UTC `expiresAt`。只放行明确设备，最长未来 31 天，无通配符、无永久授权；撤销后即使重放旧请求也不能再次进入平台 AI 路径。此轮没有创建任何真实授权。

`/health/live` 只证明服务进程能响应；`/health/ready` 会拒绝缺少平台 Key 或有效权益配置的环境，仍不代表真实模型、Apple 或照片闭环验证完成。未配置上述内容就部署，会阻断现有平台体验，不能直接覆盖线上。

## 未完成项

- 真实 Apple 证书在线检查、Sandbox 购买/续订/退款到云端的闭环；真实环境与商品配置尚未验证。服务端测试宽限期不等于客户端或真实 Apple 宽限期验收。
- 本轮修复的是“同一安装身份、设备令牌丢失”。安装 UUID 本身遗失、旧版已经换过 UUID、换机/家庭共享不在本轮成功证据内，不能声称全部恢复场景已支持。
- 知识有趣且准确的真实模型评测、60 图/30 类/三轮稳定及独立盲评仍未完成。
- 真机 PhotoKit/隐私过滤、后台七天缓存、断开 Mac 后 Wi-Fi/蜂窝生成、真实跨日组件、正式签名与上架均是独立门槛。

这轮没有模型调用、Apple 实际请求、购买或云端写入。原十元累计评测账本未修改，SHA256 仍为 `24812990f7770221ee004c0f48ef7f7b632920894d6caa8f7c3c575a5563a61c`；未知费用预留没有释放。
