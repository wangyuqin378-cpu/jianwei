import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as signBytes,
  verify as verifyBytes
} from "node:crypto";
import {
  BETA_ASSEMBLY_ATTESTATION_ROLE,
  ed25519PublicKeySha256,
  validateEvidenceTrustPolicy
} from "./evidence-attestation.mjs";

export const BETA_EVIDENCE_ASSEMBLY_ATTESTATION_ROLE = BETA_ASSEMBLY_ATTESTATION_ROLE;

const RELEASE_APPROVER_ROLE = "beta_release_approver";
const POLICY_KIND = "beta_evidence_trust_policy";
const MANIFEST_KIND = "beta_evidence_assembly_manifest";
const ATTESTATION_KIND = "beta_evidence_assembly_attestation";
const SIGNATURE_DOMAIN = "jianwei-beta-evidence-assembly-attestation-v1";
const MAX_ATTESTATION_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const ARTIFACT_NAMES = [
  "imageEvaluation",
  "cardAudit",
  "betaCohort",
  "cloudVerification",
  "releaseArtifact",
  "physicalDeviceRuns",
  "accessibilityAudit",
  "deploymentReceipt"
];
const ARTIFACT_KINDS = {
  imageEvaluation: "compiled_image_evaluation",
  cardAudit: "compiled_card_audit",
  betaCohort: "compiled_beta_cohort",
  cloudVerification: "verified_cloud_run",
  releaseArtifact: "verified_release_apk",
  physicalDeviceRuns: "compiled_physical_device_runs",
  accessibilityAudit: "compiled_accessibility_audit",
  deploymentReceipt: "trusted_deployment_receipt"
};

export function createAssemblyAttestation({
  manifest,
  manifestBytes,
  artifacts,
  policy,
  policyBytes,
  issuerId,
  keyId,
  privateKeyPem,
  now = new Date()
}) {
  assertValidDate(now, "Assembly-attestation creation time");
  const policyIdentity = validateTrustPolicy(policy, policyBytes, now);
  const validated = validateAssemblyInputs({ manifest, manifestBytes, artifacts, now });
  const issuer = findAssemblyIssuer(policy, issuerId, keyId, now);
  const privateKey = parseEd25519PrivateKey(privateKeyPem);
  assertKeyMatchesIssuer(privateKey, issuer);

  const attestation = {
    schemaVersion: 1,
    evidenceKind: ATTESTATION_KIND,
    policyId: policyIdentity.policyId,
    policySha256: policyIdentity.policySha256,
    issuerId,
    keyId,
    role: BETA_EVIDENCE_ASSEMBLY_ATTESTATION_ROLE,
    manifestKind: MANIFEST_KIND,
    manifestSha256: validated.manifestSha256,
    manifestCreatedAt: manifest.createdAt,
    manifestApprovedAt: manifest.approvedAt,
    artifactCount: ARTIFACT_NAMES.length,
    artifacts: validated.artifactBindings,
    issuedAt: now.toISOString(),
    signatureBase64: ""
  };
  attestation.signatureBase64 = signBytes(null, signaturePayload(attestation), privateKey).toString("base64");
  return attestation;
}

export function verifyAssemblyAttestation({
  manifest,
  manifestBytes,
  artifacts,
  policy,
  policyBytes,
  attestation,
  now = new Date()
}) {
  assertValidDate(now, "Assembly-attestation verification time");
  const policyIdentity = validateTrustPolicy(policy, policyBytes, now);
  const validated = validateAssemblyInputs({ manifest, manifestBytes, artifacts, now });
  exactKeys(attestation, [
    "schemaVersion",
    "evidenceKind",
    "policyId",
    "policySha256",
    "issuerId",
    "keyId",
    "role",
    "manifestKind",
    "manifestSha256",
    "manifestCreatedAt",
    "manifestApprovedAt",
    "artifactCount",
    "artifacts",
    "issuedAt",
    "signatureBase64"
  ], "Beta evidence assembly attestation");
  if (attestation.schemaVersion !== 1 || attestation.evidenceKind !== ATTESTATION_KIND ||
      attestation.policyId !== policyIdentity.policyId ||
      attestation.policySha256 !== policyIdentity.policySha256 ||
      attestation.role !== BETA_EVIDENCE_ASSEMBLY_ATTESTATION_ROLE ||
      attestation.manifestKind !== MANIFEST_KIND ||
      attestation.manifestSha256 !== validated.manifestSha256 ||
      attestation.manifestCreatedAt !== manifest.createdAt ||
      attestation.manifestApprovedAt !== manifest.approvedAt ||
      attestation.artifactCount !== ARTIFACT_NAMES.length) {
    throw new Error("Assembly attestation is not bound to the trusted policy and exact approved manifest bytes");
  }
  validateAttestedArtifactBindings(attestation.artifacts, validated.artifactBindings);

  const issuedAt = strictIso(attestation.issuedAt);
  const approvedAt = strictIso(manifest.approvedAt);
  if (!issuedAt || !approvedAt || issuedAt < approvedAt || issuedAt > now ||
      now.getTime() - issuedAt.getTime() > MAX_ATTESTATION_AGE_MS) {
    throw new Error("Assembly attestation time is invalid or older than seven days");
  }
  const issuer = findAssemblyIssuer(policy, attestation.issuerId, attestation.keyId, issuedAt);
  const signature = decodeStrictBase64(attestation.signatureBase64);
  if (signature.length !== 64 ||
      !verifyBytes(null, signaturePayload(attestation), parseEd25519PublicKey(issuer.publicKeyPem), signature)) {
    throw new Error("Assembly attestation signature is invalid");
  }
  return {
    verified: true,
    policyId: policyIdentity.policyId,
    policySha256: policyIdentity.policySha256,
    issuerId: issuer.issuerId,
    keyId: issuer.keyId,
    role: BETA_EVIDENCE_ASSEMBLY_ATTESTATION_ROLE,
    publicKeySha256: ed25519PublicKeySha256(issuer.publicKeyPem),
    issuedAt: attestation.issuedAt,
    manifestSha256: attestation.manifestSha256,
    knowledgeCatalogSha256: manifest.knowledge.catalogSha256,
    topicBacklogSha256: manifest.knowledge.topicBacklogSha256,
    knowledgeReviewerPolicySha256: manifest.knowledge.reviewerPolicySha256,
    artifactCount: ARTIFACT_NAMES.length,
    artifactBindings: structuredClone(validated.artifactBindings)
  };
}

