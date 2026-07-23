import { open, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PostgresRepositories } from "./infrastructure/postgres-repositories.js";
import { buildEvaluationLease } from "./services/evaluation-lease.js";

const args = parseArgs(process.argv.slice(2));
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl || !/^postgres(?:ql)?:\/\//i.test(databaseUrl)) throw new Error("DATABASE_URL must be a PostgreSQL URL");
const labelsPath = path.resolve(required(args, "labels"));
const manifestPath = path.resolve(required(args, "run-manifest"));
const outputPath = path.resolve(required(args, "out"));
if (path.basename(outputPath) !== "image-evaluation-lease.json") {
  throw new Error("Evaluation lease output must be named image-evaluation-lease.json");
}
await assertSafeNewOutput(outputPath);
const { definition, artifact } = buildEvaluationLease({
  labelsBytes: await readFile(labelsPath),
  manifestBytes: await readFile(manifestPath),
  now: new Date(),
  ttlHours: Number(args.get("ttl-hours") ?? "72")
});
const repositories = new PostgresRepositories(databaseUrl);
let created = false;
try {
  await repositories.jobsRepository.createEvaluationLease(definition);
  created = true;
  const handle = await open(outputPath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(artifact, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  process.stdout.write(`EVALUATION_LEASE=ISSUED leaseId=${artifact.leaseId} maxJobs=${artifact.maxJobs} expiresAt=${artifact.expiresAt} output=${outputPath}\n`);
} catch (error) {
  if (created) await repositories.jobsRepository.revokeEvaluationLease(definition.id, new Date().toISOString()).catch(() => false);
  throw error;
} finally {
  await repositories.close();
}

async function assertSafeNewOutput(outputPath: string): Promise<void> {
  const parent = path.dirname(outputPath);
  const parentStat = await stat(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) throw new Error("Evaluation lease output parent must be an ordinary directory");
  if (await realpath(parent) !== parent) throw new Error("Evaluation lease output parent must not traverse a link or junction");
}

function required(args: Map<string, string>, name: string): string {
  const value = args.get(name);
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}

function parseArgs(values: string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--")) throw new Error("Arguments must be --name value pairs");
    result.set(key.slice(2), value);
  }
  return result;
}
