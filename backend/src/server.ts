import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import type {
  CardRepository,
  Device,
  DeviceRepository,
  EvaluationLeaseDefinition,
  KnowledgeCard,
  ObjectStore,
  VisionProvider
} from "./domain/types.js";
import {
  cardIdParamSchema,
  cardsQuerySchema,
  createAnalysisJobSchema,
  feedbackSchema,
  idParamSchema,
  registerDeviceSchema,
  trackItemSchema
} from "./domain/schemas.js";
import { loadConfig, type AppConfig } from "./config.js";
import { AppError } from "./errors.js";
import { InMemoryRepositories } from "./infrastructure/in-memory-repositories.js";
import { PostgresRepositories } from "./infrastructure/postgres-repositories.js";
import {
  LocalObjectStore,
  OssObjectStore,
  RotatingOssCredentialSource
} from "./infrastructure/object-store.js";
import { KnowledgeCatalogService } from "./services/knowledge-catalog.js";
import { AnalysisService } from "./services/analysis-service.js";
import { LocalVisionProvider } from "./providers/local-providers.js";
import { ConfidenceFallbackVisionProvider, QwenVisionProvider } from "./providers/qwen-providers.js";
import { KimiVisionProvider } from "./providers/kimi-providers.js";
import { loadBackendReleaseSha256 } from "./release-identity.js";
import { installationBindingSha256 } from "./registration-binding.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const PRODUCTION_LOG_REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers['x-jianwei-evaluation-lease']",
  "req.headers.cookie",
  "req.headers['x-fc-access-key-id']",
  "req.headers['x-fc-access-key-secret']",
  "req.headers['x-fc-security-token']",
  "res.headers['set-cookie']"
];

export const PRODUCTION_LOG_SERIALIZERS = {
  req(value: unknown) {
    const request = isRecord(value) ? value : {};
    const routeOptions = isRecord(request.routeOptions) ? request.routeOptions : {};
    return {
      method: safeLogToken(request.method, "UNKNOWN"),
      route: safeRouteTemplate(routeOptions.url)
    };
  },
  res(value: unknown) {
    const reply = isRecord(value) ? value : {};
    return {
      statusCode: typeof reply.statusCode === "number" && Number.isInteger(reply.statusCode)
        ? reply.statusCode
        : 0
    };
  },
  err(value: unknown) {
    const error = isRecord(value) ? value : {};
    return {
      type: safeLogToken(error.name, "Error"),
      code: safeLogToken(error.code, "internal_error"),
      message: "request_failed",
      stack: ""
    };
  }
};

export interface ServerOverrides {
  config?: AppConfig;
  knowledgePath?: string;
  vision?: VisionProvider;
  objects?: ObjectStore;
  ossCredentials?: RotatingOssCredentialSource;
  evaluationLeases?: EvaluationLeaseDefinition[];
  backendReleaseSha256?: string | null;
}

