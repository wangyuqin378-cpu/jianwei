import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { buildCatalogCard, buildReviewedSeedPlan, uniqueByID } from "./lib/catalog-review-provenance.mjs";

const root = path.resolve(import.meta.dirname, "..");
// Synthetic test data only. These texts and scores are not release evidence.
const catalog = {
  version: "test-only",
  sources: [{ sourceId: "source-1", title: "Test source", url: "https://news.berkeley.edu/test-fixture", authority: "professional" }],
  topics: [{ topicId: "test", displayName: "测试物件", synonyms: [], facts: [{
    factId: "test-fact", topicId: "test", cardTitle: "测试标题", cardBody: "有些测试物件具有测试特征。",
    factText: "未核实的知识摘要不能替代原文。", sourceIds: ["source-1"],
    photoApplicability: "visible_feature", photoObjectName: "可见测试特征的物件",
    riskLevel: "general", reviewStatus: "approved", cardQualityStatus: "approved"
  }] }]
};
const snippet = "This is synthetic source text for a unit test, not a real published statement.";
const evidence = { schemaVersion: 1, sources: [{
  sourceId: "source-1", url: catalog.sources[0].url, finalURL: catalog.sources[0].url,
  evidenceKind: "retrieved-source-text", retrievedAt: "2026-09-06T00:00:00.000Z",
  evidenceSnippet: snippet, textSha256: createHash("sha256").update(snippet).digest("hex")
}] };

function buildReport(t, override = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "jianwei-catalog-provenance-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const catalogFile = path.join(directory, "catalog.json");
  const evidenceFile = path.join(directory, "evidence.json");
  const outputFile = path.join(directory, "output.json");
  writeFileSync(catalogFile, JSON.stringify(override.catalog ?? catalog));
  writeFileSync(evidenceFile, JSON.stringify(override.evidence ?? evidence));
  const args = ["scripts/build-catalog-card-quality-report.mjs", "--catalog", catalogFile, "--output", outputFile];
  if (!override.omitEvidence) args.push("--source-evidence", evidenceFile);
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8" });
  return { ...result, outputFile, read: () => JSON.parse(readFileSync(outputFile, "utf8")) };
}

test("report never upgrades a catalog fact summary to source evidence", t => {
  const result = buildReport(t, { omitEvidence: true });
  assert.notEqual(result.status, 0, "missing source text must fail before producing reviewable ready cards");
});

test("report uses the actual supplied source text and binds photo applicability", t => {
  const result = buildReport(t);
  assert.equal(result.status, 0, result.stderr);
  const card = result.read().results[0].card;
  assert.equal(card.sources[0].evidenceSnippet, snippet);
  assert.notEqual(card.sources[0].evidenceSnippet, catalog.topics[0].facts[0].factText);
  assert.equal(card.photoRequirement, "可见测试特征的物件");
  assert.equal(card.catalogFact.photoApplicability, "visible_feature");
  assert.match(card.contentSha256, /^[a-f0-9]{64}$/);
});

test("report rejects source text copied verbatim from the fact", t => {
  const copy = structuredClone(evidence);
  copy.sources[0].evidenceSnippet = catalog.topics[0].facts[0].factText;
  copy.sources[0].textSha256 = createHash("sha256").update(copy.sources[0].evidenceSnippet).digest("hex");
  const result = buildReport(t, { evidence: copy });
  assert.notEqual(result.status, 0);
});

test("report rejects missing, mismatched, or tampered evidence rather than silently dropping sources", t => {
  for (const modify of [
    value => { value.sources = []; },
    value => { value.sources[0].url = "https://news.berkeley.edu/another-fixture"; },
    value => { value.sources[0].evidenceSnippet += " Modified later."; },
    value => { value.sources.push({ ...value.sources[0] }); },
    value => { delete value.sources[0].retrievedAt; }
  ]) {
    const copy = structuredClone(evidence);
    modify(copy);
    const result = buildReport(t, { evidence: copy });
    assert.notEqual(result.status, 0, "invalid evidence must fail");
  }
});

test("requested facts cannot silently disappear from the report", t => {
  const copy = structuredClone(catalog);
  copy.topics[0].facts[0].sourceIds.push("missing-source");
  assert.notEqual(buildReport(t, { catalog: copy }).status, 0);
});

