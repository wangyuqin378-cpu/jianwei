import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { isMainModule } from "./main-module.js";

interface CardSourceSnapshot {
  sourceId: string;
  url: string;
}

export interface CardSnapshotRow {
  id: string;
  topic_id: string;
  fact_id: string;
  title: string;
  detected_object_name: string;
  body: string;
  personal_context: string;
  confidence: number | string;
  sources: unknown;
  backend_release_sha256: string | null;
  created_at: string | Date;
}

interface SnapshotMetadata {
  runId: string;
  evidenceRef: string;
  appVersion: string;
  releaseApkSha256: string;
  backendReleaseSha256: string;
  modelVersion: string;
  catalogVersion: string;
  exportedAt: string;
}

export function buildCardSnapshotArtifact(rows: CardSnapshotRow[], metadata: SnapshotMetadata) {
  if (!validToken(metadata.runId) || !bounded(metadata.evidenceRef, 1, 500) ||
      !bounded(metadata.appVersion, 1, 100) || !bounded(metadata.modelVersion, 1, 200) ||
      !/^[a-f0-9]{64}$/.test(metadata.releaseApkSha256) ||
      !/^[a-f0-9]{64}$/.test(metadata.backendReleaseSha256) ||
      !validToken(metadata.catalogVersion) || !strictIso(metadata.exportedAt)) {
    throw new Error("Card snapshot metadata is invalid");
  }
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 500) throw new Error("Card snapshot export requires 1-500 rows");
  const ids = new Set<string>();
  const cards = rows.map((row) => {
    if (!validToken(row.id) || ids.has(row.id) || !validToken(row.topic_id) || !validToken(row.fact_id)) {
      throw new Error("Card snapshot row IDs are invalid or duplicated");
    }
    ids.add(row.id);
    if (row.backend_release_sha256 !== metadata.backendReleaseSha256) {
      throw new Error(`Card snapshot row came from a different backend Release: ${row.id}`);
    }
    if (!bounded(row.title, 1, 200) || !bounded(row.detected_object_name, 1, 60) ||
        !bounded(row.body, 1, 500) || !bounded(row.personal_context, 1, 500)) {
      throw new Error(`Card snapshot row text is invalid: ${row.id}`);
    }
    const confidence = Number(row.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error(`Card snapshot confidence is invalid: ${row.id}`);
    const createdAt = asStrictIso(row.created_at);
    if (!createdAt || createdAt > metadata.exportedAt) throw new Error(`Card snapshot createdAt is invalid: ${row.id}`);
    const sources = normalizeSources(row.sources, row.id);
    const card = {
      cardId: row.id,
      topicId: row.topic_id,
      factId: row.fact_id,
      title: row.title,
      detectedObjectName: row.detected_object_name,
      body: row.body,
      personalContext: row.personal_context,
      confidence,
      sources,
      createdAt
    };
    return { ...card, cardSha256: cardDigest(card) };
  });
  return {
    schemaVersion: 1,
    evidenceKind: "generated_card_snapshots",
    runId: metadata.runId,
    evidenceRef: metadata.evidenceRef,
    appVersion: metadata.appVersion,
    releaseApkSha256: metadata.releaseApkSha256,
    backendReleaseSha256: metadata.backendReleaseSha256,
    modelVersion: metadata.modelVersion,
    catalogVersion: metadata.catalogVersion,
    exportedAt: metadata.exportedAt,
    cards
  };
}

function normalizeSources(value: unknown, cardId: string): CardSourceSnapshot[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) throw new Error(`Card sources are invalid: ${cardId}`);
  const ids = new Set<string>();
  return value.map((source) => {
    if (!source || typeof source !== "object" || Array.isArray(source)) throw new Error(`Card source is invalid: ${cardId}`);
    const item = source as Record<string, unknown>;
    if (!validToken(item.sourceId) || typeof item.url !== "string" || !isPublicHttpsUrl(item.url) || ids.has(item.sourceId)) {
      throw new Error(`Card source is invalid or duplicated: ${cardId}`);
    }
    ids.add(item.sourceId);
    return { sourceId: item.sourceId, url: item.url };
  });
}