export async function buildServer(overrides: ServerOverrides = {}): Promise<FastifyInstance> {
  const config = overrides.config ?? loadConfig();
  const injectedServices = [
    overrides.knowledgePath,
    overrides.vision,
    overrides.objects,
    overrides.ossCredentials,
    overrides.evaluationLeases,
    overrides.backendReleaseSha256
  ];
  if (config.environment !== "test" && injectedServices.some((value) => value !== undefined)) {
    throw new Error("Server service overrides are test-only");
  }
  const app = Fastify({
    logger: config.environment === "production" ? {
      level: "info",
      serializers: PRODUCTION_LOG_SERIALIZERS,
      redact: {
        paths: PRODUCTION_LOG_REDACT_PATHS,
        censor: "[REDACTED]"
      }
    } : false,
    bodyLimit: 3 * 1024 * 1024
  });
  let devicesForRateLimit: DeviceRepository | null = null;
  await app.register(cors, { origin: false });
  await app.register(rateLimit, {
    max: 120,
    timeWindow: "1 minute",
    keyGenerator: async (request) => {
      const authorization = request.headers.authorization;
      if (authorization?.startsWith("Bearer ") && devicesForRateLimit) {
        const token = authorization.slice("Bearer ".length).trim();
        if (token) {
          const device = await devicesForRateLimit.findByTokenHash(hashToken(token));
          if (device) return `device:${device.id}`;
        }
      }
      return `ip:${request.ip}`;
    }
  });
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("Cache-Control", "no-store");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    return payload;
  });

  app.addContentTypeParser(["image/jpeg", "image/webp", "image/png"], { parseAs: "buffer" }, (_request, body, done) => {
    done(null, body);
  });

  const knowledge = await KnowledgeCatalogService.fromFile(
    overrides.knowledgePath ?? path.join(ROOT, "knowledge", "catalog.json"),
    {
      expectedSha256: config.knowledgeCatalogSha256,
      requireAttestedApprovedFacts: config.environment === "production",
      approvedReviewerIds: config.environment === "production" && config.knowledgeReviewerIds.length > 0
        ? config.knowledgeReviewerIds
        : null
    }
  );
  const backendReleaseSha256 = overrides.backendReleaseSha256
    ?? loadBackendReleaseSha256(config.environment);
  if (config.environment === "production" && !backendReleaseSha256) {
    throw new Error("Backend Release SHA-256 is required in production");
  }

  const inMemory = config.databaseUrl ? null : new InMemoryRepositories();
  const postgres = config.databaseUrl ? new PostgresRepositories(config.databaseUrl, backendReleaseSha256) : null;
  const devices: DeviceRepository = postgres?.devicesRepository ?? (inMemory as InMemoryRepositories).devicesRepository;
  devicesForRateLimit = devices;
  const jobs = postgres?.jobsRepository ?? (inMemory as InMemoryRepositories).jobsRepository;
  if (overrides.evaluationLeases) {
    if (config.environment !== "test") throw new Error("Evaluation lease fixtures are test-only");
    for (const lease of overrides.evaluationLeases) await jobs.createEvaluationLease(lease);
  }
  const cards: CardRepository = postgres?.cardsRepository ?? (inMemory as InMemoryRepositories).cardsRepository;
  const objectDeletions = postgres?.objectDeletionsRepository
    ?? (inMemory as InMemoryRepositories).objectDeletionsRepository;
  if (postgres) app.addHook("onClose", async () => postgres.close());

  const ossCredentials = overrides.ossCredentials ?? (config.objectStore === "oss"
    ? new RotatingOssCredentialSource({
        accessKeyId: required(config.ossAccessKeyId, "OSS_ACCESS_KEY_ID"),
        accessKeySecret: required(config.ossAccessKeySecret, "OSS_ACCESS_KEY_SECRET"),
        stsToken: required(config.ossSecurityToken, "OSS_SECURITY_TOKEN")
      })
    : null);
  const objects = overrides.objects ?? (config.objectStore === "oss"
    ? new OssObjectStore({
        region: config.ossRegion,
        bucket: required(config.ossBucket, "OSS_BUCKET"),
        accessKeyId: required(config.ossAccessKeyId, "OSS_ACCESS_KEY_ID"),
        accessKeySecret: required(config.ossAccessKeySecret, "OSS_ACCESS_KEY_SECRET"),
        securityToken: config.environment === "production"
          ? required(config.ossSecurityToken, "OSS_SECURITY_TOKEN")
          : config.ossSecurityToken,
        ttlHours: config.objectTtlHours
      }, undefined, ossCredentials ?? undefined)
    : new LocalObjectStore(config.localObjectDir, config.publicBaseUrl, config.objectTtlHours));
  if (ossCredentials) {
    app.addHook("onRequest", async (request) => {
      if (request.url.split("?", 1)[0] === "/health/live") return;
      updateOssCredentialsFromFcHeaders(
        request.headers,
        ossCredentials,
        config.environment === "production"
      );
    });
  }
  await objects.verifyRetentionPolicy();

  let vision: VisionProvider = overrides.vision ?? new LocalVisionProvider(knowledge);
  if (config.visionProvider === "qwen") {
    const apiKey = required(config.dashscopeApiKey, "DASHSCOPE_API_KEY");
    if (!overrides.vision) {
      vision = new ConfidenceFallbackVisionProvider(
        new QwenVisionProvider({ apiKey, model: config.qwenFlashModel, baseUrl: config.dashscopeBaseUrl }),
        new QwenVisionProvider({ apiKey, model: config.qwenPlusModel, baseUrl: config.dashscopeBaseUrl })
      );
    }
  }
  if (config.visionProvider === "kimi") {
    const apiKey = required(config.kimiApiKey, "KIMI_API_KEY");
    if (!overrides.vision) {
      vision = new KimiVisionProvider({ apiKey, model: config.kimiModel, baseUrl: config.kimiBaseUrl });
    }
  }
  const analysis = new AnalysisService(
    jobs,
    cards,
    objects,
    objectDeletions,
    vision,
    knowledge,
    config.maxJobsPerDevicePerDay,
    config.maxJobsPerDevicePerMonth,
    config.maxJobsGlobalPerDay,
    config.maxJobsGlobalPerMonth,
    config.worstCaseCostMicroCnyPerJob,
    config.maxGlobalCostMicroCnyPerDay,
    config.maxGlobalCostMicroCnyPerMonth,
    config.allowUnattestedFacts,
    config.publicBaseUrl
  );
  const cleanupExpiredImages = async () => {
    const retried = await analysis.retryPendingObjectDeletions();
    if (retried.deleted > 0) app.log.info(retried, "pending analysis images deleted");
    const deleted = await objects.purgeExpired();
    if (deleted > 0) app.log.info({ deleted }, "expired analysis images deleted");
  };
  await cleanupExpiredImages().catch((error) => app.log.error(error, "analysis image cleanup failed"));
  const cleanupTimer = setInterval(() => {
    void cleanupExpiredImages().catch((error) => app.log.error(error, "analysis image cleanup failed"));
  }, 5 * 60 * 1000);
  cleanupTimer.unref();
  app.addHook("onClose", async () => clearInterval(cleanupTimer));

  async function authenticate(request: FastifyRequest): Promise<Device> {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw new AppError("unauthorized", "缺少设备凭据", 401);
    const token = header.slice("Bearer ".length).trim();
    const device = await devices.findByTokenHash(hashToken(token));
    if (!device) throw new AppError("unauthorized", "设备凭据无效", 401);
    return device;
  }

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message } });
    }
    const validation = error as { name?: string; issues?: unknown };
    if (validation.name === "ZodError") {
      return reply.status(400).send({ error: { code: "invalid_request", message: "请求参数无效", details: validation.issues } });
    }
    if ((error as { statusCode?: unknown }).statusCode === 429) {
      return reply.status(429).send({ error: { code: "rate_limit_exceeded", message: "请求过于频繁，请稍后再试" } });
    }
    app.log.error(error);
    return reply.status(500).send({ error: { code: "internal_error", message: "服务暂时不可用" } });
  });

  const readiness = async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      await postgres?.ping();
      await objects.verifyRetentionPolicy();
      return reply.send({
        ok: true,
        mode: config.visionProvider,
        catalogVersion: knowledge.catalog.version,
        backendReleaseSha256,
        containerImageDigest: config.containerImageDigest
      });
    } catch (error) {
      app.log.error({ err: error }, "readiness check failed");
      return reply.status(503).send({ ok: false });
    }
  };
  app.get("/health", readiness);
  app.get("/health/ready", readiness);
  app.get("/health/live", async () => ({ ok: true }));

  app.post("/v1/devices/register", async (request, reply) => {
    const body = registerDeviceSchema.parse(request.body);
    const deviceToken = randomBytes(32).toString("base64url");
    const device = await devices.register(hashToken(body.installationId), hashToken(deviceToken));
    return reply.status(201).send({
      deviceId: device.id,
      deviceToken,
      installationBindingSha256: installationBindingSha256(body.installationId),
      created: device.created
    });
  });

  app.post("/v1/analysis-jobs", async (request, reply) => {
    const device = await authenticate(request);
    const body = createAnalysisJobSchema.parse(request.body);
    const leaseHeader = request.headers["x-jianwei-evaluation-lease"];
    if (Array.isArray(leaseHeader)) throw new AppError("evaluation_lease_invalid", "Evaluation lease header is invalid", 401);
    const leaseToken = leaseHeader?.trim() || null;
    if ((leaseToken === null) !== (body.evaluationContext === undefined) || (leaseToken && !/^[A-Za-z0-9_-]{43}$/.test(leaseToken))) {
      throw new AppError("evaluation_lease_invalid", "Evaluation lease and context must be supplied together", 401);
    }
    const { evaluationContext, ...jobInput } = body;
    const result = await analysis.createJob(device, jobInput, evaluationContext && leaseToken ? {
      ...evaluationContext,
      tokenHash: hashToken(leaseToken),
      now: new Date().toISOString()
    } : undefined);
    return reply.status(201).send({
      jobId: result.job.id,
      candidateToken: result.job.candidateToken,
      status: result.job.status,
      uploadUrl: result.uploadUrl,
      uploadSessionId: result.job.status === "awaiting_upload" ? result.job.uploadSessionId : null,
      expiresAt: result.expiresAt
    });
  });

  app.put("/v1/analysis-jobs/:id/image", async (request, reply) => {
    const device = await authenticate(request);
    const { id } = idParamSchema.parse(request.params);
    const body = request.body;
    if (!Buffer.isBuffer(body)) throw new AppError("invalid_image", "请求体必须是图片", 400);
    const contentType = request.headers["content-type"]?.split(";")[0] ?? "application/octet-stream";
    const job = await analysis.recordUpload(device, id, body, contentType);
    return reply.send({
      jobId: job.id,
      candidateToken: job.candidateToken,
      uploadSessionId: id,
      status: job.status
    });
  });

  app.post("/v1/analysis-jobs/:id/complete", async (request, reply) => {
    const device = await authenticate(request);
    const { id } = idParamSchema.parse(request.params);
    const result = await analysis.complete(device, id);
    return reply.send({
      jobId: result.job.id,
      candidateToken: result.job.candidateToken,
      status: result.job.status,
      card: result.card ? publicCardResponse(result.card) : null
    });
  });

  app.get("/v1/analysis-jobs/:id", async (request, reply) => {
    const device = await authenticate(request);
    const { id } = idParamSchema.parse(request.params);
    const job = await analysis.requireOwnedJob(device, id);
    return reply.send({
      jobId: job.id,
      candidateToken: job.candidateToken,
      status: job.status,
      errorCode: job.errorCode,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt
    });
  });

  app.get("/v1/cards", async (request, reply) => {
    const device = await authenticate(request);
    const query = cardsQuerySchema.parse(request.query);
    const page = await cards.list(device.id, query.cursor ?? null, query.limit);
    return reply.send({
      items: page.items.map(publicCardResponse),
      nextCursor: page.nextCursor
    });
  });

  app.post("/v1/cards/:id/feedback", async (request, reply) => {
    const device = await authenticate(request);
    const { id } = idParamSchema.parse(request.params);
    const body = feedbackSchema.parse(request.body);
    if (body.action === "TOO_PRIVATE") {
      const deletion = await cards.deleteTooPrivate(device.id, id);
      if (!deletion) throw new AppError("card_not_found", "卡片不存在", 404);
      if (deletion.objectKey) await analysis.deleteOrQueueObject(deletion.objectKey);
      return reply.status(201).send({
        id: deletion.feedback.id,
        cardId: deletion.feedback.cardId,
        action: deletion.feedback.action,
        createdAt: deletion.feedback.createdAt,
        topicAffinities: [{
          topicId: deletion.preference.topicId,
          weight: deletion.preference.weight / 10,
          aliases: []
        }]
      });
    }
    const card = await cards.findById(id);
    if (!card || card.deviceId !== device.id) throw new AppError("card_not_found", "卡片不存在", 404);
    const result = await cards.addFeedback({
      deviceId: device.id,
      cardId: id,
      topicId: card.topicId,
      action: body.action
    });
    return reply.status(201).send({
      id: result.feedback.id,
      cardId: result.feedback.cardId,
      action: result.feedback.action,
      createdAt: result.feedback.createdAt,
      topicAffinities: [{
        topicId: result.preference.topicId,
        weight: result.preference.weight / 10,
        aliases: []
      }]
    });
  });

  app.post("/v1/items/:cardId/track", async (request, reply) => {
    const device = await authenticate(request);
    const { cardId } = cardIdParamSchema.parse(request.params);
    const card = await cards.findById(cardId);
    if (!card || card.deviceId !== device.id) throw new AppError("card_not_found", "卡片不存在", 404);
    const body = trackItemSchema.parse(request.body);
    const tracked = await cards.track({ deviceId: device.id, cardId, ...body });
    return reply.status(201).send({
      id: tracked.id,
      cardId: tracked.cardId,
      startedOn: tracked.startedOn,
      reminderDays: tracked.reminderDays,
      createdAt: tracked.createdAt
    });
  });

  app.delete("/v1/items/:cardId/track", async (request, reply) => {
    const device = await authenticate(request);
    const { cardId } = cardIdParamSchema.parse(request.params);
    await cards.untrack(cardId, device.id);
    return reply.send({ cardId, status: "untracked" });
  });

  app.delete("/v1/device-data", async (request, reply) => {
    const device = await authenticate(request);
    const keys = await jobs.listObjectKeys(device.id);
    await Promise.all(keys.map((key) => analysis.deleteOrQueueObject(key)));
    await devices.deleteCascade(device.id);
    return reply.send({ deviceId: device.id, status: "deleted" });
  });

  return app;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function publicCardResponse(card: KnowledgeCard) {
  return {
    cardId: card.cardId,
    candidateToken: card.candidateToken,
    topicId: card.topicId,
    factId: card.factId,
    title: card.title,
    detectedObjectName: card.detectedObjectName,
    body: card.body,
    personalContext: card.personalContext,
    confidence: card.confidence,
    boundingBox: card.boundingBox,
    sources: card.sources,
    status: card.status,
    scheduledDate: card.scheduledDate,
    createdAt: card.createdAt
  };
}

