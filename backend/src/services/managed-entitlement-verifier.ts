import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Environment, SignedDataVerifier } from "@apple/app-store-server-library";
import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";

export interface ManagedEntitlementVerifier {
  verify(signedTransaction: string | undefined, installationHash: string): Promise<void>;
}

export class DevelopmentManagedEntitlementVerifier implements ManagedEntitlementVerifier {
  async verify(): Promise<void> {}
}

export class AppleManagedEntitlementVerifier implements ManagedEntitlementVerifier {
  private readonly verifier: SignedDataVerifier;

  constructor(private readonly config: AppConfig) {
    const roots = config.appStoreRootCertificatePaths.map((certificatePath) => readFileSync(certificatePath));
    this.verifier = new SignedDataVerifier(
      roots,
      true,
      config.appStoreEnvironment === "production" ? Environment.PRODUCTION : Environment.SANDBOX,
      config.appStoreBundleId,
      config.appStoreEnvironment === "production" ? config.appStoreAppAppleId ?? undefined : undefined
    );
  }

  async verify(signedTransaction: string | undefined, installationHash: string): Promise<void> {
    if (!signedTransaction) throw new AppError("subscription_required", "需要有效的见微 Pro 订阅", 402);
    try {
      const transaction = await this.verifier.verifyAndDecodeTransaction(signedTransaction);
      const now = Date.now();
      const appAccountToken = transaction.appAccountToken;
      const normalizedToken = appAccountToken ? normalizeUUID(appAccountToken) : null;
      if (
        transaction.productId !== this.config.appStoreSubscriptionProductId
        || normalizedToken === null
        || sha256(normalizedToken) !== installationHash
        || transaction.revocationDate !== undefined
        || transaction.isUpgraded === true
        || transaction.expiresDate === undefined
        || transaction.expiresDate <= now
      ) {
        throw new Error("inactive managed subscription");
      }
    } catch {
      throw new AppError("subscription_invalid", "见微 Pro 订阅无法验证或已失效", 402);
    }
  }
}

function normalizeUUID(value: string): string | null {
  const match = value.trim().toLowerCase().match(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  );
  return match?.[0] ?? null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
