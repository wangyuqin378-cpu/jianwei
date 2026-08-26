import { X509Certificate, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, lstat, mkdir, readFile, readdir, readlink, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CERTIFICATES = [
  {
    file: "AppleIncRootCertificate.cer",
    url: "https://www.apple.com/appleca/AppleIncRootCertificate.cer",
    sha256: "b0b1730ecbc7ff4505142c49f1295e6eda6bcaed7e2c68c5be91b5a11001f024",
    commonName: "Apple Root CA"
  },
  {
    file: "AppleRootCA-G2.cer",
    url: "https://www.apple.com/certificateauthority/AppleRootCA-G2.cer",
    sha256: "c2b9b042dd57830e7d117dac55ac8ae19407d38e41d88f3215bc3a890444a050",
    commonName: "Apple Root CA - G2"
  },
  {
    file: "AppleRootCA-G3.cer",
    url: "https://www.apple.com/certificateauthority/AppleRootCA-G3.cer",
    sha256: "63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179",
    commonName: "Apple Root CA - G3"
  }
];

function valueAfter(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", timeout: 10 * 60_000 });
  if (result.error || result.status !== 0) throw new Error(`Command failed: ${command}`);
}

async function downloadPinnedCertificate(definition, destination) {
  const variants = [`${definition.url}?download=1`, `${definition.url}?download=2`, definition.url];
  let lastStatus = "network_error";
  for (const url of variants) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/pkix-cert,application/x-x509-ca-cert,*/*",
          Referer: "https://www.apple.com/certificateauthority/",
          "User-Agent": "Mozilla/5.0 JianweiReleaseBuilder/1.0"
        },
        redirect: "follow",
        signal: AbortSignal.timeout(30_000)
      });
      lastStatus = `http_${response.status}`;
      if (!response.ok) continue;
      const bytes = Buffer.from(await response.arrayBuffer());
      const digest = createHash("sha256").update(bytes).digest("hex");
      if (digest !== definition.sha256) throw new Error(`${definition.file} digest mismatch`);
      const certificate = new X509Certificate(bytes);
      if (!certificate.subject.includes(`CN=${definition.commonName}`) || certificate.subject !== certificate.issuer) {
        throw new Error(`${definition.file} is not the expected self-signed Apple root`);
      }
      await writeFile(destination, bytes, { flag: "wx", mode: 0o644 });
      return { file: definition.file, sha256: digest, subject: certificate.subject };
    } catch (error) {
      if (error instanceof Error && /digest mismatch|not the expected/.test(error.message)) throw error;
      lastStatus = error instanceof Error ? error.name : lastStatus;
    }
  }
  throw new Error(`Unable to download ${definition.file} from Apple (${lastStatus})`);
}

export async function collectCodePackageEntries(root, directory = root) {
  const output = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "en"))) {
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(root, absolute).replaceAll("\\", "/");
    const metadata = await lstat(absolute);
    if (metadata.isDirectory()) {
      output.push(...await collectCodePackageEntries(root, absolute));
    } else if (metadata.isFile()) {
      output.push({ name: relative, kind: "file", bytes: await readFile(absolute) });
    } else if (metadata.isSymbolicLink()) {
      const target = await readlink(absolute);
      const resolved = path.resolve(path.dirname(absolute), target);
      if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
        throw new Error(`Code package contains an external symlink: ${relative}`);
      }
      output.push({ name: relative, kind: "symlink", bytes: Buffer.from(target, "utf8") });
    } else {
      throw new Error(`Code package contains an unsupported entry: ${relative}`);
    }
  }
  return output;
}

export function hashCodePackageEntries(entries) {
  if (entries.length === 0) throw new Error("Code package is empty");
  const digest = createHash("sha256").update("jianwei-fc-code-package-v1\0");
  for (const entry of entries) {
    digest.update(`${entry.kind}\0${Buffer.byteLength(entry.name)}\0${entry.name}\0${entry.bytes.length}\0`);
    digest.update(entry.bytes);
  }
  return digest.digest("hex");
}

async function copyPackageInputs(staging, identityPath) {
  await Promise.all([
    cp(path.join(ROOT, "backend", "dist"), path.join(staging, "dist"), { recursive: true }),
    cp(path.join(ROOT, "backend", "migrations"), path.join(staging, "migrations"), { recursive: true }),
    cp(path.join(ROOT, "knowledge"), path.join(staging, "knowledge"), { recursive: true }),
    cp(path.join(ROOT, "backend", "package.json"), path.join(staging, "package.json")),
    cp(path.join(ROOT, "backend", "pnpm-lock.yaml"), path.join(staging, "pnpm-lock.yaml")),
    cp(path.join(ROOT, "backend", "pnpm-workspace.yaml"), path.join(staging, "pnpm-workspace.yaml")),
    cp(identityPath, path.join(staging, "release-identity.json"))
  ]);
}

async function main() {
  const argv = process.argv.slice(2);
  const output = path.resolve(ROOT, valueAfter(argv, "--output") ?? ".tooling/fc-code-package");
  const report = path.resolve(ROOT, valueAfter(argv, "--report") ?? ".tooling/fc-code-package-report.json");
  if (existsSync(output) || existsSync(report)) throw new Error("Refusing to overwrite an existing package or report");
  const staging = `${output}.${process.pid}.tmp`;
  const identityPath = path.join(staging, ".release-identity.source.json");
  await mkdir(staging, { recursive: true, mode: 0o700 });
  try {
    run("pnpm", ["run", "release:identity", "--", "--write", identityPath], path.join(ROOT, "backend"));
    run("pnpm", ["run", "build"], path.join(ROOT, "backend"));
    await copyPackageInputs(staging, identityPath);
    await rm(identityPath, { force: true });

    const certificateDirectory = path.join(staging, "certificates");
    await mkdir(certificateDirectory, { recursive: true });
    const certificates = [];
    for (const definition of CERTIFICATES) {
      certificates.push(await downloadPinnedCertificate(definition, path.join(certificateDirectory, definition.file)));
    }

    run("pnpm", [
      "install",
      "--prod",
      "--frozen-lockfile",
      "--ignore-scripts",
      "--config.package-import-method=copy"
    ], staging);
    // pnpm writes absolute staging paths and installation timestamps to these
    // two local bookkeeping files. Node does not read them at runtime, and
    // retaining them would make identical release inputs hash differently.
    await Promise.all([
      rm(path.join(staging, "node_modules", ".modules.yaml"), { force: true }),
      rm(path.join(staging, "node_modules", ".pnpm-workspace-state-v1.json"), { force: true })
    ]);

    const entries = await collectCodePackageEntries(staging);
    const nativeModules = entries.filter((entry) => entry.kind === "file" && entry.name.endsWith(".node"));
    if (nativeModules.length > 0) {
      throw new Error("ARM-built native Node modules cannot be deployed to the x86_64 Function Compute runtime");
    }
    const packageSha256 = hashCodePackageEntries(entries);
    const totalBytes = entries.reduce((sum, entry) => sum + entry.bytes.length, 0);
    const releaseIdentity = JSON.parse(await readFile(path.join(staging, "release-identity.json"), "utf8"));
    await mkdir(path.dirname(output), { recursive: true });
    await rename(staging, output);
    const result = {
      schemaVersion: 1,
      evidenceKind: "fc_code_package",
      deploymentArtifactKind: "code-package",
      deploymentArtifactDigest: `sha256:${packageSha256}`,
      backendReleaseSha256: releaseIdentity.backendReleaseSha256,
      fileCount: entries.length,
      totalBytes,
      nativeModuleCount: nativeModules.length,
      certificates
    };
    await mkdir(path.dirname(report), { recursive: true });
    await writeFile(report, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    process.stdout.write(
      `FC_CODE_PACKAGE=GO files=${result.fileCount} bytes=${result.totalBytes} digest=${result.deploymentArtifactDigest} nativeModules=0\n`
    );
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

const isMainModule = process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMainModule) await main();
