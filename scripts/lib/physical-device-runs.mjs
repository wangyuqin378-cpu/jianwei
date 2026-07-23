import { createHash } from "node:crypto";
import { assertAccountableReviewerId, assertExactKeys } from "./fact-review.mjs";
import { summarizeDeviceMetrics } from "../summarize-beta-device-metrics.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;
const MANIFEST_KIND = "physical_device_run_manifest";
const MANIFEST_KEYS = [
  "schemaVersion", "evidenceKind", "runSetId", "inputSetSha256", "createdAt",
  "evidenceOwner", "approvedAt", "runs"
];
const RUN_KEYS = [
  "runId", "reportSha256", "evidenceSha256", "evidenceBytes", "evidenceRef", "permissionMode",
  "scanPassed", "backgroundPassed", "widgetObservedFrom", "widgetObservedThrough", "deletePassed",
  "testedAt", "humanConfirmed"
];
const FINAL_RUN_KEYS = [
  "runId", "manufacturer", "model", "buildFingerprint", "appVersion", "apkSha256", "physicalDevice", "testedAt",
  "evidenceRef", "apiLevel", "permissionMode", "scanPassed", "backgroundPassed", "widgetOfflineDays", "deletePassed"
];
const OEMS = new Set(["huawei", "xiaomi", "oppo", "vivo"]);

export function createPhysicalDeviceRunManifest({ runSetId, inputs, now = new Date() }) {
  assertToken(runSetId, "Physical-device runSetId");
  assertValidDate(now, "Physical-device manifest creation time");
  const normalized = validateInputs(inputs);
  validateMatrixIdentity(normalized);
  return {
    schemaVersion: 1,
    evidenceKind: MANIFEST_KIND,
    runSetId,
    inputSetSha256: inputSetDigest(normalized),
    createdAt: now.toISOString(),
    evidenceOwner: "",
    approvedAt: "",
    runs: normalized.map(({ report, reportBytes, evidenceBytes }) => ({
      runId: report.evidenceId,
      reportSha256: sha256(reportBytes),
      evidenceSha256: sha256(evidenceBytes),
      evidenceBytes: evidenceBytes.length,
      evidenceRef: "",
      permissionMode: "",
      scanPassed: false,
      backgroundPassed: false,
      widgetObservedFrom: "",
      widgetObservedThrough: "",
      deletePassed: false,
      testedAt: "",
      humanConfirmed: false
    }))
  };
}

