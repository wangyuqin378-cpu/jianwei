import { createHash, createPrivateKey } from "node:crypto";
import { Buffer } from "node:buffer";
import { Response as NodeResponse } from "node-fetch";
import type {
  Environment, JWSTransactionDecodedPayload, JWSRenewalInfoDecodedPayload, StatusResponse
} from "@apple/app-store-server-library";
import { APPLE_ROOT_CERTIFICATES } from "./apple-roots.js";

export const TRANSACTION_HEADER = "X-Jianwei-App-Store-Transaction";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TRANSACTION_ID = /^[0-9]{1,30}$/;
const MAX_STATUS_BYTES = 256 * 1024;
const PRODUCTION = "Production" as Environment.PRODUCTION;
const SANDBOX = "Sandbox" as Environment.SANDBOX;

export interface ManagedEntitlementEnv {
  APP_STORE_BUNDLE_ID?: string;
  APP_STORE_SUBSCRIPTION_PRODUCT_ID?: string;
  APP_STORE_ENVIRONMENT?: string;
  APP_STORE_APP_APPLE_ID?: string;
  APP_STORE_KEY_ID?: string;
  APP_STORE_ISSUER_ID?: string;
  APP_STORE_PRIVATE_KEY?: string;
  // Server-only temporary grants. No wildcard, no client-controlled enable flag.
  BETA_DEVICE_GRANTS_JSON?: string;
}

export class ManagedEntitlementError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
const invalid = () => new ManagedEntitlementError(402, "subscription_invalid", "见微订阅无法验证或已失效，请恢复购买");
const unavailable = () => new ManagedEntitlementError(503, "subscription_verification_unavailable", "订阅验证暂时不可用，请稍后重试");
const unconfigured = () => new ManagedEntitlementError(503, "subscription_verification_unconfigured", "服务端订阅验证尚未配置");

interface AppleConfig {
  bundleId: string;
  productId: string;
  environment: Environment.PRODUCTION | Environment.SANDBOX;
  appAppleId: number | undefined;
  keyId: string;
  issuerId: string;
  privateKey: string;
}

export interface AppleServices {
  verifyTransaction(jws: string): Promise<JWSTransactionDecodedPayload>;
  verifyRenewal(jws: string): Promise<JWSRenewalInfoDecodedPayload>;
  subscriptionStatus(transactionId: string): Promise<StatusResponse>;
}

export function appleConfiguration(env: ManagedEntitlementEnv): AppleConfig {
  const environment = env.APP_STORE_ENVIRONMENT ?? "production";
  const appAppleId = env.APP_STORE_APP_APPLE_ID === undefined ? undefined : Number(env.APP_STORE_APP_APPLE_ID);
  if (!["production", "sandbox"].includes(environment)
      || !/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(env.APP_STORE_BUNDLE_ID ?? "")
      || !/^[A-Za-z0-9._-]{3,200}$/.test(env.APP_STORE_SUBSCRIPTION_PRODUCT_ID ?? "")
      || !/^[A-Z0-9]{10}$/.test(env.APP_STORE_KEY_ID ?? "")
      || !UUID.test(env.APP_STORE_ISSUER_ID ?? "")
      || (environment === "production" && (!Number.isSafeInteger(appAppleId) || appAppleId! <= 0))) throw unconfigured();
  try {
    const key = createPrivateKey(env.APP_STORE_PRIVATE_KEY ?? "");
    if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw unconfigured();
  } catch { throw unconfigured(); }
  return {
    bundleId: env.APP_STORE_BUNDLE_ID!, productId: env.APP_STORE_SUBSCRIPTION_PRODUCT_ID!,
    environment: environment === "production" ? PRODUCTION : SANDBOX,
    appAppleId, keyId: env.APP_STORE_KEY_ID!, issuerId: env.APP_STORE_ISSUER_ID!, privateKey: env.APP_STORE_PRIVATE_KEY!
  };
}

