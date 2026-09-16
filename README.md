# Jianwei · 见微

[简体中文](README.zh-CN.md) · [Product preview](https://yuqin.wang/#/project/jianwei)

## What it is

Jianwei turns everyday photos into short knowledge cards with sources you can follow. It looks for an interesting detail in an ordinary object, then brings that detail back through the app and its widget.

**An iPhone product in development; no public app download yet.** This repository is an earlier iOS, Android and backend engineering snapshot.

<img src="docs/images/jianwei-today.webp" width="260" alt="Jianwei development preview: an everyday broom photo, a knowledge card and a source link.">

*Real interface from ongoing product work. The public source does not reproduce this exact preview.*

## How to use it

To see the intended experience, start with the [product page](https://yuqin.wang/#/project/jianwei). Developers can run the public backend locally without a cloud model key:

```sh
git clone https://github.com/wangyuqin378-cpu/jianwei.git
cd jianwei/backend
cp .env.example .env
pnpm install
pnpm dev
```

Requires Node.js 20.12+ and pnpm 11. Keep `VISION_PROVIDER=local` in `.env`. Open [the health check](http://127.0.0.1:8787/health/live) and expect `{"ok":true}`. The API runs at `http://127.0.0.1:8787`; this starts a local backend, not an installed phone app or the full cloud-photo experience.

To explore the iOS project, use macOS, Xcode and XcodeGen. From the repository root:

```sh
cd ios
xcodegen generate
open Jianwei.xcodeproj
```

Select an installed simulator in Xcode, then build and run the `Jianwei` scheme. See the [development guide (中文)](docs/DEVELOPMENT.zh-CN.md#本地运行) for client setup, Android and backend checks. Exact implemented behavior is recorded in [implementation status](docs/IMPLEMENTATION_STATUS.md).

The intended daily flow is: choose suitable photos, filter sensitive or unusable images on the device, match an object to reviewed knowledge, and show a card only when a reliable match exists. Final content quality, physical-device and cross-day widget behavior, and distribution remain release checks.

## Why this project exists

A photo library records ordinary life, but most of those photos are rarely opened again. A familiar object can also be a starting point for learning: how it works, where it came from, or why it looks that way.

Jianwei explores that possibility in a small daily format. The photo gives the knowledge a personal connection; the source gives the reader somewhere to check or keep reading. When the evidence is insufficient, leaving the card empty is better than inventing a fact.

[Privacy and data flow](docs/PRIVACY.md) · [Architecture](docs/ARCHITECTURE.md) · [Release evidence](docs/BETA_EVIDENCE_RUNBOOK.md)

**License:** source is public; no open-source license has been granted.
