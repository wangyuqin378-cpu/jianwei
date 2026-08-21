import { randomUUID } from "node:crypto";
import type {
  AnalysisJob,
  AnalysisJobBudget,
  AnalysisJobRepository,
  BudgetedAnalysisJobCreateResult,
  CardFeedback,
  CardRepository,
  Device,
  DeviceRepository,
  EvaluationJobAuthorization,
  EvaluationLeaseDefinition,
  KnowledgeCard,
  ObjectDeletionRepository,
  PrivateCardDeletionResult,
  RegisteredDevice,
  TopicPreference,
  TrackedItem
} from "../domain/types.js";
import { AppError } from "../errors.js";
import { nextAvailableScheduledDate } from "../domain/card-scheduling.js";

export class InMemoryRepositories {
  private readonly devices = new Map<string, Device>();
  private readonly jobs = new Map<string, AnalysisJob>();
  private readonly cards = new Map<string, KnowledgeCard>();
  private readonly feedback = new Map<string, CardFeedback>();
  private readonly feedbackAffinityContributions = new Map<string, number>();
  private readonly preferences = new Map<string, TopicPreference>();
  private readonly tracked = new Map<string, TrackedItem>();
  private readonly suppressedCandidates = new Set<string>();
  private readonly pendingObjectDeletions = new Map<string, {
    attempts: number;
    createdAt: number;
    nextAttemptAt: number;
  }>();
  private readonly privacyDeletionReceipts = new Map<string, PrivateCardDeletionResult>();
  private readonly evaluationJobIds = new Set<string>();
  private readonly evaluationLeases = new Map<string, {
    definition: EvaluationLeaseDefinition;
    revokedAt: string | null;
    boundDeviceId: string | null;
    consumedJobs: Map<string, string>;
  }>();
  // Aggregate reservations deliberately survive device-data deletion so the global
  // cost fuse cannot be reset by reinstalling. They contain no device/photo IDs.
  private readonly analysisBudgetEvents: Array<{ createdAt: string; reservedCostMicroCny: number }> = [];

  async register(installationHash: string, tokenHash: string): Promise<RegisteredDevice> {
    const existing = [...this.devices.values()].find((device) => device.installationHash === installationHash);
    if (existing) {
      const rotated = { ...existing, tokenHash };
      this.devices.set(existing.id, rotated);
      return { ...rotated, created: false };
    }
    const device: Device = { id: randomUUID(), installationHash, tokenHash, createdAt: new Date().toISOString() };
    this.devices.set(device.id, device);
    return { ...device, created: true };
  }

  async findByTokenHash(tokenHash: string): Promise<Device | null> {
    return [...this.devices.values()].find((device) => device.tokenHash === tokenHash) ?? null;
  }

  async deleteCascade(deviceId: string): Promise<void> {
    const now = new Date().toISOString();
    for (const lease of this.evaluationLeases.values()) {
      if (lease.boundDeviceId === deviceId) lease.revokedAt = now;
    }
    this.devices.delete(deviceId);
    for (const [id, job] of this.jobs) {
      if (job.deviceId === deviceId) {
        this.jobs.delete(id);
        this.evaluationJobIds.delete(id);
      }
    }
    for (const [id, card] of this.cards) if (card.deviceId === deviceId) this.cards.delete(id);
    for (const [id, item] of this.feedback) {
      if (item.deviceId === deviceId) {
        this.feedback.delete(id);
        this.feedbackAffinityContributions.delete(id);
      }
    }
    for (const [key, item] of this.preferences) if (item.deviceId === deviceId) this.preferences.delete(key);
    for (const [id, item] of this.tracked) if (item.deviceId === deviceId) this.tracked.delete(id);
    for (const key of this.suppressedCandidates) {
      if (key.startsWith(`${deviceId}:`)) this.suppressedCandidates.delete(key);
    }
    for (const key of this.privacyDeletionReceipts.keys()) {
      if (key.startsWith(`${deviceId}:`)) this.privacyDeletionReceipts.delete(key);
    }
  }

