import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseBailianCredentialsCsv } from "./bailian-credentials.js";
import { loadConfig } from "./config.js";
import { knowledgeCatalogSchema } from "./domain/schemas.js";
import type { KnowledgeCatalog } from "./domain/types.js";
import { isMainModule } from "./main-module.js";
import {
  applyAiReviewDecisions,
  buildAiReviewMessages,
  deterministicAiReviewDecision,
  parseAiReviewResponse,
  selectAiReviewCandidates,
  type AiReviewCandidate,
  type AiReviewDecision
} from "./services/ai-knowledge-review.js";
import { validateCatalog } from "./services/knowledge-catalog.js";

interface Arguments {
  credentialsFile: string;
  catalogFile: string;
  outputFile: string;
  nextVersion: string | null;
  limit: number | null;
  write: boolean;
}

interface Usage {
  inputTokens: number;
  outputTokens: number;
}

interface ReviewCheckpoint {
  schemaVersion: 1;
  catalogSha256: string;
  model: string;
  policyVersion: "general-content-v1";
  selectionDigest: string;
  decisions: AiReviewDecision[];
  usage: Usage;
  calls: number;
}

const REPO_ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const BATCH_SIZE = 20;
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export function parseArguments(args: string[], now = new Date()): Arguments {
  let credentialsFile = "";
  let catalogFile = path.join(REPO_ROOT, "knowledge", "catalog.json");
  let outputFile = path.join(
    REPO_ROOT,
    ".tooling",
    "ai-knowledge-review",
    `review-${now.toISOString().replace(/[:.]/g, "-")}.json`
  );
  let nextVersion: string | null = null;
  let limit: number | null = 20;
  let write = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") continue;
    if (argument === "--credentials-file") credentialsFile = args[++index] ?? "";
    else if (argument === "--catalog") catalogFile = args[++index] ?? "";
    else if (argument === "--output") outputFile = args[++index] ?? "";
    else if (argument === "--next-version") nextVersion = args[++index] ?? "";
    else if (argument === "--limit") limit = Number(args[++index]);
    else if (argument === "--all") limit = null;
    else if (argument === "--write") write = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!credentialsFile) throw new Error("--credentials-file is required");
  if (!catalogFile || !outputFile) throw new Error("Catalog and output paths are required");
  if (limit !== null && (!Number.isSafeInteger(limit) || limit < 1 || limit > 600)) {
    throw new Error("--limit must be an integer from 1 to 600");
  }
  if (write && (!nextVersion || !nextVersion.trim())) throw new Error("--next-version is required with --write");
  if (!write && nextVersion) throw new Error("--next-version is only valid with --write");
  return {
    credentialsFile: path.resolve(credentialsFile),
    catalogFile: path.resolve(catalogFile),
    outputFile: path.resolve(outputFile),
    nextVersion,
    limit,
    write
  };
}

