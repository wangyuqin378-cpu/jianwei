import { randomUUID } from "node:crypto";
import type {
  AnalysisJob,
  AnalysisJobRepository,
  CardRepository,
  Device,
  EvaluationJobAuthorization,
  KnowledgeCard,
  ObjectDeletionRepository,
  ObjectStore,
  VisionProvider
} from "../domain/types.js";
import { AppError, invariant } from "../errors.js";
import { cardTitleForConfidence, composeCardTitle } from "../domain/card-presentation.js";
import { isValidIsoCalendarDate } from "../domain/card-scheduling.js";
import { KnowledgeCatalogService } from "./knowledge-catalog.js";
import { MAX_ANALYSIS_IMAGE_BYTES } from "../infrastructure/object-store.js";

const BLOCKING_FLAGS = new Set([
  "face", "selfie", "person", "crowd", "screenshot", "document", "id_card", "bank_card",
  "receipt", "high_text_density", "private", "never_analyze"
]);

export const UPLOAD_SESSION_TTL_MS = 10 * 60 * 1000;
export const UPLOAD_CLAIM_LEASE_MS = 60_000;
export const PROCESSING_LEASE_MS = 210_000;
const RECENT_FACT_LOOKBACK_PER_TOPIC = 4;

export interface CreateJobInput {
  candidateToken: string;
  capturedAtBucket: string | null;
  localLabels: string[];
  qualityScore: number;
  sensitiveFlags: string[];
  contentType: "image/jpeg";
}

export class AnalysisService {
  constructor(
    private readonly jobs: AnalysisJobRepository,
    private readonly cards: CardRepository,
    private readonly objects: ObjectStore,
    private readonly objectDeletions: ObjectDeletionRepository,
    private readonly vision: VisionProvider,
    private readonly knowledge: KnowledgeCatalogService,
    private readonly maxJobsPerDay: number,
    private readonly maxJobsPerMonth: number,
    private readonly maxJobsGlobalPerDay: number,
    private readonly maxJobsGlobalPerMonth: number,
    private readonly worstCaseCostMicroCnyPerJob: number,
    private readonly maxGlobalCostMicroCnyPerDay: number,
    private readonly maxGlobalCostMicroCnyPerMonth: number,
    private readonly allowUnattestedFacts: boolean,
    private readonly publicBaseUrl: string
  ) {}

  async createJob(device: Device, input: CreateJobInput, evaluation?: EvaluationJobAuthorization): Promise<{
    job: AnalysisJob;
    uploadUrl: string;
    expiresAt: string;
  }> {
    if (await this.jobs.isCandidateSuppressed(device.id, input.candidateToken)) {
      throw new AppError("candidate_suppressed", "该候选已被当前匿名设备排除", 410);
    }
    const blocked = input.sensitiveFlags[0]
      ?? input.localLabels.find((label) => BLOCKING_FLAGS.has(label.trim().toLowerCase()));
    if (blocked) throw new AppError("sensitive_candidate", `候选图被端侧隐私规则拦截：${blocked}`, 422);
    if (input.qualityScore < 0.35) throw new AppError("low_quality", "候选图清晰度不足", 422);
    let existing = await this.jobs.findByCandidateToken(device.id, input.candidateToken);
    if (existing?.status === "uploading") {
      existing = await this.recoverStaleUpload(existing) ?? existing;
    }
    if (existing?.status === "processing") {
      existing = await this.jobs.recoverExpiredProcessing(existing.id, new Date().toISOString()) ?? existing;
    }
    if (!evaluation && (existing?.status === "completed" || existing?.status === "needs_content" || existing?.status === "rejected")) {
      return { job: existing, uploadUrl: "", expiresAt: existing.updatedAt };
    }
    if (!evaluation && existing?.status === "processing") {
      throw new AppError("candidate_in_progress", "该候选正在处理中", 409);
    }
    if (!evaluation && existing?.status === "uploading") {
      throw new AppError("upload_in_progress", "该候选正在上传中", 409);
    }
    if (!existing && !evaluation) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const used = await this.jobs.countSince(device.id, since);
      if (used >= this.maxJobsPerDay) throw new AppError("daily_budget_exceeded", "今日候选分析额度已用完", 429);
      const now = new Date();
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
      const monthlyUsed = await this.jobs.countSince(device.id, monthStart);
      if (monthlyUsed >= this.maxJobsPerMonth) {
        throw new AppError("monthly_budget_exceeded", "本月候选分析额度已用完", 429);
      }
    }

