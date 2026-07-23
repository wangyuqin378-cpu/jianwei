import {
  createPrivateKey,
  createPublicKey,
  createHash,
  sign as signBytes,
  verify as verifyBytes
} from "node:crypto";

export const BETA_EVIDENCE_ATTESTATION_ROLE = "beta_release_approver";
export const BETA_ASSEMBLY_ATTESTATION_ROLE = "beta_assembly_attestor";
export const BETA_DEPLOYMENT_ATTESTATION_ROLE = "beta_deployment_attestor";
const REQUIRED_ROLES = new Set([
  BETA_EVIDENCE_ATTESTATION_ROLE,
  BETA_ASSEMBLY_ATTESTATION_ROLE,
  BETA_DEPLOYMENT_ATTESTATION_ROLE
]);
const POLICY_KIND = "beta_evidence_trust_policy";
const ATTESTATION_KIND = "beta_evidence_attestation";
const ARTIFACT_KIND = "real_beta_evidence";
const SIGNATURE_DOMAIN = "jianwei-beta-evidence-attestation-v1";
const MAX_ATTESTATION_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function validateEvidenceTrustPolicy(policy, policyBytes, now = new Date(), expectedPolicySha256 = null) {
  assertValidDate(now, "Trust-policy validation time");
  exactKeys(policy, ["schemaVersion", "evidenceKind", "policyId", "issuers"], "Evidence trust policy");
  if (policy.schemaVersion !== 1 || policy.evidenceKind !== POLICY_KIND || !validId(policy.policyId)) {
    throw new Error("Evidence trust policy schema, kind, or policyId is invalid");
  }
  if (!Buffer.isBuffer(policyBytes) || sha256Bytes(policyBytes).length !== 64) {
    throw new Error("Exact evidence trust policy bytes are required");
  }
  if (!Array.isArray(policy.issuers) || policy.issuers.length === 0) {
    throw new Error("Evidence trust policy must contain at least one issuer");
  }
  const policySha256 = sha256Bytes(policyBytes);
  if (expectedPolicySha256 !== null &&
      (!/^[a-f0-9]{64}$/.test(String(expectedPolicySha256)) || expectedPolicySha256 !== policySha256)) {
    throw new Error("Evidence trust policy does not match the externally pinned SHA-256");
  }
  const issuerIds = new Set();
  const keyIds = new Set();
  const publicKeyFingerprints = new Set();
  const coveredRoles = new Set();
  for (const issuer of policy.issuers) {
    exactKeys(issuer, [
      "issuerId", "keyId", "algorithm", "publicKeyPem", "roles", "notBefore", "notAfter", "status"
    ], "Evidence trust issuer");
    if (!validId(issuer.issuerId) || !validId(issuer.keyId) || issuer.algorithm !== "Ed25519" ||
        issuer.status !== "active") {
      throw new Error("Evidence trust issuer identity, algorithm, or status is invalid");
    }
    if (issuerIds.has(issuer.issuerId) || keyIds.has(issuer.keyId)) {
      throw new Error("Evidence trust policy roles must use distinct issuerId and keyId values");
    }
    issuerIds.add(issuer.issuerId);
    keyIds.add(issuer.keyId);
    if (!Array.isArray(issuer.roles) || issuer.roles.length !== 1 || !REQUIRED_ROLES.has(issuer.roles[0])) {
      throw new Error("Evidence trust issuer must hold exactly one recognized, mutually exclusive role");
    }
    coveredRoles.add(issuer.roles[0]);
    const notBefore = strictIso(issuer.notBefore);
    const notAfter = strictIso(issuer.notAfter);
    if (!notBefore || !notAfter || notBefore >= notAfter) throw new Error("Evidence trust issuer validity window is invalid");
    const publicKey = parseEd25519PublicKey(issuer.publicKeyPem);
    if (!publicKey) throw new Error("Evidence trust issuer public key is not a valid Ed25519 SPKI key");
    const fingerprint = ed25519PublicKeySha256(issuer.publicKeyPem);
    if (publicKeyFingerprints.has(fingerprint)) {
      throw new Error("Evidence trust policy roles must use distinct Ed25519 public keys");
    }
    publicKeyFingerprints.add(fingerprint);
  }
  if ([...REQUIRED_ROLES].some((role) => !coveredRoles.has(role))) {
    throw new Error("Evidence trust policy must define independent release, assembly, and deployment attestors");
  }
  return { policyId: policy.policyId, policySha256 };
}

