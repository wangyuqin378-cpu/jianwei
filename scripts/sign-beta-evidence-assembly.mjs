import { createHash, generateKeyPairSync } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  BETA_EVIDENCE_ASSEMBLY_ATTESTATION_ROLE,
  createAssemblyAttestation,
  verifyAssemblyAttestation
} from "./lib/assembly-attestation.mjs";
import { validateEvidenceTrustPolicy } from "./lib/evidence-attestation.mjs";
import { parseFlagArgs } from "./lib/fact-review.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EVALUATION_ROOT = path.join(REPOSITORY_ROOT, "evaluation");
const MANIFEST_PATH = path.join(EVALUATION_ROOT, "beta-evidence-assembly-manifest.json");
const POLICY_PATH = path.join(REPOSITORY_ROOT, "config", "evidence-trust-policy.json");
const OUTPUT_PATH = path.join(EVALUATION_ROOT, "beta-evidence-assembly.attestation.json");
const ARTIFACT_FILES = {
  imageEvaluation: "compiled-image-evaluation.json",
  cardAudit: "compiled-card-audit.json",
  betaCohort: "beta-cohort-compiled.json",
  cloudVerification: "cloud-beta-compiled.json",
  releaseArtifact: "release-artifact.json",
  physicalDeviceRuns: "compiled-physical-device-runs.json",
  accessibilityAudit: "compiled-accessibility-audit.json",
  deploymentReceipt: "deployment-receipt.json"
};

if (process.argv.includes("--self-test")) {
  await runSelfTest();
  process.exit(0);
}

const args = parseFlagArgs(process.argv.slice(2));
if (!args.has("--confirm-reviewed")) {
  throw new Error("Assembly signing requires --confirm-reviewed after independent review of the exact manifest and eight artifacts");
}
const issuerId = required(args, "--issuer-id");
const keyId = required(args, "--key-id");
const privateKeyPath = path.resolve(process.cwd(), required(args, "--private-key"));
await assertExternalOrdinaryPrivateKey(privateKeyPath, REPOSITORY_ROOT);
const [{ manifest, manifestBytes }, artifacts, { policy, policyBytes }, privateKeyPem] = await Promise.all([
  readJson(MANIFEST_PATH, "Beta evidence assembly manifest"),
  readArtifacts(),
  readPolicy(),
  readFile(privateKeyPath, "utf8")
]);
validateEvidenceTrustPolicy(policy, policyBytes, new Date(), requiredExternalPolicySha256());
const attestation = createAssemblyAttestation({
  manifest,
  manifestBytes,
  artifacts,
  policy,
  policyBytes,
  issuerId,
  keyId,
  privateKeyPem
});
verifyAssemblyAttestation({ manifest, manifestBytes, artifacts, policy, policyBytes, attestation });
if (!args.has("--write")) {
  process.stdout.write(`BETA_EVIDENCE_ASSEMBLY_ATTESTATION_PREVIEW=GO issuer=${issuerId} keyId=${keyId} role=${BETA_EVIDENCE_ASSEMBLY_ATTESTATION_ROLE} artifactBindings=8 wrote=0\n`);
  process.exit(0);
}
await assertOrdinaryDirectory(EVALUATION_ROOT);
await writeFile(OUTPUT_PATH, `${JSON.stringify(attestation, null, 2)}\n`, {
  encoding: "utf8",
  flag: "wx",
  mode: 0o600
});
process.stdout.write(`BETA_EVIDENCE_ASSEMBLY_ATTESTATION=GO issuer=${issuerId} keyId=${keyId} role=${BETA_EVIDENCE_ASSEMBLY_ATTESTATION_ROLE} artifactBindings=8 wrote=1\n`);

async function readArtifacts() {
  return Object.fromEntries(await Promise.all(Object.entries(ARTIFACT_FILES).map(async ([name, filename]) => {
    const artifact = await readJson(path.join(EVALUATION_ROOT, filename), `Beta component artifact ${name}`);
    return [name, { bytes: artifact.manifestBytes, value: artifact.manifest }];
  })));
}

async function readPolicy() {
  const { manifest: policy, manifestBytes: policyBytes } = await readJson(POLICY_PATH, "Evidence trust policy");
  return { policy, policyBytes };
}

async function readJson(file, label) {
  const manifestBytes = await readFile(file);
  let manifest;
  try {
    manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes));
  } catch {
    throw new Error(`${label} is not valid UTF-8 JSON: ${file}`);
  }
  return { manifest, manifestBytes };
}

