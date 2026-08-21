import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isMainModule } from "./lib/main-module.mjs";
import { validateContainerSecurityEvidenceArtifact } from "./check-container-security-evidence.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const REQUIRED_MIGRATION = "015_feedback_affinity_contributions";
const REQUIRED_ROOM_VERSION = 15;
const REQUIRED_RELEASE_ABIS = ["arm64-v8a", "armeabi-v7a"];
const MAX_RELEASE_APK_BYTES = 70 * 1024 * 1024;

export function assessReleaseCandidate(input) {
  const blockers = [];
  if (input.catalog?.version !== "2026-07-28-beta.64") blockers.push("knowledge catalog version is not Beta.64");
  if (!isSha256(input.catalog?.sha256)) blockers.push("knowledge catalog SHA-256 is invalid");
  if (!isSha256(input.backend?.releaseSha256) || input.backend?.fileCount < 1) blockers.push("backend Release identity is invalid");
  if (input.database?.latestMigrationId !== REQUIRED_MIGRATION || input.database?.migrationCount !== 15 || input.database?.migrations?.length !== 15) {
    blockers.push("database migration chain must end at 015_feedback_affinity_contributions with 15 migrations");
  }
  if (input.database?.migrations?.some((migration) => !isSha256(migration.sha256))) blockers.push("database migration checksum is invalid");
  if (input.api?.cardBoundingBoxRequired !== true || input.api?.boundingBoxNullable !== true || !isSha256(input.api?.openApiSha256)) {
    blockers.push("OpenAPI does not require the nullable boundingBox field");
  }
  if (
    input.android?.roomSchemaVersion !== REQUIRED_ROOM_VERSION ||
    input.android?.objectBoundsColumns !== 4 ||
    input.android?.feedbackContributionColumns !== 2
  ) {
    blockers.push("Android Room schema 15 object bounds or reversible feedback contributions are missing");
  }
  if (!isSha256(input.android?.unsignedReleaseApkSha256) || input.android?.artifactClass !== "unsigned_gradle_release_output" ||
      input.android?.cryptographicSignatureVerified !== false) {
    blockers.push("the Gradle unsigned Release output is required and must not be represented as signature-verified");
  }
  const betaVersion = /^0\.1\.0-beta([1-9]\d*)$/.exec(input.android?.versionName ?? "");
  if (!Number.isInteger(input.android?.versionCode) || input.android.versionCode < 1 ||
      !betaVersion || Number(betaVersion[1]) !== input.android.versionCode) {
    blockers.push("Android versionName and versionCode must identify the same positive Beta release");
  }
  if (JSON.stringify(input.android?.nativeAbis) !== JSON.stringify(REQUIRED_RELEASE_ABIS)) {
    blockers.push("Android Release APK must contain exactly the supported ARM ABIs");
  }
  if (!Number.isInteger(input.android?.unsignedReleaseApkBytes) || input.android.unsignedReleaseApkBytes < 1 ||
      input.android.unsignedReleaseApkBytes > MAX_RELEASE_APK_BYTES) {
    blockers.push("Android Release APK must stay within the 70 MiB controlled-Beta budget");
  }
  if (input.android?.minSdk !== 26 || input.android?.targetSdk !== 36) blockers.push("Android SDK contract drifted");
  if (!isSha256(input.deployment?.dockerfileSha256) || !isSha256(input.deployment?.manifestTemplateSha256)) {
    blockers.push("deployment template identity is invalid");
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(input.containerSecurity?.imageId ?? "") ||
      !isSha256(input.containerSecurity?.evidenceSha256) ||
      !isSha256(input.containerSecurity?.reportSha256) ||
      !isSha256(input.containerSecurity?.sbomSha256) ||
      input.containerSecurity?.artifactClass !== "local_container_security_scan" ||
      input.containerSecurity?.releaseEvidence !== false ||
      !String(input.containerSecurity?.scannerVersion ?? "").trim() ||
      !Number.isInteger(input.containerSecurity?.components) || input.containerSecurity.components < 1 ||
      !Number.isInteger(input.containerSecurity?.highCritical) || input.containerSecurity.highCritical < 0 ||
      input.containerSecurity?.fixableHighCritical !== 0) {
    blockers.push("container security evidence is missing, stale, or has fixable HIGH/CRITICAL findings");
  }
  if (!isSha256(input.assemblerSha256)) blockers.push("release candidate assembler identity is invalid");
  const expectedOrder = ["apply_database_migrations", "deploy_backend_image", "verify_health_and_cloud_path", "sign_and_distribute_android"];
  if (JSON.stringify(input.rollout?.requiredOrder) !== JSON.stringify(expectedOrder)) blockers.push("release rollout order is unsafe");
  if (input.compatibility?.newAndroidAcceptsLegacyCards !== true || input.compatibility?.oldAndroidIgnoresBoundingBox !== true ||
      input.compatibility?.databaseRollback !== "forward_only_keep_015") {
    blockers.push("release compatibility or rollback contract is incomplete");
  }
  return {
    status: blockers.length === 0 ? "LOCAL_CANDIDATE_GO" : "NO_GO",
    releaseEvidence: false,
    blockers: [...new Set(blockers)]
  };
}

