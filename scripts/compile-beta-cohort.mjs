import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { summarizeDeviceMetrics } from "./summarize-beta-device-metrics.mjs";
import { isMainModule } from "./lib/main-module.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;
const AUTOMATION_ID = /(?:codex|chatgpt|gpt|kimi|moonshot|qwen|claude|gemini|llama|automation|robot)/i;

export function compileBetaCohort({ reports, manifest, manifestSha256, now = new Date() }) {
  assert(Array.isArray(reports) && reports.length > 0, "At least one retained device report is required");
  const summary = summarizeDeviceMetrics(reports);
  assert(summary.status === "GO", `Device reports are invalid: ${summary.blockers.join("; ")}`);
  const sortedReports = [...reports].sort((left, right) => left.evidenceId.localeCompare(right.evidenceId));
  const reportsSha256 = reportSetDigest(sortedReports);

  assertPlainObject(manifest, "cohort manifest");
  assertExactKeys(manifest, [
    "schemaVersion", "evidenceKind", "reportSetId", "reportSetSha256", "cohortOwner",
    "appVersion", "apkSha256", "reportsEvidenceRef", "manifestEvidenceRef", "measuredAt", "assignments"
  ], "cohort manifest");
  assert(manifest.schemaVersion === 1 && manifest.evidenceKind === "beta_cohort_manifest", "Cohort manifest schema or evidence kind is invalid");
  assert(validToken(manifest.reportSetId), "Cohort reportSetId is invalid");
  assert(manifest.reportSetSha256 === reportsSha256, "Cohort report-set SHA-256 is stale");
  assert(/^[a-f0-9]{64}$/.test(manifestSha256 ?? ""), "Exact cohort manifest SHA-256 is required");
  assert(validHumanId(manifest.cohortOwner), "Cohort manifest must identify an accountable human owner");
  assert(boundedText(manifest.appVersion, 1, 100), "Cohort manifest appVersion is required");
  assert(/^[a-f0-9]{64}$/.test(manifest.apkSha256 ?? ""), "Cohort manifest APK SHA-256 is required");
  assert(boundedText(manifest.reportsEvidenceRef, 1, 500) && boundedText(manifest.manifestEvidenceRef, 1, 500), "Cohort retained evidence references are required");
  const measuredAt = strictIso(manifest.measuredAt);
  assert(measuredAt && measuredAt <= now, "Cohort measuredAt must be a non-future strict ISO timestamp");
  assert(Array.isArray(manifest.assignments) && manifest.assignments.length === sortedReports.length, "Cohort manifest must assign every report exactly once");

  const reportById = new Map(sortedReports.map((report) => [report.evidenceId, report]));
  assert(reportById.size === sortedReports.length, "Device report IDs are duplicated");
  assert(sortedReports.every((report) => report.appVersion === manifest.appVersion), "Cohort reports contain a different app version");
  assert(sortedReports.every((report) => report.apkSha256 === manifest.apkSha256), "Cohort reports contain a different APK SHA-256");
  const assignmentById = new Map();
  const grayDurations = [];
  for (const assignment of manifest.assignments) {
    validateAssignment(assignment);
    assert(!assignmentById.has(assignment.evidenceId), `Duplicate cohort assignment: ${assignment.evidenceId}`);
    const report = reportById.get(assignment.evidenceId);
    assert(report, `Cohort assignment has no retained report: ${assignment.evidenceId}`);
    const expandedStartedAt = strictIso(assignment.expandedStartedAt);
    const expandedObservedThrough = strictIso(assignment.expandedObservedThrough);
    const exportedAt = timestamp(report.exportedAt);
    const completedAt = timestamp(report.onboardingCompletedAt);
    assert(expandedStartedAt && expandedObservedThrough && exportedAt && completedAt, `Expanded cohort timestamps are invalid: ${assignment.evidenceId}`);
    assert(expandedStartedAt <= expandedObservedThrough && expandedObservedThrough <= exportedAt && exportedAt <= measuredAt,
      `Expanded cohort timestamp order is invalid: ${assignment.evidenceId}`);
    assert(expandedObservedThrough.getTime() >= completedAt.getTime() + 7 * DAY_MS,
      `Expanded cohort report lacks seven full observation days: ${assignment.evidenceId}`);

    const hasGrayStart = assignment.grayStartedAt !== null;
    const hasGrayEnd = assignment.grayObservedThrough !== null;
    assert(hasGrayStart === hasGrayEnd, `Gray cohort timestamps must both be present or null: ${assignment.evidenceId}`);
    if (hasGrayStart) {
      const grayStartedAt = strictIso(assignment.grayStartedAt);
      const grayObservedThrough = strictIso(assignment.grayObservedThrough);
      assert(grayStartedAt && grayObservedThrough && grayStartedAt >= expandedStartedAt && grayObservedThrough <= expandedObservedThrough && grayStartedAt <= grayObservedThrough,
        `Gray cohort timestamp order is invalid: ${assignment.evidenceId}`);
      grayDurations.push(Math.floor((grayObservedThrough.getTime() - grayStartedAt.getTime()) / DAY_MS));
    }
    assignmentById.set(assignment.evidenceId, assignment);
  }
  assert([...reportById.keys()].every((id) => assignmentById.has(id)), "Cohort manifest omitted a retained report");

  const grayDays = grayDurations.length === 0 ? 0 : Math.min(...grayDurations);
  const beta = {
    grayUsers: grayDurations.length,
    grayDays,
    expandedUsers: sortedReports.length,
    onboardingCompleted: summary.metrics.onboardingCompleted,
    widgetAdded: summary.metrics.widgetAdded,
    engaged7dUsers: summary.metrics.engaged7dUsers,
    feedbackCount: summary.metrics.feedbackCount,
    likeCount: summary.metrics.likeCount,
    firstCardSeconds: summary.metrics.firstCardSeconds,
    evidenceRef: manifest.manifestEvidenceRef,
    measuredAt: manifest.measuredAt
  };
  return {
    schemaVersion: 1,
    evidenceKind: "compiled_beta_cohort",
    generatedAt: now.toISOString(),
    betaProvenance: {
      evidenceKind: "compiled_beta_cohort",
      reportSetId: manifest.reportSetId,
      reportsEvidenceRef: manifest.reportsEvidenceRef,
      manifestEvidenceRef: manifest.manifestEvidenceRef,
      reportsSha256,
      manifestSha256,
      reportCount: sortedReports.length,
      appVersion: manifest.appVersion,
      apkSha256: manifest.apkSha256,
      compiledAt: now.toISOString()
    },
    beta
  };
}

