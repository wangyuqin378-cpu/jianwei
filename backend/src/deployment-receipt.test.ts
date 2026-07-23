import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { deploymentReceiptSignaturePayload, verifyDeploymentReceipt } from "./deployment-receipt.js";

function fixture() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const policy = {
    schemaVersion: 1,
    evidenceKind: "beta_evidence_trust_policy",
    policyId: "jianwei-beta-release-2026",
    issuers: [{
      issuerId: "fc-deployment-pipeline",
      keyId: "fc-attestor-2026",
      algorithm: "Ed25519",
      publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
      roles: ["beta_deployment_attestor"],
      notBefore: "2026-01-01T00:00:00.000Z",
      notAfter: "2027-01-01T00:00:00.000Z",
      status: "active"
    }]
  };
  const policyBytes = Buffer.from(`${JSON.stringify(policy, null, 2)}\n`, "utf8");
  const receipt: Record<string, unknown> = {
    schemaVersion: 1,
    evidenceKind: "trusted_deployment_receipt",
    policyId: policy.policyId,
    policySha256: "",
    issuerId: "fc-deployment-pipeline",
    keyId: "fc-attestor-2026",
    role: "beta_deployment_attestor",
    endpointOrigin: "https://beta.jianwei.example",
    deploymentRevision: "fc-revision-001",
    containerImageDigest: `sha256:${"a".repeat(64)}`,
    backendReleaseSha256: "b".repeat(64),
    deployedAt: "2026-07-19T00:00:00.000Z",
    issuedAt: "2026-07-19T00:01:00.000Z",
    signatureBase64: ""
  };
  receipt.policySha256 = createHash("sha256").update(policyBytes).digest("hex");
  receipt.signatureBase64 = sign(null, deploymentReceiptSignaturePayload(receipt), privateKey).toString("base64");
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  return { policy, policyBytes, receipt, receiptBytes };
}

describe("deployment receipt", () => {
  it("verifies a policy-pinned deployment attestor signature", () => {
    const value = fixture();
    const result = verifyDeploymentReceipt({ ...value, now: new Date("2026-07-19T01:00:00.000Z") });
    expect(result.verified).toBe(true);
    expect(result.containerImageDigest).toBe(`sha256:${"a".repeat(64)}`);
    expect(result.receiptSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects a self-declared digest, wrong role, stale receipt, and changed bytes", () => {
    const base = fixture();
    for (const mutate of [
      (receipt: Record<string, unknown>) => { receipt.containerImageDigest = `sha256:${"c".repeat(64)}`; },
      (receipt: Record<string, unknown>) => { receipt.role = "beta_release_approver"; },
      (receipt: Record<string, unknown>) => { receipt.issuedAt = "2026-07-01T00:00:00.000Z"; }
    ]) {
      const receipt = structuredClone(base.receipt);
      mutate(receipt);
      expect(() => verifyDeploymentReceipt({
        ...base,
        receipt,
        receiptBytes: Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8"),
        now: new Date("2026-07-19T01:00:00.000Z")
      })).toThrow();
    }
    expect(() => verifyDeploymentReceipt({
      ...base,
      receiptBytes: Buffer.from(base.receiptBytes.toString("utf8").replace("fc-revision-001", "fc-revision-002"), "utf8"),
      now: new Date("2026-07-19T01:00:00.000Z")
    })).toThrow();
  });
});
