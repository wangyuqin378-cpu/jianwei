import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { parseBailianCredentialsCsv } from "../backend/dist/bailian-credentials.js";
import { acquireCalibrationBudgetLock } from "./lib/calibration-budget-lock.mjs";
import { ByokEvalBudget, quote, readBudgetedByokResponse } from "./lib/byok-eval-budget.mjs";
import { validateCalibration, calibrationRow, calibrationPrefix, assertCalibrationRequest,
  scoreCalibration } from "./lib/byok-review-calibration.mjs";
import { validateWriterModel, validateWriterThinking, writerExperimentSource,
  writerExperimentPayload, replayPrefixLength, completedReplayChoice } from "./lib/byok-writer-experiment.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const value = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? fallback : process.argv[i + 1];
};
const sha = data => createHash("sha256").update(data).digest("hex");
const save = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2), { mode: 0o600 });
const start = Number(value("--start", "0"));
const count = Number(value("--count", "1"));
if (!Number.isInteger(start) || start < 0 || !Number.isInteger(count) || count < 1 || start + count > 60) {
  throw new Error("Use a bounded slice of the fixed authorized 60-image dataset");
}
const datasetFile = join(root, ".tooling/release-eval/v211-final-public-60/dataset.json");
const preflightFile = join(root, ".tooling/release-eval/v211-final-public-60-preflight.json");
const dataset = JSON.parse(readFileSync(datasetFile));
const preflight = JSON.parse(readFileSync(preflightFile));
const calibrationFile = value("--calibration-fixture");
const separatePhoto = readFileSync(join(root, "ios/Jianwei/Services/DirectQwenService.swift"), "utf8")
  .includes('modelKnowledgeRevision = "byok-model-knowledge-v13-isolated-photo-review"');
const writerModel = validateWriterModel(value("--writer-model"));
const thinkingArgument = value("--writer-thinking-budget");
if (process.argv.includes("--writer-thinking-budget") && thinkingArgument === undefined) {
  throw new Error("Missing writer thinking budget");
}
const thinkingBudget = validateWriterThinking(thinkingArgument === undefined ? undefined : Number(thinkingArgument), writerModel);
const replayLength = replayPrefixLength({ prefix: value("--replay-prefix-from"),
  detection: value("--replay-detection-from"), calibration: calibrationFile, writerModel, thinkingBudget });
let calibration, calibrationSource;
if (calibrationFile) {
  if (["--start", "--count", "--replay-prefix-from"].some(f => process.argv.includes(f))) {
    throw new Error("Calibration selects exact fixture photos; do not combine slice or paid-output replay");
  }
  const file = realpathSync(resolve(root, calibrationFile));
  const bytes = readFileSync(file);
  calibration = validateCalibration(JSON.parse(bytes));
  calibrationSource = { file, sha256: sha(bytes), scope: calibration.scope };
}
if (dataset.photos.length !== 60 || new Set(dataset.photos.map(p => p.expectedTopicId)).size !== 30) {
  throw new Error("Fixed dataset identity changed");
}
const selected = calibration ? calibration.cases.map(c => dataset.photos.find(p => p.fileName === c.fileName)) :
  dataset.photos.slice(start, start + count);
const photos = selected.map(row => {
  if (!row) throw new Error("Calibration photo is not in the fixed authorized dataset");
  const p = preflight.photos.find(x => x.fileName === row.fileName);
  const dir = realpathSync(join(root, ".tooling/release-eval/v211-final-public-60/sanitized"));
  if (!p || p.currentAppEligible !== true || p.faceCount !== 0 || p.sensitiveFlags.length || p.exactDuplicateOf ||
      !/^web-\d{3}\.jpg$/.test(row.fileName)) throw new Error("Ineligible evaluation photo");
  const file = realpathSync(join(dir, row.fileName));
  if (file !== join(dir, row.fileName)) throw new Error("Unexpected photo symlink");
  const bytes = readFileSync(file);
  if (bytes.length !== p.sanitizedBytes || bytes.length > 3 * 1024 * 1024 ||
      bytes.subarray(0, 3).toString("hex") !== "ffd8ff") throw new Error("Sanitized input changed");
  const photo = { file, fileName: row.fileName, labels: p.labels, sha256: sha(bytes), bytes };
  if (calibration) calibrationRow(calibration, photo);
  return photo;
});
// A controlled reviewer comparison may replay the already-paid detection and
// drafts, but never the review. These are labeled as replayed, not fresh calls.
const replayFile = value("--replay-prefix-from") ?? value("--replay-detection-from");
let replaySource, replayRows;
if (replayFile) {
  const file = realpathSync(resolve(root, replayFile));
  const bytes = readFileSync(file);
  replaySource = { file, sha256: sha(bytes) };
  replayRows = JSON.parse(bytes).rows;
  for (const photo of photos) {
    const row = replayRows.find(r => r.fileName === photo.fileName && r.sha256 === photo.sha256);
    if (!row || row.calls.slice(0, replayLength).length !== replayLength) {
      throw new Error("Replay requires original successful prefix calls for each exact photo");
    }
    for (const call of row.calls.slice(0, replayLength)) completedReplayChoice(call);
  }
}
const out = resolve(root, value("--out", `.tooling/byok-live-${Date.now()}`));
mkdirSync(out, { mode: 0o700 }); // Exclusive new artifact directory: never erase paid results.
const sources = ["scripts/eval-current-byok.swift", "ios/Jianwei/Services/DirectQwenService.swift",
  "ios/Jianwei/Models/DomainModels.swift", "ios/Shared/WidgetModels.swift", "ios/Shared/SharedConstants.swift"];