export async function assembleReleaseCandidate({
  releaseApkPath,
  debugApkPath = null,
  containerSecurityEvidencePath,
  vulnerabilityReportPath,
  sbomPath
}) {
  const backendModulePath = path.join(ROOT, "backend", "dist", "release-identity.js");
  await requireFile(backendModulePath, "backend build output; run `cd backend && pnpm build`");
  const { computeBackendReleaseIdentity } = await import(pathToFileURL(backendModulePath).href);
  const backendIdentity = await computeBackendReleaseIdentity(ROOT);

  const catalogBytes = await readFile(path.join(ROOT, "knowledge", "catalog.json"));
  const catalog = JSON.parse(catalogBytes.toString("utf8"));
  const migrations = await readMigrations(path.join(ROOT, "backend", "migrations"));
  const openApiBytes = await readFile(path.join(ROOT, "api", "openapi.json"));
  const openApi = JSON.parse(openApiBytes.toString("utf8"));
  const roomBytes = await readFile(path.join(ROOT, "android", "data", "schemas", "cn.jianwei.data.local.JianweiDatabase", "15.json"));
  const room = JSON.parse(roomBytes.toString("utf8"));
  const appBuild = await readFile(path.join(ROOT, "android", "app", "build.gradle.kts"), "utf8");
  const releaseMetadata = JSON.parse(await readFile(path.join(ROOT, "android", "app", "build", "outputs", "apk", "release", "output-metadata.json"), "utf8"));
  const resolvedReleaseApk = path.resolve(releaseApkPath);
  const releaseApk = await requireFile(resolvedReleaseApk, "unsigned Android Release APK");
  const debugApk = debugApkPath ? await requireFile(path.resolve(debugApkPath), "Android Debug APK") : null;
  const containerSecurityEvidenceBytes = await requireFile(
    path.resolve(containerSecurityEvidencePath),
    "container security evidence"
  );
  const vulnerabilityReportBytes = await requireFile(path.resolve(vulnerabilityReportPath), "container vulnerability report");
  const sbomBytes = await requireFile(path.resolve(sbomPath), "container SBOM");
  const containerSecurityEvidence = JSON.parse(containerSecurityEvidenceBytes.toString("utf8"));
  const containerSecurityValidation = validateContainerSecurityEvidenceArtifact(
    containerSecurityEvidence,
    vulnerabilityReportBytes,
    sbomBytes
  );
  if (containerSecurityValidation.status !== "GO") {
    throw new Error(`Container security evidence rejected: ${containerSecurityValidation.blockers.join("; ")}`);
  }
  const containerSecurityAssessment = containerSecurityValidation.assessment;
  const cardSchema = openApi.components?.schemas?.Card;
  const cardTable = room.database?.entities?.find((entity) => entity.tableName === "knowledge_cards");
  const objectBoundsColumns = ["objectBoxX", "objectBoxY", "objectBoxWidth", "objectBoxHeight"]
    .filter((column) => cardTable?.fields?.some((field) => field.columnName === column)).length;
  const feedbackContributionColumns = ["card_feedback_states", "saved_cards"]
    .filter((tableName) => room.database?.entities
      ?.find((entity) => entity.tableName === tableName)
      ?.fields?.some((field) => field.columnName === "affinityDeltaApplied"))
    .length;
  const releaseElement = releaseMetadata.elements?.find((element) => element.outputFile === path.basename(releaseApkPath));
  const expectedReleaseApk = releaseElement
    ? path.resolve(ROOT, "android", "app", "build", "outputs", "apk", "release", releaseElement.outputFile)
    : null;
  if (!releaseElement || !releaseElement.outputFile.includes("unsigned") || resolvedReleaseApk !== expectedReleaseApk) {
    throw new Error("--release-apk must be the exact unsigned output declared by Gradle release metadata");
  }

  const candidate = {
    schemaVersion: 1,
    evidenceKind: "local_release_candidate",
    releaseEvidence: false,
    generatedAt: new Date().toISOString(),
    status: "LOCAL_CANDIDATE_GO",
    assemblerSha256: await hashFile(fileURLToPath(import.meta.url)),
    catalog: {
      version: catalog.version,
      sha256: sha256(catalogBytes),
      topicCount: Array.isArray(catalog.topics) ? catalog.topics.length : 0
    },
    backend: {
      releaseSha256: backendIdentity.backendReleaseSha256,
      fileCount: backendIdentity.fileCount
    },
    database: {
      migrationCount: migrations.length,
      latestMigrationId: migrations.at(-1)?.id ?? null,
      migrations: migrations.map(({ id, sha256: checksum }) => ({ id, sha256: checksum }))
    },
    api: {
      openApiSha256: sha256(openApiBytes),
      cardBoundingBoxRequired: cardSchema?.required?.includes("boundingBox") === true,
      boundingBoxNullable: cardSchema?.properties?.boundingBox?.oneOf?.some((entry) => entry.type === "null") === true
    },
    android: {
      applicationId: releaseMetadata.applicationId,
      versionCode: releaseElement?.versionCode ?? null,
      versionName: releaseElement?.versionName ?? null,
      minSdk: integerFromGradle(appBuild, "minSdk"),
      targetSdk: integerFromGradle(appBuild, "targetSdk"),
      roomSchemaVersion: room.database?.version ?? null,
      roomSchemaSha256: sha256(roomBytes),
      objectBoundsColumns,
      feedbackContributionColumns,
      unsignedReleaseApkSha256: sha256(releaseApk),
      unsignedReleaseApkBytes: releaseApk.length,
      nativeAbis: nativeAbisFromApk(releaseApk),
      artifactClass: "unsigned_gradle_release_output",
      cryptographicSignatureVerified: false,
      debugApkSha256: debugApk ? sha256(debugApk) : null
    },
    deployment: {
      dockerfileSha256: await hashFile(path.join(ROOT, "deploy", "Dockerfile")),
      manifestTemplateSha256: await hashFile(path.join(ROOT, "deploy", "s.yaml.example")),
      imageDigestRequired: true,
      baseImageDigestRequired: true,
      liveProbePath: "/health/live",
      readyProbePath: "/health/ready"
    },
    containerSecurity: {
      imageId: containerSecurityAssessment.imageId,
      imageReference: containerSecurityAssessment.imageReference,
      evidenceSha256: sha256(containerSecurityEvidenceBytes),
      reportSha256: sha256(vulnerabilityReportBytes),
      sbomSha256: sha256(sbomBytes),
      scannerVersion: containerSecurityAssessment.scannerVersion,
      components: containerSecurityAssessment.metrics.components,
      highCritical: containerSecurityAssessment.metrics.highCritical,
      fixableHighCritical: containerSecurityAssessment.metrics.fixableHighCritical,
      artifactClass: "local_container_security_scan",
      releaseEvidence: false
    },
    rollout: {
      requiredOrder: ["apply_database_migrations", "deploy_backend_image", "verify_health_and_cloud_path", "sign_and_distribute_android"],
      stopBeforeAndroidUntilCloudVerified: true
    },
    compatibility: {
      migration015AdditiveDefaulted: true,
      newBackendRequiresMigration015: true,
      oldBackendRunsAfterMigration015: true,
      newAndroidAcceptsLegacyCards: true,
      oldAndroidIgnoresBoundingBox: true,
      databaseRollback: "forward_only_keep_015"
    },
    unresolvedExternalEvidence: [
      "ACR manifest digest and registry observation",
      "Function Compute readiness and guarded Qwen cloud-path verification",
      "independently signed deployment receipt",
      "signed Release APK",
      "physical OEM device and controlled Beta cohort evidence"
    ]
  };
  const assessment = assessReleaseCandidate(candidate);
  if (assessment.status !== "LOCAL_CANDIDATE_GO") throw new Error(`Release candidate rejected: ${assessment.blockers.join("; ")}`);
  return candidate;
}

