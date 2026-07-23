import { createHash } from "node:crypto";
import { assertAccountableReviewerId, assertExactKeys } from "./fact-review.mjs";

const LABEL_KEYS = [
  "sampleId", "sampleSha256", "authorized", "authorizationRef", "authorizationScope",
  "authorizedAt", "expectedSensitiveTypes", "expectedTopicId"
];
const SENSITIVE_TYPES = new Set([
  "face", "selfie", "identity_document", "bank_card", "receipt", "document",
  "high_text_density", "screenshot"
]);

export function createImageEvaluationRunManifest({
  labelsBytes,
  labels,
  runId,
  resultEvidenceRef,
  appVersion,
  evaluationApkSha256,
  modelVersion,
  catalogVersion,
  now = new Date()
}) {
  assertValidDate(now, "Image evaluation run manifest time");
  validateLabels(labelsBytes, labels, now);
  assertToken(runId, "Image evaluation runId");
  assertText(resultEvidenceRef, 1, 500, "Image evaluation resultEvidenceRef");
  assertText(appVersion, 1, 100, "Image evaluation appVersion");
  assertDigest(evaluationApkSha256, "Image evaluation APK SHA-256");
  assertText(modelVersion, 1, 200, "Image evaluation modelVersion");
  assertToken(catalogVersion, "Image evaluation catalogVersion");
  return {
    schemaVersion: 1,
    evidenceKind: "authorized_image_pipeline_run",
    datasetId: labels.datasetId,
    runId,
    labelsSha256: sha256(labelsBytes),
    resultEvidenceRef,
    appVersion,
    evaluationApkSha256,
    modelVersion,
    catalogVersion,
    createdAt: now.toISOString()
  };
}

export function validateImageEvaluationRunInputs({ labelsBytes, labels, manifest, now = new Date() }) {
  assertValidDate(now, "Image evaluation run validation time");
  validateLabels(labelsBytes, labels, now);
  assertExactKeys(manifest, [
    "schemaVersion", "evidenceKind", "datasetId", "runId", "labelsSha256",
    "resultEvidenceRef", "appVersion", "evaluationApkSha256", "modelVersion", "catalogVersion", "createdAt"
  ], "Image evaluation run manifest");
  if (manifest.schemaVersion !== 1 || manifest.evidenceKind !== "authorized_image_pipeline_run") {
    throw new Error("Image evaluation run manifest schema or evidence kind is invalid");
  }
  assertToken(manifest.datasetId, "Image evaluation datasetId");
  assertToken(manifest.runId, "Image evaluation runId");
  assertText(manifest.resultEvidenceRef, 1, 500, "Image evaluation resultEvidenceRef");
  assertText(manifest.appVersion, 1, 100, "Image evaluation appVersion");
  assertDigest(manifest.evaluationApkSha256, "Image evaluation APK SHA-256");
  assertText(manifest.modelVersion, 1, 200, "Image evaluation modelVersion");
  assertToken(manifest.catalogVersion, "Image evaluation catalogVersion");
  const createdAt = strictIso(manifest.createdAt);
  if (!createdAt || createdAt > now) throw new Error("Image evaluation run manifest createdAt is invalid");
  if (manifest.datasetId !== labels.datasetId || manifest.labelsSha256 !== sha256(labelsBytes)) {
    throw new Error("Image evaluation run manifest does not bind the exact authorized label artifact");
  }
}

function validateLabels(labelsBytes, labels, now) {
  if (!Buffer.isBuffer(labelsBytes) || !labels || typeof labels !== "object" || Array.isArray(labels)) {
    throw new Error("Authorized image labels require exact JSON bytes and a parsed object");
  }
  let parsed;
  try { parsed = JSON.parse(labelsBytes.toString("utf8")); } catch { throw new Error("Authorized image label bytes are not valid JSON"); }
  if (JSON.stringify(parsed) !== JSON.stringify(labels)) {
    throw new Error("Authorized image labels parsed value does not match its SHA-bound bytes");
  }
  assertExactKeys(labels, [
    "schemaVersion", "evidenceKind", "datasetId", "evidenceOwner", "evidenceRef", "labeledAt", "samples"
  ], "Authorized image labels");
  if (labels.schemaVersion !== 1 || labels.evidenceKind !== "authorized_image_labels") {
    throw new Error("Authorized image label schema or evidence kind is invalid");
  }
  assertToken(labels.datasetId, "Image evaluation datasetId");
  assertAccountableReviewerId(labels.evidenceOwner);
  assertText(labels.evidenceRef, 1, 500, "Image evaluation label evidenceRef");
  const labeledAt = strictIso(labels.labeledAt);
  if (!labeledAt || labeledAt > now) throw new Error("Image evaluation labeledAt is invalid");
  if (!Array.isArray(labels.samples) || labels.samples.length < 300 || labels.samples.length > 500) {
    throw new Error("Authorized image labels must contain 300-500 samples");
  }
  const ids = new Set();
  const digests = new Set();
  for (const sample of labels.samples) {
    assertExactKeys(sample, LABEL_KEYS, `Authorized image label ${sample?.sampleId ?? "<missing>"}`);
    assertToken(sample.sampleId, "Authorized image sampleId");
    if (ids.has(sample.sampleId)) throw new Error(`Duplicate authorized image sampleId: ${sample.sampleId}`);
    ids.add(sample.sampleId);
    if (!/^[a-f0-9]{64}$/.test(sample.sampleSha256 ?? "") || digests.has(sample.sampleSha256)) {
      throw new Error(`Authorized image SHA-256 is invalid or duplicated: ${sample.sampleId}`);
    }
    digests.add(sample.sampleSha256);
    if (sample.authorized !== true || sample.authorizationScope !== "local_and_cloud_evaluation") {
      throw new Error(`Sample does not authorize the complete local-and-cloud evaluation: ${sample.sampleId}`);
    }
    assertText(sample.authorizationRef, 1, 500, `Authorization reference for ${sample.sampleId}`);
    const authorizedAt = strictIso(sample.authorizedAt);
    if (!authorizedAt || authorizedAt > labeledAt) throw new Error(`Authorization timestamp is invalid: ${sample.sampleId}`);
    if (!Array.isArray(sample.expectedSensitiveTypes) ||
        new Set(sample.expectedSensitiveTypes).size !== sample.expectedSensitiveTypes.length ||
        !sample.expectedSensitiveTypes.every((type) => SENSITIVE_TYPES.has(type))) {
      throw new Error(`Sensitive labels are invalid: ${sample.sampleId}`);
    }
    if (sample.expectedSensitiveTypes.length > 0 ? sample.expectedTopicId !== null : typeof sample.expectedTopicId !== "string") {
      throw new Error(`Expected topic/sensitive classification is invalid: ${sample.sampleId}`);
    }
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function strictIso(value) {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value ? parsed : null;
}

function assertText(value, minimum, maximum, label) {
  if (typeof value !== "string" || value.trim() !== value || value.length < minimum || value.length > maximum) {
    throw new Error(`${label} is invalid`);
  }
}

function assertToken(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._-]{3,128}$/.test(value)) throw new Error(`${label} is invalid`);
}

function assertDigest(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`${label} is invalid`);
}

function assertValidDate(value, label) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error(`${label} is invalid`);
}
