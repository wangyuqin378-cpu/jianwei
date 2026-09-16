import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { request as httpsRequest } from "node:https";
import path from "node:path";
import { retryPolicyForHTTP, retryPolicyForTransport } from "./lib/evaluation-retry-policy.mjs";

class RetryableError extends Error {
  constructor(message, maxAttempts, retryKind) {
    super(message);
    this.name = "RetryableError";
    this.maxAttempts = maxAttempts;
    this.retryKind = retryKind;
  }
}

const args = process.argv.slice(2);
const baseURL = (optionalValue("--base-url") ?? "https://jianwei-api.yuqin.wang").replace(/\/$/, "");
const datasetFile = path.resolve(requiredValue("--dataset"));
const preflightFile = path.resolve(requiredValue("--preflight"));
const outputFile = path.resolve(requiredValue("--output"));
if (await readOptionalJSON(outputFile)) throw new Error("Evaluation output already exists; do not rerun a completed experiment");
const runID = requiredValue("--run-id");
const concurrency = Number(optionalValue("--concurrency") ?? 1);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 7) {
  throw new Error("--concurrency must be an integer between 1 and 7");
}
const pilotFiles = new Set((optionalValue("--pilot-files") ?? "").split(",").map((value) => value.trim()).filter(Boolean));
const isPilot = pilotFiles.size > 0;
const checkpointFile = `${outputFile}.checkpoint.json`;
let checkpointWriteQueue = Promise.resolve();
const datasetBytes = await readFile(datasetFile);
const preflightBytes = await readFile(preflightFile);
const dataset = JSON.parse(datasetBytes);
const preflight = JSON.parse(preflightBytes);
const datasetSha256 = sha256(datasetBytes);
const preflightSha256 = sha256(preflightBytes);
const metadataByName = new Map(dataset.photos.map((photo) => [photo.fileName, photo]));
if (metadataByName.size !== dataset.photos.length) throw new Error("Duplicate photo metadata filenames");
const allEligible = preflight.photos.filter((photo) => photo.currentAppEligible === true && !photo.exactDuplicateOf);
const eligible = isPilot ? allEligible.filter((photo) => pilotFiles.has(photo.fileName)) : allEligible;
const actualTopics = new Set(eligible.map((photo) => metadataByName.get(photo.fileName)?.expectedTopicId).filter(Boolean));
if (!isPilot && (dataset.count !== 60 || dataset.photos.length !== 60 || eligible.length !== 60 || dataset.topicCount < 30 || actualTopics.size < 30)) {
  throw new Error(`Release evaluation requires exactly 60 eligible photos and >=30 topics; dataset=${dataset.count} eligible=${eligible.length} topics=${dataset.topicCount}`);
}
if (isPilot && eligible.length !== pilotFiles.size) {
  const found = new Set(eligible.map((photo) => photo.fileName));
  throw new Error(`Pilot photos are missing or ineligible: ${[...pilotFiles].filter((fileName) => !found.has(fileName)).join(", ")}`);
}
// Freeze the bytes that will actually be uploaded, not just the metadata
// filenames. Validate all inputs before registering a device or making a
// paid request, including privacy fields that can contradict eligibility.
const photoInputs = await freezePhotoInputs();
const photoInputSha256 = sha256(JSON.stringify(photoInputs));
const photoHashByName = new Map(photoInputs.map((photo) => [photo.fileName, photo.sanitizedSha256]));
const runtimeProvenance = await readRuntimeProvenance();

const checkpoint = await readOptionalJSON(checkpointFile) ?? {
  schemaVersion: 2,
  runID,
  baseURL,
  runtimeProvenance,
  datasetSha256,
  preflightSha256,
  photoInputSha256,
  devices: [],
  results: [],
  dailySelections: {}
};
if (checkpoint.runID !== runID || checkpoint.baseURL !== baseURL) throw new Error("Checkpoint does not match this run");
if (JSON.stringify(checkpoint.runtimeProvenance) !== JSON.stringify(runtimeProvenance) || checkpoint.datasetSha256 !== datasetSha256) {
  throw new Error("Checkpoint belongs to another runtime or dataset; do not mix release evidence");
}
if (checkpoint.photoInputSha256 !== photoInputSha256 || checkpoint.preflightSha256 !== preflightSha256) {
  throw new Error("Checkpoint belongs to different photo inputs or preflight; do not reuse paid results");
}
if (new Set(checkpoint.results.map((row) => row.fileName)).size !== checkpoint.results.length ||
    checkpoint.results.some((row) => !photoHashByName.has(row.fileName) || row.sanitizedSha256 !== photoHashByName.get(row.fileName))) {
  throw new Error("Checkpoint rows do not match the frozen photo inputs or preflight");
}
checkpoint.dailySelections ??= {};
const completed = new Set(checkpoint.results.map((result) => result.fileName));
const eligibleIndex = new Map(eligible.map((photo, index) => [photo.fileName, index]));

