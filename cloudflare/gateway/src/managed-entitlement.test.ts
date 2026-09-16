import assert from "node:assert/strict";
import test from "node:test";
import { createHash, generateKeyPairSync, X509Certificate, verify } from "node:crypto";
import { APIException, Environment, Status, Type, VerificationException, VerificationStatus,
  type JWSTransactionDecodedPayload, type JWSRenewalInfoDecodedPayload, type StatusResponse } from "@apple/app-store-server-library";
import { APPLE_ROOT_CERTIFICATES } from "./apple-roots.js";
import { appleConfiguration, authorizeManagedRequest, makeAppleServices, managedEntitlementReady,
  ManagedEntitlementError, TRANSACTION_HEADER, verifyAppleEntitlement, type AppleServices, type ManagedEntitlementEnv } from "./managed-entitlement.js";

// Ephemeral synthetic signing key: never an Apple account key or an AI credential.
const key = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const account = "550e8400-e29b-41d4-a716-446655440000";
const binding = createHash("sha256").update(account).digest("hex");
const originalJWS = "synthetic.original.receipt";
const latestJWS = "synthetic.latest.receipt";
const renewalJWS = "synthetic.renewal.receipt";
function configuration(): ManagedEntitlementEnv {
  return { APP_STORE_BUNDLE_ID: "invalid.synthetic.jianwei", APP_STORE_SUBSCRIPTION_PRODUCT_ID: "synthetic.monthly",
    APP_STORE_ENVIRONMENT: "production", APP_STORE_APP_APPLE_ID: "1234567890",
    APP_STORE_KEY_ID: "SYNTHETIC1", APP_STORE_ISSUER_ID: account,
    APP_STORE_PRIVATE_KEY: key.privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
}
function fixture() {
  const env = configuration();
  const config = appleConfiguration(env);
  const original: JWSTransactionDecodedPayload = {
    transactionId: "10000001", originalTransactionId: "10000000", bundleId: config.bundleId,
    productId: config.productId, environment: Environment.PRODUCTION, type: Type.AUTO_RENEWABLE_SUBSCRIPTION,
    appAccountToken: account.toUpperCase(), signedDate: Date.now() - 1000, expiresDate: Date.now() + 60_000
  };
  const latest = { ...original, transactionId: "10000002" };
  const renewal: JWSRenewalInfoDecodedPayload = { originalTransactionId: original.originalTransactionId!,
    productId: config.productId, environment: config.environment, gracePeriodExpiresDate: Date.now() + 30_000 };
  const current = { originalTransactionId: original.originalTransactionId!, status: Status.ACTIVE,
    signedTransactionInfo: latestJWS, signedRenewalInfo: renewalJWS };
  const status: StatusResponse = { bundleId: config.bundleId, appAppleId: config.appAppleId!,
    environment: config.environment, data: [{ lastTransactions: [current] }] };
  let queries = 0;
  const seen: string[] = [];
  const apple: AppleServices = {
    async verifyTransaction(jws) { seen.push(jws); assert.ok([originalJWS, latestJWS].includes(jws)); return jws === originalJWS ? original : latest; },
    async verifyRenewal(jws) { seen.push(jws); assert.equal(jws, renewalJWS); return renewal; },
    async subscriptionStatus(id) { queries++; assert.equal(id, original.transactionId); return status; }
  };
  return { env, config, original, latest, renewal, current, status, apple, seen,
    run: () => verifyAppleEntitlement(originalJWS, binding, config, apple), queries: () => queries };
}
function code(expected: string) {
  return (error: unknown) => error instanceof ManagedEntitlementError && error.code === expected;
}

test("an owned receipt requires current subscription status and signed latest transaction on every request", async () => {
  const f = fixture();
  await f.run();
  assert.deepEqual(f.seen, [originalJWS, latestJWS]);
  f.current.status = Status.REVOKED;
  await assert.rejects(f.run, code("subscription_invalid"));
  assert.equal(f.queries(), 2); // Not latched to the old unexpired receipt.
});

test("rejects another installation, product, environment and unsupported purchase before querying Apple", async (t) => {
  const patches: Array<Partial<JWSTransactionDecodedPayload>> = [
    { appAccountToken: "550e8400-e29b-41d4-a716-446655440001" }, { appAccountToken: "not-a-uuid" },
    { productId: "other.monthly" }, { bundleId: "other.app" }, { environment: Environment.SANDBOX },
    { type: Type.CONSUMABLE }, { transactionId: "../../other" }, { originalTransactionId: "" },
    { revocationDate: Date.now() }, { isUpgraded: true }, { signedDate: Date.now() + 600_000 }, { expiresDate: NaN }
  ];
  for (const patch of patches) await t.test(JSON.stringify(patch), async () => {
    const f = fixture(); Object.assign(f.original, patch);
    await assert.rejects(f.run, code("subscription_invalid"));
    assert.equal(f.queries(), 0);
  });
});

test("old signed receipts cannot bypass expired, retrying, revoked, missing or mismatched current status", async (t) => {
  for (const state of [Status.EXPIRED, Status.BILLING_RETRY, Status.REVOKED, 0, 99]) await t.test(`status ${state}`, async () => {
    const f = fixture(); f.current.status = state;
    await assert.rejects(f.run, code("subscription_invalid"));
  });
  for (const mutation of [
    (f: ReturnType<typeof fixture>) => { f.status.data = []; },
    (f: ReturnType<typeof fixture>) => { f.status.bundleId = "other.app"; },
    (f: ReturnType<typeof fixture>) => { f.status.environment = Environment.SANDBOX; },
    (f: ReturnType<typeof fixture>) => { f.status.appAppleId = 123; },
    (f: ReturnType<typeof fixture>) => { f.status.data![0]!.lastTransactions!.push({ ...f.current }); },
    (f: ReturnType<typeof fixture>) => { f.current.originalTransactionId = "90000000"; },
    (f: ReturnType<typeof fixture>) => { f.latest.originalTransactionId = "90000000"; },
    (f: ReturnType<typeof fixture>) => { f.latest.appAccountToken = "550e8400-e29b-41d4-a716-446655440001"; },
    (f: ReturnType<typeof fixture>) => { f.latest.revocationDate = Date.now(); },
    (f: ReturnType<typeof fixture>) => { f.latest.expiresDate = Date.now() - 1; }
  ]) {
    const f = fixture(); mutation(f); await assert.rejects(f.run, code("subscription_invalid"));
  }
});

test("renewal and billing grace require a verified current transaction and bounded Apple-signed expiry", async () => {
  const f = fixture(); f.original.expiresDate = Date.now() - 60_000;
  await f.run(); // An older owned receipt can resolve a valid renewal.
  f.current.status = Status.BILLING_GRACE_PERIOD;
  f.latest.expiresDate = Date.now() - 1000;
  await f.run(); assert.ok(f.seen.includes(renewalJWS));
  f.renewal.gracePeriodExpiresDate = Date.now() - 1;
  await assert.rejects(f.run, code("subscription_invalid"));
  f.renewal.gracePeriodExpiresDate = Date.now() + 60_000;
  f.renewal.originalTransactionId = "90000000";
  await assert.rejects(f.run, code("subscription_invalid"));
});

test("verification outages remain retryable and do not become subscription expiry", async () => {
  for (const error of [new Error("secret upstream details"), new APIException(429), new APIException(500),
    new APIException(401), new VerificationException(VerificationStatus.RETRYABLE_VERIFICATION_FAILURE)]) {
    const f = fixture(); f.apple.subscriptionStatus = async () => { throw error; };
    await assert.rejects(f.run, code("subscription_verification_unavailable"));
  }
  const f = fixture(); f.apple.subscriptionStatus = async () => { throw new APIException(404); };
  await assert.rejects(f.run, code("subscription_invalid"));
});

test("server configuration cannot accept Xcode/local-testing, invalid signing keys, or missing production app ID", () => {
  for (const patch of [{ APP_STORE_ENVIRONMENT: "Xcode" }, { APP_STORE_ENVIRONMENT: "LocalTesting" },
    { APP_STORE_PRIVATE_KEY: "not-a-key" }, { APP_STORE_APP_APPLE_ID: "" }, { APP_STORE_APP_APPLE_ID: "NaN" },
    { APP_STORE_KEY_ID: "wrong" }, { APP_STORE_ISSUER_ID: "wrong" }]) {
    assert.throws(() => appleConfiguration({ ...configuration(), ...patch }), code("subscription_verification_unconfigured"));
  }
  assert.equal(appleConfiguration({ ...configuration(), APP_STORE_ENVIRONMENT: "sandbox" }).environment, Environment.SANDBOX);
  assert.equal(managedEntitlementReady({}), false);
});

test("real Apple verifier rejects fabricated receipts and client-selected certificate chains without a status request", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => { requests++; throw new Error("No network allowed"); });
  const config = appleConfiguration(configuration());
  const apple = await makeAppleServices(config);
  const root = new X509Certificate(APPLE_ROOT_CERTIFICATES[0]!).raw.toString("base64");
  const header = Buffer.from(JSON.stringify({ alg: "ES256", x5c: [root, root, root] })).toString("base64url");
  for (const jws of ["e30.e30.fake", `${header}.${Buffer.from(JSON.stringify(fixture().original)).toString("base64url")}.fake`]) {
    await assert.rejects(verifyAppleEntitlement(jws, binding, config, apple), code("subscription_invalid"));
  }
  assert.equal(requests, 0);
  for (const pem of APPLE_ROOT_CERTIFICATES) {
    const root = new X509Certificate(pem); assert.equal(root.ca, true); assert.equal(root.verify(root.publicKey), true);
  }
});

