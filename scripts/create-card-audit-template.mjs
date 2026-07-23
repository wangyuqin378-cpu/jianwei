import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

export function createCardAuditTemplate(snapshots) {
  if (!snapshots || typeof snapshots !== "object" || Array.isArray(snapshots) ||
      snapshots.schemaVersion !== 1 || snapshots.evidenceKind !== "generated_card_snapshots" ||
      !validToken(snapshots.runId) || !Array.isArray(snapshots.cards) ||
      snapshots.cards.length < 200 || snapshots.cards.length > 500) {
    throw new Error("Card snapshot artifact is invalid or outside the 200-500 review range");
  }
  const ids = new Set();
  const digests = new Set();
  const audits = snapshots.cards.map((card) => {
    if (!card || typeof card !== "object" || !validToken(card.cardId) ||
        !/^[a-f0-9]{64}$/.test(card.cardSha256 ?? "") || ids.has(card.cardId) || digests.has(card.cardSha256) ||
        !Array.isArray(card.sources) || card.sources.length < 1) {
      throw new Error("Card snapshot rows are invalid or duplicated");
    }
    const checkedSourceIds = card.sources.map((source) => source?.sourceId);
    if (checkedSourceIds.some((sourceId) => !validToken(sourceId)) || new Set(checkedSourceIds).size !== checkedSourceIds.length) {
      throw new Error(`Card snapshot source IDs are invalid: ${card.cardId}`);
    }
    ids.add(card.cardId);
    digests.add(card.cardSha256);
    return {
      cardId: card.cardId,
      cardSha256: card.cardSha256,
      reviewerId: "",
      auditedAt: "",
      checkedSourceIds: [],
      sourcesReachable: null,
      fabricatedSource: null,
      unsupportedPersonalConclusion: null,
      evidenceRef: ""
    };
  });
  return {
    schemaVersion: 1,
    evidenceKind: "human_card_audits",
    runId: snapshots.runId,
    evidenceRef: "",
    completedAt: "",
    audits
  };
}

function parseArgs(values) {
  const args = new Map();
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (key === "--write" || key === "--self-test") args.set(key, true);
    else if (typeof key === "string" && key.startsWith("--")) args.set(key, values[++index]);
    else throw new Error(`Unexpected argument: ${key}`);
  }
  return args;
}

function validToken(value) {
  return typeof value === "string" && /^[A-Za-z0-9._-]{3,128}$/.test(value);
}

function fixture() {
  return {
    schemaVersion: 1,
    evidenceKind: "generated_card_snapshots",
    runId: "fixture-card-run",
    cards: Array.from({ length: 200 }, (_, index) => ({
      cardId: `card-${index}`,
      cardSha256: (index + 1000).toString(16).padStart(64, "0"),
      sources: [{ sourceId: "source-one", url: "https://example.org/source" }]
    }))
  };
}

const args = parseArgs(process.argv.slice(2));
if (args.has("--self-test")) {
  const template = createCardAuditTemplate(fixture());
  if (template.audits.length !== 200 || template.audits.some((audit) =>
    audit.reviewerId || audit.auditedAt || audit.checkedSourceIds.length || audit.sourcesReachable !== null ||
    audit.fabricatedSource !== null || audit.unsupportedPersonalConclusion !== null || audit.evidenceRef
  )) throw new Error("Card audit template self-test preconfirmed human outcomes");
  const duplicate = fixture();
  duplicate.cards[1].cardSha256 = duplicate.cards[0].cardSha256;
  let rejected = false;
  try { createCardAuditTemplate(duplicate); } catch { rejected = true; }
  if (!rejected) throw new Error("Card audit template accepted duplicate snapshots");
  process.stdout.write("CARD_AUDIT_TEMPLATE_SELF_TEST=GO synthetic=1 releaseEvidence=0 cards=200 preconfirmed=0 duplicatesRejected=1\n");
  process.exit(0);
}

const snapshotsPath = path.resolve(process.cwd(), String(args.get("--snapshots") ?? "evaluation/card-snapshots.json"));
const outputPath = path.resolve(process.cwd(), String(args.get("--output") ?? "evaluation/card-audits.json"));
const snapshots = JSON.parse(await readFile(snapshotsPath, "utf8"));
const template = createCardAuditTemplate(snapshots);
if (!args.has("--write")) {
  process.stdout.write(`CARD_AUDIT_TEMPLATE_PREVIEW=GO run=${template.runId} cards=${template.audits.length} preconfirmed=0 wrote=0\n`);
  process.exit(0);
}
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(template, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
process.stdout.write(`CARD_AUDIT_TEMPLATE=GO run=${template.runId} cards=${template.audits.length} preconfirmed=0 wrote=1\n`);
