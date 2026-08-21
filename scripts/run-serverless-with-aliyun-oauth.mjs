import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ACCESS_ALIAS = "jianwei_oauth_serverless_devs_key";
const MINIMUM_REMAINING_STS_SECONDS = 300;
const ALLOWED_ACTIONS = new Set(["preflight", "verify", "deploy"]);

function parseArguments(argv) {
  const valueAfter = (name) => {
    const index = argv.indexOf(name);
    if (index < 0) return null;
    const result = argv[index + 1];
    if (!result || result.startsWith("--")) throw new Error(`${name} requires a value`);
    return result;
  };
  const profile = valueAfter("--profile") ?? "jianwei";
  const action = valueAfter("--action") ?? "preflight";
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(profile)) throw new Error("--profile is invalid");
  if (!ALLOWED_ACTIONS.has(action)) throw new Error("--action must be preflight, verify, or deploy");
  return {
    profile,
    action,
    confirmCloudMutation: argv.includes("--confirm-cloud-mutation")
  };
}

export function buildEphemeralAccess(profile, identity, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (profile?.mode !== "OAuth") throw new Error("The selected Alibaba Cloud CLI profile must use OAuth");
  const expiration = Number(profile.sts_expiration);
  if (!Number.isSafeInteger(expiration) || expiration - nowSeconds < MINIMUM_REMAINING_STS_SECONDS) {
    throw new Error("The OAuth STS credential is missing, expired, or too close to expiry");
  }
  const values = {
    AccountID: identity?.AccountId,
    AccessKeyID: profile.access_key_id,
    AccessKeySecret: profile.access_key_secret,
    SecurityToken: profile.sts_token
  };
  if (Object.values(values).some((entry) => typeof entry !== "string" || entry.trim().length === 0)) {
    throw new Error("The OAuth profile did not yield a complete temporary STS credential set");
  }
  return JSON.stringify(values);
}

function runJson(command, args, diagnosticCode) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
    maxBuffer: 2 * 1024 * 1024
  });
  if (result.error || result.status !== 0) throw new Error(diagnosticCode);
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`${diagnosticCode}_invalid_json`);
  }
}

function loadOAuthAccess(profileName) {
  // Identity lookup lets the official CLI refresh an expired STS layer before
  // we read the profile snapshot that is passed to Serverless Devs.
  const identity = runJson(
    "aliyun",
    ["sts", "GetCallerIdentity", "--profile", profileName],
    "aliyun_oauth_identity_unavailable"
  );
  const profile = runJson(
    "aliyun",
    ["configure", "get", "--profile", profileName],
    "aliyun_oauth_profile_unavailable"
  );
  return {
    access: buildEphemeralAccess(profile, identity),
    identitySha256: createHash("sha256")
      .update(`${identity.AccountId}:${identity.UserId ?? identity.RoleId ?? identity.PrincipalId ?? ""}`)
      .digest("hex")
  };
}

function runChild(command, args, env, timeout) {
  const result = spawnSync(command, args, {
    env,
    stdio: "inherit",
    timeout
  });
  if (result.error) throw new Error("deployment_child_process_failed");
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function runSelfTest() {
  const now = 1_700_000_000;
  const profile = {
    mode: "OAuth",
    access_key_id: "STS.synthetic",
    access_key_secret: "synthetic-secret-never-print",
    sts_token: "synthetic-token-never-print",
    sts_expiration: now + 3_600
  };
  const identity = { AccountId: "1234567890123456", UserId: "synthetic-user" };
  const envelope = buildEphemeralAccess(profile, identity, now);
  const parsed = JSON.parse(envelope);
  if (parsed.AccountID !== identity.AccountId || parsed.SecurityToken !== profile.sts_token) {
    throw new Error("Valid OAuth STS credentials were not bridged exactly");
  }
  const rejected = [
    [{ ...profile, mode: "AK" }, identity, now],
    [{ ...profile, sts_expiration: now + 299 }, identity, now],
    [{ ...profile, sts_token: "" }, identity, now],
    [profile, {}, now]
  ];
  for (const args of rejected) {
    let failed = false;
    try {
      buildEphemeralAccess(...args);
    } catch {
      failed = true;
    }
    if (!failed) throw new Error("Invalid OAuth STS credentials bypassed the bridge");
  }
  process.stdout.write(
    `ALIYUN_OAUTH_SERVERLESS_BRIDGE_SELF_TEST=GO synthetic=1 releaseEvidence=0 bypassesRejected=${rejected.length} secretValuesPrinted=0\n`
  );
}

function main() {
  if (process.argv.includes("--self-test")) {
    runSelfTest();
    return;
  }
  if (!existsSync("deploy/s.yaml.example")) throw new Error("Run this command from the repository root");
  const options = parseArguments(process.argv.slice(2));
  if (
    options.action === "deploy" &&
    (!options.confirmCloudMutation || process.env.JIANWEI_CLOUD_MUTATION_CONFIRMED !== "YES")
  ) {
    throw new Error(
      "Cloud deployment requires --confirm-cloud-mutation and JIANWEI_CLOUD_MUTATION_CONFIRMED=YES"
    );
  }

  const oauth = loadOAuthAccess(options.profile);
  const env = {
    ...process.env,
    SERVERLESS_DEVS_ACCESS: ACCESS_ALIAS,
    [ACCESS_ALIAS]: oauth.access
  };
  process.stdout.write(
    `ALIYUN_OAUTH_ACCESS=GO profile=${options.profile} identitySha256=${oauth.identitySha256} persistedServerlessCredential=0\n`
  );

  runChild(process.execPath, ["scripts/check-cloud-deployment-preflight.mjs"], env, 60_000);
  if (options.action === "preflight") return;

  runChild("s", ["verify", "-t", "deploy/s.yaml.example"], env, 120_000);
  if (options.action === "verify") return;

  runChild("s", ["deploy", "-t", "deploy/s.yaml.example"], env, 20 * 60_000);
}

const isMainModule = process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMainModule) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_failure";
    process.stderr.write("ALIYUN_OAUTH_SERVERLESS_BRIDGE=NO_GO reason=" + message + "\n");
    process.exitCode = 1;
  }
}
