import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const SENSITIVE_TYPES = new Set([
  "face",
  "selfie",
  "identity_document",
  "bank_card",
  "receipt",
  "document",
  "high_text_density",
  "screenshot"
]);
const AUTOMATION_ID = /(?:codex|chatgpt|gpt|kimi|moonshot|qwen|claude|gemini|llama|automation|robot)/i;

export function compileImageEvaluation({ labels, results, catalog, labelsSha256, resultsSha256, now = new Date() }) {
  assertPlainObject(labels, "labels");
  assertExactKeys(labels, ["schemaVersion", "evidenceKind", "datasetId", "evidenceOwner", "evidenceRef", "labeledAt", "samples"], "labels");
  assert(labels.schemaVersion === 1 && labels.evidenceKind === "authorized_image_labels", "Labels schema or evidence kind is invalid");
  assert(validToken(labels.datasetId), "Labels datasetId is invalid");
  assert(validHumanId(labels.evidenceOwner), "Labels evidenceOwner must identify an accountable human");
  assert(boundedText(labels.evidenceRef, 1, 500), "Labels evidenceRef is required");
  const labeledAt = strictIso(labels.labeledAt);
  assert(labeledAt && labeledAt <= now, "Labels labeledAt must be a non-future strict ISO timestamp");
  assert(Array.isArray(labels.samples) && labels.samples.length >= 300 && labels.samples.length <= 500, "Labels must contain 300-500 samples");

  assertPlainObject(results, "results");
  assertExactKeys(results, ["schemaVersion", "evidenceKind", "datasetId", "runId", "evidenceRef", "appVersion", "evaluationApkSha256", "modelVersion", "catalogVersion", "evaluatedAt", "runnerProvenance", "samples"], "results");
  assert(results.schemaVersion === 1 && results.evidenceKind === "image_pipeline_results", "Results schema or evidence kind is invalid");
  assert(results.datasetId === labels.datasetId, "Labels and results datasetId do not match");
  assert(validToken(results.runId), "Results runId is invalid");
  assert(boundedText(results.evidenceRef, 1, 500), "Results evidenceRef is required");
  assert(boundedText(results.appVersion, 1, 100) && boundedText(results.modelVersion, 1, 200), "Results appVersion/modelVersion are required");
  assert(/^[a-f0-9]{64}$/.test(results.evaluationApkSha256 ?? ""), "Results evaluation APK SHA-256 is required");
  assertPlainObject(catalog, "catalog");
  assert(typeof catalog.version === "string" && Array.isArray(catalog.topics), "Catalog is invalid");
  assert(results.catalogVersion === catalog.version, "Results catalogVersion is stale");
  const evaluatedAt = strictIso(results.evaluatedAt);
  assert(evaluatedAt && evaluatedAt <= now && evaluatedAt >= labeledAt, "Results evaluatedAt must follow labeling and not be in the future");
  validateRunnerProvenance(results.runnerProvenance, {
    labeledAt,
    evaluatedAt,
    appVersion: results.appVersion,
    evaluationApkSha256: results.evaluationApkSha256
  });
  assert(Array.isArray(results.samples) && results.samples.length === labels.samples.length, "Results must contain exactly one row per label");
  assert(/^[a-f0-9]{64}$/.test(labelsSha256 ?? "") && /^[a-f0-9]{64}$/.test(resultsSha256 ?? ""), "Input artifact SHA-256 values are required");

  const topicIds = new Set(catalog.topics.map((topic) => topic?.topicId));
  assert(topicIds.size === catalog.topics.length && !topicIds.has(undefined), "Catalog topic IDs are invalid or duplicated");
  const labelsById = new Map();
  const imageHashes = new Set();
  for (const sample of labels.samples) {
    validateLabelSample(sample, { labeledAt, topicIds });
    assert(!labelsById.has(sample.sampleId), `Duplicate label sampleId: ${sample.sampleId}`);
    assert(!imageHashes.has(sample.sampleSha256), `Duplicate image SHA-256: ${sample.sampleSha256}`);
    labelsById.set(sample.sampleId, sample);
    imageHashes.add(sample.sampleSha256);
  }

  const resultsById = new Map();
  for (const sample of results.samples) {
    validateResultSample(sample, topicIds);
    assert(!resultsById.has(sample.sampleId), `Duplicate result sampleId: ${sample.sampleId}`);
    const label = labelsById.get(sample.sampleId);
    assert(label, `Result has no matching label: ${sample.sampleId}`);
    assert(sample.sampleSha256 === label.sampleSha256, `Image SHA-256 mismatch: ${sample.sampleId}`);
    resultsById.set(sample.sampleId, sample);
  }
  for (const sampleId of labelsById.keys()) assert(resultsById.has(sampleId), `Label has no matching result: ${sampleId}`);

  const sensitive = labels.samples.filter((sample) => sample.expectedSensitiveTypes.length > 0);
  const recognition = labels.samples.filter((sample) => sample.expectedSensitiveTypes.length === 0);
  assert(sensitive.length >= 100, "Dataset must include at least 100 sensitive samples");
  assert(recognition.length >= 100, "Dataset must include at least 100 recognition samples");
  const sensitiveCounts = Object.fromEntries([...SENSITIVE_TYPES].map((type) => [type, 0]));
  for (const sample of sensitive) for (const type of sample.expectedSensitiveTypes) sensitiveCounts[type] += 1;
  for (const [type, count] of Object.entries(sensitiveCounts)) assert(count >= 5, `Sensitive type ${type} must have at least 5 samples`);
  const topicCounts = new Map();
  for (const sample of recognition) topicCounts.set(sample.expectedTopicId, (topicCounts.get(sample.expectedTopicId) ?? 0) + 1);
  assert(topicCounts.size >= 25, "Recognition dataset must cover at least 25 topics");
  for (const [topicId, count] of topicCounts) assert(count >= 3, `Recognition topic ${topicId} must have at least 3 samples`);

  const evaluationSamples = labels.samples.map((label) => {
    const result = resultsById.get(label.sampleId);
    return {
      sampleId: label.sampleId,
      sampleSha256: label.sampleSha256,
      authorized: true,
      authorizationRef: label.authorizationRef,
      authorizationScope: label.authorizationScope,
      authorizedAt: label.authorizedAt,
      labelerId: labels.evidenceOwner,
      labeledAt: labels.labeledAt,
      expectedSensitiveTypes: [...label.expectedSensitiveTypes],
      expectedTopicId: label.expectedTopicId,
      pipelineCompleted: true,
      leftDevice: result.leftDevice,
      predictedTopicId: result.predictedTopicId,
      evaluatedAt: results.evaluatedAt
    };
  });
  const leaks = evaluationSamples.filter((sample) => sample.expectedSensitiveTypes.length > 0 && sample.leftDevice).length;
  const correct = evaluationSamples.filter((sample) => sample.expectedSensitiveTypes.length === 0 && sample.predictedTopicId === sample.expectedTopicId).length;
  const generatedAt = now.toISOString();
  const artifact = {
    schemaVersion: 1,
    evidenceKind: "compiled_image_evaluation",
    generatedAt,
    evaluationProvenance: {
      datasetId: labels.datasetId,
      labelEvidenceRef: labels.evidenceRef,
      resultEvidenceRef: results.evidenceRef,
      labelEvidenceSha256: labelsSha256,
      resultEvidenceSha256: resultsSha256,
      runId: results.runId,
      appVersion: results.appVersion,
      evaluationApkSha256: results.evaluationApkSha256,
      modelVersion: results.modelVersion,
      catalogVersion: results.catalogVersion,
      runnerProvenance: structuredClone(results.runnerProvenance)
    },
    metrics: {
      samples: evaluationSamples.length,
      sensitiveSamples: sensitive.length,
      sensitiveTypeCounts: sensitiveCounts,
      sensitiveLeakRate: leaks / sensitive.length,
      recognitionSamples: recognition.length,
      recognitionTopics: topicCounts.size,
      minimumSamplesPerRecognitionTopic: Math.min(...topicCounts.values()),
      top1Accuracy: correct / recognition.length
    },
    evaluationSamples
  };
  return artifact;
}

