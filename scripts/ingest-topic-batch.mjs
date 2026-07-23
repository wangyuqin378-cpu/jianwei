import { createHash } from "node:crypto";
import { readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { loadTopicBacklog, mergeTopicDraft, projectRoot, validateTopicDraft } from "./lib/topic-draft.mjs";

const { backlogById } = await loadTopicBacklog();

if (process.argv.includes("--self-test")) {
  const topics = [...backlogById.values()].slice(0, 2);
  if (topics.length !== 2) throw new Error("Batch self-test requires two controlled topics");
  const first = fixtureDraft(topics[0], 1);
  const second = fixtureDraft(topics[1], 2);
  const catalog = { version: "fixture-beta.1", sources: [], topics: [] };
  const manifest = {
    schemaVersion: 1,
    batchId: "fixture-batch",
    baseCatalogVersion: "fixture-beta.1",
    nextCatalogVersion: "fixture-beta.2",
    drafts: ["knowledge/drafts/first.json", "knowledge/drafts/second.json"]
  };
  validateBatchManifest(manifest, catalog);
  const imported = mergeValidatedBatch(catalog, [first, second]);
  imported.version = manifest.nextCatalogVersion;
  if (imported.topics.length !== 2 || imported.topics.some((topic) => topic.facts.length !== 3)) {
    throw new Error("Batch self-test did not import both complete topics");
  }
  if (imported.topics.flatMap((topic) => topic.facts).some((fact) => fact.reviewStatus !== "draft" || fact.review !== undefined)) {
    throw new Error("Batch self-test unexpectedly granted release authority");
  }
  const extension = fixtureDraft(topics[0], 3);
  extension.intakeMode = "extend";
  extension.facts = extension.facts.slice(0, 2);
  validateTopicDraft(extension, backlogById);
  const oneFactCatalog = {
    version: "fixture-beta.1",
    sources: [{ sourceId: "existing-source", title: "Existing", url: "https://example.org/existing", publisher: "Fixture", authority: "reference" }],
    topics: [{
      topicId: topics[0].topicId,
      displayName: topics[0].displayName,
      synonyms: [topics[0].displayName, topics[0].topicId],
      category: topics[0].category,
      facts: [{
        factId: `${topics[0].topicId}-existing`,
        topicId: topics[0].topicId,
        factText: "Existing synthetic fact for a minimal two-fact extension; it is never published.",
        sourceIds: ["existing-source"],
        riskLevel: "general",
        reviewStatus: "draft"
      }]
    }]
  };
  const minimallyExtended = mergeValidatedBatch(oneFactCatalog, [extension]);
  if (minimallyExtended.topics[0].facts.length !== 3) throw new Error("Minimal extension did not finish with three facts");
  expectFailure(() => mergeValidatedBatch(catalog, [extension]), "extension cannot create a topic");

  const stale = structuredClone(manifest);
  stale.baseCatalogVersion = "fixture-beta.0";
  expectFailure(() => validateBatchManifest(stale, catalog), "stale catalog version must fail");
  const duplicatePath = structuredClone(manifest);
  duplicatePath.drafts[1] = duplicatePath.drafts[0];
  expectFailure(() => validateBatchManifest(duplicatePath, catalog), "duplicate draft path must fail");
  const sameVersion = structuredClone(manifest);
  sameVersion.nextCatalogVersion = sameVersion.baseCatalogVersion;
  expectFailure(() => validateBatchManifest(sameVersion, catalog), "unchanged catalog version must fail");
  const duplicateTopic = structuredClone(second);
  duplicateTopic.topicId = first.topicId;
  expectFailure(() => mergeValidatedBatch(catalog, [first, duplicateTopic]), "duplicate topic in one batch must fail");
  const conflicting = structuredClone(second);
  conflicting.facts[0].factId = first.facts[0].factId;
  expectFailure(() => mergeValidatedBatch(catalog, [first, conflicting]), "cross-draft fact conflict must fail atomically");
  if (catalog.sources.length !== 0 || catalog.topics.length !== 0 || catalog.version !== "fixture-beta.1") {
    throw new Error("Failed batch mutated its input catalog");
  }
  process.stdout.write("TOPIC_BATCH_INGEST_SELF_TEST=GO synthetic=1 productionApproved=0 bypassesRejected=6 atomicInput=1 minimalExtension=1\n");
  process.exit(0);
}

const args = parseArgs(process.argv.slice(2));
const manifestArg = requiredArg(args, "--manifest");

const catalogPath = path.resolve(process.cwd(), String(args.get("--catalog") ?? path.join(projectRoot, "knowledge", "catalog.json")));
const manifestPath = path.resolve(process.cwd(), manifestArg);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
validateBatchManifest(manifest, catalog);

const draftsRoot = await realpath(path.join(projectRoot, "knowledge", "drafts"));
const draftPaths = [];
for (const draftEntry of manifest.drafts) {
  const requested = path.resolve(projectRoot, draftEntry);
  const resolved = await realpath(requested);
  assertWithin(draftsRoot, resolved, `Draft path escapes knowledge/drafts: ${draftEntry}`);
  if (path.extname(resolved).toLowerCase() !== ".json") throw new Error(`Draft must be JSON: ${draftEntry}`);
  draftPaths.push(resolved);
}

const drafts = [];
for (const draftPath of draftPaths) {
  drafts.push(validateTopicDraft(JSON.parse(await readFile(draftPath, "utf8")), backlogById));
}
const merged = mergeValidatedBatch(catalog, drafts);
merged.version = manifest.nextCatalogVersion;
const rendered = `${JSON.stringify(merged, null, 2)}\n`;
const facts = drafts.reduce((total, draft) => total + draft.facts.length, 0);
const sources = new Set(drafts.flatMap((draft) => draft.sources.map((source) => source.sourceId))).size;
const digest = createHash("sha256").update(rendered).digest("hex");
if (!args.has("--write")) {
  process.stdout.write(
    `TOPIC_BATCH_PREVIEW=GO batch=${manifest.batchId} topics=${drafts.length} facts=${facts} sources=${sources} version=${merged.version} sha256=${digest} productionApproved=0 wrote=0\n`
  );
  process.exit(0);
}
const temporaryPath = `${catalogPath}.${process.pid}.tmp`;

try {
  await writeFile(temporaryPath, rendered, { encoding: "utf8", flag: "wx" });
  await rename(temporaryPath, catalogPath);
} finally {
  await rm(temporaryPath, { force: true });
}

process.stdout.write(
  `TOPIC_BATCH_INGEST=GO batch=${manifest.batchId} topics=${drafts.length} facts=${facts} sources=${sources} version=${merged.version} sha256=${digest} productionApproved=0\n`
);

function mergeValidatedBatch(catalog, drafts) {
  const topicIds = new Set();
  let merged = structuredClone(catalog);
  for (const draft of drafts) {
    if (topicIds.has(draft.topicId)) throw new Error(`Batch contains duplicate topic: ${draft.topicId}`);
    topicIds.add(draft.topicId);
    merged = mergeTopicDraft(merged, draft);
  }
  return merged;
}

function validateBatchManifest(manifest, catalog) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("Batch manifest must be a JSON object");
  const allowedKeys = new Set(["schemaVersion", "batchId", "baseCatalogVersion", "nextCatalogVersion", "drafts"]);
  const unknownKeys = Object.keys(manifest).filter((key) => !allowedKeys.has(key));
  if (unknownKeys.length > 0) throw new Error(`Batch manifest contains unknown fields: ${unknownKeys.join(", ")}`);
  if (manifest.schemaVersion !== 1) throw new Error("Batch manifest schemaVersion must be 1");
  if (!validToken(manifest.batchId)) throw new Error("Batch manifest batchId is invalid");
  if (!validToken(manifest.baseCatalogVersion) || !validToken(manifest.nextCatalogVersion)) {
    throw new Error("Batch manifest catalog versions are invalid");
  }
  if (catalog.version !== manifest.baseCatalogVersion) {
    throw new Error(`Batch was prepared for ${manifest.baseCatalogVersion}, current catalog is ${catalog.version}`);
  }
  if (manifest.nextCatalogVersion === manifest.baseCatalogVersion) {
    throw new Error("Batch must advance the catalog version");
  }
  if (!Array.isArray(manifest.drafts) || manifest.drafts.length < 1 || manifest.drafts.length > 20) {
    throw new Error("Batch must contain 1-20 draft paths");
  }
  if (!manifest.drafts.every((entry) => typeof entry === "string" && entry.trim() === entry && entry.length > 0)) {
    throw new Error("Batch draft paths must be non-empty normalized strings");
  }
  if (new Set(manifest.drafts.map((entry) => entry.toLowerCase())).size !== manifest.drafts.length) {
    throw new Error("Batch draft paths must be unique");
  }
}

