import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createBetaCohortManifest } from "./compile-beta-cohort.mjs";

function parseArgs(values) {
  const args = new Map();
  const reports = [];
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (key === "--write") args.set(key, true);
    else if (typeof key === "string" && key.startsWith("--")) args.set(key, values[++index]);
    else reports.push(key);
  }
  return { args, reports };
}

const { args, reports: reportFiles } = parseArgs(process.argv.slice(2));
if (reportFiles.length === 0) throw new Error("Pass every retained app-exported Beta report JSON file");
const reportSetId = String(args.get("--report-set-id") ?? "");
const outputPath = path.resolve(process.cwd(), String(args.get("--output") ?? "evaluation/beta-cohort-manifest.json"));
const reports = await Promise.all(reportFiles.map(async (file) => JSON.parse(await readFile(path.resolve(process.cwd(), file), "utf8"))));
const manifest = createBetaCohortManifest({ reports, reportSetId });
if (!args.has("--write")) {
  process.stdout.write(`BETA_COHORT_MANIFEST_PREVIEW=GO reportSet=${manifest.reportSetId} reports=${manifest.assignments.length} preconfirmed=0 wrote=0\n`);
  process.exit(0);
}
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
process.stdout.write(`BETA_COHORT_MANIFEST=GO reportSet=${manifest.reportSetId} reports=${manifest.assignments.length} preconfirmed=0 wrote=1\n`);
