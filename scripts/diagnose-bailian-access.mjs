import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseBailianCredentialsCsv } from "../backend/dist/bailian-credentials.js";

const args = process.argv.slice(2);
const credentialIndex = args.indexOf("--credentials-file");
const modelIndex = args.indexOf("--model");
const expectedHostIndex = args.indexOf("--expected-host");
if (credentialIndex < 0 || !args[credentialIndex + 1]) {
  throw new Error("--credentials-file is required");
}

const credentialsFile = path.resolve(args[credentialIndex + 1]);
const model = modelIndex >= 0 ? args[modelIndex + 1] : "qwen3.7-flash-2026-07-15";
const expectedHost = expectedHostIndex >= 0 ? args[expectedHostIndex + 1] : null;
if (!model || !/^[A-Za-z0-9_.-]{1,100}$/.test(model)) throw new Error("--model is invalid");
const credentials = parseBailianCredentialsCsv(await readFile(credentialsFile, "utf8"));
const baseURL = credentials.openAiCompatible.replace(/\/$/, "");
if (expectedHost) {
  const actualHost = new URL(baseURL).hostname;
  process.stdout.write(`BAILIAN_HOST_MATCH=${actualHost === expectedHost ? "YES" : "NO"}\n`);
}

let response;
try {
  response = await fetch(`${baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${credentials.apiKey}`,
      "content-type": "application/json",
      "X-DashScope-DataInspection": '{"input":"cip","output":"cip"}'
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: '只返回 JSON 对象：{"ok":true}' }],
      enable_thinking: false,
      response_format: { type: "json_object" },
      temperature: 0
    }),
    redirect: "error",
    signal: AbortSignal.timeout(30_000)
  });
} catch (error) {
  process.stdout.write(`BAILIAN_ACCESS=NETWORK_ERROR model=${model} detail=${sanitize(error instanceof Error ? error.message : String(error))}\n`);
  process.exitCode = 2;
  process.exit();
}

const envelope = await response.json().catch(() => ({}));
if (!response.ok) {
  const code = safeToken(envelope?.error?.code);
  const parameter = safeToken(envelope?.error?.param);
  const message = sanitize(typeof envelope?.error?.message === "string" ? envelope.error.message : "unavailable");
  process.stdout.write(`BAILIAN_ACCESS=HTTP_ERROR model=${model} status=${response.status} code=${code} param=${parameter} message=${message}\n`);
  process.exitCode = 1;
  process.exit();
}

const content = envelope?.choices?.[0]?.message?.content;
const valid = typeof content === "string" && content.includes("ok");
const promptTokens = Number(envelope?.usage?.prompt_tokens ?? 0);
const completionTokens = Number(envelope?.usage?.completion_tokens ?? 0);
process.stdout.write(
  `BAILIAN_ACCESS=${valid ? "PASS" : "INVALID_RESPONSE"} model=${model} status=${response.status} promptTokens=${promptTokens} completionTokens=${completionTokens}\n`
);
if (!valid) process.exitCode = 3;

function safeToken(value) {
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(value) ? value : "unknown";
}

function sanitize(value) {
  return String(value)
    .replaceAll(credentials.apiKey, "[redacted]")
    .replaceAll(credentials.openAiCompatible, "[redacted]")
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "[redacted]")
    .replace(/https?:\/\/[^\s/]+/g, "[redacted-host]")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 300);
}