function validateLabelSample(sample, { labeledAt, topicIds }) {
  assertPlainObject(sample, "label sample");
  assertExactKeys(sample, ["sampleId", "sampleSha256", "authorized", "authorizationRef", "authorizationScope", "authorizedAt", "expectedSensitiveTypes", "expectedTopicId"], `label sample ${sample.sampleId ?? "<missing>"}`);
  assert(validToken(sample.sampleId), "Label sampleId is invalid");
  assert(/^[a-f0-9]{64}$/.test(sample.sampleSha256 ?? ""), `Label sample SHA-256 is invalid: ${sample.sampleId}`);
  assert(sample.authorized === true && boundedText(sample.authorizationRef, 1, 500), `Sample authorization is missing: ${sample.sampleId}`);
  assert(sample.authorizationScope === "local_and_cloud_evaluation", `Sample does not authorize the complete local-and-cloud evaluation: ${sample.sampleId}`);
  const authorizedAt = strictIso(sample.authorizedAt);
  assert(authorizedAt && authorizedAt <= labeledAt, `Sample authorization timestamp is invalid: ${sample.sampleId}`);
  assert(Array.isArray(sample.expectedSensitiveTypes), `Sensitive types must be an array: ${sample.sampleId}`);
  assert(new Set(sample.expectedSensitiveTypes).size === sample.expectedSensitiveTypes.length, `Sensitive types are duplicated: ${sample.sampleId}`);
  assert(sample.expectedSensitiveTypes.every((type) => SENSITIVE_TYPES.has(type)), `Sensitive type is invalid: ${sample.sampleId}`);
  if (sample.expectedSensitiveTypes.length > 0) {
    assert(sample.expectedTopicId === null, `Sensitive sample must not carry an expected topic: ${sample.sampleId}`);
  } else {
    assert(typeof sample.expectedTopicId === "string" && topicIds.has(sample.expectedTopicId), `Recognition topic is invalid: ${sample.sampleId}`);
  }
}

