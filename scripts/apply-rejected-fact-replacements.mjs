import { readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  assertExactKeys,
  factReviewDigest,
  isPublicHttpsUrl,
  parseFlagArgs,
  requiredString,
  sha256Text
} from "./lib/fact-review.mjs";

const MANIFEST_KIND = "rejected_fact_replacement_batch";
const MANIFEST_KEYS = [
  "schemaVersion",
  "evidenceKind",
  "batchId",
  "catalogVersion",
  "catalogSha256",
  "nextCatalogVersion",
  "replacements"
];
const REPLACEMENT_KEYS = [
  "rejectedFactId",
  "rejectedFactSha256",
  "origin",
  "replacementFact",
  "sources"
];
const FACT_KEYS = ["factId", "topicId", "factText", "sourceIds", "riskLevel", "reviewStatus"];
const SOURCE_KEYS = ["sourceId", "title", "url", "publisher", "authority"];

if (process.argv.includes("--self-test")) {
  const catalog = fixtureCatalog();
  const catalogText = `${JSON.stringify(catalog, null, 2)}\n`;
  const manifest = fixtureManifest(catalog, catalogText);
  const result = applyRejectedFactReplacements({ catalogText, manifest });
  const facts = result.catalog.topics[0].facts;
  if (facts.some((fact) => fact.factId === "rejected-old") || !facts.some((fact) => fact.factId === "replacement-new")) {
    throw new Error("Replacement self-test did not exchange the rejected fact");
  }
  const replacement = facts.find((fact) => fact.factId === "replacement-new");
  if (replacement.reviewStatus !== "draft" || replacement.review !== undefined || result.metrics.productionApproved !== 0) {
    throw new Error("Replacement self-test granted release authority");
  }
  if (!facts.some((fact) => fact.factId === "approved-stays") || result.catalog.sources.some((source) => source.sourceId === "orphan-old")) {
    throw new Error("Replacement self-test changed an approved fact or retained an orphan source");
  }
  expectFailure(() => applyRejectedFactReplacements({
    catalogText,
    manifest: { ...manifest, catalogSha256: "0".repeat(64) }
  }), "stale catalog");
  const approvedTarget = structuredClone(manifest);
  approvedTarget.replacements[0].rejectedFactId = "approved-stays";
  approvedTarget.replacements[0].rejectedFactSha256 = factReviewDigest("fixture", catalog.topics[0].facts[0]);
  expectFailure(() => applyRejectedFactReplacements({ catalogText, manifest: approvedTarget }), "approved target");
  const forgedApproval = structuredClone(manifest);
  forgedApproval.replacements[0].replacementFact.reviewStatus = "approved";
  expectFailure(() => applyRejectedFactReplacements({ catalogText, manifest: forgedApproval }), "forged approval");
  const weakRiskSource = structuredClone(manifest);
  weakRiskSource.replacements[0].replacementFact.riskLevel = "safety";
  expectFailure(() => applyRejectedFactReplacements({ catalogText, manifest: weakRiskSource }), "risky source policy");
  const collision = structuredClone(manifest);
  collision.replacements[0].replacementFact.factId = "approved-stays";
  expectFailure(() => applyRejectedFactReplacements({ catalogText, manifest: collision }), "fact ID collision");
  process.stdout.write("REJECTED_FACT_REPLACEMENT_SELF_TEST=GO synthetic=1 productionApproved=0 replacements=1 staleSnapshotRejected=1 approvedTargetRejected=1 forgedApprovalRejected=1 riskySourceRejected=1 collisionRejected=1 orphanCleanup=1\n");
  process.exit(0);
}

const args = parseFlagArgs(process.argv.slice(2));
const manifestPath = path.resolve(process.cwd(), requiredString(args, "--manifest"));
const replacementsRoot = await realpath(path.resolve(process.cwd(), "knowledge", "replacements"));
const resolvedManifest = await realpath(manifestPath);
assertWithin(replacementsRoot, resolvedManifest, "Replacement manifest must stay inside knowledge/replacements");
if (path.extname(resolvedManifest).toLowerCase() !== ".json") throw new Error("Replacement manifest must be JSON");