export function createEvidenceAttestation({
  artifact,
  artifactBytes,
  policy,
  policyBytes,
  issuerId,
  keyId,
  privateKeyPem,
  now = new Date()
}) {
  const policyIdentity = validateEvidenceTrustPolicy(policy, policyBytes, now);
  validateArtifact(artifact, artifactBytes, now);
  const issuer = findIssuer(policy, issuerId, keyId, BETA_EVIDENCE_ATTESTATION_ROLE, now);
  const privateKey = parseEd25519PrivateKey(privateKeyPem);
  const derivedPublic = createPublicKey(privateKey).export({ type: "spki", format: "der" });
  const trustedPublic = parseEd25519PublicKey(issuer.publicKeyPem).export({ type: "spki", format: "der" });
  if (!Buffer.from(derivedPublic).equals(Buffer.from(trustedPublic))) {
    throw new Error("Evidence signing private key does not match the trusted issuer public key");
  }
  const issuedAt = now.toISOString();
  const attestation = {
    schemaVersion: 1,
    evidenceKind: ATTESTATION_KIND,
    policyId: policyIdentity.policyId,
    policySha256: policyIdentity.policySha256,
    issuerId,
    keyId,
    role: BETA_EVIDENCE_ATTESTATION_ROLE,
    artifactKind: ARTIFACT_KIND,
    artifactSha256: sha256Bytes(artifactBytes),
    artifactGeneratedAt: artifact.generatedAt,
    issuedAt,
    signatureBase64: ""
  };
  attestation.signatureBase64 = signBytes(null, signaturePayload(attestation), privateKey).toString("base64");
  return attestation;
}

export function verifyEvidenceAttestation({ artifact, artifactBytes, policy, policyBytes, attestation, now = new Date() }) {
  const policyIdentity = validateEvidenceTrustPolicy(policy, policyBytes, now);
  validateArtifact(artifact, artifactBytes, now);
  exactKeys(attestation, [
    "schemaVersion", "evidenceKind", "policyId", "policySha256", "issuerId", "keyId", "role",
    "artifactKind", "artifactSha256", "artifactGeneratedAt", "issuedAt", "signatureBase64"
  ], "Beta evidence attestation");
  if (attestation.schemaVersion !== 1 || attestation.evidenceKind !== ATTESTATION_KIND ||
      attestation.policyId !== policyIdentity.policyId || attestation.policySha256 !== policyIdentity.policySha256 ||
      attestation.role !== BETA_EVIDENCE_ATTESTATION_ROLE || attestation.artifactKind !== ARTIFACT_KIND ||
      attestation.artifactSha256 !== sha256Bytes(artifactBytes) ||
      attestation.artifactGeneratedAt !== artifact.generatedAt) {
    throw new Error("Beta evidence attestation is not bound to the trusted policy and exact evidence bytes");
  }
  const issuedAt = strictIso(attestation.issuedAt);
  const generatedAt = strictIso(artifact.generatedAt);
  if (!issuedAt || !generatedAt || issuedAt < generatedAt || issuedAt > now ||
      now.getTime() - issuedAt.getTime() > MAX_ATTESTATION_AGE_MS) {
    throw new Error("Beta evidence attestation time is invalid or older than seven days");
  }
  const issuer = findIssuer(policy, attestation.issuerId, attestation.keyId, attestation.role, issuedAt);
  const signature = decodeStrictBase64(attestation.signatureBase64);
  if (signature.length !== 64 || !verifyBytes(null, signaturePayload(attestation), parseEd25519PublicKey(issuer.publicKeyPem), signature)) {
    throw new Error("Beta evidence attestation signature is invalid");
  }
  return {
    verified: true,
    policyId: policy.policyId,
    policySha256: policyIdentity.policySha256,
    issuerId: issuer.issuerId,
    keyId: issuer.keyId,
    role: attestation.role,
    publicKeySha256: ed25519PublicKeySha256(issuer.publicKeyPem),
    issuedAt: attestation.issuedAt,
    artifactSha256: attestation.artifactSha256
  };
}