  async createJobWithinBudget(
    input: Omit<AnalysisJob, "id" | "createdAt" | "updatedAt">,
    budget: AnalysisJobBudget,
    evaluation?: EvaluationJobAuthorization
  ): Promise<BudgetedAnalysisJobCreateResult> {
    const existing = [...this.jobs.values()].find(
      (job) => job.deviceId === input.deviceId && job.candidateToken === input.candidateToken
    );
    let lease: (typeof this.evaluationLeases extends Map<string, infer T> ? T : never) | null = null;
    if (evaluation) {
      lease = [...this.evaluationLeases.values()].find(
        (item) => item.definition.tokenHash === evaluation.tokenHash
      ) ?? null;
      if (!lease || lease.definition.datasetId !== evaluation.datasetId ||
          lease.definition.runId !== evaluation.runId || lease.definition.labelsSha256 !== evaluation.labelsSha256) {
        return { status: "evaluation_lease_invalid" };
      }
      if (lease.revokedAt) return { status: "evaluation_lease_revoked" };
      if (Date.parse(lease.definition.expiresAt) <= Date.parse(evaluation.now)) {
        return { status: "evaluation_lease_expired" };
      }
      const allowed = lease.definition.samples.find((sample) => sample.sampleId === evaluation.sampleId);
      if (!allowed || allowed.candidateToken !== input.candidateToken) return { status: "evaluation_sample_invalid" };
      const consumedJobId = lease.consumedJobs.get(evaluation.sampleId);
      if (consumedJobId) {
        const consumed = this.jobs.get(consumedJobId);
        return consumed && consumed.deviceId === input.deviceId && consumed.candidateToken === input.candidateToken
          ? { status: "existing", job: consumed }
          : { status: "evaluation_sample_conflict" };
      }
      if (existing) return { status: "evaluation_sample_conflict" };
      if (lease.boundDeviceId && lease.boundDeviceId !== input.deviceId) {
        return { status: "evaluation_device_mismatch" };
      }
      lease.boundDeviceId = input.deviceId;
    } else if (existing) {
      return { status: "existing", job: existing };
    }
    const jobs = [...this.jobs.values()];
    const ordinaryJobs = jobs.filter((job) => !this.evaluationJobIds.has(job.id));
    const dailySince = Date.parse(budget.dailySince);
    const monthSince = Date.parse(budget.monthSince);
    if (!evaluation) {
      const deviceDaily = ordinaryJobs.filter(
        (job) => job.deviceId === input.deviceId && Date.parse(job.createdAt) >= dailySince
      ).length;
      if (deviceDaily >= budget.deviceDailyLimit) return { status: "device_daily_exceeded" };
      const deviceMonthly = ordinaryJobs.filter(
        (job) => job.deviceId === input.deviceId && Date.parse(job.createdAt) >= monthSince
      ).length;
      if (deviceMonthly >= budget.deviceMonthlyLimit) return { status: "device_monthly_exceeded" };
    }
    const dailyEvents = this.analysisBudgetEvents.filter((event) => Date.parse(event.createdAt) >= dailySince);
    const globalDaily = dailyEvents.length;
    if (globalDaily >= budget.globalDailyLimit) return { status: "global_daily_exceeded" };
    const monthlyEvents = this.analysisBudgetEvents.filter((event) => Date.parse(event.createdAt) >= monthSince);
    const globalMonthly = monthlyEvents.length;
    if (globalMonthly >= budget.globalMonthlyLimit) return { status: "global_monthly_exceeded" };
    const dailyCost = dailyEvents.reduce((sum, event) => sum + event.reservedCostMicroCny, 0);
    if (dailyCost + budget.reservedCostMicroCny > budget.globalDailyCostMicroCnyLimit) {
      return { status: "global_daily_cost_exceeded" };
    }
    const monthlyCost = monthlyEvents.reduce((sum, event) => sum + event.reservedCostMicroCny, 0);
    if (monthlyCost + budget.reservedCostMicroCny > budget.globalMonthlyCostMicroCnyLimit) {
      return { status: "global_monthly_cost_exceeded" };
    }
    const now = new Date().toISOString();
    const job: AnalysisJob = { ...input, id: randomUUID(), createdAt: now, updatedAt: now };
    this.jobs.set(job.id, job);
    if (evaluation && lease) {
      lease.consumedJobs.set(evaluation.sampleId, job.id);
      this.evaluationJobIds.add(job.id);
    }
    this.analysisBudgetEvents.push({ createdAt: now, reservedCostMicroCny: budget.reservedCostMicroCny });
    return { status: "created", job };
  }

