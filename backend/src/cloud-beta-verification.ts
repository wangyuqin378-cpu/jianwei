import { createHash, randomUUID } from "node:crypto";
import type { VerifiedDeploymentReceipt } from "./deployment-receipt.js";

const SENSITIVE_TYPES = new Set([
  "face", "selfie", "identity_document", "bank_card", "receipt", "document", "high_text_density", "screenshot"
]);

export interface CloudAuditApi {
  ready(): Promise<{
    ok: boolean;
    mode: string;
    catalogVersion: string;
    backendReleaseSha256: string;
    containerImageDigest: string;
  }>;
  register(): Promise<{ token: string }>;
  createJob(token: string, candidateToken: string): Promise<{
    jobId: string;
    candidateToken: string;
    uploadUrl: string;
    uploadSessionId: string;
  }>;
  upload(token: string, uploadUrl: string, bytes: Buffer): Promise<{
    jobId: string;
    candidateToken: string;
    uploadSessionId: string;
    status: string;
  }>;
  getJob(token: string, jobId: string): Promise<{ status: string; errorCode: string | null; createdAt: string }>;
  complete(token: string, jobId: string): Promise<{ jobId: string; candidateToken: string; status: string }>;
  deleteDevice(token: string): Promise<void>;
  cardsStatus(token: string): Promise<number>;
}

export interface CloudAuditObjects {
  verifyPolicy(): Promise<{ ttlHours: number; versioningDisabled: boolean }>;
  findJobObject(jobId: string, createdAt: string): Promise<string | null>;
  exists(objectKey: string): Promise<boolean>;
}

export interface CloudVerificationInput {
  api: CloudAuditApi;
  objects: CloudAuditObjects;
  baseUrl: string;
  runId: string;
  evidenceRef: string;
  appVersion: string;
  releaseApkSha256: string;
  backendReleaseSha256: string;
  deploymentReceipt: VerifiedDeploymentReceipt;
  modelVersion: string;
  catalogVersion: string;
  safeFixture: Buffer;
  sensitiveFixture: Buffer;
  expectedSensitiveType: string;
  deleteWaitMs?: number;
  now?: Date;
}

