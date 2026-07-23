import { createHash } from "node:crypto";
import { readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { loadTopicBacklog, projectRoot, validateTopicDraft } from "./lib/topic-draft.mjs";

const { backlogById } = await loadTopicBacklog();

if (process.argv.includes("--self-test")) {
  const metadata = [...backlogById.values()][0];
  const draft = fixtureDraft(metadata);
  const catalog = fixtureCatalog(metadata);
  const corrected = applyDraftCorrections(catalog, [draft]);
  if (corrected.topics[0].facts[0].factText !== draft.facts[0].factText) {
    throw new Error("Correction self-test did not replace draft facts");
  }
  if (corrected.sources.some((source) => source.sourceId === "old-source")) {
    throw new Error("Correction self-test retained an orphan source");
  }
  if (corrected.topics[0].facts.some((fact) => fact.reviewStatus !== "draft" || fact.review !== undefined)) {
    throw new Error("Correction self-test unexpectedly granted approval");
  }
  expectFailure(() => applyDraftCorrections(catalog, [{ ...draft, topicId: "missing-topic" }]), "missing topic");
  const approved = structuredClone(catalog);
  approved.topics[0].facts[0].reviewStatus = "approved";
  expectFailure(() => applyDraftCorrections(approved, [draft]), "approved fact replacement");
  const factMismatch = structuredClone(draft);
  factMismatch.facts[0].factId = "different-fact-id";
  expectFailure(() => applyDraftCorrections(catalog, [factMismatch]), "fact identity mismatch");
  process.stdout.write("CATALOG_DRAFT_CORRECTION_SELF_TEST=GO synthetic=1 productionApproved=0 bypassesRejected=3 orphanCleanup=1\n");
  process.exit(0);
}

const args = parseArgs(process.argv.slice(2));
const manifestArg = requiredArg(args, "--manifest");
const catalogPath = path.resolve(process.cwd(), String(args.get("--catalog") ?? path.join(projectRoot, "knowledge", "catalog.json")));
const manifestPath = path.resolve(process.cwd(), manifestArg);
const catalogBytes = await readFile(catalogPath);
const catalog = JSON.parse(catalogBytes.toString("utf8"));
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
validateManifest(manifest, catalog, sha256(catalogBytes));

const draftsRoot = await realpath(path.join(projectRoot, "knowledge", "drafts"));
const drafts = [];
for (const entry of manifest.drafts) {
  const requested = path.resolve(projectRoot, entry);
  const resolved = await realpath(requested);
  assertWithin(draftsRoot, resolved, `Draft path escapes knowledge/drafts: ${entry}`);
  if (path.extname(resolved).toLowerCase() !== ".json") throw new Error(`Draft must be JSON: ${entry}`);
  drafts.push(validateTopicDraft(JSON.parse(await readFile(resolved, "utf8")), backlogById));
}

const corrected = applyDraftCorrections(catalog, drafts);
corrected.version = manifest.nextCatalogVersion;
const rendered = `${JSON.stringify(corrected, null, 2)}\n`;
const digest = sha256(rendered);
const facts = drafts.reduce((total, draft) => total + draft.facts.length, 0);
if (!args.has("--write")) {
  process.stdout.write(
    `CATALOG_DRAFT_CORRECTION_PREVIEW=GO correction=${manifest.correctionId} topics=${drafts.length} facts=${facts} version=${corrected.version} sha256=${digest} productionApproved=0 wrote=0\n`
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
  `CATALOG_DRAFT_CORRECTION=GO correction=${manifest.correctionId} topics=${drafts.length} facts=${facts} version=${corrected.version} sha256=${digest} productionApproved=0\n`
);

export function applyDraftCorrections(catalog, drafts) {
  const corrected = structuredClone(catalog);
  const targetIds = new Set();
  const sourceReplacements = new Map();
  for (const draft of drafts) {
    if (targetIds.has(draft.topicId)) throw new Error(`Duplicate correction topic: ${draft.topicId}`);
    targetIds.add(draft.topicId);
    const topic = corrected.topics.find((item) => item.topicId === draft.topicId);
    if (!topic) throw new Error(`Correction topic does not exist: ${draft.topicId}`);
    if (topic.displayName !== draft.displayName || topic.category !== draft.category) {
      throw new Error(`Correction topic metadata mismatch: ${draft.topicId}`);
    }
    if (topic.facts.some((fact) => fact.reviewStatus !== "draft" || fact.review !== undefined)) {
      throw new Error(`Correction cannot replace approved or attested facts: ${draft.topicId}`);
    }
    const currentFactIds = [...topic.facts.map((fact) => fact.factId)].sort();
    const draftFactIds = [...draft.facts.map((fact) => fact.factId)].sort();
    if (JSON.stringify(currentFactIds) !== JSON.stringify(draftFactIds)) {
      throw new Error(`Correction must preserve fact identities: ${draft.topicId}`);
    }
    for (const source of draft.sources) {
      const normalized = normalizedSource(source);
      const existing = sourceReplacements.get(source.sourceId);
      if (existing && JSON.stringify(existing) !== JSON.stringify(normalized)) {
        throw new Error(`Correction drafts conflict on source: ${source.sourceId}`);
      }
      sourceReplacements.set(source.sourceId, normalized);
    }
  }

  const outsideReferences = new Map();
  for (const topic of corrected.topics) {
    if (targetIds.has(topic.topicId)) continue;
    for (const fact of topic.facts) {
      for (const sourceId of fact.sourceIds) outsideReferences.set(sourceId, topic.topicId);
    }
  }
  const currentSources = new Map(corrected.sources.map((source) => [source.sourceId, source]));
  for (const [sourceId, replacement] of sourceReplacements) {
    const current = currentSources.get(sourceId);
    if (current && JSON.stringify(current) !== JSON.stringify(replacement) && outsideReferences.has(sourceId)) {
      throw new Error(`Correction would change a source used outside its topics: ${sourceId}/${outsideReferences.get(sourceId)}`);
    }
  }

  for (const draft of drafts) {
    const index = corrected.topics.findIndex((topic) => topic.topicId === draft.topicId);
    corrected.topics[index] = {
      topicId: draft.topicId,
      displayName: draft.displayName,
      synonyms: [...new Set(draft.aliases.map((alias) => alias.trim()))],
      category: draft.category,
      facts: draft.facts.map((fact) => ({
        factId: fact.factId,
        topicId: fact.topicId,
        factText: fact.factText.trim(),
        sourceIds: [...fact.sourceIds],
        riskLevel: fact.riskLevel,
        reviewStatus: "draft"
      }))
    };
  }

  const referenced = new Set(corrected.topics.flatMap((topic) => topic.facts.flatMap((fact) => fact.sourceIds)));
  const finalSources = new Map();
  for (const source of corrected.sources) {
    if (!referenced.has(source.sourceId)) continue;
    finalSources.set(source.sourceId, sourceReplacements.get(source.sourceId) ?? source);
  }
  for (const [sourceId, source] of sourceReplacements) {
    if (referenced.has(sourceId)) finalSources.set(sourceId, source);
  }
  const missing = [...referenced].filter((sourceId) => !finalSources.has(sourceId));
  if (missing.length > 0) throw new Error(`Correction leaves missing sources: ${missing.join(", ")}`);
  corrected.sources = [...finalSources.values()];
  return corrected;
}

function validateManifest(manifest, catalog, catalogSha256) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("Correction manifest must be an object");
  const allowed = new Set(["schemaVersion", "correctionId", "baseCatalogVersion", "nextCatalogVersion", "expectedCatalogSha256", "drafts"]);
  const unknown = Object.keys(manifest).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new Error(`Correction manifest contains unknown fields: ${unknown.join(", ")}`);
  if (manifest.schemaVersion !== 1) throw new Error("Correction schemaVersion must be 1");
  if (!validToken(manifest.correctionId)) throw new Error("Correction ID is invalid");
  if (catalog.version !== manifest.baseCatalogVersion) throw new Error("Correction catalog version is stale");
  if (!validToken(manifest.nextCatalogVersion) || manifest.nextCatalogVersion === manifest.baseCatalogVersion) {
    throw new Error("Correction must advance the catalog version");
  }
  if (manifest.expectedCatalogSha256 !== catalogSha256) throw new Error("Correction catalog SHA-256 is stale");
  if (!Array.isArray(manifest.drafts) || manifest.drafts.length < 1 || manifest.drafts.length > 20) {
    throw new Error("Correction requires 1-20 draft paths");
  }
  if (!manifest.drafts.every((entry) => typeof entry === "string" && entry.trim() === entry && entry.endsWith(".json"))) {
    throw new Error("Correction draft paths are invalid");
  }
  if (new Set(manifest.drafts.map((entry) => entry.toLowerCase())).size !== manifest.drafts.length) {
    throw new Error("Correction draft paths must be unique");
  }
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

function fixtureCatalog(metadata) {
  return {
    version: "fixture-beta.1",
    sources: [{ sourceId: "old-source", title: "Old", url: "https://example.org/old", publisher: "Old", authority: "reference" }],
    topics: [{
      topicId: metadata.topicId,
      displayName: metadata.displayName,
      synonyms: [metadata.displayName, metadata.topicId],
      category: metadata.category,
      facts: Array.from({ length: 3 }, (_, index) => ({
        factId: `${metadata.topicId}-fixture-${index + 1}`,
        topicId: metadata.topicId,
        factText: `Original synthetic fact ${index + 1} for the correction self-test and no production release.`,
        sourceIds: ["old-source"],
        riskLevel: "general",
        reviewStatus: "draft"
      }))
    }]
  };
}

function fixtureDraft(metadata) {
  return {
    schemaVersion: 1,
    topicId: metadata.topicId,
    displayName: metadata.displayName,
    category: metadata.category,
    aliases: [metadata.displayName, metadata.topicId],
    origin: "ai_assisted_draft",
    sources: [{ sourceId: "new-source", title: "New", url: "https://example.org/new", publisher: "New", authority: "reference" }],
    facts: Array.from({ length: 3 }, (_, index) => ({
      factId: `${metadata.topicId}-fixture-${index + 1}`,
      topicId: metadata.topicId,
      factText: `Corrected synthetic fact ${index + 1} for the correction self-test and no production release.`,
      sourceIds: ["new-source"],
      riskLevel: "general",
      reviewStatus: "draft"
    }))
  };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
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
