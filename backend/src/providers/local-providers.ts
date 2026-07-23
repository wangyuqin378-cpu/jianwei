import type { CardDraft, CardWriter, DetectedEntity, KnowledgeFact, KnowledgeSource, VisionProvider } from "../domain/types.js";
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

export class TemplateCardWriter implements CardWriter {
  async write(input: {
    entity: DetectedEntity;
    fact: KnowledgeFact;
    sources: KnowledgeSource[];
    personalContext: string;
  }): Promise<CardDraft> {
    return {
      title: input.entity.confidence < 0.8 ? `这可能是${input.entity.displayName}` : input.entity.displayName,
      factId: input.fact.factId,
      sourceIds: input.sources.map((source) => source.sourceId)
    };
  }
}
