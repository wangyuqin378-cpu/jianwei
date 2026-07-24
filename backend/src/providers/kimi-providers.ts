import type { CardDraft, CardWriter, DetectedEntity, KnowledgeFact, KnowledgeSource, VisionProvider } from "../domain/types.js";
import { cardDraftSchema, detectedEntitySchema } from "../domain/schemas.js";
import { AppError, invariant } from "../errors.js";

interface KimiOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export const KIMI_REQUEST_TIMEOUT_MS = 60_000;

const detectedEntityFormat = {
  type: "json_schema",
  json_schema: {
    name: "jianwei_detected_entity",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        canonicalTopicId: { type: "string" },
        displayName: { type: "string" },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        boundingBox: {
          anyOf: [
            { type: "null" },
            {
              type: "object",
              additionalProperties: false,
              properties: {
                x: { type: "number", minimum: 0, maximum: 1 },
                y: { type: "number", minimum: 0, maximum: 1 },
                width: { type: "number", minimum: 0, maximum: 1 },
                height: { type: "number", minimum: 0, maximum: 1 }
              },
              required: ["x", "y", "width", "height"]
            }
          ]
        },
        alternatives: { type: "array", items: { type: "string" }, maxItems: 5 },
        sensitiveFlags: {
          type: "array",
          uniqueItems: true,
          items: {
            type: "string",
            enum: ["face", "selfie", "identity_document", "bank_card", "receipt", "document", "high_text_density", "screenshot"]
          }
        }
      },
      required: ["canonicalTopicId", "displayName", "confidence", "boundingBox", "alternatives", "sensitiveFlags"]
    }
  }
} as const;

const cardDraftFormat = {
  type: "json_schema",
  json_schema: {
    name: "jianwei_card_title",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        factId: { type: "string" },
        sourceIds: { type: "array", items: { type: "string" }, uniqueItems: true }
      },
      required: ["title", "factId", "sourceIds"]
    }
  }
} as const;

async function callKimi(options: KimiOptions, messages: unknown[], responseFormat: unknown): Promise<unknown> {
  let response: Response;
  try {
    const baseUrl = options.baseUrl ?? "https://api.moonshot.cn/v1";
    response = await (options.fetchImpl ?? fetch)(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${options.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: options.model,
        messages,
        reasoning_effort: "low",
        response_format: responseFormat,
        max_completion_tokens: 800
      }),
      redirect: "error",
      signal: AbortSignal.timeout(KIMI_REQUEST_TIMEOUT_MS)
    });
  } catch {
    throw new AppError("vision_provider_unavailable", "视觉服务暂时不可用", 502);
  }
  const payload = await response.json().catch(() => ({})) as {
    choices?: Array<{ finish_reason?: string; message?: { content?: string } }>;
  };
  if (!response.ok) throw new AppError("vision_provider_error", "视觉服务暂时不可用", 502);
  const choice = payload.choices?.[0];
  invariant(choice?.finish_reason === "stop", "incomplete_model_response", "Kimi 返回内容不完整", 502);
  const content = choice.message?.content;
  invariant(content, "empty_model_response", "Kimi 没有返回结构化内容", 502);
  try {
    return JSON.parse(content);
  } catch {
    throw new AppError("invalid_model_json", "Kimi 返回了无效 JSON", 502);
  }
}

export class KimiVisionProvider implements VisionProvider {
  constructor(private readonly options: KimiOptions) {}

  async detect(input: { image: Buffer; imageUrl?: string; localLabels: string[] }): Promise<DetectedEntity> {
    const imageUrl = input.imageUrl ?? `data:image/jpeg;base64,${input.image.toString("base64")}`;
    const raw = await callKimi(this.options, [{
      role: "user",
      content: [
        {
          type: "text",
          text: [
            "先检查图片是否含人脸/自拍、身份证件、银行卡、票据、文档、截图或高文字密度内容；命中时写入 sensitiveFlags。不要识别人、关系、情绪、健康或位置。",
            `端侧候选标签：${input.localLabels.join("、") || "无"}。`,
            "只识别最适合讲日常知识的单个物件。返回 JSON：canonicalTopicId 使用简短英文 snake_case；displayName 中文；confidence 0-1；boundingBox 为 0-1 坐标或 null；alternatives 最多 5 个；sensitiveFlags 只能从 face,selfie,identity_document,bank_card,receipt,document,high_text_density,screenshot 中选择。"
          ].join("\n")
        },
        { type: "image_url", image_url: { url: imageUrl } }
      ]
    }], detectedEntityFormat);
    const parsed = detectedEntitySchema.safeParse(raw);
    if (!parsed.success) throw new AppError("invalid_model_schema", "视觉服务返回结构无效", 502);
    return parsed.data;
  }
}

export class KimiCardWriter implements CardWriter {
  constructor(private readonly options: KimiOptions) {}

  async write(input: {
    entity: DetectedEntity;
    fact: KnowledgeFact;
    sources: KnowledgeSource[];
    personalContext: string;
  }): Promise<CardDraft> {
    const raw = await callKimi(this.options, [{
      role: "system",
      content: "你是知识卡标题编辑。只能生成标题，不得输出或改写正文，不得增加事实、数字、建议或来源。输出 JSON。"
    }, {
      role: "user",
      content: [
        `物件：${input.entity.displayName}`,
        `审核事实：${input.fact.factText}`,
        `factId：${input.fact.factId}`,
        `sourceIds：${input.sources.map((source) => source.sourceId).join(",")}`,
        "你只能生成 2-30 字标题；正文由服务端直接使用人工审核事实，禁止输出或改写正文。不确定时标题使用“这可能是…”。原样返回 factId 和 sourceIds。"
      ].join("\n")
    }], cardDraftFormat);
    const parsed = cardDraftSchema.safeParse(raw);
    if (!parsed.success) throw new AppError("invalid_model_schema", "卡片服务返回结构无效", 502);
    const draft = parsed.data;
    invariant(draft.factId === input.fact.factId, "model_changed_fact", "模型修改了 factId", 502);
    invariant(
      draft.sourceIds.length === input.sources.length &&
        new Set(draft.sourceIds).size === draft.sourceIds.length &&
        draft.sourceIds.every((id) => input.sources.some((source) => source.sourceId === id)),
      "model_changed_sources",
      "模型修改了来源",
      502
    );
    return draft;
  }
}