function betaGrants(env: ManagedEntitlementEnv): Array<{ installationHash: string; expiresAt: number }> {
  if (!env.BETA_DEVICE_GRANTS_JSON) return [];
  try {
    if (env.BETA_DEVICE_GRANTS_JSON.length > 20_000) throw unconfigured();
    const data: unknown = JSON.parse(env.BETA_DEVICE_GRANTS_JSON);
    if (!Array.isArray(data) || data.length > 100) throw unconfigured();
    return data.map(grant => {
      if (!grant || typeof grant !== "object" || Object.keys(grant).some(key => !["installationHash", "expiresAt"].includes(key))
          || typeof grant.installationHash !== "string" || !/^[a-f0-9]{64}$/.test(grant.installationHash)
          || typeof grant.expiresAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(grant.expiresAt)
          || !Number.isFinite(Date.parse(grant.expiresAt))
          || Date.parse(grant.expiresAt) > Date.now() + 31 * 86_400_000) throw unconfigured();
      return { installationHash: grant.installationHash, expiresAt: Date.parse(grant.expiresAt) };
    });
  } catch { throw unconfigured(); }
}

export function managedEntitlementReady(env: ManagedEntitlementEnv): boolean {
  try {
    if (betaGrants(env).some(grant => grant.expiresAt > Date.now())) return true;
    appleConfiguration(env);
    return true;
  } catch { return false; }
}

export async function authorizeManagedRequest(request: Request, env: ManagedEntitlementEnv, installationHash: string): Promise<void> {
  if (betaGrants(env).some(grant => grant.installationHash === installationHash && grant.expiresAt > Date.now())) return;
  const jws = request.headers.get(TRANSACTION_HEADER);
  if (!jws) throw new ManagedEntitlementError(402, "subscription_required", "需要有效的见微订阅才能使用平台 AI 服务");
  await authorizeAppleReceipt(jws, env, installationHash);
}

// A temporary AI allowance is not proof of device ownership. Only Apple's
// verified account binding may recover a lost bearer for the same installation.
export async function authorizeInstallationRecovery(request: Request, env: ManagedEntitlementEnv, installationHash: string): Promise<void> {
  const jws = request.headers.get(TRANSACTION_HEADER);
  if (!jws) throw new ManagedEntitlementError(401, "installation_binding_proof_required", "恢复设备访问需要原设备凭证或有效购买凭证");
  await authorizeAppleReceipt(jws, env, installationHash);
}

async function authorizeAppleReceipt(jws: string, env: ManagedEntitlementEnv, installationHash: string): Promise<void> {
  requireJWS(jws);
  const config = appleConfiguration(env);
  await verifyAppleEntitlement(jws, installationHash, config, await makeAppleServices(config));
}

function requireJWS(jws: string): void {
  if (jws.length > 20_000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(jws)) throw invalid();
}

function validateTransaction(transaction: JWSTransactionDecodedPayload, installationHash: string, config: AppleConfig, now: number): void {
  const token = transaction.appAccountToken?.toLowerCase();
  if (!token || !UUID.test(token) || createHash("sha256").update(token).digest("hex") !== installationHash
      || transaction.bundleId !== config.bundleId || transaction.productId !== config.productId
      || transaction.environment !== config.environment || transaction.type !== "Auto-Renewable Subscription"
      || !TRANSACTION_ID.test(transaction.transactionId ?? "") || !TRANSACTION_ID.test(transaction.originalTransactionId ?? "")
      || transaction.revocationDate !== undefined || transaction.isUpgraded === true
      || !Number.isSafeInteger(transaction.signedDate) || transaction.signedDate! > now + 300_000
      || !Number.isSafeInteger(transaction.expiresDate)) throw invalid();
}