export function demoteUnattestedHighRisk(catalog: KnowledgeCatalog): number {
  let demoted = 0;
  for (const topic of catalog.topics) {
    for (const fact of topic.facts) {
      if (fact.riskLevel !== "general" && fact.reviewStatus === "approved" && !fact.review) {
        fact.reviewStatus = "draft";
        delete fact.aiReview;
        demoted += 1;
      }
    }
  }
  return demoted;
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  await mkdir(path.dirname(args.outputFile), { recursive: true });
  const reportFile = await open(args.outputFile, "wx", 0o600);
  let completed = false;
  try {
  const catalogText = await readFile(args.catalogFile, "utf8");
  const catalogSha256 = sha256(catalogText);
  const catalog = knowledgeCatalogSchema.parse(JSON.parse(catalogText)) as KnowledgeCatalog;
  validateCatalog(catalog);
  const credentials = parseBailianCredentialsCsv(await readFile(args.credentialsFile, "utf8"));
  const config = loadConfig({
    NODE_ENV: "development",
    VISION_PROVIDER: "qwen",
    DASHSCOPE_API_KEY: credentials.apiKey,
    DASHSCOPE_BASE_URL: credentials.openAiCompatible,
    WORST_CASE_COST_MICRO_CNY_PER_JOB: "1000000",
    MAX_GLOBAL_COST_MICRO_CNY_PER_DAY: "2000000000",
    MAX_GLOBAL_COST_MICRO_CNY_PER_MONTH: "50000000000"
  });
  const available = selectAiReviewCandidates(catalog);
  const selectedCandidates = args.limit === null ? available : available.slice(0, args.limit);
  if (selectedCandidates.length === 0) throw new Error("No eligible general knowledge facts require AI review");
  const selectionDigest = sha256(JSON.stringify(selectedCandidates));
  const checkpointFile = `${args.outputFile}.checkpoint`;
  const localDecisions = selectedCandidates
    .map(deterministicAiReviewDecision)
    .filter((decision): decision is AiReviewDecision => decision !== null);
  const localDecisionIds = new Set(localDecisions.map((decision) => decision.factId));
  const checkpoint = await loadCheckpoint(checkpointFile, {
    catalogSha256,
    model: config.qwenFlashModel,
    selectionDigest,
    selectedCandidates,
    localDecisions
  });
  const resumedDecisionCount = checkpoint?.decisions.length ?? 0;
  const restoredDecisionIds = new Set(checkpoint?.decisions.map((decision) => decision.factId) ?? []);
  const candidates = selectedCandidates.filter((candidate) =>
    !localDecisionIds.has(candidate.factId) && !restoredDecisionIds.has(candidate.factId)
  );

  const decisions: AiReviewDecision[] = checkpoint ? [...checkpoint.decisions] : [...localDecisions];
  const usage: Usage = checkpoint?.usage ?? { inputTokens: 0, outputTokens: 0 };
  let calls = checkpoint?.calls ?? 0;
  for (let offset = 0; offset < candidates.length; offset += BATCH_SIZE) {
    const batch = candidates.slice(offset, offset + BATCH_SIZE);
    const result = await reviewBatch({
      apiKey: credentials.apiKey,
      baseUrl: config.dashscopeBaseUrl,
      model: config.qwenFlashModel,
      candidates: batch
    });
    decisions.push(...result.decisions);
    usage.inputTokens += result.usage.inputTokens;
    usage.outputTokens += result.usage.outputTokens;
    calls += 1;
    await writeCheckpoint(checkpointFile, {
      schemaVersion: 1,
      catalogSha256,
      model: config.qwenFlashModel,
      policyVersion: "general-content-v1",
      selectionDigest,
      decisions,
      usage,
      calls
    });
  }

  const reviewedAt = new Date().toISOString();
  const counts = decisionCounts(decisions);
  let demotedHighRisk = 0;
  let nextCatalogSha256: string | null = null;
  if (args.write) {
    const next = applyAiReviewDecisions({
      catalog,
      candidates: selectedCandidates,
      decisions,
      model: config.qwenFlashModel,
      reviewedAt,
      nextVersion: args.nextVersion!
    });
    demotedHighRisk = demoteUnattestedHighRisk(next);
    knowledgeCatalogSchema.parse(next);
    validateCatalog(next, { requireAttestedApprovedFacts: true });
    const rendered = `${JSON.stringify(next, null, 2)}\n`;
    nextCatalogSha256 = sha256(rendered);
    const temporary = `${args.catalogFile}.${randomUUID()}.tmp`;
    await writeFile(temporary, rendered, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporary, args.catalogFile);
  }

  const report = {
    schemaVersion: 1,
    evidenceKind: "ai_general_knowledge_content_review",
    generatedAt: reviewedAt,
    releaseEvidence: false,
    provider: "qwen",
    model: config.qwenFlashModel,
    policyVersion: "general-content-v1",
    guardrailRequired: true,
    catalogVersion: catalog.version,
    catalogSha256,
    nextCatalogVersion: args.write ? args.nextVersion : null,
    nextCatalogSha256,
    selection: {
      eligible: available.length,
      reviewed: selectedCandidates.length,
      modelReviewed: selectedCandidates.length - localDecisions.length,
      locallyRejected: localDecisions.length,
      resumed: resumedDecisionCount,
      skippedHighRisk: catalog.topics.flatMap((topic) => topic.facts)
        .filter((fact) => fact.riskLevel !== "general").length
    },
    decisions: counts,
    demotedUnattestedHighRisk: demotedHighRisk,
    requests: { calls, batchSize: BATCH_SIZE, unguardedCalls: 0 },
    usage,
    writeApplied: args.write,
    decisionDigest: sha256(JSON.stringify(decisions.map(({ factId, decision, reasonCode }) => ({ factId, decision, reasonCode }))))
  };
  assertSecretFree(report, [credentials.apiKey, credentials.openAiCompatible, args.credentialsFile, args.catalogFile]);
  await reportFile.writeFile(`${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8" });
  await rm(checkpointFile, { force: true }).catch(() => undefined);
  completed = true;
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await reportFile.close().catch(() => undefined);
    if (!completed) await rm(args.outputFile, { force: true }).catch(() => undefined);
  }
}

async function loadCheckpoint(
  checkpointFile: string,
  expected: {
    catalogSha256: string;
    model: string;
    selectionDigest: string;
    selectedCandidates: AiReviewCandidate[];
    localDecisions: AiReviewDecision[];
  }
): Promise<ReviewCheckpoint | null> {
  let raw: string;
  try {
    raw = await readFile(checkpointFile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const value = JSON.parse(raw) as Partial<ReviewCheckpoint>;
  if (value.schemaVersion !== 1 || value.catalogSha256 !== expected.catalogSha256 ||
      value.model !== expected.model || value.policyVersion !== "general-content-v1" ||
      value.selectionDigest !== expected.selectionDigest || !Array.isArray(value.decisions) ||
      !Number.isSafeInteger(value.calls) || Number(value.calls) < 0 ||
      !Number.isSafeInteger(value.usage?.inputTokens) || Number(value.usage?.inputTokens) < 0 ||
      !Number.isSafeInteger(value.usage?.outputTokens) || Number(value.usage?.outputTokens) < 0) {
    throw new Error("AI knowledge review checkpoint does not match the current catalog or policy");
  }
  const candidateById = new Map(expected.selectedCandidates.map((candidate) => [candidate.factId, candidate]));
  const decisions: AiReviewDecision[] = [];
  for (let offset = 0; offset < value.decisions.length; offset += BATCH_SIZE) {
    const decisionBatch = value.decisions.slice(offset, offset + BATCH_SIZE);
    const candidateBatch = decisionBatch.map((decision) => candidateById.get(decision.factId));
    if (candidateBatch.some((candidate) => candidate === undefined)) {
      throw new Error("AI knowledge review checkpoint contains an unknown fact");
    }
    decisions.push(...parseAiReviewResponse(
      JSON.stringify({ decisions: decisionBatch }),
      candidateBatch as AiReviewCandidate[]
    ));
  }
  if (new Set(decisions.map((decision) => decision.factId)).size !== decisions.length) {
    throw new Error("AI knowledge review checkpoint contains duplicate facts");
  }
  for (const local of expected.localDecisions) {
    const restored = decisions.find((decision) => decision.factId === local.factId);
    if (!restored || restored.decision !== local.decision || restored.reasonCode !== local.reasonCode) {
      throw new Error("AI knowledge review checkpoint is missing a deterministic rejection");
    }
  }
  return {
    schemaVersion: 1,
    catalogSha256: value.catalogSha256,
    model: value.model,
    policyVersion: "general-content-v1",
    selectionDigest: value.selectionDigest,
    decisions,
    usage: { inputTokens: Number(value.usage!.inputTokens), outputTokens: Number(value.usage!.outputTokens) },
    calls: Number(value.calls)
  };
}

async function writeCheckpoint(checkpointFile: string, value: ReviewCheckpoint): Promise<void> {
  const temporary = `${checkpointFile}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await rename(temporary, checkpointFile);
}

async function reviewBatch({
  apiKey,
  baseUrl,
  model,
  candidates
}: {
  apiKey: string;
  baseUrl: string;
  model: string;
  candidates: AiReviewCandidate[];
}): Promise<{ decisions: AiReviewDecision[]; usage: Usage }> {
  let lastStatus = 0;
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "X-DashScope-DataInspection": "{\"input\":\"cip\",\"output\":\"cip\"}"
      },
      body: JSON.stringify({
        model,
        messages: buildAiReviewMessages(candidates),
        enable_thinking: false,
        response_format: { type: "json_object" },
        temperature: 0
      }),
      redirect: "error",
      signal: AbortSignal.timeout(30_000)
    });
    lastStatus = response.status;
    if (response.ok) {
      const payload = await response.json() as {
        choices?: Array<{ message?: { content?: unknown } }>;
        usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
      };
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new Error("AI knowledge review response is missing content");
      usage.inputTokens += safeTokenCount(payload.usage?.prompt_tokens);
      usage.outputTokens += safeTokenCount(payload.usage?.completion_tokens);
      try {
        return { decisions: parseAiReviewResponse(content, candidates), usage };
      } catch (error) {
        if (attempt === 2) throw error;
        continue;
      }
    }
    if (!RETRYABLE.has(response.status) || attempt === 2) break;
    await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** attempt)));
  }
  throw new Error(`AI knowledge review request failed with HTTP ${lastStatus}`);
}

function safeTokenCount(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

function decisionCounts(decisions: AiReviewDecision[]): Record<string, number> {
  const counts: Record<string, number> = { approved: 0, rejected: 0 };
  for (const decision of decisions) counts[decision.decision] = (counts[decision.decision] ?? 0) + 1;
  for (const reason of decisions.map((decision) => decision.reasonCode)) counts[reason] = (counts[reason] ?? 0) + 1;
  return counts;
}

function assertSecretFree(report: unknown, forbidden: string[]): void {
  const rendered = JSON.stringify(report);
  for (const value of forbidden) if (value && rendered.includes(value)) throw new Error("AI review report contains a forbidden secret or local path");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

if (isMainModule(import.meta.url)) await main();
