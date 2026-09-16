import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const baseURL = (process.env.JIANWEI_API_BASE_URL ?? "https://jianwei-api.yuqin.wang").replace(/\/$/, "");
const evaluationKey = process.env.JIANWEI_EVALUATION_KEY;
if (!evaluationKey) throw new Error("JIANWEI_EVALUATION_KEY is required");

const gatewayRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = resolve(gatewayRoot, "node_modules/.bin/wrangler");
const installationId = randomUUID();
const idempotencyKey = `eval-stale-${randomUUID()}`;
let deviceId = "";

try {
  const registration = await fetch(`${baseURL}/v1/devices/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ installationId })
  });
  if (!registration.ok) throw new Error("test-device registration failed");
  const registered = await registration.json();
  deviceId = registered.deviceId;
  const deviceToken = registered.deviceToken;

  const periods = chinaPeriods(new Date());
  const staleCreatedAt = new Date(Date.now() - 6 * 60 * 1_000).toISOString();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString();
  executeRemoteSQL(`
    INSERT INTO idempotency_results (
      device_id, route, idempotency_key, status_code, response_json, created_at, expires_at,
      usage_class, usage_day, usage_month, usage_reserved
    ) VALUES (
      ${quote(deviceId)}, 'photo-insights', ${quote(idempotencyKey)}, 202, '__processing__',
      ${quote(staleCreatedAt)}, ${quote(expiresAt)}, 'evaluation', ${quote(periods.day)},
      ${quote(periods.month)}, 1
    );
    INSERT INTO usage_counters (scope, period, request_count, updated_at) VALUES
      (${quote(`device:${deviceId}`)}, ${quote(`day:${periods.day}`)}, 1, ${quote(staleCreatedAt)}),
      (${quote(`device:${deviceId}`)}, ${quote(`month:${periods.month}`)}, 1, ${quote(staleCreatedAt)});
  `);

  const takeover = await fetch(`${baseURL}/v1/photo-insights`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${deviceToken}`,
      "content-type": "application/json",
      "Idempotency-Key": idempotencyKey,
      "X-Jianwei-Evaluation-Key": evaluationKey
    },
    body: "{}"
  });
  if (takeover.status !== 400) throw new Error("stale takeover did not continue to request validation");

  const audit = executeRemoteSQL(`
    SELECT COUNT(*) AS idempotency_rows
    FROM idempotency_results
    WHERE device_id = ${quote(deviceId)} AND idempotency_key = ${quote(idempotencyKey)};
    SELECT COUNT(*) AS nonzero_device_counters
    FROM usage_counters
    WHERE scope = ${quote(`device:${deviceId}`)} AND request_count <> 0;
  `);
  if (!/"idempotency_rows": 0/.test(audit) || !/"nonzero_device_counters": 0/.test(audit)) {
    throw new Error("stale reservation was not fully recovered");
  }
  process.stdout.write("REMOTE_STALE_RESERVATION_RECOVERY=PASS\n");
} finally {
  if (deviceId) {
    executeRemoteSQL(`
      DELETE FROM usage_counters WHERE scope = ${quote(`device:${deviceId}`)};
      DELETE FROM devices WHERE id = ${quote(deviceId)};
    `);
  }
}

function executeRemoteSQL(command) {
  const result = spawnSync(wrangler, ["d1", "execute", "jianwei-beta", "--remote", "--command", command], {
    cwd: gatewayRoot,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024
  });
  if (result.status !== 0) throw new Error("remote database command failed");
  return result.stdout;
}

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function chinaPeriods(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value ?? "";
  const day = `${part("year")}-${part("month")}-${part("day")}`;
  return { day, month: day.slice(0, 7) };
}
