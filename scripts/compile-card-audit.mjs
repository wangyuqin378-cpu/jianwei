import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const AUTOMATION_ID = /(?:codex|chatgpt|gpt|kimi|moonshot|qwen|claude|gemini|llama|automation|robot)/i;

export function compileCardAudit({ snapshots, audits, catalog, snapshotsSha256, auditsSha256, now = new Date() }) {
  assertPlainObject(snapshots, "card snapshots");
  assertExactKeys(snapshots, [
    "schemaVersion", "evidenceKind", "runId", "evidenceRef", "appVersion", "releaseApkSha256",
    "backendReleaseSha256", "modelVersion", "catalogVersion", "exportedAt", "cards"
  ], "card snapshots");
  assert(snapshots.schemaVersion === 1 && snapshots.evidenceKind === "generated_card_snapshots", "Card snapshot schema or evidence kind is invalid");
  assert(validToken(snapshots.runId), "Card snapshot runId is invalid");
  assert(boundedText(snapshots.evidenceRef, 1, 500), "Card snapshot evidenceRef is required");
  assert(boundedText(snapshots.appVersion, 1, 100) && boundedText(snapshots.modelVersion, 1, 200), "Card snapshot appVersion/modelVersion are required");
  assert(/^[a-f0-9]{64}$/.test(snapshots.releaseApkSha256 ?? ""), "Card snapshot Release APK SHA-256 is required");
  assert(/^[a-f0-9]{64}$/.test(snapshots.backendReleaseSha256 ?? ""), "Card snapshot backend Release SHA-256 is required");
  assertPlainObject(catalog, "catalog");
  assert(typeof catalog.version === "string" && Array.isArray(catalog.topics) && Array.isArray(catalog.sources), "Catalog is invalid");
  assert(snapshots.catalogVersion === catalog.version, "Card snapshot catalogVersion is stale");
  const exportedAt = strictIso(snapshots.exportedAt);
  assert(exportedAt && exportedAt <= now, "Card snapshot exportedAt must be a non-future strict ISO timestamp");
  assert(Array.isArray(snapshots.cards) && snapshots.cards.length >= 200 && snapshots.cards.length <= 500, "Card snapshots must contain 200-500 cards");

  assertPlainObject(audits, "card audits");
  assertExactKeys(audits, ["schemaVersion", "evidenceKind", "runId", "evidenceRef", "completedAt", "audits"], "card audits");
  assert(audits.schemaVersion === 1 && audits.evidenceKind === "human_card_audits", "Card audit schema or evidence kind is invalid");
  assert(audits.runId === snapshots.runId, "Card snapshots and audits runId do not match");
  assert(boundedText(audits.evidenceRef, 1, 500), "Card audit evidenceRef is required");
  const completedAt = strictIso(audits.completedAt);
  assert(completedAt && completedAt >= exportedAt && completedAt <= now, "Card audit completedAt must follow export and not be in the future");
  assert(Array.isArray(audits.audits) && audits.audits.length === snapshots.cards.length, "Card audits must contain exactly one row per snapshot");
  assert(/^[a-f0-9]{64}$/.test(snapshotsSha256 ?? "") && /^[a-f0-9]{64}$/.test(auditsSha256 ?? ""), "Card audit input artifact SHA-256 values are required");

  const sourceById = new Map();
  for (const source of catalog.sources) {
    assert(source?.sourceId && !sourceById.has(source.sourceId), "Catalog source IDs are invalid or duplicated");
    sourceById.set(source.sourceId, source);
  }
  const factById = new Map();
  for (const topic of catalog.topics) {
    assert(topic?.topicId && Array.isArray(topic.facts), "Catalog topics are invalid");
    for (const fact of topic.facts) {
      assert(fact?.factId && !factById.has(fact.factId), "Catalog fact IDs are invalid or duplicated");
      factById.set(fact.factId, { topic, fact });
    }
  }

  const snapshotsById = new Map();
  const snapshotDigests = new Set();
  for (const card of snapshots.cards) {
    validateSnapshot(card, exportedAt);
    assert(!snapshotsById.has(card.cardId), `Duplicate card snapshot ID: ${card.cardId}`);
    const expectedDigest = cardSnapshotDigest(card);
    assert(card.cardSha256 === expectedDigest, `Card snapshot SHA-256 mismatch: ${card.cardId}`);
    assert(!snapshotDigests.has(card.cardSha256), `Duplicate card snapshot SHA-256: ${card.cardId}`);
    snapshotsById.set(card.cardId, card);
    snapshotDigests.add(card.cardSha256);
  }

  const auditsById = new Map();
  for (const audit of audits.audits) {
    validateAudit(audit, { exportedAt, completedAt });
    assert(!auditsById.has(audit.cardId), `Duplicate card audit ID: ${audit.cardId}`);
    const card = snapshotsById.get(audit.cardId);
    assert(card, `Card audit has no matching snapshot: ${audit.cardId}`);
    assert(audit.cardSha256 === card.cardSha256, `Card audit SHA-256 mismatch: ${audit.cardId}`);
    const sourceIds = card.sources.map((source) => source.sourceId);
    assert(audit.checkedSourceIds.length === sourceIds.length &&
      audit.checkedSourceIds.every((sourceId) => sourceIds.includes(sourceId)),
    `Card audit did not check every displayed source: ${audit.cardId}`);
    auditsById.set(audit.cardId, audit);
  }
  for (const cardId of snapshotsById.keys()) assert(auditsById.has(cardId), `Card snapshot has no matching audit: ${cardId}`);

  const cardAudits = snapshots.cards.map((card) => {
    const audit = auditsById.get(card.cardId);
    const catalogRecord = factById.get(card.factId);
    const catalogFactMatched = Boolean(catalogRecord && catalogRecord.topic.topicId === card.topicId);
    const bodyMatchesFact = Boolean(catalogFactMatched && catalogRecord.fact.factText === card.body);
    const expectedSources = catalogFactMatched
      ? catalogRecord.fact.sourceIds.map((sourceId) => sourceById.get(sourceId)).filter(Boolean)
      : [];
    const sourceSetMatchesCatalog = catalogFactMatched && expectedSources.length === catalogRecord.fact.sourceIds.length &&
      sameSourceSet(card.sources, expectedSources);
    const riskLevel = catalogFactMatched ? catalogRecord.fact.riskLevel : "unknown";
    const whitelisted = Boolean(catalogFactMatched && catalogRecord.fact.reviewStatus === "approved" && catalogRecord.fact.review);
    const authoritativeSourceCount = new Set(expectedSources
      .filter((source) => source.authority === "official" || source.authority === "professional")
      .map((source) => source.sourceId)).size;
    return {
      cardId: card.cardId,
      cardSha256: card.cardSha256,
      sourceUrls: card.sources.map((source) => source.url),
      sourcesReachable: audit.sourcesReachable,
      fabricatedSource: audit.fabricatedSource,
      unsupportedPersonalConclusion: audit.unsupportedPersonalConclusion,
      riskLevel,
      humanReviewed: true,
      reviewerId: audit.reviewerId,
      auditedAt: audit.auditedAt,
      evidenceRef: audit.evidenceRef,
      whitelisted,
      authoritativeSourceCount,
      catalogFactMatched,
      bodyMatchesFact,
      sourceSetMatchesCatalog
    };
  });
  const failedHumanAudits = cardAudits.filter((card) => !card.sourcesReachable || card.fabricatedSource || card.unsupportedPersonalConclusion).length;
  const catalogMismatches = cardAudits.filter((card) => !card.catalogFactMatched || !card.bodyMatchesFact || !card.sourceSetMatchesCatalog).length;
  return {
    schemaVersion: 1,
    evidenceKind: "compiled_card_audit",
    generatedAt: now.toISOString(),
    cardAuditProvenance: {
      runId: snapshots.runId,
      snapshotEvidenceRef: snapshots.evidenceRef,
      auditEvidenceRef: audits.evidenceRef,
      snapshotEvidenceSha256: snapshotsSha256,
      auditEvidenceSha256: auditsSha256,
      appVersion: snapshots.appVersion,
      releaseApkSha256: snapshots.releaseApkSha256,
      backendReleaseSha256: snapshots.backendReleaseSha256,
      modelVersion: snapshots.modelVersion,
      catalogVersion: snapshots.catalogVersion
    },
    metrics: { cards: cardAudits.length, failedHumanAudits, catalogMismatches },
    cardAudits
  };
}

