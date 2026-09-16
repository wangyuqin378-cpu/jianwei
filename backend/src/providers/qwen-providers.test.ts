import { describe, expect, it } from "vitest";
import type { VisionProvider } from "../domain/types.js";
import { ConfidenceFallbackVisionProvider, QwenProviderError, QwenVisionProvider } from "./qwen-providers.js";

describe("Qwen server-side image safety contract", () => {
  it("returns up to three concrete knowledge anchors instead of one scene summary", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            subjects: [
              {
                canonicalTopicId: "coconut",
                displayName: "椰子",
                confidence: 0.96,
                boundingBox: null,
                alternatives: ["椰果"]
              },
              {
                canonicalTopicId: "floating_dock",
                displayName: "浮动码头",
                confidence: 0.86,
                boundingBox: null,
                alternatives: ["浮桥"]
              }
            ],
            sensitiveFlags: []
          })
        }
      }]
    }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
    const provider = new QwenVisionProvider({ apiKey: "test-only", model: "fixed-model", fetchImpl });

    const result = await provider.understand({
      image: Buffer.from([0xff, 0xd8, 0xff]),
      localLabels: [],
      preferredTopics: ["coconut=椰子"]
    });

    expect(result.subjects.map((subject) => subject.canonicalTopicId)).toEqual(["coconut", "floating_dock"]);
    expect(result.sensitiveFlags).toEqual([]);
  });

  it("rejects a knowledge card when the independently observed object does not match", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        accepted: false,
        imageObject: "龙舌兰和苏铁",
        objectMatchesImage: false,
        objectIsPrimarySubject: true,
        factAppliesToImage: false,
        titleGrounded: true,
        bodyGrounded: true,
        reason: "图片中没有清楚可见的藤蔓"
      }) } }]
    }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
    const provider = new QwenVisionProvider({ apiKey: "test-only", model: "fixed-model", fetchImpl });

    await expect(provider.verifyKnowledgeCandidate({
      image: Buffer.from([0xff, 0xd8, 0xff]),
      objectName: "藤蔓",
      photoApplicability: "category",
      factText: "藤本植物借助外物承重，从而减少自身支撑组织的投入。",
      cardTitle: "藤蔓借别人的骨架往上爬",
      cardBody: "藤本植物借助外物承重，从而减少自身支撑组织的投入。"
    })).resolves.toMatchObject({ accepted: false, imageObject: "龙舌兰和苏铁" });
  });

  it("accepts a category fact without requiring its hidden mechanism to be visible", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        accepted: false,
        imageObject: "楼梯旁清楚可见的藤蔓",
        objectMatchesImage: true,
        objectIsPrimarySubject: true,
        factAppliesToImage: false,
        titleGrounded: true,
        bodyGrounded: true,
        reason: "图片看不到藤蔓内部的支撑组织"
      }) } }]
    }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
    const provider = new QwenVisionProvider({ apiKey: "test-only", model: "fixed-model", fetchImpl });

    await expect(provider.verifyKnowledgeCandidate({
      image: Buffer.from([0xff, 0xd8, 0xff]),
      objectName: "藤蔓",
      photoApplicability: "category",
      factText: "藤本植物借助外物承重，从而减少自身支撑组织的投入。",
      cardTitle: "藤蔓借别人的骨架往上爬",
      cardBody: "藤本植物借助外物承重，从而减少自身支撑组织的投入。"
    })).resolves.toMatchObject({ accepted: true, imageObject: "楼梯旁清楚可见的藤蔓" });
  });

  it("uses the fallback provider when primary understanding fails", async () => {
    const primary: VisionProvider = {
      detect: async () => { throw new Error("primary failed"); },
      understand: async () => { throw new Error("primary failed"); }
    };
    const fallback: VisionProvider = {
      detect: async () => ({
        canonicalTopicId: "broom", displayName: "扫帚", confidence: 0.93,
        boundingBox: null, alternatives: [], sensitiveFlags: []
      }),
      understand: async () => ({
        subjects: [{
          canonicalTopicId: "broom", displayName: "扫帚", confidence: 0.93,
          boundingBox: null, alternatives: [], sensitiveFlags: []
        }],
        sensitiveFlags: []
      })
    };
    const provider = new ConfidenceFallbackVisionProvider(primary, fallback);

    await expect(provider.understand({ image: Buffer.from([0xff]), localLabels: [] }))
      .resolves.toMatchObject({ subjects: [{ canonicalTopicId: "broom" }] });
  });

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
    expect(requestBody).toContain("boundingBox 必须严格为 null");
    expect(requestBody).toContain("禁止使用 x1、y1、x2、y2");
    expect(JSON.parse(requestBody)).not.toHaveProperty("max_tokens");
    expect(JSON.parse(requestBody)).not.toHaveProperty("max_completion_tokens");
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
