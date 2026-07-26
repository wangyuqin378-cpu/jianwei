import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "./config.js";
import type { EvaluationLeaseDefinition, VisionProvider } from "./domain/types.js";
import { LocalObjectStore, RotatingOssCredentialSource } from "./infrastructure/object-store.js";
import {
  buildServer,
  PRODUCTION_LOG_REDACT_PATHS,
  PRODUCTION_LOG_SERIALIZERS,
  updateOssCredentialsFromFcHeaders
} from "./server.js";
import { evaluationCandidateToken } from "./services/evaluation-lease.js";
import { installationBindingSha256 } from "./registration-binding.js";

const INSTALLATION_ID = "a2c468a6-8c08-4bbd-a1f1-0cb9ec0f30ad";
const SECOND_INSTALLATION_ID = "c31d7b10-5af0-4bdd-b7dd-5b65112cfa11";
const CANDIDATE_ID = "126820f9-8f55-4f30-888c-d5baab090b52";
const SECOND_CANDIDATE_ID = "7f684985-7f7a-49b5-8f02-2a893f875fee";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

it("redacts Function Compute credential headers from production logs", () => {
  expect(PRODUCTION_LOG_REDACT_PATHS).toEqual(expect.arrayContaining([
    "req.headers['x-fc-access-key-id']",
    "req.headers['x-fc-access-key-secret']",
    "req.headers['x-fc-security-token']"
    , "req.headers['x-jianwei-evaluation-lease']"
  ]));
});

it("serializes production logs without request instances, network identity, or exception text", () => {
  const serialized = {
    req: PRODUCTION_LOG_SERIALIZERS.req({
      method: "POST",
      url: `/v1/analysis-jobs/${CANDIDATE_ID}/complete?token=secret`,
      ip: "203.0.113.8",
      headers: { authorization: "Bearer secret" },
      routeOptions: { url: "/v1/analysis-jobs/:id/complete" }
    }),
    res: PRODUCTION_LOG_SERIALIZERS.res({ statusCode: 502, headers: { "set-cookie": "secret" } }),
    err: PRODUCTION_LOG_SERIALIZERS.err({
      name: "UpstreamError",
      code: "vision_provider_error",
      message: "Bearer secret at https://private.example/path",
      stack: "secret stack"
    })
  };
  expect(serialized).toEqual({
    req: { method: "POST", route: "/v1/analysis-jobs/:id/complete" },
    res: { statusCode: 502 },
    err: { type: "UpstreamError", code: "vision_provider_error", message: "request_failed", stack: "" }
  });
  expect(JSON.stringify(serialized)).not.toMatch(/secret|203\.0\.113\.8|https:|Bearer|126820f9/i);
});

it("rejects test service overrides outside the test environment", async () => {
  const config = testConfig("unused");
  config.environment = "development";
  await expect(buildServer({ config, backendReleaseSha256: "c".repeat(64) })).rejects.toThrow(
    "Server service overrides are test-only"
  );
});

it("rotates complete Function Compute credentials and rejects missing production credentials", () => {
  const source = new RotatingOssCredentialSource({
    accessKeyId: "initial-id",
    accessKeySecret: "initial-secret",
    stsToken: "initial-token"
  });
  expect(updateOssCredentialsFromFcHeaders({
    "x-fc-access-key-id": "rotated-id",
    "x-fc-access-key-secret": "rotated-secret",
    "x-fc-security-token": "rotated-token"
  }, source, true)).toBe("updated");
  expect(source.snapshot()).toEqual({
    accessKeyId: "rotated-id",
    accessKeySecret: "rotated-secret",
    stsToken: "rotated-token"
  });
  expect(() => updateOssCredentialsFromFcHeaders({}, source, true)).toThrowError(
    expect.objectContaining({ code: "fc_credentials_missing", statusCode: 503 })
  );
  expect(() => updateOssCredentialsFromFcHeaders({
    "x-fc-access-key-id": "partial-id"
  }, source, false)).toThrowError(
    expect.objectContaining({ code: "fc_credentials_incomplete", statusCode: 503 })
  );
});

it("wires invocation credential rotation into non-production OSS test overrides", async () => {
  const objectDir = await temporaryObjectDir();
  const source = new RotatingOssCredentialSource({
    accessKeyId: "initial-id",
    accessKeySecret: "initial-secret",
    stsToken: "initial-token"
  });
  const app = await buildServer({
    config: testConfig(objectDir),
    objects: new LocalObjectStore(objectDir, "http://127.0.0.1:8787", 24),
    ossCredentials: source
  });
  const response = await app.inject({
    method: "GET",
    url: "/health/ready",
    headers: {
      "x-fc-access-key-id": "request-id",
      "x-fc-access-key-secret": "request-secret",
      "x-fc-security-token": "request-token"
    }
  });
  expect(response.statusCode).toBe(200);
  expect(source.snapshot()).toEqual({
    accessKeyId: "request-id",
    accessKeySecret: "request-secret",
    stsToken: "request-token"
  });
  await app.close();
});