function cardDigest(card: {
  cardId: string;
  topicId: string;
  factId: string;
  title: string;
  detectedObjectName: string;
  body: string;
  personalContext: string;
  confidence: number;
  sources: CardSourceSnapshot[];
  createdAt: string;
}): string {
  return createHash("sha256").update(JSON.stringify([
    "jianwei-generated-card-v1",
    card.cardId,
    card.topicId,
    card.factId,
    card.title,
    card.detectedObjectName,
    card.body,
    card.personalContext,
    card.confidence,
    card.sources,
    card.createdAt
  ])).digest("hex");
}

function isPublicHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || !host || url.username || url.password) return false;
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
    if (/^(?:127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host)) return false;
    const private172 = /^172\.(\d{1,3})\./.exec(host);
    return !(private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) && host !== "[::1]" && host !== "::1";
  } catch {
    return false;
  }
}

function parseArgs(values: string[]): Map<string, string | true> {
  const args = new Map<string, string | true>();
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (!key) throw new Error("Argument is missing");
    if (key === "--write") args.set(key, true);
    else if (key.startsWith("--")) {
      const value = values[++index];
      if (!value || value.startsWith("--")) throw new Error(`${key} requires a value`);
      args.set(key, value);
    } else throw new Error(`Unexpected argument: ${key}`);
  }
  return args;
}

function required(args: Map<string, string | true>, key: string): string {
  const value = args.get(key);
  if (typeof value !== "string" || !value.trim()) throw new Error(`${key} is required`);
  return value.trim();
}

function validToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._-]{3,128}$/.test(value);
}

function bounded(value: unknown, minimum: number, maximum: number): value is string {
  return typeof value === "string" && value.trim() === value && value.length >= minimum && value.length <= maximum;
}

