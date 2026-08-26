import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMainModule } from "./main-module.js";

export interface BackendReleaseIdentity {
  schemaVersion: 1;
  evidenceKind: "backend_release_identity";
  backendReleaseSha256: string;
  fileCount: number;
}

const ROOT_FILES = [
  "backend/package.json",
  "backend/pnpm-lock.yaml",
  "backend/pnpm-workspace.yaml",
  "backend/tsconfig.json",
  "deploy/Dockerfile",
  "deploy/s.code-package.yaml",
  "scripts/build-fc-code-package.mjs",
  "knowledge/catalog.json"
];

export async function computeBackendReleaseIdentity(
  workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
): Promise<BackendReleaseIdentity> {
  const root = path.resolve(workspaceRoot);
  const files = [
    ...ROOT_FILES.map((value) => path.join(root, value)),
    ...await collect(path.join(root, "backend", "migrations"), () => true),
    ...await collect(path.join(root, "backend", "src"), (name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
  ];
  const entries = await Promise.all(files.map(async (absolute) => ({
    name: path.relative(root, absolute).replaceAll("\\", "/"),
    bytes: await readFile(absolute)
  })));
  return {
    schemaVersion: 1,
    evidenceKind: "backend_release_identity",
    backendReleaseSha256: hashReleaseEntries(entries),
    fileCount: entries.length
  };
}

export function loadBackendReleaseSha256(
  environment: "development" | "test" | "production",
  identityPath = path.resolve(process.cwd(), "release-identity.json")
): string | null {
  if (!existsSync(identityPath)) {
    if (environment === "production") throw new Error("release-identity.json is required in production");
    return null;
  }
  const value = JSON.parse(requireFile(identityPath)) as Record<string, unknown>;
  const keys = Object.keys(value).sort().join(",");
  if (keys !== "backendReleaseSha256,evidenceKind,fileCount,schemaVersion" ||
      value.schemaVersion !== 1 || value.evidenceKind !== "backend_release_identity" ||
      !Number.isInteger(value.fileCount) || Number(value.fileCount) < 1 ||
      typeof value.backendReleaseSha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.backendReleaseSha256)) {
    throw new Error("release-identity.json is invalid");
  }
  return value.backendReleaseSha256;
}

export function hashReleaseEntries(entries: Array<{ name: string; bytes: Buffer }>): string {
  const normalized = entries.map((entry) => ({
    name: entry.name.replaceAll("\\", "/"),
    bytes: entry.bytes
  })).sort((left, right) => left.name.localeCompare(right.name, "en"));
  if (normalized.length === 0 || new Set(normalized.map((entry) => entry.name)).size !== normalized.length) {
    throw new Error("Backend release identity entries are empty or duplicated");
  }
  const digest = createHash("sha256").update("jianwei-backend-release-v1\0");
  for (const entry of normalized) {
    if (!entry.name || path.isAbsolute(entry.name) || entry.name.includes("..")) {
      throw new Error("Backend release identity contains an unsafe path");
    }
    digest.update(`${Buffer.byteLength(entry.name, "utf8")}\0${entry.name}\0${entry.bytes.length}\0`);
    digest.update(entry.bytes);
  }
  return digest.digest("hex");
}

async function collect(directory: string, accept: (name: string) => boolean): Promise<string[]> {
  const output: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await collect(absolute, accept));
    else if (entry.isFile() && accept(entry.name)) output.push(absolute);
  }
  return output;
}

function requireFile(file: string): string {
  // This loader runs once during process startup. Keeping the read synchronous
  // makes production startup fail before any network listener can be opened.
  return readFileSync(file, "utf8");
}

async function main() {
  if (process.argv.includes("--self-test")) {
    const first = hashReleaseEntries([
      { name: "backend/src/a.ts", bytes: Buffer.from("a") },
      { name: "knowledge/catalog.json", bytes: Buffer.from("{}") }
    ]);
    const reordered = hashReleaseEntries([
      { name: "knowledge/catalog.json", bytes: Buffer.from("{}") },
      { name: "backend/src/a.ts", bytes: Buffer.from("a") }
    ]);
    const changed = hashReleaseEntries([
      { name: "backend/src/a.ts", bytes: Buffer.from("b") },
      { name: "knowledge/catalog.json", bytes: Buffer.from("{}") }
    ]);
    if (first !== reordered || first === changed) throw new Error("Backend release identity self-test failed");
    process.stdout.write("BACKEND_RELEASE_IDENTITY_SELF_TEST=GO deterministic=1 mutationSensitive=1 releaseEvidence=0\n");
    return;
  }
  const identity = await computeBackendReleaseIdentity();
  const writeIndex = process.argv.indexOf("--write");
  if (writeIndex < 0) {
    process.stdout.write(`${JSON.stringify(identity, null, 2)}\n`);
    return;
  }
  const outputValue = process.argv[writeIndex + 1];
  if (!outputValue || outputValue.startsWith("--")) throw new Error("--write requires an output path");
  const output = path.resolve(process.cwd(), outputValue);
  await mkdir(path.dirname(output), { recursive: true });
  const temporary = `${output}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(identity, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await rm(output, { force: true });
    await rename(temporary, output);
  } finally {
    await rm(temporary, { force: true });
  }
  process.stdout.write(`BACKEND_RELEASE_IDENTITY=GO files=${identity.fileCount} sha256=${identity.backendReleaseSha256}\n`);
}

if (isMainModule(import.meta.url)) await main();
