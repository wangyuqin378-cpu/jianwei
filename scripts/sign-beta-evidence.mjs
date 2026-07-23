import { generateKeyPairSync } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  BETA_EVIDENCE_ATTESTATION_ROLE,
  createEvidenceAttestation,
  validateEvidenceTrustPolicy,
  verifyEvidenceAttestation
} from "./lib/evidence-attestation.mjs";
import { parseFlagArgs } from "./lib/fact-review.mjs";
import { prepareEvaluationRoot, resolveEvaluationOutput } from "./lib/beta-evidence-assembly.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (process.argv.includes("--self-test")) {
  await runSelfTest();
  process.exit(0);
}

const args = parseFlagArgs(process.argv.slice(2));
if (!args.has("--confirm-reviewed")) {
  throw new Error("Signing requires --confirm-reviewed after the accountable human reviews the exact Beta evidence");
}
const evidencePath = path.resolve(process.cwd(), String(args.get("--evidence") ?? "evaluation/beta-evidence.json"));
const policyPath = path.resolve(process.cwd(), String(args.get("--policy") ?? "config/evidence-trust-policy.json"));
const privateKeyPath = path.resolve(process.cwd(), required(args, "--private-key"));
const issuerId = required(args, "--issuer-id");
const keyId = required(args, "--key-id");
await assertExternalOrdinaryPrivateKey(privateKeyPath, REPOSITORY_ROOT);
const [artifactBytes, policyBytes, privateKeyPem] = await Promise.all([
  readFile(evidencePath),
  readFile(policyPath),
  readFile(privateKeyPath, "utf8")
]);
const artifact = JSON.parse(artifactBytes.toString("utf8"));
const policy = JSON.parse(policyBytes.toString("utf8"));
validateEvidenceTrustPolicy(policy, policyBytes, new Date(), requiredExternalPolicySha256());
const attestation = createEvidenceAttestation({
  artifact,
  artifactBytes,
  policy,
  policyBytes,
  issuerId,
  keyId,
  privateKeyPem
});
verifyEvidenceAttestation({ artifact, artifactBytes, policy, policyBytes, attestation });
if (!args.has("--write")) {
  process.stdout.write(`BETA_EVIDENCE_ATTESTATION_PREVIEW=GO issuer=${issuerId} keyId=${keyId} role=${BETA_EVIDENCE_ATTESTATION_ROLE} wrote=0\n`);
  process.exit(0);
}
const evaluationRoot = await prepareEvaluationRoot(process.cwd());
const output = await resolveEvaluationOutput(
  evaluationRoot,
  path.resolve(process.cwd(), String(args.get("--output") ?? "evaluation/beta-evidence.attestation.json"))
);
await writeFile(output, `${JSON.stringify(attestation, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
process.stdout.write(`BETA_EVIDENCE_ATTESTATION=GO issuer=${issuerId} keyId=${keyId} role=${BETA_EVIDENCE_ATTESTATION_ROLE} wrote=1\n`);

async function runSelfTest() {
  const now = new Date("2026-01-08T00:00:00.000Z");
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const { publicKey: assemblyPublicKey } = generateKeyPairSync("ed25519");
  const { publicKey: deploymentPublicKey } = generateKeyPairSync("ed25519");
  const { privateKey: roguePrivateKey } = generateKeyPairSync("ed25519");
  const policy = {
    schemaVersion: 1,
    evidenceKind: "beta_evidence_trust_policy",
    policyId: "jianwei-beta-test-policy",
    issuers: [
      trustIssuer("human-release-approver", "release-key-2026", BETA_EVIDENCE_ATTESTATION_ROLE, publicKey),
      trustIssuer("qa-assembly-attestor", "assembly-key-2026", "beta_assembly_attestor", assemblyPublicKey),
      trustIssuer("deployment-pipeline", "deployment-key-2026", "beta_deployment_attestor", deploymentPublicKey)
    ]
  };
  const policyBytes = Buffer.from(`${JSON.stringify(policy, null, 2)}\n`, "utf8");
  const artifact = {
    schemaVersion: 3,
    evidenceKind: "real_beta_evidence",
    evidenceOwner: "human-release-approver",
    generatedAt: "2026-01-07T23:00:00.000Z"
  };
  const artifactBytes = Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const attestation = createEvidenceAttestation({
    artifact, artifactBytes, policy, policyBytes,
    issuerId: "human-release-approver", keyId: "release-key-2026", privateKeyPem, now
  });
  const verified = verifyEvidenceAttestation({ artifact, artifactBytes, policy, policyBytes, attestation, now });
  if (!verified.verified || verified.artifactSha256 !== attestation.artifactSha256) {
    throw new Error("Evidence attestation self-test could not verify a trusted signature");
  }
  let rejected = 0;
  const reject = (operation) => {
    try { operation(); } catch { rejected += 1; return; }
    throw new Error("Evidence attestation self-test accepted an invalid trust claim");
  };
  reject(() => verifyEvidenceAttestation({
    artifact,
    artifactBytes: Buffer.concat([artifactBytes, Buffer.from(" ")]),
    policy,
    policyBytes,
    attestation,
    now
  }));
  reject(() => createEvidenceAttestation({
    artifact, artifactBytes, policy, policyBytes,
    issuerId: "human-release-approver",
    keyId: "release-key-2026",
    privateKeyPem: roguePrivateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    now
  }));
  reject(() => verifyEvidenceAttestation({
    artifact,
    artifactBytes,
    policy,
    policyBytes,
    attestation: { ...attestation, signatureBase64: Buffer.alloc(64).toString("base64") },
    now
  }));
  const roleCollapsed = structuredClone(policy);
  roleCollapsed.issuers[0].roles.push("beta_deployment_attestor");
  reject(() => validateEvidenceTrustPolicy(
    roleCollapsed,
    Buffer.from(`${JSON.stringify(roleCollapsed, null, 2)}\n`, "utf8"),
    now
  ));
  const keyReused = structuredClone(policy);
  keyReused.issuers[1].publicKeyPem = keyReused.issuers[0].publicKeyPem;
  reject(() => validateEvidenceTrustPolicy(
    keyReused,
    Buffer.from(`${JSON.stringify(keyReused, null, 2)}\n`, "utf8"),
    now
  ));
  reject(() => validateEvidenceTrustPolicy(policy, policyBytes, now, "0".repeat(64)));
  if (rejected !== 6) throw new Error(`Expected six rejected trust bypasses, observed ${rejected}`);
  const repositoryKeyDirectory = path.join(REPOSITORY_ROOT, ".tooling", `signing-self-test-${process.pid}`);
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
  process.stdout.write("BETA_EVIDENCE_ATTESTATION_SELF_TEST=GO synthetic=1 releaseEvidence=0 trustedSignature=1 forgedBundleRejected=1 rogueKeyRejected=1 repositoryKeyRejected=1 roleCollapseRejected=1 publicKeyReuseRejected=1 externalPolicyPinRejected=1 bypassesRejected=6\n");
}

function trustIssuer(issuerId, keyId, role, publicKey) {
  return {
    issuerId,
    keyId,
    algorithm: "Ed25519",
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    roles: [role],
    notBefore: "2026-01-01T00:00:00.000Z",
    notAfter: "2027-01-01T00:00:00.000Z",
    status: "active"
  };
}

async function assertExternalOrdinaryPrivateKey(file, workspaceRoot) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("Evidence private key must be an ordinary external file");
  const actual = await realpath(file);
  if (!samePath(actual, file)) throw new Error("Evidence private key cannot resolve through a symlink or junction");
  const workspace = path.resolve(workspaceRoot);
  const candidate = path.resolve(file);
  if (samePath(candidate, workspace) || isWithin(candidate, workspace)) {
    throw new Error("Evidence private key must remain outside the repository");
  }
}

function required(args, name) {
  const value = args.get(name);
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

function requiredExternalPolicySha256() {
  const value = process.env.JIANWEI_EVIDENCE_TRUST_POLICY_SHA256;
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error("JIANWEI_EVIDENCE_TRUST_POLICY_SHA256 must be provided by the protected release environment");
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
