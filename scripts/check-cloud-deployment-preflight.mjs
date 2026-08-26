import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { assessContainerDeploymentInputs } from "./check-container-deployment-inputs.mjs";
import { collectCodePackageEntries, hashCodePackageEntries } from "./build-fc-code-package.mjs";

const FIXED_FLASH_MODEL = "qwen3.6-flash-2026-04-16";
const FIXED_PLUS_MODEL = "qwen3.6-plus-2026-04-02";
const DEFAULT_DASHSCOPE_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";

function value(env, name) {
  return env[name]?.trim() ?? "";
}

function validPublicOrigin(raw) {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.search &&
      !url.hash &&
      (url.pathname === "/" || url.pathname === "") &&
      url.hostname !== "localhost" &&
      url.hostname !== "127.0.0.1";
  } catch {
    return false;
  }
}

function validPostgresUrl(raw) {
  try {
    const url = new URL(raw);
    return (url.protocol === "postgres:" || url.protocol === "postgresql:") &&
      Boolean(url.hostname) &&
      url.pathname.length > 1;
  } catch {
    return false;
  }
}

function validDashscopeBaseUrl(raw) {
  try {
    const url = new URL(raw);
    const hostname = url.hostname.toLowerCase();
    const workspaceHost = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cn-beijing\.maas\.aliyuncs\.com$/;
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.search &&
      !url.hash &&
      (hostname === "dashscope.aliyuncs.com" || workspaceHost.test(hostname)) &&
      url.pathname.replace(/\/$/, "") === "/compatible-mode/v1";
  } catch {
    return false;
  }
}

function positiveInteger(raw) {
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0;
}