function validateResultSample(sample, topicIds) {
  assertPlainObject(sample, "result sample");
  assertExactKeys(sample, ["sampleId", "sampleSha256", "pipelineCompleted", "leftDevice", "predictedTopicId"], `result sample ${sample.sampleId ?? "<missing>"}`);
  assert(validToken(sample.sampleId), "Result sampleId is invalid");
  assert(/^[a-f0-9]{64}$/.test(sample.sampleSha256 ?? ""), `Result sample SHA-256 is invalid: ${sample.sampleId}`);
  assert(sample.pipelineCompleted === true, `Pipeline did not complete: ${sample.sampleId}`);
  assert(typeof sample.leftDevice === "boolean", `leftDevice must be explicit: ${sample.sampleId}`);
  assert(sample.predictedTopicId === null || (typeof sample.predictedTopicId === "string" && topicIds.has(sample.predictedTopicId)), `Predicted topic is invalid: ${sample.sampleId}`);
}

function validateRunnerProvenance(value, { labeledAt, evaluatedAt, appVersion, evaluationApkSha256 }) {
  assertPlainObject(value, "Android image runner provenance");
  assertExactKeys(value, [
    "evidenceKind", "reviewerId", "approvedAt", "appVersion", "evaluationApkSha256", "manufacturer", "model",
    "buildFingerprint", "apiLevel", "endpointOrigin"
  ], "Android image runner provenance");
  assert(value.evidenceKind === "android_authorized_image_runner", "Image results must come from the Android authorized-image runner");
  assert(validHumanId(value.reviewerId), "Android image runner must identify an accountable human reviewer");
  const approvedAt = strictIso(value.approvedAt);
  assert(approvedAt && approvedAt >= labeledAt && approvedAt <= evaluatedAt, "Android image runner approval time is invalid");
  assert(value.appVersion === appVersion, "Android image runner App version does not match the result artifact");
  assert(value.evaluationApkSha256 === evaluationApkSha256, "Android image runner APK SHA-256 does not match the result artifact");
  assert(boundedText(value.manufacturer, 1, 100) && boundedText(value.model, 1, 200), "Android image runner device identity is incomplete");
  assert(boundedText(value.buildFingerprint, 1, 1000) && !emulatorFingerprint(value.buildFingerprint), "Android image runner must use a physical device");
  assert(Number.isInteger(value.apiLevel) && value.apiLevel >= 26, "Android image runner API level is invalid");
  assert(publicHttpsOrigin(value.endpointOrigin), "Android image runner must use a public origin-only HTTPS endpoint");
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  assert(actual.length === wanted.length && actual.every((key, index) => key === wanted[index]), `${label} fields do not match the schema`);
}

function assertPlainObject(value, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
}

