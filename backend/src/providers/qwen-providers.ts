import type { CardDraft, CardWriter, DetectedEntity, KnowledgeFact, KnowledgeSource, VisionProvider } from "../domain/types.js";
import { cardDraftSchema, detectedEntitySchema } from "../domain/schemas.js";
import { AppError, invariant } from "../errors.js";

interface QwenOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  additionalDataInspection?: "required" | "omit-for-local-verification";
}

export class QwenProviderError extends AppError {
  constructor(
    public readonly upstreamStatus: number,
    public readonly upstreamCode: string | null
  ) {
    super("vision_provider_error", "视觉服务暂时不可用", 502);
  }
}

export class QwenSchemaError extends AppError {
  constructor(
    public readonly stage: "vision" | "card",
    public readonly receivedKeys: string[],
    public readonly issues: Array<{ path: string; code: string }>
  ) {
    super("invalid_model_schema", stage === "vision" ? "视觉服务返回结构无效" : "卡片服务返回结构无效", 502);
  }
}

export const QWEN_REQUEST_TIMEOUT_MS = 25_000;

async function callQwen(options: QwenOptions, messages: unknown[]): Promise<unknown> {
  let response: Response;
  try {
    const baseUrl = options.baseUrl ?? "https://dashscope.aliyuncs.com/compatible-mode/v1";
    const headers: Record<string, string> = {
      "Authorization": `Bearer ${options.apiKey}`,
      "Content-Type": "application/json"
    };
    if (options.additionalDataInspection !== "omit-for-local-verification") {
      headers["X-DashScope-DataInspection"] = '{"input":"cip","output":"cip"}';
    }
    response = await (options.fetchImpl ?? fetch)(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: options.model,
        messages,
        enable_thinking: false,
        response_format: { type: "json_object" },
        temperature: 0,
        max_tokens: 800
      }),
      redirect: "error",
      signal: AbortSignal.timeout(QWEN_REQUEST_TIMEOUT_MS)
    });
  } catch {
    throw new AppError("vision_provider_unavailable", "视觉服务暂时不可用", 502);
  }
  const payload = await response.json().catch(() => ({})) as {
    error?: { code?: string; message?: string };
    choices?: Array<{ message?: { content?: string } }>;
  };
  if (!response.ok) {
    throw new QwenProviderError(response.status, safeUpstreamCode(payload.error?.code));
  }
  const content = payload.choices?.[0]?.message?.content;
  invariant(content, "empty_model_response", "通义没有返回结构化内容", 502);
  try {
    return JSON.parse(content);
  } catch {
    throw new AppError("invalid_model_json", "通义返回了无效 JSON", 502);
  }
}

function safeUpstreamCode(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(value) ? value : null;
}

export class QwenVisionProvider implements VisionProvider {
  constructor(private readonly options: QwenOptions) {}

  async detect(input: { image: Buffer; imageUrl?: string; localLabels: string[] }): Promise<DetectedEntity> {
    const imageUrl = input.imageUrl ?? `data:image/jpeg;base64,${input.image.toString("base64")}`;
    const raw = await callQwen(this.options, [{
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
    }]);
    const parsed = detectedEntitySchema.safeParse(raw);
    if (!parsed.success) throw schemaError("vision", raw, parsed.error.issues);
    return parsed.data;
  }
}

export class QwenCardWriter implements CardWriter {
  constructor(private readonly options: QwenOptions) {}

  async write(input: {
    entity: DetectedEntity;
    fact: KnowledgeFact;
    sources: KnowledgeSource[];
    personalContext: string;
  }): Promise<CardDraft> {
    const raw = await callQwen(this.options, [{
      role: "system",
      content: "你是知识卡标题编辑。只能生成标题，不得输出或改写正文，不得增加事实、数字、建议或来源。输出 JSON。"
    }, {
      role: "user",
      content: [
        `物件：${input.entity.displayName}`,
        `审核事实：${input.fact.factText}`,
        `factId：${input.fact.factId}`,
        `sourceIds：${input.sources.map((source) => source.sourceId).join(",")}`,
        "你只能生成 2-30 字标题；正文由服务端直接使用人工审核事实，禁止输出或改写正文。不确定时标题使用“这可能是…”。",
        `严格只返回这一 JSON 结构：${JSON.stringify({
          title: "2-30字标题",
          factId: input.fact.factId,
          sourceIds: input.sources.map((source) => source.sourceId)
        })}`,
        "factId 必须是字符串；sourceIds 必须是 JSON 字符串数组，元素、数量和顺序都不得改变；不得增加其他字段。"
      ].join("\n")
    }]);
    const parsed = cardDraftSchema.safeParse(raw);
    if (!parsed.success) throw schemaError("card", raw, parsed.error.issues);
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

function schemaError(
  stage: "vision" | "card",
  raw: unknown,
  issues: ReadonlyArray<{ path: PropertyKey[]; code: string }>
): QwenSchemaError {
  const receivedKeys = raw && typeof raw === "object" && !Array.isArray(raw)
    ? Object.keys(raw).filter((key) => /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(key)).slice(0, 12)
    : [];
  return new QwenSchemaError(
    stage,
    receivedKeys,
    issues.slice(0, 12).map((issue) => ({
      path: issue.path.map(String).join(".").slice(0, 160),
      code: issue.code.slice(0, 80)
    }))
  );
}

export class ConfidenceFallbackVisionProvider implements VisionProvider {
  constructor(
    private readonly primary: VisionProvider,
    private readonly fallback: VisionProvider,
    private readonly threshold = 0.72
  ) {}

  async detect(input: { image: Buffer; imageUrl?: string; localLabels: string[] }): Promise<DetectedEntity> {
    const first = await this.primary.detect(input);
    return first.sensitiveFlags.length > 0 || first.confidence >= this.threshold ? first : this.fallback.detect(input);
  }
}
