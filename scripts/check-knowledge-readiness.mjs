import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isMainModule } from "./lib/main-module.mjs";

const REQUIRED_TOPIC_COUNT = 200;
const MIN_LAUNCH_READY_TOPICS = 150;
const MIN_FACTS_PER_TOPIC = 3;
const MAX_FACTS_PER_TOPIC = 5;
const AUTHORITIES = new Set(["reference", "official", "professional"]);
const RISK_LEVELS = new Set(["general", "health", "safety"]);
const REVIEW_STATUSES = new Set(["draft", "approved", "rejected"]);
const AUTOMATION_REVIEWER = /(?:codex|chatgpt|gpt|kimi|moonshot|qwen|claude|gemini|llama|automation|autobot|robot|language[-_. ]?model)/i;

export function assessKnowledge(catalog, backlog, now = new Date(), approvedReviewerIds = null) {
  const blockers = [];
  const fail = (message) => blockers.push(message);
  const topics = array(catalog?.topics);
  const sources = array(catalog?.sources);
  const backlogTopics = array(backlog?.topics);

  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) fail("catalog must be a JSON object");
  if (!nonEmpty(catalog?.version)) fail("catalog version is required");
  if (!Array.isArray(catalog?.topics)) fail("catalog topics must be an array");
  if (!Array.isArray(catalog?.sources)) fail("catalog sources must be an array");
  if (!backlog || typeof backlog !== "object" || Array.isArray(backlog)) fail("controlled backlog must be a JSON object");
  if (!Array.isArray(backlog?.topics)) fail("controlled backlog topics must be an array");

  if (topics.length !== REQUIRED_TOPIC_COUNT) {
    fail(`catalog must contain exactly ${REQUIRED_TOPIC_COUNT} controlled topics; found ${topics.length}`);
  }
  if (backlogTopics.length !== REQUIRED_TOPIC_COUNT) {
    fail(`controlled backlog must contain exactly ${REQUIRED_TOPIC_COUNT} topics; found ${backlogTopics.length}`);
  }
  if (backlog?.generatedFromCatalogVersion !== catalog?.version) {
    fail("controlled backlog was not generated from the current catalog version");
  }
  if (backlog?.policy?.publishesFacts !== false) fail("controlled backlog must explicitly remain non-publishing");

  const backlogById = uniqueMap(backlogTopics, "topicId", "backlog topic", fail);
  const topicsById = uniqueMap(topics, "topicId", "catalog topic", fail);
  const sourcesById = uniqueMap(sources, "sourceId", "source", fail);
  const factIds = new Set();
  const referencedSourceIds = new Set();
  let approvedFacts = 0;
  let humanAttestedFacts = 0;
  let aiReviewedFacts = 0;
  let verifiedFacts = 0;
  let readyTopics = 0;

  validateBacklog(backlog, backlogTopics, topicsById, fail);

  for (const source of sources) {
    const id = source?.sourceId ?? "<missing>";
    if (!validId(source?.sourceId)) fail(`source has invalid ID: ${id}`);
    if (!nonEmpty(source?.title) || !nonEmpty(source?.publisher)) fail(`source has incomplete title/publisher: ${id}`);
    if (!AUTHORITIES.has(source?.authority)) fail(`source has invalid authority: ${id}`);
    if (!isPublicHttpsUrl(source?.url)) fail(`source must use a public credential-free HTTPS URL: ${id}`);
  }

  for (const topic of topics) {
    const topicId = topic?.topicId ?? "<missing>";
    if (!validId(topic?.topicId)) fail(`catalog topic has invalid ID: ${topicId}`);
    if (!nonEmpty(topic?.displayName) || !nonEmpty(topic?.category)) fail(`catalog topic has incomplete metadata: ${topicId}`);
    if (!Array.isArray(topic?.synonyms) || topic.synonyms.length < 2) {
      fail(`catalog topic requires at least two synonyms: ${topicId}`);
    } else {
      const synonyms = topic.synonyms.map((value) => typeof value === "string" ? value.trim() : "");
      if (synonyms.some((value) => !value) || new Set(synonyms).size !== synonyms.length) {
        fail(`catalog topic synonyms must be non-empty and unique: ${topicId}`);
      }
    }

    const controlled = backlogById.get(topic?.topicId);
    if (!controlled) {
      fail(`catalog topic is outside the controlled backlog: ${topicId}`);
    } else if (controlled.displayName !== topic.displayName || controlled.category !== topic.category) {
      fail(`catalog topic metadata differs from the controlled backlog: ${topicId}`);
    }

    const facts = array(topic?.facts);
    if (!Array.isArray(topic?.facts)) fail(`catalog topic facts must be an array: ${topicId}`);
    if (facts.length < MIN_FACTS_PER_TOPIC || facts.length > MAX_FACTS_PER_TOPIC) {
      fail(`catalog topic must contain 3-5 total facts: ${topicId}`);
    }
    let verifiedGeneralForTopic = 0;

    for (const fact of facts) {
      const factId = fact?.factId ?? "<missing>";
      if (!validId(fact?.factId) || factIds.has(fact?.factId)) {
        fail(`fact IDs must be valid and globally unique: ${factId}`);
      } else {
        factIds.add(fact.factId);
      }
      if (fact?.topicId !== topic?.topicId) fail(`fact topic reference mismatch: ${factId}`);
      const factTextLength = typeof fact?.factText === "string" ? [...fact.factText].length : 0;
      if (typeof fact?.factText !== "string" || fact.factText.trim().length < 20 || factTextLength > 240) {
        fail(`fact text must be 20-240 characters: ${factId}`);
      }
      if (!RISK_LEVELS.has(fact?.riskLevel)) fail(`fact has invalid risk level: ${factId}`);
      if (!REVIEW_STATUSES.has(fact?.reviewStatus)) fail(`fact has invalid review status: ${factId}`);
      if (!Array.isArray(fact?.sourceIds) || fact.sourceIds.length === 0 || new Set(fact.sourceIds).size !== fact.sourceIds.length) {
        fail(`fact must reference distinct source IDs: ${factId}`);
      }

      const factSources = array(fact?.sourceIds).map((sourceId) => {
        referencedSourceIds.add(sourceId);
        const source = sourcesById.get(sourceId);
        if (!source) fail(`fact references a missing source: ${factId} -> ${sourceId}`);
        return source;
      }).filter(Boolean);

      if (fact?.riskLevel === "health" || fact?.riskLevel === "safety") {
        const authoritative = new Set(
          factSources
            .filter((source) => source.authority === "official" || source.authority === "professional")
            .map((source) => source.sourceId)
        );
        if (authoritative.size < 2) fail(`health/safety fact requires two authoritative sources: ${factId}`);
      }

      if (fact?.reviewStatus === "approved") {
        if (factTextLength < 28 || factTextLength > 80) {
          fail(`approved fact must be directly publishable as a 28-80 character card body: ${factId}`);
        }
        approvedFacts += 1;
        if (fact?.riskLevel !== "general") {
          fail(`high-risk fact is not publishable in the AI-only launch catalog: ${factId}`);
        }
        const humanValid = fact?.review !== undefined && validHumanReview(fact.review, now, factId, fail, approvedReviewerIds);
        const aiValid = fact?.aiReview !== undefined && validAiReview(fact.aiReview, now, fact, factId, fail);
        if (fact?.review && fact?.aiReview) fail(`fact cannot carry both human and AI review: ${factId}`);
        if (humanValid) {
          humanAttestedFacts += 1;
        }
        if (aiValid) {
          aiReviewedFacts += 1;
        }
        if ((humanValid || aiValid) && fact?.riskLevel === "general") {
          verifiedFacts += 1;
          verifiedGeneralForTopic += 1;
        } else if (!humanValid && !aiValid) {
          fail(`approved fact lacks a valid human or AI review: ${factId}`);
        }
      } else if (fact?.reviewStatus === "rejected") {
        const humanValid = fact?.review !== undefined && validHumanReview(fact.review, now, factId, fail, approvedReviewerIds);
        const aiValid = fact?.aiReview !== undefined && validAiReview(fact.aiReview, now, fact, factId, fail);
        if (fact?.review && fact?.aiReview) fail(`fact cannot carry both human and AI review: ${factId}`);
        if (!humanValid && !aiValid) fail(`rejected fact lacks a valid human or AI review: ${factId}`);
      } else if (fact?.review !== undefined || fact?.aiReview !== undefined) {
        fail(`draft fact must not carry a review attestation: ${factId}`);
      }
    }

    if (verifiedGeneralForTopic >= 1) readyTopics += 1;
  }

  for (const controlledTopic of backlogTopics) {
    if (!topicsById.has(controlledTopic?.topicId)) {
      fail(`controlled backlog topic is missing from the production catalog: ${controlledTopic?.topicId ?? "<missing>"}`);
    }
  }
  for (const source of sources) {
    if (validId(source?.sourceId) && !referencedSourceIds.has(source.sourceId)) {
      fail(`catalog contains an unreferenced source: ${source.sourceId}`);
    }
  }
  if (readyTopics < MIN_LAUNCH_READY_TOPICS) {
    fail(`AI-only launch requires at least ${MIN_LAUNCH_READY_TOPICS} topics with one verified general fact; found ${readyTopics}`);
  }

  const uniqueBlockers = compactBlockers([...new Set(blockers)]);
  return {
    status: uniqueBlockers.length === 0 ? "GO" : "NO_GO",
    metrics: {
      topics: topics.length,
      controlledTopics: backlogTopics.length,
      readyTopics,
      approvedFacts,
      verifiedFacts,
      aiReviewedFacts,
      humanAttestedFacts,
      sources: sources.length
    },
    blockers: uniqueBlockers
  };
}

