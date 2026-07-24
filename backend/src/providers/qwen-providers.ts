import type { DetectedEntity, VisionProvider } from "../domain/types.js";
import { detectedEntitySchema } from "../domain/schemas.js";
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
    if (!parsed.success) throw schemaError(raw, parsed.error.issues);
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
