import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { factReviewDigest, parseFlagArgs, requiredString, sha256Text } from "./lib/fact-review.mjs";
import { applyReviewBatch } from "./lib/review-batch.mjs";

if (process.argv.includes("--self-test")) {
  const catalog = fixtureCatalog();
  const catalogText = `${JSON.stringify(catalog, null, 2)}\n`;
  const batch = fixtureBatch(catalog, catalogText);
  expectFailure(() => applyReviewBatch({ catalogText, batch, reviewerId: "qwen-reviewer" }));
  expectFailure(() => applyReviewBatch({ catalogText, batch: { ...batch, catalogSha256: "0".repeat(64) }, reviewerId: "human-1" }));
  expectFailure(() => applyReviewBatch({ catalogText, batch: { ...batch, nextCatalogVersion: "REPLACE_WITH_NEW_VERSION" }, reviewerId: "human-1" }));
  expectFailure(() => applyReviewBatch({
    catalogText,
    batch: { ...batch, decisions: [{ ...batch.decisions[0], semanticSupportConfirmed: false }, batch.decisions[1]] },
    reviewerId: "human-1"
  }));
  const applied = applyReviewBatch({ catalogText, batch, reviewerId: "human-1", now: new Date("2026-01-02T00:00:00.000Z") });
  const facts = applied.catalog.topics[0].facts;
  if (catalog.version !== "fixture-1" || catalog.topics[0].facts.some((fact) => fact.review)) {
    throw new Error("Review batch self-test mutated its input catalog");
  }
  if (applied.catalog.version !== "fixture-2" || facts[0].reviewStatus !== "approved" || facts[1].reviewStatus !== "rejected") {
    throw new Error("Review batch self-test did not apply approval and rejection atomically");
  }
  if (facts.some((fact) => fact.review?.reviewerId !== "human-1") || applied.metrics.approved !== 1 || applied.metrics.rejected !== 1) {
    throw new Error("Review batch self-test did not bind the accountable reviewer");
  }
  process.stdout.write("KNOWLEDGE_REVIEW_BATCH_SELF_TEST=GO synthetic=1 releaseEvidence=0 staleSnapshotRejected=1 placeholderVersionRejected=1 automatedReviewerRejected=1 incompleteApprovalRejected=1 atomicDecisions=2\n");
  process.exit(0);
}

const args = parseFlagArgs(process.argv.slice(2));
if (!args.has("--confirm-human-review")) throw new Error("--confirm-human-review is required");
if (!args.has("--write")) throw new Error("--write is required; this command never records decisions implicitly");
const reviewerId = requiredString(args, "--reviewer");
const manifestPath = path.resolve(process.cwd(), requiredString(args, "--manifest"));
const catalogPath = path.resolve(process.cwd(), String(args.get("--catalog") ?? "knowledge/catalog.json"));
const catalogText = await readFile(catalogPath, "utf8");
const batch = JSON.parse(await readFile(manifestPath, "utf8"));
const result = applyReviewBatch({
  catalogText,
  batch,
  reviewerId,
  confirmRereview: args.has("--confirm-rereview")
});

const temporaryPath = `${catalogPath}.${process.pid}.tmp`;
try {
  await writeFile(temporaryPath, result.catalogText, { encoding: "utf8", flag: "wx" });
  await rename(temporaryPath, catalogPath);
} finally {
  await rm(temporaryPath, { force: true });
}
process.stdout.write(`KNOWLEDGE_REVIEW_BATCH=GO from=${batch.catalogVersion} to=${batch.nextCatalogVersion} decisions=${result.metrics.decisions} approved=${result.metrics.approved} rejected=${result.metrics.rejected} sha256=${sha256Text(result.catalogText)} humanReview=1\n`);

function expectFailure(operation) {
  let failed = false;
  try {
    operation();
  } catch {
    failed = true;
  }
  if (!failed) throw new Error("Review batch self-test expected a fail-closed rejection");
}

function fixtureCatalog() {
  return {
    version: "fixture-1",
    sources: [
      { sourceId: "official-a", title: "A", url: "https://example.org/a", publisher: "A", authority: "official" },
      { sourceId: "official-b", title: "B", url: "https://example.org/b", publisher: "B", authority: "professional" }
    ],
    topics: [{
      topicId: "fixture",
      displayName: "Fixture",
      synonyms: ["fixture"],
      category: "home",
      facts: [
        { factId: "approve-me", topicId: "fixture", factText: "这是一条长度满足卡片要求且由审核人逐项核对来源支持范围的一般知识事实文本。", sourceIds: ["official-a"], riskLevel: "general", reviewStatus: "draft" },
        { factId: "reject-me", topicId: "fixture", factText: "这是一条需要真人拒绝并记录充分原因的待审核一般知识事实文本。", sourceIds: ["official-b"], riskLevel: "general", reviewStatus: "draft" }
      ]
    }]
  };
}

function fixtureBatch(catalog, catalogText) {
  const [approve, reject] = catalog.topics[0].facts;
  return {
    schemaVersion: 1,
    evidenceKind: "human_semantic_review_decision_batch",
    catalogVersion: "fixture-1",
    catalogSha256: sha256Text(catalogText),
    nextCatalogVersion: "fixture-2",
    createdFromQueueAt: "2026-01-01T00:00:00.000Z",
    decisions: [
      {
        factId: approve.factId,
        factSha256: factReviewDigest("fixture", approve),
        decision: "approve",
        checkedSourceIds: ["official-a"],
        semanticSupportConfirmed: true,
        unsupportedClaimsChecked: true,
        notes: "来源与表述已逐项核对"
      },
      {
        factId: reject.factId,
        factSha256: factReviewDigest("fixture", reject),
        decision: "reject",
        checkedSourceIds: ["official-b"],
        semanticSupportConfirmed: false,
        unsupportedClaimsChecked: true,
        notes: "来源无法充分支持当前表述范围"
      }
    ]
  };
}
