import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { factReviewDigest, parseFlagArgs, requiredString, sha256Text } from "./lib/fact-review.mjs";

if (process.argv.includes("--self-test")) {
  const catalog = fixtureCatalog();
  const catalogText = `${JSON.stringify(catalog, null, 2)}\n`;
  const template = createRejectedFactReplacementTemplate(catalogText, {
    factIds: ["rejected-one"],
    batchId: "fixture-replacement-template"
  });
  if (template.replacements.length !== 1 || template.replacements[0].replacementFact.reviewStatus !== "draft" ||
      template.replacements[0].replacementFact.factText !== "" ||
      template.replacements[0].origin !== "REPLACE_WITH_ORIGIN") {
    throw new Error("Rejected replacement template self-test prefilled publishable replacement data");
  }
  if (template.replacements[0].sources.length !== 1 || template.nextCatalogVersion !== "REPLACE_WITH_NEW_VERSION") {
    throw new Error("Rejected replacement template self-test lost source context or fail-closed version placeholder");
  }
  expectFailure(() => createRejectedFactReplacementTemplate(catalogText, {
    factIds: ["approved-one"],
    batchId: "fixture-approved-target"
  }), "approved target");
  expectFailure(() => createRejectedFactReplacementTemplate(catalogText, {
    factIds: ["rejected-one", "rejected-one"],
    batchId: "fixture-duplicate-target"
  }), "duplicate target");
  process.stdout.write("REJECTED_FACT_REPLACEMENT_TEMPLATE_SELF_TEST=GO synthetic=1 productionApproved=0 placeholders=1 sourceContext=1 approvedTargetRejected=1 duplicateTargetRejected=1\n");
  process.exit(0);
}

const args = parseFlagArgs(process.argv.slice(2));
const catalogPath = path.resolve(process.cwd(), String(args.get("--catalog") ?? "knowledge/catalog.json"));
const catalogText = await readFile(catalogPath, "utf8");
const factIds = requiredString(args, "--facts").split(",").map((value) => value.trim()).filter(Boolean);
const template = createRejectedFactReplacementTemplate(catalogText, {
  factIds,
  batchId: requiredString(args, "--batch-id")
});

if (!args.has("--write")) {
  process.stdout.write(summary("PREVIEW", template, 0));
  process.exit(0);
}

const outputPath = path.resolve(process.cwd(), requiredString(args, "--output"));
const replacementsRoot = path.resolve(process.cwd(), "knowledge", "replacements");
assertWithin(replacementsRoot, outputPath, "Replacement template output must stay inside knowledge/replacements");
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(template, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
process.stdout.write(summary("GO", template, 1));

export function createRejectedFactReplacementTemplate(catalogText, { factIds, batchId }) {
  if (!validToken(batchId)) throw new Error("Replacement batch ID is invalid");
  if (!Array.isArray(factIds) || factIds.length < 1 || factIds.length > 20 ||
      factIds.some((factId) => !validId(factId)) || new Set(factIds).size !== factIds.length) {
    throw new Error("Replacement template requires 1-20 unique rejected fact IDs");
  }
  const catalog = JSON.parse(catalogText);
  if (!validToken(catalog.version) || !Array.isArray(catalog.topics) || !Array.isArray(catalog.sources)) {
    throw new Error("Catalog is invalid for replacement template generation");
  }
  const sourceById = new Map(catalog.sources.map((source) => [source.sourceId, source]));
  const factById = new Map();
  for (const topic of catalog.topics) {
    if (!topic?.topicId || !Array.isArray(topic.facts)) throw new Error("Catalog topics are invalid");
    for (const fact of topic.facts) {
      if (!fact?.factId || factById.has(fact.factId)) throw new Error("Catalog fact IDs must be present and unique");
      factById.set(fact.factId, { topic, fact });
    }
  }
  const replacements = factIds.map((factId) => {
    const current = factById.get(factId);
    if (!current || current.fact.reviewStatus !== "rejected" || !current.fact.review) {
      throw new Error(`Replacement template target must be a human-attested rejected fact: ${factId}`);
    }
    const sources = current.fact.sourceIds.map((sourceId) => sourceById.get(sourceId));
    if (sources.some((source) => !source)) throw new Error(`Rejected fact has a missing source: ${factId}`);
    return {
      rejectedFactId: factId,
      rejectedFactSha256: factReviewDigest(current.topic.topicId, current.fact),
      origin: "REPLACE_WITH_ORIGIN",
      replacementFact: {
        factId: `replace-${factId}`,
        topicId: current.topic.topicId,
        factText: "",
        sourceIds: [...current.fact.sourceIds],
        riskLevel: current.fact.riskLevel,
        reviewStatus: "draft"
      },
      sources: sources.map((source) => ({ ...source }))
    };
  });
  return {
    schemaVersion: 1,
    evidenceKind: "rejected_fact_replacement_batch",
    batchId,
    catalogVersion: catalog.version,
    catalogSha256: sha256Text(catalogText),
    nextCatalogVersion: "REPLACE_WITH_NEW_VERSION",
    replacements
  };
}

function summary(status, template, wrote) {
  return `REJECTED_FACT_REPLACEMENT_TEMPLATE=${status} catalog=${template.catalogVersion} replacements=${template.replacements.length} placeholders=1 productionApproved=0 wrote=${wrote}\n`;
}

function validToken(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/.test(value);
}

function validId(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9_-]{1,127}$/.test(value);
}

function assertWithin(parent, target, message) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(message);
}

function expectFailure(operation, label) {
  try {
    operation();
  } catch {
    return;
  }
  throw new Error(`Expected fail-closed rejection: ${label}`);
}

function fixtureCatalog() {
  return {
    version: "fixture-beta.1",
    sources: [{ sourceId: "source-one", title: "Source", url: "https://example.org/source", publisher: "Source", authority: "official" }],
    topics: [{
      topicId: "fixture",
      facts: [
        {
          factId: "approved-one",
          topicId: "fixture",
          factText: "这是一条已经通过人工审核且不能进入拒绝替换模板的事实内容。",
          sourceIds: ["source-one"],
          riskLevel: "general",
          reviewStatus: "approved",
          review: { reviewerId: "human-one", reviewedAt: "2026-01-02T00:00:00.000Z", sourceCheckedAt: "2026-01-02T00:00:00.000Z" }
        },
        {
          factId: "rejected-one",
          topicId: "fixture",
          factText: "这是一条已经被人工拒绝并需要生成受控替换模板的事实内容。",
          sourceIds: ["source-one"],
          riskLevel: "general",
          reviewStatus: "rejected",
          review: { reviewerId: "human-one", reviewedAt: "2026-01-02T00:00:00.000Z", sourceCheckedAt: "2026-01-02T00:00:00.000Z", notes: "来源不支持事实表述" }
        }
      ]
    }]
  };
}
