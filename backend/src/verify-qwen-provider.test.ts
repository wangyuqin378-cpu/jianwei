import { describe, expect, it } from "vitest";
import {
  classifyVerificationFailure,
  parseBailianCredentialsCsv,
  parseVerificationArguments
} from "./verify-qwen-provider.js";

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

  it("distinguishes missing AI Safety Guardrails authorization from model access failure", () => {
    expect(classifyVerificationFailure(
      403,
      "access_denied",
      { status: 200, code: null }
    )).toEqual({
      failureKind: "ai_safety_guardrails_not_authorized",
      productionReady: false,
      requiredInspectionHeader: '{"input":"cip","output":"cip"}',
      requiredServiceLinkedRole: "AliyunServiceRoleForSFMAccessingCIP",
      nextAction:
        "Use the Alibaba Cloud primary account to enable pay-as-you-go AI Safety Guardrails, authorize Bailian content safety for this workspace, then rerun this verifier."
    });

    expect(classifyVerificationFailure(
      403,
      "access_denied",
      { status: 401, code: "invalid_api_key" }
    )).toMatchObject({
      failureKind: "qwen_provider_request_failed",
      productionReady: false
    });
  });
});
