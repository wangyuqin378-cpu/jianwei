import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { parseBailianCredentialsCsv, type BailianCredentials } from "./bailian-credentials.js";
import { isMainModule } from "./main-module.js";

const FREE_EXPERIENCE_MODEL = "qwen3.7-flash-2026-07-15";
const FREE_EXPERIENCE_DAILY_JOB_LIMIT = 30;
const FREE_EXPERIENCE_MONTHLY_JOB_LIMIT = 93;
const FREE_EXPERIENCE_WORST_CASE_COST_MICRO_CNY_PER_JOB = 20_000;
const FREE_EXPERIENCE_MONTHLY_COST_MICRO_CNY = 10_000_000;

interface ExperienceArguments {
  credentialsFile: string;
  host: string;
  port: number;
  publicBaseUrl: string;
  selfTest: boolean;
}

export function parseExperienceArguments(args: string[]): ExperienceArguments {
  let credentialsFile = "";
  let host = "127.0.0.1";
  let port = 8787;
  let publicBaseUrl = "";
  let selfTest = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") continue;
    if (argument === "--credentials-file") credentialsFile = args[++index] ?? "";
    else if (argument === "--host") host = args[++index] ?? "";
    else if (argument === "--port") port = Number(args[++index] ?? "");
    else if (argument === "--public-base-url") publicBaseUrl = args[++index] ?? "";
    else if (argument === "--self-test") selfTest = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!selfTest && !credentialsFile) throw new Error("--credentials-file is required");
  if (!["127.0.0.1", "0.0.0.0"].includes(host)) throw new Error("--host must be 127.0.0.1 or 0.0.0.0");
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) throw new Error("--port is invalid");
  publicBaseUrl ||= `http://127.0.0.1:${port}`;
  const parsedPublicBaseUrl = new URL(publicBaseUrl);
  const isLoopbackHttp = parsedPublicBaseUrl.protocol === "http:"
    && ["127.0.0.1", "localhost", "::1"].includes(parsedPublicBaseUrl.hostname);
  const isLocalNetworkHttp = parsedPublicBaseUrl.protocol === "http:"
    && (
      parsedPublicBaseUrl.hostname.toLowerCase().endsWith(".local")
      || isPrivateIPv4(parsedPublicBaseUrl.hostname)
    );
  if (
    (parsedPublicBaseUrl.protocol !== "https:" && !isLoopbackHttp && !isLocalNetworkHttp) ||
    parsedPublicBaseUrl.pathname !== "/" ||
    parsedPublicBaseUrl.username ||
    parsedPublicBaseUrl.password ||
    parsedPublicBaseUrl.search ||
    parsedPublicBaseUrl.hash
  ) {
    throw new Error("--public-base-url must be an HTTPS origin or local-network HTTP origin");
  }
  return { credentialsFile, host, port, publicBaseUrl: parsedPublicBaseUrl.origin, selfTest };
}

function isPrivateIPv4(hostname: string): boolean {
  const octets = hostname.split(".");
  if (octets.length !== 4 || octets.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const values = octets.map(Number);
  if (values.some((part) => part < 0 || part > 255)) return false;
  const first = values[0]!;
  const second = values[1]!;
  return first === 10
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168);
}

export function freeExperienceEnvironment(
  credentials: BailianCredentials,
  port: number,
  workingDirectory = process.cwd(),
  publicBaseUrl = `http://127.0.0.1:${port}`,
  host = "127.0.0.1"
): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "development",
    RELEASE_CHANNEL: "beta",
    HOST: host,
    PORT: String(port),
    PUBLIC_BASE_URL: publicBaseUrl,
    OBJECT_STORE: "local",
    LOCAL_OBJECT_DIR: path.resolve(workingDirectory, ".tooling/free-experience/objects"),
    VISION_PROVIDER: "qwen",
    DASHSCOPE_API_KEY: credentials.apiKey,
    DASHSCOPE_BASE_URL: credentials.openAiCompatible,
    QWEN_FLASH_MODEL: FREE_EXPERIENCE_MODEL,
    QWEN_PLUS_MODEL: FREE_EXPERIENCE_MODEL,
    // The app itself still selects only three automatic candidates per day.
    // This service-side limit is intentionally higher so user-initiated Beta
    // trials are not misreported as network failures after the third photo.
    MAX_JOBS_PER_DEVICE_PER_DAY: String(FREE_EXPERIENCE_DAILY_JOB_LIMIT),
    MAX_JOBS_PER_DEVICE_PER_MONTH: String(FREE_EXPERIENCE_MONTHLY_JOB_LIMIT),
    MAX_JOBS_GLOBAL_PER_DAY: String(FREE_EXPERIENCE_DAILY_JOB_LIMIT),
    MAX_JOBS_GLOBAL_PER_MONTH: String(FREE_EXPERIENCE_MONTHLY_JOB_LIMIT),
    WORST_CASE_COST_MICRO_CNY_PER_JOB: String(FREE_EXPERIENCE_WORST_CASE_COST_MICRO_CNY_PER_JOB),
    MAX_GLOBAL_COST_MICRO_CNY_PER_DAY: String(
      FREE_EXPERIENCE_DAILY_JOB_LIMIT * FREE_EXPERIENCE_WORST_CASE_COST_MICRO_CNY_PER_JOB
    ),
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
    }, parsed.port, "/tmp/jianwei", "https://jianwei-test.example.com");
    assert.equal(environment.QWEN_FLASH_MODEL, FREE_EXPERIENCE_MODEL);
    assert.equal(environment.QWEN_PLUS_MODEL, FREE_EXPERIENCE_MODEL);
    assert.equal(environment.MAX_JOBS_GLOBAL_PER_MONTH, "93");
    assert.equal(environment.MAX_JOBS_PER_DEVICE_PER_DAY, "30");
    assert.equal(environment.MAX_JOBS_GLOBAL_PER_DAY, "30");
    assert.equal(environment.MAX_GLOBAL_COST_MICRO_CNY_PER_DAY, "600000");
    assert.equal(environment.WORST_CASE_COST_MICRO_CNY_PER_JOB, "20000");
    assert.equal(environment.MAX_GLOBAL_COST_MICRO_CNY_PER_MONTH, "10000000");
    assert.equal(environment.OBJECT_STORE, "local");
    assert.equal(environment.PUBLIC_BASE_URL, "https://jianwei-test.example.com");
    assert.equal(environment.DATABASE_URL, undefined);
    process.stdout.write(
      `FREE_EXPERIENCE_LAUNCHER_SELF_TEST=GO model=${FREE_EXPERIENCE_MODEL} cloudInfrastructure=0 dailyJobs=30 monthlyJobs=93 reservedMonthlyCostCny=1.86 hardCostCapCny=10\n`
    );
    return;
  }

  const credentials = parseBailianCredentialsCsv(await readFile(parsed.credentialsFile, "utf8"));
  Object.assign(
    process.env,
    freeExperienceEnvironment(credentials, parsed.port, process.cwd(), parsed.publicBaseUrl, parsed.host)
  );
  process.stdout.write(
    `FREE_EXPERIENCE_SERVER_START model=${FREE_EXPERIENCE_MODEL} cloudInfrastructure=0 dailyJobs=30 monthlyJobs=93 reservedMonthlyCostCny=1.86 hardCostCapCny=10\n`
  );
  await import("./index.js");
}

if (isMainModule(import.meta.url)) await main(process.argv.slice(2));
