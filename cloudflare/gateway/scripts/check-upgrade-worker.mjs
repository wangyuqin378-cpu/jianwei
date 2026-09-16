import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { unstable_splitSqlQuery } from "wrangler";

// Run the production bundle and real D1 implementation, never a parallel API
// implementation. All photos, credentials, sources and model verdicts are fake.
const root = fileURLToPath(new URL("../", import.meta.url));
const config = JSON.parse(readFileSync(join(root, "wrangler.jsonc"), "utf8"));
const out = mkdtempSync(join(tmpdir(), "jianwei-upgrade-worker-"));
const hash = value => createHash("sha256").update(value).digest("hex");
const token = "u".repeat(43);
const deviceID = "synthetic-upgrade-device";
const installationHash = hash("synthetic-upgrade-installation");
const peerToken = "p".repeat(43);
const peerID = "synthetic-upgrade-peer";
const peerInstallationHash = hash("synthetic-upgrade-peer-installation");
const source = { url: "https://example.edu/clock", title: "Synthetic evidence, not publishable knowledge" };
const fact = {
  topicKey: "clock", objectName: "时钟", applicability: "general", photoRequirement: null,
  title: "仅用于升级流程测试的合成标题",
  body: "这一段合成文字只用于验证升级后的照片出卡流程和来源绑定，不代表真实知识或质量验收。[ref_1]",
  evidenceSummary: "合成原文仅用作本机接口控制。[ref_1]", citedSourceIndexes: [1],
  surprise: 4, aha: 4, retellability: 4, imageConnection: 4
};
const alternativeFact = { ...fact, title: "同一张照片的另一条合成知识",
  body: "这是一条不同于先前内容的合成知识，只用于确认缓存重复后还会从同一照片寻找新的知识入口。[ref_1]" };
const newHistoricalFact = { ...fact, title: "超过七天后仍能找到另一条合成知识",
  body: "这一条新的合成内容用来证明旧回包过期后，手机历史仍能帮助同一照片避开旧知识而正常出卡。[ref_1]" };