describe("见微 API", () => {
  it("rejects malformed registration bodies with whitespace-prefixed content types", async () => {
    const objectDir = await temporaryObjectDir();
    const app = await buildServer({ config: testConfig(objectDir), backendReleaseSha256: "c".repeat(64) });
    const response = await app.inject({
      method: "POST",
      url: "/v1/devices/register",
      headers: { "content-type": " application/json" },
      payload: JSON.stringify({ installationId: "not-a-uuid" })
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("invalid_request");
    await app.close();
  });

  it("returns privacy-safe response headers", async () => {
    const objectDir = await temporaryObjectDir();
    const app = await buildServer({ config: testConfig(objectDir), backendReleaseSha256: "c".repeat(64) });
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    const live = await app.inject({ method: "GET", url: "/health/live" });
    const ready = await app.inject({ method: "GET", url: "/health/ready" });
    expect(live.json()).toEqual({ ok: true });
    expect(ready.json()).toMatchObject({ ok: true, backendReleaseSha256: "c".repeat(64) });
    await app.close();
  });

  it("rejects an impossible capture date before creating an upload target", async () => {
    const objectDir = await temporaryObjectDir();
    const app = await buildServer({ config: testConfig(objectDir) });
    const token = await register(app);
    const response = await app.inject({
      method: "POST",
      url: "/v1/analysis-jobs",
      headers: bearer(token),
      payload: {
        candidateToken: CANDIDATE_ID,
        capturedAtBucket: "2026-02-31",
        localLabels: ["broom"],
        qualityScore: 0.91,
        sensitiveFlags: [],
        contentType: "image/jpeg"
      }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("invalid_request");
    expect(await readdir(objectDir)).toEqual([]);
    await app.close();
  });

  it("completes the anonymous photo-to-card loop and deletes the uploaded image", async () => {
    const objectDir = await temporaryObjectDir();
    const app = await buildServer({ config: testConfig(objectDir) });

    const registered = await app.inject({
      method: "POST",
      url: "/v1/devices/register",
      payload: { installationId: INSTALLATION_ID }
    });
    expect(registered.statusCode).toBe(201);
    const token = registered.json().deviceToken as string;
    expect(token).not.toBe(INSTALLATION_ID);

    const created = await app.inject({
      method: "POST",
      url: "/v1/analysis-jobs",
      headers: bearer(token),
      payload: {
        candidateToken: CANDIDATE_ID,
        capturedAtBucket: "2026-07-18",
        localLabels: ["broom", "cleaning tool"],
        qualityScore: 0.91,
        sensitiveFlags: [],
        contentType: "image/jpeg"
      }
    });
    expect(created.statusCode).toBe(201);
    const jobId = created.json().jobId as string;
    expect(created.json().candidateToken).toBe(CANDIDATE_ID);
    const uploadSessionId = created.json().uploadSessionId as string;
    const oneTimeUploadPath = uploadPath(created.json().uploadUrl as string);
    expect(oneTimeUploadPath).toMatch(/^\/v1\/analysis-jobs\/[0-9a-f-]{36}\/image$/);
    expect(oneTimeUploadPath).toBe(`/v1/analysis-jobs/${uploadSessionId}/image`);
    expect(oneTimeUploadPath).not.toBe(`/v1/analysis-jobs/${jobId}/image`);

    const uploaded = await app.inject({
      method: "PUT",
      url: oneTimeUploadPath,
      headers: { ...bearer(token), "content-type": "image/jpeg" },
      payload: jpegPayload(7)
    });
    expect(uploaded.statusCode).toBe(200);
    expect(uploaded.json()).toEqual({
      jobId,
      candidateToken: CANDIDATE_ID,
      uploadSessionId,
      status: "uploaded"
    });

    const completed = await app.inject({
      method: "POST",
      url: `/v1/analysis-jobs/${jobId}/complete`,
      headers: bearer(token)
    });
    expect(completed.statusCode).toBe(200);
    const card = completed.json().card;
    expect(completed.json().jobId).toBe(jobId);
    expect(completed.json().candidateToken).toBe(CANDIDATE_ID);
    expect(completed.json().status).toBe("completed");
    expect(card.topicId).toBe("broom");
    expect(card.factId).toBe("broom-001");
    expect(card.detectedObjectName).toBe("扫帚");
    expect(card.body.length).toBeGreaterThanOrEqual(28);
    expect(card.sources[0].url).toMatch(/^https:\/\//);
    expect(await readdir(objectDir)).toEqual([]);

    const listed = await app.inject({ method: "GET", url: "/v1/cards", headers: bearer(token) });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items).toHaveLength(1);
    expect(listed.json().items[0].detectedObjectName).toBe("扫帚");

    const duplicate = await app.inject({
      method: "POST",
      url: "/v1/analysis-jobs",
      headers: bearer(token),
      payload: {
        candidateToken: CANDIDATE_ID,
        capturedAtBucket: "2026-07-18",
        localLabels: ["broom"],
        qualityScore: 0.91,
        sensitiveFlags: [],
        contentType: "image/jpeg"
      }
    });
    expect(duplicate.statusCode).toBe(201);
    expect(duplicate.json().jobId).toBe(jobId);
    expect(duplicate.json().candidateToken).toBe(CANDIDATE_ID);
    expect(duplicate.json().status).toBe("completed");
    expect(duplicate.json().uploadUrl).toBe("");
    expect(duplicate.json().uploadSessionId).toBeNull();

    const feedback = await app.inject({
      method: "POST",
      url: `/v1/cards/${card.cardId}/feedback`,
      headers: bearer(token),
      payload: { action: "LIKE" }
    });
    expect(feedback.statusCode).toBe(201);
    expect(feedback.json().id).toMatch(/^[0-9a-f-]{36}$/);
    expect(feedback.json().cardId).toBe(card.cardId);
    expect(feedback.json().action).toBe("LIKE");
    expect(Number.isNaN(Date.parse(feedback.json().createdAt))).toBe(false);
    expect(feedback.json().topicAffinities).toEqual([
      { topicId: "broom", weight: 0.4, aliases: [] }
    ]);
    const repeatedFeedback = await app.inject({
      method: "POST",
      url: `/v1/cards/${card.cardId}/feedback`,
      headers: bearer(token),
      payload: { action: "LIKE" }
    });
    expect(repeatedFeedback.statusCode).toBe(201);
    expect(repeatedFeedback.json().id).toBe(feedback.json().id);
    expect(repeatedFeedback.json().topicAffinities[0].weight).toBe(0.4);
    const saved = await app.inject({
      method: "POST",
      url: `/v1/cards/${card.cardId}/feedback`,
      headers: bearer(token),
      payload: { action: "SAVE" }
    });
    expect(saved.statusCode).toBe(201);
    expect(saved.json().action).toBe("SAVE");
    expect(saved.json().topicAffinities[0].weight).toBe(0.9);
    const savedAgain = await app.inject({
      method: "POST",
      url: `/v1/cards/${card.cardId}/feedback`,
      headers: bearer(token),
      payload: { action: "SAVE" }
    });
    expect(savedAgain.statusCode).toBe(201);
    expect(savedAgain.json().id).toBe(saved.json().id);
    expect(savedAgain.json().topicAffinities[0].weight).toBe(0.9);

    const tracked = await app.inject({
      method: "POST",
      url: `/v1/items/${card.cardId}/track`,
      headers: bearer(token),
      payload: { startedOn: "2026-07-18", reminderDays: 90 }
    });
    expect(tracked.statusCode).toBe(201);
    expect(tracked.json().startedOn).toBe("2026-07-18");
    const retracked = await app.inject({
      method: "POST",
      url: `/v1/items/${card.cardId}/track`,
      headers: bearer(token),
      payload: { startedOn: "2026-07-19", reminderDays: 120 }
    });
    expect(retracked.statusCode).toBe(201);
    expect(retracked.json().id).toBe(tracked.json().id);
    expect(retracked.json().reminderDays).toBe(120);

    const otherToken = await register(app, SECOND_INSTALLATION_ID);
    const ownedJob = await app.inject({
      method: "GET",
      url: `/v1/analysis-jobs/${jobId}`,
      headers: bearer(token)
    });
    expect(ownedJob.statusCode).toBe(200);
    expect(ownedJob.json()).toMatchObject({ jobId, candidateToken: CANDIDATE_ID });
    expect(Object.keys(ownedJob.json()).sort()).toEqual([
      "candidateToken", "createdAt", "errorCode", "jobId", "status", "updatedAt"
    ]);
    const foreignJob = await app.inject({
      method: "GET",
      url: `/v1/analysis-jobs/${jobId}`,
      headers: bearer(otherToken)
    });
    const foreignFeedback = await app.inject({
      method: "POST",
      url: `/v1/cards/${card.cardId}/feedback`,
      headers: bearer(otherToken),
      payload: { action: "LIKE" }
    });
    const foreignTrack = await app.inject({
      method: "POST",
      url: `/v1/items/${card.cardId}/track`,
      headers: bearer(otherToken),
      payload: { startedOn: "2026-07-18", reminderDays: 90 }
    });
    const foreignUntrack = await app.inject({
      method: "DELETE",
      url: `/v1/items/${card.cardId}/track`,
      headers: bearer(otherToken)
    });
    const foreignCards = await app.inject({ method: "GET", url: "/v1/cards", headers: bearer(otherToken) });
    const foreignCursor = await app.inject({
      method: "GET",
      url: `/v1/cards?cursor=${card.cardId}`,
      headers: bearer(otherToken)
    });
    expect(foreignJob.statusCode).toBe(404);
    expect(foreignFeedback.statusCode).toBe(404);
    expect(foreignTrack.statusCode).toBe(404);
    expect(foreignUntrack.statusCode).toBe(204);
    expect(foreignCards.json().items).toEqual([]);
    expect(foreignCursor.statusCode).toBe(400);
    expect(foreignCursor.json().error.code).toBe("invalid_cursor");

    const stillTracked = await app.inject({
      method: "POST",
      url: `/v1/items/${card.cardId}/track`,
      headers: bearer(token),
      payload: { startedOn: "2026-07-19", reminderDays: 120 }
    });
    expect(stillTracked.json().id).toBe(retracked.json().id);
    const untracked = await app.inject({
      method: "DELETE",
      url: `/v1/items/${card.cardId}/track`,
      headers: bearer(token)
    });
    const untrackedAgain = await app.inject({
      method: "DELETE",
      url: `/v1/items/${card.cardId}/track`,
      headers: bearer(token)
    });
    expect(untracked.statusCode).toBe(204);
    expect(untrackedAgain.statusCode).toBe(204);
    const trackedAfterCancel = await app.inject({
      method: "POST",
      url: `/v1/items/${card.cardId}/track`,
      headers: bearer(token),
      payload: { startedOn: "2026-07-20", reminderDays: 180 }
    });
    expect(trackedAfterCancel.statusCode).toBe(201);
    expect(trackedAfterCancel.json().id).not.toBe(retracked.json().id);

    const tooPrivate = await app.inject({
      method: "POST",
      url: `/v1/cards/${card.cardId}/feedback`,
      headers: bearer(token),
      payload: { action: "TOO_PRIVATE" }
    });
    expect(tooPrivate.statusCode).toBe(201);
    expect(tooPrivate.json().id).toMatch(/^[0-9a-f-]{36}$/);
    expect(tooPrivate.json().cardId).toBe(card.cardId);
    expect(tooPrivate.json().action).toBe("TOO_PRIVATE");
    expect(Number.isNaN(Date.parse(tooPrivate.json().createdAt))).toBe(false);
    const tooPrivateAgain = await app.inject({
      method: "POST",
      url: `/v1/cards/${card.cardId}/feedback`,
      headers: bearer(token),
      payload: { action: "TOO_PRIVATE" }
    });
    expect(tooPrivateAgain.statusCode).toBe(201);
    expect(tooPrivateAgain.json().id).toBe(tooPrivate.json().id);
    expect(tooPrivateAgain.json().topicAffinities).toEqual(tooPrivate.json().topicAffinities);
    const afterPrivate = await app.inject({ method: "GET", url: "/v1/cards", headers: bearer(token) });
    expect(afterPrivate.json().items).toEqual([]);
    const purgedJob = await app.inject({
      method: "GET",
      url: `/v1/analysis-jobs/${jobId}`,
      headers: bearer(token)
    });
    expect(purgedJob.statusCode).toBe(404);
    const resurrected = await app.inject({
      method: "POST",
      url: "/v1/analysis-jobs",
      headers: bearer(token),
      payload: {
        candidateToken: CANDIDATE_ID,
        capturedAtBucket: null,
        localLabels: ["broom"],
        qualityScore: 0.9,
        sensitiveFlags: [],
        contentType: "image/jpeg"
      }
    });
    expect(resurrected.statusCode).toBe(410);
    expect(resurrected.json().error.code).toBe("candidate_suppressed");

    const deleted = await app.inject({ method: "DELETE", url: "/v1/device-data", headers: bearer(token) });
    expect(deleted.statusCode).toBe(204);
    const afterDelete = await app.inject({ method: "GET", url: "/v1/cards", headers: bearer(token) });
    expect(afterDelete.statusCode).toBe(401);
    await app.close();
  });

  it("uses the reviewed topic name consistently when vision returns an alias", async () => {
    const objectDir = await temporaryObjectDir();
    const vision: VisionProvider = {
      detect: async () => ({
        canonicalTopicId: "broom",
        displayName: "清扫刷",
        confidence: 0.68,
        boundingBox: null,
        alternatives: ["扫帚"],
        sensitiveFlags: []
      })
    };
    const app = await buildServer({ config: testConfig(objectDir), vision });
    const token = await register(app);
    const created = await app.inject({
      method: "POST",
      url: "/v1/analysis-jobs",
      headers: bearer(token),
      payload: {
        candidateToken: CANDIDATE_ID,
        capturedAtBucket: "2026-07-18",
        localLabels: ["cleaning tool"],
        qualityScore: 0.91,
        sensitiveFlags: [],
        contentType: "image/jpeg"
      }
    });
    expect(created.statusCode).toBe(201);
    const jobId = created.json().jobId as string;
    expect((await app.inject({
      method: "PUT",
      url: uploadPath(created.json().uploadUrl as string),
      headers: { ...bearer(token), "content-type": "image/jpeg" },
      payload: jpegPayload(8)
    })).statusCode).toBe(200);

    const completed = await app.inject({
      method: "POST",
      url: `/v1/analysis-jobs/${jobId}/complete`,
      headers: bearer(token)
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.json().card).toMatchObject({
      topicId: "broom",
      detectedObjectName: "扫帚",
      title: "这可能是扫帚",
      personalContext: "你在 2026 年 7 月 18 日拍下了「扫帚」，所以今天从它讲起。",
      confidence: 0.68
    });
    expect(await readdir(objectDir)).toEqual([]);
    await app.close();
  });

  it("archives a wrong-object card and revokes its prior interest signals", async () => {
    const objectDir = await temporaryObjectDir();
    const app = await buildServer({ config: testConfig(objectDir) });
    const token = await register(app);
    const card = await completeTestCard(app, token, CANDIDATE_ID);

    const saved = await app.inject({
      method: "POST",
      url: `/v1/cards/${card.cardId}/feedback`,
      headers: bearer(token),
      payload: { action: "SAVE" }
    });
    expect(saved.json().topicAffinities[0].weight).toBe(0.5);

    const wrong = await app.inject({
      method: "POST",
      url: `/v1/cards/${card.cardId}/feedback`,
      headers: bearer(token),
      payload: { action: "WRONG_OBJECT" }
    });
    expect(wrong.statusCode).toBe(201);
    expect(wrong.json().action).toBe("WRONG_OBJECT");
    expect(wrong.json().topicAffinities[0].weight).toBe(0);

    const listed = await app.inject({ method: "GET", url: "/v1/cards", headers: bearer(token) });
    expect(listed.json().items).toEqual([
      expect.objectContaining({ cardId: card.cardId, status: "archived" })
    ]);
    const staleLike = await app.inject({
      method: "POST",
      url: `/v1/cards/${card.cardId}/feedback`,
      headers: bearer(token),
      payload: { action: "LIKE" }
    });
    expect(staleLike.json().action).toBe("WRONG_OBJECT");
    expect(staleLike.json().topicAffinities[0].weight).toBe(0);
    expect(await readdir(objectDir)).toEqual([]);
    await app.close();
  });

  it("rejects a sensitive candidate before creating an upload target", async () => {
    const objectDir = await temporaryObjectDir();
    const app = await buildServer({ config: testConfig(objectDir) });
    const token = await register(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/analysis-jobs",
      headers: bearer(token),
      payload: {
        candidateToken: CANDIDATE_ID,
        capturedAtBucket: null,
        localLabels: ["document"],
        qualityScore: 0.9,
        sensitiveFlags: ["high_text_density"],
        contentType: "image/jpeg"
      }
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("sensitive_candidate");
    await app.close();
  });

  it("rejects a server-detected sensitive image even when a client reports no flags", async () => {
    const objectDir = await temporaryObjectDir();
    const vision: VisionProvider = {
      detect: async () => ({
        canonicalTopicId: "broom",
        displayName: "扫帚",
        confidence: 0.99,
        boundingBox: null,
        alternatives: [],
        sensitiveFlags: ["face"]
      })
    };
    const app = await buildServer({ config: testConfig(objectDir), vision });
    const token = await register(app);
    const created = await app.inject({
      method: "POST",
      url: "/v1/analysis-jobs",
      headers: bearer(token),
      payload: {
        candidateToken: CANDIDATE_ID,
        capturedAtBucket: null,
        localLabels: ["broom"],
        qualityScore: 0.99,
        sensitiveFlags: [],
        contentType: "image/jpeg"
      }
    });
    const jobId = created.json().jobId as string;
    await app.inject({
      method: "PUT",
      url: uploadPath(created.json().uploadUrl as string),
      headers: { ...bearer(token), "content-type": "image/jpeg" },
      payload: jpegPayload(6)
    });

    const completed = await app.inject({
      method: "POST",
      url: `/v1/analysis-jobs/${jobId}/complete`,
      headers: bearer(token)
    });
    const cards = await app.inject({ method: "GET", url: "/v1/cards", headers: bearer(token) });

    expect(completed.statusCode).toBe(200);
    expect(completed.json().status).toBe("rejected");
    expect(completed.json().card).toBeNull();
    expect(cards.json().items).toEqual([]);
    expect(await readdir(objectDir)).toEqual([]);
    await app.close();
  });

  it("never publishes a draft-only topic", async () => {
    const objectDir = await temporaryObjectDir();
    const app = await buildServer({ config: testConfig(objectDir) });
    const token = await register(app);
    const created = await app.inject({
      method: "POST",
      url: "/v1/analysis-jobs",
      headers: bearer(token),
      payload: {
        candidateToken: CANDIDATE_ID,
        capturedAtBucket: null,
        localLabels: ["mug", "coffee cup"],
        qualityScore: 0.9,
        sensitiveFlags: [],
        contentType: "image/jpeg"
      }
    });
    const jobId = created.json().jobId as string;
    await app.inject({
      method: "PUT",
      url: uploadPath(created.json().uploadUrl as string),
      headers: { ...bearer(token), "content-type": "image/jpeg" },
      payload: jpegPayload(4)
    });
    const completed = await app.inject({ method: "POST", url: `/v1/analysis-jobs/${jobId}/complete`, headers: bearer(token) });
    expect(completed.statusCode).toBe(200);
    expect(completed.json().status).toBe("needs_content");
    expect(completed.json().card).toBeNull();
    const cards = await app.inject({ method: "GET", url: "/v1/cards", headers: bearer(token) });
    expect(cards.json().items).toEqual([]);
    await app.close();
  });

  it("enforces a hard monthly candidate budget", async () => {
    const objectDir = await temporaryObjectDir();
    const config = testConfig(objectDir);
    config.maxJobsPerDevicePerMonth = 1;
    const app = await buildServer({ config });
    const token = await register(app);
    const payload = {
      capturedAtBucket: null,
      localLabels: ["broom"],
      qualityScore: 0.9,
      sensitiveFlags: [],
      contentType: "image/jpeg"
    };
    const first = await app.inject({
      method: "POST",
      url: "/v1/analysis-jobs",
      headers: bearer(token),
      payload: { ...payload, candidateToken: CANDIDATE_ID }
    });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({
      method: "POST",
      url: "/v1/analysis-jobs",
      headers: bearer(token),
      payload: { ...payload, candidateToken: SECOND_CANDIDATE_ID }
    });
    expect(second.statusCode).toBe(429);
    expect(second.json().error.code).toBe("monthly_budget_exceeded");
    await app.close();
  });

  it("keeps the global daily cost fuse after device deletion and anonymous reinstall", async () => {
    const objectDir = await temporaryObjectDir();
    const config = testConfig(objectDir);
    config.maxJobsGlobalPerDay = 1;
    const app = await buildServer({ config });
    const firstToken = await register(app, INSTALLATION_ID);
    const payload = {
      capturedAtBucket: null,
      localLabels: ["broom"],
      qualityScore: 0.9,
      sensitiveFlags: [],
      contentType: "image/jpeg"
    };
    const first = await app.inject({
      method: "POST",
      url: "/v1/analysis-jobs",
      headers: bearer(firstToken),
      payload: { ...payload, candidateToken: CANDIDATE_ID }
    });
    expect(first.statusCode).toBe(201);

    const deleted = await app.inject({ method: "DELETE", url: "/v1/device-data", headers: bearer(firstToken) });
    expect(deleted.statusCode).toBe(204);
    const reinstalledToken = await register(app, SECOND_INSTALLATION_ID);
    const afterReinstall = await app.inject({
      method: "POST",
      url: "/v1/analysis-jobs",
      headers: bearer(reinstalledToken),
      payload: { ...payload, candidateToken: SECOND_CANDIDATE_ID }
    });
    expect(afterReinstall.statusCode).toBe(429);
    expect(afterReinstall.json().error.code).toBe("global_daily_budget_exceeded");
    await app.close();
  });

  it("enforces the global monthly cost fuse across anonymous devices", async () => {
    const objectDir = await temporaryObjectDir();
    const config = testConfig(objectDir);
    config.maxJobsGlobalPerMonth = 1;
    const app = await buildServer({ config });
    const firstToken = await register(app, INSTALLATION_ID);
    const secondToken = await register(app, SECOND_INSTALLATION_ID);
    const payload = {
      capturedAtBucket: null,
      localLabels: ["broom"],
      qualityScore: 0.9,
      sensitiveFlags: [],
      contentType: "image/jpeg"
    };
    const first = await app.inject({
      method: "POST",
      url: "/v1/analysis-jobs",
      headers: bearer(firstToken),
      payload: { ...payload, candidateToken: CANDIDATE_ID }
    });
    const second = await app.inject({
      method: "POST",
      url: "/v1/analysis-jobs",
      headers: bearer(secondToken),
      payload: { ...payload, candidateToken: SECOND_CANDIDATE_ID }
    });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(429);
    expect(second.json().error.code).toBe("global_monthly_budget_exceeded");
    await app.close();
  });

  it("reserves the configured worst-case model cost before creating a job", async () => {
    const objectDir = await temporaryObjectDir();
    const config = testConfig(objectDir);
    config.worstCaseCostMicroCnyPerJob = 7;
    config.maxGlobalCostMicroCnyPerDay = 10;
    const app = await buildServer({ config });
    const token = await register(app);
    const payload = {
      capturedAtBucket: null,
      localLabels: ["broom"],
      qualityScore: 0.9,
      sensitiveFlags: [],
      contentType: "image/jpeg"
    };
    const first = await app.inject({
      method: "POST",
      url: "/v1/analysis-jobs",
      headers: bearer(token),
      payload: { ...payload, candidateToken: CANDIDATE_ID }
    });
    const second = await app.inject({
      method: "POST",
      url: "/v1/analysis-jobs",
      headers: bearer(token),
      payload: { ...payload, candidateToken: SECOND_CANDIDATE_ID }
    });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(429);
    expect(second.json().error.code).toBe("global_daily_cost_budget_exceeded");
    await app.close();
  });

  it("does not reserve model cost again when a retry reuses the same candidate", async () => {
    const objectDir = await temporaryObjectDir();
    const config = testConfig(objectDir);
    config.worstCaseCostMicroCnyPerJob = 7;
    config.maxGlobalCostMicroCnyPerDay = 7;
    config.maxGlobalCostMicroCnyPerMonth = 7;
    const app = await buildServer({ config });
    const token = await register(app);
    const payload = {
      candidateToken: CANDIDATE_ID,
      capturedAtBucket: null,
      localLabels: ["broom"],
      qualityScore: 0.9,
      sensitiveFlags: [],
      contentType: "image/jpeg"
    };
    const first = await app.inject({
      method: "POST", url: "/v1/analysis-jobs", headers: bearer(token), payload
    });
    const retry = await app.inject({
      method: "POST", url: "/v1/analysis-jobs", headers: bearer(token), payload
    });
    const newCandidate = await app.inject({
      method: "POST",
      url: "/v1/analysis-jobs",
      headers: bearer(token),
      payload: { ...payload, candidateToken: SECOND_CANDIDATE_ID }
    });
    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(201);
    expect(retry.json().jobId).toBe(first.json().jobId);
    expect(newCandidate.statusCode).toBe(429);
    expect(newCandidate.json().error.code).toBe("global_daily_cost_budget_exceeded");
    await app.close();
  });

  it("rejects a payload whose bytes do not match its image content type", async () => {
    const objectDir = await temporaryObjectDir();
    const app = await buildServer({ config: testConfig(objectDir) });
    const token = await register(app);
    const created = await app.inject({
      method: "POST",
      url: "/v1/analysis-jobs",
      headers: bearer(token),
      payload: {
        candidateToken: CANDIDATE_ID,
        capturedAtBucket: null,
        localLabels: ["broom"],
        qualityScore: 0.9,
        sensitiveFlags: [],
        contentType: "image/jpeg"
      }
    });
    const uploaded = await app.inject({
      method: "PUT",
      url: uploadPath(created.json().uploadUrl as string),
      headers: { ...bearer(token), "content-type": "image/jpeg" },
      payload: Buffer.from("<html>not an image</html>".padEnd(64, "!"))
    });
    expect(uploaded.statusCode).toBe(415);
    expect(uploaded.json().error.code).toBe("invalid_image_content");
    await app.close();
  });

  it("revalidates stored bytes before model analysis", async () => {
    const objectDir = await temporaryObjectDir();
    const app = await buildServer({ config: testConfig(objectDir) });
    const token = await register(app);
    const created = await app.inject({
      method: "POST",
      url: "/v1/analysis-jobs",
      headers: bearer(token),
      payload: {
        candidateToken: CANDIDATE_ID,
        capturedAtBucket: null,
        localLabels: ["broom"],
        qualityScore: 0.9,
        sensitiveFlags: [],
        contentType: "image/jpeg"
      }
    });
    const jobId = created.json().jobId as string;
    await app.inject({
      method: "PUT",
      url: uploadPath(created.json().uploadUrl as string),
      headers: { ...bearer(token), "content-type": "image/jpeg" },
      payload: jpegPayload(9)
    });
    const [storedObject] = await readdir(objectDir);
    expect(storedObject).toMatch(new RegExp(`^${jobId}-[0-9a-f-]{36}\\.image$`, "i"));
    await writeFile(path.join(objectDir, storedObject!), Buffer.from("not-a-jpeg".padEnd(64, "!")));

    const completed = await app.inject({
      method: "POST",
      url: `/v1/analysis-jobs/${jobId}/complete`,
      headers: bearer(token)
    });
    expect(completed.statusCode).toBe(415);
    expect(completed.json().error.code).toBe("invalid_image_content");
    expect(await readdir(objectDir)).toEqual([]);
    await app.close();
  });

  it("rejects an oversized direct-upload object from metadata before model analysis", async () => {
    const objectDir = await temporaryObjectDir();
    let visionCalled = false;
    const vision: VisionProvider = {
      detect: async () => {
        visionCalled = true;
        throw new Error("vision must not receive oversized objects");
      }
    };
    const app = await buildServer({ config: testConfig(objectDir), vision });
    const token = await register(app);
    const created = await app.inject({
      method: "POST",
      url: "/v1/analysis-jobs",
      headers: bearer(token),
      payload: {
        candidateToken: CANDIDATE_ID,
        capturedAtBucket: null,
        localLabels: ["broom"],
        qualityScore: 0.9,
        sensitiveFlags: [],
        contentType: "image/jpeg"
      }
    });
    const jobId = created.json().jobId as string;
    const uploaded = await app.inject({
      method: "PUT",
      url: uploadPath(created.json().uploadUrl as string),
      headers: { ...bearer(token), "content-type": "image/jpeg" },
      payload: jpegPayload(4)
    });
    expect(uploaded.statusCode).toBe(200);
    const [storedObject] = await readdir(objectDir);
    expect(storedObject).toMatch(new RegExp(`^${jobId}-[0-9a-f-]{36}\\.image$`, "i"));
    await writeFile(path.join(objectDir, storedObject!), jpegPayload(4, 3 * 1024 * 1024 + 1));

    const completed = await app.inject({
      method: "POST",
      url: `/v1/analysis-jobs/${jobId}/complete`,
      headers: bearer(token)
    });
    expect(completed.statusCode).toBe(413);
    expect(completed.json().error.code).toBe("invalid_image_size");
    expect(visionCalled).toBe(false);
    expect(await readdir(objectDir)).toEqual([]);
    await app.close();
  });

  it("atomically claims completion so concurrent retries call the model and publish only once", async () => {
    const objectDir = await temporaryObjectDir();
    let enterVision!: () => void;
    let releaseVision!: () => void;
    const entered = new Promise<void>((resolve) => { enterVision = resolve; });
    const release = new Promise<void>((resolve) => { releaseVision = resolve; });
    let visionCalls = 0;
    const vision: VisionProvider = {
      detect: async () => {
        visionCalls += 1;
        enterVision();
        await release;
        return {
          canonicalTopicId: "broom",
          displayName: "扫帚",
          confidence: 0.99,
          boundingBox: null,
          alternatives: [],
          sensitiveFlags: []
        };
      }
    };
    const app = await buildServer({ config: testConfig(objectDir), vision });
    const token = await register(app);
    const created = await app.inject({
      method: "POST",
      url: "/v1/analysis-jobs",
      headers: bearer(token),
      payload: {
        candidateToken: CANDIDATE_ID,
        capturedAtBucket: null,
        localLabels: ["broom"],
        qualityScore: 0.9,
        sensitiveFlags: [],
        contentType: "image/jpeg"
      }
    });
    const jobId = created.json().jobId as string;
    await app.inject({
      method: "PUT",
      url: uploadPath(created.json().uploadUrl as string),
      headers: { ...bearer(token), "content-type": "image/jpeg" },
      payload: jpegPayload(5)
    });

    const first = app.inject({ method: "POST", url: `/v1/analysis-jobs/${jobId}/complete`, headers: bearer(token) });
    await entered;
    const second = app.inject({ method: "POST", url: `/v1/analysis-jobs/${jobId}/complete`, headers: bearer(token) });
    releaseVision();
    const responses = await Promise.all([first, second]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    expect(visionCalls).toBe(1);
    const listed = await app.inject({ method: "GET", url: "/v1/cards", headers: bearer(token) });
    expect(listed.json().items).toHaveLength(1);
    await app.close();
  });

  it("rotates server-issued tokens without changing the anonymous device", async () => {
    const objectDir = await temporaryObjectDir();
    const app = await buildServer({ config: testConfig(objectDir) });
    const first = await app.inject({
      method: "POST",
      url: "/v1/devices/register",
      payload: { installationId: INSTALLATION_ID }
    });
    const second = await app.inject({
      method: "POST",
      url: "/v1/devices/register",
      payload: { installationId: INSTALLATION_ID }
    });
    expect(first.json().deviceId).toBe(second.json().deviceId);
    expect(first.json().created).toBe(true);
    expect(second.json().created).toBe(false);
    expect(first.json().deviceToken).not.toBe(second.json().deviceToken);
    expect(first.json().deviceToken).not.toBe(INSTALLATION_ID);
    expect(first.json().deviceToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.json().installationBindingSha256).toBe(installationBindingSha256(INSTALLATION_ID));
    expect(second.json().installationBindingSha256).toBe(first.json().installationBindingSha256);
    expect(JSON.stringify(first.json())).not.toContain(INSTALLATION_ID);

    const oldTokenResponse = await app.inject({
      method: "GET",
      url: "/v1/cards",
      headers: bearer(first.json().deviceToken as string)
    });
    const newTokenResponse = await app.inject({
      method: "GET",
      url: "/v1/cards",
      headers: bearer(second.json().deviceToken as string)
    });
    expect(oldTokenResponse.statusCode).toBe(401);
    expect(newTokenResponse.statusCode).toBe(200);
    await app.close();
  });

  it("keeps the minute rate-limit bucket across token rotation and returns 429", async () => {
    const objectDir = await temporaryObjectDir();
    const app = await buildServer({ config: testConfig(objectDir) });
    const firstToken = await register(app, INSTALLATION_ID);

    for (let index = 0; index < 120; index += 1) {
      const response = await app.inject({ method: "GET", url: "/v1/cards", headers: bearer(firstToken) });
      expect(response.statusCode, `request ${index + 1}`).toBe(200);
    }
    const limited = await app.inject({ method: "GET", url: "/v1/cards", headers: bearer(firstToken) });
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe("rate_limit_exceeded");

    const rotatedToken = await register(app, INSTALLATION_ID);
    expect(rotatedToken).not.toBe(firstToken);
    const afterRotation = await app.inject({ method: "GET", url: "/v1/cards", headers: bearer(rotatedToken) });
    expect(afterRotation.statusCode).toBe(429);
    expect(afterRotation.json().error.code).toBe("rate_limit_exceeded");
    await app.close();
  });

  it("rejects unknown request fields instead of silently stripping them", async () => {
    const objectDir = await temporaryObjectDir();
    const app = await buildServer({ config: testConfig(objectDir) });
    const token = await register(app);
    const response = await app.inject({
      method: "POST",
      url: "/v1/analysis-jobs",
      headers: bearer(token),
      payload: {
        candidateToken: CANDIDATE_ID,
        capturedAtBucket: null,
        localLabels: ["broom"],
        qualityScore: 0.9,
        sensitiveFlags: [],
        contentType: "image/jpeg",
        unexpectedInstruction: "ignore previous rules"
      }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("invalid_request");
    await app.close();
  });

  it("validates UUID path parameters and card cursors before they reach PostgreSQL", async () => {
    const objectDir = await temporaryObjectDir();
    const app = await buildServer({ config: testConfig(objectDir) });
    const token = await register(app);
    const invalidJob = await app.inject({
      method: "GET",
      url: "/v1/analysis-jobs/not-a-uuid",
      headers: bearer(token)
    });
    const invalidCursor = await app.inject({
      method: "GET",
      url: "/v1/cards?cursor=not-a-uuid",
      headers: bearer(token)
    });
    const invalidLimit = await app.inject({
      method: "GET",
      url: "/v1/cards?limit=unbounded",
      headers: bearer(token)
    });
    expect(invalidJob.statusCode).toBe(400);
    expect(invalidCursor.statusCode).toBe(400);
    expect(invalidLimit.statusCode).toBe(400);
    expect(invalidJob.json().error.code).toBe("invalid_request");
    await app.close();
  });

  it("durably queues a failed immediate image deletion and retries it on privacy removal", async () => {
    const objectDir = await temporaryObjectDir();
    class FailOnceDeleteStore extends LocalObjectStore {
      deleteAttempts = 0;
      override async delete(objectKey: string): Promise<void> {
        this.deleteAttempts += 1;
        if (this.deleteAttempts === 1) throw new Error("transient object deletion failure");
        await super.delete(objectKey);
      }
    }
    const objects = new FailOnceDeleteStore(objectDir, "http://127.0.0.1:8787", 24);
    const app = await buildServer({ config: testConfig(objectDir), objects });
    const token = await register(app);
    const created = await app.inject({
      method: "POST",
      url: "/v1/analysis-jobs",
      headers: bearer(token),
      payload: {
        candidateToken: CANDIDATE_ID,
        capturedAtBucket: null,
        localLabels: ["broom"],
        qualityScore: 0.9,
        sensitiveFlags: [],
        contentType: "image/jpeg"
      }
    });
    const jobId = created.json().jobId as string;
    await app.inject({
      method: "PUT",
      url: uploadPath(created.json().uploadUrl as string),
      headers: { ...bearer(token), "content-type": "image/jpeg" },
      payload: jpegPayload(5)
    });
    const completed = await app.inject({
      method: "POST",
      url: `/v1/analysis-jobs/${jobId}/complete`,
      headers: bearer(token)
    });
    expect(completed.statusCode).toBe(200);
    expect(await readdir(objectDir)).toEqual([
      expect.stringMatching(new RegExp(`^${jobId}-[0-9a-f-]{36}\\.image$`, "i"))
    ]);

    const removed = await app.inject({
      method: "POST",
      url: `/v1/cards/${completed.json().card.cardId as string}/feedback`,
      headers: bearer(token),
      payload: { action: "TOO_PRIVATE" }
    });
    expect(removed.statusCode).toBe(201);
    expect(objects.deleteAttempts).toBe(2);
    expect(await readdir(objectDir)).toEqual([]);
    const removedAgain = await app.inject({
      method: "POST",
      url: `/v1/cards/${completed.json().card.cardId as string}/feedback`,
      headers: bearer(token),
      payload: { action: "TOO_PRIVATE" }
    });
    expect(removedAgain.statusCode).toBe(201);
    expect(removedAgain.json().id).toBe(removed.json().id);
    expect(objects.deleteAttempts).toBe(2);
    await app.close();
  });

  it("consumes an upload URL once and cannot resurrect it after device deletion", async () => {
    const objectDir = await temporaryObjectDir();
    const app = await buildServer({ config: testConfig(objectDir) });
    const token = await register(app);
    const created = await app.inject({
      method: "POST",
      url: "/v1/analysis-jobs",
      headers: bearer(token),
      payload: {
        candidateToken: CANDIDATE_ID,
        capturedAtBucket: null,
        localLabels: ["broom"],
        qualityScore: 0.9,
        sensitiveFlags: [],
        contentType: "image/jpeg"
      }
    });
    const oneTimePath = uploadPath(created.json().uploadUrl as string);
    const first = await app.inject({
      method: "PUT",
      url: oneTimePath,
      headers: { ...bearer(token), "content-type": "image/jpeg" },
      payload: jpegPayload(3)
    });
    const replay = await app.inject({
      method: "PUT",
      url: oneTimePath,
      headers: { ...bearer(token), "content-type": "image/jpeg" },
      payload: jpegPayload(4)
    });
    expect(first.statusCode).toBe(200);
    expect(replay.statusCode).toBe(409);

    const removed = await app.inject({ method: "DELETE", url: "/v1/device-data", headers: bearer(token) });
    expect(removed.statusCode).toBe(204);
    expect(await readdir(objectDir)).toEqual([]);
    const oldBearerReplay = await app.inject({
      method: "PUT",
      url: oneTimePath,
      headers: { ...bearer(token), "content-type": "image/jpeg" },
      payload: jpegPayload(5)
    });
    expect(oldBearerReplay.statusCode).toBe(401);

    const newToken = await register(app);
    const reinstalledReplay = await app.inject({
      method: "PUT",
      url: oneTimePath,
      headers: { ...bearer(newToken), "content-type": "image/jpeg" },
      payload: jpegPayload(6)
    });
    expect(reinstalledReplay.statusCode).toBe(409);
    expect(await readdir(objectDir)).toEqual([]);
    await app.close();
  });

  it("uses a bounded, sample-bound evaluation lease without weakening normal or global budgets", async () => {
    const objectDir = await temporaryObjectDir();
    const config = testConfig(objectDir);
    config.maxJobsPerDevicePerDay = 1;
    config.maxJobsGlobalPerDay = 2;
    const leaseToken = "A".repeat(43);
    const lease = evaluationLeaseFixture(leaseToken);
    const app = await buildServer({ config, evaluationLeases: [lease] });
    const token = await register(app);
    const secondToken = await register(app, SECOND_INSTALLATION_ID);
    const context = (sampleId: string) => ({
      datasetId: lease.datasetId,
      runId: lease.runId,
      labelsSha256: lease.labelsSha256,
      sampleId
    });
    const payload = (candidateToken: string, sampleId?: string) => ({
      candidateToken,
      capturedAtBucket: null,
      localLabels: ["broom"],
      qualityScore: 0.9,
      sensitiveFlags: [],
      contentType: "image/jpeg",
      ...(sampleId ? { evaluationContext: context(sampleId) } : {})
    });

    const headerOnly = await app.inject({
      method: "POST", url: "/v1/analysis-jobs",
      headers: { ...bearer(token), "x-jianwei-evaluation-lease": leaseToken },
      payload: payload(CANDIDATE_ID)
    });
    expect(headerOnly.statusCode).toBe(401);
    const contextOnly = await app.inject({
      method: "POST", url: "/v1/analysis-jobs", headers: bearer(token),
      payload: payload(lease.samples[0]!.candidateToken, lease.samples[0]!.sampleId)
    });
    expect(contextOnly.statusCode).toBe(401);

    const evaluated = await app.inject({
      method: "POST", url: "/v1/analysis-jobs",
      headers: { ...bearer(token), "x-jianwei-evaluation-lease": leaseToken },
      payload: payload(lease.samples[0]!.candidateToken, lease.samples[0]!.sampleId)
    });
    expect(evaluated.statusCode).toBe(201);
    const normal = await app.inject({
      method: "POST", url: "/v1/analysis-jobs", headers: bearer(token), payload: payload(CANDIDATE_ID)
    });
    expect(normal.statusCode).toBe(201);
    const idempotent = await app.inject({
      method: "POST", url: "/v1/analysis-jobs",
      headers: { ...bearer(token), "x-jianwei-evaluation-lease": leaseToken },
      payload: payload(lease.samples[0]!.candidateToken, lease.samples[0]!.sampleId)
    });
    expect(idempotent.statusCode).toBe(201);
    expect(idempotent.json().jobId).toBe(evaluated.json().jobId);
    const ordinaryDailyFuse = await app.inject({
      method: "POST", url: "/v1/analysis-jobs", headers: bearer(token), payload: payload(SECOND_CANDIDATE_ID)
    });
    expect(ordinaryDailyFuse.statusCode).toBe(429);
    expect(ordinaryDailyFuse.json().error.code).toBe("daily_budget_exceeded");

    const wrongDevice = await app.inject({
      method: "POST", url: "/v1/analysis-jobs",
      headers: { ...bearer(secondToken), "x-jianwei-evaluation-lease": leaseToken },
      payload: payload(lease.samples[1]!.candidateToken, lease.samples[1]!.sampleId)
    });
    expect(wrongDevice.statusCode).toBe(403);
    expect(wrongDevice.json().error.code).toBe("evaluation_device_mismatch");
    const globalFuse = await app.inject({
      method: "POST", url: "/v1/analysis-jobs",
      headers: { ...bearer(token), "x-jianwei-evaluation-lease": leaseToken },
      payload: payload(lease.samples[1]!.candidateToken, lease.samples[1]!.sampleId)
    });
    expect(globalFuse.statusCode).toBe(429);
    expect(globalFuse.json().error.code).toBe("global_daily_budget_exceeded");

    expect((await app.inject({ method: "DELETE", url: "/v1/device-data", headers: bearer(token) })).statusCode).toBe(204);
    const reinstalled = await register(app);
    const revoked = await app.inject({
      method: "POST", url: "/v1/analysis-jobs",
      headers: { ...bearer(reinstalled), "x-jianwei-evaluation-lease": leaseToken },
      payload: payload(lease.samples[1]!.candidateToken, lease.samples[1]!.sampleId)
    });
    expect(revoked.statusCode).toBe(410);
    expect(revoked.json().error.code).toBe("evaluation_lease_revoked");
    await app.close();
  });
});

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function uploadPath(uploadUrl: string): string {
  const parsed = new URL(uploadUrl);
  return `${parsed.pathname}${parsed.search}`;
}

function jpegPayload(fill: number, size = 128): Buffer {
  const payload = Buffer.alloc(size, fill);
  payload[0] = 0xff;
  payload[1] = 0xd8;
  payload[2] = 0xff;
  return payload;
}

async function register(
  app: Awaited<ReturnType<typeof buildServer>>,
  installationId = INSTALLATION_ID
): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/v1/devices/register",
    payload: { installationId }
  });
  expect(response.statusCode).toBe(201);
  return response.json().deviceToken as string;
}

async function completeTestCard(
  app: Awaited<ReturnType<typeof buildServer>>,
  token: string,
  candidateToken: string
): Promise<{ cardId: string }> {
  const created = await app.inject({
    method: "POST",
    url: "/v1/analysis-jobs",
    headers: bearer(token),
    payload: {
      candidateToken,
      capturedAtBucket: "2026-07-18",
      localLabels: ["broom"],
      qualityScore: 0.91,
      sensitiveFlags: [],
      contentType: "image/jpeg"
    }
  });
  expect(created.statusCode).toBe(201);
  expect((await app.inject({
    method: "PUT",
    url: uploadPath(created.json().uploadUrl as string),
    headers: { ...bearer(token), "content-type": "image/jpeg" },
    payload: jpegPayload(12)
  })).statusCode).toBe(200);
  const completed = await app.inject({
    method: "POST",
    url: `/v1/analysis-jobs/${created.json().jobId as string}/complete`,
    headers: bearer(token)
  });
  expect(completed.statusCode).toBe(200);
  return completed.json().card as { cardId: string };
}

async function temporaryObjectDir(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "jianwei-test-"));
  cleanup.push(directory);
  return directory;
}

function testConfig(localObjectDir: string): AppConfig {
  return {
    environment: "test",
    host: "127.0.0.1",
    port: 8787,
    publicBaseUrl: "http://127.0.0.1:8787",
    databaseUrl: null,
    objectStore: "local",
    localObjectDir,
    visionProvider: "local",
    dashscopeApiKey: null,
    dashscopeBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    qwenFlashModel: "unused",
    qwenPlusModel: "unused",
    kimiApiKey: null,
    kimiBaseUrl: "https://api.moonshot.cn/v1",
    kimiModel: "kimi-k3",
    ossRegion: "unused",
    ossBucket: null,
    ossAccessKeyId: null,
    ossAccessKeySecret: null,
    ossSecurityToken: null,
    maxJobsPerDevicePerDay: 24,
    maxJobsPerDevicePerMonth: 300,
    maxJobsGlobalPerDay: 2000,
    maxJobsGlobalPerMonth: 50000,
    worstCaseCostMicroCnyPerJob: 1,
    maxGlobalCostMicroCnyPerDay: 2000,
    maxGlobalCostMicroCnyPerMonth: 50000,
    objectTtlHours: 24,
    allowUnattestedFacts: true,
    knowledgeCatalogSha256: null,
    knowledgeReviewerIds: [],
    containerImageDigest: null
  };
}

function evaluationLeaseFixture(leaseToken: string): EvaluationLeaseDefinition {
  const runId = "run-001";
  return {
    id: "85c958c2-c80f-4ca7-94eb-a7e7d5cc2022",
    tokenHash: createHash("sha256").update(leaseToken).digest("hex"),
    datasetId: "dataset-001",
    runId,
    labelsSha256: "a".repeat(64),
    maxJobs: 300,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    samples: Array.from({ length: 300 }, (_, index) => {
      const sampleId = `sample-${String(index).padStart(3, "0")}`;
      return { sampleId, candidateToken: evaluationCandidateToken(runId, sampleId) };
    })
  };
}