test("official Apple status client signs the fixed HTTPS request and bounds response size and redirects", async (t) => {
  const config = appleConfiguration(configuration());
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls++;
    assert.equal(url, "https://api.storekit.apple.com/inApps/v1/subscriptions/10000001?");
    assert.equal(init.method, "GET"); assert.equal(init.redirect, "manual"); assert.ok(init.signal);
    const jwt = (init.headers as Record<string, string>).Authorization!.replace("Bearer ", "");
    const [header, payload, signature] = jwt.split(".");
    assert.equal(verify("sha256", Buffer.from(`${header}.${payload}`), { key: key.publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature!, "base64url")), true);
    const claims = JSON.parse(Buffer.from(payload!, "base64url").toString());
    assert.equal(claims.bid, config.bundleId); assert.equal(claims.iss, config.issuerId);
    assert.equal(claims.aud, "appstoreconnect-v1");
    if (calls === 1) return Response.json(fixture().status);
    if (calls === 2) return new Response("x".repeat(256 * 1024 + 1));
    return new Response(null, { status: 302, headers: { Location: "https://attacker.invalid" } });
  });
  const service = await makeAppleServices(config);
  assert.equal((await service.subscriptionStatus("10000001")).bundleId, config.bundleId);
  await assert.rejects(service.subscriptionStatus("10000001"));
  await assert.rejects(service.subscriptionStatus("10000001"), code("subscription_verification_unavailable"));
  await assert.rejects(service.subscriptionStatus("../../attacker"));
  assert.equal(calls, 3);
});

