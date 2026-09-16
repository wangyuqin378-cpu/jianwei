import type { DailyKnowledgeRanker, DetectedEntity, KnowledgeCard, PhotoUnderstanding, TopicPreference, VisionProvider } from "../domain/types.js";
import { dailyKnowledgeRankingSchema, detectedEntitySchema, photoUnderstandingSchema } from "../domain/schemas.js";
import { AppError, invariant } from "../errors.js";
import { z } from "zod";

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

  async detect(input: {
    image: Buffer;
    imageUrl?: string;
    localLabels: string[];
    preferredTopics?: string[];
  }): Promise<DetectedEntity> {
    const imageUrl = input.imageUrl ?? `data:image/jpeg;base64,${input.image.toString("base64")}`;
    const raw = await callQwen(this.options, [{
      role: "user",
      content: [
        {
          type: "text",
          text: [
            "先检查图片是否含人脸/自拍、身份证件、银行卡、票据、文档、截图或高文字密度内容；命中时写入 sensitiveFlags。不要识别人、关系、情绪、健康或位置。",
            `端侧候选标签：${input.localLabels.join("、") || "无"}。`,
            `已有优质知识的主题：${input.preferredTopics?.slice(0, 80).join("、") || "无"}。若其中某个物件在图中清楚可见且能可靠确认，即使不是面积最大的主体，也优先选择它；不得为了命中列表而猜测被遮挡、太小或不存在的物件。若列表主题都不清楚，再选择其他最适合讲知识的完整物件。`,
            "只识别一个完整物件。若外壳被拆开、内部零件裸露，但接口、容量标记、结构组合等证据足以指向一个常见成品，应优先识别完整物件（例如拆开的 U 盘），不要退化成泛称的电路板或零件；证据不足时仍按可见部件识别。displayName 应写到图片能确认的最具体子类型；无法在两个不同类别间可靠判断时，confidence 必须低于 0.6。严格只返回一个 JSON 对象，不得新增、删除或改名字段。canonicalTopicId 使用简短英文 snake_case；displayName 使用中文；confidence 是 0 到 1 的数字；alternatives 是最多 5 个中文字符串；sensitiveFlags 只能从 face,selfie,identity_document,bank_card,receipt,document,high_text_density,screenshot 中选择。",
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

  async understand(input: {
    image: Buffer;
    imageUrl?: string;
    localLabels: string[];
    preferredTopics?: string[];
  }): Promise<PhotoUnderstanding> {
    const imageUrl = input.imageUrl ?? `data:image/jpeg;base64,${input.image.toString("base64")}`;
    const raw = await callQwen(this.options, [{
      role: "user",
      content: [
        {
          type: "text",
          text: [
            "先检查图片是否含人脸/自拍、身份证件、银行卡、票据、文档、截图或高文字密度内容；命中时写入 sensitiveFlags，subjects 必须为空。不要识别人、关系、情绪、健康或位置。",
            `端侧候选标签：${input.localLabels.join("、") || "无"}。这些标签可能错误，只能作为观察线索。`,
            "目标不是概括整幅场景，也不是只找面积最大的主体，而是找出照片里所有适合讲日常知识的清楚入口。先独立观察具体物件、植物、结构或部件，再按‘可确认程度、与照片关系、知识潜力’排序，最多返回 3 个不同对象。不要返回海滨夜景、室内空间、风景、街景这类笼统场景名；应返回画面中清楚可见的椰子、藤蔓、楼梯等具体对象。",
            "图片也可能是线描、示意图、商品图或拼图。此时按画出的结构和用途识别具体物件，不要把带中央弹簧、两片夹爪且没有手柄的晾衣夹泛化成钳子；拼图中只有清楚、占据独立格且可准确指认的物件才可返回。",
            `已有优质知识的主题：${input.preferredTopics?.slice(0, 80).join("、") || "无"}。目录只用于在清楚可见的对象中决定优先级，绝不能为了命中而猜测；明显对象不在目录时仍应如实返回。`,
            "displayName 写到图片能确认的最具体类型；无法在不同类别间可靠判断时 confidence 必须低于 0.6。canonicalTopicId 使用简短英文 snake_case；alternatives 最多 5 个中文同义名称。",
            "boundingBox 必须严格为 null，或严格为 {\"x\":0.1,\"y\":0.1,\"width\":0.8,\"height\":0.8}；四个字段都必须是 0 到 1 的数字。",
            "严格只返回这个 JSON 形状，不得增删或改名字段：{\"subjects\":[{\"canonicalTopicId\":\"coconut\",\"displayName\":\"椰子\",\"confidence\":0.95,\"boundingBox\":null,\"alternatives\":[\"椰果\"]}],\"sensitiveFlags\":[]}"
          ].join("\n")
        },
        { type: "image_url", image_url: { url: imageUrl } }
      ]
    }]);
    const parsed = photoUnderstandingSchema.safeParse(raw);
    if (!parsed.success) throw schemaError(raw, parsed.error.issues);
    return {
      subjects: parsed.data.subjects.map((subject) => ({ ...subject, sensitiveFlags: [] })),
      sensitiveFlags: parsed.data.sensitiveFlags
    };
  }

  async verifyKnowledgeCandidate(input: {
    image: Buffer;
    imageUrl?: string;
    objectName: string;
    photoApplicability: "category" | "visible_subtype" | "visible_feature" | "visible_state";
    factText: string;
    cardTitle: string;
    cardBody: string;
  }): Promise<{ accepted: boolean; imageObject: string; reason: string }> {
    const imageUrl = input.imageUrl ?? `data:image/jpeg;base64,${input.image.toString("base64")}`;
    const raw = await callQwen(this.options, [{
      role: "user",
      content: [
        {
          type: "text",
          text: [
            "你是独立的照片知识卡发布核验员。先完全忽略候选文字，只看图片，写出清晰可见、占据显著面积或明确焦点的具体主体；然后才核对候选。不得沿用前一个模型的识别，也不得为了让卡片通过而把相似植物、相似工具或背景小物件解释成候选对象。",
            "objectMatchesImage 只有在图片主体与 objectName 是同一种具体物件时才为 true；同属一个大类不够，例如龙舌兰、苏铁、棕榈和藤蔓不能互相替代。objectIsPrimarySubject 只有该对象清楚且显著时才为 true。",
            "photoApplicability=category 时，确认主体类别即可；visible_subtype 要能确认事实适用的具体子类型；visible_feature 要能看清事实所需部件或结构；visible_state 要能看清事实所需状态。无法确认时 factAppliesToImage 必须为 false。历史事实可由清楚的现代同类物件触发。",
            "titleGrounded 和 bodyGrounded 只检查是否忠于 factText，不得新增对象、部件、因果、时间或绝对范围。accepted 只有 objectMatchesImage、objectIsPrimarySubject、factAppliesToImage、titleGrounded、bodyGrounded 全部为 true 时才可为 true。",
            "严格只返回 JSON：{\"accepted\":false,\"imageObject\":\"图片主体\",\"objectMatchesImage\":false,\"objectIsPrimarySubject\":true,\"factAppliesToImage\":false,\"titleGrounded\":true,\"bodyGrounded\":true,\"reason\":\"不超过40字\"}。",
            `objectName：${input.objectName}`,
            `photoApplicability：${input.photoApplicability}`,
            `factText：${input.factText}`,
            `cardTitle：${input.cardTitle}`,
            `cardBody：${input.cardBody}`
          ].join("\n")
        },
        { type: "image_url", image_url: { url: imageUrl } }
      ]
    }]);
    const parsed = knowledgeCandidateVerificationSchema.safeParse(raw);
    if (!parsed.success) throw schemaError(raw, parsed.error.issues);
    // Category facts only need the photographed object itself to match. The
    // model often interprets `factAppliesToImage` as "the mechanism is visible"
    // even though category-level facts deliberately do not require that.
    const applicabilityPassed = input.photoApplicability === "category"
      ? true
      : parsed.data.factAppliesToImage;
    const accepted = parsed.data.objectMatchesImage &&
      parsed.data.objectIsPrimarySubject && applicabilityPassed &&
      parsed.data.titleGrounded && parsed.data.bodyGrounded;
    return { accepted, imageObject: parsed.data.imageObject, reason: parsed.data.reason };
  }
}

const knowledgeCandidateVerificationSchema = z.object({
  accepted: z.boolean(),
  imageObject: z.string().trim().min(1).max(80),
  objectMatchesImage: z.boolean(),
  objectIsPrimarySubject: z.boolean(),
  factAppliesToImage: z.boolean(),
  titleGrounded: z.boolean(),
  bodyGrounded: z.boolean(),
  reason: z.string().trim().min(1).max(160)
}).strict();

export class QwenDailyKnowledgeRanker implements DailyKnowledgeRanker {
  constructor(private readonly options: QwenOptions) {}

  async select(cards: KnowledgeCard[], topicPreferences: readonly TopicPreference[] = []): Promise<{ cardId: string; reason: string }> {
    invariant(cards.length >= 2 && cards.length <= 3, "invalid_daily_candidates", "每日候选数量无效", 400);
    const preferenceByTopic = new Map(topicPreferences.map((preference) => [preference.topicId, preference.weight / 10]));
    const candidates = cards.map((card) => ({
      cardId: card.cardId,
      objectName: card.detectedObjectName,
      title: card.title,
      fact: card.body,
      preferenceScore: preferenceByTopic.get(card.topicId) ?? 0
    }));
    const raw = await callQwen(this.options, [{
      role: "user",
      content: [
        "你是日常知识卡编辑。请从候选中选出今天最值得展示的一条。优先具体、反直觉、能从熟悉物件看到新角度的知识；避免只因对象罕见而选择，也不要添加候选之外的事实。preferenceScore 来自用户对同类知识的历史反馈，正数偏喜欢、负数偏不喜欢；只在质量接近时作为破平局依据，不能让低质量内容获胜。",
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
    try {
      const first = await this.primary.detect(input);
      return first.sensitiveFlags.length > 0 || first.confidence >= this.threshold ? first : this.fallback.detect(input);
    } catch {
      return this.fallback.detect(input);
    }
  }

  async understand(input: {
    image: Buffer;
    imageUrl?: string;
    localLabels: string[];
    preferredTopics?: string[];
  }): Promise<PhotoUnderstanding> {
    let first: PhotoUnderstanding;
    try {
      first = this.primary.understand
        ? await this.primary.understand(input)
        : understandingFromEntity(await this.primary.detect(input));
    } catch {
      return this.fallback.understand
        ? this.fallback.understand(input)
        : understandingFromEntity(await this.fallback.detect(input));
    }
    const strongestConfidence = Math.max(0, ...first.subjects.map((subject) => subject.confidence));
    if (first.sensitiveFlags.length > 0 || strongestConfidence >= this.threshold) return first;
    return this.fallback.understand
      ? this.fallback.understand(input)
      : understandingFromEntity(await this.fallback.detect(input));
  }

  async verifyKnowledgeCandidate(input: {
    image: Buffer;
    imageUrl?: string;
    objectName: string;
    photoApplicability: "category" | "visible_subtype" | "visible_feature" | "visible_state";
    factText: string;
    cardTitle: string;
    cardBody: string;
  }): Promise<{ accepted: boolean; imageObject: string; reason: string }> {
    if (this.primary.verifyKnowledgeCandidate) {
      try {
        return await this.primary.verifyKnowledgeCandidate(input);
      } catch {
        if (this.fallback.verifyKnowledgeCandidate) {
          return this.fallback.verifyKnowledgeCandidate(input);
        }
        throw new AppError("vision_provider_unavailable", "视觉服务暂时不可用", 502);
      }
    }
    if (this.fallback.verifyKnowledgeCandidate) {
      return this.fallback.verifyKnowledgeCandidate(input);
    }
    return { accepted: false, imageObject: "无法核验", reason: "没有可用的独立图文核验器" };
  }
}

function understandingFromEntity(entity: DetectedEntity): PhotoUnderstanding {
  return {
    subjects: entity.sensitiveFlags.length > 0 ? [] : [{ ...entity, sensitiveFlags: [] }],
    sensitiveFlags: entity.sensitiveFlags
  };
}
