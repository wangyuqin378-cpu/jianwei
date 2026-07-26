import { describe, expect, it } from "vitest";
import { verifyCloudBeta, type CloudAuditApi, type CloudAuditObjects } from "./cloud-beta-verification.js";

function jpeg(fill: number) {
  const bytes = Buffer.alloc(64, fill);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  return bytes;
}

const CONTAINER_IMAGE_DIGEST = `sha256:${"f".repeat(64)}`;

function deploymentReceipt() {
  return {
    verified: true as const,
    receiptSha256: "1".repeat(64),
    policySha256: "2".repeat(64),
    issuerId: "fc-deployment-pipeline",
    keyId: "fc-attestor-2026",
    role: "beta_deployment_attestor" as const,
    endpointOrigin: "https://beta.jianwei.example",
    deploymentRevision: "fc-revision-001",
    containerImageDigest: CONTAINER_IMAGE_DIGEST,
    backendReleaseSha256: "d".repeat(64),
    deployedAt: "2026-07-19T00:00:00.000Z",
    issuedAt: "2026-07-19T00:01:00.000Z"
  };
}

function fixture({
  leaveObject = false,
  crossCandidateResponse = false,
  catalogVersion = "catalog-17",
  backendReleaseSha256 = "d".repeat(64),
  containerImageDigest = CONTAINER_IMAGE_DIGEST
} = {}) {
  const objects = new Set<string>();
  const jobs = new Map<string, { candidateToken: string; createdAt: string; status: string; errorCode: string | null; key: string }>();
  let sequence = 0;
  let deleted = false;
  const api: CloudAuditApi = {
    ready: async () => ({ ok: true, mode: "qwen", catalogVersion, backendReleaseSha256, containerImageDigest }),
    register: async () => ({ token: "t".repeat(48) }),
    createJob: async (_token, candidateToken) => {
      sequence += 1;
      const jobId = `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
      const key = `analysis/2026-07-19/${jobId}.image`;
      jobs.set(jobId, { candidateToken, createdAt: "2026-07-19T00:00:00.000Z", status: "awaiting_upload", errorCode: null, key });
      return {
        jobId,
        candidateToken: crossCandidateResponse ? "00000000-0000-4000-8000-999999999999" : candidateToken,
        uploadUrl: `https://beta.jianwei.example/v1/analysis-jobs/${jobId}/image`
      };
    },
    upload: async (_token, uploadUrl) => {
      const jobId = uploadUrl.split("/").at(-2)!;
      const job = jobs.get(jobId)!;
      job.status = "uploaded";
      objects.add(job.key);
    },
    getJob: async (_token, jobId) => {
      const job = jobs.get(jobId)!;
      return { status: job.status, errorCode: job.errorCode, createdAt: job.createdAt };
    },
    complete: async (_token, jobId) => {
      const job = jobs.get(jobId)!;
      if (sequence === 1) job.status = "needs_content";
      else {
        job.status = "rejected";
        job.errorCode = "server_sensitive_face";
      }
      if (!leaveObject) objects.delete(job.key);
      return { jobId, candidateToken: job.candidateToken, status: job.status };
    },
    deleteDevice: async () => { deleted = true; },
    cardsStatus: async () => deleted ? 401 : 200
  };
  const inspector: CloudAuditObjects = {
    verifyPolicy: async () => ({ ttlHours: 24, versioningDisabled: true }),
    findJobObject: async (jobId) => [...objects].find((key) => key.includes(jobId)) ?? null,
    exists: async (key) => objects.has(key)
  };
  return { api, inspector };
}

