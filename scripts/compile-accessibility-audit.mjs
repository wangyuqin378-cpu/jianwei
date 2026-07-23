import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  compileAccessibilityAudit,
  createAccessibilityAuditManifest,
  validateCompiledAccessibilityArtifact
} from "./lib/accessibility-audit.mjs";
import { parseFlagArgs, requiredString } from "./lib/fact-review.mjs";
import { prepareEvaluationRoot, resolveEvaluationOutput, sha256Bytes } from "./lib/beta-evidence-assembly.mjs";

if (process.argv.includes("--self-test")) {
  runSelfTest();
  process.exit(0);
}

const args = parseFlagArgs(process.argv.slice(2));
const [manifestBytes, reportBytes, evidenceBytes] = await Promise.all([
  readFile(path.resolve(process.cwd(), requiredString(args, "--manifest"))),
  readFile(path.resolve(process.cwd(), requiredString(args, "--report"))),
  readFile(path.resolve(process.cwd(), requiredString(args, "--evidence")))
]);
const artifact = compileAccessibilityAudit({
  manifest: JSON.parse(manifestBytes.toString("utf8")),
  manifestSha256: sha256Bytes(manifestBytes),
  reportBytes,
  report: JSON.parse(reportBytes.toString("utf8")),
  evidenceBytes
});
if (!args.has("--write")) {
  process.stdout.write(`ACCESSIBILITY_AUDIT_COMPILER_PREVIEW=GO audit=${artifact.accessibilityAuditProvenance.auditId} sourceDevice=${artifact.accessibilityAuditProvenance.sourceDeviceRunId} humanTalkBack=1 releaseEvidence=0 wrote=0\n`);
  process.exit(0);
}
const evaluationRoot = await prepareEvaluationRoot(process.cwd());
const output = await resolveEvaluationOutput(
  evaluationRoot,
  path.resolve(process.cwd(), String(args.get("--output") ?? "evaluation/compiled-accessibility-audit.json"))
);
await writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
process.stdout.write(`ACCESSIBILITY_AUDIT_COMPILER=GO audit=${artifact.accessibilityAuditProvenance.auditId} sourceDevice=${artifact.accessibilityAuditProvenance.sourceDeviceRunId} humanTalkBack=1 shaBound=1 wrote=1\n`);

