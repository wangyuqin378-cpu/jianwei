import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resolveInput = (argument, fallback) => argument
  ? path.resolve(process.cwd(), argument)
  : path.join(repositoryRoot, fallback);
const metadataPath = resolveInput(process.argv[2], "ios/AppStore/metadata.zh-Hans.json");
const privacyManifestPath = resolveInput(process.argv[3], "ios/Jianwei/PrivacyInfo.xcprivacy");
const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
const failures = [];

const requireText = (name, maximum) => {
  const value = metadata[name];
  if (typeof value !== "string" || value.trim().length === 0) failures.push(`${name} is required`);
  else if ([...value].length > maximum) failures.push(`${name} exceeds ${maximum} characters`);
};

requireText("name", 30);
requireText("subtitle", 30);
requireText("promotionalText", 170);
requireText("description", 4000);
requireText("copyright", 100);

if (typeof metadata.keywords !== "string" || Buffer.byteLength(metadata.keywords, "utf8") > 100) {
  failures.push("keywords must contain at most 100 UTF-8 bytes");
}
for (const name of ["supportURL", "marketingURL", "privacyPolicyURL"]) {
  try {
    const url = new URL(metadata[name]);
    if (url.protocol !== "https:") failures.push(`${name} must use HTTPS`);
  } catch {
    failures.push(`${name} must be a valid URL`);
  }
}
if (metadata.supportURL === metadata.privacyPolicyURL) failures.push("support and privacy URLs must be distinct");
if (!metadata.description.includes("3 张") || !metadata.description.includes("1 条")) {
  failures.push("description must state the implemented daily 3-to-1 limit");
}
if (!metadata.description.includes("Qwen API Key") || !metadata.description.includes("见微 Pro")) {
  failures.push("description must disclose both AI access modes");
}

const decodedManifest = spawnSync(
  "/usr/bin/plutil",
  ["-convert", "json", "-o", "-", privacyManifestPath],
  { encoding: "utf8", timeout: 10_000 }
);
let privacyManifest;
try {
  privacyManifest = decodedManifest.status === 0
    ? JSON.parse(decodedManifest.stdout || "{}")
    : null;
} catch {
  privacyManifest = null;
}
if (!privacyManifest) {
  failures.push("PrivacyInfo.xcprivacy must be a valid privacy manifest plist");
} else {
  if (privacyManifest.NSPrivacyTracking !== false) {
    failures.push("privacy manifest must explicitly disable tracking");
  }
  if (!Array.isArray(privacyManifest.NSPrivacyTrackingDomains) || privacyManifest.NSPrivacyTrackingDomains.length > 0) {
    failures.push("privacy manifest must not declare tracking domains");
  }
  const requiredData = new Map([
    ["NSPrivacyCollectedDataTypePhotosorVideos", new Set([
      "NSPrivacyCollectedDataTypePurposeAppFunctionality",
      "NSPrivacyCollectedDataTypePurposeProductPersonalization"
    ])],
    ["NSPrivacyCollectedDataTypeDeviceID", new Set([
      "NSPrivacyCollectedDataTypePurposeAppFunctionality"
    ])],
    ["NSPrivacyCollectedDataTypeProductInteraction", new Set([
      "NSPrivacyCollectedDataTypePurposeAppFunctionality",
      "NSPrivacyCollectedDataTypePurposeProductPersonalization"
    ])]
  ]);
  const collected = Array.isArray(privacyManifest.NSPrivacyCollectedDataTypes)
    ? privacyManifest.NSPrivacyCollectedDataTypes
    : [];
  if (collected.length !== requiredData.size) {
    failures.push("privacy manifest collected-data contract has changed");
  }
  for (const item of collected) {
    const type = item?.NSPrivacyCollectedDataType;
    const expectedPurposes = requiredData.get(type);
    const actualPurposes = new Set(item?.NSPrivacyCollectedDataTypePurposes ?? []);
    if (!expectedPurposes) {
      failures.push(`privacy manifest contains an unexpected collected data type: ${type ?? "unknown"}`);
      continue;
    }
    if (item.NSPrivacyCollectedDataTypeLinked !== true || item.NSPrivacyCollectedDataTypeTracking !== false) {
      failures.push(`${type} must be linked for disclosure and must not be used for tracking`);
    }
    if (actualPurposes.size !== expectedPurposes.size ||
        [...expectedPurposes].some((purpose) => !actualPurposes.has(purpose))) {
      failures.push(`${type} purposes do not match the reviewed privacy contract`);
    }
    requiredData.delete(type);
  }
  for (const missingType of requiredData.keys()) {
    failures.push(`privacy manifest is missing collected data type: ${missingType}`);
  }
  if (!Array.isArray(privacyManifest.NSPrivacyAccessedAPITypes) || privacyManifest.NSPrivacyAccessedAPITypes.length > 0) {
    failures.push("privacy manifest must not declare required-reason APIs that the current iOS source does not use");
  }
}

console.log(JSON.stringify({ status: failures.length === 0 ? "GO" : "NO_GO", failures }, null, 2));
if (failures.length > 0) process.exitCode = 1;
