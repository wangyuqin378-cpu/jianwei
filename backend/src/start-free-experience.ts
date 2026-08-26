import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { parseBailianCredentialsCsv, type BailianCredentials } from "./bailian-credentials.js";
import { isMainModule } from "./main-module.js";

const FREE_EXPERIENCE_MODEL = "qwen3.7-flash-2026-07-15";
const FREE_EXPERIENCE_MONTHLY_JOB_LIMIT = 10;
const FREE_EXPERIENCE_MONTHLY_COST_MICRO_CNY = 10_000_000;

interface ExperienceArguments {
  credentialsFile: string;
  port: number;
  selfTest: boolean;
}

export function parseExperienceArguments(args: string[]): ExperienceArguments {
  let credentialsFile = "";
  let port = 8787;
  let selfTest = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") continue;
    if (argument === "--credentials-file") credentialsFile = args[++index] ?? "";
    else if (argument === "--port") port = Number(args[++index] ?? "");
    else if (argument === "--self-test") selfTest = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!selfTest && !credentialsFile) throw new Error("--credentials-file is required");
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) throw new Error("--port is invalid");
  return { credentialsFile, port, selfTest };
}

export function freeExperienceEnvironment(
  credentials: BailianCredentials,
  port: number,
  workingDirectory = process.cwd()
): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "development",
    RELEASE_CHANNEL: "beta",
    HOST: "127.0.0.1",
    PORT: String(port),
    PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
    OBJECT_STORE: "local",
    LOCAL_OBJECT_DIR: path.resolve(workingDirectory, ".tooling/free-experience/objects"),
    VISION_PROVIDER: "qwen",
    DASHSCOPE_API_KEY: credentials.apiKey,
    DASHSCOPE_BASE_URL: credentials.openAiCompatible,
    QWEN_FLASH_MODEL: FREE_EXPERIENCE_MODEL,
    QWEN_PLUS_MODEL: FREE_EXPERIENCE_MODEL,
    MAX_JOBS_PER_DEVICE_PER_DAY: "3",
    MAX_JOBS_PER_DEVICE_PER_MONTH: String(FREE_EXPERIENCE_MONTHLY_JOB_LIMIT),
    MAX_JOBS_GLOBAL_PER_DAY: "3",
    MAX_JOBS_GLOBAL_PER_MONTH: String(FREE_EXPERIENCE_MONTHLY_JOB_LIMIT),
    WORST_CASE_COST_MICRO_CNY_PER_JOB: "1000000",
    MAX_GLOBAL_COST_MICRO_CNY_PER_DAY: "3000000",
    MAX_GLOBAL_COST_MICRO_CNY_PER_MONTH: String(FREE_EXPERIENCE_MONTHLY_COST_MICRO_CNY),
    OBJECT_TTL_HOURS: "1",
    ALLOW_UNATTESTED_FACTS: "false"
  };
}

async function main(args: string[]): Promise<void> {
  const parsed = parseExperienceArguments(args);
  if (parsed.selfTest) {
    const environment = freeExperienceEnvironment({
      apiKey: `sk-ws${"a".repeat(80)}`,
      openAiCompatible: "https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"
    }, parsed.port, "/tmp/jianwei");
    assert.equal(environment.QWEN_FLASH_MODEL, FREE_EXPERIENCE_MODEL);
    assert.equal(environment.QWEN_PLUS_MODEL, FREE_EXPERIENCE_MODEL);
    assert.equal(environment.MAX_JOBS_GLOBAL_PER_MONTH, "10");
    assert.equal(environment.MAX_GLOBAL_COST_MICRO_CNY_PER_MONTH, "10000000");
    assert.equal(environment.OBJECT_STORE, "local");
    assert.equal(environment.DATABASE_URL, undefined);
    process.stdout.write(
      `FREE_EXPERIENCE_LAUNCHER_SELF_TEST=GO model=${FREE_EXPERIENCE_MODEL} cloudInfrastructure=0 monthlyJobs=10 monthlyWorstCaseCostCny=10\n`
    );
    return;
  }

  const credentials = parseBailianCredentialsCsv(await readFile(parsed.credentialsFile, "utf8"));
  Object.assign(process.env, freeExperienceEnvironment(credentials, parsed.port));
  process.stdout.write(
    `FREE_EXPERIENCE_SERVER_START model=${FREE_EXPERIENCE_MODEL} cloudInfrastructure=0 monthlyJobs=10 monthlyWorstCaseCostCny=10\n`
  );
  await import("./index.js");
}

if (isMainModule(import.meta.url)) await main(process.argv.slice(2));