    const budgetNow = new Date();
    const creation = existing && !evaluation ? ({ status: "existing", job: existing } as const) : await this.jobs.createWithinBudget({
      deviceId: device.id,
      candidateToken: input.candidateToken,
      capturedAtBucket: input.capturedAtBucket,
      localLabels: input.localLabels,
      qualityScore: input.qualityScore,
      sensitiveFlags: input.sensitiveFlags,
      contentType: input.contentType,
      objectKey: null,
      uploadSessionId: null,
      uploadExpiresAt: null,
      uploadClaimedAt: null,
      processingClaimToken: null,
      processingLeaseExpiresAt: null,
      status: "awaiting_upload",
      errorCode: null
    }, {
      deviceDailyLimit: this.maxJobsPerDay,
      deviceMonthlyLimit: this.maxJobsPerMonth,
      globalDailyLimit: this.maxJobsGlobalPerDay,
      globalMonthlyLimit: this.maxJobsGlobalPerMonth,
      reservedCostMicroCny: this.worstCaseCostMicroCnyPerJob,
      globalDailyCostMicroCnyLimit: this.maxGlobalCostMicroCnyPerDay,
      globalMonthlyCostMicroCnyLimit: this.maxGlobalCostMicroCnyPerMonth,
      dailySince: new Date(budgetNow.getTime() - 24 * 60 * 60 * 1000).toISOString(),
      monthSince: new Date(Date.UTC(budgetNow.getUTCFullYear(), budgetNow.getUTCMonth(), 1)).toISOString()
    }, evaluation);
    if (creation.status === "device_daily_exceeded") {
      throw new AppError("daily_budget_exceeded", "Daily candidate analysis budget is exhausted", 429);
    }
    if (creation.status === "device_monthly_exceeded") {
      throw new AppError("monthly_budget_exceeded", "Monthly candidate analysis budget is exhausted", 429);
    }
    if (creation.status === "global_daily_exceeded") {
      throw new AppError("global_daily_budget_exceeded", "Service daily analysis budget is exhausted", 429);
    }
    if (creation.status === "global_monthly_exceeded") {
      throw new AppError("global_monthly_budget_exceeded", "Service monthly analysis budget is exhausted", 429);
    }
    if (creation.status === "global_daily_cost_exceeded") {
      throw new AppError("global_daily_cost_budget_exceeded", "Service daily model-cost budget is exhausted", 429);
    }
    if (creation.status === "global_monthly_cost_exceeded") {
      throw new AppError("global_monthly_cost_budget_exceeded", "Service monthly model-cost budget is exhausted", 429);
    }
    if (creation.status === "evaluation_lease_invalid") {
      throw new AppError("evaluation_lease_invalid", "Evaluation lease or bound run is invalid", 401);
    }
    if (creation.status === "evaluation_lease_expired") {
      throw new AppError("evaluation_lease_expired", "Evaluation lease has expired", 410);
    }
    if (creation.status === "evaluation_lease_revoked") {
      throw new AppError("evaluation_lease_revoked", "Evaluation lease has been revoked", 410);
    }
    if (creation.status === "evaluation_device_mismatch") {
      throw new AppError("evaluation_device_mismatch", "Evaluation lease is bound to another device", 403);
    }
    if (creation.status === "evaluation_sample_invalid") {
      throw new AppError("evaluation_sample_invalid", "Evaluation sample is not in the authorized lease", 403);
    }
    if (creation.status === "evaluation_sample_conflict") {
      throw new AppError("evaluation_sample_conflict", "Evaluation sample is already bound to another job", 409);
    }
    const job = creation.job;
    if (job.status === "completed" || job.status === "needs_content" || job.status === "rejected") {
      return { job, uploadUrl: "", expiresAt: job.updatedAt };
    }
    if (job.status === "processing") {
      throw new AppError("candidate_in_progress", "Candidate analysis is in progress", 409);
    }
    if (job.status === "uploading") {
      throw new AppError("upload_in_progress", "Candidate image upload is in progress", 409);
    }
    if (job.status === "uploaded") {
      return { job, uploadUrl: "", expiresAt: job.updatedAt };
    }
    if (
      job.status === "awaiting_upload" &&
      job.uploadSessionId &&
      job.uploadExpiresAt &&
      !job.uploadClaimedAt &&
      Date.parse(job.uploadExpiresAt) > Date.now()
    ) {
      return {
        job,
        uploadUrl: this.uploadUrl(job.uploadSessionId),
        expiresAt: job.uploadExpiresAt
      };
    }
    // Re-check on every new upload target so an operator cannot weaken the OSS lifecycle
    // after process startup and silently extend photo retention.
    await this.objects.verifyRetentionPolicy();
    const uploadSessionId = randomUUID();
    const objectKey = await this.objects.createObjectKey(job.id, uploadSessionId);
    const uploadExpiresAt = new Date(Date.now() + UPLOAD_SESSION_TTL_MS).toISOString();
    const updated = await this.jobs.prepareUpload(job.id, job.uploadSessionId, {
      objectKey,
      uploadSessionId,
      uploadExpiresAt
    });
    if (!updated) {
      const current = await this.jobs.findById(job.id);
      if (
        current?.status === "awaiting_upload" &&
        current.uploadSessionId &&
        current.uploadExpiresAt &&
        !current.uploadClaimedAt &&
        Date.parse(current.uploadExpiresAt) > Date.now()
      ) {
        return {
          job: current,
          uploadUrl: this.uploadUrl(current.uploadSessionId),
          expiresAt: current.uploadExpiresAt
        };
      }
      throw new AppError("upload_target_conflict", "上传会话已被其他请求更新", 409);
    }
    return { job: updated, uploadUrl: this.uploadUrl(uploadSessionId), expiresAt: uploadExpiresAt };
  }

  async recordUpload(device: Device, uploadSessionId: string, body: Buffer, contentType: string): Promise<AnalysisJob> {
    invariant(contentType === "image/jpeg", "invalid_image_content", "上传格式与任务声明不一致", 415);
    invariant(body.length >= 32 && body.length <= 3 * 1024 * 1024, "invalid_image_size", "图片必须介于 32 字节和 3 MB 之间", 413);
    invariant(matchesImageSignature(body, contentType), "invalid_image_content", "图片内容与声明格式不匹配", 415);
    const job = await this.jobs.claimForUpload(uploadSessionId, device.id, new Date().toISOString());
    if (!job) throw new AppError("upload_session_unavailable", "上传会话已使用、已过期或已失效", 409);
    invariant(job.objectKey, "missing_object_key", "任务缺少对象键", 500);
    try {
      if (await this.jobs.isCandidateSuppressed(device.id, job.candidateToken)) {
        throw new AppError("candidate_suppressed", "该候选已被当前匿名设备排除", 410);
      }
      await this.objects.put(job.objectKey, body, contentType);
      const uploaded = await this.jobs.finishUpload(job.id, uploadSessionId, null);
      if (!uploaded) {
        await this.deleteOrQueueObject(job.objectKey);
        throw new AppError("upload_claim_lost", "上传会话已失效", 409);
      }
      return uploaded;
    } catch (error) {
      await this.jobs.finishUpload(
        job.id,
        uploadSessionId,
        error instanceof AppError ? error.code : "object_upload_failed"
      ).catch(() => null);
      await this.deleteOrQueueObject(job.objectKey);
      throw error;
    }
  }

  async complete(
    device: Device,
    jobId: string,
    visionOverride?: VisionProvider
  ): Promise<{ job: AnalysisJob; card: KnowledgeCard | null }> {
    const job = await this.requireOwnedJob(device, jobId);
    if (await this.jobs.isCandidateSuppressed(device.id, job.candidateToken)) {
      throw new AppError("candidate_suppressed", "该候选已被当前匿名设备排除", 410);
    }
    invariant(job.status === "uploaded", "invalid_job_state", "只有已上传任务可以开始分析", 409);
    invariant(job.objectKey, "missing_object_key", "任务缺少对象键", 500);
    const claimToken = randomUUID();
    const claimed = await this.jobs.claimForProcessing(
      job.id,
      claimToken,
      new Date(Date.now() + PROCESSING_LEASE_MS).toISOString()
    );
    if (!claimed) throw new AppError("candidate_in_progress", "任务已在处理或已结束", 409);

    let deleteWhenDone = false;
    try {
      // Verify the API-written private object before downloading it so corrupted
      // or oversized storage state fails without loading the whole object.
      const metadata = await this.objects.head(job.objectKey);
      invariant(
        metadata.size >= 32 && metadata.size <= MAX_ANALYSIS_IMAGE_BYTES,
        "invalid_image_size",
        "云端图片必须介于 32 字节和 3 MB 之间",
        413
      );
      invariant(
        metadata.contentType === null || metadata.contentType === job.contentType,
        "invalid_image_content_type",
        "云端图片格式与任务声明不一致",
        415
      );
      const image = await this.objects.get(job.objectKey);
      invariant(
        image.length >= 32 && image.length <= MAX_ANALYSIS_IMAGE_BYTES,
        "invalid_image_size",
        "云端图片必须介于 32 字节和 3 MB 之间",
        413
      );
      invariant(
        matchesImageSignature(image, job.contentType),
        "invalid_image_content",
        "云端图片内容与声明格式不匹配",
        415
      );
      const entity = await (visionOverride ?? this.vision).detect({
        image,
        localLabels: job.localLabels
      });

      if (entity.sensitiveFlags.length > 0) {
        const rejected = await this.finishClaim(
          job.id,
          claimToken,
          "rejected",
          `server_sensitive_${entity.sensitiveFlags[0]}`
        );
        deleteWhenDone = true;
        return { job: rejected, card: null };
      }

      const topic = this.knowledge.findTopic(entity.canonicalTopicId)
        ?? this.knowledge.matchLabels([entity.canonicalTopicId, entity.displayName, ...entity.alternatives]);
      if (!topic || entity.confidence < 0.6) {
        const needsContent = await this.finishClaim(job.id, claimToken, "needs_content", "no_reliable_topic");
        deleteWhenDone = true;
        return { job: needsContent, card: null };
      }

      const recentFactIds = await this.cards.listRecentFactIds(
        device.id,
        topic.topicId,
        RECENT_FACT_LOOKBACK_PER_TOPIC
      );
      const selection = this.knowledge.selectApprovedFact(
        topic,
        job.candidateToken,
        this.allowUnattestedFacts,
        recentFactIds
      );
      if (!selection) {
        const needsContent = await this.finishClaim(job.id, claimToken, "needs_content", "no_approved_fact");
        deleteWhenDone = true;
        return { job: needsContent, card: null };
      }

      // Vision proposes a topic and confidence; the reviewed catalog owns the
      // user-facing identity after a topic match so one card cannot name the
      // same object differently across its title, provenance, and body.
      const canonicalObjectName = topic.displayName;
      const personalContext = personalContextForPhoto(job.capturedAtBucket, canonicalObjectName);
      if (await this.jobs.isCandidateSuppressed(device.id, job.candidateToken)) {
        throw new AppError("candidate_suppressed", "该候选已被当前匿名设备排除", 410);
      }

      const completion = await this.jobs.completeWithCard(job.id, claimToken, {
        deviceId: device.id,
        candidateToken: job.candidateToken,
        topicId: topic.topicId,
        factId: selection.fact.factId,
        title: cardTitleForConfidence(
          composeCardTitle(canonicalObjectName, selection.fact.factId, selection.fact.factText),
          canonicalObjectName,
          entity.confidence
        ),
        detectedObjectName: canonicalObjectName,
        body: selection.fact.factText,
        personalContext,
        confidence: entity.confidence,
        boundingBox: entity.boundingBox,
        sources: selection.sources,
        status: "scheduled"
      }, scheduledDateInChina(new Date(), 0));
      if (!completion) throw new AppError("processing_lease_lost", "分析任务处理租约已失效", 409);
      deleteWhenDone = true;
      return completion;
    } catch (error) {
      const failed = await this.jobs.finishProcessing(
        job.id,
        claimToken,
        "failed",
        error instanceof AppError ? error.code : "analysis_failed"
      ).catch(() => null);
      if (failed) deleteWhenDone = true;
      throw error;
    } finally {
      if (deleteWhenDone) await this.deleteOrQueueObject(job.objectKey);
    }
  }

  private async finishClaim(
    jobId: string,
    claimToken: string,
    status: "needs_content" | "rejected" | "failed",
    errorCode: string | null
  ): Promise<AnalysisJob> {
    const finished = await this.jobs.finishProcessing(jobId, claimToken, status, errorCode);
    if (!finished) throw new AppError("processing_lease_lost", "分析任务处理租约已失效", 409);
    return finished;
  }

  private uploadUrl(uploadSessionId: string): string {
    return `${this.publicBaseUrl}/v1/analysis-jobs/${uploadSessionId}/image`;
  }

  async deleteOrQueueObject(objectKey: string): Promise<boolean> {
    try {
      await this.objects.delete(objectKey);
      await this.objectDeletions.remove(objectKey);
      return true;
    } catch {
      try {
        await this.objectDeletions.enqueue(objectKey);
      } catch {
        // OSS production storage is independently protected by the mandatory
        // <=24-hour lifecycle even if both immediate deletion and its outbox fail.
      }
      return false;
    }
  }

  async retryPendingObjectDeletions(
    limit = 100,
    now = new Date()
  ): Promise<{ attempted: number; deleted: number }> {
    const keys = await this.objectDeletions.list(limit, now.toISOString());
    let deleted = 0;
    for (const key of keys) {
      if (await this.deleteOrQueueObject(key)) deleted += 1;
    }
    return { attempted: keys.length, deleted };
  }

  async requireOwnedJob(device: Device, jobId: string): Promise<AnalysisJob> {
    let job = await this.jobs.findById(jobId);
    if (!job || job.deviceId !== device.id) throw new AppError("job_not_found", "分析任务不存在", 404);
    if (job.status === "uploading") job = await this.recoverStaleUpload(job) ?? job;
    if (job.status === "processing") {
      job = await this.jobs.recoverExpiredProcessing(job.id, new Date().toISOString()) ?? job;
    }
    return job;
  }

  private async recoverStaleUpload(job: AnalysisJob): Promise<AnalysisJob | null> {
    const recovered = await this.jobs.recoverStaleUpload(
      job.id,
      new Date(Date.now() - UPLOAD_CLAIM_LEASE_MS).toISOString()
    );
    if (recovered?.objectKey) await this.deleteOrQueueObject(recovered.objectKey);
    return recovered;
  }
}

