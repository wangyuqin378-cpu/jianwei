import { readFile } from "node:fs/promises";
import { isMainModule } from "./lib/main-module.mjs";

export function summarizeDeviceMetrics(reports) {
  const blockers = [];
  const check = (condition, message) => { if (!condition) blockers.push(message); };
  check(reports.length > 0, "at least one local Beta report is required");
  const ids = new Set();
  const allowedKeys = new Set([
    "schemaVersion", "evidenceKind", "evidenceId", "exportedAt", "appVersion", "apkSha256", "manufacturer",
    "model", "apiLevel", "buildFingerprint", "onboardingStartedAt", "onboardingCompletedAt",
    "widgetAdded", "firstCardSeconds", "firstEngagedAt", "feedbackCount", "likeCount"
  ]);
  for (const [index, report] of reports.entries()) {
    const label = `report ${index + 1}`;
    check(report && typeof report === "object" && !Array.isArray(report), `${label} must be an object`);
    check(Object.keys(report ?? {}).every((key) => allowedKeys.has(key)), `${label} contains a forbidden or unknown field`);
    check(Object.keys(report ?? {}).length === allowedKeys.size, `${label} is missing required fields`);
    check(report?.schemaVersion === 1, `${label} has an unsupported schemaVersion`);
    check(report?.evidenceKind === "local_beta_device_metrics", `${label} has the wrong evidenceKind`);
    check(typeof report?.evidenceId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(report.evidenceId), `${label} has an invalid evidenceId`);
    check(!ids.has(report?.evidenceId), `${label} duplicates an evidenceId`);
    ids.add(report?.evidenceId);
    const exportedAt = timestamp(report?.exportedAt);
    const startedAt = timestamp(report?.onboardingStartedAt);
    const completedAt = timestamp(report?.onboardingCompletedAt);
    const engagedAt = report?.firstEngagedAt === null ? null : timestamp(report?.firstEngagedAt);
    check(Boolean(exportedAt), `${label} has an invalid exportedAt`);
    check(Boolean(startedAt), `${label} has an invalid onboardingStartedAt`);
    check(Boolean(completedAt), `${label} did not complete onboarding`);
    check(report?.firstEngagedAt === null || Boolean(engagedAt), `${label} has an invalid firstEngagedAt`);
    check(!startedAt || !completedAt || completedAt >= startedAt, `${label} completed onboarding before it started`);
    check(!completedAt || !exportedAt || exportedAt >= completedAt, `${label} was exported before onboarding completed`);
    check(!engagedAt || !completedAt || engagedAt >= completedAt, `${label} engaged before onboarding completed`);
    check(Number.isInteger(report?.feedbackCount) && report.feedbackCount >= 0, `${label} has an invalid feedbackCount`);
    check(Number.isInteger(report?.likeCount) && report.likeCount >= 0 && report.likeCount <= report.feedbackCount, `${label} has an invalid likeCount`);
    check(report?.firstCardSeconds === null || (Number.isInteger(report.firstCardSeconds) && report.firstCardSeconds >= 0), `${label} has an invalid firstCardSeconds`);
    check(typeof report?.widgetAdded === "boolean", `${label} has an invalid widgetAdded flag`);
    check(Number.isInteger(report?.apiLevel) && report.apiLevel >= 26 && report.apiLevel <= 100, `${label} has an invalid apiLevel`);
    check(boundedText(report?.appVersion, 1, 100), `${label} is missing appVersion`);
    check(/^[a-f0-9]{64}$/.test(report?.apkSha256 ?? ""), `${label} is missing a valid APK SHA-256`);
    check(boundedText(report?.manufacturer, 1, 100), `${label} is missing manufacturer`);
    check(boundedText(report?.model, 1, 200), `${label} is missing model`);
    check(boundedText(report?.buildFingerprint, 1, 1000), `${label} is missing buildFingerprint`);
  }
  if (blockers.length > 0) return { status: "NO_GO", metrics: null, blockers };

  const engaged7dUsers = reports.filter((report) => {
    if (!report.firstEngagedAt) return false;
    const completed = Date.parse(report.onboardingCompletedAt);
    const engaged = Date.parse(report.firstEngagedAt);
    return engaged >= completed && engaged <= completed + 7 * 24 * 60 * 60 * 1000;
  }).length;
  return {
    status: "GO",
    metrics: {
      reports: reports.length,
      onboardingCompleted: reports.length,
      widgetAdded: reports.filter((report) => report.widgetAdded).length,
      engaged7dUsers,
      feedbackCount: reports.reduce((sum, report) => sum + report.feedbackCount, 0),
      likeCount: reports.reduce((sum, report) => sum + report.likeCount, 0),
      firstCardSeconds: reports.flatMap((report) => report.firstCardSeconds === null ? [] : [report.firstCardSeconds]),
      evidenceIds: reports.map((report) => report.evidenceId)
    },
    blockers: []
  };
}

function timestamp(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function boundedText(value, minimum, maximum) {
  return typeof value === "string" && value.length >= minimum && value.length <= maximum;
}

function syntheticReport(id) {
  return {
    schemaVersion: 1,
    evidenceKind: "local_beta_device_metrics",
    evidenceId: id,
    exportedAt: "2026-07-21T00:00:00.000Z",
    appVersion: "synthetic",
    apkSha256: "a".repeat(64),
    manufacturer: "Synthetic",
    model: "Synthetic",
    apiLevel: 34,
    buildFingerprint: "synthetic/fingerprint",
    onboardingStartedAt: "2026-07-18T00:00:00.000Z",
    onboardingCompletedAt: "2026-07-18T00:01:00.000Z",
    widgetAdded: true,
    firstCardSeconds: 60,
    firstEngagedAt: "2026-07-19T00:00:00.000Z",
    feedbackCount: 2,
    likeCount: 1
  };
}

if (isMainModule(import.meta.url)) {
  if (process.argv.includes("--self-test")) {
    const first = syntheticReport("00000000-0000-4000-8000-000000000001");
    const second = syntheticReport("00000000-0000-4000-8000-000000000002");
    const result = summarizeDeviceMetrics([first, second]);
    if (result.status !== "GO" || result.metrics?.engaged7dUsers !== 2 || result.metrics?.likeCount !== 2) {
      throw new Error("Beta device-metrics passing fixture failed");
    }
    const duplicate = summarizeDeviceMetrics([first, structuredClone(first)]);
    const impossible = structuredClone(second);
    impossible.likeCount = 3;
    const privatePayload = structuredClone(second);
    privatePayload.photoPath = "/private/photo.jpg";
    if (
      duplicate.status !== "NO_GO" ||
      summarizeDeviceMetrics([impossible]).status !== "NO_GO" ||
      summarizeDeviceMetrics([privatePayload]).status !== "NO_GO"
    ) {
      throw new Error("Beta device-metrics invalid fixtures were accepted");
    }
    process.stdout.write("BETA_DEVICE_METRICS_SELF_TEST=GO synthetic=1 releaseEvidence=0 bypassesRejected=3\n");
  } else {
    const files = process.argv.slice(2);
    if (files.length === 0) throw new Error("Pass one or more exported local Beta report JSON files");
    const reports = await Promise.all(files.map(async (file) => JSON.parse(await readFile(file, "utf8"))));
    const result = summarizeDeviceMetrics(reports);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.status !== "GO") process.exitCode = 1;
  }
}
