import { readFile } from "node:fs/promises";
import { loadConfig } from "./config.js";
import { isMainModule } from "./main-module.js";
import {
  QwenProviderError,
  QwenSchemaError,
  QwenVisionProvider
} from "./providers/qwen-providers.js";

interface BailianCredentials {
  apiKey: string;
  openAiCompatible: string;
}

interface VerificationArguments {
  credentialsFile: string;
  imageFile: string;
  authorizedImageConfirmed: boolean;
}

interface AccessProbeResult {
  status: number;
  code: string | null;
}

interface VerificationFailureDiagnostic {
  failureKind: "ai_safety_guardrails_not_authorized" | "qwen_provider_request_failed";
  productionReady: false;
  requiredInspectionHeader: string;
  requiredServiceLinkedRole?: string;
  nextAction: string;
}

export function classifyVerificationFailure(
  upstreamStatus: number,
  upstreamCode: string | null,
  accessProbe: AccessProbeResult | null
): VerificationFailureDiagnostic {
  const common = {
    productionReady: false as const,
    requiredInspectionHeader: '{"input":"cip","output":"cip"}'
  };
  if (upstreamStatus === 403 && upstreamCode === "access_denied" && accessProbe?.status === 200) {
    return {
      ...common,
      failureKind: "ai_safety_guardrails_not_authorized",
      requiredServiceLinkedRole: "AliyunServiceRoleForSFMAccessingCIP",
      nextAction:
        "Use the Alibaba Cloud primary account to enable pay-as-you-go AI Safety Guardrails, authorize Bailian content safety for this workspace, then rerun this verifier."
    };
  }
  return {
    ...common,
    failureKind: "qwen_provider_request_failed",
    nextAction:
      "Check the workspace endpoint, pay-as-you-go API key, fixed model access, account balance, and provider service status before rerunning this verifier."
  };
}

export function parseBailianCredentialsCsv(source: string): BailianCredentials {
  const rows = new Map<string, string>();
  for (const [index, rawLine] of source.split(/\r?\n/).entries()) {
    if (!rawLine.trim()) continue;
    const comma = rawLine.indexOf(",");
    if (comma <= 0) throw new Error(`Invalid credential CSV row ${index + 1}`);
    const key = unquote(rawLine.slice(0, comma).replace(/^\uFEFF/, "").trim());
    const value = unquote(rawLine.slice(comma + 1).trim());
    rows.set(key, value);
  }
  const apiKey = rows.get("apiKey")?.trim() ?? "";
  const openAiCompatible = rows.get("openAiCompatible")?.trim() ?? "";
  if (!apiKey.startsWith("sk-ws") || apiKey.length < 40) {
    throw new Error("Credential CSV does not contain a Model Studio pay-as-you-go API key");
  }
  if (!openAiCompatible) throw new Error("Credential CSV does not contain an OpenAI-compatible endpoint");
  return { apiKey, openAiCompatible };
}

export function parseVerificationArguments(args: string[]): VerificationArguments {
  let credentialsFile = "";
  let imageFile = "";
  let authorizedImageConfirmed = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") continue;
    if (argument === "--credentials-file") credentialsFile = args[++index] ?? "";
    else if (argument === "--image") imageFile = args[++index] ?? "";
    else if (argument === "--confirm-authorized-image") authorizedImageConfirmed = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!credentialsFile) throw new Error("--credentials-file is required");
  if (!imageFile) throw new Error("--image is required");
  if (!authorizedImageConfirmed) {
    throw new Error("--confirm-authorized-image is required before sending image bytes to Qwen");
  }
  return { credentialsFile, imageFile, authorizedImageConfirmed };
}

