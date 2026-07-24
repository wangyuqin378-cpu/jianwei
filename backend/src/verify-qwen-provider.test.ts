import { describe, expect, it } from "vitest";
import { parseBailianCredentialsCsv, parseVerificationArguments } from "./verify-qwen-provider.js";

describe("Qwen provider verification inputs", () => {
  it("loads the pay-as-you-go key and compatible endpoint without changing them", () => {
    const credentials = parseBailianCredentialsCsv([
      "\uFEFFid,12345",
      `apiKey,sk-ws${"a".repeat(80)}`,
      "openAiCompatible,https://workspace-123.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"
    ].join("\n"));

    expect(credentials.apiKey).toBe(`sk-ws${"a".repeat(80)}`);
    expect(credentials.openAiCompatible).toBe(
      "https://workspace-123.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"
    );
  });

  it("refuses subscription keys and missing image authorization", () => {
    expect(() => parseBailianCredentialsCsv([
      "apiKey,sk-sp-subscription",
      "openAiCompatible,https://workspace-123.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"
    ].join("\n"))).toThrow(/pay-as-you-go/);

    expect(() => parseVerificationArguments([
      "--credentials-file", "credentials.csv",
      "--image", "fixture.jpg"
    ])).toThrow(/confirm-authorized-image/);
  });
});
