import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { acquireCalibrationBudgetLock } from "./lib/calibration-budget-lock.mjs";
import { BlindReviewAttempts, reviewHTTPError } from "./lib/blind-review-attempts.mjs";
import { assertBoundCatalogCard, blindCardInput } from "./lib/catalog-review-provenance.mjs";

const args = process.argv.slice(2);
const provider = requiredValue("--provider");
const localOllamaModel = optionalValue("--ollama-model") ?? "deepseek-r1:14b";
const round = Number(requiredValue("--round"));
const evaluationFile = path.resolve(requiredValue("--evaluation"));
const outputFile = path.resolve(requiredValue("--output"));
const credentialFile = path.resolve(optionalValue("--credentials-file") ?? "/Users/wyq/.dsh/.credentials.yaml");
const checkpointFile = `${outputFile}.checkpoint.json`;
if (!new Set(["gpt", "kimi", "deepseek", "deepseek-bailian", "deepseek-local"]).has(provider)) {
  throw new Error("--provider must be gpt, kimi, deepseek, deepseek-bailian, or deepseek-local");
}
if (provider === "deepseek-local" && !new Set([
  "deepseek-r1:8b",
  "deepseek-r1:14b",
  "deepseek-llm:7b-chat-q4_K_M"
]).has(localOllamaModel)) {
  throw new Error("Unsupported --ollama-model for the calibrated local DeepSeek judge");
}
if (!Number.isInteger(round) || round < 1 || round > 3) throw new Error("--round must be 1, 2, or 3");

const evaluationBytes = await readFile(evaluationFile);
const evaluationSha256 = createHash("sha256").update(evaluationBytes).digest("hex");
const evaluation = JSON.parse(evaluationBytes.toString("utf8"));
const primaryCards = evaluation.results.filter(result => result.status === "ready").map(result => {
  if (result.card.cardId?.startsWith("catalog:")) assertBoundCatalogCard(result.card);
  return blindCardInput(result);
});
if (primaryCards.length < 1) throw new Error("Blind review requires at least one ready card");
if (new Set(primaryCards.map(card => card.cardId)).size !== primaryCards.length) throw new Error("Duplicate input card IDs");

const controls = [
  {
    cardId: "control-4f9a",
    photoObjectExpected: "扫帚",
    detectedObjectName: "扫帚",
    title: "扫帚可以扫地",
    body: "扫帚由把手和刷毛组成，移动刷毛可以把灰尘聚到一起。",
    sources: [{ title: "校准证据", url: "https://example.com/control", authority: "reference", evidenceKind: "synthetic-calibration-only", evidenceSnippet: "扫帚由把手和刷毛组成，是清扫工具；移动刷毛可以把灰尘聚到一起。" }]
  },
  {
    cardId: "control-c2d7",
    photoObjectExpected: "鼠标",
    detectedObjectName: "鼠标",
    title: "所有光学鼠标每秒都拍六千张照片",
    body: "任何光学鼠标都固定以每秒六千张的速度拍摄桌面，因此它们的工作方式完全相同。",
    sources: [{ title: "校准证据", url: "https://example.com/control", authority: "reference", evidenceSnippet: "某厂商资料称，其部分光学鼠标传感器每秒拍摄超过六千张表面图像。" }]
  }
];
// Keep judge context bounded while avoiding repeated model startup overhead.
// DeepSeek can truncate strict JSON for twelve product cards, so eight is the
// cross-provider default. The flag remains available for provider-specific
// diagnostics without changing the review policy.
const batchSize = Number(optionalValue("--batch-size") ?? 8);
if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 12) {
  throw new Error("--batch-size must be an integer from 1 to 12");
}
const batches = [];
for (let index = 0; index < primaryCards.length; index += batchSize) {
  batches.push(primaryCards.slice(index, index + batchSize));
}
// Bind actual sampling/reasoning settings as well as the wording. DeepSeek V4
// defaults to high thinking; v329 exhausted 8k output twice without a review.
// Low thinking is a NEW offline-judge profile, requiring fresh calibration;
// it does not inherit the previous profile's results or alter product models.
const generationSettings = provider === "gpt"
  ? { model: "gpt-5.6-sol", reasoningEffort: "medium", timeoutMs: 300_000 }
  : {
      model: provider === "deepseek-bailian" ? "deepseek-v4-pro" : modelName(provider),
      temperature: provider === "kimi" ? 1 : 0,
      max_tokens: 8_000,
      response_format: { type: "json_object" },
      ...(provider === "deepseek" ? { thinking: { type: "enabled" }, reasoning_effort: "low" } : {}),
      ...(provider === "deepseek-bailian" ? { enable_thinking: false } : {})
    };