export function compilePhysicalDeviceRuns({ manifest, manifestSha256, inputs, now = new Date() }) {
  assertValidDate(now, "Physical-device compilation time");
  assertExactKeys(manifest, MANIFEST_KEYS, "Physical-device run manifest");
  if (manifest.schemaVersion !== 1 || manifest.evidenceKind !== MANIFEST_KIND) {
    throw new Error("Physical-device run manifest schema or evidence kind is invalid");
  }
  assertToken(manifest.runSetId, "Physical-device runSetId");
  if (!/^[a-f0-9]{64}$/.test(manifestSha256 ?? "")) throw new Error("Exact physical-device manifest SHA-256 is required");
  assertAccountableReviewerId(manifest.evidenceOwner);
  const createdAt = strictIso(manifest.createdAt);
  const approvedAt = strictIso(manifest.approvedAt);
  if (!createdAt || !approvedAt || createdAt > approvedAt || approvedAt > now) {
    throw new Error("Physical-device manifest creation/approval timestamps are invalid");
  }

  const normalized = validateInputs(inputs);
  validateMatrixIdentity(normalized);
  if (manifest.inputSetSha256 !== inputSetDigest(normalized)) {
    throw new Error("Physical-device input-set SHA-256 changed after manifest creation");
  }
  if (!Array.isArray(manifest.runs) || manifest.runs.length !== normalized.length) {
    throw new Error("Physical-device manifest must contain exactly one decision per input pair");
  }
  const inputById = new Map(normalized.map((input) => [input.report.evidenceId, input]));
  const seen = new Set();
  const deviceRuns = manifest.runs.map((run) => {
    assertExactKeys(run, RUN_KEYS, "Physical-device run decision");
    if (typeof run.runId !== "string" || seen.has(run.runId)) throw new Error("Physical-device run IDs must be present and unique");
    seen.add(run.runId);
    const input = inputById.get(run.runId);
    if (!input) throw new Error(`Physical-device manifest references an unknown report: ${run.runId}`);
    if (run.reportSha256 !== sha256(input.reportBytes) || run.evidenceSha256 !== sha256(input.evidenceBytes) ||
        run.evidenceBytes !== input.evidenceBytes.length) {
      throw new Error(`Physical-device report/evidence binding is stale: ${run.runId}`);
    }
    if (run.humanConfirmed !== true || run.scanPassed !== true || run.backgroundPassed !== true || run.deletePassed !== true) {
      throw new Error(`Physical-device run lacks explicit accountable-human confirmation: ${run.runId}`);
    }
    if (!["FULL", "PARTIAL", "DENIED"].includes(run.permissionMode)) {
      throw new Error(`Physical-device permission mode is invalid: ${run.runId}`);
    }
    if (!boundedText(run.evidenceRef, 1, 500)) throw new Error(`Physical-device evidenceRef is required: ${run.runId}`);
    const widgetFrom = strictIso(run.widgetObservedFrom);
    const widgetThrough = strictIso(run.widgetObservedThrough);
    const testedAt = strictIso(run.testedAt);
    const reportExportedAt = strictIso(input.report.exportedAt);
    const onboardingCompletedAt = strictIso(input.report.onboardingCompletedAt);
    if (!widgetFrom || !widgetThrough || !testedAt || !reportExportedAt || !onboardingCompletedAt ||
        widgetFrom < onboardingCompletedAt || widgetThrough.getTime() - widgetFrom.getTime() < 7 * DAY_MS ||
        testedAt < widgetThrough || reportExportedAt < testedAt || approvedAt < reportExportedAt) {
      throw new Error(`Physical-device observation timeline is incomplete or invalid: ${run.runId}`);
    }
    return {
      runId: run.runId,
      manufacturer: canonicalManufacturer(input.report.manufacturer),
      model: input.report.model,
      buildFingerprint: input.report.buildFingerprint,
      appVersion: input.report.appVersion,
      apkSha256: input.report.apkSha256,
      physicalDevice: true,
      testedAt: run.testedAt,
      evidenceRef: run.evidenceRef,
      apiLevel: input.report.apiLevel,
      permissionMode: run.permissionMode,
      scanPassed: true,
      backgroundPassed: true,
      widgetOfflineDays: Math.floor((widgetThrough.getTime() - widgetFrom.getTime()) / DAY_MS),
      deletePassed: true
    };
  });
  if ([...inputById.keys()].some((id) => !seen.has(id))) throw new Error("Physical-device manifest omitted an input pair");
  validateCompiledDeviceRuns(deviceRuns, approvedAt, now);
  const appVersions = new Set(deviceRuns.map((run) => run.appVersion));
  if (appVersions.size !== 1) throw new Error("Physical-device run set must use one App version");
  const apkDigests = new Set(deviceRuns.map((run) => run.apkSha256));
  if (apkDigests.size !== 1) throw new Error("Physical-device run set must use one APK SHA-256");
  return {
    schemaVersion: 1,
    evidenceKind: "compiled_physical_device_runs",
    generatedAt: now.toISOString(),
    physicalDeviceRunProvenance: {
      evidenceKind: "compiled_physical_device_runs",
      runSetId: manifest.runSetId,
      inputSetSha256: manifest.inputSetSha256,
      manifestSha256,
      runCount: deviceRuns.length,
      appVersion: deviceRuns[0].appVersion,
      apkSha256: deviceRuns[0].apkSha256,
      compiledAt: now.toISOString()
    },
    deviceRuns
  };
}

