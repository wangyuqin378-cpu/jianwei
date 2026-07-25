import { readFile } from "node:fs/promises";
import { parseBailianCredentialsCsv } from "./bailian-credentials.js";
import { loadConfig } from "./config.js";
import { isMainModule } from "./main-module.js";

const INSPECTION_HEADER = '{"input":"cip","output":"cip"}';

interface GuardrailAccessArguments {
  credentialsFile: string;
}

interface GuardrailProbeInput {
  apiKey: string;
  baseUrl: string;
  model: string;
  fetchImpl?: typeof fetch;
}

export interface GuardrailAccessResult {
  guardrailAccess: "GO" | "NO_GO";
  status: number;
  code: string | null;
}

export function parseGuardrailAccessArguments(args: string[]): GuardrailAccessArguments {
  let credentialsFile = "";
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") continue;
    if (argument === "--credentials-file") credentialsFile = args[++index] ?? "";
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!credentialsFile) throw new Error("--credentials-file is required");
  return { credentialsFile };
}

export async function probeQwenGuardrailAccess(input: GuardrailProbeInput): Promise<GuardrailAccessResult> {
  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(`${input.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
        "X-DashScope-DataInspection": INSPECTION_HEADER
      },
      body: JSON.stringify({
        model: input.model,
        messages: [{ role: "user", content: "只返回 JSON：{\"ok\":true}" }],
        enable_thinking: false,
        response_format: { type: "json_object" },
        temperature: 0,
        max_tokens: 32
      }),
      redirect: "error",
      signal: AbortSignal.timeout(15_000)
    });
  } catch {
    // Do not let transport errors echo the private workspace URL or nested provider details.
    return { guardrailAccess: "NO_GO", status: 0, code: "transport_error" };
  }
  const payload = await response.json().catch(() => ({})) as { error?: { code?: unknown } };
  return {
    guardrailAccess: response.ok ? "GO" : "NO_GO",
    status: response.status,
    code: safeDiagnosticCode(payload.error?.code)
  };
}

function safeDiagnosticCode(value: unknown): string | null {
  if (typeof value !== "string" || !/^[A-Za-z0-9_.-]{1,80}$/.test(value)) return null;
  return value;
}

if (isMainModule(import.meta.url)) {
  const args = parseGuardrailAccessArguments(process.argv.slice(2));
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
  const result = await probeQwenGuardrailAccess({
    apiKey: credentials.apiKey,
    baseUrl: config.dashscopeBaseUrl,
    model: config.qwenFlashModel
  });
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    releaseEvidence: false,
    provider: "qwen",
    endpointRegion: "cn-beijing",
    model: config.qwenFlashModel,
    guardrailAccess: result.guardrailAccess,
    guardedTextRequest: { status: result.status, code: result.code },
    requiredInspectionHeader: INSPECTION_HEADER,
    requiredServiceLinkedRole: "AliyunServiceRoleForSFMAccessingCIP",
    nextAction: result.guardrailAccess === "GO"
      ? "Run the full authorized-image Qwen provider verification."
      : "Enable pay-as-you-go AI Safety Guardrails and authorize content moderation in the Beijing Bailian workspace."
  }, null, 2)}\n`);
  if (result.guardrailAccess !== "GO") process.exitCode = 1;
}