function compactBlockers(blockers) {
  const passthrough = [];
  const groups = new Map();
  for (const blocker of blockers) {
    const separator = blocker.indexOf(": ");
    if (separator < 0) {
      passthrough.push(blocker);
      continue;
    }
    const label = blocker.slice(0, separator);
    const detail = blocker.slice(separator + 2);
    const values = groups.get(label) ?? [];
    values.push(detail);
    groups.set(label, values);
  }
  for (const [label, details] of groups) {
    if (details.length <= 5) passthrough.push(...details.map((detail) => `${label}: ${detail}`));
    else passthrough.push(`${label}: ${details.length} violations (examples: ${details.slice(0, 5).join(", ")})`);
  }
  return passthrough;
}

function validateBacklog(backlog, backlogTopics, catalogById, fail) {
  const targets = backlog?.categoryTargets;
  if (!targets || typeof targets !== "object" || Array.isArray(targets)) {
    fail("controlled backlog categoryTargets must be an object");
    return;
  }
  const targetTotal = Object.values(targets).reduce((sum, value) => Number.isInteger(value) && value >= 0 ? sum + value : sum, 0);
  if (targetTotal !== REQUIRED_TOPIC_COUNT) fail("controlled backlog category targets must total exactly 200");
  const actualByCategory = new Map();
  let readyCount = 0;
  let seededCount = 0;
  for (const topic of backlogTopics) {
    const id = topic?.topicId ?? "<missing>";
    if (!validId(topic?.topicId) || !nonEmpty(topic?.displayName) || !nonEmpty(topic?.category)) {
      fail(`controlled backlog topic has invalid metadata: ${id}`);
    }
    actualByCategory.set(topic?.category, (actualByCategory.get(topic?.category) ?? 0) + 1);
    const catalogTopic = catalogById.get(topic?.topicId);
    const facts = array(catalogTopic?.facts);
    const humanAttested = facts.filter((fact) => fact?.reviewStatus === "approved" && hasReviewShape(fact.review)).length;
    const aiReviewed = facts.filter((fact) => fact?.reviewStatus === "approved" && hasAiReviewShape(fact.aiReview)).length;
    const verified = facts.filter((fact) => fact?.riskLevel === "general" && fact?.reviewStatus === "approved" &&
      (hasReviewShape(fact.review) || hasAiReviewShape(fact.aiReview))).length;
    const ready = facts.length >= MIN_FACTS_PER_TOPIC && facts.length <= MAX_FACTS_PER_TOPIC && verified >= 1;
    if (catalogTopic) seededCount += 1;
    if (ready) readyCount += 1;
    if (topic?.catalogState !== (catalogTopic ? "seeded" : "proposed")) fail(`backlog catalog state is stale: ${id}`);
    if (topic?.factsInCatalog !== facts.length) fail(`backlog fact count is stale: ${id}`);
    if (topic?.humanAttestedFactCount !== humanAttested) fail(`backlog human attestation count is stale: ${id}`);
    if (topic?.aiReviewedFactCount !== aiReviewed) fail(`backlog AI review count is stale: ${id}`);
    if (topic?.verifiedGeneralFactCount !== verified) fail(`backlog verified general fact count is stale: ${id}`);
    if (topic?.readyForProduction !== ready) fail(`backlog readiness flag is stale: ${id}`);
    if (topic?.researchState !== (ready ? "ready" : "ai_review_required")) fail(`backlog research state is stale: ${id}`);
  }
  for (const [category, target] of Object.entries(targets)) {
    if (!Number.isInteger(target) || target < 0) fail(`invalid backlog category target: ${category}`);
    if ((actualByCategory.get(category) ?? 0) !== target) fail(`backlog category count differs from target: ${category}`);
  }
  for (const category of actualByCategory.keys()) {
    if (!Object.hasOwn(targets, category)) fail(`backlog contains an uncontrolled category: ${category}`);
  }
  if (backlog?.metrics?.topics !== backlogTopics.length ||
      backlog?.metrics?.seededTopics !== seededCount ||
      backlog?.metrics?.proposedTopics !== backlogTopics.length - seededCount ||
      backlog?.metrics?.productionReadyTopics !== readyCount) {
    fail("controlled backlog metrics are stale");
  }
}