  async createEvaluationLease(input: EvaluationLeaseDefinition): Promise<void> {
    if ([...this.evaluationLeases.values()].some((lease) =>
      lease.definition.id === input.id || lease.definition.tokenHash === input.tokenHash || lease.definition.runId === input.runId
    )) throw new AppError("evaluation_lease_conflict", "Evaluation lease already exists", 409);
    this.evaluationLeases.set(input.id, {
      definition: structuredClone(input),
      revokedAt: null,
      boundDeviceId: null,
      consumedJobs: new Map()
    });
  }

  async revokeEvaluationLease(id: string, revokedAt: string): Promise<boolean> {
    const lease = this.evaluationLeases.get(id);
    if (!lease) return false;
    lease.revokedAt = lease.revokedAt ?? revokedAt;
    return true;
  }

  async findById(id: string): Promise<AnalysisJob | null> {
    return this.jobs.get(id) ?? null;
  }

  async findByCandidateToken(deviceId: string, candidateToken: string): Promise<AnalysisJob | null> {
    return [...this.jobs.values()].find(
      (job) => job.deviceId === deviceId && job.candidateToken === candidateToken
    ) ?? null;
  }

  async prepareUpload(
    id: string,
    expectedSessionId: string | null,
    input: { objectKey: string; uploadSessionId: string; uploadExpiresAt: string }
  ): Promise<AnalysisJob | null> {
    const current = this.jobs.get(id);
    if (!current || !["awaiting_upload", "failed"].includes(current.status)) return null;
    if (current.uploadSessionId !== expectedSessionId) return null;
    const updated: AnalysisJob = {
      ...current,
      ...input,
      uploadClaimedAt: null,
      processingClaimToken: null,
      processingLeaseExpiresAt: null,
      status: "awaiting_upload",
      errorCode: null,
      updatedAt: new Date().toISOString()
    };
    this.jobs.set(id, updated);
    return updated;
  }

  async claimForUpload(uploadSessionId: string, deviceId: string, nowIso: string): Promise<AnalysisJob | null> {
    const current = [...this.jobs.values()].find((job) => job.uploadSessionId === uploadSessionId);
    if (!current || current.deviceId !== deviceId || current.status !== "awaiting_upload") return null;
    if (current.uploadClaimedAt || !current.uploadExpiresAt || current.uploadExpiresAt <= nowIso) return null;
    const updated: AnalysisJob = {
      ...current,
      status: "uploading",
      uploadClaimedAt: nowIso,
      updatedAt: new Date().toISOString()
    };
    this.jobs.set(current.id, updated);
    return updated;
  }

  async finishUpload(id: string, uploadSessionId: string, errorCode: string | null): Promise<AnalysisJob | null> {
    const current = this.jobs.get(id);
    if (!current || current.uploadSessionId !== uploadSessionId || current.status !== "uploading") return null;
    const updated: AnalysisJob = {
      ...current,
      status: errorCode === null ? "uploaded" : "failed",
      errorCode,
      updatedAt: new Date().toISOString()
    };
    this.jobs.set(id, updated);
    return updated;
  }

  async recoverStaleUpload(id: string, staleBeforeIso: string): Promise<AnalysisJob | null> {
    const current = this.jobs.get(id);
    if (!current || current.status !== "uploading" || !current.uploadClaimedAt) return null;
    if (current.uploadClaimedAt > staleBeforeIso) return null;
    const updated: AnalysisJob = {
      ...current,
      status: "failed",
      uploadClaimedAt: null,
      errorCode: "upload_lease_recovered",
      updatedAt: new Date().toISOString()
    };
    this.jobs.set(id, updated);
    return updated;
  }

  async recoverExpiredProcessing(id: string, nowIso: string): Promise<AnalysisJob | null> {
    const current = this.jobs.get(id);
    if (!current || current.status !== "processing" || !current.processingLeaseExpiresAt) return null;
    if (current.processingLeaseExpiresAt > nowIso) return null;
    const updated: AnalysisJob = {
      ...current,
      status: "uploaded",
      processingClaimToken: null,
      processingLeaseExpiresAt: null,
      errorCode: "processing_lease_recovered",
      updatedAt: new Date().toISOString()
    };
    this.jobs.set(id, updated);
    return updated;
  }

