import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildInterestingnessPrompt, interpretInterestingnessReview } from "../cloudflare/gateway/src/index.ts";
import { acquireCalibrationBudgetLock } from "./lib/calibration-budget-lock.mjs";

// Explicit opt-in paid, text-only experiment. No images, keys, expected labels
// or other judges' decisions enter requests. This is NOT the release benchmark.
const value = (flag: string) => process.argv[process.argv.indexOf(flag) + 1];
if (!process.argv.includes("--run") || !process.argv.includes("--allow-paid-text-only")) {
  throw new Error("Use --run <unique-name> --allow-paid-text-only [--candidate <module>] [--fixture <json>]");
}
const run = value("--run");
if (!/^[a-z0-9-]{3,60}$/.test(run)) throw new Error("Invalid run name");
const root = path.resolve(import.meta.dirname, "..");
const directory = path.join(root, ".tooling/editorial-calibration-v328");
mkdirSync(directory, { recursive: true, mode: 0o700 });
const output = path.join(directory, `${run}.json`);
if (existsSync(output)) throw new Error("Do not overwrite a measurement");
const releaseLock = acquireCalibrationBudgetLock(path.join(directory, "budget.lock"));
process.once("exit", releaseLock);
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const sourceSHA = sha(readFileSync(path.join(root, "cloudflare/gateway/src/index.ts"), "utf8"));
const fixturePath = process.argv.includes("--fixture") ? path.resolve(value("--fixture")) : path.join(root, "evaluation/editorial-calibration-v328.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const regressions = JSON.parse(readFileSync(path.join(root, "evaluation/editorial-regressions-v327.json"), "utf8"));
const cases = (fixture.regressionIDs ?? []).map((id: string) => {
  const entry = regressions.cases.find((item: any) => item.id === id);
  if (!entry) throw new Error(`Missing regression ${id}`);
  const artifact = JSON.parse(readFileSync(path.join(root, `.tooling/release-audit-v326/public-cold-path-pilot-${entry.run}.json`), "utf8"));
  const result = artifact.results.find((item: any) => item.fileName === entry.photo && item.card?.title === entry.title);
  if (!result?.card?.sources?.length) throw new Error(`Missing real evidence for ${id}`);
  return { id, objectName: result.detectedObjectName, title: entry.title, body: entry.body, sources: result.card.sources, expectedEditorialAccept: false, labelReason: entry.reasons.join("; ") };
}).concat(fixture.cases);
if (!cases.length || new Set(cases.map((c: any) => c.id)).size !== cases.length || cases.some((c: any) => typeof c.expectedEditorialAccept !== "boolean")) throw new Error("Invalid calibration data");
const candidatePath = process.argv.includes("--candidate") ? path.resolve(value("--candidate")) : null;
const candidate = candidatePath ? await import(pathToFileURL(candidatePath).href) : null;
const promptBuilder = candidate?.buildPrompt ?? buildInterestingnessPrompt;
const parser = candidate?.interpret ?? interpretInterestingnessReview;
const csv = readFileSync("/Users/wyq/Downloads/默认业务空间-apiKey-6301416.csv", "utf8");
const credentials = Object.fromEntries(csv.replace(/^\uFEFF/, "").split(/\r?\n/).flatMap(line => {
  const index = line.indexOf(",");
  return index > 0 ? [[line.slice(0, index).trim(), line.slice(index + 1).trim()]] : [];
}));
const base = new URL(credentials.openAiCompatible);
if (base.protocol !== "https:" || !(base.hostname === "dashscope.aliyuncs.com" || base.hostname.endsWith(".maas.aliyuncs.com")) || !credentials.apiKey) throw new Error("Invalid existing provider configuration");
const ledgerPath = path.join(directory, "budget.json");
const ledger = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, "utf8")) : { attempts: 0, reportedTokens: 0, unknownUsageCalls: 0 };
const limit = { attempts: 32, reportedTokens: 120_000 };
const report: any = { run, generatedAt: new Date().toISOString(), sourceSHA, fixtureSHA: sha(JSON.stringify(cases)), candidateSHA: candidatePath ? sha(readFileSync(candidatePath, "utf8")) : null, model: "qwen3.7-plus-2026-05-26", scope: fixture.purpose, limits: limit, results: [] };
const save = () => {
  writeFileSync(output, JSON.stringify(report, null, 2), { mode: 0o600 });
  writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2), { mode: 0o600 });
};
// Freeze all prompts before any call; labels are retained only in the local
// report for scoring. Deterministic ordering does not depend on the labels.
const inputs = cases.map((c: any) => {
  const fact = { objectName: c.objectName, title: c.title, body: c.body };
  return { c, fact, prompt: promptBuilder(fact, c.sources), order: sha(`${run}:${c.id}`) };
}).sort((a: any, b: any) => a.order.localeCompare(b.order));
report.promptsSHA = sha(JSON.stringify(inputs.map((i: any) => [i.c.id, i.prompt]).sort()));
save();
for (const { c, fact, prompt } of inputs) {
  // Check before issuing each request. Calls with unknown billing still consume
  // the attempt cap. No retries and no automatic budget resets.
  if (ledger.attempts >= limit.attempts || ledger.reportedTokens + 8_000 > limit.reportedTokens) throw new Error("Calibration budget reached; stopped without retries");
  ledger.attempts++;
  const row: any = { id: c.id, expectedEditorialAccept: c.expectedEditorialAccept, title: c.title, body: c.body, promptSHA: sha(prompt), startedAt: new Date().toISOString() };
  report.results.push(row);
  save();
  const started = Date.now();
  try {
    const response = await fetch(`${base.href.replace(/\/$/, "")}/chat/completions`, {
      method: "POST", redirect: "manual", signal: AbortSignal.timeout(18_000),
      headers: { Authorization: `Bearer ${credentials.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: report.model, messages: [{ role: "user", content: prompt }], enable_thinking: false, response_format: { type: "json_object" }, temperature: 0, max_tokens: 2048 })
    });
    row.httpStatus = response.status;
    const envelope: any = await response.json();
    row.usage = envelope.usage;
    const tokens = envelope.usage?.total_tokens;
    if (Number.isFinite(tokens)) ledger.reportedTokens += tokens;
    else ledger.unknownUsageCalls++;
    if (!response.ok) { row.providerCode = envelope.error?.code ?? "unknown"; throw new Error(`Provider HTTP ${response.status}`); }
    row.raw = JSON.parse(envelope.choices?.[0]?.message?.content);
    row.verdict = parser(row.raw, fact);
    // A candidate may add stricter checks but may never disable the product's
    // scope/unsafe-text/score guards. This changes no v328 general-only result.
    row.verdict.accepted = row.verdict.accepted && interpretInterestingnessReview(row.raw, fact).accepted;
    row.matchesLabel = row.verdict.accepted === c.expectedEditorialAccept;
  } catch (error: any) {
    row.error = error.name === "Error" ? error.message : error.name;
    if (row.httpStatus === undefined) ledger.unknownUsageCalls++;
  } finally { row.elapsedMs = Date.now() - started; save(); }
  console.log(JSON.stringify({ id: c.id, accepted: row.verdict?.accepted, expected: c.expectedEditorialAccept, reason: row.verdict?.reason, error: row.error, elapsedMs: row.elapsedMs }));
  // Authentication/credit/rate failures are not editorial failures. Stop, not
  // repeated paid retries; keep partial artifact explicitly incomplete.
  if (row.error) break;
}
const scored = report.results.filter((r: any) => r.verdict);
report.summary = {
  completed: scored.length === cases.length,
  count: cases.length,
  falseAccepts: scored.filter((r: any) => !r.expectedEditorialAccept && r.verdict.accepted).length,
  falseRejects: scored.filter((r: any) => r.expectedEditorialAccept && !r.verdict.accepted).length,
  trueAccepts: scored.filter((r: any) => r.expectedEditorialAccept && r.verdict.accepted).length,
  positiveCount: cases.filter((c: any) => c.expectedEditorialAccept).length,
  measuredTokens: report.results.reduce((n: number, r: any) => n + (r.usage?.total_tokens ?? 0), 0)
};
save();
console.log(JSON.stringify({ output, ...report.summary, cumulativeLedger: ledger }));
if (!report.summary.completed) process.exitCode = 2;