const catalogPath = path.resolve(process.cwd(), String(args.get("--catalog") ?? "knowledge/catalog.json"));
const catalogText = await readFile(catalogPath, "utf8");
const manifest = JSON.parse(await readFile(resolvedManifest, "utf8"));
const result = applyRejectedFactReplacements({ catalogText, manifest });

if (!args.has("--write")) {
  process.stdout.write(summary("PREVIEW", result, 0));
  process.exit(0);
}

const temporaryPath = `${catalogPath}.${process.pid}.tmp`;
try {
  await writeFile(temporaryPath, result.catalogText, { encoding: "utf8", flag: "wx" });
  await rename(temporaryPath, catalogPath);
} finally {
  await rm(temporaryPath, { force: true });
}
process.stdout.write(summary("GO", result, 1));

export function applyRejectedFactReplacements({ catalogText, manifest }) {
  assertExactKeys(manifest, MANIFEST_KEYS, "rejected-fact replacement manifest");
  if (manifest.schemaVersion !== 1 || manifest.evidenceKind !== MANIFEST_KIND) {
    throw new Error("Replacement manifest schema or evidence kind is invalid");
  }
  if (!validToken(manifest.batchId) || !validToken(manifest.catalogVersion) || !validToken(manifest.nextCatalogVersion) ||
      manifest.catalogVersion === manifest.nextCatalogVersion) {
    throw new Error("Replacement manifest identifiers or versions are invalid");
  }
  if (!/^[a-f0-9]{64}$/.test(manifest.catalogSha256) || sha256Text(catalogText) !== manifest.catalogSha256) {
    throw new Error("Replacement manifest catalog SHA-256 is stale or invalid");
  }
  const catalog = JSON.parse(catalogText);
  if (catalog.version !== manifest.catalogVersion || !Array.isArray(catalog.topics) || !Array.isArray(catalog.sources)) {
    throw new Error("Replacement manifest catalog version or structure is stale");
  }
  if (!Array.isArray(manifest.replacements) || manifest.replacements.length < 1 || manifest.replacements.length > 20) {
    throw new Error("Replacement manifest must contain 1-20 replacements");
  }

  const output = structuredClone(catalog);
  const sourceById = new Map();
  for (const source of output.sources) {
    if (!source?.sourceId || sourceById.has(source.sourceId)) throw new Error("Catalog source IDs must be present and unique");
    sourceById.set(source.sourceId, source);
  }
  const factById = new Map();
  for (const topic of output.topics) {
    if (!topic?.topicId || !Array.isArray(topic.facts)) throw new Error("Catalog topics are invalid");
    for (const fact of topic.facts) {
      if (!fact?.factId || factById.has(fact.factId)) throw new Error("Catalog fact IDs must be present and unique");
      factById.set(fact.factId, { topic, fact });
    }
  }

  const targeted = new Set();
  const replacementIds = new Set();
  const prepared = [];
  for (const item of manifest.replacements) {
    assertExactKeys(item, REPLACEMENT_KEYS, "rejected-fact replacement");
    if (!validId(item.rejectedFactId) || targeted.has(item.rejectedFactId)) {
      throw new Error("Rejected fact IDs must be present and unique");
    }
    targeted.add(item.rejectedFactId);
    const current = factById.get(item.rejectedFactId);
    if (!current || current.fact.reviewStatus !== "rejected" || !current.fact.review) {
      throw new Error(`Replacement target must be a human-attested rejected fact: ${item.rejectedFactId}`);
    }
    if (item.rejectedFactSha256 !== factReviewDigest(current.topic.topicId, current.fact)) {
      throw new Error(`Rejected fact digest is stale: ${item.rejectedFactId}`);
    }
    if (item.origin !== "human_research" && item.origin !== "ai_assisted_draft") {
      throw new Error(`Replacement origin is invalid: ${item.rejectedFactId}`);
    }

    const fact = item.replacementFact;
    assertExactKeys(fact, FACT_KEYS, "replacement fact");
    if (!validId(fact.factId) || fact.factId === item.rejectedFactId || replacementIds.has(fact.factId) ||
        factById.has(fact.factId)) {
      throw new Error(`Replacement fact ID collides or is invalid: ${fact.factId ?? "<missing>"}`);
    }
    replacementIds.add(fact.factId);
    if (fact.topicId !== current.topic.topicId || fact.reviewStatus !== "draft") {
      throw new Error(`Replacement fact must stay in the same topic as a draft: ${fact.factId}`);
    }
    const bodyLength = typeof fact.factText === "string" ? [...fact.factText.trim()].length : 0;
    if (bodyLength < 28 || bodyLength > 80) throw new Error(`Replacement fact must be a 28-80 character card body: ${fact.factId}`);
    if (!Array.isArray(fact.sourceIds) || fact.sourceIds.length < 1 || new Set(fact.sourceIds).size !== fact.sourceIds.length) {
      throw new Error(`Replacement fact sources are invalid: ${fact.factId}`);
    }
    if (!["general", "health", "safety"].includes(fact.riskLevel)) throw new Error(`Replacement risk level is invalid: ${fact.factId}`);
    if (!Array.isArray(item.sources) || item.sources.length !== fact.sourceIds.length) {
      throw new Error(`Replacement must carry every referenced source exactly once: ${fact.factId}`);
    }
    const suppliedSources = new Map();
    for (const source of item.sources) {
      assertExactKeys(source, SOURCE_KEYS, "replacement source");
      if (!validId(source.sourceId) || suppliedSources.has(source.sourceId) || !nonEmpty(source.title) ||
          !nonEmpty(source.publisher) || !isPublicHttpsUrl(source.url) ||
          !["reference", "official", "professional"].includes(source.authority)) {
        throw new Error(`Replacement source is invalid: ${source.sourceId ?? "<missing>"}`);
      }
      suppliedSources.set(source.sourceId, normalizedSource(source));
    }
    if (fact.sourceIds.some((sourceId) => !suppliedSources.has(sourceId)) ||
        [...suppliedSources].some(([sourceId]) => !fact.sourceIds.includes(sourceId))) {
      throw new Error(`Replacement source set does not match the fact: ${fact.factId}`);
    }
    for (const [sourceId, source] of suppliedSources) {
      const existing = sourceById.get(sourceId);
      if (existing && JSON.stringify(existing) !== JSON.stringify(source)) {
        throw new Error(`Replacement source conflicts with the catalog: ${sourceId}`);
      }
    }
    if (fact.riskLevel !== "general") {
      const authoritative = new Set([...suppliedSources.values()]
        .filter((source) => source.authority === "official" || source.authority === "professional")
        .map((source) => source.sourceId));
      if (authoritative.size < 2) throw new Error(`Risky replacement requires two authoritative sources: ${fact.factId}`);
    }
    prepared.push({ current, fact: normalizedFact(fact), suppliedSources });
  }

  for (const { current, fact, suppliedSources } of prepared) {
    const index = current.topic.facts.findIndex((candidate) => candidate.factId === current.fact.factId);
    if (index < 0) throw new Error(`Replacement target disappeared: ${current.fact.factId}`);
    current.topic.facts[index] = fact;
    for (const [sourceId, source] of suppliedSources) {
      if (!sourceById.has(sourceId)) {
        output.sources.push(source);
        sourceById.set(sourceId, source);
      }
    }
  }

  const referenced = new Set(output.topics.flatMap((topic) => topic.facts.flatMap((fact) => fact.sourceIds)));
  output.sources = output.sources.filter((source) => referenced.has(source.sourceId));
  const missing = [...referenced].filter((sourceId) => !output.sources.some((source) => source.sourceId === sourceId));
  if (missing.length > 0) throw new Error(`Replacement leaves missing sources: ${missing.join(", ")}`);
  output.version = manifest.nextCatalogVersion;
  const catalogTextOutput = `${JSON.stringify(output, null, 2)}\n`;
  return {
    catalog: output,
    catalogText: catalogTextOutput,
    metrics: {
      replacements: prepared.length,
      productionApproved: 0,
      sha256: sha256Text(catalogTextOutput),
      from: manifest.catalogVersion,
      to: manifest.nextCatalogVersion
    }
  };
}