const deviceGroups = Array.from({ length: Math.ceil(eligible.length / 9) }, (_, deviceIndex) => ({
  deviceIndex,
  photos: eligible.slice(deviceIndex * 9, deviceIndex * 9 + 9)
}));
for (let groupStart = 0; groupStart < deviceGroups.length; groupStart += concurrency) {
  await Promise.all(deviceGroups.slice(groupStart, groupStart + concurrency).map(processDeviceGroup));
}
checkpoint.results.sort((left, right) => eligibleIndex.get(left.fileName) - eligibleIndex.get(right.fileName));
await saveCheckpoint();

async function processDeviceGroup({ deviceIndex, photos }) {
  const device = await deviceFor(deviceIndex);
  for (const photo of photos) {
    if (completed.has(photo.fileName)) continue;
    const metadata = metadataByName.get(photo.fileName);
    if (!metadata) throw new Error(`Missing metadata for ${photo.fileName}`);
    const jpeg = await readSanitizedJPEG(photo);
    const sanitizedSha256 = sha256(jpeg);
    if (sanitizedSha256 !== photoHashByName.get(photo.fileName)) throw new Error("Photo inputs changed during evaluation");
    const candidateId = stableUUID(`${runID}\0${photo.fileName}\0${sanitizedSha256}`);
    const idempotencyKey = `eval-${runID}-${candidateId}`;
    const startedAt = Date.now();
    const response = await requestJSON("/v1/photo-insights", {
      method: "POST",
      token: device.deviceToken,
      idempotencyKey,
      timeout: 300_000,
      body: {
        candidateId,
        jpegBase64: jpeg.toString("base64"),
        localLabels: photo.labels.slice(0, 20),
        interests: ["生活设计", "物件历史", "科学原理", "实用技巧", "制造工艺"]
      }
    });
    const result = validateInsightResponse(response, candidateId);
    checkpoint.results.push({
      fileName: photo.fileName,
      sanitizedSha256,
      expectedTopicId: metadata.expectedTopicId,
      expectedDisplayName: metadata.expectedDisplayName,
      commonsPage: metadata.commonsPage,
      category: metadata.category,
      elapsedMilliseconds: Date.now() - startedAt,
      ...result
    });
    checkpoint.results.sort((left, right) => eligibleIndex.get(left.fileName) - eligibleIndex.get(right.fileName));
    await saveCheckpoint();
    process.stdout.write(`${checkpoint.results.length}/${eligible.length} ${photo.fileName} ${result.status}${result.card ? ` ${result.card.detectedObjectName}｜${result.card.title}` : ""}\n`);
  }
}

const dailyGroups = [];
for (let index = 0; index < checkpoint.results.length; index += 9) {
  const photoResults = checkpoint.results.slice(index, index + 9);
  const candidates = photoResults.filter((result) => result.status === "ready").slice(0, 3);
  let winnerCardId = candidates[0]?.card?.cardId ?? null;
  let selectionMethod = candidates.length ? "single" : "none";
  if (candidates.length >= 2) {
    const device = await deviceFor(Math.floor(index / 9));
    const body = {
      cards: candidates.map((result) => ({
        cardId: result.card.cardId,
        topicId: result.card.topicId,
        objectName: result.card.detectedObjectName,
        title: result.card.title,
        body: result.card.body,
        qualityScore: result.scores.qualityScore
      })),
      topicAffinities: {}
    };
    const requestSha256 = createHash("sha256").update(JSON.stringify(body)).digest("hex");
    const saved = checkpoint.dailySelections[index / 9];
    if (saved && saved.requestSha256 !== requestSha256) throw new Error("Saved daily selection belongs to different candidates");
    const winner = saved?.response ?? await requestJSON("/v1/daily-winner", {
      method: "POST",
      token: device.deviceToken,
      idempotencyKey: `eval-winner-${runID}-${index / 9}`,
      timeout: 30_000,
      body
    });
    if (!candidates.some((candidate) => candidate.card.cardId === winner.cardId)) throw new Error("Daily winner returned an unknown card");
    if (!["ai", "fallback"].includes(winner.selectionMethod)) throw new Error("Daily winner returned no valid selection method");
    checkpoint.dailySelections[index / 9] = { requestSha256, response: winner };
    await saveCheckpoint();
    winnerCardId = winner.cardId;
    selectionMethod = winner.selectionMethod;
  }
  dailyGroups.push({
    index: dailyGroups.length,
    photoFileNames: photoResults.map((result) => result.fileName),
    analyzedPhotoCount: photoResults.length,
    qualifiedCardIds: candidates.map((candidate) => candidate.card.cardId),
    winnerCardId,
    selectionMethod
  });
}