export function cardSnapshotDigest(card) {
  return sha256(Buffer.from(JSON.stringify([
    "jianwei-generated-card-v1",
    card.cardId,
    card.topicId,
    card.factId,
    card.title,
    card.body,
    card.personalContext,
    card.confidence,
    card.sources,
    card.createdAt
  ]), "utf8"));
}

function validateSnapshot(card, exportedAt) {
  assertPlainObject(card, "card snapshot");
  assertExactKeys(card, [
    "cardId", "cardSha256", "topicId", "factId", "title", "body", "personalContext",
    "confidence", "sources", "createdAt"
  ], `card snapshot ${card.cardId ?? "<missing>"}`);
  assert(validToken(card.cardId) && validToken(card.topicId) && validToken(card.factId), "Card snapshot IDs are invalid");
  assert(/^[a-f0-9]{64}$/.test(card.cardSha256 ?? ""), `Card snapshot digest is invalid: ${card.cardId}`);
  assert(boundedText(card.title, 1, 200) && boundedText(card.body, 1, 500) && boundedText(card.personalContext, 1, 500), `Card snapshot text is invalid: ${card.cardId}`);
  assert(Number.isFinite(card.confidence) && card.confidence >= 0 && card.confidence <= 1, `Card snapshot confidence is invalid: ${card.cardId}`);
  assert(Array.isArray(card.sources) && card.sources.length >= 1 && card.sources.length <= 10, `Card snapshot sources are invalid: ${card.cardId}`);
  const sourceIds = new Set();
  for (const source of card.sources) {
    assertPlainObject(source, "card snapshot source");
    assertExactKeys(source, ["sourceId", "url"], `card snapshot source ${card.cardId}`);
    assert(validToken(source.sourceId) && isPublicHttpsUrl(source.url) && !sourceIds.has(source.sourceId), `Card snapshot source is invalid: ${card.cardId}`);
    sourceIds.add(source.sourceId);
  }
  const createdAt = strictIso(card.createdAt);
  assert(createdAt && createdAt <= exportedAt, `Card snapshot createdAt is invalid: ${card.cardId}`);
}

