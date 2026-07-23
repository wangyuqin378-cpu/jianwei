import { createHash, createPublicKey, verify as verifyBytes } from "node:crypto";

const POLICY_KIND = "beta_evidence_trust_policy";
const RECEIPT_KIND = "trusted_deployment_receipt";
const RECEIPT_ROLE = "beta_deployment_attestor";
const SIGNATURE_DOMAIN = "jianwei-deployment-receipt-v1";
const MAX_RECEIPT_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface VerifiedDeploymentReceipt {
  verified: true;
  receiptSha256: string;
  policySha256: string;
  issuerId: string;
  keyId: string;
  role: "beta_deployment_attestor";
  endpointOrigin: string;
  deploymentRevision: string;
  containerImageDigest: string;
  backendReleaseSha256: string;
  deployedAt: string;
  issuedAt: string;
}

export function verifyDeploymentReceipt(input: {
  receipt: Record<string, unknown>;
  receiptBytes: Buffer;
  policy: Record<string, unknown>;
  policyBytes: Buffer;
  now?: Date;
}): VerifiedDeploymentReceipt {
  const now = input.now ?? new Date();
  assertValidDate(now, "Deployment-receipt verification time");
  exactKeys(input.policy, ["schemaVersion", "evidenceKind", "policyId", "issuers"], "Evidence trust policy");
  if (input.policy.schemaVersion !== 1 || input.policy.evidenceKind !== POLICY_KIND || !validId(input.policy.policyId)) {
    throw new Error("Evidence trust policy schema, kind, or policyId is invalid");
  }
  const policySha256 = sha256(input.policyBytes);
  const parsedPolicy = parseExactJson(input.policyBytes, "Evidence trust policy bytes");
  if (JSON.stringify(parsedPolicy) !== JSON.stringify(input.policy)) throw new Error("Parsed trust policy does not match its exact bytes");

  exactKeys(input.receipt, [
    "schemaVersion", "evidenceKind", "policyId", "policySha256", "issuerId", "keyId", "role",
    "endpointOrigin", "deploymentRevision", "containerImageDigest", "backendReleaseSha256",
    "deployedAt", "issuedAt", "signatureBase64"
  ], "Deployment receipt");
  const parsedReceipt = parseExactJson(input.receiptBytes, "Deployment receipt bytes");
  if (JSON.stringify(parsedReceipt) !== JSON.stringify(input.receipt)) throw new Error("Parsed deployment receipt does not match its exact bytes");
  if (input.receipt.schemaVersion !== 1 || input.receipt.evidenceKind !== RECEIPT_KIND ||
      input.receipt.policyId !== input.policy.policyId || input.receipt.policySha256 !== policySha256 ||
      input.receipt.role !== RECEIPT_ROLE || !validId(input.receipt.issuerId) || !validId(input.receipt.keyId) ||
      !validId(input.receipt.deploymentRevision) || !validHttpsOrigin(input.receipt.endpointOrigin) ||
      !/^sha256:[a-f0-9]{64}$/.test(String(input.receipt.containerImageDigest ?? "")) ||
      !/^[a-f0-9]{64}$/.test(String(input.receipt.backendReleaseSha256 ?? ""))) {
    throw new Error("Deployment receipt identity or release binding is invalid");
  }
  const deployedAt = strictIso(input.receipt.deployedAt);
  const issuedAt = strictIso(input.receipt.issuedAt);
  if (!deployedAt || !issuedAt || deployedAt > issuedAt || issuedAt > now ||
      now.getTime() - issuedAt.getTime() > MAX_RECEIPT_AGE_MS) {
    throw new Error("Deployment receipt time is invalid or older than seven days");
  }
  if (!Array.isArray(input.policy.issuers)) throw new Error("Evidence trust policy issuers are invalid");
  const issuer = input.policy.issuers.find((value) => {
    const item = asRecord(value);
    return item?.issuerId === input.receipt.issuerId && item?.keyId === input.receipt.keyId;
  });
  const trusted = asRecord(issuer);
  if (!trusted) throw new Error("Deployment receipt issuer is not trusted");
  exactKeys(trusted, [
    "issuerId", "keyId", "algorithm", "publicKeyPem", "roles", "notBefore", "notAfter", "status"
  ], "Evidence trust issuer");
  const notBefore = strictIso(trusted.notBefore);
  const notAfter = strictIso(trusted.notAfter);
  if (trusted.algorithm !== "Ed25519" || trusted.status !== "active" ||
      !Array.isArray(trusted.roles) || !trusted.roles.includes(RECEIPT_ROLE) ||
      !notBefore || !notAfter || issuedAt < notBefore || issuedAt > notAfter) {
    throw new Error("Deployment receipt issuer is not active for the required role and time");
  }
  const publicKey = createPublicKey(String(trusted.publicKeyPem ?? ""));
  if (publicKey.asymmetricKeyType !== "ed25519") throw new Error("Deployment receipt issuer key is not Ed25519");
  const signature = decodeStrictBase64(input.receipt.signatureBase64);
  if (signature.length !== 64 || !verifyBytes(null, deploymentReceiptSignaturePayload(input.receipt), publicKey, signature)) {
    throw new Error("Deployment receipt signature is invalid");
  }
  return {
    verified: true,
    receiptSha256: sha256(input.receiptBytes),
    policySha256,
    issuerId: String(input.receipt.issuerId),
    keyId: String(input.receipt.keyId),
    role: RECEIPT_ROLE,
    endpointOrigin: String(input.receipt.endpointOrigin),
    deploymentRevision: String(input.receipt.deploymentRevision),
    containerImageDigest: String(input.receipt.containerImageDigest),
    backendReleaseSha256: String(input.receipt.backendReleaseSha256),
    deployedAt: String(input.receipt.deployedAt),
    issuedAt: String(input.receipt.issuedAt)
  };
}

export function deploymentReceiptSignaturePayload(receipt: Record<string, unknown>): Buffer {
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

function parseExactJson(bytes: Buffer, label: string): unknown {
  if (!Buffer.isBuffer(bytes)) throw new Error(`${label} are required`);
  try { return JSON.parse(bytes.toString("utf8")); } catch { throw new Error(`${label} are invalid JSON`); }
}

function decodeStrictBase64(value: unknown): Buffer {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error("Deployment receipt signature is not strict base64");
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) throw new Error("Deployment receipt signature is not canonical base64");
  return decoded;
}

function exactKeys(value: unknown, expected: string[], label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join("\n") !== [...expected].sort().join("\n")) {
    throw new Error(`${label} contains unknown or missing fields`);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function sha256(bytes: Buffer): string {
  if (!Buffer.isBuffer(bytes)) throw new Error("Exact bytes are required");
  return createHash("sha256").update(bytes).digest("hex");
}

function validId(value: unknown): boolean {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(value);
}

function validHttpsOrigin(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash &&
      url.pathname === "/" && value === url.origin;
  } catch { return false; }
}

function strictIso(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value ? parsed : null;
}

function assertValidDate(value: Date, label: string): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error(`${label} is invalid`);
}