export function personalContextForPhoto(capturedAtBucket: string | null, topicDisplayName: string): string {
  const topic = topicDisplayName.trim() || "这个日常物件";
  if (!capturedAtBucket) return `它来自你主动授权的照片，所以今天从「${topic}」讲起。`;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(capturedAtBucket);
  if (!match || !isValidIsoCalendarDate(capturedAtBucket)) {
    return `它来自你主动授权的照片，所以今天从「${topic}」讲起。`;
  }
  const [, year, month, day] = match;
  const numericMonth = Number(month);
  const numericDay = Number(day);
  return `你在 ${year} 年 ${numericMonth} 月 ${numericDay} 日拍下了「${topic}」，所以今天从它讲起。`;
}

export function scheduledDateInChina(now: Date, daysFromToday: number): string {
  if (!Number.isInteger(daysFromToday) || daysFromToday < 0) throw new Error("daysFromToday must be a non-negative integer");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  const calendarDate = new Date(Date.UTC(value("year"), value("month") - 1, value("day") + daysFromToday));
  return calendarDate.toISOString().slice(0, 10);
}

function matchesImageSignature(body: Buffer, contentType: string): boolean {
  if (contentType === "image/jpeg") return body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff;
  if (contentType === "image/png") {
    return body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (contentType === "image/webp") {
    return body.subarray(0, 4).toString("ascii") === "RIFF" && body.subarray(8, 12).toString("ascii") === "WEBP";
  }
  return false;
}
