import { describe, expect, it } from "vitest";
import { completeAnalysisJobSchema, selectDailyCardSchema } from "./schemas.js";

describe("completeAnalysisJobSchema", () => {
  it("defaults old clients to managed model access", () => {
    expect(completeAnalysisJobSchema.parse({})).toEqual({ modelAccess: { mode: "managed" } });
  });

  it("accepts only a bounded Qwen BYOK credential", () => {
    const access = {
      modelAccess: {
        mode: "user_key" as const,
        provider: "qwen" as const,
        apiKey: "sk-test_12345678901234567890"
      }
    };
    expect(completeAnalysisJobSchema.parse(access)).toEqual(access);
    expect(() => completeAnalysisJobSchema.parse({
      modelAccess: { mode: "user_key", provider: "kimi", apiKey: access.modelAccess.apiKey }
    })).toThrow();
    expect(() => completeAnalysisJobSchema.parse({
      modelAccess: { mode: "user_key", provider: "qwen", apiKey: "not-a-key" }
    })).toThrow();
  });

  it("requires two or three unique daily candidates", () => {
    const ids = [
      "126820f9-8f55-4f30-888c-d5baab090b52",
      "7f684985-7f7a-49b5-8f02-2a893f875fee"
    ];
    expect(selectDailyCardSchema.parse({ cardIds: ids })).toEqual({
      cardIds: ids,
      modelAccess: { mode: "managed" }
    });
    expect(() => selectDailyCardSchema.parse({ cardIds: [ids[0]] })).toThrow();
    expect(() => selectDailyCardSchema.parse({ cardIds: [ids[0], ids[0]] })).toThrow();
  });
});
