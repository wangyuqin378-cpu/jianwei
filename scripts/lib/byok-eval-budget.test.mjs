import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ByokEvalBudget, quote, BYOK_PARTITION_MICRO_CNY, OTHER_PARTITION_MICRO_CNY,
  TOTAL_MICRO_CNY } from "./byok-eval-budget.mjs";

const payload = { model: "qwen3.7-flash-2026-07-15", messages: [{ role: "user", content: "JSON" }],
  max_tokens: 2048, enable_thinking: false, response_format: { type: "json_object" }, temperature: 0 };
test("rejects search, added moderation, unknown model and missing output bound", () => {
  for (const patch of [{ tools: [] }, { enable_search: true }, { model: "qwen-plus" }, { max_tokens: 4096 },
    { enable_thinking: true }]) assert.throws(() => quote({ ...payload, ...patch }));
  assert.throws(() => quote(payload, { "X-DashScope-DataInspection": "cip" }));
  assert.equal(quote(payload), 1_209_831);
});
test("reserves before HTTP, keeps unknown attempts, survives restart and never renews the partition", () => {
  const dir = mkdtempSync(join(tmpdir(), "jianwei-byok-budget-"));
  try {
    const file = join(dir, "ledger.json");
    let budget = new ByokEvalBudget(file);
    const first = budget.reserve(payload, {}, "test", "hash");
    budget.settle(first, { usage: { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100 } });
    assert.equal(budget.heldMicroCNY, 1680);
    assert.throws(() => budget.settle(first, {}));
    const second = budget.reserve(payload, {}, "test", "hash2");
    budget.settle(second, {});
    budget = new ByokEvalBudget(file);
    assert.equal(budget.heldMicroCNY, 1680 + quote(payload));
    budget.reserve(payload, {}, "next-run", "hash3");
    while (budget.heldMicroCNY + quote(payload) <= BYOK_PARTITION_MICRO_CNY) {
      budget.reserve(payload, {}, "next-run", "unsettled");
    }
    assert.throws(() => budget.reserve(payload, {}, "next-run", "hash4"));
  } finally { rmSync(dir, { recursive: true }); }
});
test("Plus is allowed only with the same bounded no-tool contract", () => {
  assert.equal(quote({ ...payload, model: "qwen3.7-plus-2026-05-26" }), 6_049_152);
});
test("reallocation preserves all previous costs and the original total authorization", () => {
  const dir = mkdtempSync(join(tmpdir(), "jianwei-byok-budget-"));
  try {
    const file = join(dir, "ledger.json");
    const records = [{ id: "previous-unknown", model: payload.model, state: "unknown_usage", costMicroCNY: 1_209_831 }];
    writeFileSync(file, JSON.stringify({ policy: "byok-no-tools-beijing-20260907-v1",
      totalMicroCNY: 10_000_000, partitionMicroCNY: 3_000_000, records }));
    const budget = new ByokEvalBudget(file);
    assert.deepEqual(budget.state.records, records);
    assert.equal(budget.heldMicroCNY, 1_209_831);
    assert.equal(budget.state.totalMicroCNY, 10_000_000);
    assert.equal(budget.state.partitionMicroCNY, 10_000_000);
    assert.equal(budget.state.otherPartitionMicroCNY, 0);
    assert.equal(budget.state.previousPartitionMicroCNY, 3_000_000);
    assert.equal(new ByokEvalBudget(file).heldMicroCNY, 1_209_831);
  } finally { rmSync(dir, { recursive: true }); }
});
test("unexpected usage locks future calls, not silently clamped", () => {
  const dir = mkdtempSync(join(tmpdir(), "jianwei-byok-budget-"));
  try {
    const b = new ByokEvalBudget(join(dir, "ledger.json"));
    const id = b.reserve(payload, {}, "test", "hash");
    b.settle(id, { usage: { prompt_tokens: 100, completion_tokens: 2049, total_tokens: 2149 } });
    assert.equal(b.heldMicroCNY, quote(payload));
    assert.throws(() => b.reserve(payload, {}, "test", "hash2"));
  } finally { rmSync(dir, { recursive: true }); }
});

