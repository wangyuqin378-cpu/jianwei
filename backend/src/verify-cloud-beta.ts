import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import OSS from "ali-oss";
import { verifyCloudBeta, type CloudAuditApi, type CloudAuditObjects } from "./cloud-beta-verification.js";
import { hasSafeAnalysisLifecycle, isDisabledBucketVersioning } from "./infrastructure/object-store.js";
import { computeBackendReleaseIdentity } from "./release-identity.js";
import { verifyDeploymentReceipt } from "./deployment-receipt.js";
import { isMainModule } from "./main-module.js";
import { validateRegistrationResponse } from "./registration-binding.js";
import { validateJobStatusResponse } from "./job-status-response.js";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

class HttpsCloudApi implements CloudAuditApi {
  private readonly origin: string;

  constructor(baseUrl: string) {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "https:" || parsed.pathname !== "/" || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Error("Cloud audit base URL must be an origin-only HTTPS URL");
    }
    this.origin = parsed.origin;
  }

  async ready() {
    const body = await this.requestJson("/health/ready", { expectedStatus: 200 });
    return {
      ok: body.ok === true,
      mode: String(body.mode ?? ""),
      catalogVersion: String(body.catalogVersion ?? ""),
      backendReleaseSha256: String(body.backendReleaseSha256 ?? ""),
      containerImageDigest: String(body.containerImageDigest ?? "")
    };
  }

  async register() {
    const installationId = randomUUID();
    const body = await this.requestJson("/v1/devices/register", {
      method: "POST",
      expectedStatus: 201,
      json: { installationId }
    });
    const registration = validateRegistrationResponse(installationId, body);
    return { token: registration.deviceToken };
  }

  async createJob(token: string, candidateToken: string) {
    const body = await this.requestJson("/v1/analysis-jobs", {
      method: "POST",
      expectedStatus: 201,
      token,
      json: {
        candidateToken,
        capturedAtBucket: new Date().toISOString().slice(0, 10),
        localLabels: ["authorized-cloud-audit"],
        qualityScore: 1,
        sensitiveFlags: [],
        contentType: "image/jpeg"
      }
    });
    if (
      typeof body.jobId !== "string" ||
      body.candidateToken !== candidateToken ||
      typeof body.uploadUrl !== "string" ||
      typeof body.uploadSessionId !== "string" ||
      body.status !== "awaiting_upload"
    ) {
      throw new Error("Cloud analysis-job response is invalid");
    }
    return {
      jobId: body.jobId,
      candidateToken: body.candidateToken,
      uploadUrl: body.uploadUrl,
      uploadSessionId: body.uploadSessionId
    };
  }

  async upload(token: string, uploadUrl: string, bytes: Buffer) {
    const target = new URL(uploadUrl);
    if (target.origin !== this.origin) throw new Error("Cloud upload URL escaped the API origin");
    const body = await this.requestAbsoluteJson(target.href, {
      method: "PUT",
      expectedStatus: 200,
      token,
      headers: { "Content-Type": "image/jpeg" },
      body: Uint8Array.from(bytes)
    });
    return {
      jobId: String(body.jobId ?? ""),
      candidateToken: String(body.candidateToken ?? ""),
      uploadSessionId: String(body.uploadSessionId ?? ""),
      status: String(body.status ?? "")
    };
  }

  async getJob(token: string, jobId: string) {
    const body = await this.requestJson(`/v1/analysis-jobs/${encodeURIComponent(jobId)}`, { expectedStatus: 200, token });
    return validateJobStatusResponse(body, jobId);
  }

  async complete(token: string, jobId: string) {
    const body = await this.requestJson(`/v1/analysis-jobs/${encodeURIComponent(jobId)}/complete`, {
      method: "POST",
      expectedStatus: 200,
      token
    });
    return {
      jobId: String(body.jobId ?? ""),
      candidateToken: String(body.candidateToken ?? ""),
      status: String(body.status ?? "")
    };
  }

  async deleteDevice(token: string) {
    await this.requestJson("/v1/device-data", { method: "DELETE", expectedStatus: 204, token });
  }

  async cardsStatus(token: string) {
    const response = await fetch(`${this.origin}/v1/cards`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000)
    });
    await response.arrayBuffer();
    return response.status;
  }

  private requestJson(pathname: string, options: RequestOptions) {
    return this.requestAbsoluteJson(`${this.origin}${pathname}`, options);
  }

  private async requestAbsoluteJson(url: string, options: RequestOptions) {
    const headers = new Headers(options.headers ?? {});
    if (options.token) headers.set("Authorization", `Bearer ${options.token}`);
    let body = options.body;
    if (options.json !== undefined) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(options.json);
    }
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers,
      ...(body === undefined ? {} : { body }),
      redirect: "error",
      signal: AbortSignal.timeout(30_000)
    });
    const text = await response.text();
    let parsed: Record<string, unknown> = {};
    if (text) {
      try { parsed = JSON.parse(text) as Record<string, unknown>; }
      catch { throw new Error(`Cloud API returned non-JSON HTTP ${response.status}`); }
    }
    if (response.status !== options.expectedStatus) {
      const error = parsed.error as { code?: unknown } | undefined;
      throw new Error(`Cloud API expected HTTP ${options.expectedStatus}, received ${response.status} (${String(error?.code ?? "no-code")})`);
    }
    return parsed;
  }
}

