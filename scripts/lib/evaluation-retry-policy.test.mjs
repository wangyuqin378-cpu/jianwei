import test from "node:test";
import assert from "node:assert/strict";

import { retryPolicyForHTTP, retryPolicyForTransport } from "./evaluation-retry-policy.mjs";

test("monetary budget stops are never retried as generic rate limits or server failures", () => {
  for (const code of ["evaluation_budget_unavailable", "evaluation_budget_unconfigured", "evaluation_budget_reconciliation_required", "evaluation_research_unbounded"]) {
    for (const route of ["/v1/photo-insights", "/v1/daily-winner", "/v1/devices/register"]) {
      for (const status of [429, 503]) assert.deepEqual(retryPolicyForHTTP(route, status, code), { retry: false, maxAttempts: 1, kind: "budget" });
    }
  }
});

test("keeps long polling only for an in-flight idempotent photo request", () => {
  assert.deepEqual(retryPolicyForHTTP("/v1/photo-insights", 409, "request_in_progress"), {
    retry: true,
    maxAttempts: 80,
    kind: "in_flight"
  });
  assert.equal(retryPolicyForHTTP("/v1/daily-winner", 409, "request_in_progress").retry, false);
});

test("fails fast when the model provider is persistently unavailable", () => {
  assert.deepEqual(retryPolicyForHTTP("/v1/photo-insights", 502, "vision_provider_error"), {
    retry: true,
    maxAttempts: 3,
    kind: "provider"
  });
});

test("bounds transient rate, server, and transport retries", () => {
  assert.equal(retryPolicyForHTTP("/v1/photo-insights", 429, "rate_limited").maxAttempts, 8);
  assert.equal(retryPolicyForHTTP("/v1/photo-insights", 503, "temporarily_unavailable").maxAttempts, 5);
  assert.equal(retryPolicyForTransport("/v1/photo-insights").maxAttempts, 5);
  assert.equal(retryPolicyForTransport("/v1/daily-winner").maxAttempts, 3);
});

test("does not retry permanent client failures", () => {
  assert.deepEqual(retryPolicyForHTTP("/v1/photo-insights", 403, "forbidden"), {
    retry: false,
    maxAttempts: 1,
    kind: "permanent"
  });
});

test("daily or monthly budget exhaustion is not a transient rate limit", () => {
  for (const route of ["/v1/photo-insights", "/v1/daily-winner"]) {
    for (const code of ["daily_budget_exceeded", "global_daily_budget_exceeded", "monthly_budget_exceeded"]) {
      assert.equal(retryPolicyForHTTP(route, 429, code).retry, false);
      assert.equal(retryPolicyForHTTP(route, 429, code).maxAttempts, 1);
    }
  }
});
