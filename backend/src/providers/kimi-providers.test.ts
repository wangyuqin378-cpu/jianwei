import { describe, expect, it } from "vitest";
import { KimiCardWriter, KimiVisionProvider } from "./kimi-providers.js";

function entity(content: Record<string, unknown>, finishReason = "stop") {
  return JSON.stringify({ choices: [{ finish_reason: finishReason, message: { content: JSON.stringify(content) } }] });
}

describe("Kimi provider contract", () => {
  it("uses bounded multimodal JSON requests without redirects", async () => {
    let requestUrl = "";
    let requestBody = "";
    let redirect: RequestRedirect | undefined;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input);
      requestBody = String(init?.body ?? "");
      redirect = init?.redirect;
      return new Response(entity({
        canonicalTopicId: "bicycle",
        displayName: "自行车",
        confidence: 0.99,
        boundingBox: null,
        alternatives: [],
        sensitiveFlags: []
      }), { status: 200 });
    }) as typeof fetch;
    const provider = new KimiVisionProvider({
      apiKey: "test-only",
      model: "kimi-k3",
      baseUrl: "https://api.moonshot.cn/v1",
      fetchImpl
    });

    await expect(provider.detect({ image: Buffer.from([0xff, 0xd8, 0xff]), localLabels: ["Bicycle"] }))
      .resolves.toMatchObject({ canonicalTopicId: "bicycle", displayName: "自行车" });
    expect(requestUrl).toBe("https://api.moonshot.cn/v1/chat/completions");
    expect(redirect).toBe("error");
    expect(requestBody).toContain("data:image/jpeg;base64,");
    expect(requestBody).toContain('"reasoning_effort":"low"');
    expect(requestBody).toContain('"max_completion_tokens":800');
    expect(requestBody).toContain('"type":"json_schema"');
    expect(requestBody).toContain('"additionalProperties":false');
    expect(requestBody).not.toContain("test-only");
  });

  it("fails closed on unknown privacy flags and truncated output", async () => {
    const unknownFlag = (async () => new Response(entity({
      canonicalTopicId: "broom",
      displayName: "扫帚",
      confidence: 0.9,
      boundingBox: null,
      alternatives: [],
      sensitiveFlags: ["invented_flag"]
    }), { status: 200 })) as typeof fetch;
    await expect(new KimiVisionProvider({ apiKey: "test", model: "kimi-k3", fetchImpl: unknownFlag })
      .detect({ image: Buffer.from([0xff, 0xd8, 0xff]), localLabels: [] }))
      .rejects.toMatchObject({ code: "invalid_model_schema", statusCode: 502 });

    const truncated = (async () => new Response(entity({}, "length"), { status: 200 })) as typeof fetch;
    await expect(new KimiVisionProvider({ apiKey: "test", model: "kimi-k3", fetchImpl: truncated })
      .detect({ image: Buffer.from([0xff, 0xd8, 0xff]), localLabels: [] }))
      .rejects.toMatchObject({ code: "incomplete_model_response", statusCode: 502 });
  });

  it("does not expose upstream failures", async () => {
    const fetchImpl = (async () => { throw new Error("secret request detail"); }) as typeof fetch;
    await expect(new KimiVisionProvider({ apiKey: "test", model: "kimi-k3", fetchImpl })
      .detect({ image: Buffer.from([0xff, 0xd8, 0xff]), localLabels: [] }))
      .rejects.toMatchObject({ code: "vision_provider_unavailable", message: "视觉服务暂时不可用" });
  });

  it("keeps reviewed fact and source identifiers immutable", async () => {
    const fetchImpl = (async () => new Response(entity({
      title: "扫帚的设计细节",
      factId: "broom-001",
      sourceIds: ["source-one"]
    }), { status: 200 })) as typeof fetch;
    const writer = new KimiCardWriter({ apiKey: "test", model: "kimi-k3", fetchImpl });
    await expect(writer.write({
      entity: { canonicalTopicId: "broom", displayName: "扫帚", confidence: 0.9, boundingBox: null, alternatives: [], sensitiveFlags: [] },
      fact: { factId: "broom-001", topicId: "broom", factText: "人工审核事实", sourceIds: ["source-one"], riskLevel: "general", reviewStatus: "approved" },
      sources: [{ sourceId: "source-one", title: "Source", url: "https://example.com", publisher: "Example", authority: "reference" }],
      personalContext: "测试"
    })).resolves.toEqual({ title: "扫帚的设计细节", factId: "broom-001", sourceIds: ["source-one"] });
  });
});