  async claimForProcessing(id: string, claimToken: string, leaseExpiresAt: string): Promise<AnalysisJob | null> {
    const current = this.jobs.get(id);
    if (!current || current.status !== "uploaded") return null;
    const updated: AnalysisJob = {
      ...current,
      status: "processing",
      processingClaimToken: claimToken,
      processingLeaseExpiresAt: leaseExpiresAt,
      errorCode: null,
      updatedAt: new Date().toISOString()
    };
    this.jobs.set(id, updated);
    return updated;
  }

  async finishProcessing(
    id: string,
    claimToken: string,
    status: "needs_content" | "rejected" | "failed",
    errorCode: string | null
  ): Promise<AnalysisJob | null> {
    const current = this.jobs.get(id);
    if (!isActiveProcessingClaim(current, claimToken)) return null;
    const updated: AnalysisJob = {
      ...current,
      status,
      errorCode,
      processingClaimToken: null,
      processingLeaseExpiresAt: null,
      updatedAt: new Date().toISOString()
    };
    this.jobs.set(id, updated);
    return updated;
  }

  async completeWithCard(
    id: string,
    claimToken: string,
    card: Omit<KnowledgeCard, "cardId" | "createdAt" | "scheduledDate">,
    scheduleNotBefore: string
  ): Promise<{ job: AnalysisJob; card: KnowledgeCard } | null> {
    const current = this.jobs.get(id);
    if (!isActiveProcessingClaim(current, claimToken)) return null;
    if (!this.devices.has(current.deviceId)) throw new AppError("device_deleted", "设备数据已删除", 410);
    const existing = [...this.cards.values()].find(
      (item) => item.deviceId === current.deviceId && item.candidateToken === current.candidateToken
    );
    const created = existing ?? (() => {
      const scheduledDate = nextAvailableScheduledDate(
        scheduleNotBefore,
        [...this.cards.values()]
          .filter((item) => item.deviceId === current.deviceId && item.status === "scheduled")
          .map((item) => item.scheduledDate)
      );
      return {
        ...card,
        deviceId: current.deviceId,
        candidateToken: current.candidateToken,
        scheduledDate,
        cardId: randomUUID(),
        createdAt: new Date().toISOString()
      };
    })();
    if (!existing) this.cards.set(created.cardId, created);
    const completed: AnalysisJob = {
      ...current,
      status: "completed",
      errorCode: null,
      processingClaimToken: null,
      processingLeaseExpiresAt: null,
      updatedAt: new Date().toISOString()
    };
    this.jobs.set(id, completed);
    return { job: completed, card: created };
  }

  async countSince(deviceId: string, sinceIso: string): Promise<number> {
    const since = Date.parse(sinceIso);
    return [...this.jobs.values()].filter((job) =>
      job.deviceId === deviceId && !this.evaluationJobIds.has(job.id) && Date.parse(job.createdAt) >= since
    ).length;
  }

  async listObjectKeys(deviceId: string): Promise<string[]> {
    return [...this.jobs.values()]
      .filter((job) => job.deviceId === deviceId && job.objectKey)
      .map((job) => job.objectKey as string);
  }

  async deleteJobByCandidateToken(deviceId: string, candidateToken: string): Promise<void> {
    for (const [id, job] of this.jobs) {
      if (job.deviceId === deviceId && job.candidateToken === candidateToken) {
        this.jobs.delete(id);
        this.evaluationJobIds.delete(id);
      }
    }
  }

  async suppressCandidate(deviceId: string, candidateToken: string): Promise<void> {
    this.suppressedCandidates.add(`${deviceId}:${candidateToken}`);
  }

  async isCandidateSuppressed(deviceId: string, candidateToken: string): Promise<boolean> {
    return this.suppressedCandidates.has(`${deviceId}:${candidateToken}`);
  }

  async createCard(card: Omit<KnowledgeCard, "cardId" | "createdAt">): Promise<KnowledgeCard> {
    if (!this.devices.has(card.deviceId)) throw new AppError("device_deleted", "设备数据已删除", 410);
    const created: KnowledgeCard = { ...card, cardId: randomUUID(), createdAt: new Date().toISOString() };
    this.cards.set(created.cardId, created);
    return created;
  }

