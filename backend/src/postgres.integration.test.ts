import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AnalysisJob, AnalysisJobBudget } from "./domain/types.js";
import { PostgresRepositories } from "./infrastructure/postgres-repositories.js";

const databaseUrl = process.env.DATABASE_URL ?? "";
const runIntegration = process.env.RUN_POSTGRES_INTEGRATION === "1" && databaseUrl.length > 0;
const repositories: PostgresRepositories[] = [];
const backendReleaseSha256 = "c".repeat(64);

function createInput(
  deviceId: string,
  candidateToken = randomUUID(),
  overrides: Partial<Omit<AnalysisJob, "id" | "createdAt" | "updatedAt">> = {}
) {
  return { ...baseInput(deviceId, candidateToken), ...overrides };
}

function baseInput(deviceId: string, candidateToken: string) {
  return {
    deviceId,
    candidateToken,
    capturedAtBucket: "2026-07-18",
    localLabels: ["broom"],
    qualityScore: 0.91,
    sensitiveFlags: [],
    contentType: "image/jpeg" as const,
    objectKey: null,
    uploadSessionId: null,
    uploadExpiresAt: null,
    uploadClaimedAt: null,
    processingClaimToken: null,
    processingLeaseExpiresAt: null,
    status: "awaiting_upload" as const,
    errorCode: null
  };
}

function createBudget(overrides: Partial<AnalysisJobBudget> = {}): AnalysisJobBudget {
  const now = Date.now();
  return {
    deviceDailyLimit: 1_000,
    deviceMonthlyLimit: 10_000,
    globalDailyLimit: 10_000,
    globalMonthlyLimit: 100_000,
    reservedCostMicroCny: 1,
    globalDailyCostMicroCnyLimit: 10_000,
    globalMonthlyCostMicroCnyLimit: 100_000,
    dailySince: new Date(now - 24 * 60 * 60 * 1_000).toISOString(),
    monthSince: new Date(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1)).toISOString(),
    ...overrides
  };
}

