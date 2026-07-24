import path from "node:path";
import { existsSync } from "node:fs";

const localEnvFile = path.resolve(process.cwd(), ".env");
if (existsSync(localEnvFile)) process.loadEnvFile(localEnvFile);

export interface AppConfig {
  environment: "development" | "test" | "production";
  host: string;
  port: number;
  publicBaseUrl: string;
  databaseUrl: string | null;
  objectStore: "local" | "oss";
  localObjectDir: string;
  visionProvider: "local" | "qwen" | "kimi";
  dashscopeApiKey: string | null;
  dashscopeBaseUrl: string;
  qwenFlashModel: string;
  qwenPlusModel: string;
  kimiApiKey: string | null;
  kimiBaseUrl: string;
  kimiModel: string;
  ossRegion: string;
  ossBucket: string | null;
  ossAccessKeyId: string | null;
  ossAccessKeySecret: string | null;
  ossSecurityToken: string | null;
  maxJobsPerDevicePerDay: number;
  maxJobsPerDevicePerMonth: number;
  maxJobsGlobalPerDay: number;
  maxJobsGlobalPerMonth: number;
  worstCaseCostMicroCnyPerJob: number;
  maxGlobalCostMicroCnyPerDay: number;
  maxGlobalCostMicroCnyPerMonth: number;
  objectTtlHours: number;
  allowUnattestedFacts: boolean;
  knowledgeCatalogSha256: string | null;
  knowledgeReviewerIds: string[];
  containerImageDigest: string | null;
}

