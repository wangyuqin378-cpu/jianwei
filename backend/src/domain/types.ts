export type FeedbackAction = "LIKE" | "DISLIKE" | "WRONG_OBJECT" | "TOO_PRIVATE" | "SAVE";
export type JobStatus = "awaiting_upload" | "uploading" | "uploaded" | "processing" | "completed" | "needs_content" | "rejected" | "failed";
export type RiskLevel = "general" | "health" | "safety";

export interface Device {
  id: string;
  installationHash: string;
  tokenHash: string;
  createdAt: string;
}

export interface RegisteredDevice extends Device {
  created: boolean;
}

export interface AnalysisJob {
  id: string;
  deviceId: string;
  candidateToken: string;
  capturedAtBucket: string | null;
  localLabels: string[];
  qualityScore: number;
  sensitiveFlags: string[];
  contentType: "image/jpeg";
  objectKey: string | null;
  uploadSessionId: string | null;
  uploadExpiresAt: string | null;
  uploadClaimedAt: string | null;
  processingClaimToken: string | null;
  processingLeaseExpiresAt: string | null;
  status: JobStatus;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DetectedEntity {
  canonicalTopicId: string;
  displayName: string;
  confidence: number;
  boundingBox: BoundingBox | null;
  alternatives: string[];
  sensitiveFlags: Array<"face" | "selfie" | "identity_document" | "bank_card" | "receipt" | "document" | "high_text_density" | "screenshot">;
}

export interface KnowledgeSource {
  sourceId: string;
  title: string;
  url: string;
  publisher: string;
  authority: "reference" | "official" | "professional";
}

export interface KnowledgeFact {
  factId: string;
  topicId: string;
  factText: string;
  sourceIds: string[];
  riskLevel: RiskLevel;
  reviewStatus: "approved" | "draft" | "rejected";
  review?: {
    reviewerId: string;
    reviewedAt: string;
    sourceCheckedAt: string;
    notes?: string;
  };
}

export interface KnowledgeTopic {
  topicId: string;
  displayName: string;
  synonyms: string[];
  category: "home" | "tableware" | "cleaning" | "tool" | "digital" | "transport";
  facts: KnowledgeFact[];
}

export interface KnowledgeCatalog {
  version: string;
  sources: KnowledgeSource[];
  topics: KnowledgeTopic[];
}

export interface KnowledgeCard {
  cardId: string;
  deviceId: string;
  candidateToken: string;
  topicId: string;
  factId: string;
  title: string;
  detectedObjectName: string;
  body: string;
  personalContext: string;
  confidence: number;
  sources: KnowledgeSource[];
  status: "scheduled" | "shown" | "archived";
  scheduledDate: string;
  createdAt: string;
}

export interface CardFeedback {
  id: string;
  deviceId: string;
  cardId: string;
  action: FeedbackAction;
  createdAt: string;
}

export interface TopicPreference {
  deviceId: string;
  topicId: string;
  weight: number;
  updatedAt: string;
}

export interface FeedbackPreferenceResult {
  feedback: CardFeedback;
  preference: TopicPreference;
}

export interface PrivateCardDeletionResult extends FeedbackPreferenceResult {
  objectKey: string | null;
  alreadyDeleted: boolean;
}

export interface TrackedItem {
  id: string;
  deviceId: string;
  cardId: string;
  startedOn: string;
  reminderDays: number;
  createdAt: string;
}

export interface DeviceRepository {
  register(installationHash: string, tokenHash: string): Promise<RegisteredDevice>;
  findByTokenHash(tokenHash: string): Promise<Device | null>;
  deleteCascade(deviceId: string): Promise<void>;
}

export interface AnalysisJobBudget {
  deviceDailyLimit: number;
  deviceMonthlyLimit: number;
  globalDailyLimit: number;
  globalMonthlyLimit: number;
  reservedCostMicroCny: number;
  globalDailyCostMicroCnyLimit: number;
  globalMonthlyCostMicroCnyLimit: number;
  dailySince: string;
  monthSince: string;
}

export interface EvaluationLeaseDefinition {
  id: string;
  tokenHash: string;
  datasetId: string;
  runId: string;
  labelsSha256: string;
  maxJobs: number;
  expiresAt: string;
  samples: Array<{ sampleId: string; candidateToken: string }>;
}

export interface EvaluationJobAuthorization {
  tokenHash: string;
  datasetId: string;
  runId: string;
  labelsSha256: string;
  sampleId: string;
  now: string;
}

export type BudgetedAnalysisJobCreateResult =
  | { status: "created"; job: AnalysisJob }
  | { status: "existing"; job: AnalysisJob }
  | { status: "device_daily_exceeded" }
  | { status: "device_monthly_exceeded" }
  | { status: "global_daily_exceeded" }
  | { status: "global_monthly_exceeded" }
  | { status: "global_daily_cost_exceeded" }
  | { status: "global_monthly_cost_exceeded" }
  | { status: "evaluation_lease_invalid" }
  | { status: "evaluation_lease_expired" }
  | { status: "evaluation_lease_revoked" }
  | { status: "evaluation_device_mismatch" }
  | { status: "evaluation_sample_invalid" }
  | { status: "evaluation_sample_conflict" };

export interface AnalysisJobRepository {
  createWithinBudget(
    input: Omit<AnalysisJob, "id" | "createdAt" | "updatedAt">,
    budget: AnalysisJobBudget,
    evaluation?: EvaluationJobAuthorization
  ): Promise<BudgetedAnalysisJobCreateResult>;
  createEvaluationLease(input: EvaluationLeaseDefinition): Promise<void>;
  revokeEvaluationLease(id: string, revokedAt: string): Promise<boolean>;
  findById(id: string): Promise<AnalysisJob | null>;
  findByCandidateToken(deviceId: string, candidateToken: string): Promise<AnalysisJob | null>;
  prepareUpload(
    id: string,
    expectedSessionId: string | null,
    input: { objectKey: string; uploadSessionId: string; uploadExpiresAt: string }
  ): Promise<AnalysisJob | null>;
  claimForUpload(uploadSessionId: string, deviceId: string, nowIso: string): Promise<AnalysisJob | null>;
  finishUpload(id: string, uploadSessionId: string, errorCode: string | null): Promise<AnalysisJob | null>;
  recoverExpiredProcessing(id: string, nowIso: string): Promise<AnalysisJob | null>;
  claimForProcessing(id: string, claimToken: string, leaseExpiresAt: string): Promise<AnalysisJob | null>;
  finishProcessing(
    id: string,
    claimToken: string,
    status: Extract<JobStatus, "needs_content" | "rejected" | "failed">,
    errorCode: string | null
  ): Promise<AnalysisJob | null>;
  completeWithCard(
    id: string,
    claimToken: string,
    card: Omit<KnowledgeCard, "cardId" | "createdAt" | "scheduledDate">,
    scheduleNotBefore: string
  ): Promise<{ job: AnalysisJob; card: KnowledgeCard } | null>;
  countSince(deviceId: string, sinceIso: string): Promise<number>;
  listObjectKeys(deviceId: string): Promise<string[]>;
  deleteByCandidateToken(deviceId: string, candidateToken: string): Promise<void>;
  suppressCandidate(deviceId: string, candidateToken: string): Promise<void>;
  isCandidateSuppressed(deviceId: string, candidateToken: string): Promise<boolean>;
}

export interface CardRepository {
  create(card: Omit<KnowledgeCard, "cardId" | "createdAt">): Promise<KnowledgeCard>;
  findById(cardId: string): Promise<KnowledgeCard | null>;
  list(deviceId: string, cursor: string | null, limit: number): Promise<{ items: KnowledgeCard[]; nextCursor: string | null }>;
  listRecentFactIds(deviceId: string, topicId: string, limit: number): Promise<string[]>;
  addFeedback(
    input: Omit<CardFeedback, "id" | "createdAt"> & { topicId: string }
  ): Promise<FeedbackPreferenceResult>;
  deleteTooPrivate(deviceId: string, cardId: string): Promise<PrivateCardDeletionResult | null>;
  listPreferences(deviceId: string): Promise<TopicPreference[]>;
  track(input: Omit<TrackedItem, "id" | "createdAt">): Promise<TrackedItem>;
  untrack(cardId: string, deviceId: string): Promise<void>;
  deleteById(cardId: string, deviceId: string): Promise<void>;
}

export interface ObjectStore {
  verifyRetentionPolicy(): Promise<void>;
  createObjectKey(jobId: string): Promise<string>;
  put(objectKey: string, body: Buffer, contentType: string): Promise<void>;
  head(objectKey: string): Promise<{ size: number; contentType: string | null }>;
  get(objectKey: string): Promise<Buffer>;
  delete(objectKey: string): Promise<void>;
  purgeExpired(): Promise<number>;
}

export interface ObjectDeletionRepository {
  enqueue(objectKey: string): Promise<void>;
  list(limit: number, nowIso?: string): Promise<string[]>;
  remove(objectKey: string): Promise<void>;
}

export interface VisionProvider {
  detect(input: { image: Buffer; imageUrl?: string; localLabels: string[] }): Promise<DetectedEntity>;
}
