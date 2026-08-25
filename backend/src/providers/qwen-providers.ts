import type { DailyKnowledgeRanker, DetectedEntity, KnowledgeCard, VisionProvider } from "../domain/types.js";
import { dailyKnowledgeRankingSchema, detectedEntitySchema } from "../domain/schemas.js";
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
    public readonly receivedKeys: string[],
    public readonly issues: Array<{ path: string; code: string }>
  ) {
    super("invalid_model_schema", "视觉服务返回结构无效", 502);
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
        temperature: 0
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
            "只识别最适合讲日常知识的单个物件。严格只返回一个 JSON 对象，不得新增、删除或改名字段。canonicalTopicId 使用简短英文 snake_case；displayName 使用中文；confidence 是 0 到 1 的数字；alternatives 是最多 5 个中文字符串；sensitiveFlags 只能从 face,selfie,identity_document,bank_card,receipt,document,high_text_density,screenshot 中选择。",
            "boundingBox 必须严格为 null，或严格为 {\"x\":0.1,\"y\":0.1,\"width\":0.8,\"height\":0.8} 这种对象；四个字段都必须是 0 到 1 的数字，禁止使用 x1、y1、x2、y2、left、top、right、bottom、bbox_2d 或数组。",
            "完整 JSON 形状示例：{\"canonicalTopicId\":\"bicycle\",\"displayName\":\"自行车\",\"confidence\":0.95,\"boundingBox\":{\"x\":0.1,\"y\":0.1,\"width\":0.8,\"height\":0.8},\"alternatives\":[\"单车\"],\"sensitiveFlags\":[]}"
          ].join("\n")
        },
        { type: "image_url", image_url: { url: imageUrl } }
      ]
    }]);
    const parsed = detectedEntitySchema.safeParse(raw);
    if (!parsed.success) throw schemaError(raw, parsed.error.issues);
    return parsed.data;
  }
}

export class QwenDailyKnowledgeRanker implements DailyKnowledgeRanker {
  constructor(private readonly options: QwenOptions) {}

  async select(cards: KnowledgeCard[]): Promise<{ cardId: string; reason: string }> {
    invariant(cards.length >= 2 && cards.length <= 3, "invalid_daily_candidates", "每日候选数量无效", 400);
    const candidates = cards.map((card) => ({
      cardId: card.cardId,
      objectName: card.detectedObjectName,
      title: card.title,
      fact: card.body
    }));
    const raw = await callQwen(this.options, [{
      role: "user",
      content: [
        "你是日常知识卡编辑。请从候选中选出今天最值得展示的一条。优先具体、反直觉、能从熟悉物件看到新角度的知识；避免只因对象罕见而选择，也不要添加候选之外的事实。",
        "严格返回 {\"cardId\":\"候选 UUID\",\"reason\":\"不超过 60 字的选择理由\"}，不得返回其他字段。",
        JSON.stringify(candidates)
      ].join("\n")
    }]);
    const parsed = dailyKnowledgeRankingSchema.safeParse(raw);
    if (!parsed.success || !cards.some((card) => card.cardId === parsed.data.cardId)) {
      throw new AppError("invalid_ranking_schema", "知识排序服务返回结构无效", 502);
    }
    return parsed.data;
  }
}

function schemaError(
  raw: unknown,
  issues: ReadonlyArray<{ path: PropertyKey[]; code: string }>
): QwenSchemaError {
  const receivedKeys = raw && typeof raw === "object" && !Array.isArray(raw)
    ? Object.keys(raw).filter((key) => /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(key)).slice(0, 12)
    : [];
  return new QwenSchemaError(
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