const manifest = { createdAt: new Date().toISOString(), scope: "BYOK model-knowledge fallback only",
  replaySource, replayLength, calibrationSource,
  ...(writerModel ? { writerModelOverride: writerModel, experimentalTransport: true,
    experimentScope: "Actual App prompts/parsers with an explicitly overridden writer model; not default-model acceptance" } : {}),
  ...(thinkingBudget ? { writerThinkingBudget: thinkingBudget, experimentalTransport: true,
    transportTimeoutOverrideSeconds: 120,
    experimentScope: "Same App models/prompts/parsers; writer thinking only, timeout-only compilation copy. NOT App default or latency acceptance" } : {}),
  noSearch: true, noAdditionalModeration: true, noPlatformKeyFallback: true,
  sourceHashes: Object.fromEntries([...sources, "knowledge/catalog.json", "scripts/lib/byok-eval-budget.mjs",
    "scripts/lib/byok-review-calibration.mjs",
    "scripts/lib/byok-writer-experiment.mjs",
    "scripts/run-current-byok-eval.mjs"].map(file => [file, sha(readFileSync(join(root, file)))])),
  datasetSHA256: sha(readFileSync(datasetFile)), preflightSHA256: sha(readFileSync(preflightFile)),
  photos: photos.map(({ bytes, ...p }) => p), excludes: ["catalog editing", "daily scheduling", "real-device UI"] };
const appSource = readFileSync(join(root, sources[1]), "utf8");
const compiledService = writerExperimentSource(appSource, thinkingBudget);
writeFileSync(join(out, "DirectQwenService.source.swift"), appSource, { mode: 0o600 });
const compilationSources = sources.map(s => join(root, s));
if (thinkingBudget) {
  const file = join(out, "DirectQwenService.evaluation.swift");
  writeFileSync(file, compiledService, { mode: 0o600 });
  compilationSources[1] = file;
  manifest.compiledServiceSHA256 = sha(compiledService);
}
save(join(out, "manifest.json"), manifest);
if (calibration) save(join(out, "calibration-fixture.json"), calibration);
const executable = join(out, "eval-current-byok");
const sdk = spawnSync("/usr/bin/xcrun", ["--sdk", "macosx", "--show-sdk-path"],
  { encoding: "utf8", env: { ...process.env, DEVELOPER_DIR: "/Applications/Xcode.app/Contents/Developer" } });
if (sdk.status !== 0) throw new Error("Xcode macOS SDK unavailable");
const build = spawnSync("/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swiftc",
  ["-sdk", sdk.stdout.trim(), "-swift-version", "5", "-parse-as-library", ...compilationSources, "-o", executable],
  { cwd: root, encoding: "utf8", env: { ...process.env, DEVELOPER_DIR: "/Applications/Xcode.app/Contents/Developer" } });
if (build.status !== 0) { process.stderr.write(build.stderr.slice(-12000)); process.exit(1); }
console.log(JSON.stringify({ compiled: true, selected: photos.length, output: out, paid: false }));
if (!process.argv.includes("--run")) process.exit(0);

