import {evidenceClaims, interpretStructuredEvidenceReview} from "./evidence-relations-experiment.js";

type Candidate = Parameters<typeof interpretStructuredEvidenceReview>[1];
type Sources = Parameters<typeof interpretStructuredEvidenceReview>[2];

// Diagnostic-only scoring: rejecting an unrelated title cannot hide a missed body error.
export function scoreEvidenceBodyPair(raw: Record<string, unknown>, fact: Candidate, sources: Sources,
  expected: boolean, requiredUnsupportedTexts: string[]) {
  const claims = evidenceClaims(fact);
  if (expected !== (requiredUnsupportedTexts.length === 0) ||
      new Set(requiredUnsupportedTexts).size !== requiredUnsupportedTexts.length) throw new Error("Invalid expected targets");
  const targets = requiredUnsupportedTexts.map(text => {
    const claim = claims.find(claim => claim.field === "body" && claim.text === text);
    if (!claim) throw new Error("Required error is not an exact body sentence");
    return claim;
  });
  const review = interpretStructuredEvidenceReview(raw, fact, sources);
  const checks = raw.checks as Record<string, {supported?: boolean}> | undefined;
  // The experiment parser may safely reject a card before considering another
  // sentence's bad quote. Diagnostic validity must still verify every support.
  const invalidSupportIDs = review === null ? [] : claims.filter(claim =>
    checks?.[claim.id]?.supported === true && interpretStructuredEvidenceReview(
      {checks: {"title:0": checks[claim.id]}}, {...fact, title: claim.text, body: ""}, sources
    ) === null).map(claim => claim.id);
  const valid = review !== null && invalidSupportIDs.length === 0;
  const targetResults = targets.map(claim => ({id: claim.id, text: claim.text,
    rejected: review !== null && checks?.[claim.id]?.supported === false}));
  const wholeCardMatched = review !== null && review.accepted === expected;
  return {review, valid, invalidSupportIDs, wholeCardMatched, targetResults,
    matched: valid && wholeCardMatched && targetResults.every(target => target.rejected)};
}
