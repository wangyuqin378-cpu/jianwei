import type { DailyKnowledgeRanker, DetectedEntity, KnowledgeCard, VisionProvider } from "../domain/types.js";
import { KnowledgeCatalogService } from "../services/knowledge-catalog.js";

export class LocalVisionProvider implements VisionProvider {
  constructor(private readonly knowledge: KnowledgeCatalogService) {}

  async detect(input: { localLabels: string[] }): Promise<DetectedEntity> {
    const topic = this.knowledge.matchLabels(input.localLabels);
    if (!topic) {
      return {
        canonicalTopicId: "unknown",
        displayName: "未确认物件",
        confidence: 0.2,
        boundingBox: null,
        alternatives: input.localLabels.slice(0, 3),
        sensitiveFlags: []
      };
    }
    return {
      canonicalTopicId: topic.topicId,
      displayName: topic.displayName,
      confidence: 0.92,
      boundingBox: null,
      alternatives: [],
      sensitiveFlags: []
    };
  }
}

export class LocalDailyKnowledgeRanker implements DailyKnowledgeRanker {
  async select(cards: KnowledgeCard[]): Promise<{ cardId: string; reason: string }> {
    const selected = [...cards].sort((left, right) =>
      right.body.length - left.body.length || right.confidence - left.confidence || left.cardId.localeCompare(right.cardId)
    )[0];
    if (!selected) throw new Error("Daily knowledge candidates are empty");
    return { cardId: selected.cardId, reason: "本地测试按知识完整度稳定选择" };
  }
}