const credentialFile = value("--credentials-file");
if (!credentialFile) throw new Error("Explicit authorized CSV path required for live mode");
const credential = parseBailianCredentialsCsv(readFileSync(credentialFile, "utf8"));
if (!/^https:\/\/(?:dashscope\.aliyuncs\.com|(?:ws|llm)-[a-z0-9]+\.cn-beijing\.maas\.aliyuncs\.com)\/compatible-mode\/v1\/?$/.test(credential.openAiCompatible)) {
  throw new Error("Credentials must match the budgeted Beijing endpoint");
}
const budgetDir = join(root, ".tooling/evaluation-total-10cny-20260906");
mkdirSync(budgetDir, { recursive: true, mode: 0o700 });
const release = acquireCalibrationBudgetLock(join(budgetDir, "byok.lock"));
const budget = new ByokEvalBudget(join(budgetDir, "byok-3cny-ledger.json"));
const bridgeToken = "sk-" + randomBytes(24).toString("hex");
const rows = [];
let current, inFlight = false, lastTransportError;
const server = createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/chat" || req.headers.authorization !== `Bearer ${bridgeToken}` || inFlight || !current) {
    res.writeHead(403).end(); return;
  }
  inFlight = true;
  let reservation;
  let requestMetadata;
  const started = Date.now();
  try {
    const chunks = [];
    let length = 0;
    for await (const chunk of req) {
      length += chunk.length;
      if (length > 5_000_000) throw new Error("Request too large");
      chunks.push(chunk);
    }
    const originalBody = Buffer.concat(chunks);
    const requestedPayload = JSON.parse(originalBody);
    const payload = writerExperimentPayload(requestedPayload, req.headers, current.calls.length, writerModel, thinkingBudget);
    const body = payload === requestedPayload ? originalBody : Buffer.from(JSON.stringify(payload));
    // Permit only this approved photo; filenames and expected labels never go to the model.
    for (const m of payload.messages ?? []) for (const part of Array.isArray(m.content) ? m.content : []) {
      if (part.type === "image_url" && part.image_url?.url !== `data:image/jpeg;base64,${current.photo.bytes.toString("base64")}`) {
        throw new Error("Unexpected photo payload");
      }
    }
    if (calibration) {
      // Frozen detection/writing are synthetic, never evidence of new model
      // generation. Only stage 2 reaches the provider and original budget.
      quote(payload, req.headers);
      const row = calibrationRow(calibration, current.photo);
      const stage = current.calls.length;
      assertCalibrationRequest(row, payload, stage, { separatePhoto });
      if (stage < 2) {
        const content = calibrationPrefix(row, stage);
        current.calls.push({ model: payload.model, status: 200, durationMS: Date.now() - started,
          syntheticFixtureInput: true, finishReason: "stop", fixtureCaseId: row.id, currentRequestHash: sha(body), content });
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
          choices: [{ finish_reason: "stop", message: { content } }],
        }));
        return;
      }
    }
    if (replayRows && current.calls.length < replayLength) {
      const row = replayRows.find(r => r.fileName === current.photo.fileName && r.sha256 === current.photo.sha256);
      const cached = row.calls[current.calls.length];
      const original = budget.state.records.find(r => r.id === cached.reservation);
      if (!original || original.state !== "settled" || original.model !== payload.model ||
          join(original.run, "results.json") !== replaySource.file) {
        throw new Error("Replay must refer to a settled call in the original result file");
      }
      // Freeze the old outputs by design; this does NOT validate the current
      // writer prompt. Swift JSON object key order is not byte-stable across
      // processes, so the historical raw request hash is not an equality test.
      current.calls.push({ model: payload.model, status: 200, durationMS: Date.now() - started,
        replayed: true, finishReason: cached.finishReason, originalReservation: cached.reservation, currentRequestHash: sha(body), content: cached.content });
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
        choices: [completedReplayChoice(cached)],
      }));
      return;
    }
    reservation = budget.reserve(payload, req.headers, out, sha(body));
    requestMetadata = { model: payload.model,
      ...(payload.model !== requestedPayload.model ? { appRequestedModel: requestedPayload.model, experimentalModelOverride: true } : {}),
      requestContract: { enable_thinking: payload.enable_thinking, thinking_budget: payload.thinking_budget ?? 0,
        max_tokens: payload.max_tokens, messageSHA256: sha(JSON.stringify(payload.messages)) } };
    const response = await fetch("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", {
      method: "POST", redirect: "manual", signal: AbortSignal.timeout(payload.enable_thinking ? 90_000 : 28_000),
      headers: { Authorization: `Bearer ${credential.apiKey}`, "Content-Type": "application/json" }, body,
    });
    const { data, envelope } = await readBudgetedByokResponse(budget, reservation, response,
      [credential.apiKey, bridgeToken]);
    current.calls.push({ reservation, ...requestMetadata, status: response.status,
      providerResponse: budget.state.records.find(r => r.id === reservation)?.providerResponse,
      hasReasoningContent: typeof envelope?.choices?.[0]?.message?.reasoning_content === "string" &&
        envelope.choices[0].message.reasoning_content.length > 0,
      durationMS: Date.now() - started, usage: envelope?.usage,
      finishReason: envelope?.choices?.[0]?.finish_reason,
      content: envelope?.choices?.[0]?.message?.content, errorCode: envelope?.error?.code,
      errorMessage: envelope?.error?.message?.replaceAll(credential.apiKey, "[redacted]").replaceAll(bridgeToken, "[redacted]").slice(0, 300) });
    res.writeHead(response.status, { "Content-Type": "application/json" }).end(Buffer.from(data));
  } catch (error) {
    lastTransportError = error.name === "TimeoutError" ? "provider_timeout" : String(error.message).slice(0, 200);
    if (reservation) budget.recordTransportFailure(reservation,
      error.name === "TimeoutError" ? "provider_timeout" : "transport_failure");
    current?.calls.push({ reservation, ...requestMetadata,
      providerResponse: budget.state.records.find(r => r.id === reservation)?.providerResponse,
      durationMS: Date.now() - started, error: lastTransportError });
    res.writeHead(503, { "Content-Type": "application/json" }).end('{"error":{"code":"evaluation_stopped"}}');
  } finally { inFlight = false; }
});

