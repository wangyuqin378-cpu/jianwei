import { access, readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaults = {
  submission: path.join(repositoryRoot, "ios/AppStore/submission.zh-Hans.json"),
  metadata: path.join(repositoryRoot, "ios/AppStore/metadata.zh-Hans.json"),
  storeKit: path.join(repositoryRoot, "ios/StoreKit/Jianwei.storekit"),
  project: path.join(repositoryRoot, "ios/project.yml")
};

function parseArguments(args) {
  const result = { ...defaults, screenshots: "", releaseApp: "", selfTest: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--self-test") result.selfTest = true;
    else if (argument === "--submission") result.submission = path.resolve(args[++index] ?? "");
    else if (argument === "--metadata") result.metadata = path.resolve(args[++index] ?? "");
    else if (argument === "--storekit") result.storeKit = path.resolve(args[++index] ?? "");
    else if (argument === "--project") result.project = path.resolve(args[++index] ?? "");
    else if (argument === "--screenshots") result.screenshots = path.resolve(args[++index] ?? "");
    else if (argument === "--release-app") result.releaseApp = path.resolve(args[++index] ?? "");
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return result;
}

const text = (value) => typeof value === "string" ? value.trim() : "";
const exactSet = (actual, expected) =>
  actual.length === expected.length && expected.every((value) => actual.includes(value));

function validateSourceContract({ submission, metadata, storeKit, project }) {
  const failures = [];
  const app = submission?.app ?? {};
  const screenshots = submission?.screenshots ?? {};
  const subscription = submission?.subscription ?? {};
  const privacy = submission?.privacy ?? {};

  if (submission?.schemaVersion !== 1) failures.push("submission schemaVersion must be 1");
  if (submission?.platform !== "iOS" || submission?.locale !== "zh-Hans") {
    failures.push("submission must target iOS zh-Hans");
  }
  if (app.bundleId !== "cn.jianwei.ios") failures.push("app bundleId must be cn.jianwei.ios");
  if (!/^\d+\.\d+\.\d+$/.test(text(app.version))) failures.push("app version must use semantic numeric form");
  if (!/^\d+$/.test(text(app.build))) failures.push("app build must be numeric");
  if (app.primaryLanguage !== "zh-Hans" || app.primaryCategory !== "Lifestyle") {
    failures.push("primary language/category do not match the reviewed launch scope");
  }
  if (app.signInRequired !== false) failures.push("v1 must not require sign-in");
  if (Buffer.byteLength(text(app.reviewNotes), "utf8") < 100 ||
      Buffer.byteLength(text(app.reviewNotes), "utf8") > 4000) {
    failures.push("app review notes must contain 100-4000 UTF-8 bytes");
  }
  for (const phrase of ["仅选择照片", "App Store 沙盒", "API Key", "删除云端数据", "小组件"]) {
    if (!text(app.reviewNotes).includes(phrase)) failures.push(`app review notes must explain ${phrase}`);
  }

  if (screenshots.display !== "6.9-inch" || screenshots.width !== 1320 || screenshots.height !== 2868) {
    failures.push("launch screenshots must use the reviewed 6.9-inch 1320x2868 contract");
  }
  const expectedScreenshots = [
    "app-store-01-daily-three-to-one.png",
    "app-store-02-daily-knowledge-card.png",
    "app-store-03-pro-or-own-key.png"
  ];
  if (!Array.isArray(screenshots.files) || !exactSet(screenshots.files, expectedScreenshots)) {
    failures.push("submission must declare the three reviewed launch screenshots");
  }

  if (subscription.productId !== "cn.jianwei.ios.pro.monthly") failures.push("subscription product ID drifted");
  if (subscription.groupReferenceName !== "见微 Pro" || subscription.groupDisplayName !== "见微 Pro") {
    failures.push("subscription group names drifted");
  }
  if (subscription.referenceName !== "见微 Pro 月订阅" || subscription.duration !== "P1M" ||
      subscription.priceCNY !== "8") failures.push("monthly subscription launch offer drifted");
  if (subscription.introductoryOffer?.type !== "free_trial" ||
      subscription.introductoryOffer?.duration !== "P1W") failures.push("seven-day free trial drifted");
  if (subscription.localization?.displayName !== "见微 Pro 月订阅" ||
      subscription.localization?.description !== "每天分析 3 张未处理照片，选出并展示 1 条知识。") {
    failures.push("subscription localization drifted");
  }
  if (subscription.reviewScreenshot !== expectedScreenshots[2]) failures.push("subscription review screenshot drifted");
  for (const phrase of ["3 张", "1 条", "31 条", "App Store 沙盒", "恢复购买", "不要求账号登录"]) {
    if (!text(subscription.reviewNotes).includes(phrase)) failures.push(`subscription review notes must explain ${phrase}`);
  }

  if (privacy.tracking !== false || privacy.accountRequired !== false) {
    failures.push("submission privacy/account contract drifted");
  }
  if (privacy.privacyPolicyURL !== metadata.privacyPolicyURL || privacy.supportURL !== metadata.supportURL) {
    failures.push("submission URLs must match localized metadata");
  }
  if (metadata.primaryCategory !== app.primaryCategory) failures.push("metadata primary category drifted");

  const groups = Array.isArray(storeKit.subscriptionGroups) ? storeKit.subscriptionGroups : [];
  const group = groups.find((item) => item.name === subscription.groupReferenceName);
  const monthly = group?.subscriptions?.find((item) => item.productID === subscription.productId);
  if (!group || !monthly) failures.push("StoreKit configuration is missing the launch subscription");
  else {
    const groupLocalization = group.localizations?.find((item) => item.locale === "zh_CN");
    if (groupLocalization?.displayName !== subscription.groupDisplayName) {
      failures.push("StoreKit subscription group localization drifted");
    }
    if (monthly.referenceName !== subscription.referenceName ||
        monthly.recurringSubscriptionPeriod !== subscription.duration ||
        monthly.displayPrice !== subscription.priceCNY) failures.push("StoreKit monthly offer drifted");
    if (monthly.introductoryOffer?.paymentMode !== "free" ||
        monthly.introductoryOffer?.subscriptionPeriod !== subscription.introductoryOffer.duration) {
      failures.push("StoreKit introductory offer drifted");
    }
    const localization = monthly.localizations?.find((item) => item.locale === "zh_CN");
    if (localization?.displayName !== subscription.localization.displayName ||
        localization?.description !== subscription.localization.description) {
      failures.push("StoreKit subscription localization drifted");
    }
  }

  for (const fragment of [
    `MARKETING_VERSION: "${app.version}"`,
    `CURRENT_PROJECT_VERSION: "${app.build}"`,
    `PRODUCT_BUNDLE_IDENTIFIER: ${app.bundleId}`,
    `JianweiMonthlyProductID: ${subscription.productId}`,
    "EXCLUDED_SOURCE_FILE_NAMES: Jianwei.storekit"
  ]) {
    if (!project.includes(fragment)) failures.push(`project.yml is missing release contract: ${fragment}`);
  }
  return failures;
}

function isPublicHttpsOrigin(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
        (url.pathname !== "" && url.pathname !== "/")) return false;
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (!hostname || hostname === "localhost" || hostname.endsWith(".local") ||
        hostname === "::1") return false;
    const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
    if (!ipv4) return !hostname.includes(":");
    const octets = ipv4.slice(1).map(Number);
    if (octets.some((part) => part > 255)) return false;
    return !(octets[0] === 0 || octets[0] === 10 || octets[0] === 127 ||
      (octets[0] === 169 && octets[1] === 254) ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168));
  } catch {
    return false;
  }
}