function validateAudit(audit, { exportedAt, completedAt }) {
  assertPlainObject(audit, "card audit");
  assertExactKeys(audit, [
    "cardId", "cardSha256", "reviewerId", "auditedAt", "checkedSourceIds", "sourcesReachable",
    "fabricatedSource", "unsupportedPersonalConclusion", "evidenceRef"
  ], `card audit ${audit.cardId ?? "<missing>"}`);
  assert(validToken(audit.cardId) && /^[a-f0-9]{64}$/.test(audit.cardSha256 ?? ""), "Card audit ID or digest is invalid");
  assert(validHumanId(audit.reviewerId), `Card audit reviewer must be an accountable human: ${audit.cardId}`);
  const auditedAt = strictIso(audit.auditedAt);
  assert(auditedAt && auditedAt >= exportedAt && auditedAt <= completedAt, `Card audit timestamp is invalid: ${audit.cardId}`);
  assert(Array.isArray(audit.checkedSourceIds) && audit.checkedSourceIds.length >= 1 &&
    audit.checkedSourceIds.every(validToken) && new Set(audit.checkedSourceIds).size === audit.checkedSourceIds.length,
  `Card audit checkedSourceIds are invalid: ${audit.cardId}`);
  assert(typeof audit.sourcesReachable === "boolean" && typeof audit.fabricatedSource === "boolean" &&
    typeof audit.unsupportedPersonalConclusion === "boolean", `Card audit outcomes must be explicit booleans: ${audit.cardId}`);
  assert(boundedText(audit.evidenceRef, 1, 500), `Card audit evidenceRef is required: ${audit.cardId}`);
}

function sameSourceSet(displayed, expected) {
  if (displayed.length !== expected.length) return false;
  const actual = new Map(displayed.map((source) => [source.sourceId, source.url]));
  return expected.every((source) => actual.get(source.sourceId) === source.url);
}

function isPublicHttpsUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || !host || url.username || url.password) return false;
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
    if (/^(?:127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host)) return false;
    const private172 = /^172\.(\d{1,3})\./.exec(host);
    if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return false;
    return host !== "[::1]" && host !== "::1";
  } catch {
    return false;
  }
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  assert(actual.length === wanted.length && actual.every((key, index) => key === wanted[index]), `${label} fields do not match the schema`);
}

function assertPlainObject(value, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
}

function validToken(value) {
  return typeof value === "string" && /^[A-Za-z0-9._-]{3,128}$/.test(value);
}

function validHumanId(value) {
  return typeof value === "string" && value.length <= 128 && /^[\p{L}\p{N}._@-]+$/u.test(value) &&
    !AUTOMATION_ID.test(value) && !/(?:^|[._@-])(?:ai|bot)(?:$|[._@-])/i.test(value);
}

function boundedText(value, minimum, maximum) {
  return typeof value === "string" && value.trim() === value && value.length >= minimum && value.length <= maximum;
}

function strictIso(value) {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value ? parsed : null;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseArgs(values) {
  const args = new Map();
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (key === "--write" || key === "--self-test") args.set(key, true);
    else if (key.startsWith("--")) args.set(key, values[++index]);
    else throw new Error(`Unexpected argument: ${key}`);
  }
  return args;
}

function fixture() {
  const exportedAt = "2026-07-19T00:02:00.000Z";
  const completedAt = "2026-07-19T00:04:00.000Z";
  const source = { sourceId: "official-source", title: "Official", url: "https://example.org/source", publisher: "Official", authority: "official" };
  const fact = {
    factId: "fact-one",
    topicId: "topic-one",
    factText: "这是一条由真人核验并且长度适合作为知识卡片正文的合成测试事实。",
    sourceIds: [source.sourceId],
    riskLevel: "general",
    reviewStatus: "approved",
    review: { reviewerId: "human-content-reviewer", reviewedAt: "2026-07-18T00:00:00.000Z", sourceCheckedAt: "2026-07-18T00:00:00.000Z" }
  };
  const cards = Array.from({ length: 200 }, (_, index) => {
    const card = {
      cardId: `card-${index}`,
      topicId: "topic-one",
      factId: fact.factId,
      title: "测试知识卡",
      body: fact.factText,
      personalContext: "因为它出现在你授权分析的照片中",
      confidence: 0.95,
      sources: [{ sourceId: source.sourceId, url: source.url }],
      createdAt: "2026-07-19T00:01:00.000Z"
    };
    return { ...card, cardSha256: cardSnapshotDigest({ ...card, cardSha256: "" }) };
  });
  const auditRows = cards.map((card) => ({
    cardId: card.cardId,
    cardSha256: card.cardSha256,
    reviewerId: "human-card-reviewer",
    auditedAt: "2026-07-19T00:03:00.000Z",
    checkedSourceIds: [source.sourceId],
    sourcesReachable: true,
    fabricatedSource: false,
    unsupportedPersonalConclusion: false,
    evidenceRef: `retained-card-audit-${card.cardId}`
  }));
  return {
    catalog: { version: "fixture-beta.1", sources: [source], topics: [{ topicId: "topic-one", facts: [fact] }] },
    snapshots: {
      schemaVersion: 1,
      evidenceKind: "generated_card_snapshots",
      runId: "fixture-card-run",
      evidenceRef: "retained-card-snapshots",
      appVersion: "fixture-app",
      releaseApkSha256: "e".repeat(64),
      backendReleaseSha256: "d".repeat(64),
      modelVersion: "fixture-model",
      catalogVersion: "fixture-beta.1",
      exportedAt,
      cards
    },
    audits: {
      schemaVersion: 1,
      evidenceKind: "human_card_audits",
      runId: "fixture-card-run",
      evidenceRef: "retained-human-card-audits",
      completedAt,
      audits: auditRows
    }
  };
}

function expectFailure(mutate, label) {
  const value = fixture();
  mutate(value);
  try {
    compileCardAudit({ ...value, snapshotsSha256: "a".repeat(64), auditsSha256: "b".repeat(64), now: new Date("2026-07-19T00:05:00.000Z") });
  } catch {
    return;
  }
  throw new Error(`Card audit compiler self-test accepted ${label}`);
}