const reviewPolicySha256 = createHash("sha256").update(JSON.stringify({
  prompt: reviewPrompt.toString(), parser: validateReviews.toString(), controls, generationSettings, batchSize
})).digest("hex");
await mkdir(path.dirname(outputFile), { recursive: true, mode: 0o700 });
const releaseLock = acquireCalibrationBudgetLock(`${outputFile}.lock`);
process.once("exit", releaseLock);
const checkpoint = await readOptionalJSON(checkpointFile) ?? {
  schemaVersion: 2,
  provider,
  round,
  evaluationFile,
  evaluationSha256,
  reviewPolicySha256,
  generationSettings,
  model: modelName(provider),
  batchSize,
  usage: { calls: 0, inputTokens: 0, outputTokens: 0 },
  batches: []
};
if (checkpoint.provider !== provider || checkpoint.round !== round || checkpoint.evaluationFile !== evaluationFile ||
  checkpoint.schemaVersion !== 2 || checkpoint.evaluationSha256 !== evaluationSha256 ||
  checkpoint.reviewPolicySha256 !== reviewPolicySha256 || checkpoint.model !== modelName(provider) || checkpoint.batchSize !== batchSize) {
  throw new Error("Checkpoint does not match this blind review");
}
const attemptLedger = new BlindReviewAttempts(checkpoint, Number(optionalValue("--max-attempts") ?? batches.length * 3), saveCheckpoint);
// A same-path file can have entirely different cards after another generation
// run. Never reuse its previous judgments, nor silently skip malformed batches.
const seenBatchIndexes = new Set();
for (const batch of checkpoint.batches) {
  if (!Number.isInteger(batch.batchIndex) || batch.batchIndex < 0 || batch.batchIndex >= batches.length || seenBatchIndexes.has(batch.batchIndex)) {
    throw new Error("Invalid or duplicate checkpoint batch");
  }
  seenBatchIndexes.add(batch.batchIndex);
  validateReviews({ reviews: batch.reviews }, new Set([...batches[batch.batchIndex], ...controls].map(card => card.cardId)));
}

for (const [batchIndex, batch] of batches.entries()) {
  if (checkpoint.batches.some((item) => item.batchIndex === batchIndex)) continue;
  const reviewCards = deterministicShuffle([...batch, ...controls], `${provider}:${round}:${batchIndex}`);
  const prompt = reviewPrompt(reviewCards);
  const expectedIDs = new Set(reviewCards.map((card) => card.cardId));
  let reviews = null;
  let lastValidationError = null;
  const validationAttempts = provider === "deepseek-bailian" ? 5 : 3;
  for (let attempt = 0; attempt < validationAttempts && reviews === null; attempt += 1) {
    const response = provider === "gpt"
      ? await reviewWithCodex(prompt, batchIndex)
      : provider === "deepseek-bailian"
        ? await reviewWithBailian(prompt)
      : provider === "deepseek-local"
        ? await reviewWithLocalDeepSeek(prompt, expectedIDs)
        : await reviewWithAPI(prompt, provider);
    try {
      reviews = validateReviews(response, expectedIDs);
    } catch (error) {
      lastValidationError = error;
      const last = checkpoint.attempts.at(-1);
      last.validationError = String(error.message).slice(0, 300);
      last.state = "invalid_schema";
      await saveCheckpoint();
      if (attempt < validationAttempts - 1) await delay(1_500 * (attempt + 1));
    }
  }
  if (reviews === null) throw lastValidationError;
  checkpoint.batches.push({ batchIndex, reviews });
  await saveCheckpoint();
  process.stdout.write(`${provider} round=${round} batch=${batchIndex + 1}/${batches.length} reviewed=${batch.length}\n`);
}

