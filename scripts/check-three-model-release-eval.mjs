import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const args = process.argv.slice(2);
const runValues = repeatedValues("--run");
const outputFile = path.resolve(requiredValue("--output"));
if (runValues.length !== 3) throw new Error("Exactly three --run evaluation.json,gpt.json,kimi.json,deepseek.json entries are required");

const runs = [];
let expectedRuntime;
let expectedDataset;
let expectedPreflight;
let expectedPhotoInput;
const expectedReviewPolicies = new Map();
for (const [runIndex, value] of runValues.entries()) {
  const parts = value.split(",");
  if (parts.length !== 4 || parts.some((part) => !part)) throw new Error("Each --run requires four comma-separated files");
  const [evaluationPath, ...reviewPaths] = parts.map((part) => path.resolve(part));
  const evaluationBytes = await readFile(evaluationPath);
  const evaluationSha256 = createHash("sha256").update(evaluationBytes).digest("hex");
  const evaluation = JSON.parse(evaluationBytes.toString("utf8"));
  if (!evaluation.runtimeProvenance?.workerVersion || evaluation.runtimeProvenance.workerVersion === "local" ||
      !/^[a-f0-9]{64}$/.test(evaluation.datasetSha256 ?? "")) {
    throw new Error(`Run ${runIndex + 1} has no verifiable deployed runtime/dataset identity; old results cannot approve a new build`);
  }
  const runtime = JSON.stringify(evaluation.runtimeProvenance);
  expectedRuntime ??= runtime;
  expectedDataset ??= evaluation.datasetSha256;
  if (runtime !== expectedRuntime || evaluation.datasetSha256 !== expectedDataset) {
    throw new Error("All three runs must evaluate the same runtime and frozen dataset");
  }
  if (evaluation.results.length !== 60 || new Set(evaluation.results.map((item) => item.fileName)).size !== 60 ||
      new Set(evaluation.results.map((item) => item.expectedTopicId)).size < 30) {
    throw new Error("Actual evaluation rows must contain 60 unique photos and at least 30 topics");
  }
  const photoInputs = evaluation.results.map(({ fileName, sanitizedSha256 }) => ({ fileName, sanitizedSha256 }));
  if (![evaluation.preflightSha256, evaluation.photoInputSha256, ...photoInputs.map((photo) => photo.sanitizedSha256)]
      .every((hash) => typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash)) ||
      new Set(photoInputs.map((photo) => photo.sanitizedSha256)).size !== 60 ||
      createHash("sha256").update(JSON.stringify(photoInputs)).digest("hex") !== evaluation.photoInputSha256) {
    throw new Error("Release evidence requires 60 unique sanitized JPEG hashes bound to the photo sequence and privacy preflight");
  }
  expectedPreflight ??= evaluation.preflightSha256;
  expectedPhotoInput ??= evaluation.photoInputSha256;
  if (evaluation.preflightSha256 !== expectedPreflight || evaluation.photoInputSha256 !== expectedPhotoInput) {
    throw new Error("All three runs must use identical actual photo inputs and privacy preflight");
  }
  const reviews = await Promise.all(reviewPaths.map(async (reviewPath) => JSON.parse(await readFile(reviewPath, "utf8"))));
  const providers = reviews.map((review) => normalizedProvider(review.provider)).sort();
  if (JSON.stringify(providers) !== JSON.stringify(["deepseek", "gpt", "kimi"])) throw new Error(`Run ${runIndex + 1} does not contain all three independent providers`);
  if (reviews.some((review) => review.schemaVersion !== 2 || review.evaluationSha256 !== evaluationSha256 ||
      review.round !== runIndex + 1 || path.resolve(review.evaluationFile) !== evaluationPath)) {
    throw new Error(`Run ${runIndex + 1} review provenance mismatch`);
  }
  const ready = evaluation.results.filter((result) => result.status === "ready");
  const dailySelections = validateDailySelections(evaluation);
  if (ready.some(result => !result.card?.cardId || !Array.isArray(result.card.sources) || result.card.sources.length === 0) ||
      new Set(ready.map(result => result.card.cardId)).size !== ready.length) {
    throw new Error("Ready rows require unique card IDs and at least one actual source");
  }
  const expectedIDs = new Set(ready.map(row => row.card.cardId));
  for (const review of reviews) {
    const provider = normalizedProvider(review.provider);
    if (typeof review.model !== "string" || !review.model || !/^[a-f0-9]{64}$/.test(review.reviewPolicySha256 ?? "")) throw new Error("Missing reviewer model/policy identity");
    const identity = JSON.stringify([review.model, review.reviewPolicySha256]);
    if (expectedReviewPolicies.has(provider) && expectedReviewPolicies.get(provider) !== identity) throw new Error("Reviewer model/policy changed between rounds");
    expectedReviewPolicies.set(provider, identity);
    if (!Array.isArray(review.cards) || review.cards.length !== expectedIDs.size ||
        new Set(review.cards.map(card => card.cardId)).size !== expectedIDs.size || review.cards.some(card => !expectedIDs.has(card.cardId))) {
      throw new Error("Reviews must match ready cards exactly without duplicates or extras");
    }
    for (const card of review.cards) assertReviewValues(card.review);
    if (!Number.isInteger(review.batchSize) || review.batchSize < 1 || review.batchSize > 12) throw new Error("Invalid review batch size");
    const batchCount = Math.ceil(ready.length / review.batchSize);
    const dull = review.calibrationReviews?.dull;
    const hard = review.calibrationReviews?.hardIssue;
    if (!Array.isArray(dull) || !Array.isArray(hard) || dull.length !== batchCount || hard.length !== batchCount) throw new Error("Missing raw calibration judgments");
    for (const value of [...dull, ...hard]) assertReviewValues(value);
    const actualCalibration = {
      dullControlPassed: dull.every(item => item.cardId === "control-4f9a" && item.interestingSuitable === false && item.surprise <= 2),
      hardIssueControlPassed: hard.every(item => item.cardId === "control-c2d7" && (item.hardFactIssue === true || item.sourceSupport === false))
    };
    if (Object.entries(actualCalibration).some(([key, value]) => review.calibration?.[key] !== value)) throw new Error("Calibration summary disagrees with raw judgments");
  }
  const reviewMaps = reviews.map((review) => new Map(review.cards.map((card) => [card.cardId, card])));
  const reachability = new Map();
  for (const check of evaluation.sourceChecks ?? []) {
    const key = JSON.stringify([check.cardId, check.url]);
    if (reachability.has(key)) throw new Error("Duplicate source check cannot be counted twice");
    reachability.set(key, check.reachable === true);
  }
  const actualSources = ready.flatMap(result => result.card.sources.map(source => ({ cardId: result.card.cardId, url: source.url })));
  const actualWindows = evaluation.results.slice(8).map((_, index) =>
    evaluation.results.slice(index, index + 9).some(result => result.status === "ready"));
  const actualMetrics = {
    photos: evaluation.results.length,
    ready: ready.length,
    qualifiedRate: rounded(ready.length / evaluation.results.length),
    slidingNineCoverageRate: rounded(actualWindows.filter(Boolean).length / actualWindows.length),
    sourceReachabilityRate: actualSources.length ? rounded(actualSources.filter(source =>
      reachability.get(JSON.stringify([source.cardId, source.url])) === true).length / actualSources.length) : 0
  };
  if (Object.entries(actualMetrics).some(([key, value]) => evaluation.metrics?.[key] !== value)) {
    throw new Error("Reported metrics do not match raw rows and card-bound source checks");
  }
  const cards = ready.map((result) => {
    const providerReviews = reviewMaps.map((map) => map.get(result.card.cardId));
    if (providerReviews.some((review) => !review)) throw new Error(`Missing provider review for ${result.card.cardId}`);
    const passVotes = providerReviews.filter(({ review }) => review.hardFactIssue === false &&
      review.sourceSupport === true && review.objectMatch === true && review.interestingSuitable === true &&
      review.surprise >= 3 && review.aha >= 4 && review.retellability >= 4 && review.imageConnection >= 3).length;
    const hardFactIssue = providerReviews.some((review) => review.review.hardFactIssue);
    const sourceSupportVotes = providerReviews.filter((review) => review.review.sourceSupport).length;
    const objectMatchVotes = providerReviews.filter((review) => review.review.objectMatch).length;
    // Taste uses two-of-three votes. A disagreement about evidence or the
    // photographed object needs resolution, not a majority vote declaring
    // "100% correct". Keep factual errors distinct from unresolved dissent.
    const hardIssue = hardFactIssue || sourceSupportVotes < 2 || objectMatchVotes < 2;
    const unresolvedEvidence = sourceSupportVotes < 3 || objectMatchVotes < 3;
    return {
      cardId: result.card.cardId,
      fileName: result.fileName,
      passVotes,
      sourceSupportVotes,
      objectMatchVotes,
      hasJudgeDissent: passVotes < 3 || sourceSupportVotes < 3 || objectMatchVotes < 3,
      consensusPassed: passVotes >= 2 && !hardIssue,
      hardIssue,
      unresolvedEvidence,
      providers: Object.fromEntries(reviews.map((review, index) => [normalizedProvider(review.provider), providerReviews[index].review]))
    };
  });
  const consensusPassed = cards.filter((card) => card.consensusPassed).length;
  const metrics = {
    qualifiedRate: actualMetrics.qualifiedRate,
    slidingNineCoverageRate: actualMetrics.slidingNineCoverageRate,
    sourceReachabilityRate: actualMetrics.sourceReachabilityRate,
    consensusInterestingRate: cards.length ? rounded(consensusPassed / cards.length) : 0,
    hardIssueCards: cards.filter((card) => card.hardIssue).length,
    unresolvedEvidenceCards: cards.filter((card) => card.unresolvedEvidence).length,
    judgeDissentCards: cards.filter((card) => card.hasJudgeDissent).length,
    dailyGroupsWithCard: dailySelections.filter(group => group.winnerCardId).length,
    fallbackDailySelections: dailySelections.filter(group => group.selectionMethod === "fallback").length,
    calibrationPassed: reviews.every((review) => review.calibration?.dullControlPassed === true && review.calibration?.hardIssueControlPassed === true)
  };
  const passed = actualMetrics.photos === 60 && actualMetrics.ready >= 36 &&
    metrics.qualifiedRate >= 0.6 && metrics.slidingNineCoverageRate >= 0.95 && metrics.sourceReachabilityRate === 1 &&
    metrics.consensusInterestingRate >= 0.85 && metrics.hardIssueCards === 0 && metrics.unresolvedEvidenceCards === 0 && metrics.calibrationPassed &&
    metrics.dailyGroupsWithCard === dailySelections.length && metrics.fallbackDailySelections === 0;
  runs.push({ run: runIndex + 1, evaluationFile: evaluationPath, reviewFiles: reviewPaths, metrics, passed, cards });
}