export function assessCloudDeploymentPreflight({
  env,
  tools,
  serverlessAccessConfigured,
  catalogSha256,
  codePackageDigest = null
}) {
  const missingEnvironmentVariables = [];
  const invalidEnvironmentVariables = [];
  const artifactKind = value(env, "JIANWEI_DEPLOYMENT_ARTIFACT_KIND") || "container";
  const required = [
    "JIANWEI_FC_ROLE_ARN",
    "JIANWEI_VPC_ID",
    "JIANWEI_VSWITCH_ID",
    "JIANWEI_SECURITY_GROUP_ID",
    "JIANWEI_PUBLIC_BASE_URL",
    "JIANWEI_DATABASE_URL",
    "JIANWEI_DASHSCOPE_API_KEY",
    "JIANWEI_DASHSCOPE_BASE_URL",
    "JIANWEI_OSS_BUCKET",
    "JIANWEI_KNOWLEDGE_CATALOG_SHA256",
    "JIANWEI_WORST_CASE_COST_MICRO_CNY",
    "JIANWEI_MAX_COST_DAY_MICRO_CNY",
    "JIANWEI_MAX_COST_MONTH_MICRO_CNY"
  ];
  if (artifactKind === "code-package") {
    required.push("JIANWEI_CODE_PATH", "JIANWEI_DEPLOYMENT_ARTIFACT_DIGEST");
  }
  for (const name of required) {
    if (!value(env, name)) missingEnvironmentVariables.push(name);
  }

  const validate = (name, predicate) => {
    const raw = value(env, name);
    if (raw && !predicate(raw)) invalidEnvironmentVariables.push(name);
  };
  validate("JIANWEI_REGION", (raw) => raw === "cn-beijing");
  validate("JIANWEI_FC_ROLE_ARN", (raw) => /^acs:ram::\d{8,32}:role\/[A-Za-z0-9._-]{1,64}$/.test(raw));
  validate("JIANWEI_VPC_ID", (raw) => /^vpc-[A-Za-z0-9]+$/.test(raw));
  validate("JIANWEI_VSWITCH_ID", (raw) => /^vsw-[A-Za-z0-9]+$/.test(raw));
  validate("JIANWEI_SECURITY_GROUP_ID", (raw) => /^sg-[A-Za-z0-9]+$/.test(raw));
  validate("JIANWEI_PUBLIC_BASE_URL", validPublicOrigin);
  validate("JIANWEI_DATABASE_URL", validPostgresUrl);
  validate("JIANWEI_DASHSCOPE_BASE_URL", validDashscopeBaseUrl);
  validate("JIANWEI_OSS_BUCKET", (raw) => /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(raw));
  validate("JIANWEI_DEPLOYMENT_ARTIFACT_KIND", (raw) => raw === "container" || raw === "code-package");
  validate("JIANWEI_DEPLOYMENT_ARTIFACT_DIGEST", (raw) => /^sha256:[a-f0-9]{64}$/.test(raw));
  validate("JIANWEI_CODE_PATH", (raw) => path.isAbsolute(raw) && existsSync(raw));
  if (artifactKind === "code-package" && codePackageDigest !== value(env, "JIANWEI_DEPLOYMENT_ARTIFACT_DIGEST")) {
    invalidEnvironmentVariables.push("JIANWEI_DEPLOYMENT_ARTIFACT_DIGEST");
  }
  validate("JIANWEI_KNOWLEDGE_CATALOG_SHA256", (raw) => /^[a-f0-9]{64}$/.test(raw) && raw === catalogSha256);
  for (const name of [
    "JIANWEI_WORST_CASE_COST_MICRO_CNY",
    "JIANWEI_MAX_COST_DAY_MICRO_CNY",
    "JIANWEI_MAX_COST_MONTH_MICRO_CNY"
  ]) {
    validate(name, positiveInteger);
  }

  const flashModel = value(env, "JIANWEI_QWEN_FLASH_MODEL") || FIXED_FLASH_MODEL;
  const plusModel = value(env, "JIANWEI_QWEN_PLUS_MODEL") || FIXED_PLUS_MODEL;
  if (flashModel !== FIXED_FLASH_MODEL) invalidEnvironmentVariables.push("JIANWEI_QWEN_FLASH_MODEL");
  if (plusModel !== FIXED_PLUS_MODEL) invalidEnvironmentVariables.push("JIANWEI_QWEN_PLUS_MODEL");

  const container = artifactKind === "container" ? assessContainerDeploymentInputs(env) : null;
  const blockers = [];
  if (!tools.serverlessDevs) blockers.push("Serverless Devs executable `s` is not available");
  if (!tools.psql) blockers.push("PostgreSQL client `psql` is not available for controlled migrations");
  if (!serverlessAccessConfigured) {
    blockers.push("the selected Serverless Devs access profile is not configured");
  }
  blockers.push(...missingEnvironmentVariables.map((name) => `${name} is required`));
  blockers.push(...invalidEnvironmentVariables.map((name) => `${name} is invalid`));
  if (container) blockers.push(...container.blockers);
  if (container && container.status !== "GO" && !tools.docker) {
    blockers.push("Docker is not available to build the missing immutable container image");
  }

  const uniqueBlockers = [...new Set(blockers)];
  return {
    schemaVersion: 1,
    evidenceKind: "cloud_deployment_preflight",
    status: uniqueBlockers.length === 0 ? "GO" : "NO_GO",
    releaseEvidence: false,
    cloudStateObserved: false,
    metrics: {
      serverlessDevsAvailable: tools.serverlessDevs ? 1 : 0,
      serverlessAccessConfigured: serverlessAccessConfigured ? 1 : 0,
      psqlAvailable: tools.psql ? 1 : 0,
      dockerAvailable: tools.docker ? 1 : 0,
      immutableContainerInputs: container?.status === "GO" ? 1 : 0,
      immutableCodePackageInputs: artifactKind === "code-package" &&
        !missingEnvironmentVariables.includes("JIANWEI_CODE_PATH") &&
        !missingEnvironmentVariables.includes("JIANWEI_DEPLOYMENT_ARTIFACT_DIGEST") &&
        !invalidEnvironmentVariables.includes("JIANWEI_CODE_PATH") &&
        !invalidEnvironmentVariables.includes("JIANWEI_DEPLOYMENT_ARTIFACT_DIGEST") ? 1 : 0,
      catalogDigestMatches: value(env, "JIANWEI_KNOWLEDGE_CATALOG_SHA256") === catalogSha256 ? 1 : 0,
      fixedQwenModels: flashModel === FIXED_FLASH_MODEL && plusModel === FIXED_PLUS_MODEL ? 1 : 0,
      missingEnvironmentVariables: missingEnvironmentVariables.length,
      invalidEnvironmentVariables: invalidEnvironmentVariables.length
    },
    missingEnvironmentVariables: [...new Set(missingEnvironmentVariables)].sort(),
    invalidEnvironmentVariables: [...new Set(invalidEnvironmentVariables)].sort(),
    blockers: uniqueBlockers
  };
}

