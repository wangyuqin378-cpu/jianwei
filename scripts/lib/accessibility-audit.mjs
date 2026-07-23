import { createHash } from "node:crypto";
import { assertAccountableReviewerId, assertExactKeys } from "./fact-review.mjs";
import { summarizeDeviceMetrics } from "../summarize-beta-device-metrics.mjs";

const MANIFEST_KIND = "human_accessibility_audit_manifest";
const MANIFEST_KEYS = [
  "schemaVersion", "evidenceKind", "auditId", "createdAt", "reportSha256", "evidenceSha256",
  "evidenceBytes", "reviewerId", "locale", "humanTalkBackAudit", "spokenOutputReviewed",
  "taskCompleted", "onboardingDisclosureUnderstood", "shareDisclosureUnderstood",
  "privacyControlsUnderstood", "auditedAt", "evidenceRef", "humanConfirmed", "confirmedAt"
];
const AUDIT_KEYS = [
  "humanTalkBackAudit", "spokenOutputReviewed", "taskCompleted", "reviewerId", "locale", "appVersion", "apkSha256",
  "manufacturer", "model", "buildFingerprint", "apiLevel", "onboardingDisclosureUnderstood",
  "shareDisclosureUnderstood", "privacyControlsUnderstood", "auditedAt", "evidenceRef"
];
const PROVENANCE_KEYS = [
  "evidenceKind", "auditId", "sourceDeviceRunId", "reportSha256", "evidenceSha256", "manifestSha256",
  "appVersion", "apkSha256", "compiledAt"
];
const OEMS = new Set(["huawei", "xiaomi", "oppo", "vivo"]);

export function createAccessibilityAuditManifest({ auditId, reportBytes, report, evidenceBytes, now = new Date() }) {
  assertToken(auditId, "Accessibility auditId");
  assertValidDate(now, "Accessibility manifest creation time");
  validateInput({ reportBytes, report, evidenceBytes });
  const exportedAt = strictIso(report.exportedAt);
  if (!exportedAt || exportedAt > now) throw new Error("Accessibility app report must exist before manifest creation");
  return {
    schemaVersion: 1,
    evidenceKind: MANIFEST_KIND,
    auditId,
    createdAt: now.toISOString(),
    reportSha256: sha256(reportBytes),
    evidenceSha256: sha256(evidenceBytes),
    evidenceBytes: evidenceBytes.length,
    reviewerId: "",
    locale: "zh-CN",
    humanTalkBackAudit: false,
    spokenOutputReviewed: false,
    taskCompleted: false,
    onboardingDisclosureUnderstood: false,
    shareDisclosureUnderstood: false,
    privacyControlsUnderstood: false,
    auditedAt: "",
    evidenceRef: "",
    humanConfirmed: false,
    confirmedAt: ""
  };
}