export function createBetaCohortManifest({ reports, reportSetId }) {
  const summary = summarizeDeviceMetrics(reports);
  assert(summary.status === "GO", `Device reports are invalid: ${summary.blockers.join("; ")}`);
  assert(validToken(reportSetId), "Cohort reportSetId is invalid");
  const sortedReports = [...reports].sort((left, right) => left.evidenceId.localeCompare(right.evidenceId));
  const versions = new Set(sortedReports.map((report) => report.appVersion));
  assert(versions.size === 1, "Cohort reports must use one app version");
  const apkDigests = new Set(sortedReports.map((report) => report.apkSha256));
  assert(apkDigests.size === 1, "Cohort reports must use one APK SHA-256");
  return {
    schemaVersion: 1,
    evidenceKind: "beta_cohort_manifest",
    reportSetId,
    reportSetSha256: reportSetDigest(sortedReports),
    cohortOwner: "",
    appVersion: sortedReports[0].appVersion,
    apkSha256: sortedReports[0].apkSha256,
    reportsEvidenceRef: "",
    manifestEvidenceRef: "",
    measuredAt: "",
    assignments: sortedReports.map((report) => ({
      evidenceId: report.evidenceId,
      grayStartedAt: null,
      grayObservedThrough: null,
      expandedStartedAt: "",
      expandedObservedThrough: ""
    }))
  };
}