export async function verifyCloudBeta(input: CloudVerificationInput) {
  validateInput(input);
  const now = input.now ?? new Date();
  const origin = normalizedProductionOrigin(input.baseUrl);
  const deployment = input.deploymentReceipt;
  assert(deployment.verified === true && deployment.role === "beta_deployment_attestor",
    "Cloud deployment requires a trusted deployment-attestor receipt");
  assert(deployment.endpointOrigin === origin, "Deployment receipt endpoint does not match the tested cloud origin");
  assert(deployment.backendReleaseSha256 === input.backendReleaseSha256,
    "Deployment receipt backend Release SHA-256 is stale");
  const ready = await input.api.ready();
  assert(ready.ok === true && ready.mode === "qwen", "Cloud readiness must report the Qwen provider");
  assert(ready.catalogVersion === input.catalogVersion, "Cloud readiness catalog version is stale");
  assert(ready.backendReleaseSha256 === input.backendReleaseSha256, "Cloud readiness backend Release SHA-256 is stale");
  assert(ready.containerImageDigest === deployment.containerImageDigest, "Cloud readiness OCI image digest is stale");
  const policy = await input.objects.verifyPolicy();
  assert(policy.versioningDisabled === true && policy.ttlHours > 0 && policy.ttlHours <= 24,
    "OSS retention policy is not safe for Beta evidence");

  let token: string | null = null;
  try {
    token = (await input.api.register()).token;
    assert(typeof token === "string" && token.length >= 32, "Cloud registration returned an invalid bearer");
    const safe = await runFixture(input, token, input.safeFixture, false);
    const sensitive = await runFixture(input, token, input.sensitiveFixture, true);
    await input.api.deleteDevice(token);
    const afterDeleteStatus = await input.api.cardsStatus(token);
    assert(afterDeleteStatus === 401, "Deleted cloud device bearer remained authorized");
    token = null;

    const verifiedAt = now.toISOString();
    const checks = {
      httpsReady: true,
      qwenProvider: true,
      catalogPinned: true,
      safeObjectObserved: safe.objectObserved,
      safeTerminalStatus: safe.status,
      safeImmediateDelete: safe.deleted,
      sensitiveObjectObserved: sensitive.objectObserved,
      serverSensitiveRejected: sensitive.status === "rejected",
      sensitiveErrorCode: sensitive.errorCode,
      sensitiveImmediateDelete: sensitive.deleted,
      lifecyclePolicyVerified: true,
      versioningDisabled: true,
      deviceDataDeleteVerified: true,
      bearerInvalidated: true
    };
    const digestPayload = [
      "jianwei-verified-cloud-run-v5",
      input.runId,
      origin,
      input.appVersion,
      input.releaseApkSha256,
      input.backendReleaseSha256,
      deployment.containerImageDigest,
      deployment.receiptSha256,
      deployment.policySha256,
      deployment.issuerId,
      deployment.keyId,
      deployment.deploymentRevision,
      input.modelVersion,
      input.catalogVersion,
      sha256(input.safeFixture),
      sha256(input.sensitiveFixture),
      input.expectedSensitiveType,
      policy.ttlHours,
      verifiedAt,
      checks
    ];
    const runSha256 = sha256(Buffer.from(JSON.stringify(digestPayload), "utf8"));
    return {
      schemaVersion: 1,
      evidenceKind: "verified_cloud_run",
      generatedAt: verifiedAt,
      cloudProvenance: {
        evidenceKind: "verified_cloud_run",
        runId: input.runId,
        runSha256,
        evidenceRef: input.evidenceRef,
        baseUrlOrigin: origin,
        safeFixtureSha256: sha256(input.safeFixture),
        sensitiveFixtureSha256: sha256(input.sensitiveFixture),
        expectedSensitiveType: input.expectedSensitiveType,
        appVersion: input.appVersion,
        releaseApkSha256: input.releaseApkSha256,
        backendReleaseSha256: input.backendReleaseSha256,
        containerImageDigest: deployment.containerImageDigest,
        deploymentReceiptSha256: deployment.receiptSha256,
        deploymentPolicySha256: deployment.policySha256,
        deploymentIssuerId: deployment.issuerId,
        deploymentKeyId: deployment.keyId,
        deploymentRevision: deployment.deploymentRevision,
        modelVersion: input.modelVersion,
        catalogVersion: input.catalogVersion,
        verifiedAt
      },
      checks,
      cloud: {
        realDeployment: true,
        appVersion: input.appVersion,
        releaseApkSha256: input.releaseApkSha256,
        backendReleaseSha256: input.backendReleaseSha256,
        containerImageDigest: deployment.containerImageDigest,
        deploymentReceiptSha256: deployment.receiptSha256,
        deploymentRevision: deployment.deploymentRevision,
        modelVersion: input.modelVersion,
        catalogVersion: input.catalogVersion,
        evidenceRef: input.evidenceRef,
        verifiedAt,
        qwenSafetyVerified: true,
        immediateDeleteVerified: true,
        ttlHours: policy.ttlHours,
        versioningDisabled: true,
        lifecyclePolicyVerified: true,
        deleteDeviceDataVerified: true
      }
    };
  } finally {
    if (token) await input.api.deleteDevice(token).catch(() => undefined);
  }
}

