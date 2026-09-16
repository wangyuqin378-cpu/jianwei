import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

function runGate(mutate = () => {}) {
  const root = mkdtempSync(path.join(tmpdir(), "jianwei-eval-gate-"));
  try {
    const args = [];
    for (let round = 1; round <= 3; round++) {
      const evaluationFile = path.join(root, `evaluation-${round}.json`);
      const results = Array.from({ length: 60 }, (_, index) => ({
        fileName: `photo-${index}.jpg`, expectedTopicId: `topic-${index % 30}`,
        sanitizedSha256: createHash("sha256").update(`fixture-photo-${index}`).digest("hex"),
        status: index % 3 === 2 ? "no_insight" : "ready",
        card: index % 3 === 2 ? null : { cardId: `card-${index}`, sources: [{ url: `https://example.edu/${index}` }] }
      }));
      const evaluation = {
        runtimeProvenance: { workerVersion: "test-deployed-version", policyVersion: "test-policy", models: { search: "test-model" } },
        datasetSha256: "a".repeat(64), preflightSha256: "d".repeat(64), results,
        photoInputSha256: createHash("sha256").update(JSON.stringify(results.map(row => ({fileName:row.fileName,sanitizedSha256:row.sanitizedSha256})))).digest("hex"),
        metrics: { photos: 60, ready: 40, qualifiedRate: 0.6667, slidingNineCoverageRate: 1, sourceReachabilityRate: 1 },
        dailyGroups: Array.from({ length: 7 }, (_, index) => {
          const photos = results.slice(index * 9, index * 9 + 9);
          const candidates = photos.filter(row => row.status === "ready").slice(0, 3);
          return { index, photoFileNames: photos.map(row => row.fileName), analyzedPhotoCount: photos.length,
            qualifiedCardIds: candidates.map(row => row.card.cardId), winnerCardId: candidates[0].card.cardId,
            selectionMethod: "ai" };
        }),
        sourceChecks: results.filter(row => row.card).map(row => ({ cardId: row.card.cardId, url: row.card.sources[0].url, reachable: true }))
      };
      const reviews = ["gpt", "kimi", "deepseek"].map(provider => ({
        schemaVersion: 2, provider, model: `${provider}-fixed-test-model`, round, evaluationFile, batchSize: 8,
        reviewPolicySha256: "b".repeat(64),
        calibration: { dullControlPassed: true, hardIssueControlPassed: true },
        calibrationReviews: {
          dull: Array.from({ length: 5 }, () => ({ cardId: "control-4f9a", hardFactIssue: false, sourceSupport: true, objectMatch: true, interestingSuitable: false, surprise: 1, aha: 2, retellability: 4, imageConnection: 4, naturalness: 4 })),
          hardIssue: Array.from({ length: 5 }, () => ({ cardId: "control-c2d7", hardFactIssue: true, sourceSupport: false, objectMatch: true, interestingSuitable: false, surprise: 2, aha: 2, retellability: 4, imageConnection: 4, naturalness: 4 }))
        },
        cards: results.filter(row => row.card).map(row => ({
          cardId: row.card.cardId, passed: true,
          review: { hardFactIssue: false, sourceSupport: true, objectMatch: true, interestingSuitable: true, surprise: 4, aha: 4, retellability: 4, imageConnection: 4, naturalness: 4 }
        }))
      }));
      mutate(evaluation, reviews, round);
      writeFileSync(evaluationFile, JSON.stringify(evaluation));
      const hash = createHash("sha256").update(readFileSync(evaluationFile)).digest("hex");
      const reviewFiles = reviews.map(review => {
        if (!("evaluationSha256" in review)) review.evaluationSha256 = hash;
        const file = path.join(root, `${review.provider}-${round}.json`);
        writeFileSync(file, JSON.stringify(review));
        return file;
      });
      args.push("--run", [evaluationFile, ...reviewFiles].join(","));
    }
    const output = path.join(root, "gate.json");
    const result = spawnSync(process.execPath, [new URL("./check-three-model-release-eval.mjs", import.meta.url).pathname, ...args, "--output", output], { encoding: "utf8" });
    let report;
    try { report = JSON.parse(readFileSync(output, "utf8")); } catch { /* failed preflight intentionally emits no approval */ }
    return { status: result.status, stderr: result.stderr, report };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("complete same-version evidence passes the mechanical gate, not a release approval", () => {
  const result = runGate();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.report.passed, true);
});

test("summary metrics cannot hide missing source checks or fabricate production results", () => {
  for (const mutate of [
    evaluation => { evaluation.sourceChecks = []; },
    evaluation => { evaluation.metrics.ready = 60; },
    evaluation => { evaluation.results[0].card.sources[0].url = "https://unverified.edu/changed"; },
    evaluation => { delete evaluation.runtimeProvenance; },
    (evaluation, _reviews, round) => { if (round === 2) evaluation.runtimeProvenance.workerVersion = "different-deployment"; }
  ]) assert.notEqual(runGate(mutate).status, 0);
});

test("one judge's object or source dissent blocks factual approval despite two taste votes", () => {
  for (const field of ["sourceSupport", "objectMatch"]) {
    const result = runGate((_evaluation, reviews) => { reviews[2].cards[0].review[field] = false; });
    assert.equal(result.status, 1);
    assert.equal(result.report.runs[0].metrics.unresolvedEvidenceCards, 1);
  }
});

test("forged passed flags cannot override actual low quality scores", () => {
  const result = runGate((_evaluation, reviews) => {
    for (const review of reviews) for (const card of review.cards) card.review.aha = 2;
  });
  assert.equal(result.status, 1);
  assert.equal(result.report.runs[0].metrics.consensusInterestingRate, 0);
});

test("a same-path rewritten evaluation cannot reuse old or missing review content hashes", () => {
  for (const hash of [null, "c".repeat(64)]) {
    const result = runGate((_evaluation, reviews) => { reviews[0].evaluationSha256 = hash; });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /provenance mismatch/);
  }
});

