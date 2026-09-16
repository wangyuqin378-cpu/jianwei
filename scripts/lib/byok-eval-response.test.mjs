import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ByokEvalBudget, quote, readBudgetedByokResponse } from "./byok-eval-budget.mjs";

const payload = { model: "qwen3.7-flash-2026-07-15", messages: [{ role: "user", content: "JSON" }],
  max_tokens: 2048, enable_thinking: false, response_format: { type: "json_object" }, temperature: 0 };
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "jianwei-byok-response-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "ledger.json");
  const budget = new ByokEvalBudget(file);
  const id = budget.reserve(payload, {}, "synthetic-test", "synthetic-request-hash");
  const disk = () => JSON.parse(readFileSync(file, "utf8"));
  return { file, budget, id, disk };
}

test("success preserves distinct observed IDs but still settles only verified token usage", async t => {
  const { budget, id, disk } = fixture(t);
  const envelope = { model: payload.model, request_id: "audit-body-123", id: "chatcmpl-output-456",
    usage: { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100 },
    choices: [{ message: { content: "synthetic-response-content", reasoning_content: "private-reasoning" } }] };
  const response = Response.json(envelope, { headers: { "X-Request-ID": "audit-header-789",
    "set-cookie": "private-cookie", authorization: "Bearer sk-test-secret" } });
  const result = await readBudgetedByokResponse(budget, id, response, ["sk-test-secret"]);
  assert.deepEqual(result.envelope, envelope);
  assert.deepEqual(JSON.parse(Buffer.from(result.data).toString("utf8")), envelope);
  const row = disk().records[0];
  assert.deepEqual(row.providerResponse, { status: 200, headerRequestId: "audit-header-789",
    bodyRequestId: "audit-body-123", completionId: "chatcmpl-output-456" });
  assert.equal(row.state, "settled");
  assert.equal(row.costMicroCNY, 1680);
  assert.equal(row.reservedMicroCNY, quote(payload));
  for (const privateValue of ["private-cookie", "sk-test-secret", "synthetic-response-content", "private-reasoning"]) {
    assert.ok(!JSON.stringify(disk()).includes(privateValue));
  }
});

test("HTTP error keeps lookup IDs without accepting a usage-shaped error as free billing", async t => {
  const { budget, id, disk, file } = fixture(t);
  const response = Response.json({ request_id: "chatcmpl-error-123",
    error: { code: "invalid_parameter_error", message: "private-error-message" },
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } },
  { status: 400, headers: { "x-request-id": "error-header-456" } });
  await readBudgetedByokResponse(budget, id, response);
  const row = disk().records[0];
  assert.equal(row.state, "unknown_usage");
  assert.equal(row.costMicroCNY, quote(payload));
  assert.deepEqual(row.providerResponse, { status: 400, headerRequestId: "error-header-456",
    bodyRequestId: "chatcmpl-error-123" });
  assert.ok(!JSON.stringify(row).includes("private-error-message"));
  assert.equal(budget.recordTransportFailure(id), false);
  assert.deepEqual(new ByokEvalBudget(file).state, disk());
});