function validHumanReview(review, now, factId, fail, approvedReviewerIds) {
  if (!review || typeof review !== "object" || Array.isArray(review)) {
    fail(`approved fact lacks human review attestation: ${factId}`);
    return false;
  }
  const reviewerId = review.reviewerId;
  let valid = true;
  if (!nonEmpty(reviewerId) || reviewerId.trim().length > 128 ||
      !/^[\p{L}\p{N}._@-]+$/u.test(reviewerId.trim()) || AUTOMATION_REVIEWER.test(reviewerId) || /^(?:ai|bot)$/i.test(reviewerId)) {
    fail(`approved fact has an invalid or automated reviewer identity: ${factId}`);
    valid = false;
  }
  if (approvedReviewerIds instanceof Set && !approvedReviewerIds.has(reviewerId)) {
    fail(`approved fact reviewer is not in the protected release allowlist: ${factId}`);
    valid = false;
  }
  const reviewedAt = strictIso(review?.reviewedAt);
  const sourceCheckedAt = strictIso(review?.sourceCheckedAt);
  if (!reviewedAt || !sourceCheckedAt) {
    fail(`approved fact has invalid review timestamps: ${factId}`);
    valid = false;
  } else {
    if (sourceCheckedAt.getTime() > reviewedAt.getTime()) {
      fail(`source check must not occur after approval: ${factId}`);
      valid = false;
    }
    if (reviewedAt.getTime() > now.getTime() + 5 * 60 * 1000) {
      fail(`approved fact review timestamp is in the future: ${factId}`);
      valid = false;
    }
  }
  return valid;
}