  async findCardById(cardId: string): Promise<KnowledgeCard | null> {
    return this.cards.get(cardId) ?? null;
  }

  async list(deviceId: string, cursor: string | null, limit: number): Promise<{ items: KnowledgeCard[]; nextCursor: string | null }> {
    const sorted = [...this.cards.values()]
      .filter((card) => card.deviceId === deviceId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.cardId.localeCompare(b.cardId));
    const cursorIndex = cursor ? sorted.findIndex((card) => card.cardId === cursor) : -1;
    if (cursor && cursorIndex < 0) throw new AppError("invalid_cursor", "卡片游标无效", 400);
    const start = cursor ? cursorIndex + 1 : 0;
    const items = sorted.slice(start, start + limit);
    const nextCursor = start + limit < sorted.length ? items.at(-1)?.cardId ?? null : null;
    return { items, nextCursor };
  }

  async listRecentFactIds(deviceId: string, topicId: string, limit: number): Promise<string[]> {
    if (limit <= 0) return [];
    return [...this.cards.values()]
      .filter((card) => card.deviceId === deviceId && card.topicId === topicId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.cardId.localeCompare(left.cardId))
      .slice(0, limit)
      .map((card) => card.factId);
  }

  async addFeedback(input: Omit<CardFeedback, "id" | "createdAt"> & { topicId: string }) {
    const cardFeedback = [...this.feedback.values()].filter(
      (item) => item.deviceId === input.deviceId && item.cardId === input.cardId
    );
    const terminalWrongObject = cardFeedback.find((item) => item.action === "WRONG_OBJECT");
    const key = `${input.deviceId}:${input.topicId}`;
    const current = this.preferences.get(key);
    if (terminalWrongObject && input.action !== "WRONG_OBJECT") {
      const preference: TopicPreference = current ?? {
        deviceId: input.deviceId,
        topicId: input.topicId,
        weight: 0,
        updatedAt: terminalWrongObject.createdAt
      };
      this.preferences.set(key, preference);
      return { feedback: terminalWrongObject, preference };
    }
    const existing = [...this.feedback.values()].find(
      (item) => item.deviceId === input.deviceId && item.cardId === input.cardId && item.action === input.action
    );
    const now = new Date().toISOString();
    const item: CardFeedback = existing ?? {
      deviceId: input.deviceId,
      cardId: input.cardId,
      action: input.action,
      id: randomUUID(),
      createdAt: now
    };
    const priorInterestDelta = input.action === "WRONG_OBJECT" && !existing
      ? cardFeedback
          .filter((feedback) => feedback.action === "LIKE" || feedback.action === "DISLIKE" || feedback.action === "SAVE")
          .reduce(
            (total, feedback) => total + (this.feedbackAffinityContributions.get(feedback.id) ?? 0),
            0
          )
      : 0;
    const currentWeight = current?.weight ?? 0;
    const requestedDelta = feedbackWeightDelta(input.action);
    const appliedDelta = input.action === "WRONG_OBJECT"
      ? 0
      : clampPreference(currentWeight + requestedDelta) - currentWeight;
    if (!existing) {
      this.feedback.set(item.id, item);
      this.feedbackAffinityContributions.set(item.id, appliedDelta);
    }
    const delta = existing ? 0 : appliedDelta - priorInterestDelta;
    const weight = clampPreference(currentWeight + delta);
    const preference: TopicPreference = {
      deviceId: input.deviceId,
      topicId: input.topicId,
      weight,
      updatedAt: existing && current ? current.updatedAt : now
    };
    this.preferences.set(key, preference);
    if (input.action === "WRONG_OBJECT") {
      const card = this.cards.get(input.cardId);
      if (card?.deviceId === input.deviceId) this.cards.set(input.cardId, { ...card, status: "archived" });
    }
    return { feedback: item, preference };
  }

  async listPreferences(deviceId: string): Promise<TopicPreference[]> {
    return [...this.preferences.values()]
      .filter((item) => item.deviceId === deviceId)
      .sort((left, right) => right.weight - left.weight || left.topicId.localeCompare(right.topicId));
  }