test("only an unexpired explicitly bound server-side Beta grant allows missing receipts", async () => {
  const request = new Request("https://gateway.test/v1/photo-insights");
  const grant = { installationHash: binding, expiresAt: new Date(Date.now() + 60_000).toISOString() };
  const env = { BETA_DEVICE_GRANTS_JSON: JSON.stringify([grant]) };
  await authorizeManagedRequest(request, env, binding);
  await assert.rejects(authorizeManagedRequest(request, env, "2".repeat(64)), code("subscription_required"));
  grant.expiresAt = new Date(Date.now() - 1).toISOString(); env.BETA_DEVICE_GRANTS_JSON = JSON.stringify([grant]);
  await assert.rejects(authorizeManagedRequest(request, env, binding), code("subscription_required"));
  for (const malformed of ["true", "not-json", '[{"installationHash":"*","expiresAt":"never"}]']) {
    await assert.rejects(authorizeManagedRequest(request, { BETA_DEVICE_GRANTS_JSON: malformed }, binding), code("subscription_verification_unconfigured"));
  }
  await assert.rejects(authorizeManagedRequest(request, { BETA_DEVICE_GRANTS_JSON: JSON.stringify([
    { ...grant, expiresAt: new Date(Date.now() + 32 * 86_400_000).toISOString() }
  ]) }, binding), code("subscription_verification_unconfigured"));
  for (const receipt of ["fake", "x".repeat(20_001)]) {
    await assert.rejects(authorizeManagedRequest(new Request(request, { headers: { [TRANSACTION_HEADER]: receipt } }), {}, binding), code("subscription_invalid"));
  }
});