test("duplicate reviews and invalid raw score types cannot hide behind maps or truthiness", () => {
  for (const mutate of [
    reviews => { reviews[0].cards.push(reviews[0].cards[0]); },
    reviews => { reviews[0].cards[0].review.sourceSupport = "true"; },
    reviews => { reviews[0].cards[0].review.surprise = 99; },
    reviews => { reviews[0].cards[0].review.aha = "4"; }
  ]) assert.notEqual(runGate((_evaluation, reviews) => mutate(reviews)).status, 0);
});

test("a model or rubric change cannot be called three frozen repeat rounds", () => {
  for (const field of ["model", "reviewPolicySha256"]) {
    const result = runGate((_evaluation, reviews, round) => {
      if (round === 2) reviews[0][field] = field === "model" ? "new-model" : "c".repeat(64);
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /changed between rounds/);
  }
});

test("calibration flags cannot replace or overrule the original control reviews", () => {
  for (const mutate of [
    reviews => { delete reviews[0].calibrationReviews; },
    reviews => { reviews[0].calibrationReviews.dull[0].interestingSuitable = true; },
    reviews => { reviews[0].calibrationReviews.hardIssue[0].hardFactIssue = false; reviews[0].calibrationReviews.hardIssue[0].sourceSupport = true; }
  ]) assert.notEqual(runGate((_evaluation, reviews) => mutate(reviews)).status, 0);
});

test("a full quality report cannot pass without actual daily selection evidence", () => {
  for (const mutate of [
    evaluation => { delete evaluation.dailyGroups; },
    evaluation => { evaluation.dailyGroups.pop(); },
    evaluation => { evaluation.dailyGroups[0].winnerCardId = "card-59"; },
    evaluation => { evaluation.dailyGroups[0].winnerCardId = "card-4"; },
    evaluation => { evaluation.dailyGroups[0].qualifiedCardIds.reverse(); },
    evaluation => { evaluation.dailyGroups[0].photoFileNames.reverse(); },
    evaluation => { evaluation.dailyGroups[0].analyzedPhotoCount = 3; },
    evaluation => { evaluation.dailyGroups[0].index = 1; },
    evaluation => { delete evaluation.dailyGroups[0].selectionMethod; }
  ]) assert.notEqual(runGate(mutate).status, 0);
});

test("valid fallback selections are preserved but cannot prove stable AI selection", () => {
  const result = runGate(evaluation => { evaluation.dailyGroups[0].selectionMethod = "fallback"; });
  assert.equal(result.status, 1);
  assert.equal(result.report.runs[0].metrics.fallbackDailySelections, 1);
});

test("same metadata filename is insufficient without matching actual image and preflight hashes", () => {
  for (const mutate of [
    evaluation => { delete evaluation.photoInputSha256; },
    evaluation => { delete evaluation.preflightSha256; },
    evaluation => { delete evaluation.results[0].sanitizedSha256; },
    evaluation => { evaluation.results[0].sanitizedSha256 = evaluation.results[1].sanitizedSha256; },
    (evaluation, _reviews, round) => { if (round === 2) evaluation.preflightSha256 = "e".repeat(64); },
    (evaluation, _reviews, round) => {
      if (round === 2) {
        evaluation.results[0].sanitizedSha256 = "e".repeat(64);
        evaluation.photoInputSha256 = createHash("sha256").update(JSON.stringify(evaluation.results.map(row => ({fileName:row.fileName,sanitizedSha256:row.sanitizedSha256})))).digest("hex");
      }
    }
  ]) assert.notEqual(runGate(mutate).status, 0);
});