const allReviews = checkpoint.batches.flatMap((batch) => batch.reviews);
const reviewByCard = new Map(primaryCards.map((card) => [card.cardId, allReviews.find((review) => review.cardId === card.cardId)]));
const cards = primaryCards.map((card) => {
  const review = reviewByCard.get(card.cardId);
  if (!review) throw new Error(`Missing review for ${card.cardId}`);
  const passed = !review.hardFactIssue && review.sourceSupport && review.objectMatch && review.interestingSuitable &&
    review.surprise >= 3 && review.aha >= 4 && review.retellability >= 4 && review.imageConnection >= 3;
  return { ...card, review, passed };
});
const dullReviews = allReviews.filter((review) => review.cardId === controls[0].cardId);
const hardReviews = allReviews.filter((review) => review.cardId === controls[1].cardId);
const calibration = {
  dullControlPassed: dullReviews.length === batches.length && dullReviews.every((review) => !review.interestingSuitable && review.surprise <= 2),
  hardIssueControlPassed: hardReviews.length === batches.length && hardReviews.every((review) => review.hardFactIssue || !review.sourceSupport)
};
const summary = {
  cards: cards.length,
  passed: cards.filter((card) => card.passed).length,
  passRate: rounded(cards.filter((card) => card.passed).length / cards.length),
  hardFactIssues: cards.filter((card) => card.review.hardFactIssue).length,
  unsupportedSources: cards.filter((card) => !card.review.sourceSupport).length,
  objectMismatches: cards.filter((card) => !card.review.objectMatch).length,
  calibrationPassed: calibration.dullControlPassed && calibration.hardIssueControlPassed
};
const output = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  provider,
  model: checkpoint.model,
  round,
  evaluationFile,
  evaluationSha256,
  reviewPolicySha256,
  batchSize,
  blindPolicy: "anonymous-card-source-evidence-and-expected-visible-object-v2",
  generationSettings,
  usage: checkpoint.usage,
  attemptLimit: checkpoint.attemptLimit,
  attempts: checkpoint.attempts,
  calibration,
  calibrationReviews: { dull: dullReviews, hardIssue: hardReviews },
  summary,
  cards
};
await writeFile(outputFile, `${JSON.stringify(output, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
const passed = summary.passRate >= 0.85 && summary.hardFactIssues === 0 && summary.unsupportedSources === 0 &&
  summary.objectMismatches === 0 && summary.calibrationPassed;
process.stdout.write(`BLIND_REVIEW_${provider.toUpperCase()}=${passed ? "PASS" : "FAIL"} round=${round} passed=${summary.passed}/${summary.cards} hard=${summary.hardFactIssues} calibration=${summary.calibrationPassed}\n`);
if (!passed) process.exitCode = 1;

async function reviewWithAPI(prompt, selectedProvider) {
  const credentials = parseCredentials(await readFile(credentialFile, "utf8"));
  const keyName = selectedProvider === "kimi" ? "KIMI_CODING_API_KEY" : "DEEPSEEK_API_KEY";
  const apiKey = credentials[keyName];
  if (!apiKey) throw new Error(`Missing ${keyName}`);
  const endpoint = selectedProvider === "kimi"
    ? "https://api.kimi.com/coding/v1/chat/completions"
    : "https://api.deepseek.com/chat/completions";
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await attemptLedger.run(async record => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          ...generationSettings,
          messages: [{ role: "user", content: prompt }]
        }),
        redirect: "error",
        signal: AbortSignal.timeout(180_000)
      });
      const envelope = await response.json().catch(() => ({}));
      await record(envelope, response.status);
      if (!response.ok) throw reviewHTTPError(selectedProvider, response.status);
      if (envelope.choices?.[0]?.finish_reason !== "stop") {
        throw new Error(`${selectedProvider} response was truncated: ${String(envelope.choices?.[0]?.finish_reason ?? "unknown")}`);
      }
      const content = envelope.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new Error(`${selectedProvider} returned no content`);
      return JSON.parse(content.replace(/^```json\s*|\s*```$/g, ""));
      });
    } catch (error) {
      if (error.retryable === false) throw error;
      lastError = error;
      if (attempt < 2) await delay(1_500 * (attempt + 1));
    }
  }
  throw lastError;
}

async function reviewWithBailian(prompt) {
  const credentials = parseBailianCredentials(await readFile(credentialFile, "utf8"));
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await attemptLedger.run(async record => {
      const response = await fetch(`${credentials.openAiCompatible.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${credentials.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          ...generationSettings,
          messages: [{ role: "user", content: prompt }]
        }),
        redirect: "error",
        signal: AbortSignal.timeout(180_000)
      });
      const envelope = await response.json().catch(() => ({}));
      await record(envelope, response.status);
      if (!response.ok) {
        throw reviewHTTPError("deepseek-bailian", response.status);
      }
      if (envelope.choices?.[0]?.finish_reason !== "stop") {
        throw new Error(`deepseek-bailian response was truncated: ${String(envelope.choices?.[0]?.finish_reason ?? "unknown")}`);
      }
      const content = envelope.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new Error("deepseek-bailian returned no content");
      const parsed = parseModelJSON(content);
      return parsed;
      });
    } catch (error) {
      if (error.retryable === false) throw error;
      lastError = error;
      if (attempt < 2) await delay(1_500 * (attempt + 1));
    }
  }
  throw lastError;
}

