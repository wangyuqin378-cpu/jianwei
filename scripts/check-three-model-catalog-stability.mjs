import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertBoundCatalogCard, blindCardInput, catalogCardSha256, sha256, uniqueByID } from "./lib/catalog-review-provenance.mjs";

const args = process.argv.slice(2);
const baseFile = values("--base")[0] ? path.resolve(values("--base")[0]) : null;
const outputFile = path.resolve(requiredValue("--output"));
const sets = values("--set");
const retiredFactIds = new Set(values("--retire-fact-id"));
if (sets.length < 1) throw new Error("At least one --set is required");

const base = baseFile ? JSON.parse(await readFile(baseFile, "utf8")) : {
  schemaVersion: 3, evidenceKind: "source-bound-three-provider-catalog-stability", stableFactIds: [], cards: [], inputs: []
};
if (base.schemaVersion !== 3 || base.evidenceKind !== "source-bound-three-provider-catalog-stability" ||
    !Array.isArray(base.stableFactIds) || !Array.isArray(base.cards) || !Array.isArray(base.inputs)) {
  throw new Error("Legacy unbound approvals cannot be inherited; rebuild source-bound reviews without --base");
}
const inputByFile = new Map();
for (const input of base.inputs) {
  if (sha256(await readFile(input.file)) !== input.sha256) throw new Error(`Base review artifact changed: ${input.file}`);
  inputByFile.set(input.file, input);
}
for (const card of base.cards) assertBoundCatalogCard(card.reviewedCard);
const readInput = async file => {
  const bytes = await readFile(file);
  inputByFile.set(file, { file, sha256: sha256(bytes) });
  return JSON.parse(bytes.toString("utf8"));
};

const promotedCards = [];
const rejectedCards = [];
const seenFactIDs = new Set();
for (const setValue of sets) {
  const parts = setValue.split(",").map((value) => path.resolve(value));
  if (parts.length !== 10) {
    throw new Error("Each --set requires evaluation.json followed by nine review files");
  }
  const [evaluationFile, ...reviewFiles] = parts;
  const evaluation = await readInput(evaluationFile);
  if (evaluation.evidenceKind !== "source-bound-catalog-review-candidates") throw new Error("Missing actual-source catalog evaluation");
  const ready = evaluation.results.filter(item => item.status === "ready");
  const readyByID = uniqueByID(ready.map(result => result.card), "cardId", "evaluation cards");
  for (const result of ready) assertBoundCatalogCard(result.card);
  if (!ready.length) throw new Error("Empty catalog evaluation");
  const reviews = await Promise.all(reviewFiles.map(readInput));
  const identities = reviews.map((review) => `${normalizedProvider(review.provider)}:${review.round}`).sort();
  const expectedIdentities = ["deepseek", "gpt", "kimi"].flatMap((provider) =>
    [1, 2, 3].map((round) => `${provider}:${round}`)
  ).sort();
  if (JSON.stringify(identities) !== JSON.stringify(expectedIdentities)) {
    throw new Error(`Review set must contain every provider and round exactly once: ${setValue}`);
  }
  const policies = new Map();
  for (const review of reviews) {
    if (review.schemaVersion !== 2 || path.resolve(review.evaluationFile) !== evaluationFile ||
        review.evaluationSha256 !== inputByFile.get(evaluationFile).sha256 || review.summary?.calibrationPassed !== true) {
      throw new Error(`Review provenance or calibration failed for ${review.provider}:${review.round}`);
    }
    const provider = normalizedProvider(review.provider);
    const identity = JSON.stringify([review.model, review.reviewPolicySha256]);
    if (typeof review.model !== "string" || !review.model || !/^[a-f0-9]{64}$/.test(review.reviewPolicySha256 ?? "") ||
        (policies.has(provider) && policies.get(provider) !== identity)) throw new Error("Reviewer model/policy changed between rounds");
    policies.set(provider, identity);
    const byID = uniqueByID(review.cards, "cardId", "review cards");
    if (byID.size !== readyByID.size || [...byID.keys()].some(id => !readyByID.has(id))) throw new Error("Review card set does not match evaluation");
    for (const result of ready) {
      const actual = byID.get(result.card.cardId);
      const expected = blindCardInput(result);
      const actualPayload = Object.fromEntries(Object.keys(expected).map(key => [key, actual[key]]));
      if (catalogCardSha256(actualPayload) !== catalogCardSha256(expected)) throw new Error("Reviewed copy/source payload differs from evaluation");
      const verdict = actual.review;
      if (verdict?.cardId !== actual.cardId || ["hardFactIssue", "sourceSupport", "objectMatch", "interestingSuitable"]
        .some(key => typeof verdict[key] !== "boolean") || ["surprise", "aha", "retellability", "imageConnection", "naturalness"]
        .some(key => !Number.isFinite(verdict[key]) || verdict[key] < 1 || verdict[key] > 5)) throw new Error("Invalid raw judgment");
      if (actual.passed !== judgmentPassed(verdict)) throw new Error("Review summary disagrees with raw judgment");
    }
    if (!Number.isInteger(review.batchSize) || review.batchSize < 1 || review.batchSize > 12) throw new Error("Invalid review batch size");
    const count = Math.ceil(ready.length / review.batchSize);
    const dull = review.calibrationReviews?.dull;
    const hard = review.calibrationReviews?.hardIssue;
    if (!Array.isArray(dull) || !Array.isArray(hard) || dull.length !== count || hard.length !== count ||
        review.calibration?.dullControlPassed !== true || review.calibration?.hardIssueControlPassed !== true ||
        !dull.every(item => item.cardId === "control-4f9a" && item.interestingSuitable === false &&
          Number.isFinite(item.surprise) && item.surprise >= 1 && item.surprise <= 2) ||
        !hard.every(item => item.cardId === "control-c2d7" && (item.hardFactIssue === true || item.sourceSupport === false))) {
      throw new Error("Missing or failed raw calibration judgments");
    }
  }

  for (const result of ready) {
    if (seenFactIDs.has(result.card.factId)) throw new Error("Duplicate fact across evaluation sets");
    seenFactIDs.add(result.card.factId);
    const trials = reviews.map((review, index) => {
      const card = review.cards.find((candidate) => candidate.cardId === result.card.cardId);
      if (!card) throw new Error(`Missing ${result.card.cardId} from ${review.provider}:${review.round}`);
      return { reviewFile: reviewFiles[index], provider: review.provider, round: review.round, ...card };
    });
    const stable = trials.every((trial) => trial.passed && !trial.review.hardFactIssue &&
      trial.review.sourceSupport && trial.review.objectMatch);
    const card = {
      cardId: result.card.cardId,
      factId: result.card.factId,
      reviewedCard: result.card,
      contentSha256: result.card.contentSha256,
      evaluationFile,
      passedTrials: trials.filter((trial) => trial.passed).length,
      stable,
      trials: [1, 2, 3].map((round) => {
        const roundTrials = trials.filter((trial) => trial.round === round);
        return {
          round,
          providers: roundTrials.map(trial => normalizedProvider(trial.provider)),
          reviewFiles: roundTrials.map((trial) => trial.reviewFile),
          passedToken: `${roundTrials.length}/3 providers`,
          passed: roundTrials.every((trial) => trial.passed),
          medians: {
            surprise: Math.min(...roundTrials.map((trial) => trial.review.surprise)),
            aha: Math.min(...roundTrials.map((trial) => trial.review.aha)),
            retellability: Math.min(...roundTrials.map((trial) => trial.review.retellability)),
            imageConnection: Math.min(...roundTrials.map((trial) => trial.review.imageConnection)),
            naturalness: Math.min(...roundTrials.map((trial) => trial.review.naturalness))
          },
          hardIssues: roundTrials.filter((trial) => trial.review.hardFactIssue ||
            !trial.review.sourceSupport || !trial.review.objectMatch).length
        };
      })
    };
    (stable ? promotedCards : rejectedCards).push(card);
  }
}