function validAiReview(review, now, fact, factId, fail) {
  if (!review || typeof review !== "object" || Array.isArray(review)) {
    fail(`fact lacks an AI review record: ${factId}`);
    return false;
  }
  let valid = true;
  if (fact?.riskLevel !== "general" || review.provider !== "qwen" ||
      !/^qwen[0-9a-z._-]{2,95}$/i.test(review.model ?? "") ||
      review.policyVersion !== "general-content-v1" ||
      !/^[a-f0-9]{64}$/.test(review.evidenceSha256 ?? "")) {
    fail(`fact has an invalid AI review identity or policy binding: ${factId}`);
    valid = false;
  }
  if (review.decision !== fact?.reviewStatus ||
      (review.decision === "approved") !== (review.reasonCode === "safe_general")) {
    fail(`fact AI decision does not match its status or reason: ${factId}`);
    valid = false;
  }
  const reviewedAt = strictIso(review.reviewedAt);
  if (!reviewedAt || reviewedAt.getTime() > now.getTime() + 5 * 60 * 1000) {
    fail(`fact has an invalid AI review timestamp: ${factId}`);
    valid = false;
  }
  return valid;
}

function hasReviewShape(review) {
  return nonEmpty(review?.reviewerId) && strictIso(review?.reviewedAt) && strictIso(review?.sourceCheckedAt);
}

