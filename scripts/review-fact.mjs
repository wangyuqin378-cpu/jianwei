throw new Error(
  "Direct single-fact approval is disabled because it cannot pin an atomic review snapshot. " +
  "Use create-knowledge-review-batch.mjs, complete the pending decisions as an accountable human, " +
  "then apply-knowledge-review-batch.mjs with --confirm-human-review --write."
);