function inspectPng(data, name, width, height) {
  const failures = [];
  if (data.length < 26 || data.toString("ascii", 1, 4) !== "PNG") return [`${name} is not a PNG`];
  const actualWidth = data.readUInt32BE(16);
  const actualHeight = data.readUInt32BE(20);
  if (actualWidth !== width || actualHeight !== height) {
    failures.push(`${name} must be ${width}x${height}, got ${actualWidth}x${actualHeight}`);
  }
  if (data[25] === 4 || data[25] === 6) failures.push(`${name} must not contain an alpha channel`);
  return failures;
}

async function validateScreenshotEvidence(directory, submission) {
  const failures = [];
  const expected = submission.screenshots.files;
  const actual = (await readdir(directory)).filter((name) => name.endsWith(".png")).sort();
  if (!exactSet(actual, [...expected].sort())) failures.push("screenshot directory must contain exactly the declared PNG files");
  for (const name of expected) {
    try {
      failures.push(...inspectPng(
        await readFile(path.join(directory, name)),
        name,
        submission.screenshots.width,
        submission.screenshots.height
      ));
    } catch {
      failures.push(`missing screenshot: ${name}`);
    }
  }
  return failures;
}

async function validateReleaseApp(appPath, submission) {
  const failures = [];
  const infoPath = path.join(appPath, "Info.plist");
  const decoded = spawnSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", infoPath], {
    encoding: "utf8",
    timeout: 10_000
  });
  let info;
  try { info = decoded.status === 0 ? JSON.parse(decoded.stdout) : null; } catch { info = null; }
  if (!info) return ["Release App Info.plist is invalid"];
  if (info.CFBundleIdentifier !== submission.app.bundleId) failures.push("Release bundle ID drifted");
  if (info.CFBundleShortVersionString !== submission.app.version) failures.push("Release version drifted");
  if (info.CFBundleVersion !== submission.app.build) failures.push("Release build number drifted");
  if (info.JianweiMonthlyProductID !== submission.subscription.productId) failures.push("Release product ID drifted");
  if (!isPublicHttpsOrigin(info.JianweiAPIBaseURL)) failures.push("Release API origin must be public HTTPS");
  try {
    await access(path.join(appPath, "Jianwei.storekit"));
    failures.push("Release App must not bundle the local StoreKit configuration");
  } catch {}
  return failures;
}

