import { access, readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaults = {
  submission: path.join(repositoryRoot, "ios/AppStore/submission.zh-Hans.json"),
  metadata: path.join(repositoryRoot, "ios/AppStore/metadata.zh-Hans.json"),
  project: path.join(repositoryRoot, "ios/project.yml")
};
const expectedAPIOrigin = "https://jianwei-api.yuqin.wang";

function parseArguments(args) {
  const result = { ...defaults, screenshots: "", releaseApp: "", selfTest: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--self-test") result.selfTest = true;
    else if (argument === "--submission") result.submission = path.resolve(args[++index] ?? "");
    else if (argument === "--metadata") result.metadata = path.resolve(args[++index] ?? "");
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

function validateSourceContract({ submission, metadata, project }) {
  const failures = [];
  const app = submission?.app ?? {};
  const screenshots = submission?.screenshots ?? {};
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
  for (const phrase of ["自动发现", "最多 9 张", "无需填写 API Key", "阿里云百炼", "小组件"]) {
    if (!text(app.reviewNotes).includes(phrase)) failures.push(`app review notes must explain ${phrase}`);
  }
  if (submission.subscription !== undefined) failures.push("the current free release must not declare an App Store subscription");

  if (screenshots.display !== "6.9-inch" || screenshots.width !== 1320 || screenshots.height !== 2868) {
    failures.push("launch screenshots must use the reviewed 6.9-inch 1320x2868 contract");
  }
  const expectedScreenshots = [
    "app-store-01-automatic-discovery.png",
    "app-store-02-daily-knowledge-card.png",
    "app-store-03-history.png"
  ];
  if (!Array.isArray(screenshots.files) || !exactSet(screenshots.files, expectedScreenshots)) {
    failures.push("submission must declare the three reviewed launch screenshots");
  }

  if (privacy.tracking !== false || privacy.accountRequired !== false) {
    failures.push("submission privacy/account contract drifted");
  }
  if (privacy.privacyPolicyURL !== metadata.privacyPolicyURL || privacy.supportURL !== metadata.supportURL) {
    failures.push("submission URLs must match localized metadata");
  }
  if (metadata.primaryCategory !== app.primaryCategory) failures.push("metadata primary category drifted");

  for (const fragment of [
    `MARKETING_VERSION: "${app.version}"`,
    `CURRENT_PROJECT_VERSION: "${app.build}"`,
    `PRODUCT_BUNDLE_IDENTIFIER: ${app.bundleId}`,
    `JIANWEI_API_BASE_URL: "${expectedAPIOrigin}"`,
    'JIANWEI_DEVICE_BETA_EXPERIENCE: "YES"',
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
  if (text(info.JianweiAPIBaseURL) !== expectedAPIOrigin || !isPublicHttpsOrigin(text(info.JianweiAPIBaseURL))) {
    failures.push("Release must use the reviewed public Jianwei API origin");
  }
  for (const required of ["PrivacyInfo.xcprivacy", "catalog.json"]) {
    try { await access(path.join(appPath, required)); } catch { failures.push(`Release App is missing ${required}`); }
  }
  try {
    await access(path.join(appPath, "Jianwei.storekit"));
    failures.push("Release App must not bundle the local StoreKit configuration");
  } catch {}
  return failures;
}

async function loadInputs(options) {
  const [submission, metadata, project] = await Promise.all([
    readFile(options.submission, "utf8").then(JSON.parse),
    readFile(options.metadata, "utf8").then(JSON.parse),
    readFile(options.project, "utf8")
  ]);
  return { submission, metadata, project };
}

const options = parseArguments(process.argv.slice(2));
const inputs = await loadInputs(options);
const sourceFailures = validateSourceContract(inputs);
const failures = [...sourceFailures];

if (options.selfTest) {
  const mutated = structuredClone(inputs.submission);
  mutated.subscription = { productId: "cn.jianwei.ios.pro.monthly" };
  const mutationFailures = validateSourceContract({ ...inputs, submission: mutated });
  const originPolicyWorks = isPublicHttpsOrigin("https://api.jianwei.example") &&
    !isPublicHttpsOrigin("http://api.jianwei.example") &&
    !isPublicHttpsOrigin("https://127.0.0.1") &&
    !isPublicHttpsOrigin("https://10.0.0.1") &&
    !isPublicHttpsOrigin("https://api.jianwei.example/private") &&
    !isPublicHttpsOrigin("https://user:secret@api.jianwei.example");
  if (!mutationFailures.some((failure) => failure.includes("must not declare")) ||
      !originPolicyWorks || failures.length > 0) {
    throw new Error(`App Store submission self-test failed: ${[...failures, ...mutationFailures].join("; ")}`);
  }
  console.log(JSON.stringify({
    status: "GO",
    selfTest: true,
    mutationRejected: true,
    managedOriginPolicy: true
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