  async deleteTooPrivate(deviceId: string, cardId: string): Promise<PrivateCardDeletionResult | null> {
    const receiptKey = `${deviceId}:${cardId}`;
    const existing = this.privacyDeletionReceipts.get(receiptKey);
    if (existing) return { ...existing, objectKey: null, alreadyDeleted: true };
    const card = this.cards.get(cardId);
    if (!card || card.deviceId !== deviceId) return null;

    const now = new Date().toISOString();
    const preferenceKey = `${deviceId}:${card.topicId}`;
    const current = this.preferences.get(preferenceKey);
    const preference: TopicPreference = {
      deviceId,
      topicId: card.topicId,
      weight: clampPreference((current?.weight ?? 0) + feedbackWeightDelta("TOO_PRIVATE")),
      updatedAt: now
    };
    const feedback: CardFeedback = {
      id: randomUUID(),
      deviceId,
      cardId,
      action: "TOO_PRIVATE",
      createdAt: now
    };
    const job = [...this.jobs.values()].find(
      (item) => item.deviceId === deviceId && item.candidateToken === card.candidateToken
    );
    const result: PrivateCardDeletionResult = {
      feedback,
      preference,
      objectKey: job?.objectKey ?? null,
      alreadyDeleted: false
    };

    this.preferences.set(preferenceKey, preference);
    this.privacyDeletionReceipts.set(receiptKey, result);
    this.suppressedCandidates.add(`${deviceId}:${card.candidateToken}`);
    if (job?.objectKey) this.enqueueObjectDeletion(job.objectKey);
    await this.deleteCardById(cardId, deviceId);
    if (job) {
      this.jobs.delete(job.id);
      this.evaluationJobIds.delete(job.id);
    }
    return result;
  }

  async track(input: Omit<TrackedItem, "id" | "createdAt">): Promise<TrackedItem> {
    const existing = [...this.tracked.values()].find(
      (item) => item.deviceId === input.deviceId && item.cardId === input.cardId
    );
    if (existing) {
      const updated = { ...existing, startedOn: input.startedOn, reminderDays: input.reminderDays };
      this.tracked.set(existing.id, updated);
      return updated;
    }
    const item: TrackedItem = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    this.tracked.set(item.id, item);
    return item;
  }

  async untrack(cardId: string, deviceId: string): Promise<void> {
    for (const [id, item] of this.tracked) {
      if (item.cardId === cardId && item.deviceId === deviceId) this.tracked.delete(id);
    }
  }

  async deleteCardById(cardId: string, deviceId: string): Promise<void> {
    const card = this.cards.get(cardId);
    if (card?.deviceId !== deviceId) return;
    this.cards.delete(cardId);
    for (const [id, item] of this.feedback) {
      if (item.cardId === cardId) {
        this.feedback.delete(id);
        this.feedbackAffinityContributions.delete(id);
      }
    }
    for (const [id, item] of this.tracked) if (item.cardId === cardId) this.tracked.delete(id);
  }

  // Explicit adapters avoid overloaded method names when one class implements several repository contracts.
  readonly devicesRepository: DeviceRepository = {
    register: (installationHash, tokenHash) => this.register(installationHash, tokenHash),
    findByTokenHash: (tokenHash) => this.findByTokenHash(tokenHash),
    deleteCascade: (deviceId) => this.deleteCascade(deviceId)
  };