async function reviewWithLocalDeepSeek(prompt, expectedIDs) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await attemptLedger.run(async record => {
      const response = await fetch("http://127.0.0.1:11434/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: localOllamaModel,
          messages: [{ role: "user", content: prompt }],
          // Keep the HTTP connection active while a large local review is
          // generated. A non-streaming Ollama response can remain headerless
          // for more than Node's five-minute headers timeout even though the
          // model is still making progress.
          stream: true,
          think: false,
          options: {
            temperature: 0,
            num_ctx: 4_096,
            num_predict: Math.max(1_000, Math.min(3_200, expectedIDs.size * 360))
          }
        }),
        signal: AbortSignal.timeout(600_000)
      });
      if (!response.ok) {
        await record({}, response.status);
        throw reviewHTTPError("deepseek-local", response.status);
      }
      const envelopes = (await response.text())
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      const envelope = envelopes.at(-1) ?? {};
      await record(envelope, response.status);
      if (envelope.done !== true) throw new Error("deepseek-local response did not finish");
      const content = envelopes.map((item) => item.message?.content ?? "").join("");
      if (!content) throw new Error("deepseek-local returned no content");
      const parsed = parseModelJSON(content);
      const candidateEnvelope = Array.isArray(parsed) ? { reviews: parsed } : parsed;
      let reviews;
      try {
        reviews = validateReviews(candidateEnvelope, expectedIDs);
      } catch (error) {
        throw new Error(`${error.message}; ${describeReviewShape(candidateEnvelope)}`);
      }
      return { reviews };
      });
    } catch (error) {
      if (error.retryable === false) throw error;
      lastError = error;
      if (attempt < 2) await delay(1_500 * (attempt + 1));
    }
  }
  throw lastError;
}

async function reviewWithCodex(prompt, batchIndex) {
  return attemptLedger.run(async () => {
  const temporaryDirectory = path.resolve(".tooling/release-eval/gpt-review-tmp");
  await mkdir(temporaryDirectory, { recursive: true, mode: 0o700 });
  const outputPath = path.join(temporaryDirectory, `round-${round}-batch-${batchIndex}-${Date.now()}.json`);
  const schemaPath = path.resolve("evaluation/blind-review-output.schema.json");
  await new Promise((resolve, reject) => {
    const child = spawn("codex", [
      "exec", "--ignore-user-config", "--ephemeral", "--ignore-rules", "--skip-git-repo-check",
      "--sandbox", "read-only", "--model", generationSettings.model, "--output-schema", schemaPath,
      "-c", `model_reasoning_effort="${generationSettings.reasoningEffort}"`, "--output-last-message", outputPath,
      "--cd", temporaryDirectory, "-"
    ], { stdio: ["pipe", "ignore", "pipe"] });
    child.stderr.resume();
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, generationSettings.timeoutMs);
    child.on("error", error => { clearTimeout(timeout); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (timedOut) reject(Object.assign(new Error("GPT review timed out; usage unknown"), { retryable: false }));
      else if (code === 0) resolve();
      else reject(new Error(`GPT Codex exited ${code}`));
    });
    child.stdin.end(prompt);
  });
  const content = await readFile(outputPath, "utf8");
  await unlink(outputPath).catch(() => undefined);
  return JSON.parse(content);
  });
}

