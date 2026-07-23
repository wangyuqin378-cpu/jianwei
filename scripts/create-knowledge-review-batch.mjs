import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  parseFlagArgs,
  requiredString
} from "./lib/fact-review.mjs";
import { assertFailClosedReviewTemplate, createReviewTemplate } from "./lib/review-template.mjs";

if (process.argv.includes("--self-test")) {
  const template = createReviewTemplate(fixtureQueue(), { limit: 2 });
  if (template.decisions.length !== 2 || template.decisions.some((item) => item.decision !== "pending")) {
    throw new Error("Review template self-test granted or omitted a decision");
  }
  if (template.decisions.some((item) => item.semanticSupportConfirmed || item.unsupportedClaimsChecked || item.checkedSourceIds.length)) {
    throw new Error("Review template self-test pre-confirmed human checks");
  }
  assertFailClosedReviewTemplate(template);
  process.stdout.write("KNOWLEDGE_REVIEW_TEMPLATE_SELF_TEST=GO synthetic=1 releaseEvidence=0 decisionsPending=2 grantsApproval=0\n");
  process.exit(0);
}

const args = parseFlagArgs(process.argv.slice(2));
const queuePath = path.resolve(process.cwd(), String(args.get("--queue") ?? ".tooling/knowledge-review-queue/review-queue.json"));
const limit = Number(args.get("--limit") ?? 20);
if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("--limit must be an integer from 1 to 50");
const topicId = typeof args.get("--topic") === "string" ? String(args.get("--topic")).trim() : null;
const queue = JSON.parse(await readFile(queuePath, "utf8"));
const template = createReviewTemplate(queue, { limit, topicId });

if (!args.has("--write")) {
  process.stdout.write(summary("PREVIEW", template, 0));
  process.exit(0);
}

const outputPath = path.resolve(process.cwd(), requiredString(args, "--output"));
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(template, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
process.stdout.write(summary("GO", template, 1));

function summary(status, template, wrote) {
  return `KNOWLEDGE_REVIEW_TEMPLATE=${status} catalog=${template.catalogVersion} decisions=${template.decisions.length} allPending=${template.decisions.every((item) => item.decision === "pending") ? 1 : 0} grantsApproval=0 wrote=${wrote}\n`;
}

function fixtureQueue() {
  return {
    schemaVersion: 2,
    evidenceKind: "human_semantic_review_work_queue",
    catalogVersion: "fixture-1",
    catalogSha256: "a".repeat(64),
    generatedAt: "2026-01-01T00:00:00.000Z",
    policy: { grantsApproval: false },
    reviewableTopics: [{
      topicId: "fixture",
      facts: [
        { factId: "fact-1", factSha256: "b".repeat(64), sources: [{ sourceId: "source-1" }] },
        { factId: "fact-2", factSha256: "c".repeat(64), sources: [{ sourceId: "source-1" }] }
      ]
    }]
  };
}