function validToken(value) {
  return typeof value === "string" && /^[A-Za-z0-9._-]{3,128}$/.test(value);
}

function validHumanId(value) {
  return typeof value === "string" && value.length <= 128 && /^[\p{L}\p{N}._@-]+$/u.test(value) &&
    !AUTOMATION_ID.test(value) && !/(?:^|[._@-])(?:ai|bot)(?:$|[._@-])/i.test(value);
}

function boundedText(value, minimum, maximum) {
  return typeof value === "string" && value.trim() === value && value.length >= minimum && value.length <= maximum;
}

function emulatorFingerprint(value) {
  return /(?:generic|sdk_gphone|emulator|goldfish|ranchu|aosp_|google\/sdk|unknown\/unknown)/i.test(String(value ?? ""));
}

function publicHttpsOrigin(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || !host || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return false;
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".invalid")) return false;
    if (/^(?:127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host)) return false;
    const private172 = /^172\.(\d{1,3})\./.exec(host);
    return !(private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) && host !== "[::1]" && host !== "::1";
  } catch {
    return false;
  }
}

function strictIso(value) {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value ? parsed : null;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseArgs(values) {
  const args = new Map();
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (key === "--write" || key === "--self-test") args.set(key, true);
    else if (key.startsWith("--")) args.set(key, values[++index]);
    else throw new Error(`Unexpected argument: ${key}`);
  }
  return args;
}

function fixture() {
  const labeledAt = "2026-07-19T00:01:00.000Z";
  const evaluatedAt = "2026-07-19T00:02:00.000Z";
  const topics = Array.from({ length: 25 }, (_, index) => ({ topicId: `topic-${index}` }));
  const labels = [];
  const results = [];
  const types = [...SENSITIVE_TYPES];
  for (let index = 0; index < 300; index += 1) {
    const sampleId = `sample-${index}`;
    const sampleSha256 = createHash("sha256").update(sampleId).digest("hex");
    const sensitive = index < 100;
    const expectedTopicId = sensitive ? null : topics[(index - 100) % topics.length].topicId;
    labels.push({
      sampleId,
      sampleSha256,
      authorized: true,
      authorizationRef: `consent-${Math.floor(index / 10)}`,
      authorizationScope: "local_and_cloud_evaluation",
      authorizedAt: "2026-07-19T00:00:00.000Z",
      expectedSensitiveTypes: sensitive ? [types[index % types.length]] : [],
      expectedTopicId
    });
    results.push({ sampleId, sampleSha256, pipelineCompleted: true, leftDevice: !sensitive, predictedTopicId: expectedTopicId });
  }
  return {
    catalog: { version: "fixture-beta.1", topics },
    labels: { schemaVersion: 1, evidenceKind: "authorized_image_labels", datasetId: "fixture-dataset", evidenceOwner: "human-evaluator", evidenceRef: "retained-label-evidence", labeledAt, samples: labels },
    results: {
      schemaVersion: 1,
      evidenceKind: "image_pipeline_results",
      datasetId: "fixture-dataset",
      runId: "fixture-run",
      evidenceRef: "retained-result-evidence",
      appVersion: "fixture-app",
      evaluationApkSha256: "c".repeat(64),
      modelVersion: "fixture-model",
      catalogVersion: "fixture-beta.1",
      evaluatedAt,
      runnerProvenance: {
        evidenceKind: "android_authorized_image_runner",
        reviewerId: "human-image-runner",
        approvedAt: labeledAt,
        appVersion: "fixture-app",
        evaluationApkSha256: "c".repeat(64),
        manufacturer: "Huawei",
        model: "fixture-physical-device",
        buildFingerprint: "huawei/fixture/release-keys",
        apiLevel: 34,
        endpointOrigin: "https://beta.jianwei.example"
      },
      samples: results
    }
  };
}

function expectFailure(mutate, label) {
  const value = fixture();
  mutate(value);
  let failed = false;
  try {
    compileImageEvaluation({ ...value, labelsSha256: "a".repeat(64), resultsSha256: "b".repeat(64), now: new Date("2026-07-19T00:03:00.000Z") });
  } catch {
    failed = true;
  }
  if (!failed) throw new Error(`Compiler self-test accepted ${label}`);
}

