import { readFile } from "node:fs/promises";

const metadataPath = process.argv[2] || "ios/AppStore/metadata.zh-Hans.json";
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

console.log(JSON.stringify({ status: failures.length === 0 ? "GO" : "NO_GO", failures }, null, 2));
if (failures.length > 0) process.exitCode = 1;