function strictIso(value: string): boolean {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function asStrictIso(value: string | Date): string | null {
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

async function main() {
  const localEnv = path.resolve(process.cwd(), ".env");
  if (existsSync(localEnv)) process.loadEnvFile(localEnv);
  const args = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl || !/^postgres(?:ql)?:\/\//i.test(databaseUrl)) throw new Error("DATABASE_URL must identify the PostgreSQL evidence source");
  const limit = Number(args.get("--limit") ?? "200");
  if (!Number.isInteger(limit) || limit < 200 || limit > 500) throw new Error("--limit must be an integer from 200 to 500");
  const sinceValue = typeof args.get("--since") === "string" ? String(args.get("--since")) : null;
  const since = sinceValue ? asStrictIso(sinceValue) : null;
  if (sinceValue && !since) throw new Error("--since must be an ISO timestamp");
  const catalogPath = path.resolve(process.cwd(), String(args.get("--catalog") ?? "../knowledge/catalog.json"));
  const catalog = JSON.parse(await readFile(catalogPath, "utf8")) as { version?: unknown };
  if (!validToken(catalog.version)) throw new Error("Knowledge catalog version is invalid");
  const releaseArtifactPath = path.resolve(process.cwd(), required(args, "--release-artifact"));
  const releaseArtifact = JSON.parse(await readFile(releaseArtifactPath, "utf8")) as Record<string, unknown>;
  if (releaseArtifact.evidenceKind !== "verified_release_apk" || releaseArtifact.formalSigning !== true ||
      releaseArtifact.debugCertificate !== false || !bounded(releaseArtifact.versionName, 1, 100) ||
      typeof releaseArtifact.apkSha256 !== "string" || !/^[a-f0-9]{64}$/.test(releaseArtifact.apkSha256)) {
    throw new Error("Card snapshot export requires a formally verified Release APK artifact");
  }
  const cloudArtifactPath = path.resolve(process.cwd(), required(args, "--cloud-artifact"));
  const cloudArtifact = JSON.parse(await readFile(cloudArtifactPath, "utf8")) as Record<string, unknown>;
  const cloud = cloudArtifact.cloud as Record<string, unknown> | undefined;
  const cloudProvenance = cloudArtifact.cloudProvenance as Record<string, unknown> | undefined;
  if (cloudArtifact.evidenceKind !== "verified_cloud_run" || cloud?.realDeployment !== true ||
      typeof cloud?.backendReleaseSha256 !== "string" || !/^[a-f0-9]{64}$/.test(cloud.backendReleaseSha256) ||
      cloudProvenance?.backendReleaseSha256 !== cloud.backendReleaseSha256 ||
      typeof cloud?.containerImageDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(cloud.containerImageDigest) ||
      cloudProvenance?.containerImageDigest !== cloud.containerImageDigest ||
      typeof cloud?.deploymentReceiptSha256 !== "string" || !/^[a-f0-9]{64}$/.test(cloud.deploymentReceiptSha256) ||
      cloudProvenance?.deploymentReceiptSha256 !== cloud.deploymentReceiptSha256 ||
      !bounded(cloud?.deploymentRevision, 3, 128) || cloudProvenance?.deploymentRevision !== cloud.deploymentRevision ||
      cloud?.appVersion !== releaseArtifact.versionName || cloud?.releaseApkSha256 !== releaseArtifact.apkSha256 ||
      !bounded(cloud?.modelVersion, 1, 200) || cloud?.catalogVersion !== catalog.version) {
    throw new Error("Card snapshot export requires matching verified cloud and Release APK artifacts");
  }
  const sql = postgres(databaseUrl, { max: 1, idle_timeout: 5, transform: { undefined: null } });
  let rows: CardSnapshotRow[];
  try {
    rows = since
      ? await sql<CardSnapshotRow[]>`
          SELECT id, topic_id, fact_id, title, detected_object_name, body, personal_context, confidence, sources,
                 backend_release_sha256, created_at
          FROM cards WHERE status = 'scheduled' AND created_at >= ${since}
          ORDER BY created_at ASC, id ASC LIMIT ${limit}`
      : await sql<CardSnapshotRow[]>`
          SELECT id, topic_id, fact_id, title, detected_object_name, body, personal_context, confidence, sources,
                 backend_release_sha256, created_at
          FROM cards WHERE status = 'scheduled'
          ORDER BY created_at ASC, id ASC LIMIT ${limit}`;
  } finally {
    await sql.end({ timeout: 5 });
  }
  if (rows.length < 200) throw new Error(`PostgreSQL returned only ${rows.length} generated cards; at least 200 are required`);
  const artifact = buildCardSnapshotArtifact(rows, {
    runId: required(args, "--run-id"),
    evidenceRef: required(args, "--evidence-ref"),
    appVersion: releaseArtifact.versionName,
    releaseApkSha256: releaseArtifact.apkSha256,
    backendReleaseSha256: cloud.backendReleaseSha256,
    modelVersion: cloud.modelVersion,
    catalogVersion: catalog.version,
    exportedAt: new Date().toISOString()
  });
  if (!args.has("--write")) {
    process.stdout.write(`CARD_SNAPSHOT_EXPORT_PREVIEW=GO run=${artifact.runId} cards=${artifact.cards.length} catalog=${artifact.catalogVersion} containsDeviceIdentity=0 containsCandidateToken=0 wrote=0\n`);
    return;
  }
  const outputPath = path.resolve(process.cwd(), required(args, "--output"));
  await mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, outputPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
  process.stdout.write(`CARD_SNAPSHOT_EXPORT=GO run=${artifact.runId} cards=${artifact.cards.length} catalog=${artifact.catalogVersion} containsDeviceIdentity=0 containsCandidateToken=0 wrote=1\n`);
}

if (isMainModule(import.meta.url)) {
  await main();
}