async function verifyQwenProvider(
  args: VerificationArguments,
  additionalDataInspection: "required" | "omit-for-local-verification" = "required"
): Promise<void> {
  const credentials = parseBailianCredentialsCsv(await readFile(args.credentialsFile, "utf8"));
  const image = await readFile(args.imageFile);
  if (image.length < 4 || image.length > 5 * 1024 * 1024 || image[0] !== 0xff || image[1] !== 0xd8) {
    throw new Error("Smoke verification requires a JPEG image no larger than 5 MiB");
  }
  const sanitizedImage = stripJpegMetadata(image);
  assertMetadataFreeJpeg(sanitizedImage);
  const config = loadConfig({
    NODE_ENV: "development",
    VISION_PROVIDER: "qwen",
    DASHSCOPE_API_KEY: credentials.apiKey,
    DASHSCOPE_BASE_URL: credentials.openAiCompatible,
    WORST_CASE_COST_MICRO_CNY_PER_JOB: "1000000",
    MAX_GLOBAL_COST_MICRO_CNY_PER_DAY: "2000000000",
    MAX_GLOBAL_COST_MICRO_CNY_PER_MONTH: "50000000000"
  });
  const startedAt = Date.now();
  const entity = await new QwenVisionProvider({
    apiKey: credentials.apiKey,
    model: config.qwenFlashModel,
    baseUrl: config.dashscopeBaseUrl,
    additionalDataInspection
  }).detect({ image: sanitizedImage, localLabels: [] });
  process.stdout.write(`${JSON.stringify({
    provider: "qwen",
    endpointRegion: "cn-beijing",
    model: config.qwenFlashModel,
    additionalDataInspection,
    elapsedMs: Date.now() - startedAt,
    detection: {
      canonicalTopicId: entity.canonicalTopicId,
      displayName: entity.displayName,
      confidence: entity.confidence,
      sensitiveFlags: entity.sensitiveFlags
    },
    modelCallsPerCard: 1,
    cardTitlePolicy: "deterministic_server_side"
  }, null, 2)}\n`);
}

export function stripJpegMetadata(bytes: Buffer): Buffer {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 ||
      bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
    throw new Error("Smoke verification requires a complete JPEG");
  }
  const chunks: Buffer[] = [bytes.subarray(0, 2)];
  let offset = 2;
  while (offset < bytes.length) {
    const markerStart = offset;
    if (bytes[offset] !== 0xff) throw new Error("Smoke verification JPEG marker is malformed");
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) throw new Error("Smoke verification JPEG is truncated");
    const marker = bytes[offset++]!;
    if (marker === 0xd9) {
      if (offset !== bytes.length) throw new Error("Smoke verification JPEG has trailing bytes");
      chunks.push(bytes.subarray(markerStart, offset));
      return Buffer.concat(chunks);
    }
    if (marker === 0xd8 || marker === 0x00) {
      throw new Error("Smoke verification JPEG contains an unexpected marker");
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      chunks.push(bytes.subarray(markerStart, offset));
      continue;
    }
    if (offset + 1 >= bytes.length) throw new Error("Smoke verification JPEG segment is truncated");
    const length = (bytes[offset]! << 8) | bytes[offset + 1]!;
    if (length < 2 || offset + length > bytes.length) {
      throw new Error("Smoke verification JPEG segment length is invalid");
    }
    const segmentEnd = offset + length;
    if (marker === 0xda) {
      chunks.push(bytes.subarray(markerStart, segmentEnd));
      chunks.push(bytes.subarray(segmentEnd));
      return Buffer.concat(chunks);
    }
    if (!((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe)) {
      chunks.push(bytes.subarray(markerStart, segmentEnd));
    }
    offset = segmentEnd;
  }
  throw new Error("Smoke verification JPEG has no end marker");
}

