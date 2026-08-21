import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const expected = {
  gradleDistributionSha256: "20f1b1176237254a6fc204d8434196fa11a4cfb387567519c61556e8710aed78",
  gradleWrapperJarSha256: "81a82aaea5abcc8ff68b3dfcb58b3c3c429378efd98e7433460610fecd7ae45f",
  minimumFastifyVersion: "5.8.5"
};

export function assessSupplyChain(input) {
  const failures = [];
  const packageJson = JSON.parse(input.packageJson);
  const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
  for (const [name, version] of Object.entries(dependencies)) {
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
      failures.push(`backend dependency must use an exact version: ${name}@${version}`);
    }
  }
  if (packageJson.packageManager !== "pnpm@11.9.0") failures.push("backend pnpm version is not pinned");
  if (compareSemver(packageJson.dependencies?.fastify, expected.minimumFastifyVersion) < 0) {
    failures.push(`Fastify must be at least ${expected.minimumFastifyVersion}`);
  }
  if (!input.pnpmLock.includes(`fastify@${packageJson.dependencies?.fastify}:`)) {
    failures.push("pnpm lock does not contain the declared Fastify version");
  }
  const pnpmIntegrityCount = count(input.pnpmLock, /integrity: sha512-/g);
  if (pnpmIntegrityCount < 100) failures.push("pnpm lock has insufficient integrity coverage");

  const distributionSha = /^distributionSha256Sum=([a-f0-9]{64})$/m.exec(input.wrapperProperties)?.[1];
  if (distributionSha !== expected.gradleDistributionSha256) {
    failures.push("Gradle distribution SHA-256 is missing or unexpected");
  }
  if (input.wrapperJarSha256 !== expected.gradleWrapperJarSha256) {
    failures.push("Gradle wrapper JAR SHA-256 is unexpected");
  }

  const versionBlock = /^\[versions\]([\s\S]*?)^\[/m.exec(input.versionCatalog)?.[1] ?? "";
  const androidVersions = [...versionBlock.matchAll(/^[-A-Za-z0-9_.]+\s*=\s*"([^"]+)"$/gm)].map((match) => match[1]);
  if (androidVersions.length < 10) failures.push("Android version catalog was not parsed completely");
  for (const version of androidVersions) {
    if (/\+|latest|snapshot|\[|\]|\(|\)|,|\*/i.test(version)) {
      failures.push(`Android dependency version is dynamic: ${version}`);
    }
  }

  if (!input.verificationMetadata.includes("<verify-metadata>true</verify-metadata>")) {
    failures.push("Gradle dependency metadata verification is not enabled");
  }
  const gradleComponentCount = count(input.verificationMetadata, /<component /g);
  const gradleShaCount = count(input.verificationMetadata, /<sha256 value=/g);
  if (gradleComponentCount < 500 || gradleShaCount < 1000) {
    failures.push("Gradle dependency verification metadata does not cover the full build graph");
  }

  let gradleLockCount = 0;
  for (const [project, lock] of Object.entries(input.gradleLocks)) {
    const entries = lock.split(/\r?\n/).filter((line) => line && !line.startsWith("#") && !line.startsWith("empty=")).length;
    if (entries === 0) failures.push(`Gradle dependency lock is empty: ${project}`);
    gradleLockCount += entries;
  }
  if (Object.keys(input.gradleLocks).length !== 3 || gradleLockCount < 700) {
    failures.push("Gradle dependency locks do not cover app, data and domain graphs");
  }

  return {
    status: failures.length === 0 ? "GO" : "NO_GO",
    metrics: {
      pnpmIntegrityCount,
      gradleComponentCount,
      gradleShaCount,
      gradleLockCount,
      fastifyVersion: packageJson.dependencies?.fastify ?? null
    },
    blockers: [...new Set(failures)]
  };
}

const files = await loadFiles();
if (process.argv.includes("--self-test")) {
  const passing = assessSupplyChain(files);
  if (passing.status !== "GO") throw new Error(`Supply-chain fixture failed: ${passing.blockers.join("; ")}`);
  const cases = [
    ["old Fastify", (value) => {
      const packageJson = JSON.parse(value.packageJson);
      packageJson.dependencies.fastify = "5.6.2";
      value.packageJson = JSON.stringify(packageJson);
    }],
    ["missing Gradle distribution checksum", (value) => { value.wrapperProperties = value.wrapperProperties.replace(/^distributionSha256Sum=.*$/m, ""); }],
    ["mutated wrapper JAR", (value) => { value.wrapperJarSha256 = "0".repeat(64); }],
    ["dynamic Android dependency", (value) => { value.versionCatalog = value.versionCatalog.replace('core = "1.17.0"', 'core = "1.+"'); }],
    ["empty verification metadata", (value) => { value.verificationMetadata = "<verification-metadata/>"; }]
  ];
  for (const [name, mutate] of cases) {
    const value = structuredClone(files);
    mutate(value);
    if (assessSupplyChain(value).status !== "NO_GO") throw new Error(`Supply-chain self-test expected rejection: ${name}`);
  }
  process.stdout.write(`SUPPLY_CHAIN_SELF_TEST=GO synthetic=1 releaseEvidence=0 bypassesRejected=${cases.length}\n`);
} else {
  const result = assessSupplyChain(files);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status !== "GO") process.exitCode = 1;
}

async function loadFiles() {
  const wrapperJar = await readFile("android/gradle/wrapper/gradle-wrapper.jar");
  return {
    packageJson: await readFile("backend/package.json", "utf8"),
    pnpmLock: await readFile("backend/pnpm-lock.yaml", "utf8"),
    wrapperProperties: await readFile("android/gradle/wrapper/gradle-wrapper.properties", "utf8"),
    wrapperJarSha256: createHash("sha256").update(wrapperJar).digest("hex"),
    versionCatalog: await readFile("android/gradle/libs.versions.toml", "utf8"),
    verificationMetadata: await readFile("android/gradle/verification-metadata.xml", "utf8"),
    gradleLocks: {
      app: await readFile("android/app/gradle.lockfile", "utf8"),
      data: await readFile("android/data/gradle.lockfile", "utf8"),
      domain: await readFile("android/domain/gradle.lockfile", "utf8")
    }
  };
}

function compareSemver(left, right) {
  if (!/^\d+\.\d+\.\d+$/.test(left ?? "")) return -1;
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

function count(value, pattern) {
  return value.match(pattern)?.length ?? 0;
}
