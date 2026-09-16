import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, generateKeyPairSync, verify } from "node:crypto";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { unstable_splitSqlQuery } from "wrangler";

const root = fileURLToPath(new URL("../", import.meta.url));
const productionConfig = JSON.parse(readFileSync(join(root, "wrangler.jsonc"), "utf8"));
const testConfig = JSON.parse(readFileSync(join(root, "test-fixtures/wrangler.managed-runtime.jsonc"), "utf8"));
assert.equal(testConfig.compatibility_date, productionConfig.compatibility_date);
const out = mkdtempSync(join(tmpdir(), "jianwei-managed-worker-"));
let mf;
try {
  execFileSync(process.execPath, [join(root, "node_modules/wrangler/bin/wrangler.js"), "deploy", "--dry-run",
    "--config", "test-fixtures/wrangler.managed-runtime.jsonc", "--outdir", out], {
    cwd: root, timeout: 30_000, stdio: "pipe", env: { ...process.env, WRANGLER_SEND_METRICS: "false" }
  });
  const token = "t".repeat(43);
  const installation = "550e8400-e29b-41d4-a716-446655440009";
  const key = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const bindings = {
    APP_STORE_BUNDLE_ID: "invalid.synthetic.jianwei", APP_STORE_SUBSCRIPTION_PRODUCT_ID: "synthetic.monthly",
    APP_STORE_ENVIRONMENT: "production", APP_STORE_APP_APPLE_ID: "1234567890",
    APP_STORE_KEY_ID: "SYNTHETIC1", APP_STORE_ISSUER_ID: installation,
    APP_STORE_PRIVATE_KEY: key.privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    DASHSCOPE_API_KEY: "synthetic-not-an-ai-key"
  };
  let interceptedAppleCalls = 0;
  mf = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: readFileSync(join(out, "managed-entitlement-worker.js"), "utf8"),
    compatibilityDate: productionConfig.compatibility_date, bindings, d1Databases: ["DB"],
    outboundService: request => {
      // No request reaches the internet; even the Apple response is synthetic.
      assert.equal(request.url, "https://api.storekit.apple.com/inApps/v1/subscriptions/10000001?");
      assert.equal(request.method, "GET");
      const jwt = request.headers.get("authorization").replace("Bearer ", "");
      const [header, payload, signature] = jwt.split(".");
      assert.equal(verify("sha256", Buffer.from(`${header}.${payload}`), { key: key.publicKey, dsaEncoding: "ieee-p1363" },
        Buffer.from(signature, "base64url")), true);
      const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
      assert.equal(claims.bid, bindings.APP_STORE_BUNDLE_ID);
      assert.equal(claims.iss, installation);
      assert.equal(claims.aud, "appstoreconnect-v1");
      interceptedAppleCalls++;
      if (interceptedAppleCalls === 2) return new Response(null, { status: 302, headers: { Location: "https://attacker.invalid" } });
      return Response.json({ environment: "Production", bundleId: bindings.APP_STORE_BUNDLE_ID, appAppleId: 1234567890, data: [] });
    }
  }));
  const db = await mf.getD1Database("DB");
  for (const name of readdirSync(join(root, "migrations")).filter(name => /^\d+.*\.sql$/.test(name)).sort()) {
    await db.batch(unstable_splitSqlQuery(readFileSync(join(root, "migrations", name), "utf8"))
      .map(statement => db.prepare(statement)));
  }
  const hash = value => createHash("sha256").update(value).digest("hex");
  const now = new Date().toISOString();
  await db.prepare("INSERT INTO devices VALUES (?, ?, ?, ?, ?)").bind("synthetic-device", hash(installation), hash(token), now, now).run();
  const observed = [];
  for (const path of ["/health/live", "/health/ready"]) {
    const response = await mf.dispatchFetch(`https://local.invalid${path}`);
    assert.equal(response.status, 200); await response.text(); observed.push({ path, status: response.status });
  }
  for (const receipt of [null, "e30.e30.fake"]) {
    for (const path of ["/v1/photo-insights", "/v1/daily-winner", "/v1/qwen/chat/completions"]) {
      const headers = { Authorization: `Bearer ${token}` };
      if (receipt) headers["X-Jianwei-App-Store-Transaction"] = receipt;
      const response = await mf.dispatchFetch(`https://local.invalid${path}`, { method: "POST", headers, body: "{}" });
      const body = await response.json();
      assert.equal(response.status, 402, JSON.stringify(body));
      assert.equal(body.error.code, receipt ? "subscription_invalid" : "subscription_required");
      observed.push({ path, status: response.status, code: body.error.code });
    }
  }
  assert.equal(interceptedAppleCalls, 0);
  for (const receipt of [null, "e30.e30.fake"]) {
    const headers = { "Content-Type": "application/json" };
    if (receipt) headers["X-Jianwei-App-Store-Transaction"] = receipt;
    const path = "/v1/devices/register";
    const response = await mf.dispatchFetch(`https://local.invalid${path}`, {
      method: "POST", headers, body: JSON.stringify({ installationId: installation })
    });
    const body = await response.json();
    assert.equal(response.status, receipt ? 402 : 401, JSON.stringify(body));
    assert.equal(body.error.code, receipt ? "subscription_invalid" : "installation_binding_proof_required");
    assert.equal((await db.prepare("SELECT token_hash FROM devices WHERE id = ?").bind("synthetic-device").first()).token_hash, hash(token));
    observed.push({ path, status: response.status, code: body.error.code });
  }
  assert.equal(interceptedAppleCalls, 0);
  const status = await mf.dispatchFetch("https://local.invalid/synthetic-apple-status");
  assert.equal(status.status, 200, await status.clone().text());
  assert.equal((await status.json()).bundleId, bindings.APP_STORE_BUNDLE_ID);
  assert.equal(interceptedAppleCalls, 1);
  const redirected = await mf.dispatchFetch("https://local.invalid/synthetic-apple-status");
  assert.equal(redirected.status, 503);
  assert.equal((await redirected.json()).code, "subscription_verification_unavailable");
  assert.equal(interceptedAppleCalls, 2);
  console.log(JSON.stringify({ runtime: "workerd", observed, interceptedAppleCalls, realExternalRequests: 0 }, null, 2));
} finally {
  if (mf) await mf.dispose();
  rmSync(out, { recursive: true, force: true });
}