function validateTrustPolicy(policy, policyBytes, now) {
  parseExactJsonObject(policyBytes, policy, "Evidence trust policy");
  return validateEvidenceTrustPolicy(policy, policyBytes, now);
}

function validateAssemblyInputs({ manifest, manifestBytes, artifacts, now }) {
  parseExactJsonObject(manifestBytes, manifest, "Beta evidence assembly manifest");
  exactKeys(manifest, [
    "schemaVersion", "evidenceKind", "createdAt", "evidenceOwner", "assemblyApproved", "approvedAt", "knowledge", "artifacts"
  ], "Beta evidence assembly manifest");
  if (manifest.schemaVersion !== 3 || manifest.evidenceKind !== MANIFEST_KIND || manifest.assemblyApproved !== true) {
    throw new Error("Only an approved schema-3 Beta evidence assembly manifest can be attested");
  }
  assertAccountableHumanId(manifest.evidenceOwner);
  const createdAt = strictIso(manifest.createdAt);
  const approvedAt = strictIso(manifest.approvedAt);
  if (!createdAt || !approvedAt || createdAt > approvedAt || approvedAt > now) {
    throw new Error("Assembly manifest creation or approval time is invalid");
  }
  exactKeys(manifest.knowledge, ["catalogSha256", "topicBacklogSha256", "reviewerPolicySha256"], "Assembly manifest knowledge bindings");
  if (!validSha256(manifest.knowledge.catalogSha256) || !validSha256(manifest.knowledge.topicBacklogSha256) ||
      !validSha256(manifest.knowledge.reviewerPolicySha256)) {
    throw new Error("Assembly manifest knowledge bindings are invalid");
  }
  exactKeys(manifest.artifacts, ARTIFACT_NAMES, "Assembly manifest artifact bindings");
  exactKeys(artifacts, ARTIFACT_NAMES, "Beta component artifacts");

  const artifactBindings = {};
  for (const name of ARTIFACT_NAMES) {
    const manifestBinding = manifest.artifacts[name];
    exactKeys(manifestBinding, ["evidenceKind", "sha256"], `Assembly manifest artifact binding ${name}`);
    if (manifestBinding.evidenceKind !== ARTIFACT_KINDS[name] || !validSha256(manifestBinding.sha256)) {
      throw new Error(`Assembly manifest artifact binding is invalid: ${name}`);
    }
    const artifact = artifacts[name];
    if (!Buffer.isBuffer(artifact?.bytes)) throw new Error(`Exact component artifact bytes are required: ${name}`);
    parseExactJsonObject(artifact.bytes, artifact.value, `Beta component artifact ${name}`);
    if (artifact.value.evidenceKind !== ARTIFACT_KINDS[name]) {
      throw new Error(`Beta component artifact evidence kind is invalid: ${name}`);
    }
    const digest = sha256Bytes(artifact.bytes);
    if (digest !== manifestBinding.sha256) {
      throw new Error(`Beta component artifact SHA-256 changed after manifest approval: ${name}`);
    }
    artifactBindings[name] = { sha256: digest, bytes: artifact.bytes.length };
  }
  return { manifestSha256: sha256Bytes(manifestBytes), artifactBindings };
}

function validateAttestedArtifactBindings(attested, expected) {
  exactKeys(attested, ARTIFACT_NAMES, "Attested component artifact bindings");
  for (const name of ARTIFACT_NAMES) {
    exactKeys(attested[name], ["sha256", "bytes"], `Attested component artifact binding ${name}`);
    if (attested[name].sha256 !== expected[name].sha256 || attested[name].bytes !== expected[name].bytes ||
        !validSha256(attested[name].sha256) || !Number.isSafeInteger(attested[name].bytes) ||
        attested[name].bytes <= 0) {
      throw new Error(`Assembly attestation component binding is invalid: ${name}`);
    }
  }
}

