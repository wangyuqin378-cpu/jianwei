import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { EvaluationLeaseDefinition } from "../domain/types.js";

const TOKEN = /^[A-Za-z0-9._-]{3,128}$/;
const SHA256 = /^[a-f0-9]{64}$/;

export interface EvaluationLeaseArtifact {
  schemaVersion: 1;
  evidenceKind: "authorized_image_evaluation_lease";
  leaseId: string;
  datasetId: string;
  runId: string;
  labelsSha256: string;
  maxJobs: number;
  createdAt: string;
  expiresAt: string;
  leaseToken: string;
}

export function buildEvaluationLease(input: {
  labelsBytes: Buffer;
  manifestBytes: Buffer;
  now: Date;
  ttlHours: number;
}): { definition: EvaluationLeaseDefinition; artifact: EvaluationLeaseArtifact } {
  if (!Number.isInteger(input.ttlHours) || input.ttlHours < 1 || input.ttlHours > 168) {
    throw new Error("Evaluation lease TTL must be between 1 and 168 hours");
  }
  const labels = parseObject(input.labelsBytes, "authorized image labels");
  const manifest = parseObject(input.manifestBytes, "image evaluation run manifest");
  exactKeys(labels, ["schemaVersion", "evidenceKind", "datasetId", "evidenceOwner", "evidenceRef", "labeledAt", "samples"]);
  exactKeys(manifest, [
    "schemaVersion", "evidenceKind", "datasetId", "runId", "labelsSha256", "resultEvidenceRef",
    "appVersion", "modelVersion", "catalogVersion", "createdAt"
  ]);
  if (labels.schemaVersion !== 1 || labels.evidenceKind !== "authorized_image_labels" ||
      manifest.schemaVersion !== 1 || manifest.evidenceKind !== "authorized_image_pipeline_run") {
    throw new Error("Evaluation artifacts have an unsupported schema");
  }
  const datasetId = requiredToken(labels.datasetId, "datasetId");
  const runId = requiredToken(manifest.runId, "runId");
  const labelsSha256 = createHash("sha256").update(input.labelsBytes).digest("hex");
  if (manifest.datasetId !== datasetId || manifest.labelsSha256 !== labelsSha256) {
    throw new Error("Evaluation run manifest does not bind the exact label bytes");
  }
  if (!Array.isArray(labels.samples) || labels.samples.length < 300 || labels.samples.length > 500) {
    throw new Error("Evaluation lease requires 300-500 authorized samples");
  }
  const sampleIds = new Set<string>();
  const sampleDigests = new Set<string>();
  const samples = labels.samples.map((value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Evaluation sample is invalid");
    const sample = value as Record<string, unknown>;
    exactKeys(sample, [
      "sampleId", "sampleSha256", "authorized", "authorizationRef", "authorizationScope",
      "authorizedAt", "expectedSensitiveTypes", "expectedTopicId"
    ]);
    const sampleId = requiredToken(sample.sampleId, "sampleId");
    if (sampleIds.has(sampleId)) throw new Error(`Duplicate evaluation sample: ${sampleId}`);
    sampleIds.add(sampleId);
    const sampleSha256 = typeof sample.sampleSha256 === "string" ? sample.sampleSha256 : "";
    if (!SHA256.test(sampleSha256) || sampleDigests.has(sampleSha256)) {
      throw new Error(`Evaluation sample SHA-256 is invalid or duplicated: ${sampleId}`);
    }
    sampleDigests.add(sampleSha256);
    if (sample.authorized !== true || sample.authorizationScope !== "local_and_cloud_evaluation" ||
        !SHA256.test(sampleSha256)) {
      throw new Error(`Evaluation sample is not authorized for local-and-cloud processing: ${sampleId}`);
    }
    return {
      sampleId,
      candidateToken: evaluationCandidateToken(runId, sampleId)
    };
  });
  const nowIso = input.now.toISOString();
  const expiresAt = new Date(input.now.getTime() + input.ttlHours * 60 * 60 * 1000).toISOString();
  const leaseId = randomUUID();
  const leaseToken = randomBytes(32).toString("base64url");
  return {
    definition: {
      id: leaseId,
      tokenHash: createHash("sha256").update(leaseToken).digest("hex"),
      datasetId,
      runId,
      labelsSha256,
      maxJobs: samples.length,
      expiresAt,
      samples
    },
    artifact: {
      schemaVersion: 1,
      evidenceKind: "authorized_image_evaluation_lease",
      leaseId,
      datasetId,
      runId,
      labelsSha256,
      maxJobs: samples.length,
      createdAt: nowIso,
      expiresAt,
      leaseToken
    }
  };
}

export function evaluationCandidateToken(runId: string, sampleId: string): string {
  const bytes = createHash("md5")
    .update(`jianwei-authorized-evaluation-v1:${runId}:${sampleId}`, "utf8")
    .digest();
  bytes[6] = (bytes[6]! & 0x0f) | 0x30;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function parseObject(bytes: Buffer, label: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { throw new Error(`${label} is not valid JSON`); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function requiredToken(value: unknown, label: string): string {
  if (typeof value !== "string" || !TOKEN.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

function exactKeys(value: Record<string, unknown>, expected: string[]): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw new Error("Evaluation artifact contains missing or unexpected fields");
}
