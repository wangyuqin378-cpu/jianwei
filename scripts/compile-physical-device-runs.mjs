import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  compilePhysicalDeviceRuns,
  createPhysicalDeviceRunManifest
} from "./lib/physical-device-runs.mjs";
import { prepareEvaluationRoot, resolveEvaluationOutput, sha256Bytes } from "./lib/beta-evidence-assembly.mjs";

const parsed = parseArgs(process.argv.slice(2));
if (parsed.selfTest) {
  runSelfTest();
  process.exit(0);
}
if (!parsed.manifest) throw new Error("--manifest is required");
if (parsed.pairs.length < 3) throw new Error("Pass the same complete 3-10 --run report/evidence pairs used to create the manifest");
const [manifestBytes, inputs] = await Promise.all([
  readFile(path.resolve(process.cwd(), parsed.manifest)),
  readPairs(parsed.pairs)
]);
const artifact = compilePhysicalDeviceRuns({
  manifest: JSON.parse(manifestBytes.toString("utf8")),
  manifestSha256: sha256Bytes(manifestBytes),
  inputs
});
if (!parsed.write) {
  process.stdout.write(`PHYSICAL_DEVICE_COMPILER_PREVIEW=GO runSet=${artifact.physicalDeviceRunProvenance.runSetId} runs=${artifact.deviceRuns.length} appVersion=${artifact.physicalDeviceRunProvenance.appVersion} releaseEvidence=0 wrote=0\n`);
  process.exit(0);
}
const evaluationRoot = await prepareEvaluationRoot(process.cwd());
const output = await resolveEvaluationOutput(
  evaluationRoot,
  path.resolve(process.cwd(), parsed.output ?? "evaluation/compiled-physical-device-runs.json")
);
await writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
process.stdout.write(`PHYSICAL_DEVICE_COMPILER=GO runSet=${artifact.physicalDeviceRunProvenance.runSetId} runs=${artifact.deviceRuns.length} appVersion=${artifact.physicalDeviceRunProvenance.appVersion} shaBound=1 wrote=1\n`);

function runSelfTest() {
  const inputs = fixtureInputs();
  const manifest = createPhysicalDeviceRunManifest({
    runSetId: "synthetic-oem-matrix",
    inputs,
    now: new Date("2026-01-10T00:01:00.000Z")
  });
  manifest.evidenceOwner = "human-oem-reviewer";
  manifest.approvedAt = "2026-01-10T00:02:00.000Z";
  for (const [index, run] of manifest.runs.entries()) {
    run.evidenceRef = `controlled://oem/run-${index + 1}`;
    run.permissionMode = ["FULL", "PARTIAL", "DENIED"][index];
    run.scanPassed = true;
    run.backgroundPassed = true;
    run.widgetObservedFrom = "2026-01-02T00:00:00.000Z";
    run.widgetObservedThrough = "2026-01-09T00:00:00.000Z";
    run.deletePassed = true;
    run.testedAt = "2026-01-09T01:00:00.000Z";
    run.humanConfirmed = true;
  }
  const compile = (candidateManifest = manifest, candidateInputs = inputs) => compilePhysicalDeviceRuns({
    manifest: candidateManifest,
    manifestSha256: sha256Bytes(Buffer.from(`${JSON.stringify(candidateManifest, null, 2)}\n`, "utf8")),
    inputs: candidateInputs,
    now: new Date("2026-01-10T00:03:00.000Z")
  });
  const result = compile();
  if (result.deviceRuns.length !== 3 || result.deviceRuns.some((run) => run.widgetOfflineDays !== 7 || run.physicalDevice !== true)) {
    throw new Error("Physical-device compiler passing fixture failed");
  }
  let rejected = 0;
  const expectFailure = (operation) => {
    try { operation(); } catch { rejected += 1; return; }
    throw new Error("Physical-device compiler accepted an invalid fixture");
  };
  expectFailure(() => compile({ ...manifest, evidenceOwner: "codex-bot" }));
  expectFailure(() => {
    const changed = cloneInputs(inputs);
    changed[0].report.appVersion = "split-parsed-value";
    compile(manifest, changed);
  });
  expectFailure(() => {
    const changed = cloneInputs(inputs);
    changed[0].evidenceBytes = Buffer.from("changed-evidence", "utf8");
    compile(manifest, changed);
  });
  expectFailure(() => {
    const short = structuredClone(manifest);
    short.runs[0].widgetObservedThrough = "2026-01-08T23:59:59.000Z";
    compile(short);
  });
  expectFailure(() => {
    const missing = structuredClone(manifest);
    missing.runs.pop();
    compile(missing);
  });
  expectFailure(() => {
    const falseClaim = structuredClone(manifest);
    falseClaim.runs[1].backgroundPassed = false;
    compile(falseClaim);
  });
  expectFailure(() => {
    const extra = structuredClone(manifest);
    extra.runs[0].deviceToken = "private";
    compile(extra);
  });
  expectFailure(() => {
    const reused = cloneInputs(inputs);
    reused[1].evidenceBytes = Buffer.from(reused[0].evidenceBytes);
    createPhysicalDeviceRunManifest({ runSetId: "reused", inputs: reused });
  });
  expectFailure(() => {
    const emulator = cloneInputs(inputs);
    emulator[0].report.buildFingerprint = "google/sdk_gphone64_x86_64/emulator";
    repackReport(emulator[0]);
    createPhysicalDeviceRunManifest({ runSetId: "emulator", inputs: emulator });
  });
  expectFailure(() => {
    const mixed = cloneInputs(inputs);
    mixed[2].report.appVersion = "different-app";
    repackReport(mixed[2]);
    createPhysicalDeviceRunManifest({ runSetId: "mixed", inputs: mixed });
  });
  expectFailure(() => {
    const mixed = cloneInputs(inputs);
    mixed[2].report.apkSha256 = "b".repeat(64);
    repackReport(mixed[2]);
    createPhysicalDeviceRunManifest({ runSetId: "mixed-apk", inputs: mixed });
  });
  if (rejected !== 11) throw new Error(`Expected 11 rejected physical-device bypasses, observed ${rejected}`);
  process.stdout.write("PHYSICAL_DEVICE_COMPILER_SELF_TEST=GO synthetic=1 releaseEvidence=0 runs=3 oemMatrix=1 permissionModes=3 sevenDayWindow=1 artifactShaBinding=1 apkShaBinding=1 humanConfirmation=1 bypassesRejected=11\n");
}

function parseArgs(values) {
  const output = { pairs: [], manifest: null, output: null, write: false, selfTest: false };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--write") output.write = true;
    else if (value === "--self-test") output.selfTest = true;
    else if (value === "--run") {
      const report = values[++index];
      const evidence = values[++index];
      if (!report || !evidence || report.startsWith("--") || evidence.startsWith("--")) throw new Error("--run requires a report and evidence-bundle path");
      output.pairs.push({ report, evidence });
    } else if (value === "--manifest") output.manifest = values[++index];
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
    const report = {
      schemaVersion: 1,
      evidenceKind: "local_beta_device_metrics",
      evidenceId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
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
    const input = { report, evidenceBytes: Buffer.from(`synthetic-evidence-${manufacturer}`, "utf8") };
    repackReport(input);
    return input;
  });
}

function cloneInputs(inputs) {
  return inputs.map((input) => ({
    report: structuredClone(input.report),
    reportBytes: Buffer.from(input.reportBytes),
    evidenceBytes: Buffer.from(input.evidenceBytes)
  }));
}

function repackReport(input) {
  input.reportBytes = Buffer.from(`${JSON.stringify(input.report, null, 2)}\n`, "utf8");
}