function findAssemblyIssuer(policy, issuerId, keyId, at) {
  if (!validId(issuerId) || !validId(keyId)) throw new Error("Assembly attestation issuer identity is invalid");
  const issuer = policy.issuers.find((item) => item.issuerId === issuerId && item.keyId === keyId);
  if (!issuer || !issuer.roles.includes(BETA_EVIDENCE_ASSEMBLY_ATTESTATION_ROLE)) {
    throw new Error("Assembly attestation issuer is not trusted for the required role");
  }
  const notBefore = strictIso(issuer.notBefore);
  const notAfter = strictIso(issuer.notAfter);
  if (!notBefore || !notAfter || at < notBefore || at > notAfter) {
    throw new Error("Assembly attestation issuer is outside its validity window");
  }
  assertIndependentFromReleaseApprover(policy, issuer);
  return issuer;
}

function assertIndependentFromReleaseApprover(policy, assemblyIssuer) {
  if (assemblyIssuer.roles.includes(RELEASE_APPROVER_ROLE)) {
    throw new Error("Assembly attestor must not also hold the Beta release-approver role");
  }
  const assemblyPublicKey = publicKeyDer(assemblyIssuer.publicKeyPem);
  for (const issuer of policy.issuers) {
    if (!issuer.roles.includes(RELEASE_APPROVER_ROLE)) continue;
    if (issuer.issuerId === assemblyIssuer.issuerId || publicKeyDer(issuer.publicKeyPem).equals(assemblyPublicKey)) {
      throw new Error("Assembly attestor must use an identity and key independent from every Beta release approver");
    }
  }
}

function assertKeyMatchesIssuer(privateKey, issuer) {
  const derived = createPublicKey(privateKey).export({ type: "spki", format: "der" });
  const trusted = publicKeyDer(issuer.publicKeyPem);
  if (!Buffer.from(derived).equals(trusted)) {
    throw new Error("Assembly signing private key does not match the trusted issuer public key");
  }
}

function signaturePayload(attestation) {
  return Buffer.from(JSON.stringify([
    SIGNATURE_DOMAIN,
    attestation.policyId,
    attestation.policySha256,
    attestation.issuerId,
    attestation.keyId,
    attestation.role,
    attestation.manifestKind,
    attestation.manifestSha256,
    attestation.manifestCreatedAt,
    attestation.manifestApprovedAt,
    attestation.artifactCount,
    ARTIFACT_NAMES.map((name) => [name, attestation.artifacts[name].sha256, attestation.artifacts[name].bytes]),
    attestation.issuedAt
  ]), "utf8");
}

function parseExactJsonObject(bytes, value, label) {
  if (!Buffer.isBuffer(bytes) || !value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} requires exact JSON bytes and an ordinary parsed object`);
  }
  let parsed;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${label} bytes are not valid UTF-8 JSON`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
      JSON.stringify(parsed) !== JSON.stringify(value)) {
    throw new Error(`${label} parsed value does not match its exact bytes`);
  }
  return parsed;
}

function parseEd25519PublicKey(pem) {
  try {
    const key = createPublicKey(pem);
    if (key.asymmetricKeyType !== "ed25519") throw new Error("wrong key type");
    return key;
  } catch {
    throw new Error("Evidence trust issuer public key is not a valid Ed25519 public key");
  }
}

function parseEd25519PrivateKey(pem) {
  try {
    const key = createPrivateKey(pem);
    if (key.asymmetricKeyType !== "ed25519") throw new Error("wrong key type");
    return key;
  } catch {
    throw new Error("Assembly signing key is not a valid Ed25519 private key");
  }
}

function publicKeyDer(pem) {
  return Buffer.from(parseEd25519PublicKey(pem).export({ type: "spki", format: "der" }));
}

function decodeStrictBase64(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error("Assembly attestation signature is not strict base64");
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) {
    throw new Error("Assembly attestation signature is not canonical base64");
  }
  return decoded;
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join("\n") !== [...expected].sort().join("\n")) {
    throw new Error(`${label} contains unknown or missing fields`);
  }
}

function assertAccountableHumanId(value) {
  if (typeof value !== "string" || !/^[\p{L}\p{N}._@-]{3,128}$/u.test(value) ||
      /(?:codex|chatgpt|gpt|kimi|moonshot|qwen|claude|gemini|llama|automation|autobot|robot|language[-_. ]?model)/i.test(value) ||
      /^(?:ai|bot)$/i.test(value)) {
    throw new Error("Assembly evidence owner must identify an accountable human");
  }
}

function sha256Bytes(bytes) {
  if (!Buffer.isBuffer(bytes)) throw new Error("Exact bytes are required for SHA-256");
  return createHash("sha256").update(bytes).digest("hex");
}

function validSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function validId(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(value);
}

function strictIso(value) {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value ? parsed : null;
}

function assertValidDate(value, label) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error(`${label} is invalid`);
}