const sourceURLs = [...new Set(checkpoint.results.flatMap((result) =>
  result.card ? result.card.sources.map((source) => source.url) : []
))];
// A release check should reject a genuinely dead source, not a healthy host
// that briefly rate-limits a burst from dozens of parallel probes.
const sourceHealth = new Map(await mapWithConcurrency(
  sourceURLs,
  6,
  async (url) => [url, await sourceReachable(url)]
));
const sourceChecks = [];
for (const result of checkpoint.results.filter((item) => item.card)) {
  for (const source of result.card.sources) {
    sourceChecks.push({
      cardId: result.card.cardId,
      url: source.url,
      reachable: sourceHealth.get(source.url) === true
    });
  }
}
const slidingWindows = [];
for (let index = 0; index <= checkpoint.results.length - 9; index += 1) {
  const window = checkpoint.results.slice(index, index + 9);
  slidingWindows.push({
    start: index,
    end: index + 8,
    ready: window.filter((result) => result.status === "ready").length
  });
}
const ready = checkpoint.results.filter((result) => result.status === "ready");
const metrics = {
  photos: checkpoint.results.length,
  ready: ready.length,
  noInsight: checkpoint.results.length - ready.length,
  qualifiedRate: rounded(ready.length / checkpoint.results.length),
  dailyGroups: dailyGroups.length,
  dailyGroupsWithCard: dailyGroups.filter((group) => group.winnerCardId).length,
  fallbackDailySelections: dailyGroups.filter((group) => group.selectionMethod === "fallback").length,
  slidingNineWindows: slidingWindows.length,
  slidingNineWindowsWithCard: slidingWindows.filter((window) => window.ready > 0).length,
  slidingNineCoverageRate: slidingWindows.length ? rounded(slidingWindows.filter((window) => window.ready > 0).length / slidingWindows.length) : null,
  sources: sourceChecks.length,
  reachableSources: sourceChecks.filter((check) => check.reachable).length,
  sourceReachabilityRate: sourceChecks.length ? rounded(sourceChecks.filter((check) => check.reachable).length / sourceChecks.length) : 0,
  meanElapsedMilliseconds: rounded(checkpoint.results.reduce((sum, result) => sum + result.elapsedMilliseconds, 0) / checkpoint.results.length)
};
const output = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  runID,
  baseURL,
  runtimeProvenance,
  datasetSha256,
  preflightSha256,
  photoInputSha256,
  dataset: datasetFile,
  preflight: preflightFile,
  policy: isPilot ? "production-photo-insights-pilot-v2" : "production-photo-insights-nine-photo-daily-selection-v2",
  metrics,
  dailyGroups,
  slidingWindows,
  sourceChecks,
  results: checkpoint.results
};
if (JSON.stringify(await readRuntimeProvenance()) !== JSON.stringify(runtimeProvenance)) {
  throw new Error("Gateway changed during evaluation; this mixed-version run is not release evidence");
}
if (sha256(await readFile(datasetFile)) !== datasetSha256 || sha256(await readFile(preflightFile)) !== preflightSha256 ||
    sha256(JSON.stringify(await freezePhotoInputs())) !== photoInputSha256) {
  throw new Error("Dataset, photo inputs or preflight changed during evaluation; do not publish mixed-input evidence");
}
await writeFile(outputFile, `${JSON.stringify(output, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });

function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

async function readSanitizedJPEG(photo) {
  const jpeg = await readFile(photo.sanitizedFile);
  if (jpeg.length > 3 * 1024 * 1024 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8 || jpeg[2] !== 0xff) {
    throw new Error(`Invalid sanitized JPEG: ${photo.fileName}`);
  }
  return jpeg;
}

async function freezePhotoInputs() {
  const identities = [];
  const names = new Set();
  const hashes = new Set();
  for (const photo of eligible) {
    if (!metadataByName.has(photo.fileName) || names.has(photo.fileName)) throw new Error("Missing or duplicate photo metadata");
    if (photo.faceCount !== 0 || !Array.isArray(photo.sensitiveFlags) || photo.sensitiveFlags.length !== 0 || !Array.isArray(photo.labels)) {
      throw new Error(`Unsafe or incomplete privacy preflight: ${photo.fileName}`);
    }
    const sanitizedSha256 = sha256(await readSanitizedJPEG(photo));
    if (hashes.has(sanitizedSha256)) throw new Error("Duplicate sanitized JPEG bytes cannot count as distinct evaluation photos");
    names.add(photo.fileName);
    hashes.add(sanitizedSha256);
    identities.push({ fileName: photo.fileName, sanitizedSha256 });
  }
  return identities;
}

async function readRuntimeProvenance() {
  const response = await fetch(`${baseURL}/health/ready`, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Runtime preflight HTTP ${response.status}`);
  const { release } = await response.json();
  if (!release?.workerVersion || release.workerVersion === "local" || !release.policyVersion || !release.models) {
    throw new Error("The gateway does not expose deployed runtime provenance; refuse unversioned release evidence");
  }
  return release;
}
const passed = metrics.qualifiedRate >= 0.6 && metrics.slidingNineCoverageRate >= 0.95 &&
  metrics.sourceReachabilityRate === 1 && dailyGroups.every((group) => group.winnerCardId) && metrics.fallbackDailySelections === 0;