class OssEvidenceInspector implements CloudAuditObjects {
  private readonly client: OSS & {
    getBucketVersioning(bucket: string): Promise<{ versionStatus?: string }>;
  };
  private readonly bucket: string;

  constructor(env: NodeJS.ProcessEnv) {
    const accessKeyId = env.ALIBABA_CLOUD_ACCESS_KEY_ID ?? env.OSS_ACCESS_KEY_ID;
    const accessKeySecret = env.ALIBABA_CLOUD_ACCESS_KEY_SECRET ?? env.OSS_ACCESS_KEY_SECRET;
    const securityToken = env.ALIBABA_CLOUD_SECURITY_TOKEN ?? env.OSS_SECURITY_TOKEN;
    this.bucket = required(env.OSS_BUCKET, "OSS_BUCKET");
    if (!accessKeyId || !accessKeySecret || !securityToken) {
      throw new Error("Cloud audit requires a complete temporary OSS STS credential set in the process environment");
    }
    this.client = new OSS({
      region: env.OSS_REGION ?? "oss-cn-beijing",
      bucket: this.bucket,
      accessKeyId,
      accessKeySecret,
      stsToken: securityToken,
      secure: true,
      timeout: 10_000
    }) as OSS & { getBucketVersioning(bucket: string): Promise<{ versionStatus?: string }> };
  }

  async verifyPolicy() {
    const [lifecycle, versioning] = await Promise.all([
      this.client.getBucketLifecycle(this.bucket),
      this.client.getBucketVersioning(this.bucket)
    ]);
    const rules = lifecycle.rules as Array<{ status: string; prefix: string; days?: number | string }>;
    if (!hasSafeAnalysisLifecycle(rules) || !isDisabledBucketVersioning(versioning.versionStatus)) {
      throw new Error("Cloud OSS lifecycle or versioning policy is unsafe");
    }
    const safeDays = rules
      .filter((rule) => rule.status === "Enabled" && "analysis/".startsWith(rule.prefix) && Number(rule.days) > 0 && Number(rule.days) <= 1)
      .map((rule) => Number(rule.days));
    return { ttlHours: Math.min(...safeDays) * 24, versioningDisabled: true };
  }

  async findJobObject(jobId: string, createdAt: string) {
    const created = new Date(createdAt);
    if (!Number.isFinite(created.getTime())) throw new Error("Cloud job createdAt is invalid");
    const prefix = `analysis/${created.toISOString().slice(0, 10)}/`;
    let marker: string | undefined;
    const matches: string[] = [];
    let pages = 0;
    do {
      const result = await this.client.list({ prefix, ...(marker ? { marker } : {}), "max-keys": 500 }, {});
      for (const object of result.objects ?? []) {
        if (object.name.endsWith(`/${jobId}.image`)) matches.push(object.name);
      }
      marker = result.isTruncated ? result.nextMarker : undefined;
      pages += 1;
      if (pages > 50) throw new Error("Cloud OSS evidence listing exceeded its bounded page limit");
    } while (marker);
    if (matches.length > 1) throw new Error("Cloud job has duplicate OSS objects");
    return matches[0] ?? null;
  }

  async exists(objectKey: string) {
    try {
      await this.client.head(objectKey);
      return true;
    } catch (error) {
      const typed = error as { status?: number; code?: string };
      if (typed.status === 404 || typed.code === "NoSuchKey") return false;
      throw error;
    }
  }
}

interface RequestOptions {
  method?: string;
  expectedStatus: number;
  token?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array<ArrayBuffer>;
  json?: unknown;
}

