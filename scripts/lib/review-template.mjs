import { REVIEW_BATCH_KIND, REVIEW_BATCH_SCHEMA_VERSION } from "./fact-review.mjs";

export function createReviewTemplate(queue, { limit = 20, topicId = null } = {}) {
  if (queue?.schemaVersion !== 2 || queue?.evidenceKind !== "human_semantic_review_work_queue" ||
      queue?.policy?.grantsApproval !== false || !/^[a-f0-9]{64}$/.test(queue?.catalogSha256 ?? "") ||
      !Array.isArray(queue?.reviewableTopics)) {
    throw new Error("Review queue is invalid or does not carry a fail-closed snapshot pin");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new Error("Review template limit must be an integer from 1 to 50");
  }
  const candidates = queue.reviewableTopics
    .filter((topic) => !topicId || topic.topicId === topicId)
    .flatMap((topic) => topic.facts.map((fact) => ({ topicId: topic.topicId, ...fact })));
  if (topicId && !candidates.length) throw new Error(`No reviewable pending facts found for topic: ${topicId}`);
  const selected = candidates.slice(0, limit);
  if (!selected.length) throw new Error("Review queue has no reviewable pending facts");
  for (const fact of selected) {
    if (!/^[a-f0-9]{64}$/.test(fact.factSha256 ?? "") || !Array.isArray(fact.sources) || !fact.sources.length) {
      throw new Error(`Review queue fact is not snapshot-pinned: ${fact.factId ?? "<missing>"}`);
    }
  }
  return {
    schemaVersion: REVIEW_BATCH_SCHEMA_VERSION,
    evidenceKind: REVIEW_BATCH_KIND,
    catalogVersion: queue.catalogVersion,
    catalogSha256: queue.catalogSha256,
    nextCatalogVersion: "REPLACE_WITH_NEW_VERSION",
    createdFromQueueAt: queue.generatedAt,
    decisions: selected.map((fact) => ({
      factId: fact.factId,
      factSha256: fact.factSha256,
      decision: "pending",
      checkedSourceIds: [],
      semanticSupportConfirmed: false,
      unsupportedClaimsChecked: false,
      notes: ""
    }))
  };
}

export function assertFailClosedReviewTemplate(template) {
  if (!Array.isArray(template?.decisions) || !template.decisions.length || template.decisions.some((item) =>
    item.decision !== "pending" || item.semanticSupportConfirmed !== false ||
    item.unsupportedClaimsChecked !== false || !Array.isArray(item.checkedSourceIds) || item.checkedSourceIds.length > 0 ||
    item.notes !== "")) {
    throw new Error("Review template must start pending with no pre-confirmed human checks");
  }
}
