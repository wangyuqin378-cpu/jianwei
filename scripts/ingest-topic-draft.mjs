import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { loadTopicBacklog, makeValidatorFixture, mergeTopicDraft, projectRoot, validateTopicDraft } from "./lib/topic-draft.mjs";

const { backlogById } = await loadTopicBacklog();

if (process.argv.includes("--self-test")) {
  const catalog = {
    version: "fixture",
    sources: [],
    topics: []
  };
  const draft = makeValidatorFixture();
  validateTopicDraft(draft, backlogById);
  const imported = mergeTopicDraft(catalog, draft);
  if (imported.topics.length !== 1 || imported.topics[0].facts.length !== 3) {
    throw new Error("Ingest self-test did not add one complete topic");
  }
  if (imported.topics[0].facts.some((fact) => fact.reviewStatus !== "draft" || fact.review !== undefined)) {
    throw new Error("Ingest self-test unexpectedly granted release authority");
  }
  expectFailure(() => mergeTopicDraft(imported, draft), "duplicate facts must fail");
  const conflicting = structuredClone(draft);
  conflicting.sources[0].url = "https://example.org/changed";
  const catalogWithSource = { ...catalog, sources: [draft.sources[0]] };
  expectFailure(() => mergeTopicDraft(catalogWithSource, conflicting), "source ID conflicts must fail");
  const oneFactCatalog = {
    version: "fixture",
    sources: [],
    topics: [{
      topicId: draft.topicId,
      displayName: draft.displayName,
      category: draft.category,
      synonyms: [...draft.aliases],
      facts: [{ ...draft.facts[0], factId: "existing-fact" }]
    }]
  };
  const oversized = structuredClone(draft);
  oversized.facts.push(
    { ...draft.facts[0], factId: "door-handle-draft-4" },
    { ...draft.facts[0], factId: "door-handle-draft-5" }
  );
  expectFailure(() => mergeTopicDraft(oneFactCatalog, oversized), "topic fact limit must fail closed");
  process.stdout.write("TOPIC_DRAFT_INGEST_GATE=GO selfTest=1 productionApproved=0 conflictsRejected=3\n");
  process.exit(0);
}

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  if (!key.startsWith("--")) continue;
  const next = process.argv[index + 1];
  if (!next || next.startsWith("--")) args.set(key, true);
  else {
    args.set(key, next);
    index += 1;
  }
}

const draftArg = args.get("--draft");
if (typeof draftArg !== "string" || !draftArg.trim()) {
  throw new Error("Usage: node scripts/ingest-topic-draft.mjs --draft <draft.json> [--catalog knowledge/catalog.json] --write");
}
if (!args.has("--write")) throw new Error("--write is required; intake never mutates the catalog implicitly");

const draftPath = path.resolve(process.cwd(), draftArg);
const catalogPath = path.resolve(process.cwd(), String(args.get("--catalog") ?? path.join(projectRoot, "knowledge", "catalog.json")));
const draft = validateTopicDraft(JSON.parse(await readFile(draftPath, "utf8")), backlogById);
const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
const merged = mergeTopicDraft(catalog, draft);
const temporaryPath = `${catalogPath}.${process.pid}.tmp`;

try {
  await writeFile(temporaryPath, `${JSON.stringify(merged, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  await rename(temporaryPath, catalogPath);
} finally {
  await rm(temporaryPath, { force: true });
}

process.stdout.write(
  `TOPIC_DRAFT_INGEST=GO topic=${draft.topicId} facts=${draft.facts.length} sources=${draft.sources.length} productionApproved=0\n`
);

function expectFailure(operation, message) {
  try {
    operation();
  } catch {
    return;
  }
  throw new Error(`Expected failure: ${message}`);
}
