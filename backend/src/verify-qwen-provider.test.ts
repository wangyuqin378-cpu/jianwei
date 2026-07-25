import { describe, expect, it } from "vitest";
import {
  assertMetadataFreeJpeg,
  assertVerificationReportIsSecretFree,
  classifyVerificationFailure,
  parseBailianCredentialsCsv,
  parseVerificationArguments,
  stripJpegMetadata
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

  it("accepts pnpm argument separators and strips JPEG metadata before verification", () => {
    expect(parseVerificationArguments([
      "--",
      "--credentials-file", "credentials.csv",
      "--image", "fixture.jpg",
      "--output", "provider-report.json",
      "--confirm-authorized-image"
    ])).toEqual({
      credentialsFile: "credentials.csv",
      imageFile: "fixture.jpg",
      authorizedImageConfirmed: true,
      outputFile: "provider-report.json"
    });

    expect(parseVerificationArguments([
      "--credentials-file", "credentials.csv",
      "--image", "fixture.jpg",
      "--output", "provider-report.json",
      "--confirm-authorized-image"
    ])).toMatchObject({ outputFile: "provider-report.json" });

    expect(() => parseVerificationArguments([
      "--credentials-file", "credentials.csv",
      "--image", "fixture.jpg",
      "--confirm-authorized-image"
    ])).toThrow(/--output is required/);

    const clean = Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9]);
    expect(() => assertMetadataFreeJpeg(clean)).not.toThrow();
    const withExif = Buffer.from([
      0xff, 0xd8,
      0xff, 0xe1, 0x00, 0x04, 0x45, 0x78,
      0xff, 0xda, 0x00, 0x02,
      0xff, 0xd9
    ]);
    expect(() => assertMetadataFreeJpeg(withExif)).toThrow(/metadata segments/);
    const stripped = stripJpegMetadata(withExif);
    expect(stripped).toEqual(clean);
    expect(() => assertMetadataFreeJpeg(stripped)).not.toThrow();
    expect(() => stripJpegMetadata(Buffer.concat([clean, Buffer.from([0x00])]))).toThrow(/complete JPEG/);
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

  it("refuses to emit credentials, workspace endpoints, or local input paths", () => {
    const report = {
      providerGate: "NO_GO",
      provider: "qwen",
      model: "fixed-model",
      fixture: { sanitizedSha256: "a".repeat(64) }
    };
    expect(() => assertVerificationReportIsSecretFree(report, [
      `sk-ws${"a".repeat(80)}`,
      "https://workspace-123.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
      "/private/credentials.csv",
      "/private/fixture.jpg"
    ])).not.toThrow();
    expect(() => assertVerificationReportIsSecretFree(
      { ...report, accidentalLeak: "/private/credentials.csv" },
      ["/private/credentials.csv"]
    )).toThrow(/forbidden credential, endpoint, or local path/);
  });
});