function optional(value: string | undefined): string | null {
  return value?.trim() ? value.trim() : null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const environment = parseEnvironment(env.NODE_ENV);
  const visionProvider = parseProvider(env.VISION_PROVIDER, "VISION_PROVIDER", ["local", "qwen", "kimi"], "local");
  const port = Number(env.PORT ?? "8787");
  const maxJobs = Number(env.MAX_JOBS_PER_DEVICE_PER_DAY ?? "24");
  const maxMonthlyJobs = Number(env.MAX_JOBS_PER_DEVICE_PER_MONTH ?? "300");
  const maxGlobalJobs = Number(env.MAX_JOBS_GLOBAL_PER_DAY ?? "2000");
  const maxGlobalMonthlyJobs = Number(env.MAX_JOBS_GLOBAL_PER_MONTH ?? "50000");
  const worstCaseCostMicroCnyPerJob = Number(env.WORST_CASE_COST_MICRO_CNY_PER_JOB ?? "1");
  const maxGlobalCostMicroCnyPerDay = Number(env.MAX_GLOBAL_COST_MICRO_CNY_PER_DAY ?? "2000");
  const maxGlobalCostMicroCnyPerMonth = Number(env.MAX_GLOBAL_COST_MICRO_CNY_PER_MONTH ?? "50000");
  const ttl = Number(env.OBJECT_TTL_HOURS ?? "24");
  const allowUnattestedFacts = env.ALLOW_UNATTESTED_FACTS === "true";
  const knowledgeCatalogSha256 = optional(env.KNOWLEDGE_CATALOG_SHA256)?.toLowerCase() ?? null;
  if (knowledgeCatalogSha256 && !/^[a-f0-9]{64}$/.test(knowledgeCatalogSha256)) {
    throw new Error("KNOWLEDGE_CATALOG_SHA256 must be a SHA-256 hex digest");
  }
  const knowledgeReviewerIds = [...new Set((env.KNOWLEDGE_REVIEWER_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean))];
  const containerImageDigest = optional(env.CONTAINER_IMAGE_DIGEST)?.toLowerCase() ?? null;
  if (containerImageDigest && !/^sha256:[a-f0-9]{64}$/.test(containerImageDigest)) {
    throw new Error("CONTAINER_IMAGE_DIGEST must be an OCI sha256 digest");
  }
  if (knowledgeReviewerIds.some((value) => value.length < 3 || value.length > 100)) {
    throw new Error("KNOWLEDGE_REVIEWER_IDS contains an invalid reviewer ID");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be a valid TCP port");
  if (!Number.isInteger(maxJobs) || maxJobs < 1 || maxJobs > 500) throw new Error("MAX_JOBS_PER_DEVICE_PER_DAY is invalid");
  if (!Number.isInteger(maxMonthlyJobs) || maxMonthlyJobs < 1 || maxMonthlyJobs > 10_000) {
    throw new Error("MAX_JOBS_PER_DEVICE_PER_MONTH is invalid");
  }
  if (!Number.isInteger(maxGlobalJobs) || maxGlobalJobs < 1 || maxGlobalJobs > 1_000_000) {
    throw new Error("MAX_JOBS_GLOBAL_PER_DAY is invalid");
  }
  if (!Number.isInteger(maxGlobalMonthlyJobs) || maxGlobalMonthlyJobs < 1 || maxGlobalMonthlyJobs > 10_000_000) {
    throw new Error("MAX_JOBS_GLOBAL_PER_MONTH is invalid");
  }
  validateSafePositiveInteger(worstCaseCostMicroCnyPerJob, "WORST_CASE_COST_MICRO_CNY_PER_JOB");
  validateSafePositiveInteger(maxGlobalCostMicroCnyPerDay, "MAX_GLOBAL_COST_MICRO_CNY_PER_DAY");
  validateSafePositiveInteger(maxGlobalCostMicroCnyPerMonth, "MAX_GLOBAL_COST_MICRO_CNY_PER_MONTH");
  if (visionProvider !== "local") {
    for (const name of [
      "WORST_CASE_COST_MICRO_CNY_PER_JOB",
      "MAX_GLOBAL_COST_MICRO_CNY_PER_DAY",
      "MAX_GLOBAL_COST_MICRO_CNY_PER_MONTH"
    ]) {
      if (!env[name]?.trim()) throw new Error(`${name} must be explicitly configured for a cloud vision provider`);
    }
  }
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > 168) throw new Error("OBJECT_TTL_HOURS is invalid");

  const objectStore = parseProvider(env.OBJECT_STORE, "OBJECT_STORE", ["local", "oss"], "local");
  if (objectStore === "oss" && allowUnattestedFacts) {
    throw new Error("ALLOW_UNATTESTED_FACTS cannot be enabled with OSS production storage");
  }

  const publicBaseUrl = (env.PUBLIC_BASE_URL ?? `http://127.0.0.1:${port}`).replace(/\/$/, "");
  const databaseUrl = optional(env.DATABASE_URL);
  const dashscopeApiKey = optional(env.DASHSCOPE_API_KEY);
  const dashscopeBaseUrl = parseDashscopeBaseUrl(env.DASHSCOPE_BASE_URL);
  const kimiApiKey = optional(env.KIMI_API_KEY);
  const kimiBaseUrl = parseKimiBaseUrl(env.KIMI_BASE_URL);
  const kimiModel = env.KIMI_MODEL?.trim() || (kimiBaseUrl === "https://api.kimi.com/coding/v1" ? "k3" : "kimi-k3");
  const ossBucket = optional(env.OSS_BUCKET);
  const roleAccessKeyId = optional(env.ALIBABA_CLOUD_ACCESS_KEY_ID);
  const roleAccessKeySecret = optional(env.ALIBABA_CLOUD_ACCESS_KEY_SECRET);
  const roleSecurityToken = optional(env.ALIBABA_CLOUD_SECURITY_TOKEN);
  const roleCredentialParts = [roleAccessKeyId, roleAccessKeySecret, roleSecurityToken].filter(Boolean).length;
  if (roleCredentialParts !== 0 && roleCredentialParts !== 3) {
    throw new Error("Alibaba Cloud role credentials must include access key ID, secret, and security token");
  }
  const ossAccessKeyId = roleAccessKeyId ?? optional(env.OSS_ACCESS_KEY_ID);
  const ossAccessKeySecret = roleAccessKeySecret ?? optional(env.OSS_ACCESS_KEY_SECRET);
  const ossSecurityToken = roleSecurityToken ?? optional(env.OSS_SECURITY_TOKEN);
  if (environment === "production") {
    if (!databaseUrl) throw new Error("DATABASE_URL is required in production");
    if (!/^postgres(?:ql)?:\/\//i.test(databaseUrl)) throw new Error("DATABASE_URL must use PostgreSQL in production");
    if (objectStore !== "oss") throw new Error("OBJECT_STORE must be oss in production");
    if (visionProvider === "local") throw new Error("VISION_PROVIDER must be qwen or kimi in production");
    if (!publicBaseUrl.startsWith("https://")) throw new Error("PUBLIC_BASE_URL must use HTTPS in production");
    if (allowUnattestedFacts) throw new Error("ALLOW_UNATTESTED_FACTS cannot be enabled in production");
    if (ttl > 24) throw new Error("OBJECT_TTL_HOURS must not exceed 24 in production");
    if (!knowledgeCatalogSha256) throw new Error("KNOWLEDGE_CATALOG_SHA256 is required in production");
    if (knowledgeReviewerIds.length === 0) throw new Error("KNOWLEDGE_REVIEWER_IDS is required in production");
    if (!containerImageDigest) throw new Error("CONTAINER_IMAGE_DIGEST is required in production");
    if (visionProvider === "qwen" && !env.DASHSCOPE_BASE_URL?.trim()) {
      throw new Error("DASHSCOPE_BASE_URL is required for Qwen in production");
    }
    if (visionProvider === "kimi") {
      if (!env.KIMI_BASE_URL?.trim()) throw new Error("KIMI_BASE_URL is required for Kimi in production");
      if (kimiBaseUrl !== "https://api.moonshot.cn/v1") {
        throw new Error("KIMI_BASE_URL must use the China Kimi Open Platform in production");
      }
      if (kimiModel !== "kimi-k3") throw new Error("KIMI_MODEL must be the reviewed kimi-k3 model in production");
    }
    for (const [name, value] of [
      [visionProvider === "qwen" ? "DASHSCOPE_API_KEY" : "KIMI_API_KEY",
        visionProvider === "qwen" ? dashscopeApiKey : kimiApiKey],
      ["OSS_BUCKET", ossBucket]
    ] as const) {
      if (!value) throw new Error(`${name} is required in production`);
    }
    if (!ossAccessKeyId || !ossAccessKeySecret || !ossSecurityToken) {
      throw new Error(
        "Complete temporary OSS STS credentials (access key ID, secret, and security token) are required in production"
      );
    }
  }

  return {
    environment,
    host: env.HOST ?? "127.0.0.1",
    port,
    publicBaseUrl,
    databaseUrl,
    objectStore,
    localObjectDir: path.resolve(env.LOCAL_OBJECT_DIR ?? ".data/objects"),
    visionProvider,
    dashscopeApiKey,
    dashscopeBaseUrl,
    qwenFlashModel: env.QWEN_FLASH_MODEL ?? "qwen3.6-flash-2026-04-16",
    qwenPlusModel: env.QWEN_PLUS_MODEL ?? "qwen3.6-plus-2026-04-02",
    kimiApiKey,
    kimiBaseUrl,
    kimiModel,
    ossRegion: env.OSS_REGION ?? "oss-cn-beijing",
    ossBucket,
    ossAccessKeyId,
    ossAccessKeySecret,
    ossSecurityToken,
    maxJobsPerDevicePerDay: maxJobs,
    maxJobsPerDevicePerMonth: maxMonthlyJobs,
    maxJobsGlobalPerDay: maxGlobalJobs,
    maxJobsGlobalPerMonth: maxGlobalMonthlyJobs,
    worstCaseCostMicroCnyPerJob,
    maxGlobalCostMicroCnyPerDay,
    maxGlobalCostMicroCnyPerMonth,
    objectTtlHours: ttl,
    allowUnattestedFacts,
    knowledgeCatalogSha256,
    knowledgeReviewerIds,
    containerImageDigest
  };
}

function parseKimiBaseUrl(value: string | undefined): string {
  const raw = value?.trim() || "https://api.moonshot.cn/v1";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("KIMI_BASE_URL must be a valid URL");
  }
  const normalized = `${url.protocol}//${url.hostname.toLowerCase()}${url.pathname.replace(/\/$/, "")}`;
  const allowed = new Set([
    "https://api.moonshot.cn/v1",
    "https://api.moonshot.ai/v1",
    "https://api.kimi.com/coding/v1"
  ]);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    !allowed.has(normalized)
  ) {
    throw new Error("KIMI_BASE_URL must be an official Kimi Open Platform or Kimi Code endpoint");
  }
  return normalized;
}

