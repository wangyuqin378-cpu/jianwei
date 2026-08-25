import { copyFile, mkdir, readFile, rm, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const [resultPath, outputPath] = process.argv.slice(2);
if (!resultPath || !outputPath) {
  throw new Error("Usage: node scripts/export-ios-app-store-screenshots.mjs <xcresult> <output-directory>");
}

await stat(resultPath);
try {
  await stat(outputPath);
  throw new Error(`Output already exists: ${outputPath}`);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const temporary = `${outputPath}.exporting-${process.pid}`;
await rm(temporary, { recursive: true, force: true });
await mkdir(temporary, { recursive: true });

const developerDir = process.env.DEVELOPER_DIR || "/Applications/Xcode.app/Contents/Developer";
const exported = spawnSync(
  "/usr/bin/xcrun",
  ["xcresulttool", "export", "attachments", "--path", resultPath, "--output-path", temporary],
  { encoding: "utf8", env: { ...process.env, DEVELOPER_DIR: developerDir } }
);
if (exported.status !== 0) {
  await rm(temporary, { recursive: true, force: true });
  throw new Error(exported.error?.message || exported.stderr || exported.stdout || "xcresult attachment export failed");
}

const manifest = JSON.parse(await readFile(path.join(temporary, "manifest.json"), "utf8"));
const attachments = manifest
  .flatMap((entry) => entry.attachments ?? [])
  .filter((item) => /^app-store-\d{2}-[a-z0-9-]+_\d+_[A-F0-9-]+\.png$/.test(item.suggestedHumanReadableName));

if (attachments.length < 1 || attachments.length > 10) {
  await rm(temporary, { recursive: true, force: true });
  throw new Error(`Expected 1-10 App Store screenshots, found ${attachments.length}`);
}

await mkdir(outputPath, { recursive: false });
const exportedNames = [];
for (const attachment of attachments) {
  const match = /^(app-store-\d{2}-[a-z0-9-]+)_/.exec(attachment.suggestedHumanReadableName);
  const outputName = `${match[1]}.png`;
  const data = await readFile(path.join(temporary, attachment.exportedFileName));
  if (data.toString("ascii", 1, 4) !== "PNG") throw new Error(`${outputName} is not a PNG`);
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  const colorType = data[25];
  if (width !== 1320 || height !== 2868) {
    throw new Error(`${outputName} must be 1320x2868, got ${width}x${height}`);
  }
  if (colorType === 4 || colorType === 6) throw new Error(`${outputName} must not contain an alpha channel`);
  await copyFile(path.join(temporary, attachment.exportedFileName), path.join(outputPath, outputName));
  exportedNames.push(outputName);
}

await rm(temporary, { recursive: true, force: true });
console.log(JSON.stringify({ status: "GO", screenshots: exportedNames.sort() }, null, 2));