test("a terminated request is unknown, not in flight; full reserve survives restart and no paid retry is unlocked", () => {
  const dir = mkdtempSync(join(tmpdir(), "jianwei-byok-timeout-"));
  try {
    const file = join(dir, "ledger.json");
    let b = new ByokEvalBudget(file);
    const p = { ...payload, model: "qwen3.7-plus-2026-05-26", enable_thinking: true, thinking_budget: 4096 };
    const id = b.reserve(p, {}, "terminal-run", "hash");
    const held = b.heldMicroCNY;
    assert.throws(() => b.recordTransportFailure("missing"), /Unknown reservation/);
    assert.throws(() => b.recordTransportFailure(id, "still_waiting"), /Unknown transport/);
    assert.equal(b.state.records[0].state, "reserved");
    assert.equal(b.recordTransportFailure(id, "provider_timeout"), true);
    assert.equal(b.state.records[0].state, "unknown_usage");
    assert.equal(b.state.records[0].terminationReason, "provider_timeout");
    assert.equal(b.state.records[0].reservedMicroCNY, held);
    b = new ByokEvalBudget(file);
    assert.equal(b.heldMicroCNY, held);
    assert.equal(b.recordTransportFailure(id), false);
    assert.throws(() => b.reserve(p, {}, "retry", "hash2"), /exhausted/);
    const known = b.reserve(payload, {}, "known", "hash3");
    b.settle(known, { usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 } });
    const settled = JSON.stringify(b.state.records[1]);
    assert.equal(b.recordTransportFailure(known), false);
    assert.equal(JSON.stringify(b.state.records[1]), settled);
  } finally { rmSync(dir, { recursive: true }); }
});

const thinkingPayload = { ...payload, enable_thinking: true, thinking_budget: 4096 };
test("thinking reserves both reasoning and final output; no tool or unbounded variant", () => {
  assert.equal(quote(thinkingPayload), 1_229_492);
  assert.equal(quote({ ...thinkingPayload, model: "qwen3.7-plus-2026-05-26" }), 6_147_456);
  for (const patch of [{ thinking_budget: 8192 }, { thinking_budget: 0 }, { thinking_budget: "4096" },
    { model: "qwen3-vl-plus-2025-12-19" }, { tools: [] }, { enable_search: true },
    { max_completion_tokens: 6144 }, { enable_thinking: false }]) {
    assert.throws(() => quote({ ...thinkingPayload, ...patch }));
  }
  assert.throws(() => quote(thinkingPayload, { "x-dashscope-datainspection": "cip" }));
});
test("thinking settles combined usage once and persists its limits without renewing old budget", () => {
  const dir = mkdtempSync(join(tmpdir(), "jianwei-byok-thinking-"));
  try {
    const file = join(dir, "ledger.json");
    const records = [{ id: "old-unknown", model: payload.model, state: "unknown_usage", costMicroCNY: 1_209_831 }];
    writeFileSync(file, JSON.stringify({ policy: "byok-no-tools-beijing-20260907-v2",
      totalMicroCNY: 10_000_000, partitionMicroCNY: 8_000_000, records }));
    let b = new ByokEvalBudget(file);
    assert.deepEqual(b.state.records, records);
    const id = b.reserve(thinkingPayload, {}, "test", "hash");
    b = new ByokEvalBudget(file);
    b.settle(id, { model: payload.model, usage: { prompt_tokens: 600, completion_tokens: 4300, total_tokens: 4900,
      completion_tokens_details: { reasoning_tokens: 4000 } } });
    assert.equal(b.heldMicroCNY, 1_209_831 + Math.ceil(600 * 1.2 + 4300 * 4.8));
    assert.equal(b.state.partitionMicroCNY, 10_000_000);
    assert.equal(b.state.totalMicroCNY, 10_000_000);
  } finally { rmSync(dir, { recursive: true }); }
});
test("v4 consolidation preserves history/unknowns; Plus thinking charges reasoning and final tokens exactly once", () => {
  const dir = mkdtempSync(join(tmpdir(), "jianwei-byok-plus-thinking-"));
  try {
    const file = join(dir, "ledger.json");
    const records = [{ id: "old-unknown", model: "qwen3-vl-plus-2025-12-19",
      state: "unknown_usage", costMicroCNY: 847_872 }];
    const history = [{ previousPolicy: "v1", fromMicroCNY: 3_000_000, toMicroCNY: 9_000_000 }];
    const legacy = { policy: "byok-no-tools-beijing-20260907-v4", totalMicroCNY: 10_000_000,
      partitionMicroCNY: 9_000_000, otherPartitionMicroCNY: 1_000_000, allocationHistory: history, records };
    writeFileSync(file, JSON.stringify({ ...legacy, otherPartitionMicroCNY: 2_000_000 }));
    assert.throws(() => new ByokEvalBudget(file), /policy mismatch/);
    writeFileSync(file, JSON.stringify(legacy));
    let b = new ByokEvalBudget(file);
    assert.deepEqual(b.state.records, records);
    assert.deepEqual(b.state.allocationHistory[0], history[0]);
    assert.equal(b.state.otherPartitionMicroCNY, 0);
    assert.equal(b.state.totalMicroCNY, 10_000_000);
    const thinking = { ...thinkingPayload, model: "qwen3.7-plus-2026-05-26" };
    const id = b.reserve(thinking, {}, "test", "hash");
    b = new ByokEvalBudget(file);
    assert.equal(b.heldMicroCNY, 847_872 + 6_147_456);
    b.settle(id, { model: thinking.model, usage: { prompt_tokens: 500, completion_tokens: 4300, total_tokens: 4800,
      completion_tokens_details: { reasoning_tokens: 4000 } } });
    assert.equal(b.heldMicroCNY, 847_872 + 500 * 6 + 4300 * 24);
    assert.deepEqual(b.state.records[0], records[0]);
    assert.deepEqual(new ByokEvalBudget(file).state, b.state);
  } finally { rmSync(dir, { recursive: true }); }
});