function summary(status, result, wrote) {
  const metrics = result.metrics;
  return `REJECTED_FACT_REPLACEMENT=${status} from=${metrics.from} to=${metrics.to} replacements=${metrics.replacements} sha256=${metrics.sha256} productionApproved=0 wrote=${wrote}\n`;
}

function normalizedFact(fact) {
  return {
    factId: fact.factId,
    topicId: fact.topicId,
    factText: fact.factText.trim(),
    sourceIds: [...fact.sourceIds],
    riskLevel: fact.riskLevel,
    reviewStatus: "draft"
  };
}

function normalizedSource(source) {
  return {
    sourceId: source.sourceId,
    title: source.title.trim(),
    url: source.url,
    publisher: source.publisher.trim(),
    authority: source.authority
  };
}

function validToken(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/.test(value);
}

function validId(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9_-]{1,127}$/.test(value);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
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
    sources: [
      { sourceId: "official-stays", title: "Official", url: "https://example.org/official", publisher: "Official", authority: "official" },
      { sourceId: "orphan-old", title: "Old", url: "https://example.org/old", publisher: "Old", authority: "reference" }
    ],
    topics: [{
      topicId: "fixture",
      displayName: "Fixture",
      synonyms: ["fixture", "测试物件"],
      category: "home",
      facts: [
        {
          factId: "approved-stays",
          topicId: "fixture",
          factText: "这是一条已审核事实，替换被拒事实时必须保持原样且不能被覆盖或降级。",
          sourceIds: ["official-stays"],
          riskLevel: "general",
          reviewStatus: "approved",
          review: { reviewerId: "human-one", reviewedAt: "2026-01-02T00:00:00.000Z", sourceCheckedAt: "2026-01-02T00:00:00.000Z" }
        },
        {
          factId: "rejected-old",
          topicId: "fixture",
          factText: "这是一条已经由真人核验后拒绝、必须通过受控替换流程退出目录的事实。",
          sourceIds: ["orphan-old"],
          riskLevel: "general",
          reviewStatus: "rejected",
          review: { reviewerId: "human-one", reviewedAt: "2026-01-02T00:00:00.000Z", sourceCheckedAt: "2026-01-02T00:00:00.000Z", notes: "来源无法支持当前表述范围" }
        }
      ]
    }]
  };
}

function fixtureManifest(catalog, catalogText) {
  const rejected = catalog.topics[0].facts[1];
  return {
    schemaVersion: 1,
    evidenceKind: MANIFEST_KIND,
    batchId: "fixture-replacement-1",
    catalogVersion: catalog.version,
    catalogSha256: sha256Text(catalogText),
    nextCatalogVersion: "fixture-beta.2",
    replacements: [{
      rejectedFactId: rejected.factId,
      rejectedFactSha256: factReviewDigest("fixture", rejected),
      origin: "human_research",
      replacementFact: {
        factId: "replacement-new",
        topicId: "fixture",
        factText: "这是一条替换被拒内容的新草稿，仍需真人逐项核验来源后才能进入发布目录。",
        sourceIds: ["replacement-source"],
        riskLevel: "general",
        reviewStatus: "draft"
      },
      sources: [{
        sourceId: "replacement-source",
        title: "Replacement",
        url: "https://example.org/replacement",
        publisher: "Replacement",
        authority: "reference"
      }]
    }]
  };
}