export function sameReleaseBinding(left, right) {
  const withoutTimestamp = (value) => {
    const copy = structuredClone(value);
    delete copy.generatedAt;
    return canonicalJson(copy);
  };
  return withoutTimestamp(left) === withoutTimestamp(right);
}

async function readMigrations(directory) {
  const { readdir } = await import("node:fs/promises");
  const names = (await readdir(directory)).filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort();
  return Promise.all(names.map(async (name) => ({
    id: name.slice(0, -4),
    sha256: sha256(await readFile(path.join(directory, name)))
  })));
}

function integerFromGradle(source, name) {
  const match = new RegExp(`\\b${name}\\s*=\\s*(\\d+)`).exec(source);
  return match ? Number(match[1]) : null;
}

function nativeAbisFromApk(apk) {
  const minimumEocdOffset = Math.max(0, apk.length - 22 - 0xffff);
  let eocdOffset = -1;
  for (let offset = apk.length - 22; offset >= minimumEocdOffset; offset -= 1) {
    if (apk.readUInt32LE(offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("Release APK central directory is missing");
  const entryCount = apk.readUInt16LE(eocdOffset + 10);
  let offset = apk.readUInt32LE(eocdOffset + 16);
  const abis = new Set();
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > apk.length || apk.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("Release APK central directory is malformed");
    }
    const nameLength = apk.readUInt16LE(offset + 28);
    const extraLength = apk.readUInt16LE(offset + 30);
    const commentLength = apk.readUInt16LE(offset + 32);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > apk.length) throw new Error("Release APK entry name is truncated");
    const match = /^lib\/([^/]+)\//.exec(apk.toString("utf8", nameStart, nameEnd));
    if (match) abis.add(match[1]);
    offset = nameEnd + extraLength + commentLength;
  }
  return [...abis].sort();
}

