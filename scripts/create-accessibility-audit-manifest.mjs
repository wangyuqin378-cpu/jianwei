import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createAccessibilityAuditManifest } from "./lib/accessibility-audit.mjs";
import { parseFlagArgs, requiredString } from "./lib/fact-review.mjs";
import { prepareEvaluationRoot, resolveEvaluationOutput } from "./lib/beta-evidence-assembly.mjs";

if (process.argv.includes("--self-test")) {
  const { report, reportBytes, evidenceBytes } = fixtureInput();
  const manifest = createAccessibilityAuditManifest({
    auditId: "synthetic-talkback-audit",
    report,
    reportBytes,
    evidenceBytes,
    now: new Date("2026-01-10T00:01:00.000Z")
  });
  if (manifest.reviewerId || manifest.humanTalkBackAudit || manifest.spokenOutputReviewed || manifest.taskCompleted ||
      manifest.onboardingDisclosureUnderstood || manifest.shareDisclosureUnderstood ||
      manifest.privacyControlsUnderstood || manifest.auditedAt || manifest.evidenceRef ||
      manifest.humanConfirmed || manifest.confirmedAt || manifest.locale !== "zh-CN") {
    throw new Error("Accessibility manifest self-test pre-confirmed human conclusions");
  }
  process.stdout.write("ACCESSIBILITY_AUDIT_MANIFEST_SELF_TEST=GO synthetic=1 releaseEvidence=0 reportBinding=1 evidenceBinding=1 locale=zh-CN preconfirmed=0\n");
  process.exit(0);
}

const args = parseFlagArgs(process.argv.slice(2));
const [reportBytes, evidenceBytes] = await Promise.all([
  readFile(path.resolve(process.cwd(), requiredString(args, "--report"))),
  readFile(path.resolve(process.cwd(), requiredString(args, "--evidence")))
]);
const manifest = createAccessibilityAuditManifest({
  auditId: requiredString(args, "--audit-id"),
  reportBytes,
  report: JSON.parse(reportBytes.toString("utf8")),
  evidenceBytes
});
if (!args.has("--write")) {
  process.stdout.write(`ACCESSIBILITY_AUDIT_MANIFEST_PREVIEW=GO audit=${manifest.auditId} preconfirmed=0 releaseEvidence=0 wrote=0\n`);
  process.exit(0);
}
const evaluationRoot = await prepareEvaluationRoot(process.cwd());
const output = await resolveEvaluationOutput(
  evaluationRoot,
  path.resolve(process.cwd(), String(args.get("--output") ?? "evaluation/accessibility-audit-manifest.json"))
);
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
process.stdout.write(`ACCESSIBILITY_AUDIT_MANIFEST=GO audit=${manifest.auditId} preconfirmed=0 releaseEvidence=0 wrote=1\n`);

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
  return {
    report,
    reportBytes: Buffer.from(`${JSON.stringify(report, null, 2)}\n`, "utf8"),
    evidenceBytes: Buffer.from("synthetic-human-talkback-evidence", "utf8")
  };
}
