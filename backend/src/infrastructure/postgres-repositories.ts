import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import type {
  AnalysisJob,
  AnalysisJobRepository,
  BudgetedAnalysisJobCreateResult,
  CardFeedback,
  CardRepository,
  Device,
  DeviceRepository,
  EvaluationLeaseDefinition,
  KnowledgeCard,
  KnowledgeSource,
  ObjectDeletionRepository,
  PrivateCardDeletionResult,
  RegisteredDevice,
  TrackedItem
} from "../domain/types.js";
import { AppError } from "../errors.js";
import { nextAvailableScheduledDate } from "../domain/card-scheduling.js";

type DbRow = Record<string, unknown>;

function deviceFrom(row: DbRow): Device {
  return {
    id: String(row.id),
    installationHash: String(row.installation_hash),
    tokenHash: String(row.token_hash),
    createdAt: new Date(String(row.created_at)).toISOString()
  };
}

function registeredDeviceFrom(row: DbRow): RegisteredDevice {
  return {
    ...deviceFrom(row),
    created: row.registration_created === true
  };
}

function jobFrom(row: DbRow): AnalysisJob {
  return {
    id: String(row.id),
    deviceId: String(row.device_id),
    candidateToken: String(row.candidate_token),
    capturedAtBucket: row.captured_at_bucket ? String(row.captured_at_bucket).slice(0, 10) : null,
    localLabels: row.local_labels as string[],
    qualityScore: Number(row.quality_score),
    sensitiveFlags: row.sensitive_flags as string[],
    contentType: String(row.content_type) as "image/jpeg",
    objectKey: row.object_key ? String(row.object_key) : null,
    uploadSessionId: row.upload_session_id ? String(row.upload_session_id) : null,
    uploadExpiresAt: row.upload_expires_at ? new Date(String(row.upload_expires_at)).toISOString() : null,
    uploadClaimedAt: row.upload_claimed_at ? new Date(String(row.upload_claimed_at)).toISOString() : null,
    processingClaimToken: row.processing_claim_token ? String(row.processing_claim_token) : null,
    processingLeaseExpiresAt: row.processing_lease_expires_at
      ? new Date(String(row.processing_lease_expires_at)).toISOString()
      : null,
    status: row.status as AnalysisJob["status"],
    errorCode: row.error_code ? String(row.error_code) : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString()
  };
}

function cardFrom(row: DbRow): KnowledgeCard {
  return {
    cardId: String(row.id),
    deviceId: String(row.device_id),
    candidateToken: String(row.candidate_token),
    topicId: String(row.topic_id),
    factId: String(row.fact_id),
    title: String(row.title),
    detectedObjectName: String(row.detected_object_name),
    body: String(row.body),
    personalContext: String(row.personal_context),
    confidence: Number(row.confidence),
    sources: row.sources as KnowledgeSource[],
    status: row.status as KnowledgeCard["status"],
    scheduledDate: databaseDate(row.scheduled_date),
    createdAt: new Date(String(row.created_at)).toISOString()
  };
}

function databaseDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const match = /^(\d{4}-\d{2}-\d{2})(?:$|T|\s)/.exec(String(value));
  if (!match?.[1]) throw new Error("Database date is not a canonical calendar date");
  return match[1];
}

export class PostgresRepositories {
  readonly sql: Sql;
  private readonly backendReleaseSha256: string | null;

  constructor(databaseUrl: string, backendReleaseSha256: string | null = null) {
    if (backendReleaseSha256 !== null && !/^[a-f0-9]{64}$/.test(backendReleaseSha256)) {
      throw new Error("Backend Release SHA-256 is invalid");
    }
    this.backendReleaseSha256 = backendReleaseSha256;
    this.sql = postgres(databaseUrl, { max: 10, idle_timeout: 20, transform: { undefined: null } });
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }

  async ping(): Promise<void> {
    await this.sql`SELECT 1`;
  }