test("real loopback HTTP abort after headers retains its ID on disk before body completion", async t => {
  const { budget, id, disk, file } = fixture(t);
  let requests = 0;
  const server = createServer((req, res) => {
    requests++;
    assert.equal(req.url, "/synthetic-interrupted-response");
    res.writeHead(200, { "Content-Type": "application/json", "X-Request-ID": "interrupted-header-123" });
    res.write("{"); // No complete body. The test, not an external provider, controls termination.
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const controller = new AbortController();
  const response = await fetch(`http://127.0.0.1:${server.address().port}/synthetic-interrupted-response`,
    { signal: controller.signal });
  const reading = readBudgetedByokResponse(budget, id, response);
  const waiting = disk().records[0];
  assert.equal(waiting.state, "reserved");
  assert.deepEqual(waiting.providerResponse, { status: 200, headerRequestId: "interrupted-header-123" });
  assert.equal(waiting.costMicroCNY, quote(payload));
  controller.abort();
  await assert.rejects(reading, error => error.name === "AbortError");
  budget.recordTransportFailure(id);
  const restarted = new ByokEvalBudget(file);
  assert.deepEqual(restarted.state.records[0].providerResponse, waiting.providerResponse);
  assert.equal(restarted.state.records[0].state, "unknown_usage");
  assert.equal(restarted.heldMicroCNY, quote(payload));
  assert.equal(requests, 1); // No retry after abort and no real-model HTTP.
});

test("malformed and oversized bodies cannot erase header evidence or release the reservation", async t => {
  for (const [name, body] of [["malformed", "{"], ["oversized", "x".repeat(256 * 1024 + 1)]]) {
    await t.test(name, async sub => {
      const { budget, id, disk } = fixture(sub);
      const response = new Response(body, { headers: { "x-request-id": `${name}-123` } });
      if (name === "oversized") {
        await assert.rejects(readBudgetedByokResponse(budget, id, response), /Response too large/);
        budget.recordTransportFailure(id);
      } else await readBudgetedByokResponse(budget, id, response);
      assert.deepEqual(disk().records[0].providerResponse, { status: 200, headerRequestId: `${name}-123` });
      assert.equal(disk().records[0].state, "unknown_usage");
      assert.equal(budget.heldMicroCNY, quote(payload));
    });
  }
});

test("absent or unsafe IDs stay absent, never replaced by local IDs, secrets or raw response fields", async t => {
  const unsafe = [undefined, "", "sk-example", "Bearer-secret", "prefix-test-secret-suffix",
    "a".repeat(161), "line\nbreak", "https://example.com/private", 123, { id: "nested-value" }];
  for (const [i, value] of unsafe.entries()) {
    await t.test(String(i), async sub => {
      const { budget, id, disk } = fixture(sub);
      const response = { status: 503, ok: false, headers: { get: () => value },
        arrayBuffer: async () => Buffer.from(JSON.stringify({ request_id: value, id: value,
          error: { request_id: "do-not-infer-nested-id", message: "private-error-message" } })) };
      await readBudgetedByokResponse(budget, id, response, ["test-secret"]);
      assert.deepEqual(disk().records[0].providerResponse, { status: 503 });
      assert.equal(budget.heldMicroCNY, quote(payload));
    });
  }
});

test("conflicting metadata and attempts to rewrite terminated calls fail without changing the ledger", t => {
  const { budget, id, disk } = fixture(t);
  const first = new Response(null, { headers: { "x-request-id": "first-header-123" } });
  const result = budget.recordProviderResponse(id, first);
  result.headerRequestId = "caller-mutation";
  const snapshot = disk();
  assert.throws(() => budget.recordProviderResponse(id,
    new Response(null, { headers: { "x-request-id": "different-header-456" } })), /Conflicting/);
  assert.deepEqual(disk(), snapshot);
  assert.throws(() => budget.recordProviderResponse(id, { status: 0 }), /Invalid provider/);
  assert.deepEqual(disk(), snapshot);
  budget.recordTransportFailure(id, "provider_timeout");
  const terminated = disk();
  assert.throws(() => budget.recordProviderResponse(id, first, { request_id: "new-late-id" }), /already settled/);
  assert.deepEqual(disk(), terminated);
  assert.equal(budget.heldMicroCNY, quote(payload));
});

test("timeout before headers cannot manufacture a provider lookup ID", t => {
  const { budget, id, disk } = fixture(t);
  budget.recordTransportFailure(id, "provider_timeout");
  assert.equal(disk().records[0].providerResponse, undefined);
  assert.equal(disk().records[0].state, "unknown_usage");
  assert.equal(budget.heldMicroCNY, quote(payload));
});
