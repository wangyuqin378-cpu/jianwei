import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseBailianCredentialsCsv } from "../backend/dist/bailian-credentials.js";
import { acquireCalibrationBudgetLock } from "./lib/calibration-budget-lock.mjs";
import { ByokEvalBudget, readBudgetedByokResponse } from "./lib/byok-eval-budget.mjs";
import { FACT_CRITIC_MODEL, FACT_CRITIC_REVISION, factCriticInput, factCriticPayload, parseFactCritic } from "./lib/byok-fact-critic.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const sha = x => createHash("sha256").update(x).digest("hex");
const save = (file, data) => writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 });
const thinking = process.argv.includes("--thinking");
const model = arg("--model", FACT_CRITIC_MODEL);
const revision = FACT_CRITIC_REVISION + (model === "qwen3.8-flash" ? "-qwen38" : "") + (thinking ? "-thinking4096" : "");
const file = realpathSync(resolve(root, arg("--from", ".tooling/byok-actual-swift-20260907-v5-first4/results.json")));
const bytes = readFileSync(file);
const oldRows = JSON.parse(bytes).rows;
const dataset = JSON.parse(readFileSync(join(root, ".tooling/release-eval/v211-final-public-60/dataset.json")));
const preflight = JSON.parse(readFileSync(join(root, ".tooling/release-eval/v211-final-public-60-preflight.json")));
const budgetDir = join(root, ".tooling/evaluation-total-10cny-20260906");
const ledgerFile = join(budgetDir, "byok-3cny-ledger.json");
const originalLedger = JSON.parse(readFileSync(ledgerFile));
if (!Array.isArray(oldRows) || !oldRows.length || oldRows.length > 12) throw new Error("Use a fixed bounded original result set");
const seen = new Set();
const inputs = oldRows.map(row => {
  if (!/^web-\d{3}\.jpg$/.test(row.fileName) || seen.has(row.fileName) ||
      !dataset.photos.some(p => p.fileName === row.fileName) ||
      !preflight.photos.some(p => p.fileName === row.fileName && p.currentAppEligible === true && p.faceCount === 0 && !p.sensitiveFlags.length)) {
    throw new Error("Only existing authorized public-image outputs may enter the text experiment");
  }
  seen.add(row.fileName);
  const jpeg = readFileSync(join(root, ".tooling/release-eval/v211-final-public-60/sanitized", row.fileName));
  if (sha(jpeg) !== row.sha256) throw new Error("Original photo fingerprint mismatch");
  const call = row.calls?.[1];
  const paid = originalLedger.records.find(r => r.id === call?.reservation);
  if (!call || call.status !== 200 || call.replayed || call.syntheticFixtureInput ||
      call.model !== "qwen3.7-plus-2026-05-26" || !paid || paid.state !== "settled" ||
      paid.model !== call.model || join(paid.run, "results.json") !== file) throw new Error("Not an original settled writer response");
  return { fileName: row.fileName, originalReservation: call.reservation,
    input: factCriticInput(JSON.parse(call.content)) };
});
const out = resolve(root, arg("--out", `.tooling/byok-fact-ablation-${Date.now()}`));
for (const input of inputs) factCriticPayload(input.input, { thinking, model });
mkdirSync(out, { mode: 0o700 });
save(join(out, "manifest.json"), { scope: "Isolated text fact experiment; NOT app runtime, photo verification, or new generation",
  revision, thinking, model, originalFile: file, originalSHA256: sha(bytes),
  hashes: Object.fromEntries(["scripts/run-byok-fact-ablation.mjs", "scripts/lib/byok-fact-critic.mjs", "scripts/lib/byok-eval-budget.mjs"].map(p => [p, sha(readFileSync(join(root, p)))])),
  inputCount: inputs.length, noSearch: true, noPhotosSent: true, inputs });
console.log(JSON.stringify({ preflight: "passed", inputCount: inputs.length, paid: false, out }));
if (!process.argv.includes("--run")) process.exit(0);
const credentialFile = arg("--credentials-file");
if (!credentialFile) throw new Error("Authorized CSV path required");
const credential = parseBailianCredentialsCsv(readFileSync(credentialFile, "utf8"));
if (!/^https:\/\/(?:dashscope\.aliyuncs\.com|(?:ws|llm)-[a-z0-9]+\.cn-beijing\.maas\.aliyuncs\.com)\/compatible-mode\/v1\/?$/.test(credential.openAiCompatible)) {
  throw new Error("Expected budgeted Beijing endpoint");
}
const release = acquireCalibrationBudgetLock(join(budgetDir, "byok.lock"));
const rows = [];
try {
  const budget = new ByokEvalBudget(ledgerFile);
  for (const input of inputs) {
    const payload = factCriticPayload(input.input, { thinking, model });
    const body = JSON.stringify(payload);
    let reservation, stop = false;
    const row = { fileName: input.fileName, revision, model: payload.model,
      requestContract: { enable_thinking: payload.enable_thinking, thinking_budget: payload.thinking_budget ?? 0,
        max_tokens: payload.max_tokens, messageSHA256: sha(JSON.stringify(payload.messages)) } };
    const started = Date.now();
    try {
      reservation = budget.reserve(payload, {}, out, sha(body));
      row.reservation = reservation;
      const response = await fetch("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", {
        method: "POST", redirect: "manual", signal: AbortSignal.timeout(thinking ? 90_000 : 28_000),
        headers: { Authorization: `Bearer ${credential.apiKey}`, "Content-Type": "application/json" }, body,
      });
      row.httpStatus = response.status;
      const { envelope } = await readBudgetedByokResponse(budget, reservation, response, [credential.apiKey]);
      row.usage = envelope?.usage;
      row.content = envelope?.choices?.[0]?.message?.content;
      row.hasReasoningContent = typeof envelope?.choices?.[0]?.message?.reasoning_content === "string" &&
        envelope.choices[0].message.reasoning_content.length > 0;
      if (!response.ok) {
        row.status = "provider_failure";
        row.providerError = { code: String(envelope?.error?.code ?? "unknown").slice(0, 80),
          message: String(envelope?.error?.message ?? "Unavailable").replaceAll(credential.apiKey, "[redacted]").slice(0, 240) };
        stop = true;
      }
      else {
        try { row.checks = parseFactCritic(row.content, input.input); row.status = "valid"; }
        catch { row.status = "invalid_model_output"; }
      }
    } catch (error) {
      if (reservation) budget.recordTransportFailure(reservation,
        error.name === "TimeoutError" ? "provider_timeout" : "transport_failure");
      row.status = "transport_or_budget_failure";
      row.error = String(error.message).replaceAll(credential.apiKey, "[redacted]").slice(0, 200);
      stop = true;
    }
    row.providerResponse = budget.state.records.find(r => r.id === reservation)?.providerResponse;
    row.durationMS = Date.now() - started;
    rows.push(row);
    save(join(out, "results.json"), { rows, ledger: ledgerFile, heldMicroCNY: budget.heldMicroCNY, totalAuthorizedCNY: 10 });
    console.log(JSON.stringify({ ...row, content: undefined, cumulativeConservativeCNY: budget.heldMicroCNY / 1e6 }));
    if (stop) break; // no retries, unknown usage remains reserved
  }
} finally { release(); }