function commandAvailable(command) {
  const pathEntries = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const extensions = process.platform === "win32"
    ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";")
    : [""];
  for (const directory of pathEntries) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${command}${extension}`);
      try {
        accessSync(candidate, process.platform === "win32" ? constants.F_OK : constants.X_OK);
        return true;
      } catch {
        // Continue searching PATH. Tool execution is validated separately when needed.
      }
    }
  }
  return false;
}

export function hasEphemeralServerlessAccess(env, alias) {
  const raw = value(env, alias);
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw);
    return ["AccountID", "AccessKeyID", "AccessKeySecret", "SecurityToken"]
      .every((name) => typeof parsed[name] === "string" && parsed[name].trim().length > 0);
  } catch {
    return false;
  }
}

function hasServerlessAccess(commandPresent, alias, env) {
  if (hasEphemeralServerlessAccess(env, alias)) return true;
  if (!commandPresent) return false;
  const result = spawnSync("s", ["config", "get", "-a", alias], {
    encoding: "utf8",
    stdio: "ignore",
    timeout: 10_000
  });
  return !result.error && result.status === 0;
}

async function catalogDigest() {
  const bytes = await readFile("knowledge/catalog.json");
  return createHash("sha256").update(bytes).digest("hex");
}

function validSyntheticInput(catalogSha256) {
  const imageDigest = `sha256:${"a".repeat(64)}`;
  return {
    JIANWEI_REGION: "cn-beijing",
    JIANWEI_FC_ROLE_ARN: "acs:ram::1234567890123456:role/jianwei-fc-runtime",
    JIANWEI_VPC_ID: "vpc-synthetic123",
    JIANWEI_VSWITCH_ID: "vsw-synthetic123",
    JIANWEI_SECURITY_GROUP_ID: "sg-synthetic123",
    JIANWEI_PUBLIC_BASE_URL: "https://api.example.cn",
    JIANWEI_DATABASE_URL: "postgresql://user:synthetic-password@db.example.cn/jianwei",
    JIANWEI_DASHSCOPE_API_KEY: "synthetic-secret-never-print",
    JIANWEI_DASHSCOPE_BASE_URL: DEFAULT_DASHSCOPE_BASE_URL,
    JIANWEI_OSS_BUCKET: "jianwei-private-synthetic",
    JIANWEI_KNOWLEDGE_CATALOG_SHA256: catalogSha256,
    JIANWEI_WORST_CASE_COST_MICRO_CNY: "1000",
    JIANWEI_MAX_COST_DAY_MICRO_CNY: "100000",
    JIANWEI_MAX_COST_MONTH_MICRO_CNY: "1000000",
    JIANWEI_QWEN_FLASH_MODEL: FIXED_FLASH_MODEL,
    JIANWEI_QWEN_PLUS_MODEL: FIXED_PLUS_MODEL,
    JIANWEI_IMAGE: `registry.cn-beijing.aliyuncs.com/jianwei/api@${imageDigest}`,
    JIANWEI_CONTAINER_IMAGE_DIGEST: imageDigest,
    JIANWEI_NODE_IMAGE: `node:22.17.0-bookworm-slim@sha256:${"b".repeat(64)}`
  };
}

function validSyntheticCodePackageInput(catalogSha256) {
  return {
    ...validSyntheticInput(catalogSha256),
    JIANWEI_DEPLOYMENT_ARTIFACT_KIND: "code-package",
    JIANWEI_CODE_PATH: process.cwd(),
    JIANWEI_DEPLOYMENT_ARTIFACT_DIGEST: `sha256:${"e".repeat(64)}`,
    JIANWEI_IMAGE: "",
    JIANWEI_CONTAINER_IMAGE_DIGEST: "",
    JIANWEI_NODE_IMAGE: ""
  };
}

async function runSelfTest() {
  const digest = "c".repeat(64);
  const tools = { serverlessDevs: true, psql: true, docker: true };
  const valid = validSyntheticInput(digest);
  const passing = assessCloudDeploymentPreflight({
    env: valid,
    tools,
    serverlessAccessConfigured: true,
    catalogSha256: digest
  });
  if (passing.status !== "GO") throw new Error(`Valid deployment inputs were rejected: ${passing.blockers.join("; ")}`);
  const codePackage = assessCloudDeploymentPreflight({
    env: validSyntheticCodePackageInput(digest),
    tools: { ...tools, docker: false },
    serverlessAccessConfigured: true,
    catalogSha256: digest,
    codePackageDigest: `sha256:${"e".repeat(64)}`
  });
  if (codePackage.status !== "GO") {
    throw new Error(`Valid code package inputs were rejected: ${codePackage.blockers.join("; ")}`);
  }
  const tamperedCodePackage = assessCloudDeploymentPreflight({
    env: validSyntheticCodePackageInput(digest),
    tools,
    serverlessAccessConfigured: true,
    catalogSha256: digest,
    codePackageDigest: `sha256:${"f".repeat(64)}`
  });
  if (tamperedCodePackage.status !== "NO_GO") {
    throw new Error("A deployment digest that did not match the code package bypassed the gate");
  }

  const cases = [
    ["missing secret", { env: { ...valid, JIANWEI_DASHSCOPE_API_KEY: "" }, tools, access: true }],
    ["insecure origin", { env: { ...valid, JIANWEI_PUBLIC_BASE_URL: "http://api.example.cn" }, tools, access: true }],
    ["wrong region", { env: { ...valid, JIANWEI_REGION: "cn-hangzhou" }, tools, access: true }],
    ["mutable image", { env: { ...valid, JIANWEI_IMAGE: "registry.cn-beijing.aliyuncs.com/jianwei/api:latest" }, tools, access: true }],
    ["catalog drift", { env: valid, tools, access: true, catalogSha256: "d".repeat(64) }],
    ["missing access", { env: valid, tools, access: false }],
    ["missing deploy tool", { env: valid, tools: { ...tools, serverlessDevs: false }, access: true }],
    ["invalid cost limit", { env: { ...valid, JIANWEI_MAX_COST_DAY_MICRO_CNY: "0" }, tools, access: true }]
  ];
  for (const [name, fixture] of cases) {
    const result = assessCloudDeploymentPreflight({
      env: fixture.env,
      tools: fixture.tools,
      serverlessAccessConfigured: fixture.access,
      catalogSha256: fixture.catalogSha256 ?? digest
    });
    if (result.status !== "NO_GO") throw new Error(`Cloud preflight self-test expected rejection: ${name}`);
    const rendered = JSON.stringify(result);
    for (const secret of ["synthetic-secret-never-print", "synthetic-password"]) {
      if (rendered.includes(secret)) throw new Error(`Cloud preflight leaked ${secret}`);
    }
  }
  const accessAlias = "jianwei_oauth_serverless_devs_key";
  const ephemeralSecret = "synthetic-ephemeral-secret-never-print";
  const validEphemeralAccess = JSON.stringify({
    AccountID: "1234567890123456",
    AccessKeyID: "STS.synthetic",
    AccessKeySecret: ephemeralSecret,
    SecurityToken: "synthetic-security-token"
  });
  if (!hasEphemeralServerlessAccess({ [accessAlias]: validEphemeralAccess }, accessAlias)) {
    throw new Error("Complete ephemeral Serverless Devs credentials were rejected");
  }
  for (const invalid of [
    "not-json",
    JSON.stringify({ AccountID: "1234567890123456", AccessKeyID: "STS.synthetic" }),
    JSON.stringify({
      AccountID: "1234567890123456",
      AccessKeyID: "STS.synthetic",
      AccessKeySecret: ephemeralSecret,
      SecurityToken: ""
    })
  ]) {
    if (hasEphemeralServerlessAccess({ [accessAlias]: invalid }, accessAlias)) {
      throw new Error("Incomplete ephemeral Serverless Devs credentials bypassed the gate");
    }
  }
  const rendered = JSON.stringify(assessCloudDeploymentPreflight({
    env: valid,
    tools,
    serverlessAccessConfigured: hasEphemeralServerlessAccess(
      { [accessAlias]: validEphemeralAccess },
      accessAlias
    ),
    catalogSha256: digest
  }));
  if (rendered.includes(ephemeralSecret)) throw new Error("Cloud preflight leaked an ephemeral credential");
  process.stdout.write(
    `CLOUD_DEPLOYMENT_PREFLIGHT_SELF_TEST=GO synthetic=1 releaseEvidence=0 bypassesRejected=${cases.length + 4} ephemeralAccess=1 secretValuesPrinted=0\n`
  );
}

async function main() {
  if (process.argv.includes("--self-test")) {
    await runSelfTest();
    return;
  }
  const serverlessDevs = commandAvailable("s");
  const tools = {
    serverlessDevs,
    psql: commandAvailable("psql"),
    docker: commandAvailable("docker")
  };
  const accessAlias = value(process.env, "SERVERLESS_DEVS_ACCESS") || "default";
  const result = assessCloudDeploymentPreflight({
    env: process.env,
    tools,
    serverlessAccessConfigured: hasServerlessAccess(serverlessDevs, accessAlias, process.env),
    catalogSha256: await catalogDigest(),
    codePackageDigest: await observedCodePackageDigest(process.env)
  });
  const outputIndex = process.argv.indexOf("--output");
  if (outputIndex >= 0) {
    const outputValue = process.argv[outputIndex + 1];
    if (!outputValue || outputValue.startsWith("--")) throw new Error("--output requires a new path");
    const output = path.resolve(outputValue);
    if (existsSync(output)) throw new Error(`Refusing to overwrite existing preflight report: ${output}`);
    await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    process.stdout.write(`CLOUD_DEPLOYMENT_PREFLIGHT=${result.status} releaseEvidence=0 report=${output}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
  if (result.status !== "GO") process.exitCode = 1;
}

async function observedCodePackageDigest(env) {
  if ((value(env, "JIANWEI_DEPLOYMENT_ARTIFACT_KIND") || "container") !== "code-package") return null;
  const raw = value(env, "JIANWEI_CODE_PATH");
  if (!raw || !path.isAbsolute(raw) || !existsSync(raw)) return null;
  const entries = await collectCodePackageEntries(path.resolve(raw));
  return `sha256:${hashCodePackageEntries(entries)}`;
}

await main();