if (isPilot) {
  process.stdout.write(`PRODUCT_PHOTO_PILOT=COMPLETE ready=${metrics.ready}/${metrics.photos} sources=${metrics.reachableSources}/${metrics.sources}\n`);
} else {
  process.stdout.write(`PRODUCT_PHOTO_EVAL=${passed ? "PASS" : "FAIL"} ready=${metrics.ready}/60 nineCoverage=${metrics.slidingNineCoverageRate} sources=${metrics.reachableSources}/${metrics.sources}\n`);
  if (!passed) process.exitCode = 1;
}

async function deviceFor(index) {
  if (checkpoint.devices[index]) return checkpoint.devices[index];
  const registration = await requestJSON("/v1/devices/register", {
    method: "POST",
    timeout: 20_000,
    body: { installationId: stableUUID(`${runID}\0device\0${index}`) }
  });
  if (typeof registration.deviceId !== "string" || typeof registration.deviceToken !== "string") {
    throw new Error("Invalid device registration response");
  }
  checkpoint.devices[index] = { deviceId: registration.deviceId, deviceToken: registration.deviceToken };
  await saveCheckpoint();
  return checkpoint.devices[index];
}

async function requestJSON(route, { method, body, token, idempotencyKey, timeout }) {
  let lastError = null;
  // The gateway protects an in-flight model call with a five-minute lease.
  // Keep polling the same idempotency key through that lease so a worker that
  // disappears after reserving the key can be safely taken over without
  // issuing a second concurrent model request.
  const maxAttempts = route === "/v1/photo-insights" ? 80 : 3;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const headers = { "content-type": "application/json" };
      if (token) headers.authorization = `Bearer ${token}`;
      if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
      if (process.env.JIANWEI_EVALUATION_KEY) {
        headers["x-jianwei-evaluation-key"] = process.env.JIANWEI_EVALUATION_KEY;
      }
      const response = await requestJSONOverHTTP1(`${baseURL}${route}`, { method, headers, body, timeout });
      const payload = response.payload;
      if (response.status < 200 || response.status >= 300) {
        const code = payload?.error?.code ?? "unknown";
        const policy = retryPolicyForHTTP(route, response.status, code);
        if (!policy.retry) {
          throw new Error(`${route} HTTP ${response.status} ${code}`);
        }
        throw new RetryableError(`${route} HTTP ${response.status} ${code}`, policy.maxAttempts, policy.kind);
      }
      return payload;
    } catch (error) {
      lastError = error;
      if (!(error instanceof RetryableError)) throw error;
      const retryLimit = Math.min(maxAttempts, error.maxAttempts);
      if (attempt >= retryLimit - 1) throw error;
      if (attempt < retryLimit - 1) {
        process.stderr.write(`retry ${route} ${attempt + 1}/${retryLimit} ${error.retryKind}: ${error.message}\n`);
        await delay(Math.min(10_000, 1_000 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

function requestJSONOverHTTP1(rawURL, { method, headers, body, timeout }) {
  const encodedBody = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = httpsRequest(rawURL, {
      method,
      headers: {
        ...headers,
        "content-length": Buffer.byteLength(encodedBody)
      },
      agent: false
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let payload = {};
        try { payload = text ? JSON.parse(text) : {}; }
        catch { payload = {}; }
        resolve({ status: response.statusCode ?? 0, payload });
      });
    });
    request.setTimeout(timeout, () => {
      const policy = retryPolicyForTransport(new URL(rawURL).pathname);
      request.destroy(new RetryableError("HTTP request timed out", policy.maxAttempts, policy.kind));
    });
    request.on("error", (error) => {
      if (error instanceof RetryableError) {
        reject(error);
        return;
      }
      const policy = retryPolicyForTransport(new URL(rawURL).pathname);
      reject(new RetryableError(`HTTP transport error: ${error.code ?? error.name ?? "unknown"}`, policy.maxAttempts, policy.kind));
    });
    request.end(encodedBody);
  });
}