// The initial receipt proves ownership, not current entitlement: it may predate a
// refund or renewal. Always query current Apple status before spending model funds.
// Dependencies are injected only in unit tests, never through request/env flags.
export async function verifyAppleEntitlement(jws: string, installationHash: string, config: AppleConfig, apple: AppleServices): Promise<void> {
  const { Status, APIException, VerificationException, VerificationStatus } = await import("@apple/app-store-server-library");
  try {
    requireJWS(jws);
    const now = Date.now();
    const original = await apple.verifyTransaction(jws);
    validateTransaction(original, installationHash, config, now);
    const response = await apple.subscriptionStatus(original.transactionId!);
    if (response.bundleId !== config.bundleId || response.environment !== config.environment
        || (config.environment === PRODUCTION && response.appAppleId !== config.appAppleId)) throw invalid();
    const matches = (response.data ?? []).flatMap(group => group.lastTransactions ?? [])
      .filter(transaction => transaction.originalTransactionId === original.originalTransactionId);
    if (matches.length !== 1) throw invalid();
    const current = matches[0]!;
    if (![Status.ACTIVE, Status.BILLING_GRACE_PERIOD].includes(current.status ?? -1) || !current.signedTransactionInfo) throw invalid();
    requireJWS(current.signedTransactionInfo);
    const transaction = await apple.verifyTransaction(current.signedTransactionInfo);
    validateTransaction(transaction, installationHash, config, now);
    if (transaction.originalTransactionId !== original.originalTransactionId) throw invalid();
    if (current.status === Status.ACTIVE) {
      if (transaction.expiresDate! <= now) throw invalid();
      return;
    }
    if (!current.signedRenewalInfo) throw invalid();
    requireJWS(current.signedRenewalInfo);
    const renewal = await apple.verifyRenewal(current.signedRenewalInfo);
    if (renewal.originalTransactionId !== original.originalTransactionId || renewal.productId !== config.productId
        || renewal.environment !== config.environment || !Number.isSafeInteger(renewal.gracePeriodExpiresDate)
        || renewal.gracePeriodExpiresDate! <= now) throw invalid();
  } catch (error) {
    if (error instanceof ManagedEntitlementError) throw error;
    if (error instanceof VerificationException && error.status !== VerificationStatus.RETRYABLE_VERIFICATION_FAILURE) throw invalid();
    if (error instanceof APIException && error.httpStatusCode === 404) throw invalid();
    throw unavailable();
  }
}

// Preserve the official SDK's JWT signing and response validation while bounding
// HTTP time/size and using Workers' native fetch. No redirects or unbounded retry.
export async function makeAppleServices(config: AppleConfig): Promise<AppleServices> {
  // The SDK's ASN.1 dependency seeds randomness when loaded. Workers forbid
  // this at module startup, so import it only within a request handler.
  const { AppStoreServerAPIClient, SignedDataVerifier } = await import("@apple/app-store-server-library");
  class BoundedAppleClient extends AppStoreServerAPIClient {
    constructor(private readonly config: AppleConfig) {
      super(config.privateKey, config.keyId, config.issuerId, config.bundleId, config.environment);
    }
    protected override async makeFetchRequest(path: string, params: URLSearchParams, method: string,
      body: string | Buffer | undefined, headers: Record<string, string>): Promise<NodeResponse> {
      if (method !== "GET" || body !== undefined || !/^\/inApps\/v1\/subscriptions\/[0-9]{1,30}$/.test(path)) throw unavailable();
      const host = this.config.environment === PRODUCTION ? "api.storekit.apple.com" : "api.storekit-sandbox.apple.com";
      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetch(`https://${host}${path}?${params}`, { method, headers, signal: controller.signal, redirect: "manual" });
        if ((response.status >= 300 && response.status < 400)
            || Number(response.headers.get("content-length")) > MAX_STATUS_BYTES) { controller.abort(); throw unavailable(); }
        const reader = response.body?.getReader();
        if (!reader) throw unavailable();
        const chunks: Uint8Array[] = [];
        let length = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            length += value.byteLength;
            if (length > MAX_STATUS_BYTES) { controller.abort(); throw unavailable(); }
            chunks.push(value);
          }
        } finally { reader.releaseLock(); }
        return new NodeResponse(Buffer.concat(chunks), { status: response.status });
      } finally { clearTimeout(deadline); }
    }
  }
  const verifier = new SignedDataVerifier(APPLE_ROOT_CERTIFICATES.map(cert => Buffer.from(cert)), true,
    config.environment, config.bundleId, config.appAppleId);
  const client = new BoundedAppleClient(config);
  return {
    verifyTransaction: jws => verifier.verifyAndDecodeTransaction(jws),
    verifyRenewal: jws => verifier.verifyAndDecodeRenewalInfo(jws),
    subscriptionStatus: id => client.getAllSubscriptionStatuses(id)
  };
}
