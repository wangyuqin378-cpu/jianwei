import { readFile } from "node:fs/promises";
import { loadConfig } from "./config.js";
import { isMainModule } from "./main-module.js";
import {
  QwenCardWriter,
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
  }).detect({ image, localLabels: [] });
  const draft = await new QwenCardWriter({
    apiKey: credentials.apiKey,
    model: config.qwenFlashModel,
    baseUrl: config.dashscopeBaseUrl,
    additionalDataInspection
  }).write({
    entity: {
      canonicalTopicId: "broom",
      displayName: "扫帚",
      confidence: 0.95,
      boundingBox: null,
      alternatives: [],
      sensitiveFlags: []
    },
    fact: {
      factId: "provider-smoke-broom",
      topicId: "broom",
      factText: "扫帚刷毛的倾斜排列能让边缘更容易贴近墙角，也减少清扫时反复调整手腕的次数。",
      sourceIds: ["provider-smoke-source"],
      riskLevel: "general",
      reviewStatus: "approved"
    },
    sources: [{
      sourceId: "provider-smoke-source",
      title: "Provider smoke source",
      url: "https://example.com/provider-smoke",
      publisher: "Jianwei verification",
      authority: "reference"
    }],
    personalContext: "仅用于验证受约束标题生成"
  });
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
    titleWriter: {
      title: draft.title,
      factIdPreserved: draft.factId === "provider-smoke-broom",
      sourceIdsPreserved: draft.sourceIds.length === 1 && draft.sourceIds[0] === "provider-smoke-source"
    }
  }, null, 2)}\n`);
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
        modelAccessWithoutOptionalGuardrail: accessProbe
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
    stage: error.stage,
    receivedKeys: error.receivedKeys,
    issues: error.issues
  })}\n`);
}

function safeDiagnosticCode(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(value) ? value : null;
}