async function runSelfTest() {
  const now = new Date("2026-01-08T00:00:00.000Z");
  const { privateKey: assemblyPrivateKey, publicKey: assemblyPublicKey } = generateKeyPairSync("ed25519");
  const { publicKey: releasePublicKey } = generateKeyPairSync("ed25519");
  const { publicKey: deploymentPublicKey } = generateKeyPairSync("ed25519");
  const { privateKey: roguePrivateKey } = generateKeyPairSync("ed25519");
  const issuerId = "independent-assembly-reviewer";
  const keyId = "assembly-test-key-2026";
  const policy = makePolicy({ assemblyPublicKey, releasePublicKey, deploymentPublicKey });
  const policyBytes = jsonBytes(policy);
  const artifacts = makeArtifacts();
  const manifest = makeApprovedManifest(artifacts);
  const manifestBytes = jsonBytes(manifest);
  const privateKeyPem = assemblyPrivateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const attestation = createAssemblyAttestation({
    manifest,
    manifestBytes,
    artifacts,
    policy,
    policyBytes,
    issuerId,
    keyId,
    privateKeyPem,
    now
  });
  const verified = verifyAssemblyAttestation({
    manifest, manifestBytes, artifacts, policy, policyBytes, attestation, now
  });
  if (!verified.verified || verified.manifestSha256 !== attestation.manifestSha256 ||
      verified.knowledgeCatalogSha256 !== manifest.knowledge.catalogSha256 ||
      verified.topicBacklogSha256 !== manifest.knowledge.topicBacklogSha256 ||
      verified.knowledgeReviewerPolicySha256 !== manifest.knowledge.reviewerPolicySha256 ||
      verified.artifactCount !== 8) {
    throw new Error("Assembly attestation self-test could not verify a trusted signature");
  }

  let rejected = 0;
  const reject = (operation) => {
    try { operation(); } catch { rejected += 1; return; }
    throw new Error("Assembly attestation self-test accepted an invalid trust claim");
  };
  const tamperedArtifacts = structuredCloneArtifacts(artifacts);
  tamperedArtifacts.imageEvaluation.value = { ...tamperedArtifacts.imageEvaluation.value, tampered: true };
  tamperedArtifacts.imageEvaluation.bytes = jsonBytes(tamperedArtifacts.imageEvaluation.value);
  reject(() => verifyAssemblyAttestation({
    manifest, manifestBytes, artifacts: tamperedArtifacts, policy, policyBytes, attestation, now
  }));
  reject(() => createAssemblyAttestation({
    manifest,
    manifestBytes,
    artifacts,
    policy,
    policyBytes,
    issuerId,
    keyId,
    privateKeyPem: roguePrivateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    now
  }));
  reject(() => verifyAssemblyAttestation({
    manifest,
    manifestBytes,
    artifacts,
    policy,
    policyBytes,
    attestation: { ...attestation, role: "beta_release_approver" },
    now
  }));
  const singleSignerPolicy = makePolicy({ assemblyPublicKey, releasePublicKey, deploymentPublicKey, singleSigner: true });
  reject(() => createAssemblyAttestation({
    manifest,
    manifestBytes,
    artifacts,
    policy: singleSignerPolicy,
    policyBytes: jsonBytes(singleSignerPolicy),
    issuerId,
    keyId,
    privateKeyPem,
    now
  }));
  reject(() => verifyAssemblyAttestation({
    manifest,
    manifestBytes: Buffer.concat([manifestBytes, Buffer.from(" ")]),
    artifacts,
    policy,
    policyBytes,
    attestation,
    now
  }));
  if (rejected !== 5) throw new Error(`Expected five rejected assembly-trust bypasses, observed ${rejected}`);

  const repositoryKeyDirectory = path.join(REPOSITORY_ROOT, ".tooling", `assembly-signing-self-test-${process.pid}`);
  const repositoryKey = path.join(repositoryKeyDirectory, "test.private.pem");
  let repositoryKeyRejected = false;
  try {
    await mkdir(repositoryKeyDirectory, { recursive: true });
    await writeFile(repositoryKey, privateKeyPem, { encoding: "utf8", flag: "wx" });
    try {
      await assertExternalOrdinaryPrivateKey(repositoryKey, REPOSITORY_ROOT);
    } catch (error) {
      if (/outside the repository/.test(error?.message ?? "")) repositoryKeyRejected = true;
      else throw error;
    }
  } finally {
    await rm(repositoryKeyDirectory, { recursive: true, force: true });
  }
  if (!repositoryKeyRejected) throw new Error("A private key inside the repository bypassed the signing boundary");
  process.stdout.write("BETA_EVIDENCE_ASSEMBLY_ATTESTATION_SELF_TEST=GO synthetic=1 releaseEvidence=0 trustedSignature=1 artifactBindings=8 knowledgeByteBindings=2 reviewerPolicyBinding=1 artifactTamperRejected=1 rogueKeyRejected=1 wrongRoleRejected=1 singleSignerRejected=1 manifestByteTamperRejected=1 repositoryKeyRejected=1 bypassesRejected=5\n");
}