const args = parseArgs(process.argv.slice(2));
if (args.has("--self-test")) {
  const value = fixture();
  const artifact = compileCardAudit({ ...value, snapshotsSha256: "a".repeat(64), auditsSha256: "b".repeat(64), now: new Date("2026-07-19T00:05:00.000Z") });
  assert(artifact.metrics.cards === 200 && artifact.metrics.failedHumanAudits === 0 && artifact.metrics.catalogMismatches === 0, "Card audit compiler self-test metrics are wrong");
  expectFailure((item) => { item.audits.audits.pop(); }, "a missing audit");
  expectFailure((item) => { item.audits.audits[0].cardSha256 = "f".repeat(64); }, "a digest mismatch");
  expectFailure((item) => { item.audits.audits[0].reviewerId = "kimi-bot"; }, "an automation reviewer");
  expectFailure((item) => { item.snapshots.catalogVersion = "fixture-beta.0"; }, "a stale catalog");
  expectFailure((item) => { item.snapshots.cards[1].cardId = item.snapshots.cards[0].cardId; }, "a duplicate card ID");
  expectFailure((item) => { item.audits.audits[0].checkedSourceIds = []; }, "an incomplete source audit");
  expectFailure((item) => { item.snapshots.releaseApkSha256 = "0".repeat(63); }, "an invalid Release APK digest");
  expectFailure((item) => { item.snapshots.backendReleaseSha256 = "0".repeat(63); }, "an invalid backend Release digest");
  const mismatch = fixture();
  mismatch.snapshots.cards[0].body = "这是一条与目录事实不同但仍然结构有效、必须被最终门禁拒绝的卡片正文。";
  mismatch.snapshots.cards[0].cardSha256 = cardSnapshotDigest(mismatch.snapshots.cards[0]);
  mismatch.audits.audits[0].cardSha256 = mismatch.snapshots.cards[0].cardSha256;
  const mismatchArtifact = compileCardAudit({ ...mismatch, snapshotsSha256: "a".repeat(64), auditsSha256: "b".repeat(64), now: new Date("2026-07-19T00:05:00.000Z") });
  assert(mismatchArtifact.metrics.catalogMismatches === 1 && mismatchArtifact.cardAudits[0].bodyMatchesFact === false, "Card audit compiler hid a product mismatch");
  process.stdout.write("CARD_AUDIT_COMPILER_SELF_TEST=GO synthetic=1 releaseEvidence=0 bypassesRejected=9 cards=200 apkShaBinding=1 backendReleaseBinding=1 negativeOutcomesPreserved=1\n");
  process.exit(0);
}

const snapshotsPath = path.resolve(process.cwd(), String(args.get("--snapshots") ?? "evaluation/card-snapshots.json"));
const auditsPath = path.resolve(process.cwd(), String(args.get("--audits") ?? "evaluation/card-audits.json"));
const catalogPath = path.resolve(process.cwd(), String(args.get("--catalog") ?? "knowledge/catalog.json"));
const outputPath = path.resolve(process.cwd(), String(args.get("--output") ?? "evaluation/compiled-card-audit.json"));
const [snapshotsBytes, auditsBytes, catalogBytes] = await Promise.all([readFile(snapshotsPath), readFile(auditsPath), readFile(catalogPath)]);
const artifact = compileCardAudit({
  snapshots: JSON.parse(snapshotsBytes.toString("utf8")),
  audits: JSON.parse(auditsBytes.toString("utf8")),
  catalog: JSON.parse(catalogBytes.toString("utf8")),
  snapshotsSha256: sha256(snapshotsBytes),
  auditsSha256: sha256(auditsBytes)
});
if (!args.has("--write")) {
  process.stdout.write(`CARD_AUDIT_PREVIEW=GO run=${artifact.cardAuditProvenance.runId} cards=${artifact.metrics.cards} failedHumanAudits=${artifact.metrics.failedHumanAudits} catalogMismatches=${artifact.metrics.catalogMismatches} wrote=0\n`);
  process.exit(0);
}
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
process.stdout.write(`CARD_AUDIT_COMPILE=GO run=${artifact.cardAuditProvenance.runId} cards=${artifact.metrics.cards} failedHumanAudits=${artifact.metrics.failedHumanAudits} catalogMismatches=${artifact.metrics.catalogMismatches} wrote=1\n`);