function parseDashscopeBaseUrl(value: string | undefined): string {
  const raw = value?.trim() || "https://dashscope.aliyuncs.com/compatible-mode/v1";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("DASHSCOPE_BASE_URL must be a valid URL");
  }
  const hostname = url.hostname.toLowerCase();
  const workspaceHost = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cn-beijing\.maas\.aliyuncs\.com$/;
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    (hostname !== "dashscope.aliyuncs.com" && !workspaceHost.test(hostname)) ||
    url.pathname.replace(/\/$/, "") !== "/compatible-mode/v1"
  ) {
    throw new Error("DASHSCOPE_BASE_URL must be an HTTPS Beijing Model Studio compatible-mode/v1 endpoint");
  }
  return `https://${hostname}/compatible-mode/v1`;
}

function parseEnvironment(value: string | undefined): AppConfig["environment"] {
  const normalized = value?.trim() || "development";
  if (normalized !== "development" && normalized !== "test" && normalized !== "production") {
    throw new Error("NODE_ENV must be development, test, or production");
  }
  return normalized;
}

function parseProvider<const T extends string>(
  value: string | undefined,
  name: string,
  allowed: readonly T[],
  fallback: T
): T {
  const normalized = value?.trim() || fallback;
  if (!allowed.includes(normalized as T)) throw new Error(`${name} has an unsupported value`);
  return normalized as T;
}

function validateSafePositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} is invalid`);
}
