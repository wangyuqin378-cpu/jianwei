import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { KnowledgeCatalog, KnowledgeFact, KnowledgeSource, KnowledgeTopic } from "../domain/types.js";
import { knowledgeCatalogSchema } from "../domain/schemas.js";
import { AppError, invariant } from "../errors.js";

export class KnowledgeCatalogService {
  private constructor(
    readonly catalog: KnowledgeCatalog,
    private readonly topicsById: Map<string, KnowledgeTopic>,
    private readonly sourcesById: Map<string, KnowledgeSource>
  ) {}

  static async fromFile(
    filePath: string,
    policy: CatalogValidationPolicy = {}
  ): Promise<KnowledgeCatalogService> {
    const source = await readFile(filePath, "utf8");
    if (policy.expectedSha256) {
      const actual = createHash("sha256").update(source).digest("hex");
      invariant(actual === policy.expectedSha256, "catalog_integrity_mismatch", "知识库完整性校验失败");
    }
    const raw = JSON.parse(source) as unknown;
    const parsed = knowledgeCatalogSchema.parse(raw) as KnowledgeCatalog;
    validateCatalog(parsed, policy);
    return new KnowledgeCatalogService(
      parsed,
      new Map(parsed.topics.map((topic) => [topic.topicId, topic])),
      new Map(parsed.sources.map((source) => [source.sourceId, source]))
    );
  }

  findTopic(topicId: string): KnowledgeTopic | null {
    return this.topicsById.get(topicId) ?? null;
  }

  matchLabels(labels: string[]): KnowledgeTopic | null {
    const normalized = labels.map(normalize);
    let best: { topic: KnowledgeTopic; score: number } | null = null;
    for (const topic of this.catalog.topics) {
      const terms = [topic.topicId, topic.displayName, ...topic.synonyms].map(normalize);
      const score = normalized.reduce((total, label) => {
        const exact = terms.some((term) => term === label);
        const partial = terms.some((term) => term.includes(label) || label.includes(term));
        return total + (exact ? 3 : partial ? 1 : 0);
      }, 0);
      if (score > 0 && (!best || score > best.score)) best = { topic, score };
    }
    return best?.topic ?? null;
  }

  selectApprovedFact(
    topic: KnowledgeTopic,
    seed: string,
    allowUnattested = false
  ): { fact: KnowledgeFact; sources: KnowledgeSource[] } | null {
    const facts = topic.facts.filter((fact) =>
      fact.reviewStatus === "approved" && (allowUnattested || fact.review !== undefined)
    );
    if (!facts.length) return null;
    const hash = [...seed].reduce((value, character) => (value * 31 + character.charCodeAt(0)) >>> 0, 0);
    const fact = facts[hash % facts.length] as KnowledgeFact;
    const sources = fact.sourceIds.map((id) => this.sourcesById.get(id)).filter(Boolean) as KnowledgeSource[];
    return { fact, sources };
  }
}

export interface CatalogValidationPolicy {
  expectedSha256?: string | null;
  requireAttestedApprovedFacts?: boolean;
  approvedReviewerIds?: readonly string[] | null;
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_\-\/]+/g, "");
}

export function validateCatalog(catalog: KnowledgeCatalog, policy: CatalogValidationPolicy = {}): void {
  const sourceIds = new Set(catalog.sources.map((source) => source.sourceId));
  const approvedReviewerIds = policy.approvedReviewerIds ? new Set(policy.approvedReviewerIds) : null;
  invariant(sourceIds.size === catalog.sources.length, "duplicate_source", "知识库存在重复 sourceId");
  const topicIds = new Set<string>();
  const factIds = new Set<string>();
  for (const topic of catalog.topics) {
    invariant(!topicIds.has(topic.topicId), "duplicate_topic", `重复 topicId: ${topic.topicId}`);
    topicIds.add(topic.topicId);
    for (const fact of topic.facts) {
      invariant(fact.topicId === topic.topicId, "fact_topic_mismatch", `事实 ${fact.factId} 的 topicId 不匹配`);
      invariant(!factIds.has(fact.factId), "duplicate_fact", `重复 factId: ${fact.factId}`);
      invariant(
        new Set(fact.sourceIds).size === fact.sourceIds.length,
        "duplicate_fact_source",
        `事实 ${fact.factId} 存在重复来源`
      );
      factIds.add(fact.factId);
      for (const sourceId of fact.sourceIds) {
        invariant(sourceIds.has(sourceId), "unknown_source", `事实 ${fact.factId} 引用了未知来源 ${sourceId}`);
      }
      if (fact.reviewStatus === "approved" && policy.requireAttestedApprovedFacts) {
        invariant(fact.review, "missing_fact_review", `已批准事实 ${fact.factId} 缺少人工审核记录`);
      }
      if (fact.reviewStatus === "approved") {
        const bodyLength = [...fact.factText].length;
        invariant(
          bodyLength >= 28 && bodyLength <= 80,
          "approved_fact_card_length",
          `已批准事实 ${fact.factId} 必须可原样用作 28-80 字卡片正文`
        );
      }
      if (fact.review) {
        invariant(
          !/(?:^|[\s:_-])(ai|kimi|qwen|gpt|claude|gemini|llm|model|bot)(?:$|[\s:_-])/i.test(fact.review.reviewerId),
          "automated_reviewer_forbidden",
          `事实 ${fact.factId} 的审核人标识疑似自动模型`
        );
        if (approvedReviewerIds) {
          invariant(
            approvedReviewerIds.has(fact.review.reviewerId),
            "reviewer_not_approved",
            `事实 ${fact.factId} 的审核人不在生产白名单中`
          );
        }
        const reviewedAt = Date.parse(fact.review.reviewedAt);
        const sourceCheckedAt = Date.parse(fact.review.sourceCheckedAt);
        invariant(Number.isFinite(reviewedAt) && Number.isFinite(sourceCheckedAt), "invalid_review_time", `事实 ${fact.factId} 的审核时间无效`);
        invariant(sourceCheckedAt <= reviewedAt, "invalid_review_order", `事实 ${fact.factId} 的来源核验晚于审核完成时间`);
        invariant(reviewedAt <= Date.now() + 5 * 60 * 1000, "future_review", `事实 ${fact.factId} 的审核时间在未来`);
      }
      if (fact.riskLevel !== "general" && fact.reviewStatus === "approved") {
        const authoritative = new Set(fact.sourceIds.filter((id) => {
          const source = catalog.sources.find((item) => item.sourceId === id);
          return source?.authority === "official" || source?.authority === "professional";
        }));
        if (authoritative.size < 2) {
          throw new AppError("high_risk_sources", `高风险事实 ${fact.factId} 至少需要两个权威来源`, 500);
        }
      }
    }
  }
}
