import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  parseFlagArgs,
  requiredString
} from "./lib/fact-review.mjs";
import { assertFailClosedReviewTemplate, createReviewTemplate } from "./lib/review-template.mjs";

if (process.argv.includes("--self-test")) {
  const queue = fixtureQueue();
  const template = createReviewTemplate(queue, { limit: 2 });
  if (template.decisions.length !== 2 || template.decisions.some((item) => item.decision !== "pending")) {
    throw new Error("Review template self-test granted or omitted a decision");
  }
  if (template.decisions.some((item) => item.semanticSupportConfirmed || item.unsupportedClaimsChecked || item.checkedSourceIds.length)) {
    throw new Error("Review template self-test pre-confirmed human checks");
  }
  assertFailClosedReviewTemplate(template);
  const generalWholeTopics = createReviewTemplate(queue, {
    limit: 3,
    riskLevel: "general",
    wholeTopics: true
  });
  if (generalWholeTopics.decisions.map((item) => item.factId).join(",") !== "fact-1,fact-2") {
    throw new Error("Review template self-test split a topic or included a mixed-risk topic");
  }
  process.stdout.write("KNOWLEDGE_REVIEW_TEMPLATE_SELF_TEST=GO synthetic=1 releaseEvidence=0 decisionsPending=2 grantsApproval=0 riskFilter=1 wholeTopics=1\n");
  process.exit(0);
}

const args = parseFlagArgs(process.argv.slice(2));
const queuePath = path.resolve(process.cwd(), String(args.get("--queue") ?? ".tooling/knowledge-review-queue/review-queue.json"));
const limit = Number(args.get("--limit") ?? 20);
if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("--limit must be an integer from 1 to 50");
const topicId = typeof args.get("--topic") === "string" ? String(args.get("--topic")).trim() : null;
const riskLevel = riskArgument(args);
const wholeTopics = args.has("--whole-topics");
const queue = JSON.parse(await readFile(queuePath, "utf8"));
const template = createReviewTemplate(queue, { limit, topicId, riskLevel, wholeTopics });

if (!args.has("--write")) {
  process.stdout.write(summary("PREVIEW", template, 0, { riskLevel, wholeTopics }));
  process.exit(0);
}

const outputPath = path.resolve(process.cwd(), requiredString(args, "--output"));
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(template, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
process.stdout.write(summary("GO", template, 1, { riskLevel, wholeTopics }));

function summary(status, template, wrote, selection) {
  return `KNOWLEDGE_REVIEW_TEMPLATE=${status} catalog=${template.catalogVersion} decisions=${template.decisions.length} risk=${selection.riskLevel ?? "all"} wholeTopics=${selection.wholeTopics ? 1 : 0} allPending=${template.decisions.every((item) => item.decision === "pending") ? 1 : 0} grantsApproval=0 wrote=${wrote}\n`;
}

function riskArgument(args) {
  const value = args.get("--risk");
  if (value === undefined) return null;
  if (typeof value !== "string" || !["general", "health", "safety"].includes(value.trim())) {
    throw new Error("--risk must be general, health or safety");
  }
  return value.trim();
}

function fixtureQueue() {
  return {
    schemaVersion: 2,
    evidenceKind: "human_semantic_review_work_queue",
    catalogVersion: "fixture-1",
    catalogSha256: "a".repeat(64),
    generatedAt: "2026-01-01T00:00:00.000Z",
    policy: { grantsApproval: false },
    reviewableTopics: [
      {
        topicId: "fixture-general",
        facts: [
          { factId: "fact-1", factSha256: "b".repeat(64), riskLevel: "general", sources: [{ sourceId: "source-1" }] },
          { factId: "fact-2", factSha256: "c".repeat(64), riskLevel: "general", sources: [{ sourceId: "source-1" }] }
        ]
      },
      {
        topicId: "fixture-mixed",
        facts: [
          { factId: "fact-3", factSha256: "d".repeat(64), riskLevel: "general", sources: [{ sourceId: "source-1" }] },
          { factId: "fact-4", factSha256: "e".repeat(64), riskLevel: "health", sources: [{ sourceId: "source-1" }] }
        ]
      },
      {
        topicId: "fixture-general-second",
        facts: [
          { factId: "fact-5", factSha256: "f".repeat(64), riskLevel: "general", sources: [{ sourceId: "source-1" }] },
          { factId: "fact-6", factSha256: "1".repeat(64), riskLevel: "general", sources: [{ sourceId: "source-1" }] }
        ]
      }
    ]
  };
}