const observed = [];
const calls = [];
let mf;
let scenario = "ready";
let sourceReads = 0;
try {
  execFileSync(process.execPath, [join(root, "node_modules/wrangler/bin/wrangler.js"), "deploy", "--dry-run",
    "--config", "wrangler.jsonc", "--outdir", out], {
    cwd: root, timeout: 30_000, stdio: "pipe", env: { ...process.env, WRANGLER_SEND_METRICS: "false" }
  });
  const bindings = {
    ...config.vars,
    DASHSCOPE_HOST: "dashscope.test", DASHSCOPE_API_KEY: "synthetic-not-an-api-key",
    BETA_DEVICE_GRANTS_JSON: JSON.stringify([installationHash, peerInstallationHash].map(installationHash =>
      ({ installationHash, expiresAt: new Date(Date.now() + 3_600_000).toISOString() })))
  };
  mf = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: readFileSync(join(out, "index.js"), "utf8"),
    compatibilityDate: config.compatibility_date,
    compatibilityFlags: config.compatibility_flags ?? [], bindings, d1Databases: ["DB"],
    outboundService: async request => {
      // No pass-through fetch: an unexpected destination fails the test.
      if (request.url === source.url) {
        assert.equal(request.method, "GET");
        sourceReads++;
        return new Response("<article>Synthetic source text only; this is not evidence for a real fact.</article>", {
          headers: { "content-type": "text/html" }
        });
      }
      assert.equal(new URL(request.url).host, "dashscope.test");
      assert.equal(request.method, "POST");
      assert.equal(request.headers.get("authorization"), `Bearer ${bindings.DASHSCOPE_API_KEY}`);
      const payload = await request.json();
      if (request.url.endsWith("/responses")) {
        assert.deepEqual(payload.tools, [{ type: "web_search" }]);
        assert.equal(payload.tool_choice, "required");
        assert.equal(JSON.stringify(payload).includes("data:image"), false);
        if (scenario === "novelty") assert.ok(payload.input.includes(fact.body.normalize("NFKC").replace(/\[ref_\d+\]/g, "")),
          "Search must know which old fact to move beyond, without receiving another photo");
        if (scenario === "history") assert.ok(payload.input.includes(alternativeFact.body.normalize("NFKC").replace(/\[ref_\d+\]/g, "")),
          "The expired local-history match must steer research past the cached old fact");
        calls.push("search");
        return Response.json({ status: "completed", output: [{ type: "web_search_call", status: "completed", action: { sources: [source] } }],
          usage: { input_tokens: 10, output_tokens: 1, x_tools: { web_search: { count: 1 } } } });
      }
      assert.equal(request.url, "https://dashscope.test/compatible-mode/v1/chat/completions");
      const content = payload.messages[0].content;
      const prompt = typeof content === "string" ? content : content[0].text;
      let raw;
      if (payload.model === bindings.QWEN_FLASH_MODEL) {
        calls.push("recognition");
        if (scenario === "upstream-error") return new Response("Synthetic upstream failure", { status: 503 });
        raw = { primaryObject: { topicKey: "clock", displayName: "时钟", confidence: 0.95 }, secondaryObjects: [], sensitiveFlags: [] };
      } else if (payload.model === bindings.QWEN_VERIFICATION_MODEL) {
        calls.push("photo-review");
        raw = { accepted: true, objectMatches: true, scopeGrounded: true, requiredVisualFeaturesVisible: true,
          visibleEvidence: ["合成表盘"], reason: "合成照片控制" };
      } else {
        assert.equal(payload.model, bindings.QWEN_PLUS_MODEL);
        if (prompt.startsWith("你是见微的每日选卡编辑")) {
          calls.push("daily-winner");
          const input = JSON.parse(payload.messages[1].content);
          assert.equal(input.cards.length, 2);
          raw = { cardId: input.cards[1].cardId, reason: "合成比较控制，验证选择第二条" };
        } else if (prompt.startsWith("照片中已确认这些对象：")) {
          calls.push("writer");
          if (scenario === "novelty") assert.ok(prompt.includes(fact.body.normalize("NFKC").replace(/\[ref_\d+\]/g, "")));
          raw = { candidates: scenario === "history" ? [fact, alternativeFact, newHistoricalFact]
            : scenario === "novelty" ? [fact, alternativeFact]
            : scenario === "repeat-only" ? [fact, alternativeFact] : [fact] };
        } else if (prompt.startsWith("你是独立证据审核器")) {
          calls.push("evidence-review");
          const claims = JSON.parse(prompt.match(/^CLAIMS_JSON:(.+)$/m)[1]);
          const sources = JSON.parse(prompt.match(/^证据：(.+)$/m)[1]);
          assert.equal(payload.response_format.type, "json_schema");
          raw = { checks: Object.fromEntries(claims.map(claim => [claim.id, { sourceId: sources[0].sourceId,
            quote: sources[0].text.slice(0, 120), reason: "合成证据控制", supported: true }])) };
        } else {
          assert.match(prompt, /contentScope/);
          calls.push("quality-review");
          raw = { accepted: true, contentScope: "general", surprise: 4, aha: 4, retellability: 4, imageConnection: 4, reason: "合成质量控制" };
        }
      }
      return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(raw) } }], usage: { prompt_tokens: 10, completion_tokens: 1 } });
    }
  }));
  const db = await mf.getD1Database("DB");
  const migrations = readdirSync(join(root, "migrations")).filter(name => /^\d+.*\.sql$/.test(name)).sort();
  const applyMigration = async name => {
    const sql = readFileSync(join(root, "migrations", name), "utf8");
    // Use Wrangler's SQL parser; splitting on semicolons corrupts quoted seed data.
    const results = await db.batch(unstable_splitSqlQuery(sql).map(statement => db.prepare(statement)));
    assert.equal(results.every(result => result.success), true, name);
  };
  for (const name of migrations.filter(name => name < "0008")) await applyMigration(name);
  const now = new Date().toISOString();
  const expiry = new Date(Date.now() + 86_400_000).toISOString();
  await db.prepare("INSERT INTO devices VALUES (?, ?, ?, ?, ?)").bind(deviceID, installationHash, hash(token), now, now).run();
  const oldReply = { status: "no_insight", candidateId: "550e8400-e29b-41d4-a716-446655440011", reason: "research_no_fact", card: null };
  await db.prepare("INSERT INTO idempotency_results (device_id, route, idempotency_key, status_code, response_json, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(deviceID, "photo-insights", "synthetic-old-completed", 200, JSON.stringify(oldReply), now, expiry).run();
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
  const month = day.slice(0, 7);
  const counterKeys = [[`device:${deviceID}`, `day:${day}`], [`device:${deviceID}`, `month:${month}`], ["global", `day:${day}`], ["global", `month:${month}`]];
  for (const [scope, period] of counterKeys) {
    await db.prepare("INSERT INTO usage_counters VALUES (?, ?, ?, ?)").bind(scope, period, 2, now).run();
  }
  await db.prepare("INSERT INTO idempotency_results (device_id, route, idempotency_key, status_code, response_json, created_at, expires_at, usage_class, usage_day, usage_month, usage_global_day, usage_reserved) VALUES (?, ?, ?, 202, '__processing__', ?, ?, 'product', ?, ?, ?, 1)")
    .bind(deviceID, "photo-insights", "synthetic-old-pending", new Date(Date.now() - 600_000).toISOString(), expiry, day, month, day).run();
  const snapshot = async () => ({
    devices: (await db.prepare("SELECT * FROM devices ORDER BY id").all()).results,
    counters: (await db.prepare("SELECT * FROM usage_counters ORDER BY scope, period").all()).results,
    facts: (await db.prepare("SELECT * FROM knowledge_facts ORDER BY topic_key").all()).results
  });
  const before = await snapshot();
  const health = async (version, expected) => {
    const ready = await mf.dispatchFetch("https://local.invalid/health/ready");
    const body = await ready.json();
    observed.push({ stage: version, readyStatus: ready.status });
    assert.equal(ready.status, expected, `${version}: ${JSON.stringify(body)}`);
    const live = await mf.dispatchFetch("https://local.invalid/health/live");
    assert.equal(live.status, 200); await live.text();
    assert.equal(calls.length, 0);
  };
  await health("schema-7", 503);
  await applyMigration("0008_atomic_reservations.sql");
  await health("schema-8", 503);
  await applyMigration("0009_model_call_accounting.sql");
  await health("schema-9", 200);
  await applyMigration("0010_evaluation_budget.sql");
  await health("schema-10", 200);
  assert.deepEqual(await snapshot(), before, "Upgrade must not reset existing data or quota");
  assert.equal((await db.prepare("SELECT model_call_started FROM idempotency_results WHERE idempotency_key = 'synthetic-old-pending'").first()).model_call_started, 1);
  const post = async (key, candidateId = "550e8400-e29b-41d4-a716-446655440012", bearer = token, history) => {
    const response = await mf.dispatchFetch(`https://local.invalid/${history === undefined ? "v1" : "v2"}/photo-insights`, {
      method: "POST", headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify({ candidateId, jpegBase64: Buffer.from([255, 216, 255, ...new Array(40).fill(0)]).toString("base64"), localLabels: [], interests: [], targetDay: day,
        ...(history === undefined ? {} : { knownKnowledgeHashes: history }) })
    });
    return { status: response.status, body: await response.json() };
  };
  const oldReplay = await post("synthetic-old-completed", oldReply.candidateId);
  assert.deepEqual(oldReplay, { status: 200, body: oldReply });
  assert.deepEqual(await snapshot(), before);
  assert.equal(calls.length, 0);
  const fresh = await post("synthetic-fresh-insight");
  assert.equal(fresh.status, 200, JSON.stringify(fresh.body));
  assert.equal(fresh.body.status, "ready", JSON.stringify(fresh.body));
  assert.equal(fresh.body.card.sources[0].url, source.url);
  assert.deepEqual(calls.slice().sort(), ["recognition", "search", "writer", "evidence-review", "photo-review", "quality-review"].sort());
  assert.equal(sourceReads, 1);
  const journal = (await db.prepare("SELECT * FROM model_usage_events ORDER BY id").all()).results;
  assert.equal(journal.length, 6);
  assert.equal(journal.every(row => row.outcome === "response" && row.input_tokens === 10 && row.output_tokens === 1), true);
  assert.equal(journal.filter(row => row.endpoint === "responses")[0].search_count, 1);
  const afterFresh = await snapshot();
  assert.deepEqual(await post("synthetic-fresh-insight"), fresh);
  assert.deepEqual(await snapshot(), afterFresh);
  assert.equal(calls.length, 6, "Idempotent replay must not dispatch again");
  scenario = "upstream-error";
  const failed = await post("synthetic-old-pending", "550e8400-e29b-41d4-a716-446655440013");
  assert.equal(failed.status, 502, JSON.stringify(failed.body));
  assert.equal(failed.body.error.code, "vision_provider_error");
  const failedCall = await db.prepare("SELECT * FROM model_usage_events WHERE idempotency_key = 'synthetic-old-pending'").first();
  assert.equal(failedCall.http_status, 503);
  assert.equal(failedCall.input_tokens, null, "Unknown failed usage is not zero usage");
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM idempotency_results WHERE idempotency_key = 'synthetic-old-pending' AND status_code = 200").first()).n, 0);
  for (const [scope, period] of counterKeys) {
    const expected = scope === `device:${deviceID}` && period === `day:${day}` ? 2 : 4;
    assert.equal((await db.prepare("SELECT request_count FROM usage_counters WHERE scope = ? AND period = ?").bind(scope, period).first()).request_count, expected,
      "The old unknown dispatch and the new failed dispatch must not be refunded");
  }
  assert.equal((await db.prepare("SELECT request_count FROM usage_counters WHERE scope = ? AND period = ?")
    .bind(`device:${deviceID}`, `day:actual:${day}`).first()).request_count, 4,
    "The actual-day allowance includes the conservative legacy two attempts and both new attempts");
  // Rehearse an existing receipt from the random-fact-ID gateway. Novelty must
  // use its factual content, not assume that historical IDs were canonical.
  const legacyFresh = { ...fresh.body, card: { ...fresh.body.card, factId: "dynamic-clock-legacy-random" } };
  await db.prepare("UPDATE idempotency_results SET response_json = ? WHERE device_id = ? AND idempotency_key = ?")
    .bind(JSON.stringify(legacyFresh), deviceID, "synthetic-fresh-insight").run();
  const beforeLegacyReplay = calls.length;
  assert.deepEqual((await post("synthetic-fresh-insight")).body, legacyFresh);
  assert.equal(calls.length, beforeLegacyReplay, "Old issued IDs are replayed as-is, never rewritten by the upgrade");
  scenario = "novelty";
  const recovered = await post("synthetic-old-pending", "550e8400-e29b-41d4-a716-446655440013");
  assert.equal(recovered.status, 200, JSON.stringify(recovered.body));
  assert.equal(recovered.body.status, "ready");
  assert.notEqual(fresh.body.card.cardId, recovered.body.card.cardId);
  assert.equal(recovered.body.card.body, alternativeFact.body.replace(/\[ref_\d+\]/g, ""),
    "A known cache fact must trigger another knowledge entry on this photo, not another copy of the old fact");
  assert.notEqual(fresh.body.card.factId, recovered.body.card.factId);
  assert.equal(sourceReads, 2);
  assert.equal(calls.length, 13); // Two cold paths and one failed recognition; no review of the known cache/draft.
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM model_usage_events").first()).n, 13);
  const photoQuota = (await snapshot()).counters;
  const winnerRequest = () => mf.dispatchFetch("https://local.invalid/v1/daily-winner", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Idempotency-Key": "synthetic-daily-winner" },
    body: JSON.stringify({ cards: [fresh.body, recovered.body].map(({ card, scores }) => ({
      cardId: card.cardId, topicId: card.topicId, objectName: card.detectedObjectName,
      title: card.title, body: card.body, qualityScore: scores.qualityScore
    })), topicAffinities: {} })
  });
  const winnerResponse = await winnerRequest();
  assert.equal(winnerResponse.status, 200);
  const winner = await winnerResponse.json();
  assert.equal(winner.selectionMethod, "ai");
  assert.equal(winner.cardId, recovered.body.card.cardId);
  assert.deepEqual(await (await winnerRequest()).json(), winner);
  assert.equal(calls.length, 14, "Replaying the daily selection must not call AI twice");
  assert.deepEqual((await snapshot()).counters.filter(row => !row.scope.startsWith("winner:")), photoQuota);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM model_usage_events WHERE route = 'daily-winner'").first()).n, 1);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM evaluation_cost_reservations").first()).n, 0);
  await db.prepare("INSERT INTO devices VALUES (?, ?, ?, ?, ?)").bind(peerID, peerInstallationHash, hash(peerToken), now, now).run();
  scenario = "ready";
  const peer = await post("synthetic-peer-cache", "550e8400-e29b-41d4-a716-446655440014", peerToken);
  assert.equal(peer.status, 200, JSON.stringify(peer.body));
  assert.equal(peer.body.status, "ready");
  assert.notEqual(peer.body.card.cardId, recovered.body.card.cardId);
  assert.equal(peer.body.card.factId, recovered.body.card.factId, "The same cached fact keeps its identity across photos/devices");
  assert.equal(calls.length, 16, "Another user's unseen cache fact still uses the two-call fast path");
  assert.equal(sourceReads, 2);
  scenario = "repeat-only";
  const repeats = await post("synthetic-repeats-only", "550e8400-e29b-41d4-a716-446655440015");
  assert.equal(repeats.status, 200, JSON.stringify(repeats.body));
  assert.equal(repeats.body.status, "no_insight");
  assert.equal(repeats.body.reason, "research_no_fact");
  assert.equal(calls.length, 19, "Known drafts must be skipped before spending on three reviews");
  assert.equal(sourceReads, 3);
  assert.deepEqual(await post("synthetic-repeats-only", "550e8400-e29b-41d4-a716-446655440015"), repeats);
  assert.equal(calls.length, 19, "Replaying a no-new-knowledge result must not run research again");
  // Local history survives the server's seven-day receipt retention. The wire
  // contains only packed hashes, not card text, dates, filenames or photo IDs.
  await db.prepare("UPDATE idempotency_results SET expires_at = ?")
    .bind(new Date(Date.now() - 86_400_000).toISOString()).run();
  const legacyExpired = await post("synthetic-expired-v1", "550e8400-e29b-41d4-a716-446655440018", peerToken);
  assert.equal(legacyExpired.body.card.body, alternativeFact.body.replace(/\[ref_\d+\]/g, ""),
    "Without client history, v1 forgets this old fact once its delivery receipt has expired");
  assert.equal(calls.length, 21);
  await db.prepare("UPDATE idempotency_results SET expires_at = ?")
    .bind(new Date(Date.now() - 86_400_000).toISOString()).run();
  const digest = value => Buffer.from(hash(`${value.topicKey}\0${value.body.normalize("NFKC").replace(/\s*\[ref_\d+\]/g, "").replace(/\s+/g, " ").trim()}`), "hex");
  const history = Buffer.concat([digest(fact), digest(alternativeFact)]).toString("base64");
  scenario = "history";
  const longHistory = await post("synthetic-long-history", "550e8400-e29b-41d4-a716-446655440016", peerToken, history);
  assert.equal(longHistory.status, 200, JSON.stringify(longHistory.body));
  assert.equal(longHistory.body.card.body, newHistoricalFact.body.replace(/\[ref_\d+\]/g, ""));
  assert.equal(calls.length, 27, "Skip the repeated cache and both historical drafts before paid reviews");
  assert.equal(sourceReads, 4);
  const afterHistory = await snapshot();
  // Changed history and cross-version retries remain the same photo job.
  assert.deepEqual(await post("synthetic-long-history", "550e8400-e29b-41d4-a716-446655440016", peerToken, ""), longHistory);
  assert.deepEqual(await post("synthetic-long-history", "550e8400-e29b-41d4-a716-446655440016", peerToken), longHistory);
  assert.deepEqual(await snapshot(), afterHistory);
  const malformedHistory = await post("synthetic-malformed-history", "550e8400-e29b-41d4-a716-446655440017", peerToken, "not-a-hash");
  assert.equal(malformedHistory.status, 400);
  assert.equal(calls.length, 27);
  assert.deepEqual(await snapshot(), afterHistory, "Invalid history must fail before reserving usage");
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM idempotency_results WHERE idempotency_key = 'synthetic-malformed-history'").first()).n, 0);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM idempotency_results WHERE instr(response_json, ?) > 0").bind(history).first()).n, 0,
    "The packed client history must not be retained in a delivery receipt");
  const unauthorized = await mf.dispatchFetch("https://local.invalid/v2/photo-insights", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}"
  });
  assert.equal(unauthorized.status, 401); await unauthorized.text();
  assert.equal(calls.length, 27);
  assert.deepEqual(await snapshot(), afterHistory);
  console.log(JSON.stringify({ runtime: "workerd", entry: config.main, observed, dataPreserved: true,
    coldPathCalls: 6, idempotentReplayCalls: 0, retryableFailure: true, unknownLegacyQuotaPreserved: true,
    dailyWinnerUsesIssuedCards: true, winnerDoesNotConsumePhotoQuota: true,
    repeatedCacheFindsAnotherFactOnSamePhoto: true, peerCacheIsolation: true, repeatedDraftsSkipReviews: true,
    expiredHistoryFindsNewFact: true, crossVersionReplayCalls: 0,
    interceptedModelCalls: calls.length, interceptedSourceReads: sourceReads, realExternalRequests: 0 }, null, 2));
} finally {
  if (mf) await mf.dispose();
  rmSync(out, { recursive: true, force: true });
}
