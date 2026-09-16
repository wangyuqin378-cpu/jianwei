# 见微 · Jianwei

[English](README.md) · [产品预览](https://yuqin.wang/#/project/jianwei)

## 这是什么

见微把日常照片变成有来源的知识卡。从一件熟悉的小物件里找到值得了解的细节，再通过 App 和小组件带回日常生活。

**当前聚焦 iPhone，仍在开发，尚无公开 App 下载。** 本仓库是较早的 iOS、Android 和后端工程快照。

<img src="docs/images/jianwei-today.webp" width="260" alt="见微真实开发预览：扫帚照片、知识卡片和来源入口。">

*图片来自持续开发中的产品，当前公开源码不能复现完全相同的预览版本。*

## 怎么使用

想先了解体验，可以看[产品介绍](https://yuqin.wang/#/project/jianwei)。开发者可以先运行本地后端，不需要云模型密钥：

```sh
git clone https://github.com/wangyuqin378-cpu/jianwei.git
cd jianwei/backend
cp .env.example .env
pnpm install
pnpm dev
```

需要 Node.js 20.12+ 和 pnpm 11，`.env` 保持 `VISION_PROVIDER=local`。打开[健康检查](http://127.0.0.1:8787/health/live)，应返回 `{"ok":true}`。API 地址为 `http://127.0.0.1:8787`；这一步启动的是本地后端，不等于安装手机 App 或完成真实云端照片识别。

要查看 iOS 工程，需要 macOS、Xcode 和 XcodeGen。从仓库根目录执行：

```sh
cd ios
xcodegen generate
open Jianwei.xcodeproj
```

在 Xcode 选择已安装的模拟器，构建并运行 `Jianwei` scheme。客户端配置、Android 和后端验证步骤见[开发说明](docs/DEVELOPMENT.zh-CN.md#本地运行)，公开快照的能力以[实现状态](docs/IMPLEMENTATION_STATUS.md)为准。

产品希望形成的日常流程是：挑选合适的照片，在本机排除敏感或不可用图片，匹配审核过的知识与来源，有可靠命中才展示卡片。内容质量、真机跨日小组件和正式分发仍是待完成的发布验收。

## 为什么做

相册记录了很多日常，但大部分照片拍完就很少再打开。那些熟悉的物件，也可能藏着值得知道的事情：它为什么长这样、从哪里来、是怎样工作的。

见微想用每天一小张卡片，把照片和知识连起来。照片让知识与自己的生活有关，来源让人可以核对、继续读下去。找不到可靠依据时，就暂时留空。

[隐私与数据流](docs/PRIVACY.md) · [架构](docs/ARCHITECTURE.md) · [发布验收](docs/BETA_EVIDENCE_RUNBOOK.md)

**许可：** 源码公开可见，尚未授予开源许可证。
