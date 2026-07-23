import { createHash, createPublicKey, verify as verifyBytes } from "node:crypto";
import {
  BETA_DEPLOYMENT_ATTESTATION_ROLE,
  ed25519PublicKeySha256,
  validateEvidenceTrustPolicy
} from "./evidence-attestation.mjs";

const POLICY_KIND = "beta_evidence_trust_policy";
const RECEIPT_KIND = "trusted_deployment_receipt";
const RECEIPT_ROLE = BETA_DEPLOYMENT_ATTESTATION_ROLE;
const SIGNATURE_DOMAIN = "jianwei-deployment-receipt-v1";
const MAX_RECEIPT_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function verifyDeploymentReceipt({ receipt, receiptBytes, policy, policyBytes, now = new Date() }) {
  assertValidDate(now, "Deployment-receipt verification time");
  const policyIdentity = validateEvidenceTrustPolicy(policy, policyBytes, now);
  exactKeys(policy, ["schemaVersion", "evidenceKind", "policyId", "issuers"], "Evidence trust policy");
  if (policy.schemaVersion !== 1 || policy.evidenceKind !== POLICY_KIND || !validId(policy.policyId)) {
    throw new Error("Evidence trust policy schema, kind, or policyId is invalid");
  }
  const policySha256 = policyIdentity.policySha256;
  const parsedPolicy = parseExactJson(policyBytes, "Evidence trust policy bytes");
  if (JSON.stringify(parsedPolicy) !== JSON.stringify(policy)) {
    throw new Error("Parsed trust policy does not match its exact bytes");
  }

  exactKeys(receipt, [
    "schemaVersion", "evidenceKind", "policyId", "policySha256", "issuerId", "keyId", "role",
    "endpointOrigin", "deploymentRevision", "containerImageDigest", "backendReleaseSha256",
    "deployedAt", "issuedAt", "signatureBase64"
  ], "Deployment receipt");
  const parsedReceipt = parseExactJson(receiptBytes, "Deployment receipt bytes");
  if (JSON.stringify(parsedReceipt) !== JSON.stringify(receipt)) {
    throw new Error("Parsed deployment receipt does not match its exact bytes");
  }
  if (receipt.schemaVersion !== 1 || receipt.evidenceKind !== RECEIPT_KIND ||
      receipt.policyId !== policy.policyId || receipt.policySha256 !== policySha256 ||
      receipt.role !== RECEIPT_ROLE || !validId(receipt.issuerId) || !validId(receipt.keyId) ||
      !validId(receipt.deploymentRevision) || !validHttpsOrigin(receipt.endpointOrigin) ||
      !/^sha256:[a-f0-9]{64}$/.test(String(receipt.containerImageDigest ?? "")) ||
      !/^[a-f0-9]{64}$/.test(String(receipt.backendReleaseSha256 ?? ""))) {
    throw new Error("Deployment receipt identity or release binding is invalid");
  }
  const deployedAt = strictIso(receipt.deployedAt);
  const issuedAt = strictIso(receipt.issuedAt);
  if (!deployedAt || !issuedAt || deployedAt > issuedAt || issuedAt > now ||
      now.getTime() - issuedAt.getTime() > MAX_RECEIPT_AGE_MS) {
    throw new Error("Deployment receipt time is invalid or older than seven days");
  }
  if (!Array.isArray(policy.issuers)) throw new Error("Evidence trust policy issuers are invalid");
  const trusted = policy.issuers.find((value) => value && typeof value === "object" && !Array.isArray(value) &&
    value.issuerId === receipt.issuerId && value.keyId === receipt.keyId);
  if (!trusted) throw new Error("Deployment receipt issuer is not trusted");
  exactKeys(trusted, [
    "issuerId", "keyId", "algorithm", "publicKeyPem", "roles", "notBefore", "notAfter", "status"
  ], "Evidence trust issuer");
  const notBefore = strictIso(trusted.notBefore);
  const notAfter = strictIso(trusted.notAfter);
  if (trusted.algorithm !== "Ed25519" || trusted.status !== "active" ||
      !Array.isArray(trusted.roles) || trusted.roles.length !== 1 || trusted.roles[0] !== RECEIPT_ROLE ||
      !notBefore || !notAfter || issuedAt < notBefore || issuedAt > notAfter) {
    throw new Error("Deployment receipt issuer is not active for the required role and time");
  }
  const publicKey = createPublicKey(String(trusted.publicKeyPem ?? ""));
  if (publicKey.asymmetricKeyType !== "ed25519") throw new Error("Deployment receipt issuer key is not Ed25519");
  const signature = decodeStrictBase64(receipt.signatureBase64);
  if (signature.length !== 64 || !verifyBytes(null, deploymentReceiptSignaturePayload(receipt), publicKey, signature)) {
    throw new Error("Deployment receipt signature is invalid");
  }
  return {
    verified: true,
    receiptSha256: sha256(receiptBytes),
    policySha256,
    issuerId: String(receipt.issuerId),
    keyId: String(receipt.keyId),
    role: RECEIPT_ROLE,
    publicKeySha256: ed25519PublicKeySha256(trusted.publicKeyPem),
    endpointOrigin: String(receipt.endpointOrigin),
    deploymentRevision: String(receipt.deploymentRevision),
    containerImageDigest: String(receipt.containerImageDigest),
    backendReleaseSha256: String(receipt.backendReleaseSha256),
    deployedAt: String(receipt.deployedAt),
    issuedAt: String(receipt.issuedAt)
  };
}

export function deploymentReceiptSignaturePayload(receipt) {
  return Buffer.from(JSON.stringify([
    SIGNATURE_DOMAIN,
    receipt.policyId,
    receipt.policySha256,
    receipt.issuerId,
    receipt.keyId,
    receipt.role,
    receipt.endpointOrigin,
    receipt.deploymentRevision,
    receipt.containerImageDigest,
    receipt.backendReleaseSha256,
    receipt.deployedAt,
    receipt.issuedAt
  ]), "utf8");
}

function parseExactJson(bytes, label) {
  if (!Buffer.isBuffer(bytes)) throw new Error(`${label} are required`);
  try { return JSON.parse(bytes.toString("utf8")); } catch { throw new Error(`${label} are invalid JSON`); }
}

function decodeStrictBase64(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error("Deployment receipt signature is not strict base64");
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) throw new Error("Deployment receipt signature is not canonical base64");
  return decoded;
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join("\n") !== [...expected].sort().join("\n")) {
    throw new Error(`${label} contains unknown or missing fields`);
  }
}

function sha256(bytes) {
  if (!Buffer.isBuffer(bytes)) throw new Error("Exact bytes are required");
  return createHash("sha256").update(bytes).digest("hex");
}

function validId(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(value);
}

function validHttpsOrigin(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash &&
      url.pathname === "/" && value === url.origin;
  } catch { return false; }
}

function strictIso(value) {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value ? parsed : null;
}

function assertValidDate(value, label) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error(`${label} is invalid`);
}