function hasAiReviewShape(review) {
  return review?.provider === "qwen" && review?.policyVersion === "general-content-v1" &&
    strictIso(review?.reviewedAt) && /^[a-f0-9]{64}$/.test(review?.evidenceSha256 ?? "") &&
    review?.decision === "approved" && review?.reasonCode === "safe_general";
}

function strictIso(value) {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value ? parsed : null;
}

function uniqueMap(items, field, label, fail) {
  const output = new Map();
  for (const item of items) {
    const id = item?.[field];
    if (!nonEmpty(id) || output.has(id)) fail(`${label} IDs must be present and unique: ${id ?? "<missing>"}`);
    else output.set(id, item);
  }
  return output;
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validId(value) {
  return nonEmpty(value) && /^[a-z0-9][a-z0-9_-]{1,127}$/.test(value);
}

function isPublicHttpsUrl(value) {
  if (!nonEmpty(value)) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || !host || url.username || url.password) return false;
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
    if (/^(?:127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host)) return false;
    const private172 = /^172\.(\d{1,3})\./.exec(host);
    if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return false;
    if (host === "[::1]" || host === "::1") return false;
    return true;
  } catch {
    return false;
  }
}

function passingFixture(now) {
  const reviewedAt = new Date(now.getTime() - 60_000).toISOString();
  const sources = [{
    sourceId: "source-1",
    title: "Fixture source",
    url: "https://example.org/fact",
    publisher: "Fixture publisher",
    authority: "reference"
  }];
  const topics = Array.from({ length: REQUIRED_TOPIC_COUNT }, (_, topicIndex) => {
    const topicId = `topic-${topicIndex + 1}`;
    return {
      topicId,
      displayName: `Fixture topic ${topicIndex + 1}`,
      synonyms: [`fixture ${topicIndex + 1}`, `fixture-topic-${topicIndex + 1}`],
      category: "home",
      facts: Array.from({ length: MIN_FACTS_PER_TOPIC }, (_, factIndex) => ({
        factId: `${topicId}-fact-${factIndex + 1}`,
        topicId,
        factText: `This synthetic reviewed fact is valid card content number ${factIndex + 1}.`,
        sourceIds: ["source-1"],
        riskLevel: "general",
        reviewStatus: "approved",
        aiReview: {
          provider: "qwen",
          model: "qwen3.6-flash-2026-04-16",
          policyVersion: "general-content-v1",
          reviewedAt,
          decision: "approved",
          reasonCode: "safe_general",
          evidenceSha256: "a".repeat(64)
        }
      }))
    };
  });
  const backlogTopics = topics.map((topic) => ({
    topicId: topic.topicId,
    displayName: topic.displayName,
    category: topic.category,
    aliases: [...topic.synonyms],
    catalogState: "seeded",
    factsInCatalog: topic.facts.length,
    humanAttestedFactCount: 0,
    aiReviewedFactCount: topic.facts.length,
    verifiedGeneralFactCount: topic.facts.length,
    targetFactCount: 3,
    researchState: "ready",
    readyForProduction: true
  }));
  return {
    catalog: { version: "fixture", sources, topics },
    backlog: {
      version: "fixture-taxonomy",
      generatedFromCatalogVersion: "fixture",
      policy: { publishesFacts: false },
      categoryTargets: { home: REQUIRED_TOPIC_COUNT },
      metrics: { topics: REQUIRED_TOPIC_COUNT, seededTopics: REQUIRED_TOPIC_COUNT, proposedTopics: 0, productionReadyTopics: REQUIRED_TOPIC_COUNT },
      topics: backlogTopics
    }
  };
}