const variation = Object.fromEntries(["qualifiedRate", "slidingNineCoverageRate", "consensusInterestingRate"].map((key) => {
  const values = runs.map((run) => run.metrics[key]);
  return [key, rounded(Math.max(...values) - Math.min(...values))];
}));
const stable = Object.values(variation).every((value) => value <= 0.05);
const passed = stable && runs.every((run) => run.passed);
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  runtimeProvenance: JSON.parse(expectedRuntime),
  datasetSha256: expectedDataset,
  preflightSha256: expectedPreflight,
  photoInputSha256: expectedPhotoInput,
  gate: {
    publicEligiblePhotos: 60,
    minimumTopics: 30,
    consecutiveRuns: 3,
    judges: ["gpt", "kimi", "deepseek"],
    minimumQualifiedRate: 0.6,
    minimumSlidingNineCoverageRate: 0.95,
    minimumTwoOfThreeInterestingRate: 0.85,
    requireZeroHardIssues: true,
    requireResolvedEvidenceDisagreements: true,
    requireFullSourceReachability: true,
    requireVerifiedDailySelections: true,
    requireIdenticalSanitizedPhotoInputs: true,
    requireNoFallbackDailySelections: true,
    maximumMetricVariation: 0.05
  },
  variation,
  stable,
  passed,
  runs
};
await writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
process.stdout.write(`THREE_MODEL_RELEASE_EVAL=${passed ? "PASS" : "FAIL"} runs=3 stable=${stable} variation=${JSON.stringify(variation)}\n`);
if (!passed) process.exitCode = 1;

