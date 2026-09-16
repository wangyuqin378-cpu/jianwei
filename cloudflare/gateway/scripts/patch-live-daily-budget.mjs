import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

// Narrow hotfix only for the verified September 5 production bundle. Do not
// deploy the rest of the dirty workspace (subscription/schema changes).
export const BASE_SHA256 = '97a69f83511d2aa4082cebdae397605d80c4a2a998421c8411f6dde55241cf8f';
export function patchLiveDailyBudget(source) {
  assert.equal(createHash('sha256').update(source).digest('hex'), BASE_SHA256, 'Unexpected live baseline');
  function replaceOnce(before, after) {
    assert.equal(source.split(before).length, 2, 'Hotfix anchor must be unique');
    source = source.replace(before, after);
  }
  replaceOnce('deviceDay: targetDay ?? actualPeriods.day,', 'deviceDay: `actual:${actualPeriods.day}`,');
  replaceOnce('  const current = await Promise.all(counters.map((counter) => env.DB.prepare(',
    `  // Keep legacy scheduled-day records intact; count only actual dispatches today.
  await env.DB.prepare(
    "INSERT INTO usage_counters (scope, period, request_count, updated_at) SELECT ?, ?, MAX((SELECT COUNT(*) FROM idempotency_results WHERE device_id = ? AND usage_reserved = 1 AND COALESCE(usage_global_day, usage_day) = ? AND usage_day NOT LIKE 'actual:%'), COALESCE((SELECT request_count FROM usage_counters WHERE scope = ? AND period = ? AND updated_at >= ?), 0)), ? ON CONFLICT(scope, period) DO NOTHING"
  ).bind(counters[0].scope, counters[0].period, deviceId, actualPeriods.day, counters[0].scope, "day:"+actualPeriods.day, new Date(actualPeriods.day+"T00:00:00+08:00").toISOString(), new Date().toISOString()).run();
  const current = await Promise.all(counters.map((counter) => env.DB.prepare(`);
  replaceOnce('monthly ? "monthly_budget_exceeded" : "daily_budget_exceeded",',
              'monthly ? "monthly_budget_exceeded" : "daily_dispatch_budget_exceeded",');
  replaceOnce('imageRetention: "none"', 'imageRetention: "none", budgetPolicy: "actual-dispatch-day-v1"');
  return source;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const [input, output] = process.argv.slice(2);
  assert.ok(input && output, 'Usage: patch-live-daily-budget.mjs original.multipart candidate.js');
  const raw = await readFile(input);
  const boundary = raw.toString('utf8', 0, raw.indexOf('\r\n')).slice(2);
  const form = await new Response(raw, { headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }}).formData();
  const source = form.get('index.js');
  assert.equal(typeof source, 'string');
  const candidate = patchLiveDailyBudget(source);
  await writeFile(output, candidate, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({base:BASE_SHA256,patched:createHash('sha256').update(candidate).digest('hex')}));
}