async function runFixture(input: CloudVerificationInput, token: string, bytes: Buffer, sensitive: boolean) {
  const candidateToken = randomUUID();
  const created = await input.api.createJob(token, candidateToken);
  assert(created.candidateToken === candidateToken, "Cloud create response crossed the submitted candidate boundary");
  const upload = new URL(created.uploadUrl);
  assert(upload.origin === normalizedProductionOrigin(input.baseUrl) &&
    /^\/v1\/analysis-jobs\/[0-9a-f-]{36}\/image$/i.test(upload.pathname) && !upload.search && !upload.hash,
  "Cloud upload capability escaped the exact API origin/path boundary");
  assert(upload.pathname === `/v1/analysis-jobs/${created.uploadSessionId}/image`,
    "Cloud create response did not bind the upload session to its capability URL");
  const uploadAck = await input.api.upload(token, created.uploadUrl, bytes);
  assert(
    uploadAck.jobId === created.jobId &&
    uploadAck.candidateToken === candidateToken &&
    uploadAck.uploadSessionId === created.uploadSessionId &&
    uploadAck.status === "uploaded",
    "Cloud upload acknowledgement crossed the job, candidate, or session boundary"
  );
  const uploaded = await input.api.getJob(token, created.jobId);
  const objectKey = await input.objects.findJobObject(created.jobId, uploaded.createdAt);
  assert(objectKey, `Uploaded ${sensitive ? "sensitive" : "safe"} fixture was not observed in OSS`);
  const completed = await input.api.complete(token, created.jobId);
  assert(completed.jobId === created.jobId && completed.candidateToken === candidateToken,
    "Cloud completion response crossed the job or candidate boundary");
  const terminal = await input.api.getJob(token, created.jobId);
  assert(completed.status === terminal.status, "Cloud completion and job terminal status disagree");
  if (sensitive) {
    assert(terminal.status === "rejected", "Server-side Qwen did not reject the sensitive fixture");
    assert(terminal.errorCode === `server_sensitive_${input.expectedSensitiveType}`,
      "Sensitive fixture was not rejected for the expected server-side reason");
  } else {
    assert(terminal.status === "completed" || terminal.status === "needs_content",
      "Authorized non-sensitive fixture did not complete the Qwen path");
  }
  const deleted = await waitUntil(async () => !(await input.objects.exists(objectKey)), input.deleteWaitMs ?? 10_000);
  assert(deleted, `Terminal ${sensitive ? "sensitive" : "safe"} fixture remained in OSS`);
  return { objectObserved: true, status: terminal.status, errorCode: terminal.errorCode, deleted };
}

function validateInput(input: CloudVerificationInput) {
  assert(validToken(input.runId), "Cloud evidence runId is invalid");
  assert(boundedText(input.evidenceRef, 1, 500), "Cloud evidenceRef is required");
  assert(boundedText(input.appVersion, 1, 100) && boundedText(input.modelVersion, 1, 200) && boundedText(input.catalogVersion, 1, 200),
    "Cloud app/model/catalog versions are required");
  assert(/^[a-f0-9]{64}$/.test(input.releaseApkSha256), "Cloud Release APK SHA-256 is required");
  assert(/^[a-f0-9]{64}$/.test(input.backendReleaseSha256), "Cloud backend Release SHA-256 is required");
  assert(/^sha256:[a-f0-9]{64}$/.test(input.deploymentReceipt?.containerImageDigest ?? ""), "Cloud OCI image digest is required");
  assert(/^[a-f0-9]{64}$/.test(input.deploymentReceipt?.receiptSha256 ?? "") &&
    /^[a-f0-9]{64}$/.test(input.deploymentReceipt?.policySha256 ?? ""),
  "Cloud deployment receipt and policy SHA-256 values are required");
  assert(SENSITIVE_TYPES.has(input.expectedSensitiveType), "Cloud expected sensitive type is invalid");
  assert(input.deleteWaitMs === undefined || (Number.isInteger(input.deleteWaitMs) && input.deleteWaitMs >= 10 && input.deleteWaitMs <= 10_000),
    "Cloud deletion wait must be 10-10000 ms");
  validateJpeg(input.safeFixture, "safe");
  validateJpeg(input.sensitiveFixture, "sensitive");
  assert(!input.safeFixture.equals(input.sensitiveFixture), "Cloud safe and sensitive fixtures must differ");
}

function validateJpeg(bytes: Buffer, label: string) {
  assert(Buffer.isBuffer(bytes) && bytes.length >= 32 && bytes.length <= 3 * 1024 * 1024,
    `Cloud ${label} fixture must be a 32-byte to 3-MB JPEG`);
  assert(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
    `Cloud ${label} fixture is not a JPEG`);
}

function normalizedProductionOrigin(value: string) {
  const url = new URL(value);
  assert(url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash && url.pathname === "/",
    "Cloud base URL must be an origin-only HTTPS URL");
  return url.origin;
}

async function waitUntil(predicate: () => Promise<boolean>, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  do {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  return false;
}

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function validToken(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9._-]{3,128}$/.test(value);
}

function boundedText(value: unknown, minimum: number, maximum: number) {
  return typeof value === "string" && value.trim().length >= minimum && value.trim().length <= maximum;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