export function assertMetadataFreeJpeg(bytes: Buffer): void {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 ||
      bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
    throw new Error("Smoke verification requires a complete metadata-free JPEG");
  }
  let offset = 2;
  let inEntropyData = false;
  while (offset < bytes.length) {
    if (inEntropyData) {
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const markerStart = offset;
        while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
        if (offset >= bytes.length) throw new Error("Smoke verification JPEG is truncated");
        const marker = bytes[offset++]!;
        if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) continue;
        offset = markerStart;
        inEntropyData = false;
        break;
      }
      if (inEntropyData) throw new Error("Smoke verification JPEG has no end marker");
      continue;
    }
    if (bytes[offset] !== 0xff) throw new Error("Smoke verification JPEG marker is malformed");
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) throw new Error("Smoke verification JPEG is truncated");
    const marker = bytes[offset++]!;
    if (marker === 0xd9) {
      if (offset !== bytes.length) throw new Error("Smoke verification JPEG has trailing bytes");
      return;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 1 >= bytes.length) throw new Error("Smoke verification JPEG segment is truncated");
    const length = (bytes[offset]! << 8) | bytes[offset + 1]!;
    if (length < 2 || offset + length > bytes.length) {
      throw new Error("Smoke verification JPEG segment length is invalid");
    }
    if ((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe) {
      throw new Error("Smoke verification refuses JPEG metadata segments; sanitize the authorized fixture first");
    }
    offset += length;
    if (marker === 0xda) inEntropyData = true;
  }
  throw new Error("Smoke verification JPEG has no end marker");
}

async function probeModelAccessWithoutOptionalGuardrail(
  args: VerificationArguments
): Promise<AccessProbeResult> {
  const credentials = parseBailianCredentialsCsv(await readFile(args.credentialsFile, "utf8"));
  const config = loadConfig({
    NODE_ENV: "development",
    VISION_PROVIDER: "qwen",
    DASHSCOPE_API_KEY: credentials.apiKey,
    DASHSCOPE_BASE_URL: credentials.openAiCompatible,
    WORST_CASE_COST_MICRO_CNY_PER_JOB: "1000000",
    MAX_GLOBAL_COST_MICRO_CNY_PER_DAY: "2000000000",
    MAX_GLOBAL_COST_MICRO_CNY_PER_MONTH: "50000000000"
  });
  const response = await fetch(`${config.dashscopeBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${credentials.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.qwenFlashModel,
      messages: [{ role: "user", content: "只返回 JSON：{\"ok\":true}" }],
      enable_thinking: false,
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: 32
    }),
    redirect: "error",
    signal: AbortSignal.timeout(15_000)
  });
  const payload = await response.json().catch(() => ({})) as { error?: { code?: unknown } };
  return {
    status: response.status,
    code: safeDiagnosticCode(payload.error?.code)
  };
}

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith("\"") && value.endsWith("\"")) {
    return value.slice(1, -1).replace(/""/g, "\"");
  }
  return value;
}

if (isMainModule(import.meta.url)) {
  const args = parseVerificationArguments(process.argv.slice(2));
  try {
    await verifyQwenProvider(args);
  } catch (error) {
    if (error instanceof QwenProviderError) {
      const accessProbe = await probeModelAccessWithoutOptionalGuardrail(args).catch(() => null);
      if (error.upstreamStatus === 403 && error.upstreamCode === "access_denied" && accessProbe?.status === 200) {
        try {
          await verifyQwenProvider(args, "omit-for-local-verification");
        } catch (fallbackError) {
          if (fallbackError instanceof QwenSchemaError) {
            writeSchemaDiagnostic(fallbackError);
          } else {
            throw fallbackError;
          }
        }
      }
      process.stderr.write(`${JSON.stringify({
        provider: "qwen",
        verification: "failed",
        upstreamStatus: error.upstreamStatus,
        upstreamCode: error.upstreamCode,
        modelAccessWithoutOptionalGuardrail: accessProbe,
        diagnostic: classifyVerificationFailure(error.upstreamStatus, error.upstreamCode, accessProbe)
      })}\n`);
      process.exitCode = 1;
    } else if (error instanceof QwenSchemaError) {
      writeSchemaDiagnostic(error);
      process.exitCode = 1;
    } else {
      throw error;
    }
  }
}

function writeSchemaDiagnostic(error: QwenSchemaError): void {
  process.stderr.write(`${JSON.stringify({
    provider: "qwen",
    verification: "schema_failed",
    stage: "vision",
    receivedKeys: error.receivedKeys,
    issues: error.issues
  })}\n`);
}

function safeDiagnosticCode(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(value) ? value : null;
}