function runSelfTest() {
  const now = new Date();
  const fixture = passingFixture(now);
  const reviewerIds = new Set();
  if (!/^[a-f0-9]{64}$/.test(knowledgeReviewerPolicySha256(reviewerIds))) {
    throw new Error("Knowledge reviewer policy digest is invalid");
  }
  const passing = assessKnowledge(fixture.catalog, fixture.backlog, now, reviewerIds);
  if (passing.status !== "GO") throw new Error(`Passing fixture failed: ${passing.blockers.join("; ")}`);
  const cases = [
    ["exact topic count", (value) => value.catalog.topics.push(structuredClone(value.catalog.topics[0]))],
    ["taxonomy drift", (value) => { value.catalog.topics[0].category = "tool"; }],
    ["duplicate source", (value) => value.catalog.sources.push(structuredClone(value.catalog.sources[0]))],
    ["duplicate fact", (value) => { value.catalog.topics[1].facts[0].factId = value.catalog.topics[0].facts[0].factId; }],
    ["missing source", (value) => { value.catalog.topics[0].facts[0].sourceIds = ["missing-source"]; }],
    ["invalid AI evidence", (value) => { value.catalog.topics[0].facts[0].aiReview.evidenceSha256 = "not-a-digest"; }],
    ["invalid timestamp", (value) => { value.catalog.topics[0].facts[0].aiReview.reviewedAt = "not-a-date"; }],
    ["future timestamp", (value) => { value.catalog.topics[0].facts[0].aiReview.reviewedAt = new Date(now.getTime() + 3_600_000).toISOString(); }],
    ["decision mismatch", (value) => { value.catalog.topics[0].facts[0].aiReview.reasonCode = "unclear_or_unreliable"; }],
    ["risky single source", (value) => { value.catalog.topics[0].facts[0].riskLevel = "health"; }],
    ["approved card body too long", (value) => { value.catalog.topics[0].facts[0].factText = "长".repeat(81); }]
  ];
  for (const [name, mutate] of cases) {
    const value = structuredClone(fixture);
    mutate(value);
    if (assessKnowledge(value.catalog, value.backlog, now, reviewerIds).status !== "NO_GO") {
      throw new Error(`Knowledge gate self-test expected rejection: ${name}`);
    }
  }
  process.stdout.write(`KNOWLEDGE_READINESS_SELF_TEST=GO synthetic=1 releaseEvidence=0 bypassesRejected=${cases.length} aiGeneralReview=1 highRiskExcluded=1\n`);
}

export function knowledgeReviewerIdsFromEnvironment(env = process.env) {
  const raw = String(env.JIANWEI_KNOWLEDGE_REVIEWER_IDS ?? "");
  const values = raw.split(",").map((value) => value.trim()).filter(Boolean);
  const unique = new Set(values);
  for (const reviewerId of unique) {
    if (reviewerId.length > 128 || !/^[\p{L}\p{N}._@-]+$/u.test(reviewerId) ||
        AUTOMATION_REVIEWER.test(reviewerId) || /^(?:ai|bot)$/i.test(reviewerId)) {
      throw new Error("JIANWEI_KNOWLEDGE_REVIEWER_IDS contains an invalid or automated reviewer identity");
    }
  }
  return unique;
}

export function knowledgeReviewerPolicySha256(reviewerIds) {
  if (!(reviewerIds instanceof Set)) throw new Error("Knowledge reviewer policy must be a set");
  const payload = JSON.stringify([
    "jianwei-knowledge-reviewer-policy-v1",
    [...reviewerIds].sort()
  ]);
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

if (isMainModule(import.meta.url)) {
  if (process.argv.includes("--self-test")) {
    runSelfTest();
  } else {
    const catalogFile = process.argv[2] ?? "knowledge/catalog.json";
    const backlogFile = process.argv[3] ?? "knowledge/topic-backlog.json";
    const catalog = JSON.parse(await readFile(catalogFile, "utf8"));
    const backlog = JSON.parse(await readFile(backlogFile, "utf8"));
    const result = assessKnowledge(catalog, backlog, new Date(), knowledgeReviewerIdsFromEnvironment());
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.status !== "GO") process.exitCode = 1;
  }
}