try {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const bridgeURL = `http://127.0.0.1:${server.address().port}/chat`;
  for (const photo of photos) {
    current = { photo, calls: [] };
    const started = Date.now();
    const result = await new Promise((resolve, reject) => {
      const child = spawn(executable, [], { stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "", stderr = "";
      child.stdout.on("data", d => { stdout += d; });
      child.stderr.on("data", d => { stderr += d; });
      child.on("error", reject);
      child.on("exit", code => {
        if (code !== 0) resolve({ status: "runner_error", exitCode: code, diagnostic: stderr.slice(-1000) });
        else { try { resolve(JSON.parse(stdout)); } catch { resolve({ status: "runner_error" }); } }
      });
      child.stdin.end(JSON.stringify({ bridgeURL, bridgeToken, jpegPath: photo.file, labels: photo.labels,
        catalogPath: join(root, "knowledge/catalog.json") }));
    });
    const calibrationResult = calibration ? scoreCalibration(calibrationRow(calibration, photo),
      current.calls[separatePhoto ? 3 : 2]?.content,
      { requireScope: result.revision !== "byok-model-knowledge-v6.1",
        requireConnection: separatePhoto || result.revision === "byok-model-knowledge-v12-object-connection",
        separatePhoto, photoResponse: current.calls[2]?.content,
        derivedSelection: result.revision === "byok-model-knowledge-v14-qualified-selection",
        selectionFallback: result.revision === "byok-model-knowledge-v14.1-selection-fallback" }) : undefined;
    rows.push({ fileName: photo.fileName, sha256: photo.sha256, durationMS: Date.now() - started,
      ...result, ...(calibration ? { scope: calibration.scope, calibration: calibrationResult } : {}), calls: current.calls });
    save(join(out, "results.json"), { rows, heldMicroCNY: budget.heldMicroCNY,
      ledger: budget.file, totalAuthorizedCNY: budget.state.totalMicroCNY / 1e6,
      byokPartitionCNY: budget.state.partitionMicroCNY / 1e6, lastTransportError });
    console.log(JSON.stringify({ file: photo.fileName, status: result.status, card: result.card?.title,
      calls: current.calls.length, replayedCalls: current.calls.filter(c => c.replayed).length,
      syntheticFixtureCalls: current.calls.filter(c => c.syntheticFixtureInput).length,
      ...(calibration ? { calibration: calibrationResult } : {}),
      cumulativeConservativeCNY: budget.heldMicroCNY / 1e6 }));
    // A malformed model answer is a measured per-photo failure, not a reason
    // to hide the rest of the fixed sample. Never retry it. Transport/account/
    // budget failures stop the run, while their reservations remain held.
    if (result.status === "runner_error" || lastTransportError ||
        current.calls.some(c => c.status !== 200)) break;
  }
} finally {
  await new Promise(resolve => server.close(resolve));
  release();
}