function parseArgs(values: string[]) {
  const args = new Map<string, string | true>();
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (key === "--write" || key === "--confirm-authorized-fixtures") args.set(key, true);
    else if (key?.startsWith("--")) {
      const value = values[++index];
      if (!value) throw new Error(`Missing value for ${key}`);
      args.set(key, value);
    } else throw new Error(`Unexpected argument: ${key}`);
  }
  return args;
}

function required(value: string | undefined, label: string) {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

async function assertPinnedOrdinaryPolicy(file: string): Promise<void> {
  const info = await lstat(file);
  const actual = await realpath(file);
  const normalize = (value: string) => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
  if (!info.isFile() || info.isSymbolicLink() || normalize(actual) !== normalize(file)) {
    throw new Error("Cloud audit trust policy must be the ordinary repository-pinned file");
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.has("--confirm-authorized-fixtures")) {
    throw new Error("Refusing cloud upload without --confirm-authorized-fixtures");
  }
  const stringArg = (name: string) => required(typeof args.get(name) === "string" ? String(args.get(name)) : undefined, name);
  const safeFixture = await readFile(path.resolve(process.cwd(), stringArg("--safe-fixture")));
  const sensitiveFixture = await readFile(path.resolve(process.cwd(), stringArg("--sensitive-fixture")));
  const releaseArtifact = JSON.parse(await readFile(path.resolve(process.cwd(), stringArg("--release-artifact")), "utf8")) as Record<string, unknown>;
  if (releaseArtifact.evidenceKind !== "verified_release_apk" || releaseArtifact.formalSigning !== true ||
      releaseArtifact.debugCertificate !== false || typeof releaseArtifact.versionName !== "string" ||
      !releaseArtifact.versionName.trim() || typeof releaseArtifact.apkSha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(releaseArtifact.apkSha256)) {
    throw new Error("Cloud audit requires a formally verified Release APK artifact");
  }
  const backendReleaseIdentity = await computeBackendReleaseIdentity();
  const deploymentReceiptPath = path.resolve(process.cwd(), stringArg("--deployment-receipt"));
  const deploymentPolicyPath = path.join(REPOSITORY_ROOT, "config", "evidence-trust-policy.json");
  await assertPinnedOrdinaryPolicy(deploymentPolicyPath);
  const [deploymentReceiptBytes, deploymentPolicyBytes] = await Promise.all([
    readFile(deploymentReceiptPath),
    readFile(deploymentPolicyPath)
  ]);
  const deploymentReceipt = verifyDeploymentReceipt({
    receipt: JSON.parse(deploymentReceiptBytes.toString("utf8")) as Record<string, unknown>,
    receiptBytes: deploymentReceiptBytes,
    policy: JSON.parse(deploymentPolicyBytes.toString("utf8")) as Record<string, unknown>,
    policyBytes: deploymentPolicyBytes
  });
  const result = await verifyCloudBeta({
    api: new HttpsCloudApi(stringArg("--base-url")),
    objects: new OssEvidenceInspector(process.env),
    baseUrl: stringArg("--base-url"),
    runId: stringArg("--run-id"),
    evidenceRef: stringArg("--evidence-ref"),
    appVersion: releaseArtifact.versionName,
    releaseApkSha256: releaseArtifact.apkSha256,
    backendReleaseSha256: backendReleaseIdentity.backendReleaseSha256,
    deploymentReceipt,
    modelVersion: stringArg("--model-version"),
    catalogVersion: stringArg("--catalog-version"),
    safeFixture,
    sensitiveFixture,
    expectedSensitiveType: stringArg("--expected-sensitive-type")
  });
  if (!args.has("--write")) {
    process.stdout.write(`CLOUD_BETA_VERIFICATION_PREVIEW=GO run=${result.cloudProvenance.runId} qwen=1 sensitive=1 immediateDelete=1 lifecycle=1 deviceDelete=1 releaseEvidence=0 wrote=0\n`);
    return;
  }
  const outputPath = path.resolve(process.cwd(), stringArg("--output"));
  await mkdir(path.dirname(outputPath), { recursive: true });
  if (await readFile(outputPath).then(() => true).catch(() => false)) throw new Error("Cloud evidence output already exists");
  const temporary = `${outputPath}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(result, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporary, outputPath);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
  process.stdout.write(`CLOUD_BETA_VERIFICATION=GO run=${result.cloudProvenance.runId} qwen=1 sensitive=1 immediateDelete=1 lifecycle=1 deviceDelete=1 wrote=1\n`);
}

if (isMainModule(import.meta.url)) await main();
