import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createPhysicalDeviceRunManifest } from "./lib/physical-device-runs.mjs";
import { prepareEvaluationRoot, resolveEvaluationOutput } from "./lib/beta-evidence-assembly.mjs";

const parsed = parseArgs(process.argv.slice(2));
if (parsed.selfTest) {
  const manifest = createPhysicalDeviceRunManifest({
    runSetId: "synthetic-oem-matrix",
    inputs: fixtureInputs(),
    now: new Date("2026-01-10T00:01:00.000Z")
  });
  if (manifest.runs.length !== 3 || manifest.evidenceOwner !== "" || manifest.approvedAt !== "" ||
      manifest.runs.some((run) => run.permissionMode || run.scanPassed || run.backgroundPassed ||
        run.widgetObservedFrom || run.widgetObservedThrough || run.deletePassed || run.testedAt || run.humanConfirmed || run.evidenceRef)) {
    throw new Error("Physical-device manifest self-test pre-confirmed human observations");
  }
  process.stdout.write("PHYSICAL_DEVICE_MANIFEST_SELF_TEST=GO synthetic=1 releaseEvidence=0 runs=3 oemMatrix=1 artifactBindings=6 preconfirmed=0\n");
  process.exit(0);
}
if (!parsed.runSetId) throw new Error("--run-set-id is required");
if (parsed.pairs.length < 3) throw new Error("Pass 3-10 --run <app-report.json> <retained-evidence-bundle> pairs");
const inputs = await readPairs(parsed.pairs);
const manifest = createPhysicalDeviceRunManifest({ runSetId: parsed.runSetId, inputs });
if (!parsed.write) {
  process.stdout.write(`PHYSICAL_DEVICE_MANIFEST_PREVIEW=GO runSet=${manifest.runSetId} runs=${manifest.runs.length} preconfirmed=0 releaseEvidence=0 wrote=0\n`);
  process.exit(0);
}
const evaluationRoot = await prepareEvaluationRoot(process.cwd());
const output = await resolveEvaluationOutput(
  evaluationRoot,
  path.resolve(process.cwd(), parsed.output ?? "evaluation/physical-device-run-manifest.json")
);
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
process.stdout.write(`PHYSICAL_DEVICE_MANIFEST=GO runSet=${manifest.runSetId} runs=${manifest.runs.length} preconfirmed=0 releaseEvidence=0 wrote=1\n`);

function parseArgs(values) {
  const output = { pairs: [], runSetId: null, output: null, write: false, selfTest: false };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--write") output.write = true;
    else if (value === "--self-test") output.selfTest = true;
    else if (value === "--run") {
      const report = values[++index];
      const evidence = values[++index];
      if (!report || !evidence || report.startsWith("--") || evidence.startsWith("--")) throw new Error("--run requires a report and evidence-bundle path");
      output.pairs.push({ report, evidence });
    } else if (value === "--run-set-id") output.runSetId = values[++index];
    else if (value === "--output") output.output = values[++index];
    else throw new Error(`Unexpected argument: ${value}`);
  }
  return output;
}

async function readPairs(pairs) {
  return Promise.all(pairs.map(async ({ report, evidence }) => {
    const [reportBytes, evidenceBytes] = await Promise.all([
      readFile(path.resolve(process.cwd(), report)),
      readFile(path.resolve(process.cwd(), evidence))
    ]);
    return { reportBytes, report: JSON.parse(reportBytes.toString("utf8")), evidenceBytes };
  }));
}

function fixtureInputs() {
  return ["HUAWEI", "Xiaomi", "OPPO"].map((manufacturer, index) => {
    const report = fixtureReport(manufacturer, index + 1);
    return {
      report,
      reportBytes: Buffer.from(`${JSON.stringify(report, null, 2)}\n`, "utf8"),
      evidenceBytes: Buffer.from(`synthetic-retained-evidence-${manufacturer}`, "utf8")
    };
  });
}

function fixtureReport(manufacturer, suffix) {
  return {
    schemaVersion: 1,
    evidenceKind: "local_beta_device_metrics",
    evidenceId: `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`,
    exportedAt: "2026-01-10T00:00:00.000Z",
    appVersion: "0.1.0-beta-oem",
    apkSha256: "a".repeat(64),
    manufacturer,
    model: `${manufacturer}-physical-model`,
    apiLevel: 34,
    buildFingerprint: `${manufacturer.toLowerCase()}/physical/release-keys`,
    onboardingStartedAt: "2026-01-01T00:00:00.000Z",
    onboardingCompletedAt: "2026-01-01T00:01:00.000Z",
    widgetAdded: true,
    firstCardSeconds: 60,
    firstEngagedAt: "2026-01-02T00:00:00.000Z",
    feedbackCount: 2,
    likeCount: 1
  };
}