describe.skipIf(!runIntegration)("PostgreSQL repository integration", () => {
  beforeAll(() => {
    for (let index = 0; index < 4; index += 1) repositories.push(new PostgresRepositories(databaseUrl, backendReleaseSha256));
  });

  beforeEach(async () => {
    await repositories[0].sql`TRUNCATE TABLE devices, analysis_budget_events CASCADE`;
  });

  afterAll(async () => {
    await Promise.all(repositories.map((repository) => repository.close()));
  });

  it("has the complete checksummed schema after repeatable migrations", async () => {
    const migrations = await repositories[0].sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM schema_migrations`;
    expect(Number(migrations[0]?.count)).toBe(13);
  });

  it("backfills and constrains detected object names when migration 013 upgrades existing cards", async () => {
    const schema = "migration_013_upgrade_test";
    const migration = await readFile(new URL("../migrations/013_card_detected_object_name.sql", import.meta.url), "utf8");
    await repositories[0].sql.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await repositories[0].sql.unsafe(`CREATE SCHEMA "${schema}"`);
    try {
      await repositories[0].sql.begin(async (transaction) => {
        await transaction.unsafe(`SET LOCAL search_path TO "${schema}"`);
        await transaction.unsafe(`
          CREATE TABLE cards (
            id text PRIMARY KEY,
            title text NOT NULL
          )
        `);
        await transaction.unsafe(`
          INSERT INTO cards (id, title)
          VALUES ('legacy-card', '旧卡片对象标题')
        `);
        await transaction.unsafe(migration);
      });

      const rows = await repositories[0].sql.unsafe<{ detected_object_name: string }[]>(
        `SELECT detected_object_name FROM "${schema}".cards WHERE id = 'legacy-card'`
      );
      expect(rows[0]?.detected_object_name).toBe("旧卡片对象标题");
      await expect(repositories[0].sql.unsafe(
        `UPDATE "${schema}".cards SET detected_object_name = '   ' WHERE id = 'legacy-card'`
      )).rejects.toThrow();
    } finally {
      await repositories[0].sql.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
  });

  it("serializes a global daily fuse across independent connection pools", async () => {
    const devices = await Promise.all(Array.from({ length: 8 }, (_, index) =>
      repositories[index % repositories.length].devicesRepository.register(`installation-${index}`, `token-${index}`)
    ));
    const budget = createBudget({ globalDailyLimit: 5 });
    const attempts = Array.from({ length: 32 }, (_, index) =>
      repositories[index % repositories.length].jobsRepository.createWithinBudget(
        createInput(devices[index % devices.length].id),
        budget
      )
    );

    const results = await Promise.all(attempts);
    expect(results.filter((result) => result.status === "created")).toHaveLength(5);
    expect(results.filter((result) => result.status === "global_daily_exceeded")).toHaveLength(27);
    const counts = await repositories[0].sql<{ jobs: string; events: string }[]>`
      SELECT
        (SELECT count(*)::text FROM analysis_jobs) AS jobs,
        (SELECT count(*)::text FROM analysis_budget_events) AS events`;
    expect(Number(counts[0]?.jobs)).toBe(5);
    expect(Number(counts[0]?.events)).toBe(5);
  }, 30_000);

  it("makes concurrent duplicate candidates idempotent", async () => {
    const device = await repositories[0].devicesRepository.register("same-installation", "same-token");
    const input = createInput(device.id, "same-candidate");
    const results = await Promise.all(Array.from({ length: 16 }, (_, index) =>
      repositories[index % repositories.length].jobsRepository.createWithinBudget(input, createBudget())
    ));

    expect(results.filter((result) => result.status === "created")).toHaveLength(1);
    expect(results.filter((result) => result.status === "existing")).toHaveLength(15);
    const counts = await repositories[0].sql<{ jobs: string; events: string }[]>`
      SELECT
        (SELECT count(*)::text FROM analysis_jobs) AS jobs,
        (SELECT count(*)::text FROM analysis_budget_events) AS events`;
    expect(Number(counts[0]?.jobs)).toBe(1);
    expect(Number(counts[0]?.events)).toBe(1);
  }, 30_000);

  it("atomically distinguishes a new installation from token rotation and recreation", async () => {
    const installation = "registration-created-proof";
    const registrations = await Promise.all(
      repositories.map((repository, index) =>
        repository.devicesRepository.register(installation, `registration-token-${index}`)
      )
    );

    expect(registrations.filter((registration) => registration.created)).toHaveLength(1);
    expect(new Set(registrations.map((registration) => registration.id)).size).toBe(1);

    const rotated = await repositories[0].devicesRepository.register(installation, "rotated-token");
    expect(rotated.created).toBe(false);
    expect(rotated.id).toBe(registrations[0]?.id);

    await repositories[0].devicesRepository.deleteCascade(rotated.id);
    const recreated = await repositories[1].devicesRepository.register(installation, "recreated-token");
    expect(recreated.created).toBe(true);
    expect(recreated.id).not.toBe(rotated.id);
    await repositories[1].devicesRepository.deleteCascade(recreated.id);
  }, 30_000);

  it("reserves worst-case money atomically across independent connection pools", async () => {
    const devices = await Promise.all(Array.from({ length: 4 }, (_, index) =>
      repositories[index].devicesRepository.register(`cost-installation-${index}`, `cost-token-${index}`)
    ));
    const budget = createBudget({
      reservedCostMicroCny: 7,
      globalDailyCostMicroCnyLimit: 20,
      globalMonthlyCostMicroCnyLimit: 20
    });
    const results = await Promise.all(Array.from({ length: 16 }, (_, index) =>
      repositories[index % repositories.length].jobsRepository.createWithinBudget(
        createInput(devices[index % devices.length].id),
        budget
      )
    ));

    expect(results.filter((result) => result.status === "created")).toHaveLength(2);
    expect(results.filter((result) => result.status === "global_daily_cost_exceeded")).toHaveLength(14);
    const rows = await repositories[0].sql<{ cost: string }[]>`
      SELECT coalesce(sum(reserved_cost_micro_cny), 0)::text AS cost FROM analysis_budget_events`;
    expect(Number(rows[0]?.cost)).toBe(14);
  }, 30_000);

  it("keeps the identifier-free global ledger after delete and reinstall", async () => {
    const original = await repositories[0].devicesRepository.register("original-installation", "original-token");
    const budget = createBudget({ globalDailyLimit: 2 });
    const firstJob = await repositories[0].jobsRepository.createWithinBudget(createInput(original.id), budget);
    const secondJob = await repositories[0].jobsRepository.createWithinBudget(createInput(original.id), budget);
    expect(firstJob.status).toBe("created");
    expect(secondJob.status).toBe("created");
    if (firstJob.status !== "created") throw new Error("Expected cascade fixture job");
    const uploadSessionId = randomUUID();
    expect(await repositories[0].jobsRepository.prepareUpload(firstJob.job.id, null, {
      objectKey: `analysis/${randomUUID()}.image`,
      uploadSessionId,
      uploadExpiresAt: new Date(Date.now() + 60_000).toISOString()
    })).not.toBeNull();

    const card = await repositories[0].cardsRepository.create({
      deviceId: original.id,
      candidateToken: randomUUID(),
      topicId: "broom",
      factId: "broom-001",
      title: "Cascade fixture",
      detectedObjectName: "扫帚",
      body: "This reviewed cascade fixture body is valid.",
      personalContext: "Authorized integration fixture",
      confidence: 0.9,
      sources: [{
        sourceId: "fixture",
        title: "Fixture source",
        url: "https://example.com/cascade",
        publisher: "Example",
        authority: "reference"
      }],
      status: "scheduled",
      scheduledDate: "2026-07-18"
    });
    const cardId = card.cardId;
    await repositories[0].sql`
      INSERT INTO feedback (id, device_id, card_id, action)
      VALUES (${randomUUID()}, ${original.id}, ${cardId}, 'LIKE')`;
    await repositories[0].sql`
      INSERT INTO tracked_items (id, device_id, card_id, started_on, reminder_days)
      VALUES (${randomUUID()}, ${original.id}, ${cardId}, '2026-07-18', 90)`;
    await repositories[0].sql`
      INSERT INTO suppressed_candidates (device_id, candidate_token)
      VALUES (${original.id}, ${randomUUID()})`;
    await repositories[0].sql`
      INSERT INTO topic_preferences (device_id, topic_id, weight)
      VALUES (${original.id}, 'broom', 3)`;
    await repositories[0].sql`
      INSERT INTO privacy_deletion_receipts (device_id, card_id, receipt_id, topic_id, preference_weight)
      VALUES (${original.id}, ${randomUUID()}, ${randomUUID()}, 'toothbrush', -8)`;
    await repositories[0].devicesRepository.deleteCascade(original.id);

    const afterDelete = await repositories[0].sql<{
      devices: string;
      jobs: string;
      cards: string;
      feedback: string;
      tracked: string;
      suppressed: string;
      preferences: string;
      receipts: string;
      sessions: string;
      events: string;
    }[]>`
      SELECT
        (SELECT count(*)::text FROM devices) AS devices,
        (SELECT count(*)::text FROM analysis_jobs) AS jobs,
        (SELECT count(*)::text FROM cards) AS cards,
        (SELECT count(*)::text FROM feedback) AS feedback,
        (SELECT count(*)::text FROM tracked_items) AS tracked,
        (SELECT count(*)::text FROM suppressed_candidates) AS suppressed,
        (SELECT count(*)::text FROM topic_preferences) AS preferences,
        (SELECT count(*)::text FROM privacy_deletion_receipts) AS receipts,
        (SELECT count(*)::text FROM analysis_jobs WHERE upload_session_id = ${uploadSessionId}) AS sessions,
        (SELECT count(*)::text FROM analysis_budget_events) AS events`;
    expect(Number(afterDelete[0]?.devices)).toBe(0);
    expect(Number(afterDelete[0]?.jobs)).toBe(0);
    expect(Number(afterDelete[0]?.cards)).toBe(0);
    expect(Number(afterDelete[0]?.feedback)).toBe(0);
    expect(Number(afterDelete[0]?.tracked)).toBe(0);
    expect(Number(afterDelete[0]?.suppressed)).toBe(0);
    expect(Number(afterDelete[0]?.preferences)).toBe(0);
    expect(Number(afterDelete[0]?.receipts)).toBe(0);
    expect(Number(afterDelete[0]?.sessions)).toBe(0);
    expect(Number(afterDelete[0]?.events)).toBe(2);

    const reinstalled = await repositories[1].devicesRepository.register("new-installation", "new-token");
    const result = await repositories[1].jobsRepository.createWithinBudget(createInput(reinstalled.id), budget);
    expect(result.status).toBe("global_daily_exceeded");
  });

  it("atomically consumes upload sessions, leases one processor, and retains deletion retries", async () => {
    const device = await repositories[0].devicesRepository.register("claim-installation", "claim-token");
    const result = await repositories[0].jobsRepository.createWithinBudget(createInput(device.id), createBudget());
    if (result.status !== "created") throw new Error("test setup failed");
    const uploadSessionId = randomUUID();
    const prepared = await repositories[0].jobsRepository.prepareUpload(result.job.id, null, {
      objectKey: "analysis/test/claim.image",
      uploadSessionId,
      uploadExpiresAt: new Date(Date.now() + 60_000).toISOString()
    });
    expect(prepared?.status).toBe("awaiting_upload");
    const uploadClaims = await Promise.all(Array.from({ length: 16 }, (_, index) =>
      repositories[index % repositories.length].jobsRepository.claimForUpload(
        uploadSessionId,
        device.id,
        new Date().toISOString()
      )
    ));
    expect(uploadClaims.filter(Boolean)).toHaveLength(1);
    expect(await repositories[0].jobsRepository.finishUpload(result.job.id, uploadSessionId, null)).toMatchObject({
      status: "uploaded"
    });
    expect(await repositories[1].jobsRepository.claimForUpload(
      uploadSessionId,
      device.id,
      new Date().toISOString()
    )).toBeNull();

    const claims = await Promise.all(Array.from({ length: 16 }, (_, index) =>
      repositories[index % repositories.length].jobsRepository.claimForProcessing(
        result.job.id,
        randomUUID(),
        new Date(Date.now() + 60_000).toISOString()
      )
    ));
    expect(claims.filter(Boolean)).toHaveLength(1);

    await repositories[0].objectDeletionsRepository.enqueue("analysis/test/pending.image");
    await repositories[0].devicesRepository.deleteCascade(device.id);
    expect(await repositories[1].objectDeletionsRepository.list(10)).toEqual(["analysis/test/pending.image"]);
    await repositories[1].objectDeletionsRepository.remove("analysis/test/pending.image");
    expect(await repositories[0].objectDeletionsRepository.list(10)).toEqual([]);

    const fairKeys = [
      "analysis/test/fair-000.image",
      "analysis/test/fair-001.image",
      "analysis/test/fair-002.image"
    ];
    for (const key of fairKeys) await repositories[0].objectDeletionsRepository.enqueue(key);
    const readyAt = new Date(Date.now() + 1_000);
    const firstWindow = await repositories[1].objectDeletionsRepository.list(2, readyAt.toISOString());
    expect(firstWindow).toEqual(fairKeys.slice(0, 2));
    for (const key of firstWindow) await repositories[0].objectDeletionsRepository.enqueue(key);
    expect(await repositories[1].objectDeletionsRepository.list(2, readyAt.toISOString())).toEqual([fairKeys[2]]);
    await repositories[0].objectDeletionsRepository.remove(fairKeys[2]);
    expect(await repositories[1].objectDeletionsRepository.list(
      2,
      new Date(readyAt.getTime() + 2 * 60_000).toISOString()
    )).toEqual(firstWindow);
    for (const key of fairKeys) await repositories[0].objectDeletionsRepository.remove(key);
  });

  it("recovers an expired processing lease and rejects the stale worker's terminal write", async () => {
    const device = await repositories[0].devicesRepository.register("lease-installation", "lease-token");
    const result = await repositories[0].jobsRepository.createWithinBudget(createInput(device.id, randomUUID(), {
      status: "uploaded",
      objectKey: "analysis/test/lease.image"
    }), createBudget());
    if (result.status !== "created") throw new Error("test setup failed");
    const staleToken = randomUUID();
    expect(await repositories[0].jobsRepository.claimForProcessing(
      result.job.id,
      staleToken,
      new Date(Date.now() - 1_000).toISOString()
    )).not.toBeNull();
    expect(await repositories[1].jobsRepository.recoverExpiredProcessing(
      result.job.id,
      new Date().toISOString()
    )).toMatchObject({ status: "uploaded" });
    const currentToken = randomUUID();
    expect(await repositories[2].jobsRepository.claimForProcessing(
      result.job.id,
      currentToken,
      new Date(Date.now() + 60_000).toISOString()
    )).not.toBeNull();
    expect(await repositories[0].jobsRepository.finishProcessing(
      result.job.id,
      staleToken,
      "failed",
      "stale"
    )).toBeNull();
    expect(await repositories[3].jobsRepository.finishProcessing(
      result.job.id,
      currentToken,
      "needs_content",
      "verified"
    )).toMatchObject({ status: "needs_content", errorCode: "verified" });
  });

  it("serializes concurrent card completions into contiguous per-device days and repairs gaps", async () => {
    const device = await repositories[0].devicesRepository.register("schedule-installation", "schedule-token");
    const baseDate = "2026-07-20";
    const created = await Promise.all(Array.from({ length: 32 }, (_, index) =>
      repositories[index % repositories.length].jobsRepository.createWithinBudget(
        createInput(device.id, `schedule-candidate-${index}`, {
          status: "uploaded",
          objectKey: `analysis/schedule-${index}.image`
        }),
        createBudget()
      )
    ));
    if (created.some((result) => result.status !== "created")) throw new Error("schedule fixture creation failed");
    const jobs = created.map((result) => {
      if (result.status !== "created") throw new Error("schedule fixture job missing");
      return result.job;
    });
    const claimTokens = jobs.map(() => randomUUID());
    const claims = await Promise.all(jobs.map((job, index) =>
      repositories[index % repositories.length].jobsRepository.claimForProcessing(
        job.id,
        claimTokens[index]!,
        new Date(Date.now() + 60_000).toISOString()
      )
    ));
    expect(claims.every(Boolean)).toBe(true);

    const completions = await Promise.all(jobs.map((job, index) =>
      repositories[index % repositories.length].jobsRepository.completeWithCard(
        job.id,
        claimTokens[index]!,
        scheduleCard(device.id, job.candidateToken, index),
        baseDate
      )
    ));
    expect(completions.every(Boolean)).toBe(true);
    const recentFactIds = await repositories[0].cardsRepository.listRecentFactIds(device.id, "broom", 4);
    expect(recentFactIds).toHaveLength(4);
    expect(new Set(recentFactIds).size).toBe(4);
    expect(recentFactIds.every((factId) => factId.startsWith("schedule-fact-"))).toBe(true);
    const dates = completions.map((completion) => completion!.card.scheduledDate).sort();
    const expectedDates = Array.from({ length: 32 }, (_, index) =>
      new Date(Date.UTC(2026, 6, 20 + index)).toISOString().slice(0, 10)
    );
    expect(dates).toEqual(expectedDates);

    const removed = completions.find((completion) => completion?.card.scheduledDate === "2026-07-22")!.card;
    await repositories[0].cardsRepository.deleteById(removed.cardId, device.id);
    const refillResult = await repositories[0].jobsRepository.createWithinBudget(
      createInput(device.id, "schedule-gap-refill", {
        status: "uploaded",
        objectKey: "analysis/schedule-gap-refill.image"
      }),
      createBudget()
    );
    if (refillResult.status !== "created") throw new Error("gap refill fixture creation failed");
    const refillClaim = randomUUID();
    expect(await repositories[1].jobsRepository.claimForProcessing(
      refillResult.job.id,
      refillClaim,
      new Date(Date.now() + 60_000).toISOString()
    )).not.toBeNull();
    const refilled = await repositories[2].jobsRepository.completeWithCard(
      refillResult.job.id,
      refillClaim,
      scheduleCard(device.id, refillResult.job.candidateToken, 32),
      baseDate
    );
    expect(refilled?.card.scheduledDate).toBe("2026-07-22");
  }, 30_000);

  it("persists bounded topic preferences and makes repeated feedback idempotent", async () => {
    const device = await repositories[0].devicesRepository.register("preference-installation", "preference-token");
    const card = await repositories[0].cardsRepository.create({
      deviceId: device.id,
      candidateToken: randomUUID(),
      topicId: "broom",
      factId: "broom-001",
      title: "扫帚为什么这样绑",
      detectedObjectName: "扫帚",
      body: "这是一条长度足够并经过审核的测试事实正文，只用于验证主题偏好的事务持久化。",
      personalContext: "因为它出现在你授权分析的照片中",
      confidence: 0.91,
      sources: [{
        sourceId: "broom-source",
        title: "Test source",
        url: "https://example.com/broom",
        publisher: "Example",
        authority: "reference"
      }],
      status: "scheduled",
      scheduledDate: "2026-07-18"
    });
    const input = { deviceId: device.id, cardId: card.cardId, topicId: card.topicId };
    const releaseRows = await repositories[0].sql<{ backend_release_sha256: string }[]>`
      SELECT backend_release_sha256 FROM cards WHERE id = ${card.cardId}`;
    expect(releaseRows[0]?.backend_release_sha256).toBe(backendReleaseSha256);
    expect((await repositories[0].cardsRepository.findById(card.cardId))?.detectedObjectName).toBe("扫帚");
    const first = await repositories[0].cardsRepository.addFeedback({ ...input, action: "LIKE" });
    const duplicate = await repositories[1].cardsRepository.addFeedback({ ...input, action: "LIKE" });
    const wrongObject = await repositories[2].cardsRepository.addFeedback({ ...input, action: "WRONG_OBJECT" });
    const disliked = await repositories[3].cardsRepository.addFeedback({ ...input, action: "DISLIKE" });

    expect(first.preference.weight).toBe(4);
    expect(duplicate.feedback.id).toBe(first.feedback.id);
    expect(duplicate.preference.weight).toBe(4);
    expect(wrongObject.preference.weight).toBe(0);
    expect((await repositories[0].cardsRepository.findById(card.cardId))?.status).toBe("archived");
    expect(disliked.feedback.action).toBe("WRONG_OBJECT");
    expect(disliked.preference.weight).toBe(0);
    expect(await repositories[0].cardsRepository.listPreferences(device.id)).toEqual([
      expect.objectContaining({ deviceId: device.id, topicId: "broom", weight: 0 })
    ]);
  });

  it("atomically suppresses, tombstones, and queues TOO_PRIVATE deletion exactly once", async () => {
    const device = await repositories[0].devicesRepository.register("private-installation", "private-token");
    const candidateToken = randomUUID();
    const objectKey = `analysis/${randomUUID()}.image`;
    const jobResult = await repositories[0].jobsRepository.createWithinBudget(
      createInput(device.id, candidateToken, { objectKey }),
      createBudget()
    );
    expect(jobResult.status).toBe("created");
    if (jobResult.status !== "created") throw new Error("Expected private deletion fixture job");
    const card = await repositories[0].cardsRepository.create({
      deviceId: device.id,
      candidateToken,
      topicId: "toothbrush",
      factId: "toothbrush-001",
      title: "Private deletion fixture",
      detectedObjectName: "牙刷",
      body: "This reviewed fixture fact body is long enough for the database constraint.",
      personalContext: "Authorized integration fixture",
      confidence: 0.92,
      sources: [{
        sourceId: "fixture-source",
        title: "Fixture source",
        url: "https://example.com/private",
        publisher: "Example",
        authority: "reference"
      }],
      status: "scheduled",
      scheduledDate: "2026-07-19"
    });

    const results = await Promise.all(repositories.map((repository) =>
      repository.cardsRepository.deleteTooPrivate(device.id, card.cardId)
    ));
    expect(results.every(Boolean)).toBe(true);
    expect(results.filter((result) => result?.alreadyDeleted === false)).toHaveLength(1);
    expect(results.filter((result) => result?.alreadyDeleted === true)).toHaveLength(3);
    expect(new Set(results.map((result) => result?.feedback.id)).size).toBe(1);
    expect(results.every((result) => result?.preference.weight === -8)).toBe(true);
    expect(await repositories[0].cardsRepository.findById(card.cardId)).toBeNull();
    expect(await repositories[0].jobsRepository.findById(jobResult.job.id)).toBeNull();
    expect(await repositories[0].jobsRepository.isCandidateSuppressed(device.id, candidateToken)).toBe(true);
    expect(await repositories[0].objectDeletionsRepository.list(10)).toEqual([objectKey]);
    const counts = await repositories[0].sql<{ receipts: string; preferences: string }[]>`
      SELECT
        (SELECT count(*)::text FROM privacy_deletion_receipts) AS receipts,
        (SELECT count(*)::text FROM topic_preferences WHERE device_id = ${device.id}) AS preferences`;
    expect(Number(counts[0]?.receipts)).toBe(1);
    expect(Number(counts[0]?.preferences)).toBe(1);
  }, 30_000);

  it("atomically binds and consumes a bounded authorized-evaluation lease", async () => {
    const leaseTokenHash = "b".repeat(64);
    const leaseId = randomUUID();
    const runId = "postgres-eval-run";
    const samples = Array.from({ length: 300 }, (_, index) => ({
      sampleId: `sample-${String(index).padStart(3, "0")}`,
      candidateToken: randomUUID()
    }));
    await repositories[0].jobsRepository.createEvaluationLease({
      id: leaseId,
      tokenHash: leaseTokenHash,
      datasetId: "postgres-eval-dataset",
      runId,
      labelsSha256: "c".repeat(64),
      maxJobs: 300,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      samples
    });
    const firstDevice = await repositories[0].devicesRepository.register("eval-installation-a", "eval-token-a");
    const secondDevice = await repositories[0].devicesRepository.register("eval-installation-b", "eval-token-b");
    const budget = createBudget({ deviceDailyLimit: 1 });
    const authorization = {
      tokenHash: leaseTokenHash,
      datasetId: "postgres-eval-dataset",
      runId,
      labelsSha256: "c".repeat(64),
      sampleId: samples[0]!.sampleId,
      now: new Date().toISOString()
    };
    const attempts = await Promise.all(Array.from({ length: 12 }, (_, index) =>
      repositories[index % repositories.length].jobsRepository.createWithinBudget(
        createInput(firstDevice.id, samples[0]!.candidateToken),
        budget,
        authorization
      )
    ));
    expect(attempts.filter((result) => result.status === "created")).toHaveLength(1);
    expect(attempts.filter((result) => result.status === "existing")).toHaveLength(11);
    expect((await repositories[0].jobsRepository.createWithinBudget(
      createInput(firstDevice.id),
      budget
    )).status).toBe("created");
    expect((await repositories[1].jobsRepository.createWithinBudget(
      createInput(firstDevice.id),
      budget
    )).status).toBe("device_daily_exceeded");
    expect((await repositories[1].jobsRepository.createWithinBudget(
      createInput(secondDevice.id, samples[1]!.candidateToken),
      budget,
      { ...authorization, sampleId: samples[1]!.sampleId }
    )).status).toBe("evaluation_device_mismatch");
    await repositories[0].devicesRepository.deleteCascade(firstDevice.id);
    const reinstalled = await repositories[0].devicesRepository.register("eval-installation-c", "eval-token-c");
    expect((await repositories[2].jobsRepository.createWithinBudget(
      createInput(reinstalled.id, samples[1]!.candidateToken),
      budget,
      { ...authorization, sampleId: samples[1]!.sampleId }
    )).status).toBe("evaluation_lease_revoked");
    expect(await repositories[0].jobsRepository.revokeEvaluationLease(leaseId, new Date().toISOString())).toBe(true);
  }, 30_000);
});

function scheduleCard(deviceId: string, candidateToken: string, index: number) {
  return {
    deviceId,
    candidateToken,
    topicId: "broom",
    factId: `schedule-fact-${index}`,
    title: `Schedule fixture ${index}`,
    detectedObjectName: "扫帚",
    body: "This reviewed scheduling fixture body is long enough for production constraints.",
    personalContext: "Authorized scheduling integration fixture",
    confidence: 0.91,
    sources: [{
      sourceId: "schedule-source",
      title: "Schedule source",
      url: "https://example.com/schedule",
      publisher: "Example",
      authority: "reference" as const
    }],
    status: "scheduled" as const
  };
}