export function reportSetDigest(reports) {
  const canonical = [...reports].sort((left, right) => left.evidenceId.localeCompare(right.evidenceId));
  return sha256(Buffer.from(`${JSON.stringify(canonical, null, 2)}\n`, "utf8"));
}

function validateAssignment(assignment) {
  assertPlainObject(assignment, "cohort assignment");
  assertExactKeys(assignment, [
    "evidenceId", "grayStartedAt", "grayObservedThrough", "expandedStartedAt", "expandedObservedThrough"
  ], `cohort assignment ${assignment.evidenceId ?? "<missing>"}`);
  assert(validUuid(assignment.evidenceId), "Cohort assignment evidenceId is invalid");
  assert(typeof assignment.expandedStartedAt === "string" && typeof assignment.expandedObservedThrough === "string", "Expanded cohort timestamps are required");
  assert(assignment.grayStartedAt === null || typeof assignment.grayStartedAt === "string", "Gray cohort start must be a timestamp or null");
  assert(assignment.grayObservedThrough === null || typeof assignment.grayObservedThrough === "string", "Gray cohort observation must be a timestamp or null");
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  assert(actual.length === wanted.length && actual.every((key, index) => key === wanted[index]), `${label} contains unknown or missing fields`);
}

function assertPlainObject(value, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
}

function validToken(value) {
  return typeof value === "string" && /^[A-Za-z0-9._-]{3,128}$/.test(value);
}

function validUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validHumanId(value) {
  return boundedText(value, 1, 128) && /^[\p{L}\p{N}._@-]+$/u.test(value) &&
    !AUTOMATION_ID.test(value) && !/(?:^|[._@-])(?:ai|bot)(?:$|[._@-])/i.test(value);
}

function boundedText(value, minimum, maximum) {
  return typeof value === "string" && value.trim().length >= minimum && value.trim().length <= maximum;
}

function strictIso(value) {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value ? parsed : null;
}

function timestamp(value) {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseArgs(values) {
  const args = new Map();
  const reports = [];
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (key === "--write" || key === "--self-test") args.set(key, true);
    else if (typeof key === "string" && key.startsWith("--")) args.set(key, values[++index]);
    else reports.push(key);
  }
  return { args, reports };
}

function fixtureReport(index, { exportedAt = "2026-07-28T00:00:00.000Z" } = {}) {
  return {
    schemaVersion: 1,
    evidenceKind: "local_beta_device_metrics",
    evidenceId: `00000000-0000-4000-8${String(index).padStart(3, "0")}-000000000001`,
    exportedAt,
    appVersion: "0.1.0-beta17",
    apkSha256: "a".repeat(64),
    manufacturer: "Physical",
    model: `Device-${index}`,
    apiLevel: 34,
    buildFingerprint: `physical/device/${index}`,
    onboardingStartedAt: "2026-07-18T00:00:00.000Z",
    onboardingCompletedAt: "2026-07-18T00:01:00.000Z",
    widgetAdded: index < 15,
    firstCardSeconds: 60 + index,
    firstEngagedAt: index < 10 ? "2026-07-19T00:00:00.000Z" : null,
    feedbackCount: 2,
    likeCount: 1
  };
}

