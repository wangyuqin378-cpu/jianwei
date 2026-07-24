import { describe, expect, it } from "vitest";
import { QwenProviderError, QwenVisionProvider } from "./qwen-providers.js";

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
