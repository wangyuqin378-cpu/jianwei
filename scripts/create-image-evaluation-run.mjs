import { createHash } from "node:crypto";
import { lstat, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { parseFlagArgs, requiredString } from "./lib/fact-review.mjs";
import { createImageEvaluationRunManifest, validateImageEvaluationRunInputs } from "./lib/image-evaluation-run.mjs";

if (process.argv.includes("--self-test")) {
  const { labels, labelsBytes } = fixtureLabels();
  const manifest = createImageEvaluationRunManifest({
    labels,
    labelsBytes,
    runId: "synthetic-image-run",
    resultEvidenceRef: "controlled://image-evaluation/synthetic-run",
    appVersion: "0.1.0-beta-test",
    evaluationApkSha256: "a".repeat(64),
    modelVersion: "qwen-fixed-test",
    catalogVersion: "fixture-catalog",
    now: new Date("2026-01-02T00:00:00.000Z")
  });
  validateImageEvaluationRunInputs({ labels, labelsBytes, manifest, now: new Date("2026-01-02T00:01:00.000Z") });
  let rejected = 0;
  const reject = (operation) => {
    try { operation(); } catch { rejected += 1; return; }
    throw new Error("Image evaluation run manifest accepted an invalid fixture");
  };
  reject(() => createImageEvaluationRunManifest({
    labels: { ...labels, evidenceOwner: "qwen-bot" }, labelsBytes, runId: "synthetic-image-run",
    resultEvidenceRef: "controlled://image-evaluation/synthetic-run", appVersion: "test",
    evaluationApkSha256: "a".repeat(64),
    modelVersion: "test", catalogVersion: "fixture-catalog"
  }));
  reject(() => {
    const changed = structuredClone(labels);
    changed.samples[0].authorizationScope = "local_only";
    const changedBytes = Buffer.from(`${JSON.stringify(changed, null, 2)}\n`, "utf8");
    createImageEvaluationRunManifest({
      labels: changed, labelsBytes: changedBytes, runId: "synthetic-image-run",
      resultEvidenceRef: "controlled://image-evaluation/synthetic-run", appVersion: "test",
      evaluationApkSha256: "a".repeat(64),
      modelVersion: "test", catalogVersion: "fixture-catalog"
    });
  });
  reject(() => validateImageEvaluationRunInputs({
    labels, labelsBytes, manifest: { ...manifest, labelsSha256: "0".repeat(64) }
  }));
  reject(() => validateImageEvaluationRunInputs({
    labels: { ...labels, datasetId: "parsed-only-change" }, labelsBytes, manifest
  }));
  reject(() => validateImageEvaluationRunInputs({
    labels, labelsBytes, manifest: { ...manifest, evaluationApkSha256: "0".repeat(63) }
  }));
  if (rejected !== 5) throw new Error(`Expected 5 rejected image-run bypasses, observed ${rejected}`);
  process.stdout.write("IMAGE_EVALUATION_RUN_MANIFEST_SELF_TEST=GO synthetic=1 releaseEvidence=0 labelsShaBinding=1 apkShaBinding=1 cloudAuthorization=1 preconfirmed=0 photoBytesRead=0 bypassesRejected=5\n");
  process.exit(0);
}

const args = parseFlagArgs(process.argv.slice(2));
const labelsPath = path.resolve(process.cwd(), requiredString(args, "--labels"));
const labelsBytes = await readFile(labelsPath);
const labels = JSON.parse(labelsBytes.toString("utf8"));
const apkPath = path.resolve(process.cwd(), requiredString(args, "--apk"));
const apkInfo = await lstat(apkPath);
if (!apkInfo.isFile() || apkInfo.isSymbolicLink() || !samePath(await realpath(apkPath), apkPath)) {
  throw new Error("Image evaluation APK must be an ordinary non-linked file");
}
const evaluationApkSha256 = createHash("sha256").update(await readFile(apkPath)).digest("hex");
const manifest = createImageEvaluationRunManifest({
  labelsBytes,
  labels,
  runId: requiredString(args, "--run-id"),
  resultEvidenceRef: requiredString(args, "--evidence-ref"),
  appVersion: requiredString(args, "--app-version"),
  evaluationApkSha256,
  modelVersion: requiredString(args, "--model-version"),
  catalogVersion: requiredString(args, "--catalog-version")
});
if (!args.has("--write")) {
  process.stdout.write(`IMAGE_EVALUATION_RUN_MANIFEST_PREVIEW=GO dataset=${manifest.datasetId} run=${manifest.runId} labelsSha256=${manifest.labelsSha256} preconfirmed=0 photoBytesRead=0 wrote=0\n`);
  process.exit(0);
}
const outputValue = requiredString(args, "--output");
const output = path.resolve(process.cwd(), outputValue);
if (path.basename(output) !== "image-evaluation-run.json") {
  throw new Error("Image evaluation run manifest output filename must be image-evaluation-run.json");
}
const outputDirectory = path.dirname(output);
const outputInfo = await lstat(outputDirectory);
if (!outputInfo.isDirectory() || outputInfo.isSymbolicLink() || !samePath(await realpath(outputDirectory), outputDirectory)) {
  throw new Error("Image evaluation run manifest output directory must be an ordinary non-linked directory");
}
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
process.stdout.write(`IMAGE_EVALUATION_RUN_MANIFEST=GO dataset=${manifest.datasetId} run=${manifest.runId} labelsSha256=${manifest.labelsSha256} preconfirmed=0 photoBytesRead=0 wrote=1\n`);

function fixtureLabels() {
  const labels = {
    schemaVersion: 1,
    evidenceKind: "authorized_image_labels",
    datasetId: "synthetic-authorized-dataset",
    evidenceOwner: "human-image-owner",
    evidenceRef: "controlled://image-evaluation/labels",
    labeledAt: "2026-01-01T00:01:00.000Z",
    samples: Array.from({ length: 300 }, (_, index) => ({
      sampleId: `sample-${index}`,
      sampleSha256: index.toString(16).padStart(64, "0"),
      authorized: true,
      authorizationRef: `consent-${Math.floor(index / 10)}`,
      authorizationScope: "local_and_cloud_evaluation",
      authorizedAt: "2026-01-01T00:00:00.000Z",
      expectedSensitiveTypes: index < 100 ? ["face"] : [],
      expectedTopicId: index < 100 ? null : `topic-${(index - 100) % 25}`
    }))
  };
  return { labels, labelsBytes: Buffer.from(`${JSON.stringify(labels, null, 2)}\n`, "utf8") };
}

function samePath(left, right) {
  const normalize = (value) => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
  return normalize(left) === normalize(right);
}
