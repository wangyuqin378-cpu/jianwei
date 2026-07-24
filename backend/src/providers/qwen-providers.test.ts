import { describe, expect, it } from "vitest";
import { QwenCardWriter, QwenProviderError, QwenVisionProvider } from "./qwen-providers.js";

describe("Qwen server-side image safety contract", () => {
  it("enables provider inspection and accepts only structured sensitive flags", async () => {
    let inspectionHeader: string | null = null;
    let requestBody = "";
    let requestUrl = "";
    let redirect: RequestRedirect | undefined;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input);
      redirect = init?.redirect;
      inspectionHeader = new Headers(init?.headers).get("X-DashScope-DataInspection");
      requestBody = String(init?.body ?? "");
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              canonicalTopicId: "unknown",
              displayName: "未确认物件",
              confidence: 0.1,
              boundingBox: null,
              alternatives: [],
              sensitiveFlags: ["identity_document"]
            })
          }
        }]
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    const provider = new QwenVisionProvider({
      apiKey: "test-only",
      model: "fixed-model",
      baseUrl: "https://workspace-123.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
      fetchImpl
    });

    const result = await provider.detect({ image: Buffer.from([0xff, 0xd8, 0xff]), localLabels: [] });

    expect(inspectionHeader).toContain("cip");
    expect(requestUrl).toBe("https://workspace-123.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions");
    expect(redirect).toBe("error");
    expect(requestBody).toContain("sensitiveFlags");
    expect(result.sensitiveFlags).toEqual(["identity_document"]);
  });

  it("fails closed on an unknown sensitive flag", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            canonicalTopicId: "broom",
            displayName: "扫帚",
            confidence: 0.9,
            boundingBox: null,
            alternatives: [],
            sensitiveFlags: ["invented_flag"]
          })
        }
      }]
    }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
    const provider = new QwenVisionProvider({ apiKey: "test-only", model: "fixed-model", fetchImpl });

    await expect(provider.detect({ image: Buffer.from([0xff, 0xd8, 0xff]), localLabels: [] })).rejects.toMatchObject({
      code: "invalid_model_schema",
      statusCode: 502
    });
  });

  it("allows only an explicit local verification call to omit the optional paid guardrail", async () => {
    let inspectionHeader: string | null = "not-called";
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      inspectionHeader = new Headers(init?.headers).get("X-DashScope-DataInspection");
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          canonicalTopicId: "broom",
          displayName: "扫帚",
          confidence: 0.9,
          boundingBox: null,
          alternatives: [],
          sensitiveFlags: []
        }) } }]
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    const provider = new QwenVisionProvider({
      apiKey: "test-only",
      model: "fixed-model",
      additionalDataInspection: "omit-for-local-verification",
      fetchImpl
    });

    await provider.detect({ image: Buffer.from([0xff, 0xd8, 0xff]), localLabels: [] });

    expect(inspectionHeader).toBeNull();
  });

  it("maps provider network failures to a bounded upstream error without leaking details", async () => {
    const fetchImpl = (async () => {
      throw new Error("request containing a secret failed");
    }) as typeof fetch;
    const provider = new QwenVisionProvider({ apiKey: "test-only", model: "fixed-model", fetchImpl });

    await expect(provider.detect({ image: Buffer.from([0xff, 0xd8, 0xff]), localLabels: [] })).rejects.toMatchObject({
      code: "vision_provider_unavailable",
      message: "视觉服务暂时不可用",
      statusCode: 502
    });
  });

  it("does not expose upstream provider error text to API callers", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({
      error: { message: "internal request details must stay private" }
    }), { status: 500, headers: { "Content-Type": "application/json" } })) as typeof fetch;
    const provider = new QwenVisionProvider({ apiKey: "test-only", model: "fixed-model", fetchImpl });

    await expect(provider.detect({ image: Buffer.from([0xff, 0xd8, 0xff]), localLabels: [] })).rejects.toMatchObject({
      code: "vision_provider_error",
      message: "视觉服务暂时不可用",
      statusCode: 502,
      upstreamStatus: 500,
      upstreamCode: null
    });
  });

  it("retains only a bounded upstream code for private operations diagnostics", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({
      error: { code: "Model.NotFound", message: "private provider details" }
    }), { status: 400, headers: { "Content-Type": "application/json" } })) as typeof fetch;
    const provider = new QwenVisionProvider({ apiKey: "test-only", model: "fixed-model", fetchImpl });

    const error = await provider.detect({ image: Buffer.from([0xff, 0xd8, 0xff]), localLabels: [] })
      .then(() => null, (reason: unknown) => reason);

    expect(error).toBeInstanceOf(QwenProviderError);
    expect(error).toMatchObject({
      code: "vision_provider_error",
      message: "视觉服务暂时不可用",
      upstreamStatus: 400,
      upstreamCode: "Model.NotFound"
    });
  });
});

describe("Qwen title-only card contract", () => {
  const input = {
    entity: {
      canonicalTopicId: "broom",
      displayName: "扫帚",
      confidence: 0.9,
      boundingBox: null,
      alternatives: [],
      sensitiveFlags: [] as []
    },
    fact: {
      factId: "broom-001",
      topicId: "broom",
      factText: "这是一条已经经过人工审核并且会由服务端原样发布的测试知识正文。",
      sourceIds: ["source-one"],
      riskLevel: "general" as const,
      reviewStatus: "approved" as const
    },
    sources: [{
      sourceId: "source-one",
      title: "Source",
      url: "https://example.com/source",
      publisher: "Example",
      authority: "reference" as const
    }],
    personalContext: "测试上下文"
  };

  it("accepts only a title plus unchanged fact and source identifiers", async () => {
    let requestBody = "";
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = String(init?.body ?? "");
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          title: "扫帚的设计细节",
          factId: "broom-001",
          sourceIds: ["source-one"]
        }) } }]
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    const writer = new QwenCardWriter({ apiKey: "test-only", model: "fixed-model", fetchImpl });
    await expect(writer.write(input)).resolves.toEqual({
      title: "扫帚的设计细节",
      factId: "broom-001",
      sourceIds: ["source-one"]
    });
    expect(requestBody).toContain('\\"sourceIds\\":[\\"source-one\\"]');
    expect(requestBody).toContain("不得增加其他字段");
  });

  it("rejects a model attempt to emit or rewrite the body", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        title: "扫帚的设计细节",
        body: "模型擅自生成的正文绝不能进入卡片。",
        factId: "broom-001",
        sourceIds: ["source-one"]
      }) } }]
    }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
    const writer = new QwenCardWriter({ apiKey: "test-only", model: "fixed-model", fetchImpl });
    await expect(writer.write(input)).rejects.toMatchObject({ code: "invalid_model_schema" });
  });
});