function safeLogToken(value: unknown, fallback: string): string {
  return typeof value === "string" && /^[A-Za-z0-9_:-]{1,64}$/.test(value) ? value : fallback;
}

function safeRouteTemplate(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.length > 160) return "unmatched";
  if (/[?#]/.test(value) || /[0-9a-f]{8}-[0-9a-f-]{27,}/i.test(value)) return "unmatched";
  return value;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function required(value: string | null, name: string): string {
  if (!value) throw new Error(`${name} is required for the selected provider`);
  return value;
}

export function updateOssCredentialsFromFcHeaders(
  headers: Record<string, string | string[] | undefined>,
  source: RotatingOssCredentialSource,
  requiredForRequest: boolean
): "updated" | "absent" {
  const names = ["x-fc-access-key-id", "x-fc-access-key-secret", "x-fc-security-token"] as const;
  const values = names.map((name) => typeof headers[name] === "string" ? headers[name] : undefined);
  const present = values.filter((value) => value !== undefined).length;
  if (present === 0) {
    if (requiredForRequest) {
      throw new AppError("fc_credentials_missing", "平台临时凭据不可用", 503);
    }
    return "absent";
  }
  if (present !== names.length || values.some((value) => !value)) {
    throw new AppError("fc_credentials_incomplete", "平台临时凭据不完整", 503);
  }
  source.update({
    accessKeyId: values[0]!,
    accessKeySecret: values[1]!,
    stsToken: values[2]!
  });
  return "updated";
}
