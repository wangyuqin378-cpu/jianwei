import assert from "node:assert/strict";
import test from "node:test";
import { BlindReviewAttempts, reviewHTTPError } from "./blind-review-attempts.mjs";

test("failed calls count before transport and a restart cannot reset the cap", async () => {
  let saved;
  const state = { usage: { calls: 0 } };
  const ledger = new BlindReviewAttempts(state, 2, async () => { saved = structuredClone(state); });
  await assert.rejects(ledger.run(async () => { assert.equal(saved.usage.calls, 1); throw new Error("timeout"); }));
  const resumed = new BlindReviewAttempts(saved, 2, async () => {});
  await resumed.run(async () => ({}));
  await assert.rejects(resumed.run(() => assert.fail("must not call")), /budget reached/);
  assert.equal(saved.usage.calls, 2);
  assert.equal(saved.usage.unknownUsageCalls, 2);
  assert.throws(() => new BlindReviewAttempts(saved, 3, async () => {}), /budget reset/);
});

test("truncated/invalid results retain reported usage and actual model", async () => {
  const state = {};
  const ledger = new BlindReviewAttempts(state, 1, async () => {});
  await assert.rejects(ledger.run(async record => {
    await record({ model: "fixed-model", choices: [{ finish_reason: "length", message: { content: "{", reasoning_content: "must not store" } }], usage: { prompt_tokens: 12, completion_tokens: 8 } }, 200);
    throw new SyntaxError("invalid JSON");
  }));
  assert.deepEqual(state.usage, { calls: 1, inputTokens: 12, outputTokens: 8, unknownUsageCalls: 0 });
  assert.equal(state.attempts[0].responseModel, "fixed-model");
  assert.equal(state.attempts[0].state, "failed");
  assert.equal(state.attempts[0].responseText, "{");
  assert.equal(state.attempts[0].finishReason, "length");
  assert.equal(JSON.stringify(state).includes("must not store"), false);
});

test("permission/payment errors do not retry, transient errors may retry", () => {
  for (const code of [400, 401, 402, 403, 404]) assert.equal(reviewHTTPError("provider", code).retryable, false);
  for (const code of [429, 500, 503]) assert.equal(reviewHTTPError("provider", code).retryable, true);
  assert.throws(() => new BlindReviewAttempts({ usage: { calls: 1 } }, 3, async () => {}), /complete attempt ledger/);
});