async function runSelfTest() {
  const reports = Array.from({ length: 20 }, (_, index) => fixtureReport(index));
  const manifest = createBetaCohortManifest({ reports, reportSetId: "synthetic-beta17" });
  manifest.cohortOwner = "human-reviewer-17";
  manifest.reportsEvidenceRef = "retained-device-report-set";
  manifest.manifestEvidenceRef = "retained-cohort-manifest";
  manifest.measuredAt = "2026-07-29T00:00:00.000Z";
  for (const [index, assignment] of manifest.assignments.entries()) {
    assignment.expandedStartedAt = "2026-07-18T00:00:00.000Z";
    assignment.expandedObservedThrough = "2026-07-26T00:00:00.000Z";
    if (index < 10) {
      assignment.grayStartedAt = "2026-07-18T00:00:00.000Z";
      assignment.grayObservedThrough = "2026-07-21T00:00:00.000Z";
    }
  }
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  const result = compileBetaCohort({
    reports,
    manifest,
    manifestSha256: sha256(Buffer.from(manifestText, "utf8")),
    now: new Date("2026-07-30T00:00:00.000Z")
  });
  assert(result.beta.grayUsers === 10 && result.beta.grayDays === 3 && result.beta.expandedUsers === 20, "Beta cohort passing fixture produced incorrect metrics");
  let rejected = 0;
  const attempts = [
    () => compileBetaCohort({ reports, manifest: { ...manifest, reportSetSha256: "0".repeat(64) }, manifestSha256: "a".repeat(64), now: new Date("2026-07-30T00:00:00.000Z") }),
    () => compileBetaCohort({ reports, manifest: { ...manifest, cohortOwner: "kimi-bot" }, manifestSha256: "a".repeat(64), now: new Date("2026-07-30T00:00:00.000Z") }),
    () => compileBetaCohort({ reports, manifest: { ...manifest, assignments: manifest.assignments.slice(1) }, manifestSha256: "a".repeat(64), now: new Date("2026-07-30T00:00:00.000Z") }),
    () => {
      const underObserved = structuredClone(manifest);
      underObserved.assignments[19].expandedObservedThrough = "2026-07-20T00:00:00.000Z";
      return compileBetaCohort({ reports, manifest: underObserved, manifestSha256: "a".repeat(64), now: new Date("2026-07-30T00:00:00.000Z") });
    },
    () => {
      const mixedReports = structuredClone(reports);
      mixedReports[19].apkSha256 = "b".repeat(64);
      return createBetaCohortManifest({ reports: mixedReports, reportSetId: "mixed-apk" });
    }
  ];
  for (const attempt of attempts) {
    try { attempt(); } catch { rejected += 1; }
  }
  assert(rejected === attempts.length, "Beta cohort compiler accepted an invalid fixture");
  process.stdout.write("BETA_COHORT_COMPILER_SELF_TEST=GO synthetic=1 releaseEvidence=0 reports=20 gray=10 expanded=20 apkShaBinding=1 bypassesRejected=5\n");
}

if (isMainModule(import.meta.url)) {
  const { args, reports: reportFiles } = parseArgs(process.argv.slice(2));
  if (args.has("--self-test")) {
    await runSelfTest();
  } else {
    assert(reportFiles.length > 0, "Pass every retained app-exported Beta report JSON file");
    const manifestPath = path.resolve(process.cwd(), String(args.get("--manifest") ?? "evaluation/beta-cohort-manifest.json"));
    const outputPath = path.resolve(process.cwd(), String(args.get("--output") ?? "evaluation/beta-cohort-compiled.json"));
    const reports = await Promise.all(reportFiles.map(async (file) => JSON.parse(await readFile(path.resolve(process.cwd(), file), "utf8"))));
    const manifestBytes = await readFile(manifestPath);
    const manifest = JSON.parse(manifestBytes.toString("utf8"));
    const result = compileBetaCohort({ reports, manifest, manifestSha256: sha256(manifestBytes) });
    if (!args.has("--write")) {
      process.stdout.write(`BETA_COHORT_COMPILER_PREVIEW=GO reports=${result.beta.expandedUsers} gray=${result.beta.grayUsers} grayDays=${result.beta.grayDays} releaseEvidence=0 wrote=0\n`);
    } else {
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
      process.stdout.write(`BETA_COHORT_COMPILER=GO reports=${result.beta.expandedUsers} gray=${result.beta.grayUsers} grayDays=${result.beta.grayDays} wrote=1\n`);
    }
  }
}
