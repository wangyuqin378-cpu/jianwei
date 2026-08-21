import { describe, expect, it } from "vitest";
import type { KnowledgeCatalog } from "../domain/types.js";
import {
  applyAiReviewDecisions,
  buildAiReviewMessages,
  deterministicAiReviewDecision,
  parseAiReviewResponse,
  selectAiReviewCandidates
} from "./ai-knowledge-review.js";

describe("AI knowledge review", () => {
  it("selects only unattested general facts", () => {
    const candidates = selectAiReviewCandidates(fixture());
    expect(candidates.map((item) => item.factId)).toEqual(["broom-general"]);
    expect(buildAiReviewMessages(candidates)[0]!.content).toContain("不得声称已核对网页正文");
    expect(buildAiReviewMessages(candidates)[0]!.content).toContain("decisions 的值必须是 JSON 数组");
  });

  it("rejects incomplete, duplicate, or contradictory model decisions", () => {
    const candidates = selectAiReviewCandidates(fixture());
    expect(() => parseAiReviewResponse(JSON.stringify({ decisions: [] }), candidates)).toThrow();
    expect(() => parseAiReviewResponse(JSON.stringify({ decisions: [{
      factId: "broom-general",
      decision: "approved",
      reasonCode: "political_or_illegal",
      note: "冲突"
    }] }), candidates)).toThrow(/disagree/);
  });

  it("accepts a valid decision when the model omits the optional note", () => {
    const candidates = selectAiReviewCandidates(fixture());
    const decisions = parseAiReviewResponse(JSON.stringify({ decisions: [{
      factId: "broom-general",
      decision: "approved",
      reasonCode: "safe_general"
    }] }), candidates);
    expect(decisions).toEqual([{
      factId: "broom-general",
      decision: "approved",
      reasonCode: "safe_general",
      note: ""
    }]);
  });

  it("rejects out-of-range card bodies before asking the model", () => {
    const candidate = selectAiReviewCandidates(fixture())[0]!;
    expect(deterministicAiReviewDecision({ ...candidate, factText: "长".repeat(81) })).toMatchObject({
      decision: "rejected",
      reasonCode: "format_invalid"
    });
    expect(deterministicAiReviewDecision(candidate)).toBeNull();
  });

  it("binds an approved decision to exact content and a fixed model", () => {
    const catalog = fixture();
    const candidates = selectAiReviewCandidates(catalog);
    const decisions = parseAiReviewResponse(JSON.stringify({ decisions: [{
      factId: "broom-general",
      decision: "approved",
      reasonCode: "safe_general",
      note: "普通物件知识，未发现内容风险"
    }] }), candidates);
    const next = applyAiReviewDecisions({
      catalog,
      candidates,
      decisions,
      model: "qwen3.6-flash-2026-04-16",
      reviewedAt: "2026-07-27T00:00:00.000Z",
      nextVersion: "fixture-ai.1"
    });
    const fact = next.topics[0]!.facts[0]!;
    expect(fact.reviewStatus).toBe("approved");
    expect(fact.aiReview?.decision).toBe("approved");
    expect(fact.aiReview?.evidenceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(catalog.topics[0]!.facts[0]!.aiReview).toBeUndefined();
  });
});

function fixture(): KnowledgeCatalog {
  return {
    version: "fixture",
    sources: [{
      sourceId: "source-one",
      title: "Broom design",
      url: "https://example.com/broom",
      publisher: "Example",
      authority: "reference"
    }],
    topics: [{
      topicId: "broom",
      displayName: "扫帚",
      synonyms: ["broom", "扫帚"],
      category: "cleaning",
      facts: [{
        factId: "broom-general",
        topicId: "broom",
        factText: "现代扫帚常把刷毛设计成略带角度的扇形，让边缘更容易贴近墙角和家具边缘。",
        sourceIds: ["source-one"],
        riskLevel: "general",
        reviewStatus: "draft"
      }, {
        factId: "broom-health",
        topicId: "broom",
        factText: "这是一条不会进入 AI 一般知识审核流程的健康建议测试文本。",
        sourceIds: ["source-one"],
        riskLevel: "health",
        reviewStatus: "draft"
      }, {
        factId: "broom-human",
        topicId: "broom",
        factText: "这是一条已经由真人完成审核并且不应再次进入自动审核流程的测试知识。",
        sourceIds: ["source-one"],
        riskLevel: "general",
        reviewStatus: "approved",
        review: {
          reviewerId: "human-one",
          reviewedAt: "2026-01-01T00:00:00.000Z",
          sourceCheckedAt: "2026-01-01T00:00:00.000Z"
        }
      }]
    }]
  };
}