function stableFixture() {
  const card = buildCatalogCard(catalog.topics[0], catalog.topics[0].facts[0],
    uniqueByID(catalog.sources, "sourceId", "sources"), uniqueByID(evidence.sources, "sourceId", "evidence"));
  return { schemaVersion: 3, evidenceKind: "source-bound-three-provider-catalog-stability",
    stableFactIds: [card.factId], cards: [{ factId: card.factId, stable: true,
      reviewedCard: card, contentSha256: card.contentSha256,
      trials: [1, 2, 3].map(round => ({ round, providers: ["gpt", "kimi", "deepseek"], passed: true, hardIssues: 0,
        medians: { surprise: 4, aha: 4, retellability: 4, imageConnection: 4 } })) }] };
}

test("seed plan preserves actual source text and visible feature requirements", () => {
  const [fact] = buildReviewedSeedPlan(catalog, stableFixture());
  assert.equal(fact.sources[0].evidenceSnippet, snippet);
  assert.equal(fact.photoRequirement, catalog.topics[0].facts[0].photoObjectName);
  assert.equal(fact.scores.imageConnection, 4);
});

test("unchanged IDs cannot reuse reviews after copy, evidence, or photo requirement edits", () => {
  for (const modify of [
    value => { value.topics[0].facts[0].cardTitle += "变动"; },
    value => { value.topics[0].facts[0].cardBody += "变动"; },
    value => { value.topics[0].facts[0].factText += "变动"; },
    value => { value.topics[0].facts[0].photoObjectName += "变动"; },
    value => { value.topics[0].facts[0].photoApplicability = "object_class"; },
    value => { value.sources[0].url += "-new"; },
    value => { value.sources[0].authority = "official"; }
  ]) {
    const copy = structuredClone(catalog);
    modify(copy);
    assert.throws(() => buildReviewedSeedPlan(copy, stableFixture()));
  }
});

test("legacy summaries, missing scores, hard issues and repeated reviewers never default to approval", () => {
  for (const modify of [
    value => { value.schemaVersion = 1; },
    value => { value.cards[0].trials = []; },
    value => { delete value.cards[0].trials[0].medians.aha; },
    value => { value.cards[0].trials[0].medians.imageConnection = "4"; },
    value => { value.cards[0].trials[0].hardIssues = 1; },
    value => { value.cards[0].trials[0].providers = ["gpt", "gpt", "kimi"]; },
    value => { value.cards[0].trials[0].round = 2; },
    value => { value.cards[0].reviewedCard.sources[0].evidenceSnippet += "tamper"; }
  ]) {
    const copy = stableFixture();
    modify(copy);
    assert.throws(() => buildReviewedSeedPlan(catalog, copy));
  }
});