function validateInsightResponse(value, candidateId) {
  if (!value || typeof value !== "object" || value.candidateId !== candidateId || !["ready", "no_insight"].includes(value.status)) {
    throw new Error("Invalid photo insight response");
  }
  if (value.status === "no_insight") {
    if (value.card != null) throw new Error("no_insight must not contain a card");
    return {
      status: value.status,
      reason: String(value.reason ?? "unknown"),
      evaluationDiagnostics: Array.isArray(value.evaluationDiagnostics) ? value.evaluationDiagnostics : [],
      scores: null,
      card: null
    };
  }
  const card = value.card;
  const scores = value.scores;
  if (!card || typeof card !== "object" || !scores || typeof scores !== "object" ||
      typeof card.cardId !== "string" || typeof card.detectedObjectName !== "string" ||
      typeof card.title !== "string" || typeof card.body !== "string" || !Array.isArray(card.sources) || card.sources.length < 1) {
    throw new Error("ready insight is incomplete");
  }
  for (const key of ["surprise", "aha", "retellability", "imageConnection"]) {
    if (!Number.isFinite(scores[key]) || scores[key] < 1 || scores[key] > 5) throw new Error(`Invalid score: ${key}`);
  }
  return { status: value.status, reason: null, scores, card };
}

async function sourceReachable(rawURL) {
  const url = new URL(rawURL);
  if (url.protocol !== "https:" || url.username || url.password) return false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Range: "bytes=0-4095", "user-agent": "JianweiReleaseEvaluation/1.0" },
        redirect: "follow",
        signal: AbortSignal.timeout(20_000)
      });
      await response.body?.cancel();
      if (response.ok) return true;
    } catch {
      // A source page can be slow or briefly rate-limited; retry once before failing closed.
    }
    if (attempt < 2) await delay(1_000 * (2 ** attempt));
  }
  return false;
}

async function mapWithConcurrency(values, limit, mapper) {
  const output = new Array(values.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      output[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return output;
}

async function saveCheckpoint() {
  checkpointWriteQueue = checkpointWriteQueue.then(() =>
    writeFile(checkpointFile, `${JSON.stringify(checkpoint, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
  );
  await checkpointWriteQueue;
}

async function readOptionalJSON(file) {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}

function stableUUID(value) {
  const bytes = Buffer.from(createHash("sha256").update(value).digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function rounded(value) { return Math.round(value * 10_000) / 10_000; }
function delay(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
function requiredValue(flag) { const value = optionalValue(flag); if (!value) throw new Error(`${flag} is required`); return value; }
function optionalValue(flag) { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : null; }
