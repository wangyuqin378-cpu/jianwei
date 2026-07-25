import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import {
  parseBailianCredentialsCsv,
  type BailianCredentials
} from "./bailian-credentials.js";
import { loadConfig } from "./config.js";
import { isMainModule } from "./main-module.js";
import {
  QwenProviderError,
  QwenSchemaError,
  QwenVisionProvider
} from "./providers/qwen-providers.js";

export { parseBailianCredentialsCsv } from "./bailian-credentials.js";

interface VerificationArguments {
  credentialsFile: string;
  imageFile: string;
  authorizedImageConfirmed: boolean;
  outputFile: string;
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

interface PreparedVerification {
  credentials: BailianCredentials;
  image: Buffer;
  model: string;
  baseUrl: string;
  fixture: {
    sanitizedSha256: string;
    sanitizedBytes: number;
    metadataRemoved: boolean;
  };
}

interface DetectionResult {
  elapsedMs: number;
  detection: {
    canonicalTopicId: string;
    displayName: string;
    confidence: number;
    sensitiveFlags: string[];
  };
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

export function parseVerificationArguments(args: string[]): VerificationArguments {
  let credentialsFile = "";
  let imageFile = "";
  let authorizedImageConfirmed = false;
  let outputFile = "";
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") continue;
    if (argument === "--credentials-file") credentialsFile = args[++index] ?? "";
    else if (argument === "--image") imageFile = args[++index] ?? "";
    else if (argument === "--output") outputFile = args[++index] ?? "";
    else if (argument === "--confirm-authorized-image") authorizedImageConfirmed = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!credentialsFile) throw new Error("--credentials-file is required");
  if (!imageFile) throw new Error("--image is required");
  if (!authorizedImageConfirmed) {
    throw new Error("--confirm-authorized-image is required before sending image bytes to Qwen");
  }
  if (!outputFile) throw new Error("--output is required and must name a new private report file");
  return { credentialsFile, imageFile, authorizedImageConfirmed, outputFile };
}

async function prepareVerification(args: VerificationArguments): Promise<PreparedVerification> {
  const credentials = parseBailianCredentialsCsv(await readFile(args.credentialsFile, "utf8"));
  const originalImage = await readFile(args.imageFile);
  if (originalImage.length < 4 || originalImage.length > 5 * 1024 * 1024 ||
      originalImage[0] !== 0xff || originalImage[1] !== 0xd8) {
    throw new Error("Smoke verification requires a JPEG image no larger than 5 MiB");
  }
  const image = stripJpegMetadata(originalImage);
  assertMetadataFreeJpeg(image);
  const config = loadConfig({
    NODE_ENV: "development",
    VISION_PROVIDER: "qwen",
    DASHSCOPE_API_KEY: credentials.apiKey,
    DASHSCOPE_BASE_URL: credentials.openAiCompatible,
    WORST_CASE_COST_MICRO_CNY_PER_JOB: "1000000",
    MAX_GLOBAL_COST_MICRO_CNY_PER_DAY: "2000000000",
    MAX_GLOBAL_COST_MICRO_CNY_PER_MONTH: "50000000000"
  });
  return {
    credentials,
    image,
    model: config.qwenFlashModel,
    baseUrl: config.dashscopeBaseUrl,
    fixture: {
      sanitizedSha256: createHash("sha256").update(image).digest("hex"),
      sanitizedBytes: image.length,
      metadataRemoved: !originalImage.equals(image)
    }
  };
}

async function verifyQwenProvider(
  prepared: PreparedVerification,
  additionalDataInspection: "required" | "omit-for-local-verification" = "required"
): Promise<DetectionResult> {
  const startedAt = Date.now();
  const entity = await new QwenVisionProvider({
    apiKey: prepared.credentials.apiKey,
    model: prepared.model,
    baseUrl: prepared.baseUrl,
    additionalDataInspection
  }).detect({ image: prepared.image, localLabels: [] });
  return {
    elapsedMs: Date.now() - startedAt,
    detection: {
      canonicalTopicId: entity.canonicalTopicId,
      displayName: entity.displayName,
      confidence: entity.confidence,
      sensitiveFlags: entity.sensitiveFlags
    }
  };
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
  prepared: PreparedVerification
): Promise<AccessProbeResult> {
  const response = await fetch(`${prepared.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${prepared.credentials.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: prepared.model,
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

if (isMainModule(import.meta.url)) {
  const args = parseVerificationArguments(process.argv.slice(2));
  const prepared = await prepareVerification(args);
  try {
    const guarded = await verifyQwenProvider(prepared);
    await emitVerificationReport(args, prepared, {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      releaseEvidence: false,
      providerGate: "GO",
      provider: "qwen",
      endpointRegion: "cn-beijing",
      model: prepared.model,
      guardrailRequired: true,
      fixture: prepared.fixture,
      guardedRequest: { status: "passed", ...guarded },
      modelAccessWithoutOptionalGuardrail: null,
      localDiagnosticFallback: null,
      diagnostic: null,
      requestCounts: {
        guardedVision: 1,
        modelAccessProbe: 0,
        unguardedVision: 0,
        total: 1
      },
      modelCallsPerCard: 1,
      cardTitlePolicy: "deterministic_server_side"
    });
  } catch (error) {
    if (error instanceof QwenProviderError) {
      const accessProbe = await probeModelAccessWithoutOptionalGuardrail(prepared).catch(() => null);
      let localDiagnosticFallback: Record<string, unknown> | null = null;
      let unguardedVisionRequests = 0;
      if (error.upstreamStatus === 403 && error.upstreamCode === "access_denied" && accessProbe?.status === 200) {
        unguardedVisionRequests = 1;
        try {
          const fallback = await verifyQwenProvider(prepared, "omit-for-local-verification");
          localDiagnosticFallback = { status: "passed", ...fallback };
        } catch (fallbackError) {
          if (fallbackError instanceof QwenSchemaError) {
            localDiagnosticFallback = schemaDiagnostic(fallbackError);
          } else {
            throw fallbackError;
          }
        }
      }
      await emitVerificationReport(args, prepared, {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        releaseEvidence: false,
        providerGate: "NO_GO",
        provider: "qwen",
        endpointRegion: "cn-beijing",
        model: prepared.model,
        guardrailRequired: true,
        fixture: prepared.fixture,
        guardedRequest: {
          status: "failed",
          upstreamStatus: error.upstreamStatus,
          upstreamCode: error.upstreamCode
        },
        modelAccessWithoutOptionalGuardrail: accessProbe,
        localDiagnosticFallback,
        diagnostic: classifyVerificationFailure(error.upstreamStatus, error.upstreamCode, accessProbe),
        requestCounts: {
          guardedVision: 1,
          modelAccessProbe: 1,
          unguardedVision: unguardedVisionRequests,
          total: 2 + unguardedVisionRequests
        },
        modelCallsPerCard: 1,
        cardTitlePolicy: "deterministic_server_side"
      });
      process.exitCode = 1;
    } else if (error instanceof QwenSchemaError) {
      await emitVerificationReport(args, prepared, {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        releaseEvidence: false,
        providerGate: "NO_GO",
        provider: "qwen",
        endpointRegion: "cn-beijing",
        model: prepared.model,
        guardrailRequired: true,
        fixture: prepared.fixture,
        guardedRequest: schemaDiagnostic(error),
        modelAccessWithoutOptionalGuardrail: null,
        localDiagnosticFallback: null,
        diagnostic: {
          failureKind: "qwen_schema_failed",
          productionReady: false,
          nextAction: "Inspect the schema issues and keep the production provider failed closed."
        },
        requestCounts: {
          guardedVision: 1,
          modelAccessProbe: 0,
          unguardedVision: 0,
          total: 1
        },
        modelCallsPerCard: 1,
        cardTitlePolicy: "deterministic_server_side"
      });
      process.exitCode = 1;
    } else {
      throw error;
    }
  }
}

function schemaDiagnostic(error: QwenSchemaError): Record<string, unknown> {
  return {
    status: "schema_failed",
    receivedKeys: error.receivedKeys,
    issues: error.issues
  };
}

export function assertVerificationReportIsSecretFree(
  report: unknown,
  forbiddenValues: string[]
): void {
  const rendered = JSON.stringify(report);
  for (const value of forbiddenValues) {
    if (value && rendered.includes(value)) {
      throw new Error("Qwen verification report contains a forbidden credential, endpoint, or local path");
    }
  }
}

async function emitVerificationReport(
  args: VerificationArguments,
  prepared: PreparedVerification,
  report: Record<string, unknown>
): Promise<void> {
  assertVerificationReportIsSecretFree(report, [
    prepared.credentials.apiKey,
    prepared.credentials.openAiCompatible,
    args.credentialsFile,
    args.imageFile
  ]);
  const rendered = `${JSON.stringify(report, null, 2)}\n`;
  await writeFile(args.outputFile, rendered, { encoding: "utf8", mode: 0o600, flag: "wx" });
  process.stdout.write(rendered);
}

function safeDiagnosticCode(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(value) ? value : null;
}