function runStability(t, mutate = () => {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "jianwei-stability-provenance-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const card = stableFixture().cards[0].reviewedCard;
  const evaluation = { schemaVersion: 2, evidenceKind: "source-bound-catalog-review-candidates",
    results: [{ status: "ready", expectedDisplayName: card.objectName, card }] };
  const evaluationFile = path.join(directory, "evaluation.json");
  const evaluationBytes = JSON.stringify(evaluation);
  const hash = createHash("sha256").update(evaluationBytes).digest("hex");
  const reviews = ["gpt", "kimi", "deepseek"].flatMap(provider => [1, 2, 3].map(round => ({
    schemaVersion: 2, provider, round, model: `${provider}-test-only`, evaluationFile,
    evaluationSha256: hash, reviewPolicySha256: "1".repeat(64), batchSize: 1,
    summary: { calibrationPassed: true },
    calibration: { dullControlPassed: true, hardIssueControlPassed: true },
    calibrationReviews: {
      dull: [{ cardId: "control-4f9a", interestingSuitable: false, surprise: 1 }],
      hardIssue: [{ cardId: "control-c2d7", hardFactIssue: true, sourceSupport: false }]
    },
    cards: [{ cardId: card.cardId, title: card.title, body: card.body,
      photoObjectExpected: card.objectName, detectedObjectName: card.objectName, photoRequirement: card.photoRequirement,
      sources: card.sources.map(({ title, url, authority, evidenceSnippet, evidenceKind }) =>
        ({ title, url, authority, evidenceSnippet, evidenceKind })),
      passed: true, review: { cardId: card.cardId, hardFactIssue: false, sourceSupport: true, objectMatch: true,
        interestingSuitable: true, surprise: 4, aha: 4, retellability: 4, imageConnection: 4, naturalness: 4 } }]
  })));
  mutate({ evaluation, reviews });
  writeFileSync(evaluationFile, JSON.stringify(evaluation));
  const files = reviews.map((review, index) => {
    const file = path.join(directory, `review-${index}.json`);
    writeFileSync(file, JSON.stringify(review));
    return file;
  });
  const baseFile = path.join(directory, "base.json");
  writeFileSync(baseFile, JSON.stringify({ schemaVersion: 3, evidenceKind: "source-bound-three-provider-catalog-stability", stableFactIds: [], cards: [], inputs: [] }));
  const outputFile = path.join(directory, "stability.json");
  const result = spawnSync(process.execPath, ["scripts/check-three-model-catalog-stability.mjs", "--base", baseFile,
    "--set", [evaluationFile, ...files].join(","), "--output", outputFile], { cwd: root, encoding: "utf8" });
  return { ...result, directory, outputFile, read: () => JSON.parse(readFileSync(outputFile, "utf8")) };
}

test("three-model catalog gate binds review bytes, not just an evaluation path and card ID", t => {
  for (const mutate of [
    ({ evaluation }) => { evaluation.results[0].card.title += "未评审修改"; },
    ({ reviews }) => { delete reviews[0].evaluationSha256; },
    ({ reviews }) => { reviews[0].cards[0].body += "另一版本"; },
    ({ reviews }) => { reviews[0].cards[0].sources[0].evidenceSnippet += "另一来源"; },
    ({ reviews }) => { reviews[0].cards.push(reviews[0].cards[0]); }
  ]) assert.notEqual(runStability(t, mutate).status, 0);
});

test("catalog gate does not accept fabricated calibration summaries or changed judge policies", t => {
  for (const mutate of [
    ({ reviews }) => { reviews[0].calibrationReviews.dull[0].surprise = 5; },
    ({ reviews }) => { reviews[0].calibrationReviews.hardIssue = []; },
    ({ reviews }) => { reviews[0].cards[0].review.sourceSupport = false; },
    ({ reviews }) => { reviews[0].reviewPolicySha256 = "2".repeat(64); },
    ({ reviews }) => { reviews[0].cards[0].review.aha = "4"; }
  ]) assert.notEqual(runStability(t, mutate).status, 0);
});

test("a real negative verdict is retained and zero promotions return failure", t => {
  const result = runStability(t, ({ reviews }) => {
    reviews[0].cards[0].review.hardFactIssue = true;
    reviews[0].cards[0].passed = false;
  });
  assert.equal(result.status, 1, result.stderr);
  assert.deepEqual(result.read().stableFactIds, []);
  assert.deepEqual(result.read().rejectedFactIds, ["test-fact"]);
  assert.match(result.stdout, /STABILITY=FAIL/);
});

test("the historical role-review report shape cannot seed a current catalog", t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "jianwei-legacy-seed-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const catalogFile = path.join(directory, "catalog.json");
  const stabilityFile = path.join(directory, "legacy.json");
  writeFileSync(catalogFile, JSON.stringify(catalog));
  writeFileSync(stabilityFile, JSON.stringify({ schemaVersion: 1, stableFactIds: ["test-fact"], cards: [{ factId: "test-fact", stable: true }] }));
  const seed = spawnSync(process.execPath, ["cloudflare/gateway/scripts/seed-reviewed-facts.mjs",
    "--catalog", catalogFile, "--stability", stabilityFile], { cwd: root, encoding: "utf8" });
  assert.notEqual(seed.status, 0);
  assert.match(seed.stderr, /Legacy or unbound stability/);
});

test("three-model gate and default seeder support a fully bound synthetic positive path without remote writes", t => {
  const result = runStability(t);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.read().schemaVersion, 3);
  const catalogFile = path.join(result.directory, "catalog.json");
  writeFileSync(catalogFile, JSON.stringify(catalog));
  const seed = spawnSync(process.execPath, ["cloudflare/gateway/scripts/seed-reviewed-facts.mjs",
    "--catalog", catalogFile, "--stability", result.outputFile], { cwd: root, encoding: "utf8" });
  assert.equal(seed.status, 0, seed.stderr);
  assert.match(seed.stdout, /CHECK_ONLY.*remoteWrites=0/);
  // Mutating a review artifact after aggregation must invalidate the seed.
  writeFileSync(path.join(result.directory, "review-0.json"), "{}");
  const tampered = spawnSync(process.execPath, ["cloudflare/gateway/scripts/seed-reviewed-facts.mjs",
    "--catalog", catalogFile, "--stability", result.outputFile], { cwd: root, encoding: "utf8" });
  assert.notEqual(tampered.status, 0);
});