export function compileAccessibilityAudit({ manifest, manifestSha256, reportBytes, report, evidenceBytes, now = new Date() }) {
  assertValidDate(now, "Accessibility compilation time");
  assertExactKeys(manifest, MANIFEST_KEYS, "Accessibility audit manifest");
  if (manifest.schemaVersion !== 1 || manifest.evidenceKind !== MANIFEST_KIND) {
    throw new Error("Accessibility audit manifest schema or evidence kind is invalid");
  }
  assertToken(manifest.auditId, "Accessibility auditId");
  if (!/^[a-f0-9]{64}$/.test(manifestSha256 ?? "")) throw new Error("Exact accessibility manifest SHA-256 is required");
  validateInput({ reportBytes, report, evidenceBytes });
  if (manifest.reportSha256 !== sha256(reportBytes) || manifest.evidenceSha256 !== sha256(evidenceBytes) ||
      manifest.evidenceBytes !== evidenceBytes.length) {
    throw new Error("Accessibility report/evidence binding is stale");
  }
  assertAccountableReviewerId(manifest.reviewerId);
  if (manifest.locale !== "zh-CN" || manifest.humanTalkBackAudit !== true ||
      manifest.spokenOutputReviewed !== true || manifest.taskCompleted !== true ||
      manifest.onboardingDisclosureUnderstood !== true || manifest.shareDisclosureUnderstood !== true ||
      manifest.privacyControlsUnderstood !== true || manifest.humanConfirmed !== true) {
    throw new Error("Accessibility audit requires explicit accountable-human confirmation of every critical check");
  }
  if (!boundedText(manifest.evidenceRef, 1, 500)) throw new Error("Accessibility evidenceRef is required");
  const createdAt = strictIso(manifest.createdAt);
  const auditedAt = strictIso(manifest.auditedAt);
  const confirmedAt = strictIso(manifest.confirmedAt);
  const exportedAt = strictIso(report.exportedAt);
  const onboardingCompletedAt = strictIso(report.onboardingCompletedAt);
  if (!createdAt || !auditedAt || !confirmedAt || !exportedAt || !onboardingCompletedAt ||
      auditedAt < onboardingCompletedAt || auditedAt > exportedAt || exportedAt > createdAt ||
      createdAt > confirmedAt || confirmedAt > now) {
    throw new Error("Accessibility audit/report/confirmation timeline is invalid");
  }
  const audit = {
    humanTalkBackAudit: true,
    spokenOutputReviewed: true,
    taskCompleted: true,
    reviewerId: manifest.reviewerId,
    locale: "zh-CN",
    appVersion: report.appVersion,
    apkSha256: report.apkSha256,
    manufacturer: canonicalManufacturer(report.manufacturer),
    model: report.model,
    buildFingerprint: report.buildFingerprint,
    apiLevel: report.apiLevel,
    onboardingDisclosureUnderstood: true,
    shareDisclosureUnderstood: true,
    privacyControlsUnderstood: true,
    auditedAt: manifest.auditedAt,
    evidenceRef: manifest.evidenceRef
  };
  return {
    schemaVersion: 1,
    evidenceKind: "compiled_accessibility_audit",
    generatedAt: now.toISOString(),
    accessibilityAuditProvenance: {
      evidenceKind: "compiled_accessibility_audit",
      auditId: manifest.auditId,
      sourceDeviceRunId: report.evidenceId,
      reportSha256: manifest.reportSha256,
      evidenceSha256: manifest.evidenceSha256,
      manifestSha256,
      appVersion: report.appVersion,
      apkSha256: report.apkSha256,
      compiledAt: now.toISOString()
    },
    accessibilityAudit: audit
  };
}

