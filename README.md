# Jianwei · 见微

[简体中文](README.zh-CN.md) · [Product story](https://yuqin.wang/#/project/jianwei)

**Discover a little knowledge in your everyday photos.**

Jianwei turns suitable photos from a personal photo library into daily knowledge cards for iPhone and its home-screen widget.

<img src="docs/images/jianwei-today.webp" width="260" alt="Jianwei development preview showing a broom photo, a knowledge card, and a source link">

*Development preview, not evidence of a publicly released build.*

## How it works

1. Authorize photo access; unsuitable images are filtered on the device.
2. Analyze up to nine sanitized photos per date, keeping up to three eligible knowledge cards.
3. Pick one card, retain alternatives and history, and prepare today plus the next six days.
4. Show cached cards in the app and widget. If no new card is ready, keep the latest one.

Use your own Qwen key, stored in the device Keychain, or an authorized Jianwei managed service. BYOK does not force web search or fall back to a platform key: model-knowledge cards are labeled as not verified online. The managed path researches sources and checks evidence. Neither mode guarantees that AI is always correct.

## Current stage

**Latest development source; no public app download yet.** This snapshot includes the iOS app, Widget, Cloudflare gateway and regression tooling. Android and the Fastify backend remain as earlier engineering paths.

Content quality, natural cross-day widget behavior, away-from-Mac device use and production distribution still require acceptance. Source sync does not deploy the service or update an installed phone. See the [snapshot and validation status](docs/SOURCE_SNAPSHOT_2026-09-17.md).

## Run locally

Requires macOS/Xcode for iOS, and Node.js 22+ for the gateway.

```bash
git clone https://github.com/wangyuqin378-cpu/jianwei.git
cd jianwei/cloudflare/gateway
npm ci --ignore-scripts
npm run check
npm test
npm run test:runtime
```

The runtime tests intercept external calls and do not spend model credits. Opening `ios/Jianwei.xcodeproj` lets you build the app and Widget with your own signing configuration. For an unsigned compile check from the repository root:

```bash
xcodebuild -project ios/Jianwei.xcodeproj -scheme JianweiCore \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO build-for-testing
```

Public source access does not include managed-service credentials. Use your own key or configure your own gateway; never commit keys, device grants or signing files. See [deployment](docs/DEPLOYMENT.md) and the [legacy backend/Android instructions](README.zh-CN.md#本地运行).

## Repository map

- `ios/`: iPhone app, Widget and tests.
- `cloudflare/gateway/`: Qwen product API, D1 cache, access and usage controls.
- `knowledge/`: topics, facts, sources and review state.
- `evaluation/`, `scripts/`: evaluation fixtures and validation tools.
- `android/`, `backend/`: earlier implementation paths.

[Privacy](docs/PRIVACY.md) · [Architecture](docs/ARCHITECTURE.md) · [Support](docs/SUPPORT.md)

## Source availability

The source is public for inspection. This repository currently has no open-source license; public visibility does not grant an open-source license.