export function validateCompiledDeviceRuns(deviceRuns, cutoff = new Date(), now = new Date()) {
  if (!Array.isArray(deviceRuns) || deviceRuns.length < 3 || deviceRuns.length > 10) {
    throw new Error("Compiled physical-device run set must contain 3-10 devices");
  }
  const ids = new Set();
  for (const run of deviceRuns) {
    assertExactKeys(run, FINAL_RUN_KEYS, "Compiled physical-device run");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(run.runId ?? "") || ids.has(run.runId)) {
      throw new Error("Compiled physical-device run IDs must be unique app-export evidence IDs");
    }
    ids.add(run.runId);
    const testedAt = strictIso(run.testedAt);
    if (!OEMS.has(String(run.manufacturer).toLowerCase()) || run.physicalDevice !== true ||
        !boundedText(run.model, 1, 200) || !boundedText(run.buildFingerprint, 1, 1000) ||
        emulatorFingerprint(run.buildFingerprint) || !boundedText(run.appVersion, 1, 100) ||
        !/^[a-f0-9]{64}$/.test(run.apkSha256 ?? "") ||
        !testedAt || testedAt > cutoff || testedAt > now || !boundedText(run.evidenceRef, 1, 500) ||
        !Number.isInteger(run.apiLevel) || run.apiLevel < 26 ||
        !["FULL", "PARTIAL", "DENIED"].includes(run.permissionMode) ||
        run.scanPassed !== true || run.backgroundPassed !== true || run.deletePassed !== true ||
        !Number.isInteger(run.widgetOfflineDays) || run.widgetOfflineDays < 7) {
      throw new Error(`Compiled physical-device run is incomplete or invalid: ${run.runId ?? "<missing>"}`);
    }
  }
  const manufacturers = new Set(deviceRuns.map((run) => run.manufacturer.toLowerCase()));
  if (!manufacturers.has("huawei") || !manufacturers.has("xiaomi") || (!manufacturers.has("oppo") && !manufacturers.has("vivo"))) {
    throw new Error("Physical-device run set must cover Huawei, Xiaomi, and OPPO or vivo");
  }
  const api34Modes = new Set(deviceRuns.filter((run) => run.apiLevel >= 34).map((run) => run.permissionMode));
  if (!["FULL", "PARTIAL", "DENIED"].every((mode) => api34Modes.has(mode))) {
    throw new Error("Android 14+ physical-device runs must collectively cover FULL, PARTIAL, and DENIED access");
  }
}

export function validateCompiledPhysicalDeviceArtifact(artifact, cutoff = new Date(), now = new Date()) {
  assertExactKeys(artifact, [
    "schemaVersion", "evidenceKind", "generatedAt", "physicalDeviceRunProvenance", "deviceRuns"
  ], "Compiled physical-device artifact");
  if (artifact.schemaVersion !== 1 || artifact.evidenceKind !== "compiled_physical_device_runs") {
    throw new Error("Compiled physical-device artifact schema or evidence kind is invalid");
  }
  const generatedAt = strictIso(artifact.generatedAt);
  if (!generatedAt || generatedAt > cutoff || generatedAt > now) throw new Error("Compiled physical-device artifact timestamp is invalid");
  const provenance = artifact.physicalDeviceRunProvenance;
  assertExactKeys(provenance, [
    "evidenceKind", "runSetId", "inputSetSha256", "manifestSha256", "runCount", "appVersion", "apkSha256", "compiledAt"
  ], "Compiled physical-device provenance");
  if (provenance.evidenceKind !== "compiled_physical_device_runs" ||
      !/^[A-Za-z0-9._-]{3,128}$/.test(provenance.runSetId ?? "") ||
      !/^[a-f0-9]{64}$/.test(provenance.inputSetSha256 ?? "") ||
      !/^[a-f0-9]{64}$/.test(provenance.manifestSha256 ?? "") ||
      !/^[a-f0-9]{64}$/.test(provenance.apkSha256 ?? "") ||
      provenance.runCount !== artifact.deviceRuns.length || provenance.compiledAt !== artifact.generatedAt) {
    throw new Error("Compiled physical-device provenance is invalid or inconsistent");
  }
  validateCompiledDeviceRuns(artifact.deviceRuns, cutoff, now);
  const versions = new Set(artifact.deviceRuns.map((run) => run.appVersion));
  if (versions.size !== 1 || !versions.has(provenance.appVersion)) {
    throw new Error("Compiled physical-device provenance App version does not match its runs");
  }
  const apkDigests = new Set(artifact.deviceRuns.map((run) => run.apkSha256));
  if (apkDigests.size !== 1 || !apkDigests.has(provenance.apkSha256)) {
    throw new Error("Compiled physical-device provenance APK SHA-256 does not match its runs");
  }
}