function fixtureDraft(topic, index) {
  return {
    schemaVersion: 1,
    topicId: topic.topicId,
    displayName: topic.displayName,
    category: topic.category,
    aliases: [topic.displayName, topic.topicId],
    origin: "ai_assisted_draft",
    sources: [{
      sourceId: `fixture-source-${index}`,
      title: `Fixture source ${index}`,
      url: `https://example.org/source-${index}`,
      publisher: "Fixture",
      authority: "reference"
    }],
    facts: Array.from({ length: 3 }, (_, factIndex) => ({
      factId: `${topic.topicId}-fixture-${factIndex + 1}`,
      topicId: topic.topicId,
      factText: `Synthetic batch fixture fact ${factIndex + 1} for ${topic.topicId}; it is never written or published.`,
      sourceIds: [`fixture-source-${index}`],
      riskLevel: "general",
      reviewStatus: "draft"
    }))
  };
}

function parseArgs(values) {
  const output = new Map();
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (!key.startsWith("--")) continue;
    const next = values[index + 1];
    if (!next || next.startsWith("--")) output.set(key, true);
    else {
      output.set(key, next);
      index += 1;
    }
  }
  return output;
}

function requiredArg(args, name) {
  const value = args.get(name);
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

function validToken(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/.test(value);
}

function assertWithin(parent, target, message) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(message);
}

function expectFailure(operation, message) {
  try {
    operation();
  } catch {
    return;
  }
  throw new Error(`Expected failure: ${message}`);
}