test("v3 redistribution retains every old reservation and halt, reduces other allocation, and is idempotent", () => {
  const dir = mkdtempSync(join(tmpdir(), "jianwei-byok-redistribution-"));
  try {
    const file = join(dir, "ledger.json");
    const records = [{ id: "unknown", model: payload.model, state: "unknown_usage", costMicroCNY: 1_209_831 },
      { id: "in-flight", model: payload.model, state: "reserved", costMicroCNY: 1_209_831 }];
    writeFileSync(file, JSON.stringify({ policy: "byok-no-tools-beijing-20260907-v3",
      totalMicroCNY: 10_000_000, partitionMicroCNY: 8_000_000, halted: true, records }));
    const b = new ByokEvalBudget(file);
    assert.deepEqual(b.state.records, records);
    assert.equal(b.heldMicroCNY, 2_419_662);
    assert.equal(b.state.halted, true);
    assert.throws(() => b.reserve(payload, {}, "new-run", "hash"));
    assert.equal(BYOK_PARTITION_MICRO_CNY + OTHER_PARTITION_MICRO_CNY, TOTAL_MICRO_CNY);
    assert.equal(b.state.allocationHistory.length, 1);
    const again = new ByokEvalBudget(file);
    assert.deepEqual(again.state, b.state);
    writeFileSync(file, JSON.stringify({ ...b.state, otherPartitionMicroCNY: 2_000_000 }));
    assert.throws(() => new ByokEvalBudget(file), /policy mismatch/);
  } finally { rmSync(dir, { recursive: true }); }
});
test("missing thinking split retains reservation; exceeded component or total halts later calls", () => {
  const usages = [
    { n: 5000, reasoning: undefined, state: "unknown_usage" },
    { n: 5000, reasoning: 4097, state: "contract_violation" },
    { n: 6049, reasoning: 4000, state: "contract_violation" },
    { n: 6145, reasoning: 4096, state: "contract_violation" },
  ];
  for (const u of usages) {
    const dir = mkdtempSync(join(tmpdir(), "jianwei-byok-thinking-invalid-"));
    try {
      const b = new ByokEvalBudget(join(dir, "ledger.json"));
      const id = b.reserve(thinkingPayload, {}, "test", "hash");
      b.settle(id, { usage: { prompt_tokens: 100, completion_tokens: u.n, total_tokens: u.n + 100,
        completion_tokens_details: { reasoning_tokens: u.reasoning } } });
      assert.equal(b.state.records[0].state, u.state);
      assert.equal(b.heldMicroCNY, quote(thinkingPayload));
      if (u.state === "contract_violation") assert.throws(() => b.reserve(payload, {}, "test", "next"));
    } finally { rmSync(dir, { recursive: true }); }
  }
});