  readonly jobsRepository: AnalysisJobRepository = {
    createWithinBudget: (input, budget, evaluation) => this.createJobWithinBudget(input, budget, evaluation),
    createEvaluationLease: (input) => this.createEvaluationLease(input),
    revokeEvaluationLease: (id, revokedAt) => this.revokeEvaluationLease(id, revokedAt),
    findById: (id) => this.findById(id),
    findByCandidateToken: (deviceId, candidateToken) => this.findByCandidateToken(deviceId, candidateToken),
    prepareUpload: (id, expectedSessionId, input) => this.prepareUpload(id, expectedSessionId, input),
    claimForUpload: (uploadSessionId, deviceId, nowIso) => this.claimForUpload(uploadSessionId, deviceId, nowIso),
    finishUpload: (id, uploadSessionId, errorCode) => this.finishUpload(id, uploadSessionId, errorCode),
    recoverStaleUpload: (id, staleBeforeIso) => this.recoverStaleUpload(id, staleBeforeIso),
    recoverExpiredProcessing: (id, nowIso) => this.recoverExpiredProcessing(id, nowIso),
    claimForProcessing: (id, claimToken, leaseExpiresAt) => this.claimForProcessing(id, claimToken, leaseExpiresAt),
    finishProcessing: (id, claimToken, status, errorCode) => this.finishProcessing(id, claimToken, status, errorCode),
    completeWithCard: (id, claimToken, card, scheduleNotBefore) =>
      this.completeWithCard(id, claimToken, card, scheduleNotBefore),
    countSince: (deviceId, sinceIso) => this.countSince(deviceId, sinceIso),
    listObjectKeys: (deviceId) => this.listObjectKeys(deviceId),
    deleteByCandidateToken: (deviceId, candidateToken) => this.deleteJobByCandidateToken(deviceId, candidateToken),
    suppressCandidate: (deviceId, candidateToken) => this.suppressCandidate(deviceId, candidateToken),
    isCandidateSuppressed: (deviceId, candidateToken) => this.isCandidateSuppressed(deviceId, candidateToken)
  };

  readonly cardsRepository: CardRepository = {
    create: (card) => this.createCard(card),
    findById: (cardId) => this.findCardById(cardId),
    list: (deviceId, cursor, limit) => this.list(deviceId, cursor, limit),
    listRecentFactIds: (deviceId, topicId, limit) => this.listRecentFactIds(deviceId, topicId, limit),
    addFeedback: (input) => this.addFeedback(input),
    deleteTooPrivate: (deviceId, cardId) => this.deleteTooPrivate(deviceId, cardId),
    listPreferences: (deviceId) => this.listPreferences(deviceId),
    track: (input) => this.track(input),
    untrack: (cardId, deviceId) => this.untrack(cardId, deviceId),
    deleteById: (cardId, deviceId) => this.deleteCardById(cardId, deviceId)
  };

  readonly objectDeletionsRepository: ObjectDeletionRepository = {
    enqueue: async (objectKey) => {
      this.enqueueObjectDeletion(objectKey);
    },
    list: async (limit, nowIso = new Date().toISOString()) => {
      const now = Date.parse(nowIso);
      return [...this.pendingObjectDeletions.entries()]
        .filter(([, item]) => item.nextAttemptAt <= now)
        .sort((left, right) =>
          left[1].nextAttemptAt - right[1].nextAttemptAt ||
          left[1].createdAt - right[1].createdAt ||
          left[0].localeCompare(right[0]))
        .slice(0, limit)
        .map(([objectKey]) => objectKey);
    },
    remove: async (objectKey) => {
      this.pendingObjectDeletions.delete(objectKey);
    }
  };

  private enqueueObjectDeletion(objectKey: string): void {
    const now = Date.now();
    const existing = this.pendingObjectDeletions.get(objectKey);
    if (!existing) {
      this.pendingObjectDeletions.set(objectKey, { attempts: 1, createdAt: now, nextAttemptAt: now });
      return;
    }
    const attempts = existing.attempts + 1;
    this.pendingObjectDeletions.set(objectKey, {
      attempts,
      createdAt: existing.createdAt,
      nextAttemptAt: now + objectDeletionRetryDelayMs(attempts)
    });
  }
}

function isActiveProcessingClaim(job: AnalysisJob | undefined, claimToken: string): job is AnalysisJob {
  return Boolean(
    job &&
    job.status === "processing" &&
    job.processingClaimToken === claimToken &&
    job.processingLeaseExpiresAt &&
    Date.parse(job.processingLeaseExpiresAt) > Date.now()
  );
}

function objectDeletionRetryDelayMs(attempts: number): number {
  return Math.min(64, 2 ** Math.max(0, attempts - 2)) * 60 * 1000;
}

function feedbackWeightDelta(action: CardFeedback["action"]): number {
  switch (action) {
    case "LIKE": return 4;
    case "SAVE": return 5;
    case "DISLIKE": return -4;
    case "WRONG_OBJECT": return 0;
    case "TOO_PRIVATE": return -8;
  }
}

function clampPreference(value: number): number {
  return Math.max(-20, Math.min(20, value));
}