export function ed25519PublicKeySha256(publicKeyPem) {
  const publicKey = parseEd25519PublicKey(publicKeyPem);
  const der = publicKey.export({ type: "spki", format: "der" });
  return sha256Bytes(Buffer.from(der));
}

function validateArtifact(artifact, artifactBytes, now) {
  if (!Buffer.isBuffer(artifactBytes) || !artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
    throw new Error("Exact Beta evidence bytes and parsed object are required");
  }
  let parsed;
  try { parsed = JSON.parse(artifactBytes.toString("utf8")); } catch { throw new Error("Beta evidence bytes are invalid JSON"); }
  if (JSON.stringify(parsed) !== JSON.stringify(artifact)) throw new Error("Parsed Beta evidence does not match the signed bytes");
  const generatedAt = strictIso(artifact.generatedAt);
  if (artifact.schemaVersion !== 3 || artifact.evidenceKind !== ARTIFACT_KIND || !generatedAt || generatedAt > now) {
    throw new Error("Only valid real Beta evidence can be attested");
  }
}

function findIssuer(policy, issuerId, keyId, role, at) {
  const issuer = policy.issuers.find((item) => item.issuerId === issuerId && item.keyId === keyId);
  if (!issuer || issuer.status !== "active" || !issuer.roles.includes(role)) {
    throw new Error("Evidence attestation issuer is not trusted for the required role");
  }
  const notBefore = strictIso(issuer.notBefore);
  const notAfter = strictIso(issuer.notAfter);
  if (!notBefore || !notAfter || at < notBefore || at > notAfter) {
    throw new Error("Evidence attestation issuer is outside its validity window");
  }
  return issuer;
}

function signaturePayload(attestation) {
  return Buffer.from(JSON.stringify([
    SIGNATURE_DOMAIN,
    attestation.policyId,
    attestation.policySha256,
    attestation.issuerId,
    attestation.keyId,
    attestation.role,
    attestation.artifactKind,
    attestation.artifactSha256,
    attestation.artifactGeneratedAt,
    attestation.issuedAt
  ]), "utf8");
}

function parseEd25519PublicKey(pem) {
  try {
    const key = createPublicKey(pem);
    if (key.asymmetricKeyType !== "ed25519") throw new Error("wrong key type");
    return key;
  } catch {
    throw new Error("Evidence trust issuer public key is invalid");
  }
}

function parseEd25519PrivateKey(pem) {
  try {
    const key = createPrivateKey(pem);
    if (key.asymmetricKeyType !== "ed25519") throw new Error("wrong key type");
    return key;
  } catch {
    throw new Error("Evidence signing key is not a valid Ed25519 private key");
  }
}

function decodeStrictBase64(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error("Evidence signature is not strict base64");
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) throw new Error("Evidence signature is not canonical base64");
  return decoded;
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join("\n") !== [...expected].sort().join("\n")) {
    throw new Error(`${label} contains unknown or missing fields`);
  }
}

function validId(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{2,99}$/.test(value);
}

function strictIso(value) {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value ? parsed : null;
}

function assertValidDate(value, label) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error(`${label} is invalid`);
}
