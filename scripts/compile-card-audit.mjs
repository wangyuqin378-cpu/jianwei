import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

export const AUTOMATIC_CARD_AUDIT_POLICY_VERSION = "derived-ai-reviewed-card-v2";
const UNCERTAIN_OBJECT_CONFIDENCE = 0.72;
const MAX_CARD_TITLE_LENGTH = 30;
const MIN_REVIEWED_FACT_HEADLINE_LENGTH = 8;
const UNSUITABLE_FACT_HEADLINE = /^(?:它|这|这些|这种|这项|该|如果)/u;
const FACT_HEADLINE_BOUNDARY = /[，,；;。！？!?：:]/u;
const TITLE_TEMPLATES = [
  { prefix: "关于", suffix: "，你可能不知道" },
  { prefix: "", suffix: "的一件小事" },
  { prefix: "原来", suffix: "还有这一面" }
];

export function compileCardAudit({ snapshots, catalog, snapshotsSha256, now = new Date() }) {
  assertPlainObject(snapshots, "card snapshots");
  assertExactKeys(snapshots, [
    "schemaVersion", "evidenceKind", "runId", "evidenceRef", "appVersion", "releaseApkSha256",
    "backendReleaseSha256", "modelVersion", "catalogVersion", "exportedAt", "cards"
  ], "card snapshots");
  assert(
    snapshots.schemaVersion === 1 && snapshots.evidenceKind === "generated_card_snapshots",
    "Card snapshot schema or evidence kind is invalid"
  );
  assert(validToken(snapshots.runId), "Card snapshot runId is invalid");
  assert(boundedText(snapshots.evidenceRef, 1, 500), "Card snapshot evidenceRef is required");
  assert(
    boundedText(snapshots.appVersion, 1, 100) && boundedText(snapshots.modelVersion, 1, 200),
    "Card snapshot appVersion/modelVersion are required"
  );
  assert(/^[a-f0-9]{64}$/.test(snapshots.releaseApkSha256 ?? ""), "Card snapshot Release APK SHA-256 is required");
  assert(/^[a-f0-9]{64}$/.test(snapshots.backendReleaseSha256 ?? ""), "Card snapshot backend Release SHA-256 is required");
  assert(/^[a-f0-9]{64}$/.test(snapshotsSha256 ?? ""), "Card snapshot artifact SHA-256 is required");

  assertPlainObject(catalog, "catalog");
  assert(
    typeof catalog.version === "string" && Array.isArray(catalog.topics) && Array.isArray(catalog.sources),
    "Catalog is invalid"
  );
  assert(snapshots.catalogVersion === catalog.version, "Card snapshot catalogVersion is stale");
  const exportedAt = strictIso(snapshots.exportedAt);
  assert(exportedAt && exportedAt <= now, "Card snapshot exportedAt must be a non-future strict ISO timestamp");
  assert(
    Array.isArray(snapshots.cards) && snapshots.cards.length >= 200 && snapshots.cards.length <= 500,
    "Card snapshots must contain 200-500 cards"
  );

  const sourceById = buildSourceIndex(catalog.sources);
  const factById = buildFactIndex(catalog.topics);
  const cardIds = new Set();
  const cardDigests = new Set();
  for (const card of snapshots.cards) {
    validateSnapshot(card, exportedAt);
    assert(!cardIds.has(card.cardId), `Duplicate card snapshot ID: ${card.cardId}`);
    assert(card.cardSha256 === cardSnapshotDigest(card), `Card snapshot SHA-256 mismatch: ${card.cardId}`);
    assert(!cardDigests.has(card.cardSha256), `Duplicate card snapshot SHA-256: ${card.cardId}`);
    cardIds.add(card.cardId);
    cardDigests.add(card.cardSha256);
  }

  const cardAudits = snapshots.cards.map((card) => automaticCardAudit(card, factById, sourceById));
  const policyFailures = cardAudits.filter((card) => !card.automaticPolicyPassed).length;
  const catalogMismatches = cardAudits.filter((card) =>
    !card.catalogFactMatched || !card.bodyMatchesFact || !card.sourceSetMatchesCatalog
  ).length;
  const presentationMismatches = cardAudits.filter((card) =>
    !card.titleMatchesPolicy || !card.personalContextMatchesPolicy
  ).length;
  const unreviewedCatalogFacts = cardAudits.filter((card) => !card.catalogAiReviewBound).length;

  return {
    schemaVersion: 1,
    evidenceKind: "compiled_card_audit",
    generatedAt: now.toISOString(),
    cardAuditProvenance: {
      runId: snapshots.runId,
      auditMode: "automatic_derived",
      policyVersion: AUTOMATIC_CARD_AUDIT_POLICY_VERSION,
      snapshotEvidenceRef: snapshots.evidenceRef,
      snapshotEvidenceSha256: snapshotsSha256,
      appVersion: snapshots.appVersion,
      releaseApkSha256: snapshots.releaseApkSha256,
      backendReleaseSha256: snapshots.backendReleaseSha256,
      modelVersion: snapshots.modelVersion,
      catalogVersion: snapshots.catalogVersion
    },
    metrics: {
      cards: cardAudits.length,
      policyFailures,
      catalogMismatches,
      presentationMismatches,
      unreviewedCatalogFacts
    },
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

function automaticCardAudit(card, factById, sourceById) {
  const catalogRecord = factById.get(card.factId);
  const catalogFactMatched = Boolean(catalogRecord && catalogRecord.topic.topicId === card.topicId);
  const bodyMatchesFact = Boolean(catalogFactMatched && catalogRecord.fact.factText === card.body);
  const expectedSources = catalogFactMatched
    ? catalogRecord.fact.sourceIds.map((sourceId) => sourceById.get(sourceId)).filter(Boolean)
    : [];
  const sourceSetMatchesCatalog = Boolean(
    catalogFactMatched &&
    expectedSources.length === catalogRecord.fact.sourceIds.length &&
    sameSourceSet(card.sources, expectedSources)
  );
  const riskLevel = catalogFactMatched ? catalogRecord.fact.riskLevel : "unknown";
  const aiReview = catalogFactMatched ? catalogRecord.fact.aiReview : null;
  const catalogAiReviewBound = Boolean(
    catalogFactMatched &&
    catalogRecord.fact.reviewStatus === "approved" &&
    riskLevel === "general" &&
    aiReview?.provider === "qwen" &&
    /^qwen[0-9a-z._-]{2,95}$/i.test(aiReview.model ?? "") &&
    aiReview.policyVersion === "general-content-v1" &&
    aiReview.decision === "approved" &&
    aiReview.reasonCode === "safe_general" &&
    /^[a-f0-9]{64}$/.test(aiReview.evidenceSha256 ?? "")
  );
  const titleMatchesPolicy = Boolean(
    catalogFactMatched && card.title === expectedCardTitle(
      catalogRecord.topic.displayName,
      card.factId,
      catalogRecord.fact.factText,
      card.confidence
    )
  );
  const personalContextMatchesPolicy = Boolean(
    catalogFactMatched && isExpectedPersonalContext(card.personalContext, catalogRecord.topic.displayName)
  );
  const automaticPolicyPassed = Boolean(
    catalogFactMatched && bodyMatchesFact && sourceSetMatchesCatalog && catalogAiReviewBound &&
    titleMatchesPolicy && personalContextMatchesPolicy
  );

  return {
    cardId: card.cardId,
    cardSha256: card.cardSha256,
    sourceUrls: card.sources.map((source) => source.url),
    riskLevel,
    automaticallyReviewed: true,
    policyVersion: AUTOMATIC_CARD_AUDIT_POLICY_VERSION,
    catalogReviewModel: aiReview?.model ?? null,
    catalogReviewEvidenceSha256: aiReview?.evidenceSha256 ?? null,
    catalogFactMatched,
    catalogAiReviewBound,
    bodyMatchesFact,
    sourceSetMatchesCatalog,
    titleMatchesPolicy,
    personalContextMatchesPolicy,
    automaticPolicyPassed
  };
}

function expectedCardTitle(displayName, factId, factText, confidence) {
  const objectName = normalizeObjectName(displayName);
  const normalizedFact = typeof factText === "string" ? factText.trim().replace(/\s+/gu, " ") : "";
  if (!objectName || !factId.trim() || !normalizedFact) return "";
  if (confidence < UNCERTAIN_OBJECT_CONFIDENCE) {
    return Array.from(`这可能是${objectName}`).slice(0, MAX_CARD_TITLE_LENGTH).join("");
  }
  const reviewedLead = normalizedFact.split(FACT_HEADLINE_BOUNDARY, 1)[0]?.trim() ?? "";
  const reviewedLeadLength = Array.from(reviewedLead).length;
  if (
    reviewedLeadLength >= MIN_REVIEWED_FACT_HEADLINE_LENGTH &&
    reviewedLeadLength <= MAX_CARD_TITLE_LENGTH &&
    !UNSUITABLE_FACT_HEADLINE.test(reviewedLead)
  ) {
    return reviewedLead;
  }
  const template = TITLE_TEMPLATES[stableHash(factId.trim()) % TITLE_TEMPLATES.length];
  const reservedLength = Array.from(template.prefix + template.suffix).length;
  const visibleObjectName = Array.from(objectName)
    .slice(0, Math.max(1, MAX_CARD_TITLE_LENGTH - reservedLength))
    .join("");
  return `${template.prefix}${visibleObjectName}${template.suffix}`;
}

function isExpectedPersonalContext(value, displayName) {
  const topic = normalizeObjectName(displayName) || "这个日常物件";
  if (value === `它来自你主动授权的照片，所以今天从「${topic}」讲起。`) return true;
  const match = /^你在 (\d{4}) 年 (\d{1,2}) 月 (\d{1,2}) 日拍下了「(.+)」，所以今天从它讲起。$/u.exec(value);
  if (!match || match[4] !== topic) return false;
  const date = `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}`;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function buildSourceIndex(sources) {
  const output = new Map();
  for (const source of sources) {
    assert(source?.sourceId && !output.has(source.sourceId), "Catalog source IDs are invalid or duplicated");
    output.set(source.sourceId, source);
  }
  return output;
}

function buildFactIndex(topics) {
  const output = new Map();
  for (const topic of topics) {
    assert(topic?.topicId && typeof topic.displayName === "string" && Array.isArray(topic.facts), "Catalog topics are invalid");
    for (const fact of topic.facts) {
      assert(fact?.factId && !output.has(fact.factId), "Catalog fact IDs are invalid or duplicated");
      output.set(fact.factId, { topic, fact });
    }
  }
  return output;
}

function validateSnapshot(card, exportedAt) {
  assertPlainObject(card, "card snapshot");
  assertExactKeys(card, [
    "cardId", "cardSha256", "topicId", "factId", "title", "body", "personalContext",
    "confidence", "sources", "createdAt"
  ], `card snapshot ${card.cardId ?? "<missing>"}`);
  assert(validToken(card.cardId) && validToken(card.topicId) && validToken(card.factId), "Card snapshot IDs are invalid");
  assert(/^[a-f0-9]{64}$/.test(card.cardSha256 ?? ""), `Card snapshot digest is invalid: ${card.cardId}`);
  assert(
    boundedText(card.title, 1, 200) && boundedText(card.body, 1, 500) && boundedText(card.personalContext, 1, 500),
    `Card snapshot text is invalid: ${card.cardId}`
  );
  assert(
    Number.isFinite(card.confidence) && card.confidence >= 0 && card.confidence <= 1,
    `Card snapshot confidence is invalid: ${card.cardId}`
  );
  assert(
    Array.isArray(card.sources) && card.sources.length >= 1 && card.sources.length <= 10,
    `Card snapshot sources are invalid: ${card.cardId}`
  );
  const sourceIds = new Set();
  for (const source of card.sources) {
    assertPlainObject(source, "card snapshot source");
    assertExactKeys(source, ["sourceId", "url"], `card snapshot source ${card.cardId}`);
    assert(
      validToken(source.sourceId) && isPublicHttpsUrl(source.url) && !sourceIds.has(source.sourceId),
      `Card snapshot source is invalid: ${card.cardId}`
    );
    sourceIds.add(source.sourceId);
  }
  const createdAt = strictIso(card.createdAt);
  assert(createdAt && createdAt <= exportedAt, `Card snapshot createdAt is invalid: ${card.cardId}`);
}

function sameSourceSet(displayed, expected) {
  if (displayed.length !== expected.length) return false;
  const actual = new Map(displayed.map((source) => [source.sourceId, source.url]));
  return expected.every((source) => actual.get(source.sourceId) === source.url);
}

function normalizeObjectName(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/gu, " ") : "";
}

function stableHash(value) {
  let hash = 0;
  for (const character of value) hash = ((hash * 31) + character.codePointAt(0)) >>> 0;
  return hash;
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
  assert(
    actual.length === wanted.length && actual.every((key, index) => key === wanted[index]),
    `${label} fields do not match the schema`
  );
}

function assertPlainObject(value, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
}

function validToken(value) {
  return typeof value === "string" && /^[A-Za-z0-9._-]{3,128}$/.test(value);
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
  const source = {
    sourceId: "official-source",
    title: "Official",
    url: "https://example.org/source",
    publisher: "Official",
    authority: "official"
  };
  const fact = {
    factId: "fact-one",
    topicId: "topic-one",
    factText: "测试物件会用不同大小的部件改变传动效果，在速度和省力之间切换。",
    sourceIds: [source.sourceId],
    riskLevel: "general",
    reviewStatus: "approved",
    aiReview: {
      provider: "qwen",
      model: "qwen3.6-flash-2026-04-16",
      policyVersion: "general-content-v1",
      reviewedAt: "2026-07-18T00:00:00.000Z",
      decision: "approved",
      reasonCode: "safe_general",
      evidenceSha256: "9".repeat(64)
    }
  };
  const cards = Array.from({ length: 200 }, (_, index) => {
    const card = {
      cardId: `card-${index}`,
      topicId: "topic-one",
      factId: fact.factId,
      title: expectedCardTitle("测试物件", fact.factId, fact.factText, 0.95),
      body: fact.factText,
      personalContext: "它来自你主动授权的照片，所以今天从「测试物件」讲起。",
      confidence: 0.95,
      sources: [{ sourceId: source.sourceId, url: source.url }],
      createdAt: "2026-07-19T00:01:00.000Z"
    };
    return { ...card, cardSha256: cardSnapshotDigest(card) };
  });
  return {
    catalog: {
      version: "fixture-beta.1",
      sources: [source],
      topics: [{ topicId: "topic-one", displayName: "测试物件", facts: [fact] }]
    },
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
      exportedAt: "2026-07-19T00:02:00.000Z",
      cards
    }
  };
}

function expectFailure(mutate, label) {
  const value = fixture();
  mutate(value);
  try {
    compileCardAudit({ ...value, snapshotsSha256: "a".repeat(64), now: new Date("2026-07-19T00:05:00.000Z") });
  } catch {
    return;
  }
  throw new Error(`Card audit compiler self-test accepted ${label}`);
}

const args = parseArgs(process.argv.slice(2));
if (args.has("--self-test")) {
  const value = fixture();
  const artifact = compileCardAudit({
    ...value,
    snapshotsSha256: "a".repeat(64),
    now: new Date("2026-07-19T00:05:00.000Z")
  });
  assert(
    artifact.metrics.cards === 200 && artifact.metrics.policyFailures === 0 &&
    artifact.metrics.catalogMismatches === 0 && artifact.metrics.presentationMismatches === 0,
    "Card audit compiler self-test metrics are wrong"
  );
  assert(
    expectedCardTitle(
      "测试物件",
      "fact-one",
      value.catalog.topics[0].facts[0].factText,
      UNCERTAIN_OBJECT_CONFIDENCE - 0.01
    ) === "这可能是测试物件",
    "Low-confidence card title policy drifted"
  );
  assert(
    expectedCardTitle(
      "测试物件",
      "fact-one",
      value.catalog.topics[0].facts[0].factText,
      0.95
    ) === "测试物件会用不同大小的部件改变传动效果",
    "High-confidence card did not use its reviewed factual lead"
  );
  const datedContext = fixture();
  datedContext.snapshots.cards[0].personalContext = "你在 2026 年 7 月 18 日拍下了「测试物件」，所以今天从它讲起。";
  datedContext.snapshots.cards[0].cardSha256 = cardSnapshotDigest(datedContext.snapshots.cards[0]);
  assert(
    compileCardAudit({
      ...datedContext,
      snapshotsSha256: "a".repeat(64),
      now: new Date("2026-07-19T00:05:00.000Z")
    }).metrics.policyFailures === 0,
    "Valid captured-date context was rejected"
  );
  expectFailure((item) => { item.snapshots.catalogVersion = "fixture-beta.0"; }, "a stale catalog");
  expectFailure((item) => { item.snapshots.cards[1].cardId = item.snapshots.cards[0].cardId; }, "a duplicate card ID");
  expectFailure((item) => { item.snapshots.releaseApkSha256 = "0".repeat(63); }, "an invalid Release APK digest");
  expectFailure((item) => { item.snapshots.backendReleaseSha256 = "0".repeat(63); }, "an invalid backend Release digest");
  let invalidSnapshotDigestRejected = false;
  try {
    compileCardAudit({ ...fixture(), snapshotsSha256: "0".repeat(63), now: new Date("2026-07-19T00:05:00.000Z") });
  } catch {
    invalidSnapshotDigestRejected = true;
  }
  assert(invalidSnapshotDigestRejected, "Card audit compiler accepted an invalid snapshot digest");

  const mismatches = [
    ["body", (item) => { item.snapshots.cards[0].body = "这是一条与目录事实不同但结构有效、必须被最终门禁拒绝的卡片正文。"; }],
    ["title", (item) => { item.snapshots.cards[0].title = "自由生成且未受模板约束的标题"; }],
    ["personal context", (item) => { item.snapshots.cards[0].personalContext = "AI 认为你一定经常使用这个物件。"; }],
    ["invalid captured date", (item) => { item.snapshots.cards[0].personalContext = "你在 2026 年 2 月 31 日拍下了「测试物件」，所以今天从它讲起。"; }],
    ["source", (item) => { item.snapshots.cards[0].sources[0].url = "https://example.org/other"; }],
    ["AI review", (item) => { item.catalog.topics[0].facts[0].aiReview.decision = "rejected"; }],
    ["AI review reason", (item) => { item.catalog.topics[0].facts[0].aiReview.reasonCode = "political_content"; }],
    ["AI review evidence", (item) => { item.catalog.topics[0].facts[0].aiReview.evidenceSha256 = ""; }],
    ["high-risk fact", (item) => { item.catalog.topics[0].facts[0].riskLevel = "health"; }]
  ];
  for (const [label, mutate] of mismatches) {
    const item = fixture();
    mutate(item);
    item.snapshots.cards[0].cardSha256 = cardSnapshotDigest(item.snapshots.cards[0]);
    const result = compileCardAudit({
      ...item,
      snapshotsSha256: "a".repeat(64),
      now: new Date("2026-07-19T00:05:00.000Z")
    });
    assert(result.metrics.policyFailures > 0, `Card audit compiler hid a ${label} mismatch`);
  }
  process.stdout.write(
    "CARD_AUDIT_COMPILER_SELF_TEST=GO synthetic=1 releaseEvidence=0 cards=200 mode=automatic_derived " +
    "bypassesRejected=14 apkShaBinding=1 backendReleaseBinding=1 aiCatalogBinding=1 " +
    "titlePolicy=1 titleTemplates=3 personalContextPolicy=1 sourceBinding=1 highRiskExcluded=1\n"
  );
  process.exit(0);
}

const snapshotsPath = path.resolve(process.cwd(), String(args.get("--snapshots") ?? "evaluation/card-snapshots.json"));
const catalogPath = path.resolve(process.cwd(), String(args.get("--catalog") ?? "knowledge/catalog.json"));
const outputPath = path.resolve(process.cwd(), String(args.get("--output") ?? "evaluation/compiled-card-audit.json"));
const [snapshotsBytes, catalogBytes] = await Promise.all([readFile(snapshotsPath), readFile(catalogPath)]);
const artifact = compileCardAudit({
  snapshots: JSON.parse(snapshotsBytes.toString("utf8")),
  catalog: JSON.parse(catalogBytes.toString("utf8")),
  snapshotsSha256: sha256(snapshotsBytes)
});
if (!args.has("--write")) {
  process.stdout.write(
    `CARD_AUDIT_PREVIEW=GO run=${artifact.cardAuditProvenance.runId} cards=${artifact.metrics.cards} ` +
    `policyFailures=${artifact.metrics.policyFailures} catalogMismatches=${artifact.metrics.catalogMismatches} wrote=0\n`
  );
  process.exit(0);
}
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
process.stdout.write(
  `CARD_AUDIT_COMPILE=GO run=${artifact.cardAuditProvenance.runId} cards=${artifact.metrics.cards} ` +
  `policyFailures=${artifact.metrics.policyFailures} catalogMismatches=${artifact.metrics.catalogMismatches} wrote=1\n`
);