function makePolicy({ assemblyPublicKey, releasePublicKey, deploymentPublicKey, singleSigner = false }) {
  const assemblyRoles = singleSigner
    ? [BETA_EVIDENCE_ASSEMBLY_ATTESTATION_ROLE, "beta_release_approver"]
    : [BETA_EVIDENCE_ASSEMBLY_ATTESTATION_ROLE];
  return {
    schemaVersion: 1,
    evidenceKind: "beta_evidence_trust_policy",
    policyId: "jianwei-beta-assembly-test-policy",
    issuers: [
      {
        issuerId: "independent-assembly-reviewer",
        keyId: "assembly-test-key-2026",
        algorithm: "Ed25519",
        publicKeyPem: assemblyPublicKey.export({ type: "spki", format: "pem" }).toString(),
        roles: assemblyRoles,
        notBefore: "2026-01-01T00:00:00.000Z",
        notAfter: "2027-01-01T00:00:00.000Z",
        status: "active"
      },
      {
        issuerId: "independent-release-approver",
        keyId: "release-test-key-2026",
        algorithm: "Ed25519",
        publicKeyPem: releasePublicKey.export({ type: "spki", format: "pem" }).toString(),
        roles: ["beta_release_approver"],
        notBefore: "2026-01-01T00:00:00.000Z",
        notAfter: "2027-01-01T00:00:00.000Z",
        status: "active"
      },
      {
        issuerId: "independent-deployment-pipeline",
        keyId: "deployment-test-key-2026",
        algorithm: "Ed25519",
        publicKeyPem: deploymentPublicKey.export({ type: "spki", format: "pem" }).toString(),
        roles: ["beta_deployment_attestor"],
        notBefore: "2026-01-01T00:00:00.000Z",
        notAfter: "2027-01-01T00:00:00.000Z",
        status: "active"
      }
    ]
  };
}

function makeArtifacts() {
  const kinds = {
    imageEvaluation: "compiled_image_evaluation",
    cardAudit: "compiled_card_audit",
    betaCohort: "compiled_beta_cohort",
    cloudVerification: "verified_cloud_run",
    releaseArtifact: "verified_release_apk",
    physicalDeviceRuns: "compiled_physical_device_runs",
    accessibilityAudit: "compiled_accessibility_audit",
    deploymentReceipt: "trusted_deployment_receipt"
  };
  return Object.fromEntries(Object.entries(kinds).map(([name, evidenceKind]) => {
    const value = { evidenceKind, selfTestName: name };
    return [name, { value, bytes: jsonBytes(value) }];
  }));
}

function makeApprovedManifest(artifacts) {
  return {
    schemaVersion: 3,
    evidenceKind: "beta_evidence_assembly_manifest",
    createdAt: "2026-01-07T22:00:00.000Z",
    evidenceOwner: "accountable-human-reviewer",
    assemblyApproved: true,
    approvedAt: "2026-01-07T23:00:00.000Z",
    knowledge: {
      catalogSha256: "d".repeat(64),
      topicBacklogSha256: "e".repeat(64),
      reviewerPolicySha256: "f".repeat(64)
    },
    artifacts: Object.fromEntries(Object.entries(artifacts).map(([name, artifact]) => [name, {
      evidenceKind: artifact.value.evidenceKind,
      sha256: sha256(artifact.bytes)
    }]))
  };
}

function structuredCloneArtifacts(artifacts) {
  return Object.fromEntries(Object.entries(artifacts).map(([name, artifact]) => [name, {
    bytes: Buffer.from(artifact.bytes),
    value: structuredClone(artifact.value)
  }]));
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function assertExternalOrdinaryPrivateKey(file, workspaceRoot) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error("Assembly private key must be an ordinary external file");
  }
  const actual = await realpath(file);
  if (!samePath(actual, file)) throw new Error("Assembly private key cannot resolve through a symlink or junction");
  const workspace = path.resolve(workspaceRoot);
  const candidate = path.resolve(file);
  if (samePath(candidate, workspace) || isWithin(candidate, workspace)) {
    throw new Error("Assembly private key must remain outside the repository");
  }
}

async function assertOrdinaryDirectory(directory) {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`Controlled output directory must be ordinary: ${directory}`);
  }
  const actual = await realpath(directory);
  if (!samePath(actual, directory)) throw new Error(`Controlled output directory cannot be a symlink or junction: ${directory}`);
}

function required(args, name) {
  const value = args.get(name);
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

function requiredExternalPolicySha256() {
  const value = process.env.JIANWEI_EVIDENCE_TRUST_POLICY_SHA256;
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error("JIANWEI_EVIDENCE_TRUST_POLICY_SHA256 must be provided by the protected assembly-review environment");
  }
  return value;
}

function isWithin(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function samePath(left, right) {
  const normalize = (value) => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
  return normalize(left) === normalize(right);
}