  readonly devicesRepository: DeviceRepository = {
    register: async (installationHash, tokenHash) => {
      const id = randomUUID();
      const rows = await this.sql<DbRow[]>`
        INSERT INTO devices (id, installation_hash, token_hash) VALUES (${id}, ${installationHash}, ${tokenHash})
        ON CONFLICT (installation_hash) DO UPDATE SET token_hash = excluded.token_hash
        RETURNING devices.*, devices.id = ${id} AS registration_created`;
      return registeredDeviceFrom(rows[0] as DbRow);
    },
    findByTokenHash: async (tokenHash) => {
      const rows = await this.sql<DbRow[]>`SELECT * FROM devices WHERE token_hash = ${tokenHash} LIMIT 1`;
      return rows[0] ? deviceFrom(rows[0]) : null;
    },
    deleteCascade: async (deviceId) => {
      await this.sql.begin(async (transaction) => {
        await transaction`
          UPDATE evaluation_leases SET revoked_at = coalesce(revoked_at, now())
          WHERE bound_device_id = ${deviceId}`;
        await transaction`DELETE FROM devices WHERE id = ${deviceId}`;
      });
    }
  };

  readonly jobsRepository: AnalysisJobRepository = {
    createWithinBudget: async (input, budget, evaluation): Promise<BudgetedAnalysisJobCreateResult> => {
      return this.sql.begin(async (transaction) => {
        // Serialize budget decisions across all API instances. Anonymous reinstall
        // must never let aggregate model spend exceed this global fuse.
        await transaction`SELECT pg_advisory_xact_lock(1784509213)`;
        const existingRows = await transaction<DbRow[]>`
          SELECT * FROM analysis_jobs
          WHERE device_id = ${input.deviceId} AND candidate_token = ${input.candidateToken}
          LIMIT 1`;
        let evaluationLeaseId: string | null = null;
        if (evaluation) {
          const leaseRows = await transaction<DbRow[]>`
            SELECT * FROM evaluation_leases WHERE token_hash = ${evaluation.tokenHash} LIMIT 1 FOR UPDATE`;
          const lease = leaseRows[0];
          if (!lease || String(lease.dataset_id) !== evaluation.datasetId ||
              String(lease.run_id) !== evaluation.runId || String(lease.labels_sha256) !== evaluation.labelsSha256) {
            return { status: "evaluation_lease_invalid" };
          }
          if (lease.revoked_at) return { status: "evaluation_lease_revoked" };
          if (new Date(String(lease.expires_at)).getTime() <= new Date(evaluation.now).getTime()) {
            return { status: "evaluation_lease_expired" };
          }
          if (lease.bound_device_id && String(lease.bound_device_id) !== input.deviceId) {
            return { status: "evaluation_device_mismatch" };
          }
          evaluationLeaseId = String(lease.id);
          const sampleRows = await transaction<DbRow[]>`
            SELECT * FROM evaluation_lease_samples
            WHERE lease_id = ${evaluationLeaseId} AND sample_id = ${evaluation.sampleId}
            LIMIT 1 FOR UPDATE`;
          const sample = sampleRows[0];
          if (!sample || String(sample.candidate_token) !== input.candidateToken) {
            return { status: "evaluation_sample_invalid" };
          }
          if (sample.consumed_at) {
            if (sample.consumed_job_id) {
              const consumedRows = await transaction<DbRow[]>`
                SELECT * FROM analysis_jobs WHERE id = ${String(sample.consumed_job_id)} LIMIT 1`;
              const consumed = consumedRows[0];
              if (consumed && String(consumed.device_id) === input.deviceId &&
                  String(consumed.candidate_token) === input.candidateToken) {
                return { status: "existing", job: jobFrom(consumed) };
              }
            }
            // A deleted job leaves consumed_at as a non-reusable tombstone. Device-data
            // deletion also revokes the lease before the analysis job is cascaded.
            return { status: "evaluation_sample_conflict" };
          }
          if (existingRows[0]) return { status: "evaluation_sample_conflict" };
          if (!lease.bound_device_id) {
            await transaction`
              UPDATE evaluation_leases SET bound_device_id = ${input.deviceId}
              WHERE id = ${evaluationLeaseId} AND bound_device_id IS NULL`;
          }
        } else {
          if (existingRows[0]) return { status: "existing", job: jobFrom(existingRows[0]) };
          const deviceDailyRows = await transaction<{ count: string }[]>`
            SELECT count(*)::text AS count FROM analysis_jobs
            WHERE device_id = ${input.deviceId} AND created_at >= ${budget.dailySince}
              AND NOT EXISTS (
                SELECT 1 FROM evaluation_lease_samples
                WHERE consumed_job_id = analysis_jobs.id
              )`;
          if (Number(deviceDailyRows[0]?.count ?? 0) >= budget.deviceDailyLimit) {
            return { status: "device_daily_exceeded" };
          }
          const deviceMonthlyRows = await transaction<{ count: string }[]>`
            SELECT count(*)::text AS count FROM analysis_jobs
            WHERE device_id = ${input.deviceId} AND created_at >= ${budget.monthSince}
              AND NOT EXISTS (
                SELECT 1 FROM evaluation_lease_samples
                WHERE consumed_job_id = analysis_jobs.id
              )`;
          if (Number(deviceMonthlyRows[0]?.count ?? 0) >= budget.deviceMonthlyLimit) {
            return { status: "device_monthly_exceeded" };
          }
        }
        const globalDailyRows = await transaction<{ count: string }[]>`
          SELECT count(*)::text AS count FROM analysis_budget_events
          WHERE created_at >= ${budget.dailySince}`;
        if (Number(globalDailyRows[0]?.count ?? 0) >= budget.globalDailyLimit) {
          return { status: "global_daily_exceeded" };
        }
        const globalMonthlyRows = await transaction<{ count: string }[]>`
          SELECT count(*)::text AS count FROM analysis_budget_events
          WHERE created_at >= ${budget.monthSince}`;
        if (Number(globalMonthlyRows[0]?.count ?? 0) >= budget.globalMonthlyLimit) {
          return { status: "global_monthly_exceeded" };
        }
        const globalDailyCostRows = await transaction<{ cost: string }[]>`
          SELECT coalesce(sum(reserved_cost_micro_cny), 0)::text AS cost FROM analysis_budget_events
          WHERE created_at >= ${budget.dailySince}`;
        if (Number(globalDailyCostRows[0]?.cost ?? 0) + budget.reservedCostMicroCny > budget.globalDailyCostMicroCnyLimit) {
          return { status: "global_daily_cost_exceeded" };
        }
        const globalMonthlyCostRows = await transaction<{ cost: string }[]>`
          SELECT coalesce(sum(reserved_cost_micro_cny), 0)::text AS cost FROM analysis_budget_events
          WHERE created_at >= ${budget.monthSince}`;
        if (Number(globalMonthlyCostRows[0]?.cost ?? 0) + budget.reservedCostMicroCny > budget.globalMonthlyCostMicroCnyLimit) {
          return { status: "global_monthly_cost_exceeded" };
        }

        const id = randomUUID();
        const rows = await transaction<DbRow[]>`
          INSERT INTO analysis_jobs (
            id, device_id, candidate_token, captured_at_bucket, local_labels, quality_score,
            sensitive_flags, content_type, object_key, status, error_code
          ) VALUES (
            ${id}, ${input.deviceId}, ${input.candidateToken}, ${input.capturedAtBucket},
            ${transaction.json(input.localLabels)}, ${input.qualityScore}, ${transaction.json(input.sensitiveFlags)},
            ${input.contentType}, ${input.objectKey}, ${input.status}, ${input.errorCode}
          ) RETURNING *`;
        await transaction`
          INSERT INTO analysis_budget_events (id, reserved_cost_micro_cny)
          VALUES (${randomUUID()}, ${budget.reservedCostMicroCny})`;
        if (evaluation && evaluationLeaseId) {
          await transaction`
            UPDATE evaluation_lease_samples
            SET consumed_job_id = ${id}, consumed_at = ${evaluation.now}
            WHERE lease_id = ${evaluationLeaseId} AND sample_id = ${evaluation.sampleId}
              AND consumed_job_id IS NULL`;
        }
        return { status: "created", job: jobFrom(rows[0] as DbRow) };
      });
    },
    createEvaluationLease: async (input: EvaluationLeaseDefinition) => {
      await this.sql.begin(async (transaction) => {
        await transaction`
          INSERT INTO evaluation_leases (
            id, token_hash, dataset_id, run_id, labels_sha256, max_jobs, expires_at
          ) VALUES (
            ${input.id}, ${input.tokenHash}, ${input.datasetId}, ${input.runId},
            ${input.labelsSha256}, ${input.maxJobs}, ${input.expiresAt}
          )`;
        for (const sample of input.samples) {
          await transaction`
            INSERT INTO evaluation_lease_samples (lease_id, sample_id, candidate_token)
            VALUES (${input.id}, ${sample.sampleId}, ${sample.candidateToken})`;
        }
      });
    },
    revokeEvaluationLease: async (id, revokedAt) => {
      const rows = await this.sql<{ id: string }[]>`
        UPDATE evaluation_leases SET revoked_at = coalesce(revoked_at, ${revokedAt})
        WHERE id = ${id} RETURNING id`;
      return rows.length > 0;
    },
    findById: async (id) => {
      const rows = await this.sql<DbRow[]>`SELECT * FROM analysis_jobs WHERE id = ${id} LIMIT 1`;
      return rows[0] ? jobFrom(rows[0]) : null;
    },
    findByCandidateToken: async (deviceId, candidateToken) => {
      const rows = await this.sql<DbRow[]>`
        SELECT * FROM analysis_jobs
        WHERE device_id = ${deviceId} AND candidate_token = ${candidateToken}
        LIMIT 1`;
      return rows[0] ? jobFrom(rows[0]) : null;
    },
    prepareUpload: async (id, expectedSessionId, input) => {
      const rows = await this.sql<DbRow[]>`
        UPDATE analysis_jobs SET
          object_key = ${input.objectKey},
          upload_session_id = ${input.uploadSessionId},
          upload_expires_at = ${input.uploadExpiresAt},
          upload_claimed_at = NULL,
          processing_claim_token = NULL,
          processing_lease_expires_at = NULL,
          status = 'awaiting_upload',
          error_code = NULL,
          updated_at = now()
        WHERE id = ${id}
          AND status IN ('awaiting_upload', 'failed')
          AND upload_session_id IS NOT DISTINCT FROM ${expectedSessionId}
        RETURNING *`;
      return rows[0] ? jobFrom(rows[0]) : null;
    },
    claimForUpload: async (uploadSessionId, deviceId, nowIso) => {
      const rows = await this.sql<DbRow[]>`
        UPDATE analysis_jobs SET status = 'uploading', upload_claimed_at = ${nowIso}, updated_at = now()
        WHERE upload_session_id = ${uploadSessionId}
          AND device_id = ${deviceId}
          AND status = 'awaiting_upload'
          AND upload_claimed_at IS NULL
          AND upload_expires_at > ${nowIso}
        RETURNING *`;
      return rows[0] ? jobFrom(rows[0]) : null;
    },
    finishUpload: async (id, uploadSessionId, errorCode) => {
      const status = errorCode === null ? "uploaded" : "failed";
      const rows = await this.sql<DbRow[]>`
        UPDATE analysis_jobs SET status = ${status}, error_code = ${errorCode}, updated_at = now()
        WHERE id = ${id}
          AND upload_session_id = ${uploadSessionId}
          AND status = 'uploading'
        RETURNING *`;
      return rows[0] ? jobFrom(rows[0]) : null;
    },
    recoverExpiredProcessing: async (id, nowIso) => {
      const rows = await this.sql<DbRow[]>`
        UPDATE analysis_jobs SET
          status = 'uploaded',
          processing_claim_token = NULL,
          processing_lease_expires_at = NULL,
          error_code = 'processing_lease_recovered',
          updated_at = now()
        WHERE id = ${id}
          AND status = 'processing'
          AND processing_lease_expires_at <= ${nowIso}
        RETURNING *`;
      return rows[0] ? jobFrom(rows[0]) : null;
    },
    claimForProcessing: async (id, claimToken, leaseExpiresAt) => {
      const rows = await this.sql<DbRow[]>`
        UPDATE analysis_jobs SET
          status = 'processing',
          processing_claim_token = ${claimToken},
          processing_lease_expires_at = ${leaseExpiresAt},
          error_code = NULL,
          updated_at = now()
        WHERE id = ${id} AND status = 'uploaded'
        RETURNING *`;
      return rows[0] ? jobFrom(rows[0]) : null;
    },
    finishProcessing: async (id, claimToken, status, errorCode) => {
      const rows = await this.sql<DbRow[]>`
        UPDATE analysis_jobs SET
          status = ${status},
          error_code = ${errorCode},
          processing_claim_token = NULL,
          processing_lease_expires_at = NULL,
          updated_at = now()
        WHERE id = ${id}
          AND status = 'processing'
          AND processing_claim_token = ${claimToken}
          AND processing_lease_expires_at > now()
        RETURNING *`;
      return rows[0] ? jobFrom(rows[0]) : null;
    },
    completeWithCard: async (id, claimToken, card, scheduleNotBefore) => {
      return this.sql.begin(async (transaction) => {
        const jobRows = await transaction<DbRow[]>`
          SELECT * FROM analysis_jobs
          WHERE id = ${id}
            AND status = 'processing'
            AND processing_claim_token = ${claimToken}
            AND processing_lease_expires_at > now()
          FOR UPDATE`;
        if (!jobRows[0]) return null;
        const claimedJob = jobFrom(jobRows[0]);
        let cardRows = await transaction<DbRow[]>`
          SELECT * FROM cards
          WHERE device_id = ${claimedJob.deviceId} AND candidate_token = ${claimedJob.candidateToken}
          LIMIT 1`;
        if (!cardRows[0]) {
          // Multiple Function Compute instances may finish photos for one device at once.
          // Serialize slot selection in PostgreSQL so each completion observes the prior insert.
          await transaction`
            SELECT pg_advisory_xact_lock(hashtextextended(${`card-schedule:${claimedJob.deviceId}`}, 0))`;
          const occupiedRows = await transaction<{ scheduled_date: string }[]>`
            SELECT scheduled_date FROM cards
            WHERE device_id = ${claimedJob.deviceId}
              AND status = 'scheduled'
              AND scheduled_date >= ${scheduleNotBefore}
            ORDER BY scheduled_date ASC`;
          const scheduledDate = nextAvailableScheduledDate(
            scheduleNotBefore,
            occupiedRows.map((row) => databaseDate(row.scheduled_date))
          );
          const cardId = randomUUID();
          cardRows = await transaction<DbRow[]>`
            INSERT INTO cards (
              id, device_id, candidate_token, topic_id, fact_id, title, detected_object_name, body, personal_context,
              confidence, sources, status, scheduled_date, backend_release_sha256
            ) VALUES (
              ${cardId}, ${claimedJob.deviceId}, ${claimedJob.candidateToken}, ${card.topicId}, ${card.factId},
              ${card.title}, ${card.detectedObjectName}, ${card.body}, ${card.personalContext}, ${card.confidence},
              ${transaction.json(card.sources as unknown as postgres.JSONValue)}, ${card.status}, ${scheduledDate},
              ${this.backendReleaseSha256}
            ) RETURNING *`;
        }
        const completedRows = await transaction<DbRow[]>`
          UPDATE analysis_jobs SET
            status = 'completed',
            error_code = NULL,
            processing_claim_token = NULL,
            processing_lease_expires_at = NULL,
            updated_at = now()
          WHERE id = ${id}
            AND status = 'processing'
            AND processing_claim_token = ${claimToken}
          RETURNING *`;
        if (!completedRows[0]) throw new AppError("processing_lease_lost", "分析任务处理租约已失效", 409);
        return { job: jobFrom(completedRows[0]), card: cardFrom(cardRows[0] as DbRow) };
      });
    },
    countSince: async (deviceId, sinceIso) => {
      const rows = await this.sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM analysis_jobs
        WHERE device_id = ${deviceId} AND created_at >= ${sinceIso}
          AND NOT EXISTS (
            SELECT 1 FROM evaluation_lease_samples
            WHERE consumed_job_id = analysis_jobs.id
          )`;
      return Number(rows[0]?.count ?? 0);
    },
    listObjectKeys: async (deviceId) => {
      const rows = await this.sql<{ object_key: string }[]>`
        SELECT object_key FROM analysis_jobs WHERE device_id = ${deviceId} AND object_key IS NOT NULL`;
      return rows.map((row) => row.object_key);
    },
    deleteByCandidateToken: async (deviceId, candidateToken) => {
      await this.sql`
        DELETE FROM analysis_jobs WHERE device_id = ${deviceId} AND candidate_token = ${candidateToken}`;
    },
    suppressCandidate: async (deviceId, candidateToken) => {
      await this.sql`
        INSERT INTO suppressed_candidates (device_id, candidate_token)
        VALUES (${deviceId}, ${candidateToken})
        ON CONFLICT (device_id, candidate_token) DO NOTHING`;
    },
    isCandidateSuppressed: async (deviceId, candidateToken) => {
      const rows = await this.sql<{ exists: boolean }[]>`
        SELECT EXISTS(
          SELECT 1 FROM suppressed_candidates
          WHERE device_id = ${deviceId} AND candidate_token = ${candidateToken}
        ) AS exists`;
      return rows[0]?.exists === true;
    }
  };

  readonly cardsRepository: CardRepository = {
    create: async (card) => {
      const id = randomUUID();
      const rows = await this.sql<DbRow[]>`
        INSERT INTO cards (
          id, device_id, candidate_token, topic_id, fact_id, title, detected_object_name, body, personal_context,
          confidence, sources, status, scheduled_date, backend_release_sha256
        ) VALUES (
          ${id}, ${card.deviceId}, ${card.candidateToken}, ${card.topicId}, ${card.factId},
          ${card.title}, ${card.detectedObjectName}, ${card.body}, ${card.personalContext}, ${card.confidence},
          ${this.sql.json(card.sources as unknown as postgres.JSONValue)}, ${card.status}, ${card.scheduledDate},
          ${this.backendReleaseSha256}
        ) RETURNING *`;
      return cardFrom(rows[0] as DbRow);
    },
    findById: async (cardId) => {
      const rows = await this.sql<DbRow[]>`SELECT * FROM cards WHERE id = ${cardId} LIMIT 1`;
      return rows[0] ? cardFrom(rows[0]) : null;
    },
    list: async (deviceId, cursor, limit) => {
      let rows: DbRow[];
      if (cursor) {
        const cursorRows = await this.sql<DbRow[]>`
          SELECT id, created_at FROM cards
          WHERE id = ${cursor} AND device_id = ${deviceId}
          LIMIT 1`;
        if (!cursorRows[0]) throw new AppError("invalid_cursor", "卡片游标无效", 400);
        rows = await this.sql<DbRow[]>`
          SELECT * FROM cards WHERE device_id = ${deviceId}
          AND (created_at, id) > (${cursorRows[0].created_at as string}, ${cursor})
          ORDER BY created_at ASC, id ASC LIMIT ${limit + 1}`;
      } else {
        rows = await this.sql<DbRow[]>`
          SELECT * FROM cards WHERE device_id = ${deviceId}
          ORDER BY created_at ASC, id ASC LIMIT ${limit + 1}`;
      }
      const hasMore = rows.length > limit;
      const items = rows.slice(0, limit).map(cardFrom);
      return { items, nextCursor: hasMore ? items.at(-1)?.cardId ?? null : null };
    },
    addFeedback: async (input) => {
      return this.sql.begin(async (transaction) => {
        const id = randomUUID();
        let rows = await transaction<DbRow[]>`
          INSERT INTO feedback (id, device_id, card_id, action)
          VALUES (${id}, ${input.deviceId}, ${input.cardId}, ${input.action})
          ON CONFLICT (device_id, card_id, action) DO NOTHING
          RETURNING *`;
        const inserted = Boolean(rows[0]);
        if (!rows[0]) {
          rows = await transaction<DbRow[]>`
            SELECT * FROM feedback
            WHERE device_id = ${input.deviceId} AND card_id = ${input.cardId} AND action = ${input.action}
            LIMIT 1`;
        }
        const delta = inserted ? feedbackWeightDelta(input.action) : 0;
        const preferenceRows = await transaction<DbRow[]>`
          INSERT INTO topic_preferences (device_id, topic_id, weight)
          VALUES (${input.deviceId}, ${input.topicId}, ${delta})
          ON CONFLICT (device_id, topic_id) DO UPDATE SET
            weight = greatest(-20, least(20, topic_preferences.weight + ${delta})),
            updated_at = CASE WHEN ${inserted} THEN now() ELSE topic_preferences.updated_at END
          RETURNING *`;
        const row = rows[0] as DbRow;
        const preference = preferenceRows[0] as DbRow;
        return {
          feedback: {
            id: String(row.id), deviceId: String(row.device_id), cardId: String(row.card_id),
            action: row.action as CardFeedback["action"], createdAt: new Date(String(row.created_at)).toISOString()
          },
          preference: {
            deviceId: String(preference.device_id), topicId: String(preference.topic_id),
            weight: Number(preference.weight), updatedAt: new Date(String(preference.updated_at)).toISOString()
          }
        };
      });
    },
    deleteTooPrivate: async (deviceId, cardId) => {
      return this.sql.begin(async (transaction): Promise<PrivateCardDeletionResult | null> => {
        await transaction`SELECT pg_advisory_xact_lock(hashtextextended(${`${deviceId}:${cardId}`}, 0))`;
        const existingRows = await transaction<DbRow[]>`
          SELECT * FROM privacy_deletion_receipts
          WHERE device_id = ${deviceId} AND card_id = ${cardId}
          LIMIT 1`;
        if (existingRows[0]) return privateDeletionFrom(existingRows[0], deviceId, cardId, true);

        const cardRows = await transaction<DbRow[]>`
          SELECT * FROM cards
          WHERE id = ${cardId} AND device_id = ${deviceId}
          LIMIT 1
          FOR UPDATE`;
        const cardRow = cardRows[0];
        if (!cardRow) return null;
        const candidateToken = String(cardRow.candidate_token);
        const topicId = String(cardRow.topic_id);
        const jobRows = await transaction<DbRow[]>`
          SELECT object_key FROM analysis_jobs
          WHERE device_id = ${deviceId} AND candidate_token = ${candidateToken}
          LIMIT 1
          FOR UPDATE`;
        const objectKey = jobRows[0]?.object_key ? String(jobRows[0].object_key) : null;
        const delta = feedbackWeightDelta("TOO_PRIVATE");
        const preferenceRows = await transaction<DbRow[]>`
          INSERT INTO topic_preferences (device_id, topic_id, weight)
          VALUES (${deviceId}, ${topicId}, ${delta})
          ON CONFLICT (device_id, topic_id) DO UPDATE SET
            weight = greatest(-20, least(20, topic_preferences.weight + ${delta})),
            updated_at = now()
          RETURNING *`;
        const receiptId = randomUUID();
        const receiptRows = await transaction<DbRow[]>`
          INSERT INTO privacy_deletion_receipts (
            device_id, card_id, receipt_id, topic_id, preference_weight
          ) VALUES (
            ${deviceId}, ${cardId}, ${receiptId}, ${topicId}, ${Number(preferenceRows[0]?.weight)}
          )
          RETURNING *`;
        await transaction`
          INSERT INTO suppressed_candidates (device_id, candidate_token)
          VALUES (${deviceId}, ${candidateToken})
          ON CONFLICT (device_id, candidate_token) DO NOTHING`;
        if (objectKey) {
          await transaction`
            INSERT INTO pending_object_deletions (object_key)
            VALUES (${objectKey})
            ON CONFLICT (object_key) DO NOTHING`;
        }
        await transaction`DELETE FROM cards WHERE id = ${cardId} AND device_id = ${deviceId}`;
        await transaction`
          DELETE FROM analysis_jobs
          WHERE device_id = ${deviceId} AND candidate_token = ${candidateToken}`;

        const result = privateDeletionFrom(receiptRows[0] as DbRow, deviceId, cardId, false);
        return { ...result, objectKey };
      });
    },
    listPreferences: async (deviceId) => {
      const rows = await this.sql<DbRow[]>`
        SELECT * FROM topic_preferences WHERE device_id = ${deviceId}
        ORDER BY weight DESC, topic_id ASC`;
      return rows.map((row) => ({
        deviceId: String(row.device_id),
        topicId: String(row.topic_id),
        weight: Number(row.weight),
        updatedAt: new Date(String(row.updated_at)).toISOString()
      }));
    },
    track: async (input) => {
      const id = randomUUID();
      const rows = await this.sql<DbRow[]>`
        INSERT INTO tracked_items (id, device_id, card_id, started_on, reminder_days)
        VALUES (${id}, ${input.deviceId}, ${input.cardId}, ${input.startedOn}, ${input.reminderDays})
        ON CONFLICT (device_id, card_id) DO UPDATE SET
          started_on = excluded.started_on,
          reminder_days = excluded.reminder_days
        RETURNING *`;
      const row = rows[0] as DbRow;
      return {
        id: String(row.id), deviceId: String(row.device_id), cardId: String(row.card_id),
        startedOn: String(row.started_on).slice(0, 10), reminderDays: Number(row.reminder_days),
        createdAt: new Date(String(row.created_at)).toISOString()
      };
    },
    untrack: async (cardId, deviceId) => {
      await this.sql`DELETE FROM tracked_items WHERE card_id = ${cardId} AND device_id = ${deviceId}`;
    },
    deleteById: async (cardId, deviceId) => {
      await this.sql`DELETE FROM cards WHERE id = ${cardId} AND device_id = ${deviceId}`;
    }
  };

  readonly objectDeletionsRepository: ObjectDeletionRepository = {
    enqueue: async (objectKey) => {
      await this.sql`
        INSERT INTO pending_object_deletions (object_key, next_attempt_at)
        VALUES (${objectKey}, now())
        ON CONFLICT (object_key) DO UPDATE SET
          attempts = pending_object_deletions.attempts + 1,
          last_attempt_at = now(),
          next_attempt_at = now() + (
            power(2, least(pending_object_deletions.attempts - 1, 6))::integer * interval '1 minute'
          )`;
    },
    list: async (limit, nowIso = new Date().toISOString()) => {
      const rows = await this.sql<{ object_key: string }[]>`
        SELECT object_key FROM pending_object_deletions
        WHERE next_attempt_at <= ${nowIso}
        ORDER BY next_attempt_at ASC, created_at ASC, object_key ASC
        LIMIT ${limit}`;
      return rows.map((row) => row.object_key);
    },
    remove: async (objectKey) => {
      await this.sql`DELETE FROM pending_object_deletions WHERE object_key = ${objectKey}`;
    }
  };
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

function privateDeletionFrom(
  row: DbRow,
  deviceId: string,
  cardId: string,
  alreadyDeleted: boolean
): PrivateCardDeletionResult {
  const createdAt = new Date(String(row.created_at)).toISOString();
  return {
    feedback: {
      id: String(row.receipt_id),
      deviceId,
      cardId,
      action: "TOO_PRIVATE",
      createdAt
    },
    preference: {
      deviceId,
      topicId: String(row.topic_id),
      weight: Number(row.preference_weight),
      updatedAt: createdAt
    },
    objectKey: null,
    alreadyDeleted
  };
}
