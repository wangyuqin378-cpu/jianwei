import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { buildReviewedSeedPlan, sha256 } from "../../../scripts/lib/catalog-review-provenance.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../../..");
const args = process.argv.slice(2);
if (!optionalValue("--stability")) throw new Error("--stability is required; legacy default approvals are no longer accepted");
const stabilityFile = resolve(repositoryRoot, optionalValue("--stability"));
const modelVersion = optionalValue("--model-version") ?? "reviewed-catalog-v341-source-bound";
if (!modelVersion.startsWith("reviewed-catalog-")) throw new Error("Catalog model version must use the runtime-supported reviewed-catalog- prefix");
const catalog = JSON.parse(readFileSync(resolve(repositoryRoot, optionalValue("--catalog") ?? "knowledge/catalog.json"), "utf8"));
const stability = JSON.parse(readFileSync(stabilityFile, "utf8"));
const facts = buildReviewedSeedPlan(catalog, stability);
if (!Array.isArray(stability.inputs) || stability.inputs.length < 10) throw new Error("Missing raw evaluation and nine review artifacts");
const inputFiles = new Set();
for (const input of stability.inputs) {
  if (inputFiles.has(input.file) || sha256(readFileSync(input.file)) !== input.sha256) throw new Error(`Review artifact changed: ${input.file}`);
  inputFiles.add(input.file);
}
for (const card of stability.cards.filter(card => stability.stableFactIds.includes(card.factId))) {
  if (!inputFiles.has(card.evaluationFile) || card.trials.some(trial =>
    !Array.isArray(trial.reviewFiles) || trial.reviewFiles.length !== 3 || trial.reviewFiles.some(file => !inputFiles.has(file)))) {
    throw new Error(`Incomplete review artifact provenance: ${card.factId}`);
  }
}
const now = new Date().toISOString();

const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const aliasesByTopic = new Map(facts.map(fact => [fact.topicKey, fact.aliases]));

const factStatements = facts.map((fact) => `
INSERT INTO knowledge_facts (
  topic_key, fact_id, object_name, photo_requirement, title, body, source_json, scores_json,
  model_version, evidence_summary, created_at, last_used_at
) VALUES (
  ${quote(fact.topicKey)}, ${quote(fact.factId)}, ${quote(fact.objectName)}, ${fact.photoRequirement ? quote(fact.photoRequirement) : "NULL"}, ${quote(fact.title)},
  ${quote(fact.body)}, ${quote(JSON.stringify(fact.sources))}, ${quote(JSON.stringify(fact.scores))},
  ${quote(modelVersion)}, ${quote(fact.evidenceSummary)}, ${quote(now)}, ${quote(now)}
) ON CONFLICT(topic_key) DO UPDATE SET
  fact_id = excluded.fact_id,
  object_name = excluded.object_name,
  photo_requirement = excluded.photo_requirement,
  title = excluded.title,
  body = excluded.body,
  source_json = excluded.source_json,
  scores_json = excluded.scores_json,
  model_version = excluded.model_version,
  evidence_summary = excluded.evidence_summary,
  last_used_at = excluded.last_used_at;`).join("\n");
const aliasStatements = [...aliasesByTopic.entries()].flatMap(([topicKey, aliases]) => aliases.map((alias) => `
INSERT INTO knowledge_topic_aliases (alias, topic_key) VALUES (${quote(alias)}, ${quote(topicKey)})
ON CONFLICT(alias, topic_key) DO NOTHING;`)).join("\n");
const statements = `${factStatements}\n${aliasStatements}`;

if (!args.includes("--apply")) {
  console.log(`REVIEWED_SEED=CHECK_ONLY facts=${facts.length} remoteWrites=0; use --apply only after reviewing a database backup and this exact stability report.`);
  process.exit(0);
}

const wrangler = resolve(scriptDirectory, "../node_modules/.bin/wrangler");
// Actual source text is much larger than the old summaries. Use a file so a
// validated seed cannot overflow the process argument limit on macOS/Linux.
const directory = mkdtempSync(join(tmpdir(), "jianwei-reviewed-seed-"));
let result;
try {
  const file = join(directory, "seed.sql");
  writeFileSync(file, statements, { mode: 0o600, flag: "wx" });
  result = spawnSync(wrangler, ["d1", "execute", "jianwei-beta", "--remote", "--file", file], {
    cwd: resolve(scriptDirectory, ".."), encoding: "utf8", stdio: "inherit"
  });
} finally { rmSync(directory, { recursive: true, force: true }); }
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`Seeded ${facts.length} stable reviewed facts and ${[...aliasesByTopic.values()].flat().length} topic aliases.`);

function optionalValue(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}