function reviewPrompt(cards) {
  return [
    "你是独立盲评员，只根据下面匿名卡片、照片中预期清晰可见的物件、产品识别物件和来源证据评分。不要浏览网页，不要读取文件，不要猜测其他评委结论。",
    "逐卡评分：surprise 反常识程度；aha 是否给出清楚机制；retellability 是否能一句转述；naturalness 是否像人写。均为1到5整数。",
    "imageConnection 也为1到5：5=照片中可见特征直接触发知识；4=具体子类型直接相关；3=照片中的准确物件自然触发其内部机制、历史或用途；2=只与宽泛类别沾边；1=无关。不能仅因机制藏在物件内部，就把准确物件与知识主体一致的卡片打到2分。",
    "sourceSupport 只有来源证据直接支持标题和正文全部事实才为 true；任何范围扩大、补写目的/因果/数字都算不支持。objectMatch 只有预期物件、识别物件与卡片知识主体一致才为 true。",
    "严格检查量词和范围：来源中的‘部分、某些、可、超过、最多、某厂商’不能支持卡片中的‘所有、任何、固定、一定、恰好’；出现这种扩大时，sourceSupport 必须为 false 且 hardFactIssue 必须为 true。",
    "hardFactIssue 发现事实错误、证据不足、范围扩大或标题误导即为 true。interestingSuitable 只有你愿意把它作为每日照片冷知识推给普通用户才为 true，普通定义和说明书式常识必须为 false。",
    "不要因文案流畅掩盖证据问题。reason 用不超过40字说明最关键判断。严格只返回紧凑单行 JSON：{\"reviews\":[{\"cardId\":\"...\",\"surprise\":1,\"aha\":1,\"retellability\":1,\"imageConnection\":1,\"naturalness\":1,\"sourceSupport\":false,\"objectMatch\":false,\"hardFactIssue\":true,\"interestingSuitable\":false,\"reason\":\"...\"}]}。每个输入 cardId 恰好一次。",
    JSON.stringify(cards)
  ].join("\n");
}

function validateReviews(value, expectedIDs) {
  if (!value || typeof value !== "object" || !Array.isArray(value.reviews) || value.reviews.length !== expectedIDs.size) {
    throw new Error("Invalid blind review response shape");
  }
  const seen = new Set();
  const reviewKeys = ["aha", "cardId", "hardFactIssue", "imageConnection", "interestingSuitable", "naturalness", "objectMatch", "reason", "retellability", "sourceSupport", "surprise"];
  const harmlessEchoKeys = new Set(["body", "detectedObjectName", "photoObjectExpected", "sources", "title"]);
  const normalized = [];
  for (const review of value.reviews) {
    if (!review || typeof review !== "object") throw new Error("Blind review item is not an object");
    const actualKeys = Object.keys(review).sort();
    const unexpectedKeys = actualKeys.filter((key) => !reviewKeys.includes(key) && !harmlessEchoKeys.has(key));
    const missingKeys = reviewKeys.filter((key) => !(key in review));
    if (unexpectedKeys.length > 0 || missingKeys.length > 0) {
      throw new Error(`Invalid blind review keys for ${String(review.cardId ?? "missing-card-id")}: unexpected=${unexpectedKeys.join(",") || "none"}; missing=${missingKeys.join(",") || "none"}`);
    }
    if (!expectedIDs.has(review.cardId)) throw new Error(`Unexpected blind review cardId: ${String(review.cardId)}`);
    if (seen.has(review.cardId)) throw new Error(`Duplicate blind review cardId: ${review.cardId}`);
    seen.add(review.cardId);
    for (const key of ["surprise", "aha", "retellability", "imageConnection", "naturalness"]) {
      if (!Number.isInteger(review[key]) || review[key] < 1 || review[key] > 5) throw new Error(`Invalid ${key}`);
    }
    for (const key of ["sourceSupport", "objectMatch", "hardFactIssue", "interestingSuitable"]) {
      if (typeof review[key] !== "boolean") throw new Error(`Invalid ${key}`);
    }
    if (typeof review.reason !== "string" || review.reason.length < 2 || review.reason.length > 160) throw new Error("Invalid reason");
    normalized.push(Object.fromEntries(reviewKeys.map((key) => [key, review[key]])));
  }
  return normalized;
}

