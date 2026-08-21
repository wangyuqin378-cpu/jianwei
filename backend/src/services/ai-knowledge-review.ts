import { createHash } from "node:crypto";
import { z } from "zod";
import type { KnowledgeCatalog, KnowledgeFact, KnowledgeSource } from "../domain/types.js";

export const AI_KNOWLEDGE_POLICY_VERSION = "general-content-v1" as const;
export const AI_REVIEW_REASON_CODES = [
  "safe_general",
  "political_or_illegal",
  "adult_or_violent",
  "personal_or_sensitive",
  "health_or_safety",
  "unclear_or_unreliable",
  "format_invalid"
] as const;

export type AiReviewReasonCode = typeof AI_REVIEW_REASON_CODES[number];

export interface AiReviewCandidate {
  factId: string;
  topicId: string;
  topicName: string;
  factText: string;
  sources: Array<Pick<KnowledgeSource, "sourceId" | "title" | "publisher" | "authority" | "url">>;
}

export interface AiReviewDecision {
  factId: string;
  decision: "approved" | "rejected";
  reasonCode: AiReviewReasonCode;
  note: string;
}

const decisionSchema = z.object({
  factId: z.string().min(1).max(128),
  decision: z.enum(["approved", "rejected"]),
  reasonCode: z.enum(AI_REVIEW_REASON_CODES),
  note: z.string().trim().max(160).optional().default("")
}).strict();

const responseSchema = z.object({
  decisions: z.array(decisionSchema).min(1).max(20)
}).strict();

export function selectAiReviewCandidates(catalog: KnowledgeCatalog): AiReviewCandidate[] {
  const sources = new Map(catalog.sources.map((source) => [source.sourceId, source]));
  const output: AiReviewCandidate[] = [];
  for (const topic of catalog.topics) {
    for (const fact of topic.facts) {
      if (fact.riskLevel !== "general" || fact.review || fact.aiReview) continue;
      if (fact.reviewStatus !== "draft" && fact.reviewStatus !== "approved") continue;
      output.push({
        factId: fact.factId,
        topicId: topic.topicId,
        topicName: topic.displayName,
        factText: fact.factText,
        sources: fact.sourceIds.map((sourceId) => {
          const source = sources.get(sourceId);
          if (!source) throw new Error(`AI review candidate references missing source: ${fact.factId}/${sourceId}`);
          return source;
        })
      });
    }
  }
  return output;
}

export function buildAiReviewMessages(candidates: AiReviewCandidate[]): Array<{ role: "system" | "user"; content: string }> {
  if (candidates.length < 1 || candidates.length > 20) throw new Error("AI review batch must contain 1-20 facts");
  return [{
    role: "system",
    content: [
      "你是见微的一般知识自动内容审核器，只做发布前筛选，不改写事实。",
      "批准条件必须全部满足：内容属于普通物件知识；28-80 个中文字符；不涉政治敏感、违法、色情、暴力、仇恨、侵权或隐私；不包含健康、安全、诊断、用药、危险操作或个性化结论；表述清楚、克制、常识上可信；来源标题和发布者至少与主题方向相符。",
      "URL 只作为公开来源身份，你没有打开网页，因此不得声称已核对网页正文。不能确定时拒绝为 unclear_or_unreliable。",
      "批准必须使用 decision=approved 且 reasonCode=safe_general；拒绝不得使用 safe_general。",
      "只返回 JSON 对象，键为 decisions；decisions 的值必须是 JSON 数组，不能是以 factId 为键的对象；每个输入 factId 必须恰好返回一次，禁止额外 factId。"
    ].join("\n")
  }, {
    role: "user",
    content: JSON.stringify({ policyVersion: AI_KNOWLEDGE_POLICY_VERSION, candidates })
  }];
}

export function deterministicAiReviewDecision(candidate: AiReviewCandidate): AiReviewDecision | null {
  const bodyLength = [...candidate.factText].length;
  if (bodyLength < 28 || bodyLength > 80) {
    return {
      factId: candidate.factId,
      decision: "rejected",
      reasonCode: "format_invalid",
      note: `正文长度为 ${bodyLength} 字，不在 28-80 字发布范围内`
    };
  }
  return null;
}

export function parseAiReviewResponse(content: string, candidates: AiReviewCandidate[]): AiReviewDecision[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("AI knowledge review did not return valid JSON");
  }
  const decisions = responseSchema.parse(parsed).decisions;
  const expected = new Set(candidates.map((candidate) => candidate.factId));
  const seen = new Set<string>();
  for (const decision of decisions) {
    if (!expected.has(decision.factId) || seen.has(decision.factId)) {
      throw new Error(`AI knowledge review returned an unknown or duplicate fact: ${decision.factId}`);
    }
    seen.add(decision.factId);
    if ((decision.decision === "approved") !== (decision.reasonCode === "safe_general")) {
      throw new Error(`AI knowledge review decision and reason disagree: ${decision.factId}`);
    }
  }
  if (seen.size !== expected.size) throw new Error("AI knowledge review omitted one or more facts");
  return decisions;
}

export function applyAiReviewDecisions({
  catalog,
  candidates,
  decisions,
  model,
  reviewedAt,
  nextVersion
}: {
  catalog: KnowledgeCatalog;
  candidates: AiReviewCandidate[];
  decisions: AiReviewDecision[];
  model: string;
  reviewedAt: string;
  nextVersion: string;
}): KnowledgeCatalog {
  if (!/^qwen[0-9a-z._-]{2,95}$/i.test(model)) throw new Error("AI knowledge review requires a fixed Qwen model ID");
  if (!nextVersion.trim() || nextVersion === catalog.version) throw new Error("AI knowledge review requires a new catalog version");
  const reviewedAtDate = new Date(reviewedAt);
  if (!Number.isFinite(reviewedAtDate.getTime()) || reviewedAtDate.toISOString() !== reviewedAt) {
    throw new Error("AI knowledge review timestamp must be strict ISO-8601");
  }
  const candidateById = new Map(candidates.map((candidate) => [candidate.factId, candidate]));
  const decisionById = new Map(decisions.map((decision) => [decision.factId, decision]));
  if (decisionById.size !== candidates.length) throw new Error("AI knowledge review decisions are incomplete");
  const next = structuredClone(catalog);
  next.version = nextVersion;
  const facts = new Map<string, KnowledgeFact>();
  for (const topic of next.topics) for (const fact of topic.facts) facts.set(fact.factId, fact);
  for (const [factId, candidate] of candidateById) {
    const decision = decisionById.get(factId);
    const fact = facts.get(factId);
    if (!decision || !fact || fact.riskLevel !== "general" || fact.review || fact.aiReview ||
        (fact.reviewStatus !== "draft" && fact.reviewStatus !== "approved")) {
      throw new Error(`AI knowledge review target changed or is no longer eligible: ${factId}`);
    }
    fact.reviewStatus = decision.decision;
    fact.aiReview = {
      provider: "qwen",
      model,
      policyVersion: AI_KNOWLEDGE_POLICY_VERSION,
      reviewedAt,
      decision: decision.decision,
      reasonCode: decision.reasonCode,
      evidenceSha256: evidenceSha256(candidate, decision, model)
    };
  }
  return next;
}

export function evidenceSha256(candidate: AiReviewCandidate, decision: AiReviewDecision, model: string): string {
  return createHash("sha256").update(JSON.stringify([
    "jianwei-ai-knowledge-review-evidence-v1",
    AI_KNOWLEDGE_POLICY_VERSION,
    model,
    candidate,
    decision
  ])).digest("hex");
}
