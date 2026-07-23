import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildEvaluationLease, evaluationCandidateToken } from "./evaluation-lease.js";

describe("authorized evaluation lease", () => {
  it("binds all authorized samples without exposing the bearer in the server definition", () => {
    const labels = labelsArtifact();
    const labelsBytes = Buffer.from(JSON.stringify(labels));
    const manifestBytes = Buffer.from(JSON.stringify(runManifest(labels.datasetId, sha256(labelsBytes))));
    const { definition, artifact } = buildEvaluationLease({
      labelsBytes,
      manifestBytes,
      now: new Date("2026-07-19T00:00:00.000Z"),
      ttlHours: 72
    });
    expect(artifact.maxJobs).toBe(300);
    expect(artifact.leaseToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(definition)).not.toContain(artifact.leaseToken);
    expect(definition.tokenHash).toBe(sha256(Buffer.from(artifact.leaseToken)));
    expect(definition.samples[0]).toEqual({
      sampleId: "sample-000",
      candidateToken: "7ff7a59e-2791-38b4-bdbe-3e8274eed084"
    });
  });

  it("rejects a tampered binding, missing cloud authorization, duplicate sample, or undersized set", () => {
    const labels = labelsArtifact();
    const labelsBytes = Buffer.from(JSON.stringify(labels));
    const base = {
      labelsBytes,
      manifestBytes: Buffer.from(JSON.stringify(runManifest(labels.datasetId, sha256(labelsBytes)))),
      now: new Date("2026-07-19T00:00:00.000Z"),
      ttlHours: 72
    };
    expect(() => buildEvaluationLease({ ...base, manifestBytes: Buffer.from(JSON.stringify(runManifest(labels.datasetId, "0".repeat(64)))) }))
      .toThrow(/exact label bytes/);
    const noCloud = structuredClone(labels);
    noCloud.samples[0]!.authorizationScope = "local_only";
    expect(() => buildWithLabels(noCloud)).toThrow(/not authorized/);
    const duplicate = structuredClone(labels);
    duplicate.samples[1]!.sampleId = duplicate.samples[0]!.sampleId;
    expect(() => buildWithLabels(duplicate)).toThrow(/Duplicate/);
    expect(() => buildWithLabels({ ...labels, samples: labels.samples.slice(0, 299) })).toThrow(/300-500/);
  });
});

function buildWithLabels(labels: ReturnType<typeof labelsArtifact>) {
  const labelsBytes = Buffer.from(JSON.stringify(labels));
  return buildEvaluationLease({
    labelsBytes,
    manifestBytes: Buffer.from(JSON.stringify(runManifest(labels.datasetId, sha256(labelsBytes)))),
    now: new Date("2026-07-19T00:00:00.000Z"),
    ttlHours: 72
  });
}

function labelsArtifact() {
  return {
    schemaVersion: 1,
    evidenceKind: "authorized_image_labels",
    datasetId: "dataset-001",
    evidenceOwner: "reviewer@example.com",
    evidenceRef: "authorized-consent-record",
    labeledAt: "2026-07-18T00:00:00.000Z",
    samples: Array.from({ length: 300 }, (_, index) => ({
      sampleId: `sample-${String(index).padStart(3, "0")}`,
      sampleSha256: createHash("sha256").update(`sample-${index}`).digest("hex"),
      authorized: true,
      authorizationRef: `consent-${index}`,
      authorizationScope: "local_and_cloud_evaluation",
      authorizedAt: "2026-07-17T00:00:00.000Z",
      expectedSensitiveTypes: [] as string[],
      expectedTopicId: "broom"
    }))
  };
}

function runManifest(datasetId: string, labelsSha256: string) {
  return {
    schemaVersion: 1,
    evidenceKind: "authorized_image_pipeline_run",
    datasetId,
    runId: "run-001",
    labelsSha256,
    resultEvidenceRef: "result-record",
    appVersion: "0.1.0",
    modelVersion: "qwen-fixed",
    catalogVersion: "catalog-001",
    createdAt: "2026-07-18T00:00:00.000Z"
  };
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