function repeatedValues(flag) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) if (args[index] === flag && args[index + 1]) values.push(args[index + 1]);
  return values;
}
function requiredValue(flag) { const index = args.indexOf(flag); const value = index >= 0 ? args[index + 1] : null; if (!value) throw new Error(`${flag} is required`); return value; }
function normalizedProvider(provider) { return provider === "deepseek-bailian" ? "deepseek" : provider; }
function rounded(value) { return Math.round(value * 10_000) / 10_000; }
function validateDailySelections(evaluation) {
  const groups = evaluation.dailyGroups;
  if (!Array.isArray(groups) || groups.length !== Math.ceil(evaluation.results.length / 9)) {
    throw new Error("Missing daily selection evidence for the full photo sequence");
  }
  for (const [index, group] of groups.entries()) {
    const photos = evaluation.results.slice(index * 9, index * 9 + 9);
    const ids = photos.filter(row => row.status === "ready").slice(0, 3).map(row => row.card?.cardId);
    if (group.index !== index || group.analyzedPhotoCount !== photos.length ||
        JSON.stringify(group.photoFileNames) !== JSON.stringify(photos.map(row => row.fileName)) ||
        JSON.stringify(group.qualifiedCardIds) !== JSON.stringify(ids)) {
      throw new Error("Daily selection candidates do not match the original photo sequence");
    }
    if (ids.length === 0 ? group.winnerCardId !== null : !ids.includes(group.winnerCardId)) {
      throw new Error("Daily winner must belong to that day's first three qualified cards");
    }
    const methods = ids.length >= 2 ? ["ai", "fallback"] : ids.length === 1 ? ["single"] : ["none"];
    if (!methods.includes(group.selectionMethod)) throw new Error("Missing or invalid daily selection method");
  }
  return groups;
}
function assertReviewValues(review) {
  if (!review || typeof review !== "object") throw new Error("Missing raw review");
  for (const key of ["surprise", "aha", "retellability", "imageConnection", "naturalness"]) {
    if (!Number.isInteger(review[key]) || review[key] < 1 || review[key] > 5) throw new Error(`Invalid review score ${key}`);
  }
  for (const key of ["hardFactIssue", "sourceSupport", "objectMatch", "interestingSuitable"]) {
    if (typeof review[key] !== "boolean") throw new Error(`Invalid review boolean ${key}`);
  }
}