const baseByFactId = new Map(base.cards.map((card) => [card.factId, card]));
// A failed fresh review must not leave a same-ID approval inherited from base.
for (const card of rejectedCards) baseByFactId.delete(card.factId);
for (const factId of retiredFactIds) {
  if (!baseByFactId.delete(factId)) {
    throw new Error(`Retired fact is absent from the base stability report: ${factId}`);
  }
}
for (const card of promotedCards) baseByFactId.set(card.factId, card);
const cards = [...baseByFactId.values()].sort((left, right) => left.factId.localeCompare(right.factId));
const report = {
  schemaVersion: 3,
  evidenceKind: "source-bound-three-provider-catalog-stability",
  inputs: [...inputByFile.values()],
  generatedAt: new Date().toISOString(),
  policy: {
    baseStabilityFile: baseFile,
    judges: ["gpt", "kimi", "deepseek"],
    rounds: 3,
    requireEveryJudgeAndRoundPassed: true,
    requireEveryCalibrationPassed: true,
    requireZeroHardIssues: true
  },
  passed: promotedCards.length > 0,
  trialCount: 9,
  stableFactIds: cards.filter(card => card.stable === true).map((card) => card.factId),
  newlyPromotedFactIds: promotedCards.map((card) => card.factId).sort(),
  retiredFactIds: [...retiredFactIds].sort(),
  rejectedFactIds: rejectedCards.map((card) => card.factId).sort(),
  rejectedCards,
  cards
};
await writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
process.stdout.write(`THREE_MODEL_CATALOG_STABILITY=${report.passed ? "PASS" : "FAIL"} promoted=${promotedCards.length} rejected=${rejectedCards.length} total=${cards.length}\n`);
if (!report.passed) process.exitCode = 1;

function values(flag) {
  const output = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && args[index + 1]) output.push(args[index + 1]);
  }
  return output;
}

function requiredValue(flag) {
  const value = values(flag)[0];
  if (!value) throw new Error(`${flag} is required`);
  return value;
}

function normalizedProvider(provider) {
  return provider === "deepseek-bailian" ? "deepseek" : provider;
}

function judgmentPassed(review) {
  return !review.hardFactIssue && review.sourceSupport && review.objectMatch && review.interestingSuitable &&
    review.surprise >= 3 && review.aha >= 4 && review.retellability >= 4 && review.imageConnection >= 3;
}
