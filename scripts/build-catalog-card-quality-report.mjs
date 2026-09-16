import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildCatalogCard, uniqueByID, sha256 } from "./lib/catalog-review-provenance.mjs";

const args = process.argv.slice(2);
const catalogFile = path.resolve(optionalValue("--catalog") ?? "knowledge/catalog.json");
const outputFile = requiredPath("--output");
const requestedFactIds = new Set((optionalValue("--fact-ids") ?? "").split(",").map((value) => value.trim()).filter(Boolean));
const requestedQualityStatus = optionalValue("--card-quality-status");
if (requestedQualityStatus && !new Set(["approved", "candidate"]).has(requestedQualityStatus)) {
  throw new Error("--card-quality-status must be approved or candidate");
}
const catalog = JSON.parse(await readFile(catalogFile, "utf8"));
const evidenceFile = requiredPath("--source-evidence");
const evidenceBytes = await readFile(evidenceFile);
const evidence = JSON.parse(evidenceBytes.toString("utf8"));
const sourceById = uniqueByID(catalog.sources, "sourceId", "catalog sources");
const evidenceById = uniqueByID(evidence.sources, "sourceId", "source evidence");
uniqueByID(catalog.topics.flatMap(topic => topic.facts), "factId", "catalog facts");

const results = catalog.topics.flatMap((topic) => topic.facts.flatMap((fact) => {
  if (!fact.cardTitle || !fact.cardBody || fact.riskLevel !== "general" || fact.reviewStatus !== "approved") {
    return [];
  }
  if (requestedQualityStatus && fact.cardQualityStatus !== requestedQualityStatus) return [];
  if (requestedFactIds.size > 0 && !requestedFactIds.has(fact.factId)) return [];
  return [{
    fileName: `catalog-${fact.factId}.json`,
    status: "ready",
    expectedDisplayName: topic.displayName,
    card: buildCatalogCard(topic, fact, sourceById, evidenceById)
  }];
}));

if (results.length === 0) throw new Error("Catalog has no reviewed card copy to evaluate");
if (requestedFactIds.size && results.length !== requestedFactIds.size) throw new Error("Requested fact IDs are missing or ineligible");
await writeFile(outputFile, `${JSON.stringify({
  schemaVersion: 2,
  evidenceKind: "source-bound-catalog-review-candidates",
  caveat: "Retrieved text is not semantic approval. Independent source-support and photo applicability review remain required.",
  sourceEvidence: { file: evidenceFile, sha256: sha256(evidenceBytes) },
  generatedAt: new Date().toISOString(),
  catalogVersion: catalog.version,
  results,
  dailyGroups: []
}, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
process.stdout.write(`CATALOG_CARD_QUALITY_REPORT=PASS cards=${results.length} output=${outputFile}\n`);

function requiredPath(flag) {
  const value = optionalValue(flag);
  if (!value) throw new Error(`${flag} is required`);
  return path.resolve(value);
}

function optionalValue(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}