async function hashFile(file) {
  return sha256(await readFile(file));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function requireFile(file, label) {
  const metadata = await stat(file).catch(() => null);
  if (!metadata?.isFile()) throw new Error(`Missing ${label}: ${file}`);
  return readFile(file);
}

function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

async function writeExclusive(file, value) {
  const output = path.resolve(file);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
}

async function main() {
  if (process.argv.includes("--self-test")) {
    const digest = "a".repeat(64);
    const passing = {
      catalog: { version: "2026-07-28-beta.64", sha256: digest },
      backend: { releaseSha256: digest, fileCount: 1 },
      database: { latestMigrationId: REQUIRED_MIGRATION, migrationCount: 15, migrations: Array.from({ length: 15 }, (_, index) => ({ id: String(index), sha256: digest })) },
      api: { openApiSha256: digest, cardBoundingBoxRequired: true, boundingBoxNullable: true },
      android: { versionCode: 73, versionName: "0.1.0-beta73", roomSchemaVersion: 15, objectBoundsColumns: 4, feedbackContributionColumns: 2, unsignedReleaseApkSha256: digest, unsignedReleaseApkBytes: 60 * 1024 * 1024, nativeAbis: REQUIRED_RELEASE_ABIS, artifactClass: "unsigned_gradle_release_output", cryptographicSignatureVerified: false, minSdk: 26, targetSdk: 36 },
      deployment: { dockerfileSha256: digest, manifestTemplateSha256: digest },
      containerSecurity: { imageId: `sha256:${digest}`, imageReference: "jianwei-api:test", evidenceSha256: digest, reportSha256: digest, sbomSha256: digest, scannerVersion: "0.72.0", components: 1, highCritical: 0, fixableHighCritical: 0, artifactClass: "local_container_security_scan", releaseEvidence: false },
      assemblerSha256: digest,
      rollout: { requiredOrder: ["apply_database_migrations", "deploy_backend_image", "verify_health_and_cloud_path", "sign_and_distribute_android"] },
      compatibility: { newAndroidAcceptsLegacyCards: true, oldAndroidIgnoresBoundingBox: true, databaseRollback: "forward_only_keep_015" }
    };
    if (assessReleaseCandidate(passing).status !== "LOCAL_CANDIDATE_GO") throw new Error("Valid release candidate was rejected");
    const mutations = [
      { ...passing, database: { ...passing.database, latestMigrationId: "013_card_detected_object_name" } },
      { ...passing, android: { ...passing.android, roomSchemaVersion: 13 } },
      { ...passing, android: { ...passing.android, cryptographicSignatureVerified: true } },
      { ...passing, android: { ...passing.android, versionName: "0.1.0-beta72" } },
      { ...passing, android: { ...passing.android, nativeAbis: ["arm64-v8a"] } },
      { ...passing, android: { ...passing.android, unsignedReleaseApkBytes: MAX_RELEASE_APK_BYTES + 1 } },
      { ...passing, containerSecurity: { ...passing.containerSecurity, imageId: "sha256:bad" } },
      { ...passing, containerSecurity: { ...passing.containerSecurity, evidenceSha256: "bad" } },
      { ...passing, containerSecurity: { ...passing.containerSecurity, fixableHighCritical: 1 } },
      { ...passing, containerSecurity: { ...passing.containerSecurity, releaseEvidence: true } },
      { ...passing, rollout: { requiredOrder: [...passing.rollout.requiredOrder].reverse() } },
      { ...passing, compatibility: { ...passing.compatibility, databaseRollback: "drop_015" } }
    ];
    if (mutations.some((value) => assessReleaseCandidate(value).status !== "NO_GO")) throw new Error("Unsafe release candidate bypassed the gate");
    const timestampOnly = { ...passing, generatedAt: "2099-01-01T00:00:00.000Z" };
    if (!sameReleaseBinding({ ...passing, generatedAt: "2000-01-01T00:00:00.000Z" }, timestampOnly) ||
        sameReleaseBinding(passing, { ...passing, catalog: { ...passing.catalog, sha256: "b".repeat(64) } })) {
      throw new Error("Release candidate binding self-test failed");
    }
    process.stdout.write(`RELEASE_CANDIDATE_SELF_TEST=GO synthetic=1 releaseEvidence=0 bypassesRejected=${mutations.length} migrationFirst=1 forwardOnlyRollback=1 staleBindingRejected=1\n`);
    return;
  }
  const releaseApkPath = option("--release-apk");
  const debugApkPath = option("--debug-apk");
  const containerSecurityEvidencePath = option("--container-security-evidence");
  const vulnerabilityReportPath = option("--vulnerability-report");
  const sbomPath = option("--sbom");
  const verify = option("--verify");
  const assemblyInput = {
    releaseApkPath,
    debugApkPath,
    containerSecurityEvidencePath,
    vulnerabilityReportPath,
    sbomPath
  };
  if (verify) {
    if (!releaseApkPath || !containerSecurityEvidencePath || !vulnerabilityReportPath || !sbomPath || option("--output")) {
      throw new Error("--verify requires --release-apk, --container-security-evidence, --vulnerability-report and --sbom, and cannot be combined with --output");
    }
    const recorded = JSON.parse(await readFile(path.resolve(verify), "utf8"));
    const recordedAssessment = assessReleaseCandidate(recorded);
    if (recordedAssessment.status !== "LOCAL_CANDIDATE_GO") throw new Error(`Recorded release candidate is invalid: ${recordedAssessment.blockers.join("; ")}`);
    const current = await assembleReleaseCandidate(assemblyInput);
    if (!sameReleaseBinding(recorded, current)) throw new Error("Release candidate is stale: one or more bound artifacts changed");
    process.stdout.write(`RELEASE_CANDIDATE_VERIFY=GO releaseEvidence=0 backend=${current.backend.releaseSha256} imageId=${current.containerSecurity.imageId} catalog=${current.catalog.sha256} migrations=${current.database.migrationCount} apk=${current.android.unsignedReleaseApkSha256}\n`);
    return;
  }
  const output = option("--output");
  if (!output || !releaseApkPath || !containerSecurityEvidencePath || !vulnerabilityReportPath || !sbomPath) {
    throw new Error("Usage: node scripts/assemble-release-candidate.mjs --release-apk <unsigned-release.apk> --container-security-evidence <evidence.json> --vulnerability-report <report.json> --sbom <sbom.cdx.json> --output <new-manifest.json> [--debug-apk <debug.apk>]");
  }
  const candidate = await assembleReleaseCandidate(assemblyInput);
  await writeExclusive(output, candidate);
  process.stdout.write(`RELEASE_CANDIDATE=LOCAL_CANDIDATE_GO releaseEvidence=0 backend=${candidate.backend.releaseSha256} imageId=${candidate.containerSecurity.imageId} catalog=${candidate.catalog.sha256} migrations=${candidate.database.migrationCount} room=${candidate.android.roomSchemaVersion} apk=${candidate.android.unsignedReleaseApkSha256}\n`);
}

if (isMainModule(import.meta.url)) await main();