function runSelfTest() {
  const input = fixtureInput();
  const manifest = createAccessibilityAuditManifest({
    auditId: "synthetic-talkback-audit",
    ...input,
    now: new Date("2026-01-10T00:01:00.000Z")
  });
  Object.assign(manifest, {
    reviewerId: "human-accessibility-reviewer",
    humanTalkBackAudit: true,
    spokenOutputReviewed: true,
    taskCompleted: true,
    onboardingDisclosureUnderstood: true,
    shareDisclosureUnderstood: true,
    privacyControlsUnderstood: true,
    auditedAt: "2026-01-09T00:00:00.000Z",
    evidenceRef: "controlled://accessibility/talkback-audit",
    humanConfirmed: true,
    confirmedAt: "2026-01-10T00:02:00.000Z"
  });
  const compile = (candidateManifest = manifest, candidateInput = input) => compileAccessibilityAudit({
    manifest: candidateManifest,
    manifestSha256: sha256Bytes(Buffer.from(`${JSON.stringify(candidateManifest, null, 2)}\n`, "utf8")),
    ...candidateInput,
    now: new Date("2026-01-10T00:03:00.000Z")
  });
  const artifact = compile();
  const physicalArtifact = { deviceRuns: [matchingPhysicalRun(input.report)] };
  validateCompiledAccessibilityArtifact(
    artifact,
    physicalArtifact,
    new Date("2026-01-10T00:04:00.000Z"),
    new Date("2026-01-10T00:04:00.000Z")
  );
  let rejected = 0;
  const expectFailure = (operation) => {
    try { operation(); } catch { rejected += 1; return; }
    throw new Error("Accessibility audit compiler accepted an invalid fixture");
  };
  expectFailure(() => compile({ ...manifest, reviewerId: "qwen-bot" }));
  expectFailure(() => compile(manifest, { ...input, evidenceBytes: Buffer.from("changed-evidence", "utf8") }));
  expectFailure(() => {
    const split = cloneInput(input);
    split.report.appVersion = "parsed-only-change";
    compile(manifest, split);
  });
  expectFailure(() => compile({ ...manifest, spokenOutputReviewed: false }));
  expectFailure(() => compile({ ...manifest, locale: "en-US" }));
  expectFailure(() => compile({ ...manifest, auditedAt: "2026-01-10T00:00:01.000Z" }));
  expectFailure(() => compile({ ...manifest, confirmedAt: "2026-01-10T00:00:30.000Z" }));
  expectFailure(() => {
    const emulator = cloneInput(input);
    emulator.report.buildFingerprint = "google/sdk_gphone64_x86_64/emulator";
    repackReport(emulator);
    createAccessibilityAuditManifest({ auditId: "emulator-audit", ...emulator, now: new Date("2026-01-10T00:01:00.000Z") });
  });
  expectFailure(() => {
    const extra = structuredClone(manifest);
    extra.deviceToken = "private";
    compile(extra);
  });
  expectFailure(() => compile({ ...manifest, evidenceRef: "" }));
  expectFailure(() => {
    const mismatched = { deviceRuns: [{ ...matchingPhysicalRun(input.report), model: "another-model" }] };
    validateCompiledAccessibilityArtifact(
      artifact,
      mismatched,
      new Date("2026-01-10T00:04:00.000Z"),
      new Date("2026-01-10T00:04:00.000Z")
    );
  });
  expectFailure(() => {
    const mismatched = { deviceRuns: [{ ...matchingPhysicalRun(input.report), apkSha256: "b".repeat(64) }] };
    validateCompiledAccessibilityArtifact(
      artifact,
      mismatched,
      new Date("2026-01-10T00:04:00.000Z"),
      new Date("2026-01-10T00:04:00.000Z")
    );
  });
  if (rejected !== 12) throw new Error(`Expected 12 rejected accessibility bypasses, observed ${rejected}`);
  process.stdout.write("ACCESSIBILITY_AUDIT_COMPILER_SELF_TEST=GO synthetic=1 releaseEvidence=0 reportBinding=1 evidenceBinding=1 apkShaBinding=1 humanReviewer=1 spokenOutput=1 disclosures=3 physicalRunCrossBinding=1 bypassesRejected=12\n");
}

function fixtureInput() {
  const report = {
    schemaVersion: 1,
    evidenceKind: "local_beta_device_metrics",
    evidenceId: "00000000-0000-4000-8000-000000000001",
    exportedAt: "2026-01-10T00:00:00.000Z",
    appVersion: "0.1.0-beta-oem",
    apkSha256: "a".repeat(64),
    manufacturer: "HUAWEI",
    model: "Huawei-physical-model",
    apiLevel: 34,
    buildFingerprint: "huawei/physical/release-keys",
    onboardingStartedAt: "2026-01-01T00:00:00.000Z",
    onboardingCompletedAt: "2026-01-01T00:01:00.000Z",
    widgetAdded: true,
    firstCardSeconds: 60,
    firstEngagedAt: "2026-01-02T00:00:00.000Z",
    feedbackCount: 2,
    likeCount: 1
  };
  const input = { report, evidenceBytes: Buffer.from("synthetic-human-talkback-evidence", "utf8") };
  repackReport(input);
  return input;
}

function matchingPhysicalRun(report) {
  return {
    runId: report.evidenceId,
    manufacturer: "Huawei",
    model: report.model,
    buildFingerprint: report.buildFingerprint,
    appVersion: report.appVersion,
    apkSha256: report.apkSha256,
    physicalDevice: true,
    testedAt: "2026-01-09T01:00:00.000Z",
    evidenceRef: "controlled://oem/run-1",
    apiLevel: report.apiLevel,
    permissionMode: "FULL",
    scanPassed: true,
    backgroundPassed: true,
    widgetOfflineDays: 7,
    deletePassed: true
  };
}

function cloneInput(input) {
  return { report: structuredClone(input.report), reportBytes: Buffer.from(input.reportBytes), evidenceBytes: Buffer.from(input.evidenceBytes) };
}

function repackReport(input) {
  input.reportBytes = Buffer.from(`${JSON.stringify(input.report, null, 2)}\n`, "utf8");
}