const args = parseArgs(process.argv.slice(2));
if (args.has("--self-test")) {
  const value = fixture();
  const artifact = compileImageEvaluation({ ...value, labelsSha256: "a".repeat(64), resultsSha256: "b".repeat(64), now: new Date("2026-07-19T00:03:00.000Z") });
  assert(artifact.metrics.samples === 300 && artifact.metrics.sensitiveSamples === 100 && artifact.metrics.recognitionTopics === 25, "Compiler self-test metrics are wrong");
  expectFailure((item) => { item.results.samples.pop(); }, "a missing result");
  expectFailure((item) => { item.results.samples[0].pipelineCompleted = false; }, "an incomplete pipeline result");
  expectFailure((item) => { item.results.samples[0].sampleSha256 = "f".repeat(64); }, "a hash mismatch");
  expectFailure((item) => { item.labels.evidenceOwner = "codex-bot"; }, "an automation labeler");
  expectFailure((item) => { item.labels.samples[0].authorizationScope = "local_only"; }, "an incomplete evaluation authorization scope");
  expectFailure((item) => { item.results.catalogVersion = "fixture-beta.0"; }, "a stale catalog");
  expectFailure((item) => { item.results.runnerProvenance.reviewerId = "qwen-bot"; }, "an automated runner reviewer");
  expectFailure((item) => { item.results.runnerProvenance.buildFingerprint = "google/sdk_gphone64_x86_64/emulator"; }, "an emulator runner");
  expectFailure((item) => { item.results.runnerProvenance.endpointOrigin = "http://10.0.2.2:8787"; }, "a non-production runner endpoint");
  expectFailure((item) => { item.labels.samples[1].sampleSha256 = item.labels.samples[0].sampleSha256; item.results.samples[1].sampleSha256 = item.results.samples[0].sampleSha256; }, "duplicate image bytes");
  expectFailure((item) => { item.results.runnerProvenance.evaluationApkSha256 = "d".repeat(64); }, "a split evaluation APK digest");
  process.stdout.write("IMAGE_EVALUATION_COMPILER_SELF_TEST=GO synthetic=1 releaseEvidence=0 bypassesRejected=11 samples=300 sensitiveTypes=8 recognitionTopics=25 cloudAuthorization=1 androidRunner=1 physicalDevice=1 httpsEndpoint=1 apkShaBinding=1\n");
  process.exit(0);
}

const labelsPath = path.resolve(process.cwd(), String(args.get("--labels") ?? "evaluation/image-labels.json"));
const resultsPath = path.resolve(process.cwd(), String(args.get("--results") ?? "evaluation/image-results.json"));
const catalogPath = path.resolve(process.cwd(), String(args.get("--catalog") ?? "knowledge/catalog.json"));
const outputPath = path.resolve(process.cwd(), String(args.get("--output") ?? "evaluation/compiled-image-evaluation.json"));
const [labelsBytes, resultsBytes, catalogBytes] = await Promise.all([readFile(labelsPath), readFile(resultsPath), readFile(catalogPath)]);
const artifact = compileImageEvaluation({
  labels: JSON.parse(labelsBytes.toString("utf8")),
  results: JSON.parse(resultsBytes.toString("utf8")),
  catalog: JSON.parse(catalogBytes.toString("utf8")),
  labelsSha256: sha256(labelsBytes),
  resultsSha256: sha256(resultsBytes)
});
if (!args.has("--write")) {
  process.stdout.write(`IMAGE_EVALUATION_PREVIEW=GO dataset=${artifact.evaluationProvenance.datasetId} samples=${artifact.metrics.samples} sensitive=${artifact.metrics.sensitiveSamples} recognition=${artifact.metrics.recognitionSamples} topics=${artifact.metrics.recognitionTopics} leakRate=${artifact.metrics.sensitiveLeakRate} top1=${artifact.metrics.top1Accuracy} wrote=0\n`);
  process.exit(0);
}
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
process.stdout.write(`IMAGE_EVALUATION_COMPILE=GO dataset=${artifact.evaluationProvenance.datasetId} samples=${artifact.metrics.samples} sensitive=${artifact.metrics.sensitiveSamples} recognition=${artifact.metrics.recognitionSamples} topics=${artifact.metrics.recognitionTopics} leakRate=${artifact.metrics.sensitiveLeakRate} top1=${artifact.metrics.top1Accuracy} wrote=1\n`);
