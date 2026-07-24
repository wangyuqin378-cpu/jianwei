import type { DetectedEntity, VisionProvider } from "../domain/types.js";
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