export function inputSetDigest(inputs) {
  return sha256(Buffer.from(JSON.stringify(inputs.map((input) => [
    input.report.evidenceId,
    sha256(input.reportBytes),
    sha256(input.evidenceBytes),
    input.evidenceBytes.length
  ])), "utf8"));
}

function validateInputs(inputs) {
  if (!Array.isArray(inputs) || inputs.length < 3 || inputs.length > 10) {
    throw new Error("Physical-device input set must contain 3-10 report/evidence pairs");
  }
  const normalized = [...inputs].map((input) => {
    if (!Buffer.isBuffer(input?.reportBytes) || !Buffer.isBuffer(input?.evidenceBytes) ||
        input.evidenceBytes.length < 1 || input.evidenceBytes.length > 250 * 1024 * 1024) {
      throw new Error("Physical-device input pair is missing valid report/evidence bytes");
    }
    let parsed;
    try { parsed = JSON.parse(input.reportBytes.toString("utf8")); } catch { throw new Error("Physical-device report bytes are not valid JSON"); }
    if (JSON.stringify(parsed) !== JSON.stringify(input.report)) {
      throw new Error("Physical-device report parsed value does not match its SHA-bound bytes");
    }
    return { report: input.report, reportBytes: input.reportBytes, evidenceBytes: input.evidenceBytes };
  }).sort((left, right) => left.report.evidenceId.localeCompare(right.report.evidenceId));
  const summary = summarizeDeviceMetrics(normalized.map((input) => input.report));
  if (summary.status !== "GO") throw new Error(`Physical-device reports are invalid: ${summary.blockers.join("; ")}`);
  const evidenceHashes = normalized.map((input) => sha256(input.evidenceBytes));
  if (new Set(evidenceHashes).size !== evidenceHashes.length) throw new Error("Physical-device runs cannot reuse the same retained evidence bundle");
  return normalized;
}

function validateMatrixIdentity(inputs) {
  const manufacturers = new Set();
  const versions = new Set();
  const apkDigests = new Set();
  for (const { report } of inputs) {
    const manufacturer = canonicalManufacturer(report.manufacturer);
    if (emulatorFingerprint(report.buildFingerprint)) throw new Error(`Emulator-like build fingerprint is not physical OEM evidence: ${report.evidenceId}`);
    manufacturers.add(manufacturer.toLowerCase());
    versions.add(report.appVersion);
    apkDigests.add(report.apkSha256);
  }
  if (!manufacturers.has("huawei") || !manufacturers.has("xiaomi") || (!manufacturers.has("oppo") && !manufacturers.has("vivo"))) {
    throw new Error("Physical-device reports must cover Huawei, Xiaomi, and OPPO or vivo");
  }
  if (versions.size !== 1) throw new Error("Physical-device reports must use one App version");
  if (apkDigests.size !== 1) throw new Error("Physical-device reports must use one APK SHA-256");
}

function canonicalManufacturer(value) {
  const manufacturer = String(value ?? "").trim().toLowerCase();
  if (!OEMS.has(manufacturer)) throw new Error(`Unsupported physical-device manufacturer: ${value ?? "<missing>"}`);
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