describe("verifyCloudBeta", () => {
  it("binds a real-cloud run without retaining secrets or object keys", async () => {
    const { api, inspector } = fixture();
    const result = await verifyCloudBeta({
      api,
      objects: inspector,
      baseUrl: "https://beta.jianwei.example/",
      runId: "cloud-beta-17",
      evidenceRef: "controlled://cloud/beta-17",
      appVersion: "0.1.0-beta17",
      releaseApkSha256: "e".repeat(64),
      backendReleaseSha256: "d".repeat(64),
      deploymentReceipt: deploymentReceipt(),
      modelVersion: "qwen-fixed-17",
      catalogVersion: "catalog-17",
      safeFixture: jpeg(1),
      sensitiveFixture: jpeg(2),
      expectedSensitiveType: "face",
      deleteWaitMs: 100,
      now: new Date("2026-07-19T01:00:00.000Z")
    });
    expect(result.cloud.realDeployment).toBe(true);
    expect(result.cloudProvenance.runSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result)).not.toMatch(/token|objectKey|bucket|accessKey|installationId/i);
  });

  it("fails closed on catalog drift and retained terminal objects", async () => {
    const crossed = fixture({ crossCandidateResponse: true });
    await expect(verifyCloudBeta({
      api: crossed.api,
      objects: crossed.inspector,
      baseUrl: "https://beta.jianwei.example/",
      runId: "cloud-beta-17",
      evidenceRef: "controlled://cloud/beta-17",
      appVersion: "0.1.0-beta17",
      releaseApkSha256: "e".repeat(64),
      backendReleaseSha256: "d".repeat(64),
      deploymentReceipt: deploymentReceipt(),
      modelVersion: "qwen-fixed-17",
      catalogVersion: "catalog-17",
      safeFixture: jpeg(1),
      sensitiveFixture: jpeg(2),
      expectedSensitiveType: "face"
    })).rejects.toThrow(/crossed the submitted candidate boundary/);

    const drift = fixture({ catalogVersion: "old-catalog" });
    await expect(verifyCloudBeta({
      api: drift.api,
      objects: drift.inspector,
      baseUrl: "https://beta.jianwei.example/",
      runId: "cloud-beta-17",
      evidenceRef: "controlled://cloud/beta-17",
      appVersion: "0.1.0-beta17",
      releaseApkSha256: "e".repeat(64),
      backendReleaseSha256: "d".repeat(64),
      deploymentReceipt: deploymentReceipt(),
      modelVersion: "qwen-fixed-17",
      catalogVersion: "catalog-17",
      safeFixture: jpeg(1),
      sensitiveFixture: jpeg(2),
      expectedSensitiveType: "face"
    })).rejects.toThrow(/catalog version is stale/);

    const staleBackend = fixture({ backendReleaseSha256: "c".repeat(64) });
    await expect(verifyCloudBeta({
      api: staleBackend.api,
      objects: staleBackend.inspector,
      baseUrl: "https://beta.jianwei.example/",
      runId: "cloud-beta-17",
      evidenceRef: "controlled://cloud/beta-17",
      appVersion: "0.1.0-beta17",
      releaseApkSha256: "e".repeat(64),
      backendReleaseSha256: "d".repeat(64),
      deploymentReceipt: deploymentReceipt(),
      modelVersion: "qwen-fixed-17",
      catalogVersion: "catalog-17",
      safeFixture: jpeg(1),
      sensitiveFixture: jpeg(2),
      expectedSensitiveType: "face"
    })).rejects.toThrow(/backend Release SHA-256 is stale/);

    const staleContainer = fixture({ containerImageDigest: `sha256:${"0".repeat(64)}` });
    await expect(verifyCloudBeta({
      api: staleContainer.api,
      objects: staleContainer.inspector,
      baseUrl: "https://beta.jianwei.example/",
      runId: "cloud-beta-17",
      evidenceRef: "controlled://cloud/beta-17",
      appVersion: "0.1.0-beta17",
      releaseApkSha256: "e".repeat(64),
      backendReleaseSha256: "d".repeat(64),
      deploymentReceipt: deploymentReceipt(),
      modelVersion: "qwen-fixed-17",
      catalogVersion: "catalog-17",
      safeFixture: jpeg(1),
      sensitiveFixture: jpeg(2),
      expectedSensitiveType: "face"
    })).rejects.toThrow(/OCI image digest is stale/);

    const retained = fixture({ leaveObject: true });
    await expect(verifyCloudBeta({
      api: retained.api,
      objects: retained.inspector,
      baseUrl: "https://beta.jianwei.example/",
      runId: "cloud-beta-17",
      evidenceRef: "controlled://cloud/beta-17",
      appVersion: "0.1.0-beta17",
      releaseApkSha256: "e".repeat(64),
      backendReleaseSha256: "d".repeat(64),
      deploymentReceipt: deploymentReceipt(),
      modelVersion: "qwen-fixed-17",
      catalogVersion: "catalog-17",
      safeFixture: jpeg(1),
      sensitiveFixture: jpeg(2),
      expectedSensitiveType: "face",
      deleteWaitMs: 100
    })).rejects.toThrow(/remained in OSS/);
  }, 15_000);
});
