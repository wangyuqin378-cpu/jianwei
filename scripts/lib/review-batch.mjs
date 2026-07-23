import {
  REVIEW_BATCH_KIND,
  REVIEW_BATCH_SCHEMA_VERSION,
  assertAccountableReviewerId,
  assertExactKeys,
  factReviewDigest,
  isPublicHttpsUrl,
  sha256Text
} from "./fact-review.mjs";

const BATCH_KEYS = [
  "schemaVersion",
  "evidenceKind",
  "catalogVersion",
  "catalogSha256",
  "nextCatalogVersion",
  "createdFromQueueAt",
  "decisions"
];
const DECISION_KEYS = [
  "factId",
  "factSha256",
  "decision",
  "checkedSourceIds",
  "semanticSupportConfirmed",
  "unsupportedClaimsChecked",
  "notes"
];

export function applyReviewBatch({ catalogText, batch, reviewerId, confirmRereview = false, now = new Date() }) {
  assertAccountableReviewerId(reviewerId);
  assertExactKeys(batch, BATCH_KEYS, "review batch");
  if (batch.schemaVersion !== REVIEW_BATCH_SCHEMA_VERSION || batch.evidenceKind !== REVIEW_BATCH_KIND) {
    throw new Error("Review batch schema or evidence kind is invalid");
  }
  if (!/^[A-Za-z0-9._-]{3,100}$/.test(batch.catalogVersion) ||
      !/^[A-Za-z0-9._-]{3,100}$/.test(batch.nextCatalogVersion) ||
      batch.nextCatalogVersion === batch.catalogVersion ||
      batch.nextCatalogVersion === "REPLACE_WITH_NEW_VERSION") {
    throw new Error("Review batch must pin distinct valid catalog and next-catalog versions");
  }
  if (!/^[a-f0-9]{64}$/.test(batch.catalogSha256) || sha256Text(catalogText) !== batch.catalogSha256) {
    throw new Error("Review batch catalog SHA-256 is stale or invalid");
  }
  const catalog = JSON.parse(catalogText);
  if (!Array.isArray(catalog.sources) || !Array.isArray(catalog.topics) || catalog.version !== batch.catalogVersion) {
    throw new Error("Review batch catalog version or structure is stale");
  }
  if (!Array.isArray(batch.decisions) || batch.decisions.length < 1 || batch.decisions.length > 50) {
    throw new Error("Review batch must contain 1-50 decisions");
  }

  const sourceById = new Map();
  for (const source of catalog.sources) {
    if (!source?.sourceId || sourceById.has(source.sourceId)) throw new Error("Catalog source IDs must be present and unique");
    sourceById.set(source.sourceId, source);
  }
  const factById = new Map();
  for (const topic of catalog.topics) {
    if (!topic?.topicId || !Array.isArray(topic.facts)) throw new Error("Catalog topics are invalid");
    for (const fact of topic.facts) {
      if (!fact?.factId || factById.has(fact.factId)) throw new Error("Catalog fact IDs must be present and unique");
      factById.set(fact.factId, { topic, fact });
    }
  }

  const seen = new Set();
  const timestamp = now.toISOString();
  if (!Number.isFinite(now.getTime())) throw new Error("Review timestamp is invalid");
  let approved = 0;
  let rejected = 0;

  for (const decision of batch.decisions) {
    assertExactKeys(decision, DECISION_KEYS, "review decision");
    if (typeof decision.factId !== "string" || seen.has(decision.factId)) throw new Error("Review decision fact IDs must be present and unique");
    seen.add(decision.factId);
    const record = factById.get(decision.factId);
    if (!record) throw new Error(`Review decision references an unknown fact: ${decision.factId}`);
    if (decision.factSha256 !== factReviewDigest(record.topic.topicId, record.fact)) {
      throw new Error(`Review decision fact digest is stale: ${decision.factId}`);
    }
    if (record.fact.review && !confirmRereview) {
      throw new Error(`Fact already has a review attestation; --confirm-rereview is required: ${decision.factId}`);
    }
    if (!Array.isArray(decision.checkedSourceIds) || new Set(decision.checkedSourceIds).size !== decision.checkedSourceIds.length) {
      throw new Error(`Checked source IDs must be a unique array: ${decision.factId}`);
    }
    const referenced = new Set(record.fact.sourceIds);
    if (decision.checkedSourceIds.some((sourceId) => !referenced.has(sourceId))) {
      throw new Error(`Review decision checks an unreferenced source: ${decision.factId}`);
    }
    const sources = record.fact.sourceIds.map((sourceId) => sourceById.get(sourceId));
    if (sources.some((source) => !source || !isPublicHttpsUrl(source.url))) {
      throw new Error(`Reviewed fact has a missing or private source: ${decision.factId}`);
    }
    if (typeof decision.notes !== "string" || [...decision.notes.trim()].length > 500) {
      throw new Error(`Review notes must be a string of at most 500 characters: ${decision.factId}`);
    }

    if (decision.decision === "approve") {
      if (decision.semanticSupportConfirmed !== true || decision.unsupportedClaimsChecked !== true) {
        throw new Error(`Approval confirmations are incomplete: ${decision.factId}`);
      }
      if (decision.checkedSourceIds.length !== referenced.size || decision.checkedSourceIds.some((sourceId) => !referenced.has(sourceId))) {
        throw new Error(`Approval must explicitly check every referenced source: ${decision.factId}`);
      }
      if (record.fact.riskLevel !== "general") {
        const authorities = new Set(sources
          .filter((source) => source.authority === "official" || source.authority === "professional")
          .map((source) => source.sourceId));
        if (authorities.size < 2) throw new Error(`High-risk approval requires two authoritative sources: ${decision.factId}`);
      }
      const bodyLength = [...record.fact.factText].length;
      if (bodyLength < 28 || bodyLength > 80) throw new Error(`Approved fact must be a 28-80 character card body: ${decision.factId}`);
      record.fact.reviewStatus = "approved";
      approved += 1;
    } else if (decision.decision === "reject") {
      if (decision.checkedSourceIds.length < 1 || [...decision.notes.trim()].length < 10) {
        throw new Error(`Rejection requires at least one checked source and a 10-character reason: ${decision.factId}`);
      }
      if (decision.semanticSupportConfirmed !== false) {
        throw new Error(`Rejected facts cannot claim confirmed semantic support: ${decision.factId}`);
      }
      if (decision.unsupportedClaimsChecked !== true) {
        throw new Error(`Rejection must still confirm that unsupported claims were checked: ${decision.factId}`);
      }
      record.fact.reviewStatus = "rejected";
      rejected += 1;
    } else {
      throw new Error(`Review decision must be approve or reject: ${decision.factId}`);
    }
    record.fact.review = {
      reviewerId,
      reviewedAt: timestamp,
      sourceCheckedAt: timestamp,
      ...(decision.notes.trim() ? { notes: decision.notes.trim() } : {})
    };
  }

  catalog.version = batch.nextCatalogVersion;
  return {
    catalog,
    catalogText: `${JSON.stringify(catalog, null, 2)}\n`,
    metrics: { approved, rejected, decisions: batch.decisions.length }
  };
}