function parseCredentials(source) {
  return Object.fromEntries(source.split(/\r?\n/).flatMap((line) => {
    const match = /^([A-Z0-9_]+):\s*["']?([^"'\s]+)["']?\s*$/.exec(line.trim());
    return match ? [[match[1], match[2]]] : [];
  }));
}

function parseBailianCredentials(source) {
  const values = Object.fromEntries(source.replace(/^\uFEFF/, "").split(/\r?\n/).flatMap((line) => {
    const comma = line.indexOf(",");
    return comma > 0 ? [[line.slice(0, comma).trim(), line.slice(comma + 1).trim()]] : [];
  }));
  if (!values.apiKey || !values.openAiCompatible) {
    throw new Error("Bailian credential export is missing apiKey or openAiCompatible");
  }
  return { apiKey: values.apiKey, openAiCompatible: values.openAiCompatible };
}

function modelName(selectedProvider) {
  if (selectedProvider === "gpt") return "gpt-5.6-sol";
  if (selectedProvider === "kimi") return "kimi-for-coding";
  if (selectedProvider === "deepseek-bailian") return "deepseek-v4-pro (Alibaba Cloud Model Studio)";
  if (selectedProvider === "deepseek-local") {
    if (localOllamaModel === "deepseek-llm:7b-chat-q4_K_M") {
      return "DeepSeek LLM 7B Chat (local Ollama Q4_K_M)";
    }
    return localOllamaModel === "deepseek-r1:8b"
      ? "DeepSeek-R1-Distill-Llama-8B (local Ollama Q4_K_M)"
      : "DeepSeek-R1-Distill-Qwen-14B (local Ollama Q4_K_M)";
  }
  return "deepseek-v4-pro";
}

function parseModelJSON(content) {
  const withoutThinking = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const withoutFence = withoutThinking.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  try {
    return JSON.parse(withoutFence);
  } catch (error) {
    const start = withoutFence.indexOf("{");
    const end = withoutFence.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(withoutFence.slice(start, end + 1));
    throw error;
  }
}

function describeReviewShape(value) {
  if (!value || typeof value !== "object") return `topLevel=${typeof value}`;
  const reviews = value.reviews;
  return `keys=${Object.keys(value).sort().join(",") || "none"}; reviews=${Array.isArray(reviews) ? reviews.length : typeof reviews}`;
}

function deterministicShuffle(values, seed) {
  return values.map((value) => ({ value, hash: stableHash(`${seed}:${value.cardId}`) }))
    .sort((left, right) => left.hash - right.hash || left.value.cardId.localeCompare(right.value.cardId))
    .map((item) => item.value);
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of value) { hash ^= character.codePointAt(0); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}

async function saveCheckpoint() {
  await writeFile(`${checkpointFile}.tmp`, `${JSON.stringify(checkpoint, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(`${checkpointFile}.tmp`, checkpointFile);
}
async function readOptionalJSON(file) { try { return JSON.parse(await readFile(file, "utf8")); } catch (error) { if (error?.code === "ENOENT") return null; throw error; } }
function rounded(value) { return Math.round(value * 10_000) / 10_000; }
function delay(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
function requiredValue(flag) { const value = optionalValue(flag); if (!value) throw new Error(`${flag} is required`); return value; }
function optionalValue(flag) { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : null; }