export function validateCompiledAccessibilityArtifact(artifact, physicalDeviceArtifact, cutoff = new Date(), now = new Date()) {
  assertExactKeys(artifact, [
    "schemaVersion", "evidenceKind", "generatedAt", "accessibilityAuditProvenance", "accessibilityAudit"
  ], "Compiled accessibility artifact");
  if (artifact.schemaVersion !== 1 || artifact.evidenceKind !== "compiled_accessibility_audit") {
    throw new Error("Compiled accessibility artifact schema or evidence kind is invalid");
  }
  const generatedAt = strictIso(artifact.generatedAt);
  if (!generatedAt || generatedAt > cutoff || generatedAt > now) throw new Error("Compiled accessibility artifact timestamp is invalid");
  const provenance = artifact.accessibilityAuditProvenance;
  assertExactKeys(provenance, PROVENANCE_KEYS, "Compiled accessibility provenance");
  if (provenance.evidenceKind !== "compiled_accessibility_audit" ||
      !/^[A-Za-z0-9._-]{3,128}$/.test(provenance.auditId ?? "") ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(provenance.sourceDeviceRunId ?? "") ||
      !/^[a-f0-9]{64}$/.test(provenance.reportSha256 ?? "") ||
      !/^[a-f0-9]{64}$/.test(provenance.evidenceSha256 ?? "") ||
      !/^[a-f0-9]{64}$/.test(provenance.manifestSha256 ?? "") ||
      !/^[a-f0-9]{64}$/.test(provenance.apkSha256 ?? "") || provenance.compiledAt !== artifact.generatedAt) {
    throw new Error("Compiled accessibility provenance is invalid");
  }
  const audit = artifact.accessibilityAudit;
  assertExactKeys(audit, AUDIT_KEYS, "Compiled accessibility audit");
  assertAccountableReviewerId(audit.reviewerId);
  const auditedAt = strictIso(audit.auditedAt);
  if (audit.humanTalkBackAudit !== true || audit.spokenOutputReviewed !== true || audit.taskCompleted !== true ||
      audit.locale !== "zh-CN" || audit.onboardingDisclosureUnderstood !== true ||
      audit.shareDisclosureUnderstood !== true || audit.privacyControlsUnderstood !== true ||
      !boundedText(audit.appVersion, 1, 100) || !boundedText(audit.manufacturer, 1, 100) ||
      !/^[a-f0-9]{64}$/.test(audit.apkSha256 ?? "") ||
      !boundedText(audit.model, 1, 200) || !boundedText(audit.buildFingerprint, 1, 1000) ||
      emulatorFingerprint(audit.buildFingerprint) || !Number.isInteger(audit.apiLevel) || audit.apiLevel < 26 ||
      !auditedAt || auditedAt > cutoff || auditedAt > now || !boundedText(audit.evidenceRef, 1, 500)) {
    throw new Error("Compiled accessibility audit is incomplete or invalid");
  }
  const sourceRun = physicalDeviceArtifact?.deviceRuns?.find((run) => run.runId === provenance.sourceDeviceRunId);
  if (!sourceRun || sourceRun.manufacturer.toLowerCase() !== audit.manufacturer.toLowerCase() ||
      sourceRun.model !== audit.model || sourceRun.buildFingerprint !== audit.buildFingerprint ||
      sourceRun.appVersion !== audit.appVersion || sourceRun.apkSha256 !== audit.apkSha256 ||
      sourceRun.apiLevel !== audit.apiLevel || auditedAt > strictIso(sourceRun.testedAt)) {
    throw new Error("Accessibility audit is not bound to the same compiled physical-device run");
  }
  if (provenance.appVersion !== audit.appVersion) throw new Error("Accessibility provenance App version does not match its audit");
  if (provenance.apkSha256 !== audit.apkSha256) throw new Error("Accessibility provenance APK SHA-256 does not match its audit");
}

function validateInput({ reportBytes, report, evidenceBytes }) {
  if (!Buffer.isBuffer(reportBytes) || !Buffer.isBuffer(evidenceBytes) ||
      evidenceBytes.length < 1 || evidenceBytes.length > 250 * 1024 * 1024) {
    throw new Error("Accessibility input requires valid report and retained-evidence bytes");
  }
  let parsed;
  try { parsed = JSON.parse(reportBytes.toString("utf8")); } catch { throw new Error("Accessibility report bytes are not valid JSON"); }
  if (JSON.stringify(parsed) !== JSON.stringify(report)) throw new Error("Accessibility report parsed value does not match its SHA-bound bytes");
  const summary = summarizeDeviceMetrics([report]);
  if (summary.status !== "GO") throw new Error(`Accessibility app report is invalid: ${summary.blockers.join("; ")}`);
  canonicalManufacturer(report.manufacturer);
  if (emulatorFingerprint(report.buildFingerprint)) throw new Error("Emulator-like build fingerprint cannot support a human TalkBack audit");
}

function canonicalManufacturer(value) {
  const manufacturer = String(value ?? "").trim().toLowerCase();
  if (!OEMS.has(manufacturer)) throw new Error(`Accessibility audit must use a Beta OEM device: ${value ?? "<missing>"}`);
  return manufacturer === "oppo" ? "OPPO" : manufacturer[0].toUpperCase() + manufacturer.slice(1);
}

function emulatorFingerprint(value) {
  return /(?:generic|sdk_gphone|emulator|goldfish|ranchu|aosp_|google\/sdk|unknown\/unknown)/i.test(String(value ?? ""));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function strictIso(value) {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value ? parsed : null;
}

function boundedText(value, minimum, maximum) {
  return typeof value === "string" && value.trim() === value && value.length >= minimum && value.length <= maximum;
}

function assertToken(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._-]{3,128}$/.test(value)) throw new Error(`${label} is invalid`);
}

function assertValidDate(value, label) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error(`${label} is invalid`);
}