async function loadInputs(options) {
  const [submission, metadata, storeKit, project] = await Promise.all([
    readFile(options.submission, "utf8").then(JSON.parse),
    readFile(options.metadata, "utf8").then(JSON.parse),
    readFile(options.storeKit, "utf8").then(JSON.parse),
    readFile(options.project, "utf8")
  ]);
  return { submission, metadata, storeKit, project };
}

const options = parseArguments(process.argv.slice(2));
const inputs = await loadInputs(options);
const sourceFailures = validateSourceContract(inputs);
const failures = [...sourceFailures];

if (options.selfTest) {
  const mutated = structuredClone(inputs.submission);
  mutated.subscription.productId = "cn.jianwei.ios.pro.wrong";
  const mutationFailures = validateSourceContract({ ...inputs, submission: mutated });
  const originPolicyWorks = isPublicHttpsOrigin("https://api.jianwei.example") &&
    !isPublicHttpsOrigin("http://api.jianwei.example") &&
    !isPublicHttpsOrigin("https://127.0.0.1") &&
    !isPublicHttpsOrigin("https://10.0.0.1") &&
    !isPublicHttpsOrigin("https://api.jianwei.example/private") &&
    !isPublicHttpsOrigin("https://user:secret@api.jianwei.example");
  if (!mutationFailures.some((failure) => failure.includes("product ID")) ||
      !originPolicyWorks || failures.length > 0) {
    throw new Error(`App Store submission self-test failed: ${[...failures, ...mutationFailures].join("; ")}`);
  }
  console.log(JSON.stringify({
    status: "GO",
    selfTest: true,
    mutationRejected: true,
    publicOriginPolicy: true
  }, null, 2));
  process.exit(0);
}

if (options.screenshots) failures.push(...await validateScreenshotEvidence(options.screenshots, inputs.submission));
if (options.releaseApp) failures.push(...await validateReleaseApp(options.releaseApp, inputs.submission));

console.log(JSON.stringify({
  status: failures.length === 0 ? "GO" : "NO_GO",
  sourceContract: sourceFailures.length === 0,
  screenshotEvidence: Boolean(options.screenshots),
  releaseAppEvidence: Boolean(options.releaseApp),
  failures
}, null, 2));
if (failures.length > 0) process.exitCode = 1;
